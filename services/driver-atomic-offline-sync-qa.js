'use strict';
// QA-only offline delivery replay. NEVER mount on production; no D1 or customer writes.
// A previous Express offline-sync route posted ledgers in separate transactions;
// its "applied" response alone cannot prove cash/bottle/proof reconciliation.
// This isolated adapter supports only already-uploaded signed proof + valid OTP.
// OTP-OFF/local base64 remains pending until separately verified policy/proof staging.
const {completeDeliveryAsync}=require('./driver-atomic-ledger-qa');
const {createSqlite3AtomicAdapter}=require('./driver-atomic-sqlite3-adapter-qa');
const validId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
const validKey=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{8,110}$/.test(v);
const genericConflict=(idempotencyKey,code)=>({
 idempotencyKey,status:'conflict',code,
 message:'Not posted. Keep offline record and request Company Admin review.'
});
function createAtomicOfflineSyncHandler({sqlite3,dbPath,query,qaEnabled}){
 if(!sqlite3?.Database||typeof query!=='function'||!dbPath)
   throw Error('ERP QA transaction dependencies required');
 const db=createSqlite3AtomicAdapter({sqlite3,dbPath});
 return async function atomicOfflineSync(req,res){
  if(!qaEnabled)return res.status(503).json({message:'Atomic QA offline API disabled'});
  const actor=req?.user;
  if(!actor||!['driver','delivery_driver'].includes(actor.role)||
     !validId(actor.id)||!validId(req.companyId))
    return res.status(403).json({message:'Driver access denied'});
  const operations=req.body?.operations;
  if(!Array.isArray(operations)||operations.length<1||operations.length>100)
    return res.status(400).json({message:'Batch must contain 1-100 operations'});
  const results=[];
  const companyId=Number(req.companyId),driverId=Number(actor.id);
  for(const raw of operations){
   const operation=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
   const key=operation.idempotencyKey;
   if(!validKey(key)){
    results.push(genericConflict(String(key||'').slice(0,128),'invalid_key'));continue;
   }
   if(operation.operationType!=='deliver'){
    results.push(genericConflict(key,'unsupported_operation'));continue;
   }
   const deliveryId=Number(operation.deliveryId),orderId=Number(operation.orderId);
   const payload=operation.payload;
   const proof=payload?.signature;
   // NEVER trust client-supplied proof ID, base64 payload or tenant IDs.
   // A queued PNG must first be uploaded through the separately authenticated
   // server proof-upload route, which creates its own immutable proof registry.
   if(!validId(deliveryId)||!validId(orderId)||!payload||
      typeof payload!=='object'||Array.isArray(payload)||
      !proof||typeof proof!=='object'||Array.isArray(proof)||
      typeof proof.storageKey!=='string'||
      !/^[a-f0-9]{64}$/.test(String(proof.sha256||''))||
      !['image/png','image/jpeg'].includes(proof.contentType)||
      !Number.isSafeInteger(Number(proof.byteSize))||Number(proof.byteSize)<1){
    results.push(genericConflict(key,'verified_proof_required'));continue;
   }
   if(!validId(payload.otpChallengeId)||!/^\d{6}$/.test(String(payload.otpCode||''))){
    results.push(genericConflict(key,'customer_otp_required'));continue;
   }
   try{
    // Scope proof and order to authenticated driver/company BEFORE entering
    // transaction; expectedOrderId is independently checked again INSIDE tx.
    const rows=await query(`SELECT d.order_id,p.id AS proof_id
      FROM deliveries d JOIN driver_qa_verified_proofs p
      ON p.company_id=d.company_id AND p.delivery_id=d.id AND p.driver_id=d.driver_id
      WHERE d.id=? AND d.order_id=? AND d.company_id=? AND d.driver_id=?
       AND p.kind='signature' AND p.storage_key=? AND p.sha256=?
       AND p.content_type=? AND p.byte_size=?`,
      [deliveryId,orderId,companyId,driverId,proof.storageKey,proof.sha256,
       proof.contentType,Number(proof.byteSize)]);
    if(rows.length!==1){
      results.push(genericConflict(key,'unverified_scope_or_proof'));continue;
    }
    const outcome=await completeDeliveryAsync({
      db,actor:{id:driverId,companyId,role:actor.role},
      deliveryId,expectedOrderId:orderId,
      idempotencyKey:'offline:'+key,
      signatureProofId:Number(rows[0].proof_id),
      otpChallengeId:Number(payload.otpChallengeId),otpCode:String(payload.otpCode),
      payment:payload.payment||{amount:0,method:''},
      bottleId:payload.bottleId==null?null:Number(payload.bottleId),
      bottleReturnCount:payload.bottleReturnCount??0,
      emptyCount:payload.emptyCount??0,
      notes:payload.notes||'',baseUpdatedAt:operation.baseUpdatedAt||undefined
    });
    // Only an atomic commit can return an explicit, exactly scoped receipt.
    if(outcome.status!=='applied'||outcome.receipt?.id!==deliveryId||
       outcome.receipt?.order_id!==orderId||
       outcome.receipt?.company_id!==companyId||
       outcome.receipt?.status!=='completed')throw Error('Receipt mismatch');
    results.push({idempotencyKey:key,status:'applied',
      result:{...outcome.receipt,success:true}});
   }catch(_error){
    // Fail closed on wrong OTP, stale status, rollback, tenant or SQL errors.
    // Client must retain encrypted operation on every conflict.
    results.push(genericConflict(key,'not_committed'));
   }
  }
  return res.status(200).json({success:results.every(x=>x.status==='applied'),results});
 };
}
module.exports={createAtomicOfflineSyncHandler};

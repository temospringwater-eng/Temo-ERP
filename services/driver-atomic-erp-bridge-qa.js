'use strict';
// Explicitly gated QA-only bridge: native driver delivery request -> legacy
// Express/sqlite3 database, preserving financial writes in one transaction.
const crypto=require('node:crypto');
const {completeDeliveryAsync}=require('./driver-atomic-ledger-qa');
const {createSqlite3AtomicAdapter}=require('./driver-atomic-sqlite3-adapter-qa');
const validId=n=>Number.isSafeInteger(Number(n))&&Number(n)>0;
function createAtomicDriverDeliveryHandler({sqlite3,dbPath,query,qaEnabled}){
 if(!sqlite3?.Database||typeof query!=='function'||!dbPath)throw Error('ERP adapter dependencies required');
 const atomicDb=createSqlite3AtomicAdapter({sqlite3,dbPath});
 return async function atomicDriverDelivery(req,res){
  if(!qaEnabled)return res.status(503).json({message:'Atomic QA delivery API disabled'});
  if(!req.user||!['driver','delivery_driver'].includes(req.user.role)||
     !validId(req.user.id)||!validId(req.companyId))
    return res.status(403).json({message:'Driver access denied'});
  const deliveryId=Number(req.params.id);
  const proof=req.body?.signature;
  if(!validId(deliveryId)||!proof||typeof proof!=='object'||
     !/^[a-f0-9]{64}$/.test(String(proof.sha256||''))||
     typeof proof.storageKey!=='string')
    return res.status(400).json({message:'Server-uploaded customer signature required'});
  try{
   const rows=await query(`SELECT id FROM driver_qa_verified_proofs
     WHERE company_id=? AND delivery_id=? AND driver_id=? AND kind='signature'
       AND storage_key=? AND sha256=? AND content_type=? AND byte_size=?`,
     [Number(req.companyId),deliveryId,Number(req.user.id),proof.storageKey,
      proof.sha256,proof.contentType,Number(proof.byteSize)]);
   if(rows.length!==1)return res.status(400).json({message:'Verified signature upload not found'});
   // Old Android QA clients do not yet send an explicit online idempotency key.
   // Derive a stable scoped key from the immutable verified proof checksum.
   const stableKey='online:'+deliveryId+':'+crypto.createHash('sha256')
      .update(proof.storageKey+':'+proof.sha256).digest('hex').slice(0,40);
   const result=await completeDeliveryAsync({
     db:atomicDb,actor:{id:Number(req.user.id),companyId:Number(req.companyId),role:req.user.role},
     deliveryId,idempotencyKey:stableKey,signatureProofId:Number(rows[0].id),
     otpChallengeId:Number(req.body?.otpChallengeId),otpCode:req.body?.otpCode,
     payment:req.body?.payment||{amount:0,method:''},
     bottleId:req.body?.bottleId==null?null:Number(req.body.bottleId),
     bottleReturnCount:req.body?.bottleReturnCount??0,
     emptyCount:req.body?.emptyCount??0,notes:req.body?.notes||'',
     baseUpdatedAt:req.body?.baseUpdatedAt||undefined
   });
   return res.json({...result.receipt,success:true});
  }catch(_error){
   // Do not expose OTP, proof paths, SQL details, payment records or secrets.
   return res.status(409).json({message:'Delivery was not posted. Check assigned delivery, proof, OTP and current status.'});
  }
 };
}
module.exports={createAtomicDriverDeliveryHandler};

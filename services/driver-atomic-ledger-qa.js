'use strict';
// QA-only atomic posting core: not mounted on production Express routes.
// Caller must pass a transaction-scoped SQL adapter and verified server-side
// driver identity; never pass a user-provided tenant or trusted proof object.
const crypto=require('node:crypto');
const validId=id=>Number.isSafeInteger(id)&&id>0;
const reject=(message)=>{throw new Error(message);};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const qaSchema=Object.freeze([
 `CREATE TABLE IF NOT EXISTS driver_qa_verified_proofs(
   id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL,delivery_id INTEGER NOT NULL,
   driver_id INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('signature','photo')),
   storage_key TEXT NOT NULL,sha256 TEXT NOT NULL,content_type TEXT NOT NULL,
   byte_size INTEGER NOT NULL CHECK(byte_size>0))`,
 `CREATE TABLE IF NOT EXISTS driver_atomic_delivery_receipts(
   company_id INTEGER NOT NULL,driver_id INTEGER NOT NULL,delivery_id INTEGER NOT NULL UNIQUE,
   idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,receipt_json TEXT NOT NULL,
   PRIMARY KEY(company_id,driver_id,idempotency_key))`
]);
// Disposable node:sqlite adapter is for unit/integration QA, not for running
// the legacy Express sqlite3 connection or changing a production database.
function makeAtomicSqliteSession(db){
 for(const sql of qaSchema)db.exec(sql);
 return {
  transaction(fn){
   db.exec('BEGIN IMMEDIATE');
   try{
    const result=fn({
     get:(sql,...args)=>db.prepare(sql).get(...args),
     run:(sql,...args)=>db.prepare(sql).run(...args)
    });
    db.exec('COMMIT');return result;
   }catch(error){db.exec('ROLLBACK');throw error;}
  }
 };
}
function completeDelivery({db,actor,deliveryId,idempotencyKey,otpChallengeId,otpCode,
 signatureProofId,payment={amount:0,method:''},bottleId=null,bottleReturnCount=0,
 emptyCount=0,notes='',baseUpdatedAt}={}){
 if(!db||typeof db.transaction!=='function')reject('Transactional database required');
 if(!actor||actor.role!=='driver'&&actor.role!=='delivery_driver'||
    !validId(actor.id)||!validId(actor.companyId))reject('Driver authorization required');
 if(!validId(deliveryId)||!validId(signatureProofId)||!validId(otpChallengeId))
   reject('Valid delivery, signature proof and OTP challenge required');
 if(!/^[A-Za-z0-9._:-]{8,128}$/.test(String(idempotencyKey||'')))reject('Valid idempotency key required');
 if(!/^\d{6}$/.test(String(otpCode||'')))reject('Valid customer OTP required');
 const amount=Number(payment?.amount??0);
 if(!Number.isFinite(amount)||amount<0||!Number.isSafeInteger(Math.round(amount*100))||
    Math.abs(Math.round(amount*100)-amount*100)>1e-7)reject('Invalid payment amount');
 const method=String(payment?.method||'').trim();
 if(amount>0&&!['Cash','Card','Bank Transfer','Transfer','Other'].includes(method))reject('Invalid payment method');
 if(!Number.isSafeInteger(bottleReturnCount)||bottleReturnCount<0||
    !Number.isSafeInteger(emptyCount)||emptyCount<0)reject('Invalid bottle counts');
 if(bottleReturnCount>0&&!validId(bottleId))reject('Bottle type required');
 if(bottleId!=null&&!validId(bottleId))reject('Invalid bottle type');
 if(notes!=null&&typeof notes!=='string')reject('Invalid delivery notes');
 const safeNotes=String(notes||'').slice(0,1000);
 const requestHash=hash({deliveryId,otpChallengeId,otpCodeHash:hash(String(otpCode)),
  signatureProofId,payment:{amount,method},bottleId,bottleReturnCount,emptyCount,
  notes:safeNotes,baseUpdatedAt:baseUpdatedAt??null});
 const outcome=db.transaction(tx=>{
  const user=tx.get('SELECT id,company_id,role,active FROM users WHERE id=? AND company_id=?',actor.id,actor.companyId);
  if(!user||user.active!==1||!['driver','delivery_driver'].includes(user.role)||user.role!==actor.role)
    reject('Driver authorization revoked');
  const previous=tx.get('SELECT request_hash,receipt_json FROM driver_atomic_delivery_receipts WHERE company_id=? AND driver_id=? AND idempotency_key=?',actor.companyId,actor.id,idempotencyKey);
  if(previous){
   if(previous.request_hash!==requestHash)reject('idempotency key reused with changed payload');
   return {status:'applied',receipt:JSON.parse(previous.receipt_json)};
  }
  const d=tx.get(`SELECT d.id,d.company_id,d.order_id,d.driver_id,d.status,d.updated_at,
      o.customer_id,o.customer_name FROM deliveries d JOIN orders o
      ON o.id=d.order_id AND o.company_id=d.company_id
      WHERE d.id=? AND d.company_id=? AND d.driver_id=?`,deliveryId,actor.companyId,actor.id);
  if(!d)reject('Assigned delivery not found');
  if(d.status==='delivered'||d.status==='partially_delivered')reject('Delivery already completed');
  if(baseUpdatedAt && d.updated_at!==baseUpdatedAt)reject('stale delivery');
  if(!['assigned','out_for_delivery'].includes(d.status))reject('Delivery not in a valid state');
  const proof=tx.get(`SELECT storage_key,sha256,content_type,byte_size
     FROM driver_qa_verified_proofs WHERE id=? AND company_id=? AND delivery_id=?
     AND driver_id=? AND kind='signature'`,signatureProofId,actor.companyId,deliveryId,actor.id);
  if(!proof||!/^([a-f0-9]{64})$/.test(proof.sha256)||
    !['image/png','image/jpeg'].includes(proof.content_type)||
    !Number.isInteger(proof.byte_size)||proof.byte_size<1||
    !proof.storage_key.startsWith(actor.companyId+'/'+deliveryId+'/'))
    reject('Server-verified customer signature required');
  if(bottleId!=null){const bottle=tx.get('SELECT id FROM bottles WHERE id=? AND company_id=? AND active=1',bottleId,actor.companyId);
    if(!bottle)reject('Bottle is not owned by driver company');}
  const otp=tx.get(`SELECT id,code_hash,attempts,expires_at FROM delivery_otp_challenges
      WHERE id=? AND company_id=? AND delivery_id=? AND verified_at IS NULL`,otpChallengeId,actor.companyId,deliveryId);
  if(!otp||otp.attempts>=5||!otp.expires_at||Date.parse(otp.expires_at+'Z')<=Date.now())
    return {otpFailure:'Customer OTP expired, exhausted or invalid'};
  const received=crypto.createHash('sha256').update(String(otpCode)).digest();
  const expected=Buffer.from(otp.code_hash,'hex');
  if(expected.length!==received.length||!crypto.timingSafeEqual(received,expected)){
    tx.run('UPDATE delivery_otp_challenges SET attempts=attempts+1 WHERE id=? AND company_id=?',otp.id,actor.companyId);
    return {otpFailure:'Customer OTP invalid'};
  }
  tx.run('UPDATE delivery_otp_challenges SET verified_at=CURRENT_TIMESTAMP,attempts=attempts+1 WHERE id=? AND company_id=? AND verified_at IS NULL',otp.id,actor.companyId);
  const changed=tx.run(`UPDATE deliveries SET status='delivered',delivered_at=CURRENT_TIMESTAMP,
       collected_amount=?,collected_method=?,bottle_return_count=?,empty_count=?,notes=?,
       updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=? AND driver_id=? AND status IN ('assigned','out_for_delivery')`,
       amount,method,bottleReturnCount,emptyCount,safeNotes,deliveryId,actor.companyId,actor.id);
  if(changed.changes!==1)reject('Delivery write conflict');
  const updatedOrder=tx.run(`UPDATE orders SET status='delivered',updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?`,d.order_id,actor.companyId);
  if(updatedOrder.changes!==1)reject('Order write conflict');
  if(amount>0)tx.run(`INSERT INTO payments(company_id,customer_name,amount,method,note,direction,party_type,
       reference,created_by,delivery_id,order_id,collected_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
       actor.companyId,d.customer_name,amount,method,safeNotes,'receipt','customer',
       'DELIVERY-'+deliveryId,actor.id,deliveryId,d.order_id,actor.id);
  if(bottleReturnCount||emptyCount){
   tx.run('INSERT INTO delivery_bottle_counts(company_id,delivery_id,bottle_id,returned_quantity,empty_quantity,notes,created_by) VALUES(?,?,?,?,?,?,?)',
      actor.companyId,deliveryId,bottleId,bottleReturnCount,emptyCount,safeNotes,actor.id);
   if(bottleId&&bottleReturnCount)tx.run(`INSERT INTO bottle_movements(company_id,bottle_id,customer_id,movement_type,quantity,reference,notes,created_by)
      VALUES(?,?,?,'returned',?,?,?,?)`,actor.companyId,bottleId,d.customer_id,bottleReturnCount,
      'DELIVERY-'+deliveryId,safeNotes,actor.id);
  }
  tx.run(`INSERT INTO delivery_proofs(company_id,delivery_id,otp_challenge_id,otp_verified_at,
       signature_storage_key,signature_content_type,signature_byte_size,signature_sha256,captured_at,captured_by)
       VALUES(?,?,?,CURRENT_TIMESTAMP,?,?,?,?,CURRENT_TIMESTAMP,?)`,
       actor.companyId,deliveryId,otp.id,proof.storage_key,proof.content_type,proof.byte_size,proof.sha256,actor.id);
  const receipt={id:deliveryId,order_id:d.order_id,company_id:actor.companyId,status:'completed'};
  tx.run('INSERT INTO driver_atomic_delivery_receipts(company_id,driver_id,delivery_id,idempotency_key,request_hash,receipt_json) VALUES(?,?,?,?,?,?)',
      actor.companyId,actor.id,deliveryId,idempotencyKey,requestHash,JSON.stringify(receipt));
  tx.run(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,previous_value,new_value) VALUES(?,?,?,?,?,?,?)`,
      actor.companyId,actor.id,'driver_deliver','delivery',deliveryId,JSON.stringify({status:d.status}),
      JSON.stringify({status:'delivered',amount,bottleReturnCount,emptyCount}));
  return {status:'applied',receipt};
 });
 if(outcome.otpFailure)reject(outcome.otpFailure);
 return outcome;
}
async function completeDeliveryAsync({db,actor,deliveryId,idempotencyKey,otpChallengeId,otpCode,
 signatureProofId,payment={amount:0,method:''},bottleId=null,bottleReturnCount=0,
 emptyCount=0,notes='',baseUpdatedAt}={}){
 if(!db||typeof db.transaction!=='function')reject('Transactional database required');
 if(!actor||actor.role!=='driver'&&actor.role!=='delivery_driver'||
    !validId(actor.id)||!validId(actor.companyId))reject('Driver authorization required');
 if(!validId(deliveryId)||!validId(signatureProofId)||!validId(otpChallengeId))
   reject('Valid delivery, signature proof and OTP challenge required');
 if(!/^[A-Za-z0-9._:-]{8,128}$/.test(String(idempotencyKey||'')))reject('Valid idempotency key required');
 if(!/^\d{6}$/.test(String(otpCode||'')))reject('Valid customer OTP required');
 const amount=Number(payment?.amount??0);
 if(!Number.isFinite(amount)||amount<0||!Number.isSafeInteger(Math.round(amount*100))||
    Math.abs(Math.round(amount*100)-amount*100)>1e-7)reject('Invalid payment amount');
 const method=String(payment?.method||'').trim();
 if(amount>0&&!['Cash','Card','Bank Transfer','Transfer','Other'].includes(method))reject('Invalid payment method');
 if(!Number.isSafeInteger(bottleReturnCount)||bottleReturnCount<0||
    !Number.isSafeInteger(emptyCount)||emptyCount<0)reject('Invalid bottle counts');
 if(bottleReturnCount>0&&!validId(bottleId))reject('Bottle type required');
 if(bottleId!=null&&!validId(bottleId))reject('Invalid bottle type');
 if(notes!=null&&typeof notes!=='string')reject('Invalid delivery notes');
 const safeNotes=String(notes||'').slice(0,1000);
 const requestHash=hash({deliveryId,otpChallengeId,otpCodeHash:hash(String(otpCode)),
  signatureProofId,payment:{amount,method},bottleId,bottleReturnCount,emptyCount,
  notes:safeNotes,baseUpdatedAt:baseUpdatedAt??null});
 const outcome=await db.transaction(async tx=>{
  const user=await tx.get('SELECT id,company_id,role,active FROM users WHERE id=? AND company_id=?',actor.id,actor.companyId);
  if(!user||user.active!==1||!['driver','delivery_driver'].includes(user.role)||user.role!==actor.role)
    reject('Driver authorization revoked');
  const previous=await tx.get('SELECT request_hash,receipt_json FROM driver_atomic_delivery_receipts WHERE company_id=? AND driver_id=? AND idempotency_key=?',actor.companyId,actor.id,idempotencyKey);
  if(previous){
   if(previous.request_hash!==requestHash)reject('idempotency key reused with changed payload');
   return {status:'applied',receipt:JSON.parse(previous.receipt_json)};
  }
  const d=await tx.get(`SELECT d.id,d.company_id,d.order_id,d.driver_id,d.status,d.updated_at,
      o.customer_id,o.customer_name FROM deliveries d JOIN orders o
      ON o.id=d.order_id AND o.company_id=d.company_id
      WHERE d.id=? AND d.company_id=? AND d.driver_id=?`,deliveryId,actor.companyId,actor.id);
  if(!d)reject('Assigned delivery not found');
  if(d.status==='delivered'||d.status==='partially_delivered')reject('Delivery already completed');
  if(baseUpdatedAt && d.updated_at!==baseUpdatedAt)reject('stale delivery');
  if(!['assigned','out_for_delivery'].includes(d.status))reject('Delivery not in a valid state');
  const proof=await tx.get(`SELECT storage_key,sha256,content_type,byte_size
     FROM driver_qa_verified_proofs WHERE id=? AND company_id=? AND delivery_id=?
     AND driver_id=? AND kind='signature'`,signatureProofId,actor.companyId,deliveryId,actor.id);
  if(!proof||!/^([a-f0-9]{64})$/.test(proof.sha256)||
    !['image/png','image/jpeg'].includes(proof.content_type)||
    !Number.isInteger(proof.byte_size)||proof.byte_size<1||
    !proof.storage_key.startsWith(actor.companyId+'/'+deliveryId+'/'))
    reject('Server-verified customer signature required');
  if(bottleId!=null){const bottle=await tx.get('SELECT id FROM bottles WHERE id=? AND company_id=? AND active=1',bottleId,actor.companyId);
    if(!bottle)reject('Bottle is not owned by driver company');}
  const otp=await tx.get(`SELECT id,code_hash,attempts,expires_at FROM delivery_otp_challenges
      WHERE id=? AND company_id=? AND delivery_id=? AND verified_at IS NULL`,otpChallengeId,actor.companyId,deliveryId);
  if(!otp||otp.attempts>=5||!otp.expires_at||Date.parse(otp.expires_at+'Z')<=Date.now())
    return {otpFailure:'Customer OTP expired, exhausted or invalid'};
  const received=crypto.createHash('sha256').update(String(otpCode)).digest();
  const expected=Buffer.from(otp.code_hash,'hex');
  if(expected.length!==received.length||!crypto.timingSafeEqual(received,expected)){
    await tx.run('UPDATE delivery_otp_challenges SET attempts=attempts+1 WHERE id=? AND company_id=?',otp.id,actor.companyId);
    return {otpFailure:'Customer OTP invalid'};
  }
  await tx.run('UPDATE delivery_otp_challenges SET verified_at=CURRENT_TIMESTAMP,attempts=attempts+1 WHERE id=? AND company_id=? AND verified_at IS NULL',otp.id,actor.companyId);
  const changed=await tx.run(`UPDATE deliveries SET status='delivered',delivered_at=CURRENT_TIMESTAMP,
       collected_amount=?,collected_method=?,bottle_return_count=?,empty_count=?,notes=?,
       updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=? AND driver_id=? AND status IN ('assigned','out_for_delivery')`,
       amount,method,bottleReturnCount,emptyCount,safeNotes,deliveryId,actor.companyId,actor.id);
  if(changed.changes!==1)reject('Delivery write conflict');
  const updatedOrder=await tx.run(`UPDATE orders SET status='delivered',updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?`,d.order_id,actor.companyId);
  if(updatedOrder.changes!==1)reject('Order write conflict');
  if(amount>0)await tx.run(`INSERT INTO payments(company_id,customer_name,amount,method,note,direction,party_type,
       reference,created_by,delivery_id,order_id,collected_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
       actor.companyId,d.customer_name,amount,method,safeNotes,'receipt','customer',
       'DELIVERY-'+deliveryId,actor.id,deliveryId,d.order_id,actor.id);
  if(bottleReturnCount||emptyCount){
   await tx.run('INSERT INTO delivery_bottle_counts(company_id,delivery_id,bottle_id,returned_quantity,empty_quantity,notes,created_by) VALUES(?,?,?,?,?,?,?)',
      actor.companyId,deliveryId,bottleId,bottleReturnCount,emptyCount,safeNotes,actor.id);
   if(bottleId&&bottleReturnCount)await tx.run(`INSERT INTO bottle_movements(company_id,bottle_id,customer_id,movement_type,quantity,reference,notes,created_by)
      VALUES(?,?,?,'returned',?,?,?,?)`,actor.companyId,bottleId,d.customer_id,bottleReturnCount,
      'DELIVERY-'+deliveryId,safeNotes,actor.id);
  }
  await tx.run(`INSERT INTO delivery_proofs(company_id,delivery_id,otp_challenge_id,otp_verified_at,
       signature_storage_key,signature_content_type,signature_byte_size,signature_sha256,captured_at,captured_by)
       VALUES(?,?,?,CURRENT_TIMESTAMP,?,?,?,?,CURRENT_TIMESTAMP,?)`,
       actor.companyId,deliveryId,otp.id,proof.storage_key,proof.content_type,proof.byte_size,proof.sha256,actor.id);
  const receipt={id:deliveryId,order_id:d.order_id,company_id:actor.companyId,status:'completed'};
  await tx.run('INSERT INTO driver_atomic_delivery_receipts(company_id,driver_id,delivery_id,idempotency_key,request_hash,receipt_json) VALUES(?,?,?,?,?,?)',
      actor.companyId,actor.id,deliveryId,idempotencyKey,requestHash,JSON.stringify(receipt));
  await tx.run(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,previous_value,new_value) VALUES(?,?,?,?,?,?,?)`,
      actor.companyId,actor.id,'driver_deliver','delivery',deliveryId,JSON.stringify({status:d.status}),
      JSON.stringify({status:'delivered',amount,bottleReturnCount,emptyCount}));
  return {status:'applied',receipt};
 });
 if(outcome.otpFailure)reject(outcome.otpFailure);
 return outcome;
}
module.exports={completeDelivery,completeDeliveryAsync,makeAtomicSqliteSession,qaSchema};

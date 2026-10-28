// QA-only atomic delivery journals; NOT mounted on production Worker.
import {createHash} from 'node:crypto';
const id=n=>Number.isSafeInteger(n)&&n>0;
const nonnegative=n=>Number.isSafeInteger(n)&&n>=0;
export function validateDeliveryFinanceInput(p){
 if(!p||![p.companyId,p.driverId,p.deliveryId,p.productId,p.quantity].every(id)||
  ![p.cashCents,p.creditCents,p.bottlesReturned].every(nonnegative)||
  typeof p.idempotencyKey!=='string'||!/^[a-zA-Z0-9._:-]{8,110}$/.test(p.idempotencyKey)||
  !Number.isSafeInteger(p.cashCents+p.creditCents))
  throw Error('invalid delivery finance payload');
 if(typeof p.signatureRef!=='string'||p.signatureRef.length<8||
  typeof p.photoRef!=='string'||p.photoRef.length<8||
  !Number.isFinite(p.latitude)||Math.abs(p.latitude)>90||
  !Number.isFinite(p.longitude)||Math.abs(p.longitude)>180)
  throw Error('delivery signature photo and GPS required');
 return Object.freeze({...p});
}
export async function postDeliveryFinanceQa(db,p){
 validateDeliveryFinanceInput(p);
 if(typeof db?.prepare!=='function'||typeof db?.batch!=='function')throw Error('D1 required');
 const hash=createHash('sha256').update(JSON.stringify(p)).digest('hex');
 const lookup=()=>db.prepare('SELECT request_hash FROM driver_delivery_posting_receipts WHERE company_id=? AND idempotency_key=?').bind(p.companyId,p.idempotencyKey).first();
 const previous=await lookup();
 if(previous){
  if(previous.request_hash!==hash)throw Error('idempotency conflict');
  return {ok:true,replayed:true};
 }
 const bind=(sql,...args)=>db.prepare(sql).bind(...args);
 const statements=[
  bind('INSERT INTO driver_delivery_posting_receipts(company_id,driver_id,delivery_id,idempotency_key,request_hash,amount_cents,credit_cents,bottles_out,bottles_returned) VALUES(?,?,?,?,?,?,?,?,?)',
   p.companyId,p.driverId,p.deliveryId,p.idempotencyKey,hash,p.cashCents,p.creditCents,p.quantity,p.bottlesReturned),
  bind("INSERT INTO van_stock_movements(company_id,driver_id,product_id,idempotency_key,movement_type,quantity,request_hash) VALUES(?,?,?,?,'deliver',?,?)",
   p.companyId,p.driverId,p.productId,p.idempotencyKey,p.quantity,hash),
  bind('UPDATE van_stock_balances SET quantity=quantity-? WHERE company_id=? AND driver_id=? AND product_id=? AND quantity>=?',
   p.quantity,p.companyId,p.driverId,p.productId,p.quantity),
  bind('INSERT INTO driver_delivery_bottle_ledger(company_id,delivery_id,driver_id,product_id,bottles_out,bottles_returned) VALUES(?,?,?,?,?,?)',
   p.companyId,p.deliveryId,p.driverId,p.productId,p.quantity,p.bottlesReturned),
  bind('INSERT INTO driver_delivery_cash_journal(company_id,delivery_id,driver_id,cash_cents) VALUES(?,?,?,?)',
   p.companyId,p.deliveryId,p.driverId,p.cashCents),
  bind('INSERT INTO driver_delivery_credit_journal(company_id,delivery_id,driver_id,credit_cents) VALUES(?,?,?,?)',
   p.companyId,p.deliveryId,p.driverId,p.creditCents),
  bind('INSERT INTO driver_delivery_proofs(company_id,delivery_id,driver_id,signature_ref,photo_ref,latitude,longitude) VALUES(?,?,?,?,?,?,?)',
   p.companyId,p.deliveryId,p.driverId,p.signatureRef,p.photoRef,p.latitude,p.longitude),
  bind("UPDATE deliveries SET status='delivered' WHERE id=? AND company_id=? AND driver_id=? AND status IN ('pending','assigned','in_progress')",
   p.deliveryId,p.companyId,p.driverId)
 ];
 try{
  const result=await db.batch(statements);
  if(result[2]?.meta?.changes!==1||result[7]?.meta?.changes!==1)
   throw Error('D1 posting invariant failed');
  return {ok:true,replayed:false};
 }catch(error){
  const after=await lookup();
  if(after){
   if(after.request_hash!==hash)throw Error('idempotency conflict');
   return {ok:true,replayed:true};
  }
  throw error;
 }
}

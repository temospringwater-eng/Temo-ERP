// QA-only D1 delivery stock debit. NOT a completed delivery or finance posting API.
import {createHash} from 'node:crypto';
const valid=n=>Number.isSafeInteger(n)&&n>0;
const digest=p=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
export async function debitVanStockForDeliveryQa(db,{companyId,driverId,productId,deliveryId,quantity,idempotencyKey}){
 if(![companyId,driverId,productId,deliveryId,quantity].every(valid)||
  typeof idempotencyKey!=='string'||!/^[a-zA-Z0-9._:-]{8,110}$/.test(idempotencyKey))
  throw Error('invalid delivery debit');
 if(typeof db?.prepare!=='function'||typeof db?.batch!=='function')throw Error('D1 required');
 const hash=digest({companyId,driverId,productId,deliveryId,quantity,type:'deliver'});
 const find=()=>db.prepare('SELECT request_hash FROM van_stock_movements WHERE company_id=? AND idempotency_key=?').bind(companyId,idempotencyKey).first();
 const old=await find();
 if(old){if(old.request_hash!==hash)throw Error('idempotency conflict');return {ok:true,replayed:true};}
 const statements=[
  db.prepare("INSERT INTO van_stock_movements(company_id,driver_id,product_id,idempotency_key,movement_type,quantity,request_hash) VALUES(?,?,?,?,'deliver',?,?)").bind(companyId,driverId,productId,idempotencyKey,quantity,hash),
  db.prepare('UPDATE van_stock_balances SET quantity=quantity-? WHERE company_id=? AND driver_id=? AND product_id=? AND quantity>=?').bind(quantity,companyId,driverId,productId,quantity)
 ];
 try {
  const result=await db.batch(statements);
  if(result[1]?.meta?.changes!==1)throw Error('van stock update invariant failed');
  return {ok:true,replayed:false};
 }catch(error){
  const after=await find();
  if(after){if(after.request_hash!==hash)throw Error('idempotency conflict');return {ok:true,replayed:true};}
  throw error;
 }
}

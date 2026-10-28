// QA-only stock contract. No Worker route, live D1 mutation, or customer finance posting.
import {createHash} from 'node:crypto';
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const integer = n => Number.isSafeInteger(n) && n > 0;
export async function transferWarehouseToVan(db, {companyId,driverId,productId,quantity,idempotencyKey}) {
 if (![companyId,driverId,productId,quantity].every(integer) || typeof idempotencyKey !== 'string' || !idempotencyKey.trim())
  throw Error('invalid stock transfer');
 if (!db || typeof db.batch !== 'function' || typeof db.prepare !== 'function') throw Error('D1 transaction binding required');
 const payload={companyId,driverId,productId,quantity,type:'load'};
 const requestHash=hash(payload);
 const previous=await db.prepare('SELECT request_hash FROM van_stock_movements WHERE company_id=? AND idempotency_key=?').bind(companyId,idempotencyKey).first();
 if(previous) {
  if(previous.request_hash !== requestHash) throw Error('idempotency conflict');
  return {ok:true,replayed:true};
 }
 // The migration's BEFORE INSERT trigger aborts the whole D1 batch on insufficient stock.
 // Unique(company_id,idempotency_key) prevents a racing duplicate from posting twice.
 const statements=[
  db.prepare("INSERT INTO van_stock_movements(company_id,driver_id,product_id,idempotency_key,movement_type,quantity,request_hash) VALUES(?,?,?,?,'load',?,?)").bind(companyId,driverId,productId,idempotencyKey,quantity,requestHash),
  db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND company_id=? AND stock>=?').bind(quantity,productId,companyId,quantity),
  db.prepare('INSERT INTO van_stock_balances(company_id,driver_id,product_id,quantity) VALUES(?,?,?,?) ON CONFLICT(company_id,driver_id,product_id) DO UPDATE SET quantity=quantity+excluded.quantity').bind(companyId,driverId,productId,quantity)
 ];
 try {
  const results=await db.batch(statements);
  if(results[1]?.meta?.changes !== 1) throw Error('warehouse update invariant failed');
  return {ok:true,replayed:false};
 } catch(err) {
  // A concurrent identical request may have committed while this batch waited.
  const after=await db.prepare('SELECT request_hash FROM van_stock_movements WHERE company_id=? AND idempotency_key=?').bind(companyId,idempotencyKey).first();
  if(after) {
   if(after.request_hash!==requestHash) throw Error('idempotency conflict');
   return {ok:true,replayed:true};
  }
  throw err;
 }
}

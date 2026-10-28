import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {validateDeliveryFinanceInput,postDeliveryFinanceQa} from '../services/d1-driver-delivery-finance-qa.mjs';
const p={companyId:1,driverId:2,deliveryId:3,productId:4,quantity:5,
 cashCents:1000,creditCents:500,bottlesReturned:2,idempotencyKey:'delivery-3',
 signatureRef:'signature-1',photoRef:'photo-123',latitude:24.47,longitude:39.61};
function fixture(deliveryStatus='assigned'){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,company_id INTEGER);INSERT INTO users VALUES(2,1);');
 db.exec("CREATE TABLE products(id INTEGER PRIMARY KEY,company_id INTEGER,stock INTEGER);INSERT INTO products VALUES(4,1,50),(5,1,50);");
 db.exec("CREATE TABLE orders(id INTEGER PRIMARY KEY,company_id INTEGER,total_amount REAL,status TEXT);INSERT INTO orders VALUES(9,1,15,'assigned');");
 db.exec("CREATE TABLE order_items(id INTEGER PRIMARY KEY,company_id INTEGER,order_id INTEGER,product_id INTEGER,quantity INTEGER);INSERT INTO order_items VALUES(1,1,9,4,5);");
 db.exec(`CREATE TABLE deliveries(id INTEGER PRIMARY KEY,company_id INTEGER,driver_id INTEGER,order_id INTEGER,status TEXT);INSERT INTO deliveries VALUES(3,1,2,9,'${deliveryStatus}');`);
 for(const file of ['0002_canonical_van_stock.sql','0003_van_delivery_stock_guard.sql','0004_delivery_finance_receipts.sql'])
  db.exec(readFileSync(new URL('../migrations/d1-qa/'+file,import.meta.url),'utf8'));
 db.exec('INSERT INTO van_stock_balances VALUES(1,2,4,8)');
 const adapter={prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args)||null},run(){const x=db.prepare(sql).run(...args);return {meta:{changes:x.changes}}}}}}},async batch(items){
  db.exec('BEGIN IMMEDIATE');try{const x=items.map(i=>i.run());db.exec('COMMIT');return x}
  catch(e){db.exec('ROLLBACK');throw e}
 }};
 const count=table=>db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
 const van=()=>db.prepare('SELECT quantity FROM van_stock_balances').get().quantity;
 return {db,adapter,count,van};
}
test('valid proof, amounts and identifiers accepted',()=>assert.equal(validateDeliveryFinanceInput(p).deliveryId,3));
test('missing proof and negative amounts fail closed',()=>{
 for(const key of ['signatureRef','photoRef','latitude','longitude']){const x={...p};delete x[key];assert.throws(()=>validateDeliveryFinanceInput(x));}
 for(const key of ['cashCents','creditCents','bottlesReturned'])assert.throws(()=>validateDeliveryFinanceInput({...p,[key]:-1}));
});
test('one atomic batch posts stock cash credit bottle proof and delivery',async()=>{
 const f=fixture();assert.deepEqual(await postDeliveryFinanceQa(f.adapter,p),{ok:true,replayed:false});
 assert.equal(f.van(),3);
 for(const table of ['van_stock_movements','driver_delivery_posting_receipts','driver_delivery_cash_journal','driver_delivery_credit_journal','driver_delivery_bottle_ledger','driver_delivery_proofs'])
  assert.equal(f.count(table),1,table);
 assert.equal(f.db.prepare('SELECT status FROM deliveries WHERE id=3').get().status,'delivered');
 assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=9 AND company_id=1').get().status,'delivered');
 assert.equal(f.db.prepare('SELECT cash_cents FROM driver_delivery_cash_journal').get().cash_cents,1000);
 assert.equal(f.db.prepare('SELECT credit_cents FROM driver_delivery_credit_journal').get().credit_cents,500);
 assert.equal(f.db.prepare('SELECT bottles_returned FROM driver_delivery_bottle_ledger').get().bottles_returned,2);
 const reordered=Object.fromEntries(Object.entries({...p,irrelevant:'ignored'}).reverse());
 assert.deepEqual(await postDeliveryFinanceQa(f.adapter,reordered),{ok:true,replayed:true});
 assert.equal(f.van(),3);assert.equal(f.count('driver_delivery_cash_journal'),1);
});
test('out-for-delivery posting completes delivery and company-scoped order',async()=>{
 const f=fixture('out_for_delivery');
 assert.deepEqual(await postDeliveryFinanceQa(f.adapter,p),{ok:true,replayed:false});
 assert.equal(f.db.prepare('SELECT status FROM deliveries WHERE id=3').get().status,'delivered');
 assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=9 AND company_id=1').get().status,'delivered');
});
test('changed retry conflicts without double posting',async()=>{
 const f=fixture();await postDeliveryFinanceQa(f.adapter,p);
 await assert.rejects(postDeliveryFinanceQa(f.adapter,{...p,cashCents:900}),/idempotency conflict/);
 assert.equal(f.van(),3);
});
test('insufficient van stock rolls back every journal',async()=>{
 const f=fixture();f.db.exec('UPDATE van_stock_balances SET quantity=3');
 await assert.rejects(postDeliveryFinanceQa(f.adapter,p),/insufficient van stock/);
 assert.equal(f.van(),3);assert.equal(f.count('driver_delivery_posting_receipts'),0);
 assert.equal(f.count('driver_delivery_cash_journal'),0);assert.equal(f.count('van_stock_movements'),0);
});
test('foreign driver and mismatched ERP total roll back every journal',async()=>{
 for(const change of [{driverId:8},{creditCents:501}]){
  const f=fixture();await assert.rejects(postDeliveryFinanceQa(f.adapter,{...p,...change}),/delivery ownership or amount mismatch/);
  assert.equal(f.van(),8);assert.equal(f.count('driver_delivery_posting_receipts'),0);
 }
});
test('unsupported order lines or product quantities roll back posting',async()=>{
 for(const change of [{productId:5},{quantity:4},{additionalLine:true}]){
  const f=fixture();
  if(change.additionalLine)f.db.exec('INSERT INTO order_items VALUES(2,1,9,5,1)');
  const {additionalLine,...payload}=change;
  await assert.rejects(postDeliveryFinanceQa(f.adapter,{...p,...payload}),/delivery ownership or amount mismatch/);
  assert.equal(f.van(),8);assert.equal(f.count('driver_delivery_posting_receipts'),0);
  assert.equal(f.count('van_stock_movements'),0);
 }
});

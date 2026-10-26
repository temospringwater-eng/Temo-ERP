'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createDriverFinancialBridgeQa,signBridgeEvent,bridgeSchema}=require('../services/driver-financial-bridge-qa');
class Sqlite3Shim{
 constructor(file,_flags,callback){this.db=new DatabaseSync(file);queueMicrotask(()=>callback(null))}
 exec(sql,callback){try{this.db.exec(sql);callback(null)}catch(e){callback(e)}}
 get(sql,args,callback){try{callback(null,this.db.prepare(sql).get(...args))}catch(e){callback(e)}}
 all(sql,args,callback){try{callback(null,this.db.prepare(sql).all(...args))}catch(e){callback(e)}}
 run(sql,args,callback){try{const s=this.db.prepare(sql).run(...args);callback.call({changes:Number(s.changes),lastID:Number(s.lastInsertRowid)},null)}catch(e){callback(e)}}
 close(callback){this.db.close();callback(null)}
}
const secret='qa-bridge-hmac-only-32-byte-key-never-production';
function event(){
 return {source:{companyId:1,driverId:11,orderId:201,deliveryId:301,
  idempotencyKey:'source-qa-delivery-301',requestHash:'1'.repeat(64)},
 status:'completed',payment:{amount:100,method:'cash'},returnedCount:1,emptyCount:2,
 proof:{signature:{storageKey:'source-sig-301',sha256:'a'.repeat(64),contentType:'image/png',byteSize:320},
 photo:{storageKey:'source-photo-301',sha256:'b'.repeat(64),contentType:'image/jpeg',byteSize:4096},
 gps:{latitude:24.7,longitude:46.6,accuracyMeters:20,capturedAt:new Date().toISOString()}}};
}
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'temo-2b-')),file=path.join(dir,'isolated-finance-qa.db');
 const db=new DatabaseSync(file);
 const tables=[
 'CREATE TABLE companies(id INTEGER PRIMARY KEY,active INTEGER)',
 'CREATE TABLE users(id INTEGER PRIMARY KEY,company_id INTEGER,role TEXT,active INTEGER)',
 'CREATE TABLE customers(id INTEGER PRIMARY KEY,company_id INTEGER,name TEXT,active INTEGER)',
 'CREATE TABLE products(id INTEGER PRIMARY KEY,company_id INTEGER,stock INTEGER)',
 'CREATE TABLE orders(id INTEGER PRIMARY KEY,company_id INTEGER,customer_id INTEGER,status TEXT,total_amount REAL)',
 'CREATE TABLE order_items(id INTEGER PRIMARY KEY,company_id INTEGER,order_id INTEGER,product_id INTEGER,quantity INTEGER,delivered_quantity INTEGER DEFAULT 0,unit_price REAL,total_price REAL)',
 'CREATE TABLE deliveries(id INTEGER PRIMARY KEY,company_id INTEGER,order_id INTEGER,driver_id INTEGER,status TEXT,collected_amount REAL DEFAULT 0,collected_method TEXT,bottle_return_count INTEGER DEFAULT 0,empty_count INTEGER DEFAULT 0,delivered_at TEXT,updated_at TEXT)',
 'CREATE TABLE payments(id INTEGER PRIMARY KEY,company_id INTEGER,customer_name TEXT,amount REAL,method TEXT,note TEXT,direction TEXT,party_type TEXT,reference TEXT,created_by INTEGER,delivery_id INTEGER,order_id INTEGER,collected_by INTEGER)',
 'CREATE TABLE credit_ledger(id INTEGER PRIMARY KEY,company_id INTEGER,customer_id INTEGER,payment_id INTEGER,entry_type TEXT,amount REAL,due_date TEXT,note TEXT,created_by INTEGER)',
 'CREATE TABLE bottles(id INTEGER PRIMARY KEY,company_id INTEGER,active INTEGER)',
 'CREATE TABLE delivery_bottle_counts(id INTEGER PRIMARY KEY,company_id INTEGER,delivery_id INTEGER,bottle_id INTEGER,returned_quantity INTEGER,empty_quantity INTEGER,notes TEXT,created_by INTEGER)',
 'CREATE TABLE bottle_movements(id INTEGER PRIMARY KEY,company_id INTEGER,bottle_id INTEGER,customer_id INTEGER,movement_type TEXT,quantity INTEGER,reference TEXT,notes TEXT,created_by INTEGER)',
 'CREATE TABLE stock_movements(id INTEGER PRIMARY KEY,company_id INTEGER,warehouse_id INTEGER,product_id INTEGER,customer_id INTEGER,movement_type TEXT,quantity INTEGER,reference TEXT,notes TEXT,created_by INTEGER)',
 'CREATE TABLE delivery_proofs(id INTEGER PRIMARY KEY,company_id INTEGER,delivery_id INTEGER,otp_challenge_id INTEGER,signature_storage_key TEXT,signature_content_type TEXT,signature_byte_size INTEGER,signature_sha256 TEXT,photo_storage_key TEXT,photo_content_type TEXT,photo_byte_size INTEGER,photo_sha256 TEXT,captured_at TEXT,captured_by INTEGER)',
 'INSERT INTO companies VALUES(40,1),(41,1)',
 "INSERT INTO users VALUES(41,40,'driver',1),(42,41,'driver',1)",
 "INSERT INTO customers VALUES(501,40,'Test Customer',1),(502,41,'Foreign',1)",
 'INSERT INTO products VALUES(51,40,20),(52,40,8),(53,41,20)',
 "INSERT INTO orders VALUES(701,40,501,'out_for_delivery',150)",
 'INSERT INTO order_items VALUES(1,40,701,51,2,0,50,100),(2,40,701,52,1,0,50,50)',
 "INSERT INTO deliveries(id,company_id,order_id,driver_id,status) VALUES(801,40,701,41,'out_for_delivery')",
 'INSERT INTO bottles VALUES(91,40,1)'
 ];
 for(const sql of tables)db.exec(sql);
 db.exec(bridgeSchema.join(';\n')+';');
 db.prepare("INSERT INTO driver_finance_bridge_map(d1_company_id,d1_driver_id,d1_order_id,d1_delivery_id,erp_company_id,erp_driver_id,erp_order_id,erp_delivery_id,erp_customer_id,erp_bottle_id,inventory_policy,invoice_policy) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
  .run(1,11,201,301,40,41,701,801,501,91,'warehouse_on_delivery','new_order_invoice');
 const service=createDriverFinancialBridgeQa({sqlite3:{Database:Sqlite3Shim,OPEN_READWRITE:2},
  dbPath:file,secret,qaEnabled:true,nodeEnv:'test'});
 const count=table=>db.prepare('SELECT COUNT(*) n FROM '+table).get().n;
 const close=()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})};
 return {db,service,count,close};
}
test('TDD: refuses normal and production database, missing secret or untrusted source',async t=>{
 const f=fixture();t.after(f.close);
 assert.throws(()=>createDriverFinancialBridgeQa({sqlite3:{Database:Sqlite3Shim},dbPath:'/srv/hayrila.db',secret,qaEnabled:true,nodeEnv:'test'}),/QA/);
 assert.throws(()=>createDriverFinancialBridgeQa({sqlite3:{Database:Sqlite3Shim},dbPath:'/tmp/test-qa.db',secret,qaEnabled:true,nodeEnv:'production'}),/QA/);
 await assert.rejects(f.service.post({event:event(),signature:'f'.repeat(64)}),/signature/i);
 await assert.rejects(f.service.post({event:{...event(),status:'pending'},signature:signBridgeEvent(secret,{...event(),status:'pending'})}),/completed/i);
 assert.equal(f.count('payments'),0);
});
test('TDD integration: verified D1 receipt posts payment, invoice/customer credit, bottle, stock, GPS atomically',async t=>{
 const f=fixture();t.after(f.close);
 const e=event(),signature=signBridgeEvent(secret,e);
 const first=await f.service.post({event:e,signature});
 assert.equal(first.status,'applied');
 assert.equal(first.erpDeliveryId,801);
 assert.equal(f.db.prepare('SELECT status,collected_amount FROM deliveries WHERE id=801').get().status,'delivered');
 assert.equal(f.db.prepare('SELECT collected_amount FROM deliveries WHERE id=801').get().collected_amount,100);
 assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=701').get().status,'delivered');
 assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=51').get().stock,18);
 assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=52').get().stock,7);
 assert.equal(f.db.prepare('SELECT SUM(delivered_quantity) q FROM order_items').get().q,3);
 assert.equal(f.db.prepare("SELECT SUM(CASE WHEN entry_type='debit' THEN amount ELSE -amount END) balance FROM credit_ledger").get().balance,50);
 assert.equal(f.count('payments'),1);assert.equal(f.count('credit_ledger'),2);
 assert.equal(f.count('stock_movements'),2);assert.equal(f.count('bottle_movements'),1);
 assert.equal(f.count('delivery_bottle_counts'),1);assert.equal(f.count('delivery_proofs'),1);
 assert.equal(f.count('driver_finance_bridge_proof_gps'),1);assert.equal(f.count('driver_finance_bridge_receipts'),1);
 assert.deepEqual(await f.service.post({event:e,signature}),first);
 assert.equal(f.count('payments'),1);assert.equal(f.count('stock_movements'),2);
 const changed={...e,payment:{amount:90,method:'cash'}};
 await assert.rejects(f.service.post({event:changed,signature:signBridgeEvent(secret,changed)}),/conflict/i);
 assert.equal(f.count('payments'),1);
});
test('TDD integration: tenant and mapping mismatch, missing evidence, van policy all deny before debit',async t=>{
 const f=fixture();t.after(f.close);
 const e=event();
 for(const changed of [
  {...e,source:{...e.source,companyId:2}},
  {...e,proof:{...e.proof,photo:undefined}},
  {...e,proof:{...e.proof,gps:{...e.proof.gps,accuracyMeters:800}}}
 ])await assert.rejects(f.service.post({event:changed,signature:signBridgeEvent(secret,changed)}),/mapping|proof|GPS|accuracy/i);
 f.db.exec("UPDATE driver_finance_bridge_map SET inventory_policy='blocked'");
 await assert.rejects(f.service.post({event:e,signature:signBridgeEvent(secret,e)}),/inventory|blocked/i);
 assert.equal(f.count('payments'),0);assert.equal(f.count('stock_movements'),0);
});
test('TDD integration: ledger insert failure rolls back delivery, stock, money, bottle and receipt together',async t=>{
 const f=fixture();t.after(f.close);
 f.db.exec("CREATE TRIGGER deny_credit BEFORE INSERT ON credit_ledger WHEN NEW.entry_type='payment' BEGIN SELECT RAISE(ABORT,'simulate failure'); END");
 const e=event();
 await assert.rejects(f.service.post({event:e,signature:signBridgeEvent(secret,e)}));
 assert.equal(f.db.prepare('SELECT status FROM deliveries WHERE id=801').get().status,'out_for_delivery');
 assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=51').get().stock,20);
 for(const table of ['payments','credit_ledger','delivery_bottle_counts','stock_movements','driver_finance_bridge_receipts'])
   assert.equal(f.count(table),0,table);
});
test('TDD integration: insufficient warehouse inventory stops all financial posting',async t=>{
 const f=fixture();t.after(f.close);
 f.db.exec('UPDATE products SET stock=1 WHERE id=51');
 const e=event();
 await assert.rejects(f.service.post({event:e,signature:signBridgeEvent(secret,e)}),/stock/i);
 assert.equal(f.count('payments'),0);assert.equal(f.db.prepare('SELECT status FROM deliveries WHERE id=801').get().status,'out_for_delivery');
});

test('TDD offline retry after lost acknowledgement and concurrent duplicate: ERP posts exactly once',async t=>{
 const f=fixture();t.after(f.close);
 const e=event(),signature=signBridgeEvent(secret,e);
 // Simulates the same signed D1 completion being retried before the prior ACK arrives.
 const receipts=await Promise.all(Array.from({length:3},()=>f.service.post({event:e,signature})));
 assert.deepEqual(receipts[0],receipts[1]);
 assert.deepEqual(receipts[1],receipts[2]);
 assert.deepEqual(await f.service.post({event:e,signature}),receipts[0]); // reboot/retry
 assert.equal(f.count('driver_finance_bridge_receipts'),1);
 assert.equal(f.count('payments'),1);
 assert.equal(f.count('credit_ledger'),2);
 assert.equal(f.count('stock_movements'),2);
 assert.equal(f.count('delivery_proofs'),1);
 assert.equal(f.count('driver_finance_bridge_proof_gps'),1);
 assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=51').get().stock,18);
});
test('TDD replay cannot acknowledge a remapped ERP company or delivery after source posting',async t=>{
 const f=fixture();t.after(f.close);
 const e=event(),signature=signBridgeEvent(secret,e);
 const first=await f.service.post({event:e,signature});
 assert.equal(first.companyId,40);
 // Independent mapping review must be stable; stale/corrupt mapping must not silently ACK.
 f.db.exec('UPDATE driver_finance_bridge_map SET erp_company_id=41,erp_delivery_id=999 WHERE d1_company_id=1 AND d1_delivery_id=301');
 await assert.rejects(f.service.post({event:e,signature}),/mapping|reconcile|changed/i);
 assert.equal(f.count('payments'),1);
 assert.equal(f.count('driver_finance_bridge_receipts'),1);
 assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=51').get().stock,18);
});

test('TDD D1 Worker WebCrypto HMAC receipt interoperates with ERP and rejects tampered proof before ledger posting',async t=>{
 const f=fixture();t.after(f.close);
 const e=event();
 // Independent source-side algorithm: the Cloudflare Worker signs JSON.stringify(event)
 // using WebCrypto, while ERP verifies with node:crypto timing-safe HMAC.
 const {webcrypto}=require('node:crypto');
 const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(e)));
 const sourceSignature=Buffer.from(bytes).toString('hex');
 assert.equal(sourceSignature,signBridgeEvent(secret,e));
 const changed={...e,proof:{...e.proof,photo:{...e.proof.photo,sha256:'c'.repeat(64)}}};
 await assert.rejects(f.service.post({event:changed,signature:sourceSignature}),/signature/i);
 assert.equal(f.count('payments'),0);
 assert.equal(f.count('driver_finance_bridge_receipts'),0);
 const posted=await f.service.post({event:e,signature:sourceSignature});
 assert.equal(posted.status,'applied');
 assert.equal(f.count('payments'),1);
 assert.equal(f.count('driver_finance_bridge_receipts'),1);
 assert.deepEqual(await f.service.post({event:e,signature:sourceSignature}),posted);
 assert.equal(f.count('payments'),1);
});

test('TDD lost-ACK replay refuses to acknowledge missing or modified ERP payment and credit entries',async()=>{
 for(const mutation of [
  'DELETE FROM payments WHERE delivery_id=801',
  "DELETE FROM credit_ledger WHERE entry_type='payment'",
  'UPDATE payments SET amount=99 WHERE delivery_id=801'
 ]){
  const f=fixture();
  try{
   const e=event(),signature=signBridgeEvent(secret,e);
   await f.service.post({event:e,signature});
   f.db.exec(mutation);
   await assert.rejects(f.service.post({event:e,signature}),/reconcil|payment|ledger/i);
   assert.equal(f.count('driver_finance_bridge_receipts'),1);
  }finally{f.close()}
 }
});
test('TDD lost-ACK replay refuses to acknowledge missing proof/GPS, stock or reverted delivery',async()=>{
 for(const mutation of [
  'DELETE FROM driver_finance_bridge_proof_gps WHERE erp_delivery_id=801',
  'DELETE FROM stock_movements WHERE reference=\'DELIVERY-801\'',
  "UPDATE deliveries SET status='assigned' WHERE id=801"
 ]){
  const f=fixture();
  try{
   const e=event(),signature=signBridgeEvent(secret,e);
   await f.service.post({event:e,signature});
   f.db.exec(mutation);
   await assert.rejects(f.service.post({event:e,signature}),/reconcil|proof|stock|delivery/i);
   assert.equal(f.count('payments'),1); // no replay mutation may double-charge
  }finally{f.close()}
 }
});

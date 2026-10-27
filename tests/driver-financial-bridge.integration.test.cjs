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
 return {db,file,service,count,close};
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
 assert.equal(first.companyId,40,'ERP tenant ID must remain mapped tenant 40');
 assert.equal(first.d1CompanyId,1,'Source D1 tenant ID must also be signed, not silently inferred');
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
 assert.equal(JSON.parse(f.db.prepare('SELECT result_json FROM driver_finance_bridge_receipts').get().result_json).d1CompanyId,1);
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

test('TDD network integration: HMAC service-to-service receipt persists ERP ledgers once after lost ACK',async t=>{
 const {createDriverFinanceHttpQa,requestMac}=require('../services/driver-finance-http-qa');
 const express=require('express'),f=fixture();t.after(f.close);
 const app=express(),transport='separate-transport-key-qa-32-bytes-long-and-private';
 assert.equal(createDriverFinanceHttpQa({app,qaEnabled:true,nodeEnv:'test',dbPath:'/tmp/signed-bridge-qa.db',
  transportSecret:transport,receiptSecret:secret,service:f.service}),true);
 const server=app.listen(0,'127.0.0.1');await new Promise(ok=>server.once('listening',ok));
 t.after(()=>new Promise(ok=>server.close(ok)));
 const url='http://127.0.0.1:'+server.address().port+'/internal/qa/d1-driver-finance';
 const e=event(),body=JSON.stringify({event:e,signature:signBridgeEvent(secret,e)});
 async function send(raw=body){
  const stamp=String(Date.now());
  const result=await fetch(url,{method:'POST',body:raw,headers:{
   'Content-Type':'application/json','x-temo-qa-timestamp':stamp,
   'x-temo-qa-auth':requestMac(transport,stamp,raw)}});
  const response=await result.text();
  return {status:result.status,response,ack:result.headers.get('x-temo-qa-ack'),
   validAck:result.headers.get('x-temo-qa-ack')===requestMac(transport,stamp,response)};
 }
 const first=await send(),again=await send();
 assert.equal(first.status,200,first.response);assert.equal(again.status,200,again.response);
 assert.equal(first.validAck,true);assert.equal(again.validAck,true);
 assert.equal(f.count('payments'),1);assert.equal(f.count('credit_ledger'),2);
 assert.equal(f.count('stock_movements'),2);assert.equal(f.count('delivery_bottle_counts'),1);
 assert.equal(f.count('driver_finance_bridge_receipts'),1);
 const modified={...e,payment:{amount:150,method:'cash'}};
 const conflict=await send(JSON.stringify({event:modified,signature:signBridgeEvent(secret,modified)}));
 assert.equal(conflict.status,409);assert.equal(conflict.ack,null);
 assert.equal(f.count('payments'),1);
});

test('TDD full signed D1→ERP private HTTP bridge posts once, ACK maps D1 company 1 to ERP 40; retry reconciles',async t=>{
 const express=require('express');
 const {createDriverFinanceHttpQa,requestMac}=require('../services/driver-finance-http-qa');
 const f=fixture();t.after(f.close);
 const transportSecret='qa-transport-secret-distinct-from-signing-key-2026';
 const app=express();
 const enabled=createDriverFinanceHttpQa({
  app,qaEnabled:true,nodeEnv:'test',dbPath:f.file,service:f.service,
  receiptSecret:secret,transportSecret
 });
 assert.equal(enabled,true);
 const server=app.listen(0,'127.0.0.1');
 await new Promise(done=>server.once('listening',done));
 t.after(()=>new Promise(done=>server.close(done)));
 const url='http://127.0.0.1:'+server.address().port+'/internal/qa/d1-driver-finance';
 const send=async(source=event(),useCorrectMac=true)=>{
  const stamp=String(Date.now());
  const raw=JSON.stringify({event:source,signature:signBridgeEvent(secret,source)});
  const signature=useCorrectMac?requestMac(transportSecret,stamp,raw):'0'.repeat(64);
  const response=await fetch(url,{method:'POST',headers:{
   'content-type':'application/json','x-temo-qa-timestamp':stamp,'x-temo-qa-auth':signature
  },body:raw});
  const text=await response.text();
  return{code:response.status,raw:text,data:JSON.parse(text),headers:response.headers,stamp};
 };
 // Offline replay must retain the ORIGINAL immutable signed proof timestamps and hashes.
 const immutableSource=event();
 const first=await send(immutableSource);
 assert.equal(first.code,200,first.raw);
 assert.equal(first.data.receipt.d1CompanyId,1);
 assert.equal(first.data.receipt.companyId,40);
 assert.equal(first.data.receipt.erpDeliveryId,801);
 assert.equal(first.data.receipt.d1DeliveryId,301);
 assert.equal(first.headers.get('x-temo-qa-ack'),
  requestMac(transportSecret,first.headers.get('x-temo-qa-ack-time'),first.raw));
 const retry=await send(immutableSource);
 assert.equal(retry.code,200,retry.raw);
 assert.deepEqual(retry.data.receipt,first.data.receipt);
 assert.equal(f.count('payments'),1);
 assert.equal(f.count('credit_ledger'),2);
 assert.equal(f.count('stock_movements'),2);
 assert.equal(f.count('bottle_movements'),1);
 assert.equal(f.count('driver_finance_bridge_receipts'),1);
 assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=51').get().stock,18);
 const wrongTenant=event();wrongTenant.source={...wrongTenant.source,companyId:2};
 const bad=await send(wrongTenant);
 assert.equal(bad.code,409);
 assert.equal(bad.headers.get('x-temo-qa-ack'),null);
 const unauth=await send(event(),false);
 assert.equal(unauth.code,401);
 assert.equal(f.count('payments'),1);
 assert.equal(f.count('driver_finance_bridge_receipts'),1);
});

test('TDD integration: posted signed delivery is independently reconciled across ERP cash, invoice, stock and bottles before offline ACK replay',async t=>{
 const {auditCrossSystemDelivery}=require('../services/driver-finance-crosswalk-qa');
 const f=fixture();t.after(f.close);
 const d1=new DatabaseSync(':memory:');t.after(()=>d1.close());
 d1.exec([
  'CREATE TABLE deliveries(id INTEGER,company_id INTEGER,driver_id INTEGER,order_id INTEGER,status TEXT)',
  'CREATE TABLE driver_delivery_completions(delivery_id INTEGER,company_id INTEGER,driver_id INTEGER,amount REAL,returned_count INTEGER,empty_count INTEGER,proof_key TEXT)',
  'CREATE TABLE driver_delivery_evidence(delivery_id INTEGER,company_id INTEGER,driver_id INTEGER,signature_key TEXT,photo_key TEXT,latitude REAL,longitude REAL,accuracy_m REAL)'
 ].join(';')+';');
 const signedEvent=event(),src=signedEvent.source;
 d1.prepare('INSERT INTO deliveries VALUES(?,?,?,?,?)').run(
  src.deliveryId,src.companyId,src.driverId,src.orderId,'completed');
 d1.prepare('INSERT INTO driver_delivery_completions VALUES(?,?,?,?,?,?,?)').run(
  src.deliveryId,src.companyId,src.driverId,signedEvent.payment.amount,
  signedEvent.returnedCount,signedEvent.emptyCount,signedEvent.proof.signature.storageKey);
 d1.prepare('INSERT INTO driver_delivery_evidence VALUES(?,?,?,?,?,?,?,?)').run(
  src.deliveryId,src.companyId,src.driverId,signedEvent.proof.signature.storageKey,
  signedEvent.proof.photo.storageKey,signedEvent.proof.gps.latitude,
  signedEvent.proof.gps.longitude,signedEvent.proof.gps.accuracyMeters);
 const mapping={d1Company:1,d1Driver:11,d1Order:201,d1Delivery:301,
  erpCompany:40,erpDriver:41,erpOrder:701,erpDelivery:801};
 const before=auditCrossSystemDelivery({d1,erp:f.db,mapping});
 assert.equal(before.comparisonPassed,false,'ledger reconciliation cannot pass before ERP posting');
 assert.ok(before.issues.includes('ERP_DELIVERY_SCOPE_MISMATCH'));
 const signed=signBridgeEvent(secret,signedEvent);
 const posted=await f.service.post({event:signedEvent,signature:signed});
 assert.equal(posted.status,'applied');
 assert.equal(posted.companyId,mapping.erpCompany);
 assert.equal(posted.d1CompanyId,mapping.d1Company);
 const noMutationBefore=Number(f.db.prepare('SELECT total_changes() n').get().n);
 const matched=auditCrossSystemDelivery({d1,erp:f.db,mapping});
 assert.deepEqual(matched.issues,[],'all posted money, invoice, stock, bottle and evidence must reconcile');
 assert.equal(matched.comparisonPassed,true);
 assert.equal(matched.ready,false,'QA reconciliation never enables live financial posting');
 assert.equal(Number(f.db.prepare('SELECT total_changes() n').get().n),noMutationBefore);
 const replay=await f.service.post({event:signedEvent,signature:signed});
 assert.deepEqual(replay,posted,'lost ACK replay must return original finance receipt');
 const identical=auditCrossSystemDelivery({d1,erp:f.db,mapping});
 assert.equal(identical.comparisonPassed,true);
 assert.equal(f.count('payments'),1);
 assert.equal(f.count('stock_movements'),2);
 f.db.prepare("UPDATE stock_movements SET quantity=quantity+1 WHERE company_id=40 AND product_id=51").run();
 const damaged=auditCrossSystemDelivery({d1,erp:f.db,mapping});
 assert.ok(damaged.issues.includes('ERP_STOCK_LEDGER_QUANTITY_MISMATCH'));
 assert.equal(damaged.comparisonPassed,false);
 await assert.rejects(f.service.post({event:signedEvent,signature:signed}),
  /reconciliation|required|differs/i,'replay must never ACK altered ERP stock ledger');
 f.db.prepare("UPDATE stock_movements SET quantity=quantity-1 WHERE company_id=40 AND product_id=51").run();
 f.db.prepare("UPDATE delivery_bottle_counts SET returned_quantity=5 WHERE company_id=40 AND delivery_id=801").run();
 const wrongBottle=auditCrossSystemDelivery({d1,erp:f.db,mapping});
 assert.ok(wrongBottle.issues.includes('ERP_BOTTLE_LEDGER_MISMATCH'));
 await assert.rejects(f.service.post({event:signedEvent,signature:signed}),
  /reconciliation|required|differs/i,'replay must never ACK altered bottle ledger');
});

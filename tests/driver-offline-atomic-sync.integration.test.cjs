'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {completeDeliveryAsync,qaSchema}=require('../services/driver-atomic-ledger-qa');
const {createSqlite3AtomicAdapter}=require('../services/driver-atomic-sqlite3-adapter-qa');
const {createAtomicDriverDeliveryHandler}=require('../services/driver-atomic-erp-bridge-qa');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
class FakeSqlite3Database {
 constructor(filename,flags,callback){
  this.db=new DatabaseSync(filename);
  queueMicrotask(()=>callback(null));
 }
 exec(sql,callback){try{this.db.exec(sql);callback(null);}catch(e){callback(e);}}
 get(sql,args,callback){try{callback(null,this.db.prepare(sql).get(...args));}catch(e){callback(e);}}
 run(sql,args,callback){try{
   const result=this.db.prepare(sql).run(...args);
   callback.call({changes:Number(result.changes),lastID:Number(result.lastInsertRowid)},null);
 }catch(e){callback(e);}}
 close(callback){try{this.db.close();callback(null);}catch(e){callback(e);}}
}
const sqlite3Shim={Database:FakeSqlite3Database,OPEN_READWRITE:2};
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'temo-atomic-qa-'));
 const filename=path.join(dir,'synthetic-erp.db');
 const db=new DatabaseSync(filename);
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE companies(id INTEGER PRIMARY KEY);
 CREATE TABLE users(id INTEGER PRIMARY KEY,company_id INTEGER,role TEXT,active INTEGER);
 CREATE TABLE customers(id INTEGER PRIMARY KEY,company_id INTEGER);
 CREATE TABLE bottles(id INTEGER PRIMARY KEY,company_id INTEGER,active INTEGER);
 CREATE TABLE orders(id INTEGER PRIMARY KEY,company_id INTEGER,customer_id INTEGER,customer_name TEXT,status TEXT,updated_at TEXT);
 CREATE TABLE deliveries(id INTEGER PRIMARY KEY,company_id INTEGER,order_id INTEGER,driver_id INTEGER,status TEXT,updated_at TEXT,delivered_at TEXT,notes TEXT,collected_amount REAL,collected_method TEXT,collected_reference TEXT,bottle_return_count INTEGER,empty_count INTEGER);
 CREATE TABLE delivery_otp_challenges(id INTEGER PRIMARY KEY,company_id INTEGER,delivery_id INTEGER,code_hash TEXT,expires_at TEXT,attempts INTEGER DEFAULT 0,verified_at TEXT);
 CREATE TABLE delivery_proofs(company_id INTEGER,delivery_id INTEGER UNIQUE,otp_challenge_id INTEGER,otp_verified_at TEXT,signature_storage_key TEXT,signature_content_type TEXT,signature_byte_size INTEGER,signature_sha256 TEXT,photo_storage_key TEXT,photo_content_type TEXT,photo_byte_size INTEGER,photo_sha256 TEXT,captured_at TEXT,captured_by INTEGER);
 CREATE TABLE payments(id INTEGER PRIMARY KEY,company_id INTEGER,customer_name TEXT,amount REAL,method TEXT,note TEXT,direction TEXT,party_type TEXT,reference TEXT,created_by INTEGER,delivery_id INTEGER,order_id INTEGER,collected_by INTEGER);
 CREATE TABLE delivery_bottle_counts(id INTEGER PRIMARY KEY,company_id INTEGER,delivery_id INTEGER,bottle_id INTEGER,returned_quantity INTEGER,empty_quantity INTEGER,notes TEXT,created_by INTEGER);
 CREATE TABLE bottle_movements(id INTEGER PRIMARY KEY,company_id INTEGER,bottle_id INTEGER,customer_id INTEGER,movement_type TEXT,quantity INTEGER,reference TEXT,notes TEXT,created_by INTEGER);
 CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,company_id INTEGER,user_id INTEGER,action TEXT,entity_type TEXT,entity_id INTEGER,previous_value TEXT,new_value TEXT);
 INSERT INTO companies VALUES(1),(2);
 INSERT INTO users VALUES(11,1,'driver',1),(21,2,'driver',1),(31,1,'company_admin',1);
 INSERT INTO customers VALUES(41,1),(42,2);
 INSERT INTO bottles VALUES(51,1,1),(52,2,1);
 INSERT INTO orders VALUES(201,1,41,'Synthetic Customer','assigned','2026-10-25 01:00:00'),(202,2,42,'Foreign','assigned','2026-10-25 01:00:00');
 INSERT INTO deliveries(id,company_id,order_id,driver_id,status,updated_at) VALUES(301,1,201,11,'out_for_delivery','2026-10-25 01:00:00'),(302,2,202,21,'out_for_delivery','2026-10-25 01:00:00');
 `);
 for(const ddl of qaSchema)db.exec(ddl);
 const adapter=createSqlite3AtomicAdapter({sqlite3:sqlite3Shim,dbPath:filename});
 db.prepare('INSERT INTO delivery_otp_challenges(id,company_id,delivery_id,code_hash,expires_at) VALUES(?,?,?,?,?)')
   .run(71,1,301,hash('123456'),'2099-01-01 00:00:00');
 db.prepare('INSERT INTO driver_qa_verified_proofs(id,company_id,delivery_id,driver_id,kind,storage_key,sha256,content_type,byte_size) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(91,1,301,11,'signature','1/301/synthetic.png',hash('synthetic-image'),'image/png',124);
 const call=(body={},actor={id:11,companyId:1,role:'driver'})=>completeDeliveryAsync({db:adapter, actor, deliveryId:301,
    idempotencyKey:'delivery-301-v1', otpChallengeId:71, otpCode:'123456', signatureProofId:91,
    payment:{amount:125,method:'Cash'},bottleId:51,bottleReturnCount:2,emptyCount:3,
    baseUpdatedAt:'2026-10-25 01:00:00', ...body});
 const count=t=>db.prepare('SELECT COUNT(*) n FROM '+t).get().n;
 return {db,filename,call,count,close:()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})}};
}

const {createAtomicOfflineSyncHandler}=require('../services/driver-atomic-offline-sync-qa');
const signature={storageKey:'1/301/synthetic.png',sha256:hash('synthetic-image'),contentType:'image/png',byteSize:124};
function operation(override={}){
 return {idempotencyKey:'offline-301-accepted-01',operationType:'deliver',
 deliveryId:301,orderId:201,baseUpdatedAt:'2026-10-25 01:00:00',
 payload:{signature,otpChallengeId:71,otpCode:'123456',
 payment:{amount:125,method:'Cash'},bottleId:51,bottleReturnCount:2,emptyCount:3},...override};
}
function handler(f,enabled=true){
 const q=async(sql,args=[])=>f.db.prepare(sql).all(...args);
 return createAtomicOfflineSyncHandler({sqlite3:sqlite3Shim,dbPath:f.filename,query:q,qaEnabled:enabled});
}
async function submit(h,operations,who={id:11,role:'driver'},companyId=1){
 const res={code:200,status(n){this.code=n;return this;},json(d){this.data=d;return this;}};
 await h({user:who,companyId,body:{operations}},res);return res;
}
test('offline signed proof + OTP atomically post delivery/order/cash/bottles/proof/audit',async t=>{
 const f=fixture();t.after(f.close);
 const done=await submit(handler(f),[operation()]);
 assert.equal(done.code,200);
 assert.equal(done.data.results[0].status,'applied');
 assert.deepEqual(done.data.results[0].result,
 {id:301,order_id:201,company_id:1,status:'completed',success:true});
 for(const tab of ['payments','delivery_bottle_counts','bottle_movements','delivery_proofs','audit_logs','driver_atomic_delivery_receipts'])
   assert.equal(f.count(tab),1,tab);
 assert.equal(f.db.prepare('SELECT status FROM deliveries WHERE id=301').get().status,'delivered');
});
test('retry same offline idempotencyKey cannot duplicate cash or bottles',async t=>{
 const f=fixture();t.after(f.close);const h=handler(f);
 assert.equal((await submit(h,[operation()])).data.results[0].status,'applied');
 assert.equal((await submit(h,[operation()])).data.results[0].status,'applied');
 assert.equal(f.count('payments'),1);assert.equal(f.count('bottle_movements'),1);
});
test('same key and changed payment cannot silently replace original posting',async t=>{
 const f=fixture();t.after(f.close);const h=handler(f);
 await submit(h,[operation()]);
 const r=await submit(h,[operation({payload:{...operation().payload,payment:{amount:999,method:'Cash'}}})]);
 assert.equal(r.data.results[0].status,'conflict');
 assert.equal(f.count('payments'),1);
 assert.equal(f.db.prepare('SELECT amount FROM payments').get().amount,125);
});
test('wrong order or tenant fails before posting any monetary record',async t=>{
 const f=fixture();t.after(f.close);
 const h=handler(f);
 const wrongOrder=await submit(h,[operation({orderId:202})]);
 const foreign=await submit(h,[operation()],{id:21,role:'driver'},2);
 assert.equal(wrongOrder.data.results[0].status,'conflict');
 assert.equal(foreign.data.results[0].status,'conflict');
 assert.equal(f.count('payments'),0);assert.equal(f.count('delivery_proofs'),0);
});
test('server-registered proof required; queued raw base64 is preserved as conflict',async t=>{
 const f=fixture();t.after(f.close);const h=handler(f);
 const unregistered=await submit(h,[operation({payload:{...operation().payload,signature:undefined,signatureBase64:'ZmFrZQ=='}})]);
 assert.equal(unregistered.data.results[0].status,'conflict');
 assert.equal(unregistered.data.results[0].code,'verified_proof_required');
 assert.equal(f.count('payments'),0);
});
test('OTP missing/invalid cannot complete delivery or post payment',async t=>{
 const f=fixture();t.after(f.close);const h=handler(f);
 const missing=await submit(h,[operation({payload:{...operation().payload,otpCode:undefined}})]);
 const wrong=await submit(h,[operation({payload:{...operation().payload,otpCode:'999999'}})]);
 assert.equal(missing.data.results[0].status,'conflict');
 assert.equal(wrong.data.results[0].status,'conflict');
 assert.equal(f.count('payments'),0);assert.equal(f.count('delivery_proofs'),0);
});
test('forced payment failure rolls back OTP, cash, bottles, proof and delivery state',async t=>{
 const f=fixture();t.after(f.close);
 f.db.exec("CREATE TRIGGER deny_money BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT,'blocked'); END");
 const x=await submit(handler(f),[operation()]);
 assert.equal(x.data.results[0].status,'conflict');
 assert.equal(f.db.prepare('SELECT status FROM deliveries WHERE id=301').get().status,'out_for_delivery');
 assert.equal(f.db.prepare('SELECT verified_at FROM delivery_otp_challenges WHERE id=71').get().verified_at,null);
 for(const tab of ['payments','bottle_movements','delivery_proofs','audit_logs','driver_atomic_delivery_receipts'])assert.equal(f.count(tab),0,tab);
});
test('revoked role, unavailable QA and bad/unsupported batch never invoke ledger',async t=>{
 const f=fixture();t.after(f.close);
 const denied=await submit(handler(f),[operation()],{id:31,role:'company_admin'});
 const unavailable=await submit(handler(f,false),[operation()]);
 const unsupported=await submit(handler(f),[operation({operationType:'start'})]);
 const malformed=await submit(handler(f),[]);
 assert.equal(denied.code,403);assert.equal(unavailable.code,503);
 assert.equal(unsupported.data.results[0].status,'conflict');
 assert.equal(malformed.code,400);assert.equal(f.count('payments'),0);
});
test('atomic core validates queued order inside the write transaction',async t=>{
 const f=fixture();t.after(f.close);
 await assert.rejects(f.call({expectedOrderId:202}),/Queued order does not match/);
 assert.equal(f.count('payments'),0);
});

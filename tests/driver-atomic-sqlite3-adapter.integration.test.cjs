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
test('real SQLite file + dedicated transactional connection: one exact signed order/cash/bottle posting',async t=>{
 const f=fixture();t.after(f.close);
 const result=await f.call();
 assert.equal(result.status,'applied');
 assert.deepEqual(result.receipt,{id:301,order_id:201,company_id:1,status:'completed'});
 for(const table of ['payments','delivery_bottle_counts','bottle_movements','delivery_proofs','audit_logs','driver_atomic_delivery_receipts'])
   assert.equal(f.count(table),1,table);
 assert.equal(f.db.prepare('SELECT status FROM deliveries WHERE id=301').get().status,'delivered');
});
test('real SQLite adapter: idempotent retry returns same proof and never duplicates ledgers',async t=>{
 const f=fixture();t.after(f.close);
 assert.deepEqual(await f.call(),await f.call());
 assert.equal(f.count('payments'),1);
 assert.equal(f.count('bottle_movements'),1);
 await assert.rejects(f.call({payment:{amount:450,method:'Cash'}}),/idempotency key reused/);
 await assert.rejects(f.call({idempotencyKey:'other-retry'}),/already completed/);
});
test('real SQLite adapter: failed cash ledger fully rolls back delivery, OTP, proof and bottles',async t=>{
 const f=fixture();t.after(f.close);
 f.db.exec("CREATE TRIGGER deny_cash BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT,'payment unavailable'); END");
 await assert.rejects(f.call(),/payment unavailable/);
 assert.equal(f.db.prepare('SELECT status FROM deliveries WHERE id=301').get().status,'out_for_delivery');
 assert.equal(f.db.prepare('SELECT verified_at FROM delivery_otp_challenges WHERE id=71').get().verified_at,null);
 for(const table of ['payments','bottle_movements','delivery_proofs','audit_logs','driver_atomic_delivery_receipts'])
   assert.equal(f.count(table),0,table);
});
test('real SQLite adapter: tenant/driver/proof guards reject foreign mutations',async t=>{
 const f=fixture();t.after(f.close);
 await assert.rejects(f.call({actor:{id:21,companyId:2,role:'driver'}}),/Assigned delivery not found/);
 await assert.rejects(f.call({actor:{id:31,companyId:1,role:'company_admin'}}),/Driver authorization required/);
 await assert.rejects(f.call({signatureProofId:123456}),/signature required/);
 assert.equal(f.count('payments'),0);
});

test('native action bridge: verified proof, same tenant/driver OTP and atomic receipt',async t=>{
 const f=fixture();t.after(f.close);
 const sha=hash('synthetic-image');
 const query=async(sql,args=[])=>f.db.prepare(sql).all(...args);
 const handle=createAtomicDriverDeliveryHandler({sqlite3:sqlite3Shim,dbPath:f.filename,query,qaEnabled:true});
 const request={
   user:{id:11,role:'driver'},companyId:1,params:{id:'301'},
   body:{action:'deliver',signature:{storageKey:'1/301/synthetic.png',sha256:sha,
     contentType:'image/png',byteSize:124},otpChallengeId:71,otpCode:'123456',
     payment:{amount:125,method:'Cash'},bottleId:51,bottleReturnCount:2,emptyCount:3}
 };
 const reply=async()=>{const res={code:200,status(n){this.code=n;return this;},json(data){this.data=data;return this;}};
   await handle(request,res);return res;};
 const first=await reply();assert.equal(first.code,200,JSON.stringify(first.data));
 assert.deepEqual({id:first.data.id,order_id:first.data.order_id,company_id:first.data.company_id,status:first.data.status},
   {id:301,order_id:201,company_id:1,status:'completed'});
 const retry=await reply();assert.equal(retry.code,200);
 assert.equal(f.count('payments'),1);assert.equal(f.count('bottle_movements'),1);assert.equal(f.count('delivery_proofs'),1);
});
test('native action bridge: unregistered/forged proof and disabled QA never post money',async t=>{
 const f=fixture();t.after(f.close);
 const query=async(sql,args=[])=>f.db.prepare(sql).all(...args);
 const handle=createAtomicDriverDeliveryHandler({sqlite3:sqlite3Shim,dbPath:f.filename,query,qaEnabled:true});
 const request={user:{id:11,role:'driver'},companyId:1,params:{id:'301'},
   body:{signature:{storageKey:'1/301/forged.png',sha256:hash('forged'),contentType:'image/png',byteSize:124}}};
 let res={code:200,status(n){this.code=n;return this;},json(x){this.data=x;return this;}};
 await handle(request,res);assert.equal(res.code,400);
 assert.equal(f.count('payments'),0);
 const disabled=createAtomicDriverDeliveryHandler({sqlite3:sqlite3Shim,dbPath:f.filename,query,qaEnabled:false});
 res={code:200,status(n){this.code=n;return this;},json(x){this.data=x;return this;}};
 await disabled(request,res);assert.equal(res.code,503);
 assert.equal(f.count('payments'),0);
});

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
const {readQaOtpRequired,createDriverDeliveryPolicyRoutes}=require('../services/driver-delivery-policy-service');
const signature={storageKey:'1/301/synthetic.png',sha256:hash('synthetic-image'),contentType:'image/png',byteSize:124};
const operation=(overrides={})=>({
 idempotencyKey:'otp-off-301-retry01',operationType:'deliver',
 deliveryId:301,orderId:201,baseUpdatedAt:'2026-10-25 01:00:00',
 payload:{signature,payment:{amount:125,method:'Cash'},bottleId:51,bottleReturnCount:2,emptyCount:3},
 ...overrides
});
async function setup(){
 const f=fixture();
 f.db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';ALTER TABLE companies ADD COLUMN status TEXT DEFAULT 'active'");
 const query=async(sql,args=[])=>f.db.prepare(sql).all(...args);
 const update=async(sql,args=[])=>({changes:Number(f.db.prepare(sql).run(...args).changes)});
 const handlers={get:{},put:{}};
 const app={get(route,cb){handlers.get[route]=cb},put(route,cb){handlers.put[route]=cb}};
 createDriverDeliveryPolicyRoutes({app,query,update,qaEnabled:true});
 const atomic=createAtomicOfflineSyncHandler({sqlite3:sqlite3Shim,dbPath:f.filename,query,qaEnabled:true});
 const respond=()=>({code:200,status(x){this.code=x;return this;},json(x){this.data=x;return this;}});
 const set=async(value,actor={id:31,role:'company_admin'},tenant=1)=>{
  const res=respond();
  await handlers.put['/api/admin/driver-delivery-policy']({companyId:tenant,user:actor,body:{otpRequired:value}},res);
  return res;
 };
 const get=async(actor={id:11,role:'driver'},tenant=1)=>{
  const res=respond();
  await handlers.get['/api/driver/delivery-policy']({companyId:tenant,user:actor},res);
  return res;
 };
 const replay=async(op=operation(),actor={id:11,role:'driver'},tenant=1)=>{
  const res=respond();
  await atomic({companyId:tenant,user:actor,body:{operations:[op]}},res);
  return res;
 };
 return {f,query,set,get,replay};
}
test('TDD: OTP defaults ON, signature mandatory, normal driver cannot disable verification',async t=>{
 const c=await setup();t.after(c.f.close);
 assert.deepEqual((await c.get()).data,{otpRequired:true,signatureRequired:true});
 assert.equal((await c.set(false,{id:11,role:'driver'})).code,403);
 assert.equal(await readQaOtpRequired(c.query,1,true),true);
 assert.equal((await c.replay()).data.results[0].code,'customer_otp_required');
 assert.equal(c.f.count('payments'),0);
});
test('QA Company Admin: explicit same-tenant OTP OFF enables signed atomic offline cash/bottle transaction',async t=>{
 const c=await setup();t.after(c.f.close);
 const setting=await c.set(false);
 assert.equal(setting.code,200,JSON.stringify(setting.data));
 assert.deepEqual((await c.get()).data,{otpRequired:false,signatureRequired:true});
 const first=await c.replay();
 assert.equal(first.code,200);
 assert.deepEqual(first.data.results[0],{idempotencyKey:'otp-off-301-retry01',status:'applied',
 result:{id:301,order_id:201,company_id:1,status:'completed',success:true}});
 assert.equal(c.f.db.prepare('SELECT otp_challenge_id FROM delivery_proofs WHERE delivery_id=301').get().otp_challenge_id,null);
 assert.equal(c.f.db.prepare('SELECT verified_at FROM delivery_otp_challenges WHERE id=71').get().verified_at,null);
 assert.equal(c.f.db.prepare('SELECT status FROM orders WHERE id=201').get().status,'delivered');
 for(const table of ['payments','bottle_movements','delivery_bottle_counts','delivery_proofs','audit_logs','driver_atomic_delivery_receipts'])
   assert.equal(c.f.count(table),1,table);
 const retry=await c.replay();
 assert.equal(retry.data.results[0].status,'applied');
 assert.equal(c.f.count('payments'),1);
});
test('OTP OFF never permits missing or unregistered customer signature',async t=>{
 const c=await setup();t.after(c.f.close);
 assert.equal((await c.set(false)).code,200);
 const noProof=await c.replay(operation({payload:{payment:{amount:125,method:'Cash'}}}));
 assert.equal(noProof.data.results[0].status,'conflict');
 const forged=await c.replay(operation({payload:{signature:{...signature,storageKey:'1/301/forged.png'},payment:{amount:125,method:'Cash'}}}));
 assert.equal(forged.data.results[0].status,'conflict');
 assert.equal(c.f.count('payments'),0);
});
test('OTP OFF requires active company admin same tenant, cannot be set with malformed payload',async t=>{
 const c=await setup();t.after(c.f.close);
 assert.equal((await c.set(false,{id:21,role:'company_admin'},2)).code,403);
 c.f.db.exec('UPDATE users SET active=0 WHERE id=31');
 assert.equal((await c.set(false)).code,403);
 assert.equal(await readQaOtpRequired(c.query,1,true),true);
});
test('TDD: enabling OTP before transaction rejects stale OTP OFF replay',async t=>{
 const c=await setup();t.after(c.f.close);
 assert.equal((await c.set(false)).code,200);
 const q=async(sql,args=[])=>{
  const result=c.f.db.prepare(sql).all(...args);
  if(sql.includes('SELECT otp_required FROM driver_qa_company_verification_policy'))
    c.f.db.exec('UPDATE driver_qa_company_verification_policy SET otp_required=1 WHERE company_id=1');
  return result;
 };
 const atomic=createAtomicOfflineSyncHandler({sqlite3:sqlite3Shim,dbPath:c.f.filename,query:q,qaEnabled:true});
 const res={code:200,status(x){this.code=x;return this;},json(x){this.data=x;return this;}};
 await atomic({companyId:1,user:{id:11,role:'driver'},body:{operations:[operation()]}},res);
 assert.equal(res.data.results[0].status,'conflict');
 assert.equal(c.f.count('payments'),0);
 assert.equal(c.f.db.prepare('SELECT status FROM deliveries WHERE id=301').get().status,'out_for_delivery');
});
test('QA mode disabled rejects OTP OFF and default policy remains OTP ON',async t=>{
 const c=await setup();t.after(c.f.close);
 assert.equal((await c.set(false)).code,200);
 assert.equal(await readQaOtpRequired(c.query,1,false),true);
 const atomic=createAtomicOfflineSyncHandler({sqlite3:sqlite3Shim,dbPath:c.f.filename,query:c.query,qaEnabled:false});
 const res={code:200,status(x){this.code=x;return this;},json(x){this.data=x;return this;}};
 await atomic({companyId:1,user:{id:11,role:'driver'},body:{operations:[operation()]}},res);
 assert.equal(res.code,503);
 assert.equal(c.f.count('payments'),0);
});

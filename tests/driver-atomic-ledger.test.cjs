'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {completeDelivery,makeAtomicSqliteSession}=require('../services/driver-atomic-ledger-qa');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(){
 const db=new DatabaseSync(':memory:');
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
 const adapter=makeAtomicSqliteSession(db);
 db.prepare('INSERT INTO delivery_otp_challenges(id,company_id,delivery_id,code_hash,expires_at) VALUES(?,?,?,?,?)')
   .run(71,1,301,hash('123456'),'2099-01-01 00:00:00');
 db.prepare('INSERT INTO driver_qa_verified_proofs(id,company_id,delivery_id,driver_id,kind,storage_key,sha256,content_type,byte_size) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(91,1,301,11,'signature','1/301/synthetic.png',hash('synthetic-image'),'image/png',124);
 const call=(body={},actor={id:11,companyId:1,role:'driver'})=>completeDelivery({db:adapter, actor, deliveryId:301,
    idempotencyKey:'delivery-301-v1', otpChallengeId:71, otpCode:'123456', signatureProofId:91,
    payment:{amount:125,method:'Cash'},bottleId:51,bottleReturnCount:2,emptyCount:3,
    baseUpdatedAt:'2026-10-25 01:00:00', ...body});
 const count=t=>db.prepare('SELECT COUNT(*) n FROM '+t).get().n;
 return {db,call,count,close:()=>db.close()};
}
test('TDD: valid OTP+trusted signature posts delivery/payment/bottle/proof/audit atomically',t=>{
 const f=fixture();t.after(f.close);const result=f.call();
 assert.equal(result.status,'applied');
 assert.deepEqual(result.receipt,{id:301,order_id:201,company_id:1,status:'completed'});
 assert.equal(f.db.prepare('SELECT status FROM deliveries WHERE id=301').get().status,'delivered');
 assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=201').get().status,'delivered');
 for(const table of ['payments','delivery_bottle_counts','bottle_movements','delivery_proofs','driver_atomic_delivery_receipts'])assert.equal(f.count(table),1,table);
 assert.equal(f.count('audit_logs'),1);
 assert.equal(f.db.prepare('SELECT verified_at FROM delivery_otp_challenges WHERE id=71').get().verified_at!==null,true);
});
test('TDD: same idempotency key retries return prior receipt without reposting money/bottles',t=>{
 const f=fixture();t.after(f.close);const a=f.call(),b=f.call();assert.deepEqual(a,b);
 assert.equal(f.count('payments'),1);assert.equal(f.count('bottle_movements'),1);assert.equal(f.count('delivery_proofs'),1);
});
test('TDD: changed payload under same key fails, different key cannot double complete',t=>{
 const f=fixture();t.after(f.close);f.call();
 assert.throws(()=>f.call({payment:{amount:400,method:'Cash'}}),/idempotency key reused/);
 assert.throws(()=>f.call({idempotencyKey:'other-key'}),/already completed/);
 assert.equal(f.count('payments'),1);assert.equal(f.count('bottle_movements'),1);
});
test('TDD: forced cash ledger SQL failure rolls back OTP, delivery, order, proof, bottle and idempotency',t=>{
 const f=fixture();t.after(f.close);
 f.db.exec("CREATE TRIGGER cash_failure BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT,'cash insert failed'); END");
 assert.throws(()=>f.call(),/cash insert failed/);
 for(const name of ['payments','delivery_proofs','bottle_movements','driver_atomic_delivery_receipts','audit_logs'])assert.equal(f.count(name),0,name);
 assert.equal(f.db.prepare('SELECT status FROM deliveries WHERE id=301').get().status,'out_for_delivery');
 assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=201').get().status,'assigned');
 assert.equal(f.db.prepare('SELECT verified_at FROM delivery_otp_challenges WHERE id=71').get().verified_at,null);
});
test('TDD: cross-tenant role and assignment mismatches reject without payment',t=>{
 const f=fixture();t.after(f.close);
 for(const user of [{id:21,companyId:2,role:'driver'},{id:31,companyId:1,role:'company_admin'}, {id:11,companyId:2,role:'driver'}])assert.throws(()=>f.call({},user));
 assert.equal(f.count('payments'),0);assert.equal(f.count('delivery_proofs'),0);
});
test('TDD: wrong/expired OTP blocks ledger and keeps challenge attempts fail-closed',t=>{
 const f=fixture();t.after(f.close);
 assert.throws(()=>f.call({otpCode:'000000'}),/OTP/);
 assert.equal(f.count('payments'),0);
 f.db.prepare('UPDATE delivery_otp_challenges SET expires_at=? WHERE id=71').run('2000-01-01 00:00:00');
 assert.throws(()=>f.call(),/OTP/);
 assert.equal(f.count('delivery_proofs'),0);
});
test('TDD: forged signature, missing signature and foreign bottle are denied',t=>{
 const f=fixture();t.after(f.close);
 for(const opts of [{signatureProofId:999},{signatureProofId:null},{bottleId:52},{payment:{amount:-2,method:'Cash'}},{bottleReturnCount:-1}])assert.throws(()=>f.call(opts));
 assert.equal(f.count('payments'),0);assert.equal(f.count('bottle_movements'),0);
});
test('TDD: stale baseUpdatedAt must not post or consume OTP',t=>{
 const f=fixture();t.after(f.close);
 assert.throws(()=>f.call({baseUpdatedAt:'2026-10-24 00:00:00'}),/stale/);
 assert.equal(f.count('payments'),0);
 assert.equal(f.db.prepare('SELECT verified_at FROM delivery_otp_challenges WHERE id=71').get().verified_at,null);
});

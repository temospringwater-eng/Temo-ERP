'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const crypto=require('node:crypto');
const {createDriverCustomerOtpProvider}=require('../services/driver-customer-otp-provider');
function setup({sendStatus='sent'}={}){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE customers(id INTEGER PRIMARY KEY,company_id INTEGER,email TEXT);
 CREATE TABLE orders(id INTEGER PRIMARY KEY,company_id INTEGER,customer_id INTEGER);
 CREATE TABLE deliveries(id INTEGER PRIMARY KEY,company_id INTEGER,order_id INTEGER,driver_id INTEGER,status TEXT);
 CREATE TABLE delivery_otp_challenges(id INTEGER PRIMARY KEY,company_id INTEGER,delivery_id INTEGER,customer_id INTEGER,
 code_hash TEXT,expires_at TEXT,created_by INTEGER,attempts INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 INSERT INTO customers VALUES(51,1,'client@example.net'),(52,2,'other@example.net');
 INSERT INTO orders VALUES(201,1,51),(202,2,52);
 INSERT INTO deliveries VALUES(301,1,201,11,'assigned'),(302,2,202,21,'assigned');`);
 const sent=[],audits=[];
 const query=async(sql,args=[])=>db.prepare(sql).all(...args);
 const insert=async(sql,args=[])=>({id:Number(db.prepare(sql).run(...args).lastInsertRowid)});
 const sendEmail=async info=>{sent.push(info);return {status:sendStatus};};
 const writeAudit=async(...args)=>{audits.push(args);};
 const issue=createDriverCustomerOtpProvider({query,insert,sendEmail,writeAudit,randomCode:()=> '123456'});
 const call=options=>issue({companyId:1,deliveryId:301,driverId:11,actorId:11,req:{companyId:1,user:{id:11}},...options});
 return{db,sent,audits,call,issue,close:()=>db.close()};
}
test('SMTP success issues tenant-scoped hashed customer OTP and never exposes code',async t=>{
 const f=setup();t.after(f.close);const res=await f.call();
 assert.deepEqual(res,{challengeId:1,expiresInSeconds:600,maskedDestination:'c***@example.net'});
 assert.ok(!JSON.stringify(res).includes('123456'));
 assert.equal(f.sent.length,1);
 assert.equal(f.sent[0].recipient,'client@example.net');
 assert.equal(f.sent[0].message.includes('123456'),true);
 const saved=f.db.prepare('SELECT * FROM delivery_otp_challenges').get();
 assert.equal(saved.code_hash,crypto.createHash('sha256').update('123456').digest('hex'));
 assert.equal(saved.company_id,1);assert.equal(saved.created_by,11);
 assert.equal(f.audits.length,1);
});
test('provider skipped or failed means no challenge and no false success',async t=>{
 for(const sendStatus of ['skipped','failed']){
  const f=setup({sendStatus});t.after(f.close);
  await assert.rejects(f.call(),e=>e.status===503);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM delivery_otp_challenges').get().n,0);
 }
});
test('driver and customer access must be same tenant, same assigned delivery',async t=>{
 const f=setup();t.after(f.close);
 await assert.rejects(f.call({driverId:21}),e=>e.status===404);
 await assert.rejects(f.call({companyId:2}),e=>e.status===404);
 await assert.rejects(f.call({driverId:null,customerId:52}),e=>e.status===404);
 const r=await f.call({driverId:null,customerId:51,actorId:51});
 assert.equal(r.challengeId,1);
 assert.equal(f.sent.length,1);
});
test('more than 3 requests per hour rejected before email',async t=>{
 const f=setup();t.after(f.close);
 await f.call();await f.call();await f.call();
 await assert.rejects(f.call(),e=>e.status===429);
 assert.equal(f.sent.length,3);
});
test('unverified or missing customer email fails closed',async t=>{
 const f=setup();t.after(f.close);
 f.db.exec("UPDATE customers SET email='' WHERE id=51");
 await assert.rejects(f.call(),e=>e.status===503);
 assert.equal(f.sent.length,0);
});
test('closed delivery cannot request another customer OTP',async t=>{
 const f=setup();t.after(f.close);
 f.db.exec("UPDATE deliveries SET status='delivered' WHERE id=301");
 await assert.rejects(f.call(),e=>e.status===409);
 assert.equal(f.sent.length,0);
});

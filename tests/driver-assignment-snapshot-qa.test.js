'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {buildQaDriverAssignmentSnapshot}=require('../services/driver-assignment-snapshot-qa');

function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`
 CREATE TABLE companies(id INTEGER PRIMARY KEY,active INTEGER);
 CREATE TABLE users(id INTEGER PRIMARY KEY,company_id INTEGER,role TEXT,active INTEGER);
 CREATE TABLE customers(id INTEGER PRIMARY KEY,company_id INTEGER,phone TEXT);
 CREATE TABLE orders(id INTEGER PRIMARY KEY,company_id INTEGER,customer_id INTEGER,customer_name TEXT,delivery_address TEXT,total_amount REAL);
 CREATE TABLE deliveries(id INTEGER PRIMARY KEY,company_id INTEGER,order_id INTEGER,driver_id INTEGER,status TEXT,scheduled_date TEXT,created_at TEXT);
 INSERT INTO companies VALUES(11,1),(12,1);
 INSERT INTO users VALUES(51,11,'driver',1),(52,12,'driver',1),(99,11,'company_admin',1);
 INSERT INTO customers VALUES(61,11,'000'),(62,12,'999');
 INSERT INTO orders VALUES(71,11,61,'Synthetic Driver Customer','QA Street A',450),(72,12,62,'Other Tenant','QA Street B',900);
 INSERT INTO deliveries VALUES(81,11,71,51,'assigned','2026-10-27','2026-10-27'),(82,12,72,52,'assigned','2026-10-27','2026-10-27');
 `);
 const query=async(sql,args)=>db.prepare(sql).all(...args);
 const params={query,dbPath:'/tmp/driver-synthetic-qa.db',qaEnabled:true,nodeEnv:'test',
  secret:'signed-isolated-qa-key-never-for-production-12345678',
  erpCompanyId:11,erpDriverId:51,d1CompanyId:1,d1DriverId:3,date:'2026-10-27',sequence:1};
 return {db,params,close:()=>db.close()};
}
test('TDD: central ERP exports only its active assigned driver and company, with signed D1 scope',async t=>{
 const f=fixture();t.after(f.close);
 const {snapshot,signature}=await buildQaDriverAssignmentSnapshot(f.params);
 assert.equal(snapshot.version,1);
 assert.deepEqual(snapshot.company,{erpId:11,d1Id:1});
 assert.deepEqual(snapshot.driver,{erpId:51,d1Id:3});
 assert.equal(snapshot.rows.length,1);
 assert.deepEqual(snapshot.rows[0],{deliveryId:81,orderId:71,customerName:'Synthetic Driver Customer',phone:'000',address:'QA Street A',totalAmount:450,status:'assigned',scheduledDate:'2026-10-27'});
 const expected=crypto.createHmac('sha256',f.params.secret).update(JSON.stringify(snapshot)).digest('hex');
 assert.equal(signature,expected);
 assert.ok(!JSON.stringify(snapshot).includes('Other Tenant'));
});
test('TDD: foreign tenant, admin or inactive driver never exports private assignments',async t=>{
 const f=fixture();t.after(f.close);
 await assert.rejects(buildQaDriverAssignmentSnapshot({...f.params,erpCompanyId:12}),/driver|company|active/i);
 await assert.rejects(buildQaDriverAssignmentSnapshot({...f.params,erpDriverId:99}),/driver|company|active/i);
 f.db.exec('UPDATE users SET active=0 WHERE id=51');
 await assert.rejects(buildQaDriverAssignmentSnapshot(f.params),/driver|company|active/i);
});
test('TDD: fail closed for normal/live DB or weak HMAC secret',async t=>{
 const f=fixture();t.after(f.close);
 await assert.rejects(buildQaDriverAssignmentSnapshot({...f.params,nodeEnv:'production'}),/QA|disabled/i);
 await assert.rejects(buildQaDriverAssignmentSnapshot({...f.params,dbPath:'hayrila.db'}),/QA|disabled/i);
 await assert.rejects(buildQaDriverAssignmentSnapshot({...f.params,qaEnabled:false}),/QA|disabled/i);
 await assert.rejects(buildQaDriverAssignmentSnapshot({...f.params,secret:'short'}),/secret|HMAC/i);
});

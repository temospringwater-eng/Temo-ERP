import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readErpD1QaCoreAliases} from '../services/erp-d1-read-alias-qa.mjs';

const token='signed-QA-token-local-only';
function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 sqlite.exec(
  'CREATE TABLE companies(id INTEGER PRIMARY KEY,is_active INTEGER NOT NULL);'+
  'CREATE TABLE users(id INTEGER PRIMARY KEY,company_id INTEGER,role TEXT,is_active INTEGER);'+
  'CREATE TABLE payments(id INTEGER PRIMARY KEY,company_id INTEGER,delivery_id INTEGER,amount REAL,payment_method TEXT,status TEXT);'+
  "INSERT INTO companies VALUES(1,1),(2,1),(3,0);"+
  "INSERT INTO users VALUES(10,1,'company_admin',1),(20,2,'company_admin',1),"+
   "(30,1,'driver',1),(40,1,'company_admin',0),(50,3,'company_admin',1);"+
  "INSERT INTO payments VALUES(101,1,501,100.5,'cash','completed'),"+
   "(201,2,601,900,'transfer','completed'),(301,1,502,0,'other','pending');");
 const queries=[];
 const db={prepare(sql){
  queries.push(sql);
  assert.match(sql,/^SELECT /);
  assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b/i);
  return{bind(...a){return{first:async()=>sqlite.prepare(sql).get(...a)??null}}};
 }};
 const env={TEMO_ERP_D1_ENV:'isolated-qa',TEMO_ERP_D1_QA_READONLY:'1',DB:db};
 const verifyJwt=async value=>value===token?{userId:10,companyId:2,role:'super_admin'}:null;
 const input={env,token,verifyJwt,paymentId:101,deliveryId:501};
 return {sqlite,queries,env,input};
}
test('TDD QA D1 read aliases companies.is_active→active, users.is_active→active and payments.payment_method→method with real scoped SQLite',async t=>{
 const f=fixture(t);
 const r=await readErpD1QaCoreAliases(f.input);
 assert.deepEqual(r,{qaOnly:true,readOnly:true,readyForFinancePosting:false,
  company:{id:1,active:1},user:{id:10,companyId:1,role:'company_admin',active:1},
  payment:{id:101,companyId:1,deliveryId:501,amount:100.5,method:'cash',status:'completed'}});
 assert.equal(f.queries.length,3);
 assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,11);
});
test('TDD forged JWT company/role ignored; company scope derives from active D1 user',async t=>{
 const f=fixture(t);
 const r=await readErpD1QaCoreAliases({...f.input,verifyJwt:async()=>({userId:20,companyId:1,role:'company_admin'})});
 assert.equal(r.company.id,2);
 assert.equal(r.user.companyId,2);
 assert.equal(r.payment,null);
 assert.equal(r.readyForFinancePosting,false);
});
test('TDD driver, revoked user, inactive tenant and missing JWT may NOT access private finance aliases',async t=>{
 const f=fixture(t);
 for(const id of [30,40,50]){
  await assert.rejects(readErpD1QaCoreAliases({...f.input,verifyJwt:async()=>({userId:id})}),/STOP/);
 }
 await assert.rejects(readErpD1QaCoreAliases({...f.input,token:'bad'}),/STOP/);
 await assert.rejects(readErpD1QaCoreAliases({...f.input,token:undefined}),/STOP/);
});
test('TDD wrong delivery and wrong payment IDs cannot read another company or delivery',async t=>{
 const f=fixture(t);
 assert.equal((await readErpD1QaCoreAliases({...f.input,paymentId:201,deliveryId:601})).payment,null);
 assert.equal((await readErpD1QaCoreAliases({...f.input,paymentId:101,deliveryId:601})).payment,null);
 await assert.rejects(readErpD1QaCoreAliases({...f.input,deliveryId:0}),/STOP/);
});
test('TDD production or missing QA binding disabled before SQL and secrets never logged',async t=>{
 const f=fixture(t);
 for(const altered of [{TEMO_ERP_D1_ENV:'production'}, {TEMO_ERP_D1_QA_READONLY:'0'}, {DB:null}]){
  await assert.rejects(readErpD1QaCoreAliases({...f.input,env:{...f.env,...altered}}),/STOP/);
 }
 assert.equal(f.queries.length,0);
});
test('TDD never infer missing cash collection or inventory from read aliases and deny invalid payment fields',async t=>{
 const f=fixture(t);
 const r=await readErpD1QaCoreAliases(f.input);
 assert.equal('collectedAmount' in r,false);
 assert.equal('stock' in r,false);
 assert.equal(r.readyForFinancePosting,false);
 f.sqlite.exec("UPDATE payments SET amount=-5 WHERE id=101");
 await assert.rejects(readErpD1QaCoreAliases(f.input),/STOP/);
 f.sqlite.exec("UPDATE payments SET amount=5,payment_method='unknown' WHERE id=101");
 await assert.rejects(readErpD1QaCoreAliases(f.input),/STOP/);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
async function load(){return import('../worker/erp-d1-admin-summary-qa.mjs');}
function fixture(t){
 const sqlite=new DatabaseSync(':memory:');
 t.after(()=>sqlite.close());
 sqlite.exec("CREATE TABLE companies(id INTEGER PRIMARY KEY,is_active INTEGER);CREATE TABLE users(id INTEGER PRIMARY KEY,company_id INTEGER,role TEXT,is_active INTEGER);CREATE TABLE customers(id INTEGER PRIMARY KEY,company_id INTEGER);CREATE TABLE orders(id INTEGER PRIMARY KEY,company_id INTEGER,status TEXT);CREATE TABLE deliveries(id INTEGER PRIMARY KEY,company_id INTEGER);");
 sqlite.exec("INSERT INTO companies VALUES(1,1),(2,1),(3,0);INSERT INTO users VALUES(10,1,'company_admin',1),(20,2,'company_admin',1),(30,1,'driver',1),(40,3,'company_admin',1),(50,1,'company_admin',0);INSERT INTO customers VALUES(101,1),(102,1),(201,2);INSERT INTO orders VALUES(301,1,'pending'),(302,1,'delivered'),(303,2,'assigned');INSERT INTO deliveries VALUES(401,1),(402,2),(403,2)");
 let queries=[];
 const DB={prepare(sql){queries.push(sql);assert.match(sql,/^\s*SELECT\b/);return{bind(...params){return{async first(){return sqlite.prepare(sql).get(...params)||null}}}}}};
 const env={TEMO_ERP_D1_QA_READONLY:'1',TEMO_ERP_D1_ENV:'isolated-qa',DB};
 const auth=userId=>async token=>token==='synthetic-qa-token'?{userId}:null;
 const request=(method='GET',query='')=>new Request('https://qa.example.test/api/erp/qa/summary'+query,{method,headers:{Authorization:'Bearer synthetic-qa-token'}});
 return {env,auth,request,queries};
}
test('TDD: Company Admin gets D1 aggregate summary only for own authorized company',async t=>{
 const {handleErpQaAdminSummary}=await load();
 const f=fixture(t);
 const response=await handleErpQaAdminSummary(f.request(),f.env,f.auth(10));
 assert.equal(response.status,200);
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.deepEqual(await response.json(),{companyId:1,customers:2,pendingOrders:1,deliveries:1});
 assert.ok(f.queries.every(sql=>!/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH)\b/i.test(sql)));
});
test('TDD: forged claim companyId and role are ignored; DB role & tenant authority only',async t=>{
 const {handleErpQaAdminSummary}=await load();const f=fixture(t);
 const res=await handleErpQaAdminSummary(f.request(),f.env,async()=>({userId:20,companyId:1,role:'super_admin'}));
 assert.equal(res.status,200);assert.deepEqual(await res.json(),{companyId:2,customers:1,pendingOrders:1,deliveries:2});
});
test('TDD: driver, disabled user, and inactive company may not inspect ERP summary',async t=>{
 const {handleErpQaAdminSummary}=await load();const f=fixture(t);
 for(const id of [30,40,50]){
  const response=await handleErpQaAdminSummary(f.request(),f.env,f.auth(id));
  assert.equal(response.status,403);
 }
});
test('TDD: missing/invalid Bearer and failed JWT verification deny before queries',async t=>{
 const {handleErpQaAdminSummary}=await load();const f=fixture(t);
 const a=await handleErpQaAdminSummary(new Request('https://qa.example.test/api/erp/qa/summary'),f.env,f.auth(10));
 const b=await handleErpQaAdminSummary(f.request(),f.env,async()=>{throw Error('invalid signature')});
 assert.equal(a.status,401);assert.equal(b.status,401);
 assert.equal(f.queries.length,0);
});
test('TDD: no accidental exposed route in production or missing D1 Worker binding',async t=>{
 const {handleErpQaAdminSummary}=await load();const f=fixture(t);
 for(const override of [{TEMO_ERP_D1_QA_READONLY:'0'},{TEMO_ERP_D1_ENV:'production'},{DB:undefined}]){
  const res=await handleErpQaAdminSummary(f.request(),{...f.env,...override},f.auth(10));
  assert.equal(res.status,404);
 }
 assert.equal(f.queries.length,0);
});
test('TDD: reject unauthorized query filters, wrong method and unrelated routes',async t=>{
 const {handleErpQaAdminSummary}=await load();const f=fixture(t);
 assert.equal((await handleErpQaAdminSummary(f.request('GET','?company_id=2'),f.env,f.auth(10))).status,400);
 assert.equal((await handleErpQaAdminSummary(f.request('POST'),f.env,f.auth(10))).status,405);
 assert.equal(await handleErpQaAdminSummary(new Request('https://qa.example.test/api/login'),f.env,f.auth(10)),null);
 assert.equal(f.queries.length,0);
});
test('TDD: DB error fails closed and never leaks SQL/customer data',async t=>{
 const {handleErpQaAdminSummary}=await load();const f=fixture(t);
 const res=await handleErpQaAdminSummary(f.request(),{...f.env,DB:{prepare(){throw Error('SELECT * FROM users sensitive material')}}},f.auth(10));
 assert.equal(res.status,503);
 assert.doesNotMatch(await res.text(),/sensitive|SELECT|users/);
});

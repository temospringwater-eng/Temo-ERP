import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {extractPinnedErpBaseDdl,createDisposableErpSchema} from '../services/d1-erp-full-schema-preflight.mjs';
import ERP_STAGE1_WORKER from '../worker/erp-d1-stage1-qa.mjs';

const secret='synthetic-local-only-d1-diagnostic-key-32bytes';
const url='https://qa.local.test/internal/qa/erp-d1-readiness';
const req=(key=secret,method='GET',path=url)=>new Request(path,
 {method,headers:key?{'x-temo-qa-token':key}:{}});
function fixture(t,{full=false}={}){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 if(full){
  const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
  createDisposableErpSchema(sql,extractPinnedErpBaseDdl(source));
  sql.exec('CREATE TABLE driver_finance_outbox(company_id INTEGER NOT NULL,delivery_id INTEGER NOT NULL,PRIMARY KEY(company_id,delivery_id))');
  for(const [table,needed] of Object.entries({
   customers:['company_id'],products:['company_id'],payments:['company_id','delivery_id']
  })){
   const cols=new Set(sql.prepare("PRAGMA table_info('"+table+"')").all().map(x=>x.name));
   for(const col of needed)if(!cols.has(col))
    sql.exec('ALTER TABLE '+table+' ADD COLUMN '+col+' INTEGER');
  }
 }else{
  sql.exec('CREATE TABLE companies(id INTEGER PRIMARY KEY,active INTEGER)');
  sql.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,company_id INTEGER,role TEXT,active INTEGER)');
 }
 const statements=[];
 const DB={prepare(statement){
  statements.push(statement);
  assert.ok(statement.startsWith('SELECT ')||statement.startsWith("PRAGMA table_info('"),
   'D1 worker cannot mutate private SQL: '+statement.slice(0,80));
  return {async all(){return{success:true,results:sql.prepare(statement).all()}}};
 }};
 const env={DB,TEMO_ERP_D1_QA_MODE:'1',TEMO_ERP_QA_DIAGNOSTIC_SECRET:secret};
 return {env,sql,statements};
}
test('TDD worker QA entrypoint blocks unrelated/public routes and production environment',async t=>{
 const f=fixture(t);
 const unrelated=await ERP_STAGE1_WORKER.fetch(req(secret,'GET','https://qa.local.test/api/orders'),f.env);
 assert.equal(unrelated.status,404);
 const prod=await ERP_STAGE1_WORKER.fetch(req(),{...f.env,TEMO_ERP_D1_QA_MODE:'0'});
 assert.equal(prod.status,404);
 assert.deepEqual(f.statements,[]);
});
test('TDD QA-only Worker requires independent diagnostic token, rejects POST before any D1 access',async t=>{
 const f=fixture(t);
 for(const key of [null,'wrong-key']){
  const r=await ERP_STAGE1_WORKER.fetch(req(key),f.env);
  assert.equal(r.status,401);
 }
 assert.equal((await ERP_STAGE1_WORKER.fetch(req(secret,'POST'),f.env)).status,405);
 assert.deepEqual(f.statements,[]);
});
test('TDD real 2-table D1 cannot spoof canonical ERP readiness or turn on financial posting',async t=>{
 const f=fixture(t);
 const res=await ERP_STAGE1_WORKER.fetch(req(),f.env);
 assert.equal(res.status,200);
 const body=await res.json();
 assert.equal(body.qaOnly,true);
 assert.equal(body.canonicalSchemaReady,false);
 assert.equal(body.financeCutoverAllowed,false);
 assert.ok(body.missingTables.length>100);
 assert.ok(f.statements.length>=1);
});
test('TDD isolated 114-table ERP plus runtime-owned columns clears schema only; never enables customer finance writes',async t=>{
 const f=fixture(t,{full:true});
 const before=f.sql.prepare('SELECT total_changes() AS n').get().n;
 const res=await ERP_STAGE1_WORKER.fetch(req(),f.env);
 assert.equal(res.status,200);
 const body=await res.json();
 assert.equal(body.canonicalSchemaReady,true);
 assert.equal(body.baseSchemaNameAndColumnReady,true);
 assert.equal(body.coreSchemaReady,true);
 assert.equal(body.expectedErpBaseTables,114);
 assert.deepEqual(body.baseColumnGaps,[]);
 assert.deepEqual(body.criticalColumnGaps,[]);
 assert.equal(body.financeCutoverAllowed,false);
 assert.equal(body.productionReady,false);
 assert.equal(f.sql.prepare('SELECT total_changes() AS n').get().n,before);
 assert.ok(f.statements.every(s=>/^SELECT |^PRAGMA table_info\('/.test(s)));
});

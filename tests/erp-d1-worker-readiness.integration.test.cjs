'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createErpD1QaReadinessHandler,ERP_D1_CORE_TABLES}=require('../services/erp-d1-worker-readiness-qa.mjs');
const secret='private-qa-diagnostic-only-secret-32bytes';
const url='https://internal-erp-qa.example.test/internal/qa/erp-d1-readiness';
const req=(token=secret,method='GET')=>new Request(url,{method,headers:token?{'x-temo-qa-token':token}:{}});
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON');
 const audit=[];
 const db={prepare(sql){audit.push(sql);return{async all(){return{results:sqlite.prepare(sql).all()}}}}};
 const env={DB:db,TEMO_ERP_D1_QA_MODE:'1',TEMO_ERP_QA_DIAGNOSTIC_SECRET:secret};
 return{sqlite,db,env,audit,close(){sqlite.close()}};
}
test('TDD Worker QA health never runs against production or unauthorized callers',async t=>{
 const f=fixture();t.after(f.close);
 const handler=createErpD1QaReadinessHandler();
 assert.equal((await handler(req(),{...f.env,TEMO_ERP_D1_QA_MODE:'0'})).status,404);
 assert.equal((await handler(req('wrong'),f.env)).status,401);
 assert.equal((await handler(req(null),f.env)).status,401);
 assert.equal((await handler(req(secret,'POST'),f.env)).status,405);
 assert.deepEqual(f.audit,[]);
});
test('TDD Cloudflare Worker D1 QA introspection with real SQLite reads schema ONLY',async t=>{
 const f=fixture();t.after(f.close);
 for(const name of ERP_D1_CORE_TABLES)
  f.sqlite.exec('CREATE TABLE '+name+'(id INTEGER PRIMARY KEY,company_id INTEGER)');
 const answer=await createErpD1QaReadinessHandler()(req(),f.env);
 assert.equal(answer.status,200);
 const body=await answer.json();
 assert.equal(body.canonicalSchemaReady,true);
 assert.equal(body.tableCount,ERP_D1_CORE_TABLES.length);
 assert.equal(body.qaOnly,true);
 assert.equal(answer.headers.get('cache-control'),'no-store');
 assert.equal(f.audit.length,1);
 assert.match(f.audit[0],/^SELECT name FROM sqlite_master/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM '+ERP_D1_CORE_TABLES[0]).get().n,0);
});
test('TDD missing central ERP D1 finance tables are reported without writing defaults',async t=>{
 const f=fixture();t.after(f.close);
 f.sqlite.exec('CREATE TABLE companies(id INTEGER PRIMARY KEY)');
 const result=await createErpD1QaReadinessHandler()(req(),f.env);
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.canonicalSchemaReady,false);
 assert.ok(data.missingTables.includes('credit_ledger'));
 assert.ok(data.missingTables.includes('bottle_movements'));
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n,1);
});
test('TDD missing D1 binding, short secrets or broken D1 fail closed and reveal no internals',async t=>{
 const f=fixture();t.after(f.close);
 const handler=createErpD1QaReadinessHandler();
 assert.equal((await handler(req(),{...f.env,DB:null})).status,503);
 assert.equal((await handler(req(),{...f.env,TEMO_ERP_QA_DIAGNOSTIC_SECRET:'short'})).status,404);
 const resp=await handler(req(),{...f.env,DB:{prepare(){throw Error('sensitive internal SQL data')}}});
 assert.equal(resp.status,503);
 assert.doesNotMatch(await resp.text(),/sensitive|SQL/);
});

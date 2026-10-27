import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker from '../worker/erp-d1-qa-readiness-worker.mjs';
const SECRET='test-only-d1-qa-worker-diagnostic-secret-987654';
function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 sqlite.exec('CREATE TABLE companies(id INTEGER PRIMARY KEY,name TEXT)');
 const calls=[];
 const DB={prepare(sql){calls.push(sql);assert.match(sql,/^SELECT |^PRAGMA (?:table_info|foreign_key_list|index_list|index_info)\('/);return{
  all:async()=>({results:sqlite.prepare(sql).all()})
 }}};
 const env={TEMO_ERP_D1_QA_MODE:'1',TEMO_ERP_QA_DIAGNOSTIC_SECRET:SECRET,DB};
 const req=(path='/internal/qa/erp-d1-readiness',token=SECRET,method='GET')=>
  new Request('http://localhost'+path,{method,headers:token?{'x-temo-qa-token':token}:{}});
 return{env,calls,req};
}
test('TDD direct Cloudflare Worker entrypoint is private, read-only, returns 114 ERP gaps on isolated database',async t=>{
 const f=fixture(t);
 const res=await worker.fetch(f.req(),f.env),body=await res.json();
 assert.equal(res.status,200);
 assert.equal(body.qaOnly,true);
 assert.equal(body.tableCount,1);
 assert.equal(body.expectedErpBaseTables,114);
 assert.equal(body.canonicalSchemaReady,false);
 assert.equal(body.financeCutoverAllowed,false);
 assert.ok(body.missingTables.length>100);
 assert.ok(f.calls.every(sql=>/^SELECT |^PRAGMA /.test(sql)));
});
test('TDD Worker rejects wrong secret, non-GET, unrelated routes, or production mode before metadata query',async t=>{
 const f=fixture(t);
 assert.equal((await worker.fetch(f.req('/unrelated'),f.env)).status,404);
 assert.equal((await worker.fetch(f.req(undefined,'bad'),f.env)).status,401);
 assert.equal((await worker.fetch(f.req(undefined,SECRET,'POST'),f.env)).status,405);
 assert.equal((await worker.fetch(f.req(undefined,SECRET,'GET'),{...f.env,TEMO_ERP_D1_QA_MODE:'0'})).status,404);
 assert.equal((await worker.fetch(f.req(undefined,SECRET,'GET'),{...f.env,DB:null})).status,503);
 assert.deepEqual(f.calls,[]);
});
test('TDD invalid methods and private malformed URLs never reach ERP finance APIs',async t=>{
 const f=fixture(t);
 assert.equal((await worker.fetch(f.req('/api/erp/qa/summary'),f.env)).status,404);
 assert.equal((await worker.fetch(f.req('/api/driver/deliveries'),f.env)).status,404);
 assert.equal((await worker.fetch(f.req('/internal/qa/erp-d1-readiness?company_id=1'),f.env)).status,404);
 assert.deepEqual(f.calls,[]);
});
test('TDD Wrangler smoke runner never accepts remote database flags, config, secrets or production target',async()=>{
 const {inspectSmokeCommand}=await import('../scripts/erp-qa-readiness-wrangler-local.mjs');
 const valid=['dev','--local','--ip','127.0.0.1','--port','19991','--config','/tmp/test.json','--persist-to','/tmp/state'];
 assert.equal(inspectSmokeCommand(valid),true);
 for(const flag of ['--remote','--env=production','--ip','--https','--experimental-remote']){
  assert.throws(()=>inspectSmokeCommand([...valid,flag]),/STOP/);
 }
 assert.throws(()=>inspectSmokeCommand(valid.map(x=>x==='127.0.0.1'?'0.0.0.0':x)),/STOP/);
});

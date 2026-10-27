import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isolatedConfig,assertLocalWranglerRun,assertLocalWranglerDev} from '../scripts/erp-d1-native-worker-local-qa.mjs';

test('TDD isolated native Worker uses only fixed synthetic D1, not active ERP QA/prod binding',()=>{
 const cfg=JSON.parse(isolatedConfig());
 assert.equal(cfg.main,'worker/erp-d1-stage1-qa.mjs');
 assert.equal(cfg.d1_databases.length,1);
 assert.equal(cfg.d1_databases[0].binding,'DB');
 assert.equal(cfg.d1_databases[0].database_name,'temo-erp-stage1-worker-local-d1');
 assert.equal(cfg.vars.TEMO_ERP_D1_QA_MODE,'1');
 assert.ok(cfg.vars.TEMO_ERP_QA_DIAGNOSTIC_SECRET.length>=32);
 assert.doesNotMatch(JSON.stringify(cfg),/temo_erp_qa_db|workers\.dev|remote|production/i);
});
test('TDD only local Wrangler D1 migration and dev commands allowed, remote/env/preview invalid',()=>{
 const args=['d1','execute','temo-erp-stage1-worker-local-d1','--local','--yes',
  '--config','/tmp/wrangler.json','--persist-to','/tmp/d1','--file','/tmp/qa.sql'];
 assert.equal(assertLocalWranglerRun(args),true);
 for(const flag of ['--remote','--preview','--env=production','--experimental-remote'])
  assert.throws(()=>assertLocalWranglerRun([...args,flag]),/STOP/);
 assert.throws(()=>assertLocalWranglerRun(args.filter(x=>x!=='--local')),/STOP/);
 assert.throws(()=>assertLocalWranglerRun(['d1','execute','temo_erp_qa_db',...args.slice(3)]),/STOP/);
 const dev=['dev','--local','--ip','127.0.0.1','--port','40123',
  '--config','/tmp/config','--persist-to','/tmp/state'];
 assert.equal(assertLocalWranglerDev(dev),true);
 assert.throws(()=>assertLocalWranglerDev([...dev,'--remote']),/STOP/);
 assert.throws(()=>assertLocalWranglerDev(dev.filter(x=>x!=='--local')),/STOP/);
});
test('TDD local Worker entrypoint never mounts public ERP financial mutation or driver APIs',()=>{
 const app=readFileSync(new URL('../worker/erp-d1-stage1-qa.mjs',import.meta.url),'utf8');
 assert.match(app,/createErpD1QaReadinessHandler/);
 assert.doesNotMatch(app,/\b(?:postFinance|insertPayment|CREATE TABLE|DELETE FROM|INSERT INTO|UPDATE payments)\b/i);
 assert.doesNotMatch(app,/app\.listen|express\(/i);
});

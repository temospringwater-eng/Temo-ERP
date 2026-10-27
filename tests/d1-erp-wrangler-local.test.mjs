import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractPinnedErpBaseDdl} from '../services/d1-erp-full-schema-preflight.mjs';
import {
 localWranglerConfig,validateLocalD1Args,parseNativeD1Names,rehearseErpD1OnWranglerLocal
} from '../scripts/erp-114-wrangler-native-local.mjs';
const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const ddl=extractPinnedErpBaseDdl(source);
const coreNames=ddl.map(x=>x.name).sort();
test('TDD Cloudflare D1 test binding points to disposable local UUID not QA/prod DB',()=>{
 const conf=JSON.parse(localWranglerConfig());
 assert.equal(conf.d1_databases.length,1);
 assert.equal(conf.d1_databases[0].binding,'LOCAL_D1_ONLY');
 assert.equal(conf.d1_databases[0].database_name,'temo-erp-114-disposable-d1');
 assert.equal(conf.d1_databases[0].database_id,'22222222-2222-4222-8222-222222222222');
 assert.equal(JSON.stringify(conf).includes('temo_erp_qa_db'),false);
});
test('TDD only exact --local --persist-to --config Wrangler D1 args authorized, never remote D1',()=>{
 const args=['d1','execute','temo-erp-114-disposable-d1','--local','--yes',
  '--config','/tmp/qa-config.json','--persist-to','/tmp/temo-state','--file','/tmp/ddl.sql'];
 assert.equal(validateLocalD1Args(args),true);
 for(const bad of ['--remote','--preview','--env=production','--experimental-remote'])
  assert.throws(()=>validateLocalD1Args([...args,bad]),/STOP/);
 assert.throws(()=>validateLocalD1Args(args.filter(x=>x!=='--local')),/STOP/);
 assert.throws(()=>validateLocalD1Args(['d1','execute','temo_erp_qa_db',...args.slice(3)]),/STOP/);
});
test('TDD parse only safe Wrangler local table inventory and exclude exactly approved internal metadata',()=>{
 const answer=JSON.stringify([{results:[{name:'companies'},{name:'users'},{name:'_cf_METADATA'}]}]);
 assert.deepEqual(parseNativeD1Names(answer),['companies','users']);
 assert.throws(()=>parseNativeD1Names('Bad response'),/STOP/);
 assert.throws(()=>parseNativeD1Names(JSON.stringify([{results:[{name:'customers;DROP TABLE orders'}]}])),/STOP/);
});
test('TDD all 114 ERP source base tables created in isolated Wrangler local; remote env secrets stripped',()=>{
 let count=0;
 const fake=(binary,args,opts)=>{
  count++;
  assert.equal(binary,'/tmp/test-wrangler');
  assert.equal(validateLocalD1Args(args),true);
  assert.equal(opts.env.CLOUDFLARE_API_TOKEN,undefined);
  assert.equal(opts.env.CLOUDFLARE_ACCOUNT_ID,undefined);
  assert.equal(opts.env.TEMO_ERP_QA_SECRET,undefined);
  if(args.includes('--file')){
   const path=args[args.indexOf('--file')+1];
   const sql=readFileSync(path,'utf8');
   assert.equal((sql.match(/CREATE TABLE IF NOT EXISTS/gi)||[]).length,114);
   assert.equal(/DROP\s+TABLE/i.test(sql),false);
   assert.equal(/document_records_v4/i.test(sql),false);
   return '';
  }
  return JSON.stringify([{results:coreNames.map(name=>({name}))}]);
 };
 const report=rehearseErpD1OnWranglerLocal({source,wranglerBinary:'/tmp/test-wrangler',
  runner:fake,env:{CLOUDFLARE_API_TOKEN:'must-not-leak',
   CLOUDFLARE_ACCOUNT_ID:'must-not-leak',TEMO_ERP_QA_SECRET:'must-not-leak'}});
 assert.equal(report.exactErpBaseSchemaVerified,true);
 assert.equal(report.localTableCount,114);
 assert.equal(report.remoteD1Changed,false);
 assert.equal(report.specialCopyRebuildExcluded,true);
 assert.equal(count,2);
});
test('TDD missing ANY ERP table refuses local D1 success; no false completed migrations',()=>{
 const fake=(_binary,args)=>{
  if(args.includes('--file'))return '';
  return JSON.stringify([{results:coreNames.slice(1).map(name=>({name}))}]);
 };
 assert.throws(()=>rehearseErpD1OnWranglerLocal({source,wranglerBinary:'/tmp/wrangler',runner:fake}),
  /STOP/);
});

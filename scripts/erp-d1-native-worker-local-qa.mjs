// TRUE native Cloudflare workerd/Miniflare runtime + native D1 LOCAL Phase 1 QA.
// Disposable synthetic schema; NEVER invokes Wrangler --remote, Cloudflare APIs,
// modifies Worker deployments, or reads real customer records.
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {extractPinnedErpBaseDdl} from '../services/d1-erp-full-schema-preflight.mjs';

const STOP=s=>{throw Error('STOP: ERP native isolated Worker D1 smoke '+s)};
const DB='temo-erp-stage1-worker-local-d1';
const TOKEN='synthetic-local-only-d1-diagnostic-key-32bytes';
const QUERY='https://127.0.0.1/';
const COMMIT='2026-10-27';
const main=new URL('../',import.meta.url);
const BINDING='DB';
const forbidden=/--remote|--preview|--env=|--experimental-remote|--use-remote/i;
export function assertLocalWranglerRun(args){
 if(!Array.isArray(args)||args[0]!=='d1'||args[1]!=='execute'||args[2]!==DB||
    args.filter(x=>x==='--local').length!==1||!args.includes('--yes')||
    args.filter(x=>x==='--file').length!==1||
    !args.includes('--persist-to')||!args.includes('--config')||
    args.some(x=>forbidden.test(String(x))))
  STOP('only disposable D1 --local SQL import allowed');
 return true;
}
export function assertLocalWranglerDev(args){
 if(!Array.isArray(args)||args[0]!=='dev'||args.filter(x=>x==='--local').length!==1||
    args.includes('--remote')||!args.includes('--port')||
    !args.includes('--persist-to')||!args.includes('--config')||
    args.some(x=>forbidden.test(String(x))))
  STOP('only localhost workerd development mode permitted');
 return true;
}
export function isolatedConfig(){
 return JSON.stringify({
  name:'temo-erp-worker-stage1-local-only',
  compatibility_date:COMMIT,
  main:'worker/erp-d1-stage1-qa.mjs',
  d1_databases:[{binding:BINDING,database_name:DB,
    database_id:'33333333-3333-4333-8333-333333333333'}],
  vars:{
   TEMO_ERP_D1_QA_MODE:'1',
   TEMO_ERP_QA_DIAGNOSTIC_SECRET:TOKEN
  }
 });
}
function syntheticSql(source){
 const ddl=extractPinnedErpBaseDdl(source);
 if(ddl.length!==114)STOP('verified ERP source changed');
 return ddl.map(x=>x.sql.trim().replace(/;\s*$/,'')+';').join('\n')+
  '\nCREATE TABLE IF NOT EXISTS driver_finance_outbox(company_id INTEGER NOT NULL,delivery_id INTEGER NOT NULL,PRIMARY KEY(company_id,delivery_id));'+
  '\nALTER TABLE customers ADD COLUMN company_id INTEGER;'+
  '\nALTER TABLE products ADD COLUMN company_id INTEGER;'+
  '\nALTER TABLE payments ADD COLUMN company_id INTEGER;'+
  '\nALTER TABLE payments ADD COLUMN delivery_id INTEGER;';
}
async function freeLocalPort(){
 const net=createServer();
 await new Promise((resolve,reject)=>{net.once('error',reject);net.listen(0,'127.0.0.1',resolve)});
 const port=net.address().port;
 await new Promise((resolve,reject)=>net.close(err=>err?reject(err):resolve()));
 return port;
}
async function contact(worker,port,token,method='GET',path='/internal/qa/erp-d1-readiness'){
 if(worker.exitCode!==null||worker.signalCode!==null)STOP('local Worker exited unexpectedly');
 return fetch('http://127.0.0.1:'+port+path,{
  method,headers:token?{'x-temo-qa-token':token}:{},
  redirect:'error',signal:AbortSignal.timeout(2500)
 });
}
export async function runNativeErpD1WorkerQa({binary=process.env.TEMO_WRANGLER_BINARY}={}){
 if(typeof binary!=='string'||!binary)STOP('explicit pinned Wrangler CLI binary required');
 const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const scratch=mkdtempSync(join(tmpdir(),'temo-stage1-workerd-local-'));
 const config=join(scratch,'wrangler.json'),persist=join(scratch,'d1-local-state'),
  sql=join(scratch,'qa-schema.sql');
 let worker;
 try{
  for(const dir of ['worker','services'])mkdirSync(join(scratch,dir),{recursive:true});
  for(const path of [
   'worker/erp-d1-stage1-qa.mjs',
   'services/erp-d1-worker-readiness-qa.mjs',
   'services/d1-erp-base-table-manifest-qa.mjs',
   'services/d1-erp-base-column-manifest-qa.mjs'
  ])copyFileSync(new URL('../'+path,import.meta.url),join(scratch,path));
  writeFileSync(config,isolatedConfig(),{mode:0o600,flag:'wx'});
  writeFileSync(sql,syntheticSql(source),{mode:0o600,flag:'wx'});
  // No Cloudflare API token, account ID, environment secret or deployment credentials.
  const env={...process.env};
  for(const key of Object.keys(env))
   if(/^(CLOUDFLARE|CF_|WRANGLER|TEMO_ERP|TEMO_D1)/.test(key))delete env[key];
  const importArgs=['d1','execute',DB,'--local','--yes','--config',config,
   '--persist-to',persist,'--file',sql];
  assertLocalWranglerRun(importArgs);
  try{
   execFileSync(binary,importArgs,{cwd:scratch,env,encoding:'utf8',
    stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:2*1024*1024});
  }catch{STOP('native Wrangler local 114-table QA import failed; no remote writes')}
  const port=await freeLocalPort();
  const args=['dev','--local','--ip','127.0.0.1','--port',String(port),
   '--config',config,'--persist-to',persist];
  assertLocalWranglerDev(args);
  worker=spawn(binary,args,{cwd:scratch,env,stdio:['ignore','pipe','pipe']});
  // Drain output silently; it may contain CLI diagnostics or sensitive path info.
  worker.stdout.on('data',()=>{});
  worker.stderr.on('data',()=>{});
  let response;
  for(let i=0;i<80;i++){
   if(worker.exitCode!==null||worker.signalCode!==null)
    STOP('native Wrangler Worker could not start');
   try{
    response=await contact(worker,port,TOKEN);
    break;
   }catch{await sleep(250)}
  }
  if(!response)STOP('native Worker did not respond on isolated localhost');
  if(response.status!==200)STOP('native Worker schema gate returned unexpected HTTP status');
  let json;
  try{json=await response.json()}catch{STOP('invalid native Worker JSON response')}
  if(json?.qaOnly!==true||json?.canonicalSchemaReady!==true||
    json?.coreSchemaReady!==true||json?.expectedErpBaseTables!==114||
    json?.baseSchemaNameAndColumnReady!==true||json?.financeCutoverAllowed!==false||
    json?.productionReady!==false||json?.missingTables?.length!==0||
    json?.baseColumnGaps?.length!==0)
   STOP('workerd D1 114-table isolated schema contract not verified');
  const blocked=await contact(worker,port,'incorrect-qa-key');
  if(blocked.status!==401)STOP('native Worker leaked private schema without token');
  const write=await contact(worker,port,TOKEN,'POST');
  if(write.status!==405)STOP('native Worker accepted schema mutation method');
  const unknown=await contact(worker,port,TOKEN,'GET','/api/erp/sales');
  if(unknown.status!==404)STOP('native Worker accidentally exposed ERP finance API');
  return Object.freeze({nativeWorkerdVerified:true,full114SchemaReady:true,
   authGatesVerified:true,financeWritesDisabled:true,
   activeRemoteWorkerDeployed:false,liveD1Changed:false});
 }finally{
  if(worker&&worker.exitCode===null){
   worker.kill('SIGTERM');
   for(let i=0;i<25&&worker.exitCode===null;i++)await sleep(100);
   if(worker.exitCode===null)worker.kill('SIGKILL');
  }
  rmSync(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
}
if(process.argv[1]?.endsWith('erp-d1-native-worker-local-qa.mjs')){
 try{
  const result=await runNativeErpD1WorkerQa();
  console.log('PASS: actual Cloudflare Worker localhost runtime + native D1 all 114 ERP base tables',
   result.nativeWorkerdVerified?'verified':'blocked');
  console.log('QA authentication and no financial writes verified; remote D1/Workers UNCHANGED.');
 }catch(error){
  console.error(error?.message?.startsWith('STOP:')?error.message:
   'STOP: native Worker LOCAL integration failed; remote D1 unchanged');
  process.exitCode=1;
 }
}

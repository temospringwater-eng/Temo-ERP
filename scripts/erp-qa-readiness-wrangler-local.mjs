// Launch real Wrangler Worker+D1 strictly on local loopback / disposable D1.
// No Cloudflare token, account ID, remote DB write, deployment or customer record access.
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
const STOP=s=>{throw Error('STOP: ERP QA native local Worker smoke '+s)};
const NAME='temo-erp-qa-readiness-local-only';
const SECRET='test-only-d1-qa-worker-diagnostic-secret-987654';
const PORT='19991';
export function inspectSmokeCommand(args){
 if(!Array.isArray(args)||args.length!==10||args[0]!=='dev'||args[1]!=='--local'||
  args[2]!=='--ip'||args[3]!=='127.0.0.1'||args[4]!=='--port'||
  args[5]!==PORT||args[6]!=='--config'||typeof args[7]!=='string'||
  args[7].startsWith('-')||args[8]!=='--persist-to'||
  typeof args[9]!=='string'||args[9].startsWith('-'))
  STOP('only loopback and LOCAL Wrangler dev is permitted');
 return true;
}
export function qaSmokeWranglerConfig(main){
 if(typeof main!=='string'||!main.endsWith('/worker/erp-d1-qa-readiness-worker.mjs'))
  STOP('unapproved Worker entrypoint');
 return JSON.stringify({name:NAME,main,compatibility_date:'2026-10-27',
  vars:{TEMO_ERP_D1_QA_MODE:'1',TEMO_ERP_QA_DIAGNOSTIC_SECRET:SECRET},
  d1_databases:[{binding:'DB',database_name:'temo-local-readiness-qa',
   database_id:'44444444-4444-4444-8444-444444444444'}]});
}
export async function verifyWranglerLocalWorker({
 binary=process.env.TEMO_WRANGLER_BINARY,spawnChild=spawn,fetcher=fetch
}={}){
 if(typeof binary!=='string'||!binary||typeof spawnChild!=='function'||typeof fetcher!=='function')
  STOP('explicit local Wrangler binary and fetch required');
 const tmp=mkdtempSync(join(tmpdir(),'temo-local-worker-qa-'));
 const src=resolve(fileURLToPath(new URL('../worker/erp-d1-qa-readiness-worker.mjs',import.meta.url)));
 const config=join(tmp,'wrangler.json'),state=join(tmp,'d1-local');
 const env={...process.env};
 for(const key of Object.keys(env))
  if(/^(CLOUDFLARE|CF_|WRANGLER|TEMO_ERP|TEMO_D1|GITHUB_TOKEN)/.test(key))
   delete env[key];
 const args=['dev','--local','--ip','127.0.0.1','--port',PORT,'--config',config,
  '--persist-to',state];
 inspectSmokeCommand(args);
 writeFileSync(config,qaSmokeWranglerConfig(src),{mode:0o600,flag:'wx'});
 let child;
 try{
  child=spawnChild(binary,args,{env,cwd:tmp,stdio:['ignore','ignore','ignore']});
  if(!child||typeof child.kill!=='function'||!Number.isSafeInteger(child.pid))
   STOP('local process unavailable');
  const base='http://127.0.0.1:'+PORT;
  let authenticated;
  for(let i=0;i<70;i++){
   if(child.exitCode!==null)STOP('local Worker exited before readiness');
   try{
    const response=await fetcher(base+'/internal/qa/erp-d1-readiness',
     {headers:{'x-temo-qa-token':SECRET},signal:AbortSignal.timeout(800)});
    if(response.status===200){authenticated=response;break}
    if(response.status!==503)STOP('unexpected local Worker startup response');
   }catch(error){
    if(error?.message?.startsWith('STOP:'))throw error;
   }
   await sleep(150);
  }
  if(!authenticated)STOP('local Worker was not ready');
  const body=await authenticated.json();
  if(body?.qaOnly!==true||body?.canonicalSchemaReady!==false||
    body?.expectedErpBaseTables!==114||body?.financeCutoverAllowed!==false||
    body?.productionReady!==false||body?.tableCount!==0||
    body?.missingTables?.length!==114)
   STOP('empty local D1 incorrectly approved or returned untrusted metadata');
  const invalid=await fetcher(base+'/internal/qa/erp-d1-readiness',
   {headers:{'x-temo-qa-token':'wrong-token'}});
  const missing=await fetcher(base+'/internal/qa/erp-d1-readiness');
  const unrelated=await fetcher(base+'/api/erp/qa/summary');
  const mutate=await fetcher(base+'/internal/qa/erp-d1-readiness',{method:'POST'});
  if([invalid.status,missing.status,unrelated.status,mutate.status].join(',')!=='401,401,404,405')
   STOP('local Worker auth or method policy failed');
  return Object.freeze({nativeWorkerLocal:true,d1SchemaReady:false,
   expectedErpBaseTables:114,invalidAuthDenied:true,unrelatedRoutesDenied:true,
   financeCutoverAllowed:false,productionReady:false,remoteD1Changed:false});
 }finally{
  try{child?.kill('SIGTERM')}catch{}
  rmSync(tmp,{force:true,recursive:true});
 }
}
if(process.argv[1]?.endsWith('erp-qa-readiness-wrangler-local.mjs')){
 verifyWranglerLocalWorker().then(r=>{
  console.log('PASS: real local Cloudflare Worker+D1 readiness route returns BLOCKED for 114 missing ERP tables');
  console.log('PASS: private token, no-admin-route and non-GET fail-closed; local state destroyed, no remote DB touched');
 }).catch(e=>{
  console.error(e?.message?.startsWith('STOP:')?e.message:'STOP: local Cloudflare Worker smoke failed safely');
  process.exitCode=1;
 });
}

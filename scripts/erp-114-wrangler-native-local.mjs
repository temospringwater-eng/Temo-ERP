// Cloudflare Wrangler native D1 LOCAL only. No remote QA/production D1 or customer records.
// Validates all 114 pinned additive ERP base table definitions on a disposable workerd DB.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {extractPinnedErpBaseDdl} from '../services/d1-erp-full-schema-preflight.mjs';
const STOP=message=>{throw Error('STOP: native ERP D1 local schema gate '+message)};
const DB='temo-erp-114-disposable-d1';
const NAME=/^[a-z_][a-zA-Z0-9_]{0,127}$/;
const QUERY="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
export function localWranglerConfig(){
 return JSON.stringify({name:'temo-erp-disposable-schema-check',compatibility_date:'2026-10-27',
  d1_databases:[{binding:'LOCAL_D1_ONLY',database_name:DB,
   database_id:'22222222-2222-4222-8222-222222222222'}]});
}
export function validateLocalD1Args(args){
 if(!Array.isArray(args)||args.length<11||args[0]!=='d1'||args[1]!=='execute'||args[2]!==DB||
    args.filter(x=>x==='--local').length!==1||!args.includes('--yes')||
    !args.includes('--config')||!args.includes('--persist-to')||
    args.some(x=>/--remote|--preview|--env=|--experimental-remote|--use-remote/.test(x))||
    args.filter(x=>x==='--file').length+args.filter(x=>x==='--command').length!==1||
    ['--config','--persist-to','--file','--command'].some(flag=>{
     const index=args.indexOf(flag);
     return index>=0&&(index===args.length-1||String(args[index+1]).startsWith('-'));
    }))STOP('only fixed local D1 execution arguments permitted');
 return true;
}
function unpack(parsed){
 if(Array.isArray(parsed)){
  for(const value of parsed){const sub=unpack(value);if(sub)return sub;}
  if(parsed.every(x=>x&&typeof x.name==='string'))return parsed;
 }
 if(parsed&&typeof parsed==='object')
  for(const key of ['results','result'])if(parsed[key]){
   const sub=unpack(parsed[key]);if(sub)return sub;
  }
 return null;
}
export function parseNativeD1Names(raw){
 let obj;try{obj=JSON.parse(raw)}catch{STOP('invalid Wrangler local metadata JSON')}
 const rows=unpack(obj);
 if(!rows||rows.some(x=>!NAME.test(x.name))||
    new Set(rows.map(x=>x.name)).size!==rows.length)STOP('unsafe Wrangler schema response');
 return rows.map(x=>x.name)
  .filter(x=>x!=='_cf_METADATA'&&x!=='_cf_KV'&&x!=='sqlite_sequence').sort();
}
export function rehearseErpD1OnWranglerLocal({source,
 wranglerBinary=process.env.TEMO_WRANGLER_BINARY,runner=execFileSync,env=process.env}={}){
 if(typeof source!=='string'||typeof wranglerBinary!=='string'||!wranglerBinary||
    typeof runner!=='function'||!env||typeof env!=='object')
  STOP('explicit verified ERP source and Wrangler runner required');
 const ddl=extractPinnedErpBaseDdl(source);
 const expected=ddl.map(x=>x.name).sort();
 const directory=mkdtempSync(join(tmpdir(),'temo-erp-wrangler-local-'));
 const config=join(directory,'wrangler.json'),file=join(directory,'erp-114-schema.sql'),
  persist=join(directory,'local-state');
 const safeEnvironment={...env};
 for(const key of Object.keys(safeEnvironment))
  if(/^(CLOUDFLARE|CF_|WRANGLER|TEMO_ERP|TEMO_D1)/.test(key))delete safeEnvironment[key];
 const command=(type,argument)=>{
  const args=['d1','execute',DB,'--local','--yes','--config',config,'--persist-to',persist,
   type,argument,...(type==='--command'?['--json']:[])];
  validateLocalD1Args(args);
  try{
   const result=runner(wranglerBinary,args,{cwd:directory,env:safeEnvironment,
    encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:90000,maxBuffer:2*1024*1024});
   return typeof result==='string'?result:Buffer.isBuffer(result)?result.toString('utf8'):'';
  }catch{STOP(type==='--file'?'114-table local D1 schema import failed; no remote change':
   'local D1 metadata query failed; no remote change')}
 };
 try{
  const sql=ddl.map(x=>x.sql.replace(/;\s*$/,'')+';').join('\n');
  if(/;\s*(?:DROP|DELETE|UPDATE|INSERT|ALTER|ATTACH|VACUUM)\b/i.test(sql)||
     /document_records_v4/i.test(sql))STOP('unsafe ERP D1 schema source');
  writeFileSync(config,localWranglerConfig(),{mode:0o600,flag:'wx'});
  writeFileSync(file,sql,{mode:0o600,flag:'wx'});
  command('--file',file);
  const found=parseNativeD1Names(command('--command',QUERY));
  if(found.length!==114||JSON.stringify(found)!==JSON.stringify(expected))
   STOP('full 114 ERP base table parity missing in actual Wrangler local D1');
  return Object.freeze({exactErpBaseSchemaVerified:true,localTableCount:114,
   specialCopyRebuildExcluded:true,remoteD1Changed:false,
   disposableStateDestroyed:true,canonicalErpD1RuntimeReady:false});
 }finally{rmSync(directory,{recursive:true,force:true})}
}
if(process.argv[1]?.endsWith('erp-114-wrangler-native-local.mjs')){
 try{
  const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const r=rehearseErpD1OnWranglerLocal({source});
  console.log('PASS: native Wrangler D1 LOCAL ERP safe schema tables:',r.localTableCount);
  console.log('document_records_v4 copy/rebuild EXCLUDED; local state destroyed; remote D1 UNCHANGED.');
  console.log('Actual Cloudflare ERP Workers migration / live finance sync remains BLOCKED.');
 }catch(e){
  console.error(e?.message?.startsWith('STOP:')?e.message:
   'STOP: ERP native D1 schema validation failed; remote databases unchanged');
  process.exitCode=1;
 }
}

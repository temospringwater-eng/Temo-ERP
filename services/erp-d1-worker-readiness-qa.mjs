// Worker-compatible ERP QA diagnostic adapter. NOT mounted, not deployed,
// no customer reads, migrations, secret output or financial posting.
export const ERP_D1_CORE_TABLES=Object.freeze([
 'companies','users','customers','products','orders','deliveries','payments',
 'credit_ledger','stock_movements','bottle_movements','driver_finance_outbox'
]);
const QUERY="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
async function sameSecret(a,b){
 if(typeof a!=='string'||typeof b!=='string'||b.length<32)return false;
 const enc=new TextEncoder();
 const digest=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)));
 const x=await digest(a),y=await digest(b);
 let mismatch=0;for(let i=0;i<x.length;i++)mismatch|=x[i]^y[i];
 return mismatch===0;
}
function json(response,status){
 return new Response(JSON.stringify(response),{status,headers:{'content-type':'application/json;charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
export function createErpD1QaReadinessHandler(){
 return async function handle(request,env){
  if(!request||!env||env.TEMO_ERP_D1_QA_MODE!=='1'||
    typeof env.TEMO_ERP_QA_DIAGNOSTIC_SECRET!=='string'||
    env.TEMO_ERP_QA_DIAGNOSTIC_SECRET.length<32)
   return json({error:'not_found'},404);
  let url;
  try{url=new URL(request.url)}catch{return json({error:'not_found'},404)}
  if(url.pathname!=='/internal/qa/erp-d1-readiness'||url.search)
   return json({error:'not_found'},404);
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  if(!await sameSecret(request.headers.get('x-temo-qa-token'),
    env.TEMO_ERP_QA_DIAGNOSTIC_SECRET))return json({error:'unauthorized'},401);
  if(!env.DB||typeof env.DB.prepare!=='function')return json({error:'qa_d1_unavailable'},503);
  try{
   const response=await env.DB.prepare(QUERY).all();
   if(!Array.isArray(response?.results)||response?.success===false)
    throw Error('D1 schema list refused');
   const names=new Set(response.results.map(x=>x.name).filter(x=>typeof x==='string'));
   const missing=ERP_D1_CORE_TABLES.filter(name=>!names.has(name));
   return json({qaOnly:true,canonicalSchemaReady:missing.length===0,
    tableCount:names.size,missingTables:missing},200);
  }catch{
   return json({error:'qa_d1_schema_unavailable'},503);
  }
 };
}

// Worker-compatible read-only ERP QA diagnostic; NOT mounted or deployed.
// Only table/column metadata is queried, NEVER customer/finance rows or remote DDL.
// 11 driver core tables are NOT enough to claim central ERP schema compatibility.
import {ERP_D1_BASE_TABLES} from './d1-erp-base-table-manifest-qa.mjs';
import {ERP_D1_BASE_COLUMNS} from './d1-erp-base-column-manifest-qa.mjs';
import {ERP_D1_BASE_FOREIGN_KEYS} from './d1-erp-base-fk-manifest-qa.mjs';
export const ERP_D1_CORE_TABLES=Object.freeze([
 'companies','users','customers','products','orders','deliveries','payments',
 'credit_ledger','stock_movements','bottle_movements','driver_finance_outbox'
]);
const CORE_COLUMNS=Object.freeze({
 companies:['id','name','active'],
 users:['id','company_id','role','active'],
 customers:['id','company_id','name'],
 products:['id','company_id','stock'],
 orders:['id','company_id','customer_id','status','total_amount'],
 deliveries:['id','company_id','order_id','driver_id','status','collected_amount'],
 payments:['id','company_id','delivery_id','amount','method']
});
const TABLE_NAMES="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
const SAFE_NAME=/^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
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
async function readTableInfo(db,name){
 // name comes ONLY from pinned internal ERP base manifest or fixed core contract.
 if(!SAFE_NAME.test(name))throw Error('unsafe base metadata identifier');
 const rows=await db.prepare("PRAGMA table_info('"+name+"')").all();
 if(!Array.isArray(rows?.results)||rows.success===false)
  throw Error('invalid D1 schema metadata result');
 const columns=new Map();
 for(const col of rows.results){
  if(!col||!SAFE_NAME.test(col.name)||typeof col.type!=='string'||columns.has(col.name))
   throw Error('untrusted D1 schema column data');
  columns.set(col.name,String(col.type).toUpperCase());
 }
 return columns;
}
async function readTableFkList(db,table){
 if(!SAFE_NAME.test(table)||!Object.hasOwn(ERP_D1_BASE_FOREIGN_KEYS,table))
  throw Error('unreviewed FK table identifier');
 const r=await db.prepare("PRAGMA foreign_key_list('"+table+"')").all();
 if(!Array.isArray(r?.results)||r.success===false)throw Error('invalid FK schema result');
 const keys=[];
 for(const entry of r.results){
  if(!entry||!SAFE_NAME.test(entry.from)||!SAFE_NAME.test(entry.to)||
   !SAFE_NAME.test(entry.table)||typeof entry.on_delete!=='string'||
   !['NO ACTION','CASCADE','RESTRICT','SET NULL','SET DEFAULT'].includes(entry.on_delete)||
   !Number.isSafeInteger(entry.id)||entry.id<0||
   !Number.isSafeInteger(entry.seq)||entry.seq!==0)
   throw Error('untrusted FK schema metadata');
  keys.push({from:entry.from,table:entry.table,to:entry.to,onDelete:entry.on_delete});
 }
 const keyOf=k=>JSON.stringify(k);
 if(new Set(keys.map(keyOf)).size!==keys.length)
  throw Error('duplicate FK metadata');
 return keys;
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
   if(ERP_D1_BASE_TABLES.length!==114||Object.keys(ERP_D1_BASE_COLUMNS).length!==114||
      ERP_D1_BASE_TABLES.some(name=>!SAFE_NAME.test(name)||!ERP_D1_BASE_COLUMNS[name]))
    throw Error('source manifest invalid');
   const res=await env.DB.prepare(TABLE_NAMES).all();
   if(!Array.isArray(res?.results)||res.success===false)
    throw Error('D1 schema list refused');
   const list=res.results.map(x=>x?.name);
   if(list.some(x=>typeof x!=='string'||!SAFE_NAME.test(x))||
      new Set(list).size!==list.length)
    throw Error('invalid table names in D1 schema');
   const names=new Set(list);
   const missingCore=ERP_D1_CORE_TABLES.filter(name=>!names.has(name));
   const missing=ERP_D1_BASE_TABLES.filter(name=>!names.has(name));
   const baseColumnGaps=[],criticalColumnGaps=[],baseFkGaps=[];
   const inspected=new Map();
   for(const table of ERP_D1_BASE_TABLES){
    if(!names.has(table))continue;
    const actual=await readTableInfo(env.DB,table);
    inspected.set(table,actual);
    const fields=ERP_D1_BASE_COLUMNS[table],missingFields=[];
    if(!Array.isArray(fields)||fields.length===0)throw Error('invalid source column contract');
    for(const pair of fields){
     const [column,type]=pair;
     if(!SAFE_NAME.test(column)||!['INTEGER','TEXT','REAL'].includes(type))
      throw Error('invalid pinned source column definition');
     if(!actual.has(column)||actual.get(column)!==type)
      missingFields.push(column);
    }
    if(missingFields.length)baseColumnGaps.push({table,fields:missingFields});
    const expectedFk=ERP_D1_BASE_FOREIGN_KEYS[table];
    if(!Array.isArray(expectedFk))throw Error('missing pinned base FK contract');
    const actualFk=await readTableFkList(env.DB,table);
    const expectedSet=new Set(expectedFk.map(JSON.stringify)),actualSet=new Set(actualFk.map(JSON.stringify));
    const missingFks=expectedFk.filter(fk=>!actualSet.has(JSON.stringify(fk)));
    const unexpectedFks=actualFk.filter(fk=>!expectedSet.has(JSON.stringify(fk)));
    if(missingFks.length||unexpectedFks.length)
     baseFkGaps.push({table,missing:missingFks,unexpected:unexpectedFks});
   }
   for(const [table,fields] of Object.entries(CORE_COLUMNS)){
    if(!names.has(table))continue;
    const actual=inspected.get(table)||await readTableInfo(env.DB,table);
    const absent=fields.filter(name=>!actual.has(name));
    if(absent.length)criticalColumnGaps.push({table,fields:absent});
   }
   const baseSchemaNameAndColumnReady=missing.length===0&&baseColumnGaps.length===0;
   const baseFkReady=baseFkGaps.length===0;
   const coreSchemaReady=missingCore.length===0;
   // Additional runtime ALTERs, FKs, indexes, tenant mappings and actual
   // Worker deployment still have separate release gates. This never flips posting.
   const canonicalSchemaReady=baseSchemaNameAndColumnReady&&baseFkReady&&coreSchemaReady&&
      criticalColumnGaps.length===0;
   return json({qaOnly:true,coreSchemaReady,baseSchemaNameAndColumnReady,
    canonicalSchemaReady,tableCount:names.size,expectedErpBaseTables:114,
    missingTables:missing,missingCoreTables:missingCore,
    baseColumnGaps,baseFkReady,baseFkGaps,criticalColumnGaps,
    financeCutoverAllowed:false,productionReady:false},200);
  }catch{
   return json({error:'qa_d1_schema_unavailable'},503);
  }
 };
}

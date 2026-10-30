// QA-only ERP canonical base-schema introspection. No network, Cloudflare D1, or customer-row access.
// A live migration, even of "IF NOT EXISTS" DDL, requires separately reviewed QA approval.
import {createHash} from 'node:crypto';
const STOP=s=>{throw Error('STOP: ERP/D1 full-schema preflight '+s)};
const PINNED_ERP_BLOB='c0f8690e91d0117dc8a276a0893652b0deaad251';
const SAFE_NAME=/^[a-z][a-z0-9_]{0,99}$/;
const CREATE_RE=/db\.run\(\s*`(\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_]\w*)[\s\S]*?)`\s*(?:,|\))/gi;
const gitBlob=source=>createHash('sha1').update('blob '+Buffer.byteLength(source,'utf8')+'\0'+source).digest('hex');
function sqliteColumns(db,name){
 if(!SAFE_NAME.test(name))STOP('unsafe schema name');
 const columns=db.prepare("PRAGMA table_xinfo('"+name+"')").all();
 if(!Array.isArray(columns)||!columns.length||columns.some(c=>!SAFE_NAME.test(c.name)))
  STOP('invalid SQLite column metadata');
 return columns.map(c=>({name:c.name,type:String(c.type||'').toUpperCase(),
  notnull:Number(c.notnull||0),pk:Number(c.pk||0),default:c.dflt_value??null,
  hidden:Number(c.hidden||0)}));
}
const listNames=db=>{
 if(typeof db?.prepare!=='function')STOP('independent disposable SQLite connection missing');
 const result=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
 if(!Array.isArray(result)||result.some(r=>!SAFE_NAME.test(r.name)))STOP('unsafe metadata');
 return result.map(x=>x.name);
};
export function extractPinnedErpBaseDdl(source){
 if(typeof source!=='string'||gitBlob(source)!==PINNED_ERP_BLOB)
  STOP('source Git blob changed; review migration and regenerate pin');
 const result=[...source.matchAll(CREATE_RE)].map(x=>({name:x[2],sql:x[1].trim().replace(/\r\n/g,'\n')}));
 if(result.length!==114||new Set(result.map(x=>x.name)).size!==114||
  result.some(x=>!SAFE_NAME.test(x.name)||x.name==='document_records_v4'||
   x.sql.includes('${')||
   /;\s*(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|REPLACE|VACUUM|ATTACH)\b/i.test(x.sql)))
  STOP('unapproved SQL or expected ERP baseline table count drift');
 return Object.freeze(result.map(x=>Object.freeze(x)));
}
export function createDisposableErpSchema(db,ddl){
 if(typeof db?.exec!=='function'||!Array.isArray(ddl)||ddl.length!==114||
    listNames(db).length!==0||
    new Set(ddl.map(x=>x.name)).size!==114)
  STOP('fresh disposable SQLite and complete reviewed ERP DDL required');
 for(const item of ddl){
  if(!item||!SAFE_NAME.test(item.name)||
    !new RegExp('^CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+'+item.name+'\\s*\\(','i').test(item.sql)||
    /;\s*(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE)\b/i.test(item.sql))
   STOP('non-table or unreviewed source migration detected');
  db.exec(item.sql);
 }
 if(listNames(db).length!==114)STOP('ERP local schema incomplete after disposable initialization');
 if(db.prepare('PRAGMA foreign_key_check').all().length)STOP('disposable ERP baseline FK check failed');
 return Object.freeze({created:114,isolatedOnly:true,liveD1Changed:false,
  destructiveRebuildExcluded:'document_records_v4'});
}
export function inspectDisposableD1Compatibility({erp,d1}={}){
 // Both must be isolated SQLite/Miniflare connections. Never supply actual Cloudflare Worker binding.
 const source=listNames(erp),target=listNames(d1);
 if(source.length!==114||source.includes('document_records_v4')||!source.includes('users')||
  !source.includes('credit_ledger')||!source.includes('payments')||
  !source.includes('warehouses')||!source.includes('stock_movements'))
  STOP('ERP source schema not pinned complete');
 if(target.length<1)STOP('empty destination schema is unreviewed');
 const theirs=new Set(target);
 const overlapping=source.filter(n=>theirs.has(n));
 const missing=source.filter(n=>!theirs.has(n));
 const columnDrift=[];
 for(const name of overlapping){
  const expected=sqliteColumns(erp,name),actual=sqliteColumns(d1,name);
  const a=new Map(actual.map(c=>[c.name,c]));
  const b=new Map(expected.map(c=>[c.name,c]));
  const missingColumns=expected.filter(c=>!a.has(c.name)).map(c=>c.name);
  const addedColumns=actual.filter(c=>!b.has(c.name)).map(c=>c.name);
  const incompatible=expected.filter(c=>a.has(c.name)&&
   ['type','notnull','pk','default','hidden'].some(field=>c[field]!==a.get(c.name)[field])).map(c=>c.name);
  if(missingColumns.length||addedColumns.length||incompatible.length)
   columnDrift.push({table:name,missingColumns,addedColumns,incompatible});
 }
 return Object.freeze({qaOnly:true,expectedSafeTables:114,overlap:overlapping.length,
  missingCount:missing.length,missingTables:missing,columnDrift,
  baseSchemaMatches:missing.length===0&&columnDrift.length===0,
  deferredDestructiveTable:'document_records_v4',
  readyForRemoteMigration:false,liveD1Changed:false,financialSyncEnabled:false});
}

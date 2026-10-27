// TEMO ERP QA: additive missing-table rehearsal against LOCAL disposable Node SQLite ONLY.
// Existing QA D1 table-name overlap is NOT proof of compatible columns or production readiness.
// No Worker / Cloudflare API, no customer source rows, no remote writes or raw SQL output.
import {DatabaseSync} from 'node:sqlite';
import {
 extractPinnedErpBaseDdl,createDisposableErpSchema,inspectDisposableD1Compatibility
} from './d1-erp-full-schema-preflight.mjs';

const STOP=msg=>{throw Error('STOP: ERP 107-table local migration '+msg)};
const CORE=Object.freeze(['companies','users','customers','products','orders','deliveries','payments']);
const SAFE=/^[a-z][a-z0-9_]{0,99}$/;
function assertLocal(db){
 // env.DB from a Cloudflare Worker cannot pass this Node runtime type gate.
 if(!(db instanceof DatabaseSync))STOP('only Node disposable SQLite connections authorized');
}
function names(db){
 return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all().map(r=>r.name);
}
export function planMissingErpBaseTables({source,target}={}){
 assertLocal(target);
 const ddl=extractPinnedErpBaseDdl(source);
 const existing=names(target);
 if(CORE.some(name=>!existing.includes(name)))
  STOP('mandatory original QA core tenant tables missing; not an authorized blank ERP DB');
 if(existing.some(n=>!SAFE.test(n)))STOP('unsafe local schema identifier');
 const ref=new DatabaseSync(':memory:');
 let parity;
 try{
  createDisposableErpSchema(ref,ddl);
  parity=inspectDisposableD1Compatibility({erp:ref,d1:target});
 }finally{ref.close()}
 if(parity.columnDrift.length)
  STOP('overlap column/type/primary-key drift; requires reviewed per-table mapping before migration');
 const missing=new Set(parity.missingTables);
 const schemaObjects=target.prepare("SELECT name,type FROM sqlite_master WHERE type IN ('view','index','trigger')").all();
 if(schemaObjects.some(o=>missing.has(o.name)))
  STOP('collision with existing QA non-table schema object');
 const sqlStatements=ddl.filter(item=>missing.has(item.name)).map(item=>item.sql.trim());
 if(sqlStatements.length!==parity.missingCount||
    sqlStatements.some(sql=>!/^(?:CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS)\s+[a-z][a-z0-9_]*\s*\(/i.test(sql)||
      /;\s*(?:DROP|ALTER|UPDATE|DELETE|INSERT|CREATE|REPLACE|ATTACH|VACUUM)\b/i.test(sql)))
  STOP('unsafe or incomplete additive migration blueprint');
 return Object.freeze({
  addedCount:sqlStatements.length,
  existingOverlap:parity.overlap,
  extraQaTables:existing.length-parity.overlap,
  missingTableNames:Object.freeze([...parity.missingTables]),
  sqlStatements:Object.freeze(sqlStatements),
  specialRebuildExcluded:'document_records_v4',
  schemaReadyForRemoteMigration:false,
  remoteD1Changed:false
 });
}
export function applyMissingErpBaseTablesLocally({source,target}={}){
 assertLocal(target);
 const before=names(target);
 const initialChanges=target.prepare('SELECT total_changes() AS n').get().n;
 const plan=planMissingErpBaseTables({source,target});
 try{
  target.exec('BEGIN IMMEDIATE');
  for(const sql of plan.sqlStatements)target.exec(sql);
  const after=names(target);
  if(after.length!==before.length+plan.addedCount||before.some(x=>!after.includes(x)))
   STOP('local DDL altered existing table inventory');
  if(target.prepare('SELECT total_changes() AS n').get().n!==initialChanges)
   STOP('existing business data modified by an additive migration');
  if(target.prepare('PRAGMA foreign_key_check').all().length)
   STOP('local ERP database foreign-key integrity failed');
  const integrity=target.prepare('PRAGMA integrity_check').all();
  if(integrity.length!==1||integrity[0].integrity_check!=='ok')
   STOP('local ERP database integrity failed');
  const final=planMissingErpBaseTables({source,target});
  if(final.addedCount!==0)
   STOP('new ERP table inventory incomplete');
  target.exec('COMMIT');
  return Object.freeze({addedCount:plan.addedCount,beforeTableCount:before.length,
   afterTableCount:after.length,all114SafeBaseNamesPresent:true,
   extraQaTables:plan.extraQaTables,overlapDriftBlocked:true,
   existingRowsChanged:false,foreignKeyViolations:0,
   destructiveCopyRebuildExcluded:true,activeWorkerDeployed:false,
   remoteD1Changed:false,liveFinancialSyncEnabled:false});
 }catch(error){
  try{target.exec('ROLLBACK')}catch{}
  if(error?.message?.startsWith('STOP:'))throw error;
  STOP('disposable DDL failed and rolled back; no remote DB access');
 }
}

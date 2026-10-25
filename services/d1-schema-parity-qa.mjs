'use strict';
/**
 * TEMO ERP -> Cloudflare D1 schema parity; READ-ONLY audit and disposable-only
 * planning. Never runs DDL against D1. Never reads application/customer rows.
 *
 * These are 115 simple CREATE TABLE templates in server.js. The 116th,
 * document_records_v4, is a rebuild-and-copy migration (DROP/INSERT/RENAME)
 * and deliberately MUST NOT be inferred as safe to run on D1.
 * Auxiliary DDL in imported services, CREATE INDEX and ALTER migrations also
 * require a separate reviewed, ordered migration plan.
 */
const identifier = s => typeof s === 'string' && /^[A-Za-z_][A-Za-z_0-9]{0,99}$/.test(s);
const sorted = x => [...new Set(x)].sort();
const snapshot = x => JSON.parse(JSON.stringify(x));

export function extractErpTableDdl(source) {
  if (typeof source !== 'string') throw Error('Pinned ERP server source required');
  const re = /db\.run\(\s*\x60(\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_]\w*)[\s\S]*?)\x60\s*(?:,|\))/gi;
  const result = [...source.matchAll(re)].map(m => ({name:m[2],sql:m[1].trim().replace(/\r\n/g,'\n')}));
  if (result.length !== 115 || new Set(result.map(x=>x.name)).size !== 115 ||
      result.some(x=>!identifier(x.name) || /\$\{|;\s*(?:DROP|DELETE|INSERT|UPDATE|ALTER|CREATE)\b/i.test(x.sql)))
    throw Error('Unexpected ERP DDL: source changed; manual review required');
  if (result.some(x=>/document_records_v4/i.test(x.name)))
    throw Error('Unsafe copy/drop migration detected');
  return Object.freeze(result.map(x=>Object.freeze(x)));
}

export async function inspectD1SchemaReadOnly(d1) {
  if (!d1 || typeof d1.prepare !== 'function') throw Error('Authorized read-only D1 binding required');
  const rows = await d1.prepare(
    "SELECT name,type,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' ORDER BY type,name"
  ).all();
  if (!Array.isArray(rows?.results)) throw Error('D1 sqlite_master read failed');
  const objects = rows.results.map(r => ({name:r.name,type:r.type,table:r.tbl_name,sql:r.sql || null}));
  if (objects.some(o=>!identifier(o.name)||!identifier(o.table)||!['table','index','trigger','view'].includes(o.type)))
    throw Error('Invalid D1 schema identifier');
  const tables = objects.filter(o=>o.type==='table').map(o=>o.name);
  const details={};
  for (const name of sorted(tables)) {
    // Names came only from sqlite_master; never from client input.
    const col=await d1.prepare("PRAGMA table_xinfo('"+name+"')").all();
    const fk=await d1.prepare("PRAGMA foreign_key_list('"+name+"')").all();
    const idx=await d1.prepare("PRAGMA index_list('"+name+"')").all();
    if (![col?.results,fk?.results,idx?.results].every(Array.isArray))
      throw Error('D1 PRAGMA inspection failed');
    details[name]={
      columns:col.results.map(r=>({
        name:r.name,type:String(r.type||'').trim().toUpperCase(),
        notNull:Number(r.notnull||0),pk:Number(r.pk||0),
        defaultValue:r.dflt_value??null,hidden:Number(r.hidden||0)
      })),
      foreignKeys:fk.results.map(r=>({
        id:Number(r.id),seq:Number(r.seq),table:r.table,from:r.from,to:r.to,
        onUpdate:r.on_update,onDelete:r.on_delete,match:r.match
      })),
      indexes:idx.results.map(r=>({
        name:r.name,unique:Number(r.unique),origin:r.origin,partial:Number(r.partial||0)
      }))
    };
    if (details[name].columns.some(c=>!identifier(c.name)) ||
        details[name].foreignKeys.some(f=>!identifier(f.table)||!identifier(f.from)||
          (f.to!==null&&!identifier(f.to))))
      throw Error('Unsafe D1 column or foreign-key identifier');
  }
  return {tables:sorted(tables),objects:snapshot(objects),details};
}

const canon = v => JSON.stringify(v);
const columnContract = d => (d.columns||[]).map(c=>({
  name:c.name,type:c.type,notNull:c.notNull,pk:c.pk,
  defaultValue:c.defaultValue,hidden:c.hidden
}));
const fkContract = d => (d.foreignKeys||[]).map(f=>({
  id:f.id,seq:f.seq,table:f.table,from:f.from,to:f.to,onUpdate:f.onUpdate,onDelete:f.onDelete,match:f.match
}));
const indexContract = d => (d.indexes||[]).map(i=>({
  // autoindex names are engine-generated; compare uniqueness/origin/partial.
  unique:i.unique,origin:i.origin,partial:i.partial
})).sort((a,b)=>canon(a).localeCompare(canon(b)));
export function compareErpD1Schema(expected,actual) {
  if (![expected,actual].every(p=>p && Array.isArray(p.tables) && p.details &&
     p.tables.every(identifier))) throw Error('Two verified schema profiles required');
  const missing=expected.tables.filter(x=>!actual.tables.includes(x));
  const extra=actual.tables.filter(x=>!expected.tables.includes(x));
  const mismatched=[];
  for (const name of expected.tables.filter(x=>actual.tables.includes(x))) {
    const a=expected.details[name],b=actual.details[name];
    if (!a||!b) throw Error('Incomplete table profiles');
    const reasons=[];
    if(canon(columnContract(a))!==canon(columnContract(b))) reasons.push('columns/types/defaults/PK');
    if(canon(fkContract(a))!==canon(fkContract(b))) reasons.push('foreign keys');
    if(canon(indexContract(a))!==canon(indexContract(b))) reasons.push('unique indexes');
    if(reasons.length)mismatched.push({table:name,reasons});
  }
  // Table names alone never prove full ERP readiness: migrations, triggers,
  // indexes, application data, session auth and transaction parity remain.
  return {expectedTables:expected.tables.length,foundTables:actual.tables.length,
    missing,extra,mismatched,tableStructureMatches:missing.length===0 &&
       extra.length===0 && mismatched.length===0,
    productionReady:false,requiresBackup:true,requiresDataMigrationReview:true};
}

/** This function produces a QA REVIEW ONLY; it does not execute SQL. */
export function planDisposableBaseline(ddl, report, {approvedDisposable=false}={}) {
  if (!approvedDisposable) throw Error('Explicit disposable QA database is required');
  if (!Array.isArray(ddl)||!report||!Array.isArray(report.missing) ||
      !Array.isArray(report.mismatched)||!Array.isArray(report.extra)) throw Error('Schema diff required');
  if (report.mismatched.length>0 || report.extra.length>0)
    return {blocked:true,reason:'Existing D1 tables differ; map columns and preserve data first',statements:[]};
  const map=new Map(ddl.map(d=>[d.name,d.sql]));
  if (report.missing.some(n=>!map.has(n)))
    return {blocked:true,reason:'Missing ERP table has no safe baseline DDL',statements:[]};
  return {blocked:false,disposableOnly:true,notProductionReady:true,
    statements:report.missing.map(n=>map.get(n))};
}

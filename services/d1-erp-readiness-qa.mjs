'use strict';
/**
 * Explicitly read-only, test-first Cloudflare D1 schema inspection.
 * No SQL DDL, no user/customer data reads, no migrations, no API deploy.
 * Screenshot table names are a user-supplied inventory,
 * NOT a live schema read or proof of table/column compatibility.
 */
export const SCREENSHOT_D1_APP_TABLES=Object.freeze([
 'bottle_returns','companies','customers','deliveries','inventory',
 'order_items','orders','payments','products','sync_queue','users'
]);
export const CRITICAL_ERP_TABLES=Object.freeze([
 'companies','users','sessions','customers','products','orders','order_items',
 'deliveries','delivery_otp_challenges','delivery_proofs','payments',
 'bottles','delivery_bottle_counts','bottle_movements',
 'offline_sync_operations','audit_logs'
]);
const tableId=name=>typeof name==='string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && name.length<=100;
const sorted=items=>[...new Set(items)].sort();
export function auditSchemaNames(erpTableNames,d1TableNames){
 if(!Array.isArray(erpTableNames)||!Array.isArray(d1TableNames)||![...erpTableNames,...d1TableNames].every(tableId))
  throw new Error('Untrusted schema inventory');
 const erp=sorted(erpTableNames),found=sorted(d1TableNames.filter(x=>!x.startsWith('sqlite_')));
 const expected=new Set(erp);
 const existing=found.filter(n=>expected.has(n));
 const missing=erp.filter(n=>!found.includes(n));
 const d1Only=found.filter(n=>!expected.has(n));
 return Object.freeze({
  expectedTotal:erp.length,d1Total:found.length,
  existing,missing,d1Only,
  ready:false, // tables alone can NEVER establish compatibility
  columnCompatibility:'unverified',
  status:'schema-and-data-migration-required'
 });
}
export async function inspectD1ReadOnly(d1,critical=CRITICAL_ERP_TABLES){
 if(!d1||typeof d1.prepare!=='function'||!Array.isArray(critical)||!critical.every(tableId))
  throw new Error('Verified D1 binding and schema identifiers required');
 const result=await d1.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
 if(!Array.isArray(result?.results))throw new Error('D1 schema listing failed');
 const tableNames=sorted(result.results.map(row=>row?.name).filter(tableId));
 const columns={};
 for(const name of sorted(critical)){
  if(!tableNames.includes(name)){columns[name]=null;continue;}
  // Identifier is validated and only derived from sqlite_master.
  const info=await d1.prepare("PRAGMA table_info('"+name+"')").all();
  if(!Array.isArray(info?.results))throw new Error('D1 column inspection failed');
  columns[name]=sorted(info.results.map(x=>x?.name).filter(tableId));
 }
 return {tableNames,columns};
}

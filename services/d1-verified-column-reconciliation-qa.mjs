'use strict';
/**
 * Reconcile the 2026-10-25 authenticated D1 schema-only observation against
 * the 116 source ERP declarations. Read-only analytical code: returns NO SQL.
 * IMPORTANT: ERP base CREATE TABLE is not the fully migrated runtime schema.
 */
const id = v => typeof v==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(v);
const sorted = items => [...new Set(items)].sort();

export function reconcileVerifiedD1Columns(baseProfile, sourceManifest, snapshot) {
 if(!baseProfile || !Array.isArray(baseProfile.tables) || !baseProfile.details ||
    baseProfile.tables.length!==115)
   throw Error('Complete verified base ERP schema profile required');
 if(!sourceManifest || sourceManifest.expectedTableCount!==116 ||
    !Array.isArray(sourceManifest.tableNames) || sourceManifest.tableNames.length!==116)
   throw Error('Pinned ERP 116-table manifest required');
 if(!snapshot || snapshot.schemaOnly!==true || snapshot.containsCustomerRecords!==false ||
    typeof snapshot.database!=='string' || !snapshot.database.trim() ||
    !snapshot.tables || typeof snapshot.tables!=='object')
   throw Error('Verified metadata-only D1 snapshot required');
 const existing=sorted(Object.keys(snapshot.tables));
 if(!existing.length)throw Error('Refuse empty D1 snapshot');
 const expected=sorted(sourceManifest.tableNames);
 const base=sorted(baseProfile.tables);
 if([expected,base,existing].some(list=>list.some(n=>!id(n))) ||
    base.some(n=>!expected.includes(n)) ||
    expected.filter(n=>!base.includes(n)).join(',')!=='document_records_v4')
   throw Error('Unexpected schema identifier or ERP source drift');
 for(const [name,table] of Object.entries(snapshot.tables)){
   if(!table || !Array.isArray(table.columns) ||
      table.columns.length===0 || table.columns.some(n=>!id(n)) ||
      new Set(table.columns).size!==table.columns.length)
     throw Error('Invalid D1 schema identifier or column list');
 }
 const overlap=expected.filter(n=>existing.includes(n));
 const missingErp=expected.filter(n=>!existing.includes(n));
 const baseMissing=base.filter(n=>!existing.includes(n));
 const d1Only=existing.filter(n=>!expected.includes(n));
 const tableDrift=[];
 for(const name of overlap) {
   const erp=baseProfile.details[name];
   if(!erp || !Array.isArray(erp.columns))throw Error('Base ERP profile incomplete');
   const sourceColumns=sorted(erp.columns.map(x=>x.name));
   if(sourceColumns.some(x=>!id(x)))throw Error('ERP base columns invalid');
   const d1Columns=sorted(snapshot.tables[name].columns);
   const baseOnlyColumns=sourceColumns.filter(x=>!d1Columns.includes(x));
   const d1OnlyColumns=d1Columns.filter(x=>!sourceColumns.includes(x));
   const sharedColumns=sourceColumns.filter(x=>d1Columns.includes(x));
   // Type, CHECK, FK, index, default, and populated data checks are further gates.
   if(baseOnlyColumns.length || d1OnlyColumns.length)
     tableDrift.push({table:name,baseOnlyColumns,d1OnlyColumns,sharedColumns,
       note:'Compared to ERP source base DDL only; runtime ALTER/index migration still unverified'});
 }
 const manualReview=[
   'users: D1 full_name/is_active versus ERP name/active; verify password hash algorithm, role mappings and tenant membership before auth migration.',
   'deliveries: D1 completed_at/completed versus ERP delivered_at/delivered; translate state machine with audited data mapping, never blind rename.',
   'payments: D1 payment_method/status versus ERP method/ledger direction/receipt fields; reconcile amounts and IDs before financial posting.',
   'orders and order_items: ERP requires company/order scopes and additional pricing/delivery columns; do not fill missing financial history with defaults.',
   'products and customers: ERP legacy base source is extended by runtime ALTER migrations, so examine post-initialize ERP schema rather than guessing.',
   'inventory, bottle_returns, sync_queue: D1-only tables need a documented reconciliation with ERP stock_movements, delivery_bottle_counts/bottle_movements, offline_sync_operations.',
   'Missing tables: order ERP base and subsequent service DDL, triggers, indexes and migration history on a *separate disposable D1* only.',
   'Before any migration: protected verified D1 backup, non-destructive fixture rehearsal, FK checks, two-tenant authorization and ledger/OTP rollback tests.'
 ];
 return Object.freeze({
   database:snapshot.database, observedD1Tables:existing.length, expectedErpTables:expected.length,
   overlap, missingErp, baseMissing, d1Only, tableDrift,
   manualReview, comparisonScope:'Cloudflare D1 observed column names versus ERP source base CREATE TABLE',
   runtimeErpColumns:'unverified',d1ColumnTypesKeysChecks:'not exhaustively compared',
   readiness:'blocked', productionReady:false, writeSafe:false, sqlToExecute:[]
 });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {extractPinnedErpBaseDdl,createDisposableErpSchema} from '../services/d1-erp-full-schema-preflight.mjs';
import {planMissingErpBaseTables,applyMissingErpBaseTablesLocally} from '../services/d1-erp-107-table-local-rehearsal.mjs';

const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const ddl=extractPinnedErpBaseDdl(source);
const matched=['companies','users','customers','products','orders','deliveries','payments'];
function fixture(t){
 const original=new DatabaseSync(':memory:'),qa=new DatabaseSync(':memory:');
 t.after(()=>{original.close();qa.close()});
 createDisposableErpSchema(original,ddl);
 for(const name of matched){
  const row=original.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name);
  assert.ok(row?.sql);
  qa.exec(row.sql);
 }
 qa.exec('CREATE TABLE bottle_returns(id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL,quantity INTEGER NOT NULL)');
 qa.prepare('INSERT INTO companies(id,name) VALUES(?,?)').run(40,'Synthetic preserved company');
 return {qa,original,count:()=>qa.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n};
}
test('TDD generate exactly the 107 absent ERP tables from PINNED source without modifying QA data',t=>{
 const f=fixture(t);
 const before=f.qa.prepare('SELECT total_changes() AS n').get().n;
 const plan=planMissingErpBaseTables({source,target:f.qa});
 assert.equal(plan.addedCount,107);
 assert.equal(plan.existingOverlap,7);
 assert.equal(plan.extraQaTables,1);
 assert.equal(plan.schemaReadyForRemoteMigration,false);
 assert.equal(plan.specialRebuildExcluded,'document_records_v4');
 assert.ok(plan.sqlStatements.every(x=>/^CREATE TABLE IF NOT EXISTS /i.test(x)));
 assert.equal(plan.sqlStatements.some(x=>/^(?:CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS)\s+document_records_v4\b|;\s*(?:DROP|UPDATE|DELETE|INSERT)\b/i.test(x)),false);
 assert.equal(f.count(),8);
 assert.equal(f.qa.prepare('SELECT total_changes() AS n').get().n,before);
});
test('TDD local additive migration creates exactly 107 missing safe tables and preserves synthetic users and all company records',t=>{
 const f=fixture(t);
 const beforeChanges=f.qa.prepare('SELECT total_changes() AS n').get().n;
 const first=applyMissingErpBaseTablesLocally({source,target:f.qa});
 assert.equal(first.addedCount,107);
 assert.equal(first.afterTableCount,115); // 114 pinned ERP safe base + Driver-only bottle_returns
 assert.equal(f.count(),115);
 assert.equal(f.qa.prepare('SELECT name FROM companies WHERE id=40').get().name,'Synthetic preserved company');
 assert.equal(f.qa.prepare('SELECT total_changes() AS n').get().n,beforeChanges);
 assert.deepEqual(f.qa.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(f.qa.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 assert.equal(f.qa.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='document_records_v4'").get().n,0);
 assert.equal(first.remoteD1Changed,false);
 assert.equal(first.activeWorkerDeployed,false);
 const second=applyMissingErpBaseTablesLocally({source,target:f.qa});
 assert.equal(second.addedCount,0);
 assert.equal(second.afterTableCount,115);
 assert.equal(f.qa.prepare('SELECT total_changes() AS n').get().n,beforeChanges);
});
test('TDD overlapping D1 users/payments schema mismatch must STOP before adding ANY missing table',t=>{
 const f=fixture(t);
 f.qa.exec('ALTER TABLE users ADD COLUMN is_active INTEGER');
 const before=f.count();
 assert.throws(()=>planMissingErpBaseTables({source,target:f.qa}),/STOP.*overlap|STOP.*drift/i);
 assert.throws(()=>applyMissingErpBaseTablesLocally({source,target:f.qa}),/STOP/);
 assert.equal(f.count(),before);
 assert.equal(f.qa.prepare('SELECT name FROM companies WHERE id=40').get().name,'Synthetic preserved company');
});
test('TDD missing original tenant core / shadow view / injected source cause fail-closed no partial migration',t=>{
 const f=fixture(t);
 const before=f.count();
 assert.throws(()=>planMissingErpBaseTables({source:source+' --tampered',target:f.qa}),/STOP/);
 f.qa.exec('DROP TABLE payments');
 assert.throws(()=>applyMissingErpBaseTablesLocally({source,target:f.qa}),/STOP.*core/i);
 assert.equal(f.count(),before-1);
 const g=fixture(t);
 g.qa.exec('CREATE VIEW credit_ledger AS SELECT id FROM companies');
 const original=g.count();
 assert.throws(()=>applyMissingErpBaseTablesLocally({source,target:g.qa}),/STOP.*collision/i);
 assert.equal(g.count(),original);
});
test('TDD remote D1-like bind cannot be used as the local SQLite migration target',()=>{
 assert.throws(()=>planMissingErpBaseTables({source,target:{prepare(){},exec(){}}}),/STOP/);
 assert.throws(()=>applyMissingErpBaseTablesLocally({source,target:{prepare(){},exec(){}}}),/STOP/);
});

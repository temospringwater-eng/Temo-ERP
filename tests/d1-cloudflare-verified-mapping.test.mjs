import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {extractErpTableDdl,inspectD1SchemaReadOnly} from '../services/d1-schema-parity-qa.mjs';
import {reconcileVerifiedD1Columns} from '../services/d1-verified-column-reconciliation-qa.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/live-d1-schema-20261025.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/erp-schema-table-names.json'),'utf8'));
const source=fs.readFileSync(path.join(root,'server.js'),'utf8');

async function expectedBase() {
 const db=new DatabaseSync(':memory:');
 for(const d of extractErpTableDdl(source))db.exec(d.sql);
 const d1={prepare(sql){return {all:async()=>({results:db.prepare(sql).all()})}}};
 const profile=await inspectD1SchemaReadOnly(d1);
 db.close();
 return profile;
}
test('TDD: browser-verified D1 schema fixture has 11 apps and no personal/customer rows',()=>{
 assert.equal(snapshot.database,'temo_erp_qa_db');
 assert.equal(snapshot.schemaOnly,true);
 assert.equal(snapshot.containsCustomerRecords,false);
 assert.equal(Object.keys(snapshot.tables).length,11);
 assert.deepEqual(snapshot.systemObjects,['_cf_KV']);
 for(const t of Object.values(snapshot.tables))assert.ok(t.columns.length>0);
});
test('TDD: verified table-name map distinguishes 108 absent ERP tables from 3 D1-only tables',async()=>{
 const diff=reconcileVerifiedD1Columns(await expectedBase(),manifest,snapshot);
 assert.deepEqual(diff.d1Only,['bottle_returns','inventory','sync_queue']);
 assert.equal(diff.overlap.length,8);
 assert.equal(diff.missingErp.length,108);
 assert.equal(diff.baseMissing.length,107);
 assert.equal(diff.readiness,'blocked');
 assert.equal(diff.productionReady,false);
 assert.equal(diff.writeSafe,false);
 assert.ok(diff.missingErp.includes('delivery_otp_challenges'));
 assert.ok(diff.missingErp.includes('delivery_proofs'));
 assert.ok(diff.missingErp.includes('audit_logs'));
});
test('TDD: critical ERP Driver column drift is explicitly identified rather than auto-renamed',async()=>{
 const diff=reconcileVerifiedD1Columns(await expectedBase(),manifest,snapshot);
 const row=name=>diff.tableDrift.find(x=>x.table===name);
 assert.ok(row('users').d1OnlyColumns.includes('full_name'));
 assert.ok(row('users').baseOnlyColumns.includes('name'));
 assert.ok(row('users').d1OnlyColumns.includes('is_active'));
 assert.ok(row('users').baseOnlyColumns.includes('active'));
 assert.ok(row('deliveries').d1OnlyColumns.includes('completed_at'));
 assert.ok(row('deliveries').baseOnlyColumns.includes('delivered_at'));
 assert.ok(row('payments').d1OnlyColumns.includes('payment_method'));
 assert.ok(row('payments').baseOnlyColumns.includes('method'));
 assert.equal(diff.tableDrift.length,8);
 assert.ok(diff.manualReview.some(x=>x.includes('delivered')));
});
test('TDD: no inferred create/rename/drop statements; stop even for partial D1 read',async()=>{
 assert.throws(()=>reconcileVerifiedD1Columns({},manifest,snapshot),/verified base/i);
 const expected=await expectedBase();
 const bad=structuredClone(snapshot);
 bad.tables.deliveries.columns.push("DROP TABLE users;");
 assert.throws(()=>reconcileVerifiedD1Columns(expected,manifest,bad),/schema identifier/i);
 const empty=structuredClone(snapshot);
 empty.tables={};
 assert.throws(()=>reconcileVerifiedD1Columns(expected,manifest,empty),/empty/i);
 const ok=reconcileVerifiedD1Columns(expected,manifest,snapshot);
 assert.deepEqual(ok.sqlToExecute,[]);
});

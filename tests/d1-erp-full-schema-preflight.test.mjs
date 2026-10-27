import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {
 extractPinnedErpBaseDdl,createDisposableErpSchema,
 inspectDisposableD1Compatibility
} from '../services/d1-erp-full-schema-preflight.mjs';

const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const CORE=['companies','users','customers','products','orders','deliveries','payments','bottle_returns'];
function driverQaFixture(){
 const d1=new DatabaseSync(':memory:');
 for(const name of CORE)d1.exec('CREATE TABLE "'+name+'"(id INTEGER PRIMARY KEY,company_id INTEGER,status TEXT)');
 d1.exec("INSERT INTO companies(id,company_id,status) VALUES(40,40,'synthetic')");
 return d1;
}
test('TDD source SHA pins all 114 safe ERP CREATE TABLE definitions; destructive rebuild excluded',()=>{
 const baseline=extractPinnedErpBaseDdl(source);
 assert.equal(baseline.length,114);
 assert.equal(new Set(baseline.map(x=>x.name)).size,114);
 assert.equal(baseline.some(x=>x.name==='document_records_v4'),false);
 for(const required of ['companies','users','customers','products','orders','deliveries',
  'payments','stock_movements','credit_ledger','bottle_movements','warehouses','sales','sale_items'])
  assert.ok(baseline.some(x=>x.name===required),required);
 assert.ok(baseline.every(x=>/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(x.sql)));
 assert.throws(()=>extractPinnedErpBaseDdl(source+'\n-- source changed'),/STOP/);
});
test('TDD disposable SQLite can build pinned 114 ERP base tables without reading customer data',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const result=createDisposableErpSchema(db,extractPinnedErpBaseDdl(source));
 assert.equal(result.created,114);
 assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,114);
 assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='document_records_v4'").get().n,0);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('TDD QA D1 8 overlapping driver tables do NOT imply ERP compatibility; original customer rows unchanged',t=>{
 const erp=new DatabaseSync(':memory:'),d1=driverQaFixture();t.after(()=>{erp.close();d1.close()});
 createDisposableErpSchema(erp,extractPinnedErpBaseDdl(source));
 const before=d1.prepare('SELECT count(*) AS n FROM companies').get().n;
 const report=inspectDisposableD1Compatibility({erp,d1});
 assert.equal(report.expectedSafeTables,114);
 assert.equal(report.overlap,7); // bottle_returns is a Driver-only table
 assert.equal(report.missingCount,107); // 114 safe ERP source tables minus seven overlapping
 assert.equal(report.deferredDestructiveTable,'document_records_v4');
 assert.equal(report.readyForRemoteMigration,false);
 assert.ok(report.columnDrift.length>0);
 assert.ok(report.columnDrift.some(x=>x.table==='users'));
 assert.equal(d1.prepare('SELECT count(*) AS n FROM companies').get().n,before);
});
test('TDD identical 114-table disposable schema is structurally ready, but 115th table and Worker cutover remain blocked',t=>{
 const erp=new DatabaseSync(':memory:'),d1=new DatabaseSync(':memory:');t.after(()=>{erp.close();d1.close()});
 const ddl=extractPinnedErpBaseDdl(source);
 createDisposableErpSchema(erp,ddl);createDisposableErpSchema(d1,ddl);
 const report=inspectDisposableD1Compatibility({erp,d1});
 assert.equal(report.missingCount,0);
 assert.deepEqual(report.columnDrift,[]);
 assert.equal(report.baseSchemaMatches,true);
 assert.equal(report.readyForRemoteMigration,false);
});
test('TDD reject malformed schema names and refuse unsupported missing signatures before inspection',t=>{
 const erp=new DatabaseSync(':memory:'),d1=new DatabaseSync(':memory:');t.after(()=>{erp.close();d1.close()});
 erp.exec('CREATE TABLE companies(id INTEGER)');
 d1.exec('CREATE TABLE companies(id INTEGER)');
 assert.throws(()=>inspectDisposableD1Compatibility({erp,d1}),/STOP/);
});

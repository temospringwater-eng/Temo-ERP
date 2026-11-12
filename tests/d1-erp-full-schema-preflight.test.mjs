import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {
 extractPinnedErpBaseDdl,createDisposableErpSchema,
 inspectDisposableD1Compatibility
} from '../services/d1-erp-full-schema-preflight.mjs';

import {planMissingErpBaseTables,applyMissingErpBaseTablesLocally} from '../services/d1-erp-107-table-local-rehearsal.mjs';

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

test('TDD same-column foreign-key drift must STOP even when 114 names and columns match',t=>{
 const erp=new DatabaseSync(':memory:'),d1=new DatabaseSync(':memory:');
 t.after(()=>{erp.close();d1.close()});
 const base=extractPinnedErpBaseDdl(source);
 createDisposableErpSchema(erp,base);
 const users=base.find(x=>x.name==='users');
 assert.ok(users);
 const weakened=users.sql.replace(/,\s*FOREIGN KEY\s*\(company_id\)\s*REFERENCES\s+companies\(id\)/i,'');
 assert.notEqual(weakened,users.sql,'test must actually remove the user-to-company FK');
 for(const table of base)d1.exec(table.name==='users'?weakened:table.sql);
 d1.prepare('INSERT INTO companies(id,name) VALUES(?,?)').run(40,'Synthetic tenant');
 d1.prepare('INSERT INTO users(id,company_id,username,password_hash,name,role) VALUES(?,?,?,?,?,?)')
   .run(41,40,'synthetic_driver','synthetic-hash-not-a-login','Synthetic user','driver');
 const count=()=>d1.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n;
 assert.equal(count(),114);
 const report=inspectDisposableD1Compatibility({erp,d1});
 assert.equal(report.missingCount,0);
 assert.deepEqual(report.columnDrift,[]);
 assert.equal(report.foreignKeyDrift.length,1);
 assert.equal(report.foreignKeyDrift[0].table,'users');
 assert.equal(report.baseSchemaMatches,false);
 assert.throws(()=>planMissingErpBaseTables({source,target:d1}),/STOP.*foreign.key/i);
 assert.throws(()=>applyMissingErpBaseTablesLocally({source,target:d1}),/STOP.*foreign.key/i);
 assert.equal(count(),114);
 assert.equal(d1.prepare('SELECT company_id FROM users WHERE id=41').get().company_id,40);
});

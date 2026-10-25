import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {extractErpTableDdl,inspectD1SchemaReadOnly,compareErpD1Schema,planDisposableBaseline}
  from '../services/d1-schema-parity-qa.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/erp-schema-table-names.json'),'utf8'));
const ddl=extractErpTableDdl(server);
function disposable() {
  const db=new DatabaseSync(':memory:');
  const log=[];
  const d1={prepare(sql){
    log.push(sql);
    return {all:async()=>({results:db.prepare(sql).all()})};
  }};
  return {db,d1,log,close:()=>db.close()};
}
async function baseline(){
  const x=disposable();
  for(const item of ddl)x.db.exec(item.sql);
  return {x,profile:await inspectD1SchemaReadOnly(x.d1)};
}
test('TDD: pinned 116 ERP source tables include 115 additive base DDL and one destructive migration excluded',()=>{
  assert.equal(manifest.expectedTableCount,116);
  assert.equal(ddl.length,115);
  assert.deepEqual([...ddl.map(x=>x.name),'document_records_v4'].sort(),manifest.tableNames);
  assert.ok(!ddl.some(x=>/\b(DROP|DELETE|INSERT|ALTER|UPDATE)\s+TABLE\b/i.test(x.sql)));
  assert.ok(ddl.some(x=>x.name==='deliveries'));
  assert.ok(ddl.some(x=>x.name==='delivery_otp_challenges'));
});
test('TDD integration: recreate all 115 base ERP tables on disposable SQLite with zero customer records',async t=>{
  const {x,profile}=await baseline();t.after(x.close);
  assert.equal(profile.tables.length,115);
  assert.ok(profile.tables.includes('companies'));
  assert.ok(profile.tables.includes('payments'));
  assert.ok(profile.details.deliveries.columns.some(c=>c.name==='order_id'));
  assert.ok(profile.details.deliveries.foreignKeys.some(c=>c.table==='orders'));
  assert.equal(x.db.prepare('SELECT COUNT(*) n FROM users').get().n,0);
});
test('TDD read-only D1 inspection uses only sqlite_master + PRAGMA and leaves synthetic customer unchanged',async t=>{
  const x=disposable();t.after(x.close);
  x.db.exec("CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO customers VALUES(1,'private fixture');");
  const profile=await inspectD1SchemaReadOnly(x.d1);
  assert.equal(profile.tables.length,1);
  assert.equal(profile.details.customers.columns.length,2);
  assert.equal(x.db.prepare('SELECT name FROM customers WHERE id=1').get().name,'private fixture');
  assert.ok(!JSON.stringify(profile).includes('private fixture'));
  assert.ok(x.log.every(q=>/^(SELECT name,type,tbl_name,sql FROM sqlite_master|PRAGMA (table_xinfo|foreign_key_list|index_list))/i.test(q)));
});
test('TDD: 11 photographed D1 names cannot be declared ERP parity from names alone',async t=>{
  const {x:ref,profile:expected}=await baseline();t.after(ref.close);
  const fake=disposable();t.after(fake.close);
  for(const name of ['bottle_returns','companies','customers','deliveries','inventory','order_items','orders','payments','products','sync_queue','users'])
    fake.db.exec('CREATE TABLE '+name+'(id INTEGER PRIMARY KEY)');
  const observed=await inspectD1SchemaReadOnly(fake.d1);
  const diff=compareErpD1Schema(expected,observed);
  assert.equal(diff.expectedTables,115);
  assert.equal(diff.foundTables,11);
  assert.equal(diff.missing.length,107);
  assert.deepEqual(diff.extra,['bottle_returns','inventory','sync_queue']);
  assert.equal(diff.mismatched.length,8);
  assert.equal(diff.productionReady,false);
  const plan=planDisposableBaseline(ddl,diff,{approvedDisposable:true});
  assert.equal(plan.blocked,true);
  assert.deepEqual(plan.statements,[]);
});
test('TDD: exact table structure in disposable clone compares clean; no claim of full production parity',async t=>{
  const {x,profile}=await baseline();t.after(x.close);
  const diff=compareErpD1Schema(profile,profile);
  assert.equal(diff.missing.length,0);
  assert.equal(diff.extra.length,0);
  assert.equal(diff.mismatched.length,0);
  assert.equal(diff.tableStructureMatches,true);
  assert.equal(diff.productionReady,false);
});
test('TDD: altered column or unique index fails closed, rather than masking with CREATE IF NOT EXISTS',async t=>{
  const {x,profile}=await baseline();t.after(x.close);
  const fake=disposable();t.after(fake.close);
  fake.db.exec('CREATE TABLE companies(id INTEGER PRIMARY KEY)');
  fake.db.exec('CREATE UNIQUE INDEX ux_companies_test ON companies(id)');
  const observed=await inspectD1SchemaReadOnly(fake.d1);
  const diff=compareErpD1Schema(profile,observed);
  assert.ok(diff.mismatched.some(e=>e.table==='companies'));
  assert.equal(planDisposableBaseline(ddl,diff,{approvedDisposable:true}).blocked,true);
});
test('TDD: explicit disposable baseline produces only CREATE TABLE statements and never executes them',async t=>{
  const {x,profile}=await baseline();t.after(x.close);
  const empty=disposable();t.after(empty.close);
  const diff=compareErpD1Schema(profile,await inspectD1SchemaReadOnly(empty.d1));
  assert.throws(()=>planDisposableBaseline(ddl,diff),/Explicit disposable/i);
  const plan=planDisposableBaseline(ddl,diff,{approvedDisposable:true});
  assert.equal(plan.blocked,false);
  assert.equal(plan.statements.length,115);
  assert.ok(plan.statements.every(s=>/^CREATE TABLE IF NOT EXISTS [A-Za-z_]/i.test(s)));
  assert.equal(empty.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n,0);
});
test('TDD: unknown special migration is blocked; unsafe source changes require review',async()=>{
  const src=server.replace('CREATE TABLE IF NOT EXISTS companies','CREATE TABLE IF NOT EXISTS companies_v2');
  assert.throws(()=>extractErpTableDdl(src.replace(/CREATE TABLE IF NOT EXISTS users/,'CREATE TABLE IF NOT EXISTS companies_v2')),/Unexpected ERP DDL/);
  assert.equal(planDisposableBaseline(ddl,
    {missing:['document_records_v4'],extra:[],mismatched:[]},{approvedDisposable:true}).blocked,true);
});

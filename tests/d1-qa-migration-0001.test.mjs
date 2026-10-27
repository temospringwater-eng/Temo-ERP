import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {extractPinnedErpBaseDdl,createDisposableErpSchema} from '../services/d1-erp-full-schema-preflight.mjs';
const rd=f=>readFileSync(new URL('../migrations/d1-qa/'+f,import.meta.url),'utf8');
const up=rd('0001_erp_sales_finance_stock_sync_additive.sql'),down=rd('0001_rollback_DISPOSABLE_ONLY.sql');
const NEW=['sales','sale_items','warehouses','stock_movements','bottles','bottle_movements','credit_ledger','offline_sync_operations'];
// Mirrors applicable ensureColumn additions, including the legacy tenant-column loop.
const RUNTIME_COLUMNS=[
 ['sales','company_id','INTEGER'],['sale_items','company_id','INTEGER'],
 ['sales','customer_id','INTEGER'],['sales','salesman_id','INTEGER'],
 ['sales','created_by','INTEGER'],['sales','invoice_number',"TEXT DEFAULT ''"],
 ['sales','status',"TEXT DEFAULT 'pending'"],['sales','discount','REAL DEFAULT 0'],
 ['sales','tax','REAL DEFAULT 0'],['sales','due_date','TEXT'],
 ['bottles','qr_code',"TEXT DEFAULT ''"],['bottles','barcode',"TEXT DEFAULT ''"],
 ['bottles','bottle_identifier',"TEXT DEFAULT ''"],
 ['bottle_movements','driver_id','INTEGER'],['bottle_movements','warehouse_id','INTEGER']
];
const tables=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name);
const cols=(db,t)=>db.prepare(`PRAGMA table_info(${t})`).all().map(c=>[c.name,c.type.toUpperCase(),c.notnull,c.pk].join(':')).sort();
function applyRuntimeColumns(db){
 for(const [table,column,definition] of RUNTIME_COLUMNS){
  if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column))
   db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
 }
}
function qa(){
 const full=new DatabaseSync(':memory:');
 createDisposableErpSchema(full,extractPinnedErpBaseDdl(readFileSync(new URL('../server.js',import.meta.url),'utf8')));
 applyRuntimeColumns(full);
 const db=new DatabaseSync(':memory:');
 for(const t of tables(full).filter(t=>!NEW.includes(t))){db.exec(full.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(t).sql)}
 return {full,db};
}
test('migration is additive only',()=>{
 assert.ok(!/\b(DROP|DELETE|UPDATE|INSERT|ALTER)\b/i.test(up));
 for(const m of up.matchAll(/CREATE (?:TABLE|INDEX) (?!IF NOT EXISTS)/g)) assert.fail('non idempotent '+m[0]);
});
test('applies idempotently, matches ERP columns, preserves data, isolates companies, rolls back',()=>{
 const {full,db}=qa();
 db.exec("INSERT INTO companies(id,name) VALUES(1,'A'),(2,'B')");
 const before=db.prepare('SELECT COUNT(*) n FROM companies').get().n,tb=tables(db).length;
 db.exec(up);db.exec(up);
 assert.equal(tables(db).length,tb+NEW.length);
 for(const t of NEW){
  const exp=new Set(cols(full,t)),act=new Set(cols(db,t));
  const missing=[...exp].filter(c=>!act.has(c));
  assert.deepEqual(missing,[],t);
 }
 assert.equal(db.prepare('SELECT COUNT(*) n FROM companies').get().n,before);
 db.exec('PRAGMA foreign_keys=OFF');
 db.exec("INSERT INTO offline_sync_operations(company_id,driver_id,idempotency_key,operation_type,request_hash) VALUES(1,5,'k','x','h')");
 assert.throws(()=>db.exec("INSERT INTO offline_sync_operations(company_id,driver_id,idempotency_key,operation_type,request_hash) VALUES(1,5,'k','x','h')"));
 db.exec("INSERT INTO offline_sync_operations(company_id,driver_id,idempotency_key,operation_type,request_hash) VALUES(2,5,'k','x','h')");
 db.exec(down);db.exec(down);
 assert.equal(tables(db).length,tb);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM companies').get().n,before);
});
test('foreign keys, unique constraints and indexes match canonical ERP server.js',()=>{
 const {full,db}=qa();db.exec(up);
 const fk=(d,t)=>d.prepare(`PRAGMA foreign_key_list(${t})`).all().map(r=>[r.from,r.table,r.to].join('>')).sort();
 const uq=(d,t)=>d.prepare(`PRAGMA index_list(${t})`).all().filter(i=>i.unique).map(i=>d.prepare(`PRAGMA index_info(${i.name})`).all().map(c=>c.name).join(',')).sort();
 for(const t of NEW){assert.deepEqual(fk(db,t),fk(full,t),'FK '+t);assert.deepEqual(uq(db,t),uq(full,t),'UNIQUE '+t);}
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const erpIdx=[...server.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)\s+ON (\w+)\(([^)]*)\)/g)].filter(m=>NEW.includes(m[2]));
 assert.ok(erpIdx.length>=8);
 for(const [,name,table,c] of erpIdx){
  const row=db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(name);
  assert.ok(row,'missing index '+name);
  assert.ok(row.sql.replace(/\s+/g,'').includes(`${table}(${c})`.replace(/\s+/g,'')),name);
 }
});

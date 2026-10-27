'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createErpD1QaReadinessHandler,ERP_D1_CORE_TABLES}=require('../services/erp-d1-worker-readiness-qa.mjs');
const secret='private-qa-diagnostic-only-secret-32bytes';
const url='https://internal-erp-qa.example.test/internal/qa/erp-d1-readiness';
const req=(token=secret,method='GET')=>new Request(url,{method,headers:token?{'x-temo-qa-token':token}:{}});
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON');
 const audit=[];
 const db={prepare(sql){audit.push(sql);return{async all(){return{results:sqlite.prepare(sql).all()}}}}};
 const env={DB:db,TEMO_ERP_D1_QA_MODE:'1',TEMO_ERP_QA_DIAGNOSTIC_SECRET:secret};
 return{sqlite,db,env,audit,close(){sqlite.close()}};
}
test('TDD Worker QA health never runs against production or unauthorized callers',async t=>{
 const f=fixture();t.after(f.close);
 const handler=createErpD1QaReadinessHandler();
 assert.equal((await handler(req(),{...f.env,TEMO_ERP_D1_QA_MODE:'0'})).status,404);
 assert.equal((await handler(req('wrong'),f.env)).status,401);
 assert.equal((await handler(req(null),f.env)).status,401);
 assert.equal((await handler(req(secret,'POST'),f.env)).status,405);
 assert.deepEqual(f.audit,[]);
});
test('TDD Cloudflare Worker D1 QA introspection with real SQLite reads schema ONLY',async t=>{
 const f=fixture();t.after(f.close);
 for(const name of ERP_D1_CORE_TABLES)
  f.sqlite.exec('CREATE TABLE '+name+'(id INTEGER PRIMARY KEY,company_id INTEGER)');
 const answer=await createErpD1QaReadinessHandler()(req(),f.env);
 assert.equal(answer.status,200);
 const body=await answer.json();
 assert.equal(body.canonicalSchemaReady,false,'11 core tables MUST NOT be treated as complete ERP D1');
 assert.equal(body.coreSchemaReady,true);
 assert.equal(body.baseSchemaNameAndColumnReady,false);
 assert.ok(body.missingTables.length>90);
 assert.equal(body.tableCount,ERP_D1_CORE_TABLES.length);
 assert.equal(body.qaOnly,true);
 assert.equal(body.financeCutoverAllowed,false);
 assert.equal(answer.headers.get('cache-control'),'no-store');
 assert.ok(f.audit.every(sql=>/^SELECT |^PRAGMA (?:table_info|foreign_key_list)\('/.test(sql)));
 assert.match(f.audit[0],/^SELECT name FROM sqlite_master/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM '+ERP_D1_CORE_TABLES[0]).get().n,0);
});
test('TDD missing central ERP D1 finance tables are reported without writing defaults',async t=>{
 const f=fixture();t.after(f.close);
 f.sqlite.exec('CREATE TABLE companies(id INTEGER PRIMARY KEY)');
 const result=await createErpD1QaReadinessHandler()(req(),f.env);
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.canonicalSchemaReady,false);
 assert.ok(data.missingTables.includes('credit_ledger'));
 assert.ok(data.missingTables.includes('bottle_movements'));
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n,1);
});
test('TDD missing D1 binding, short secrets or broken D1 fail closed and reveal no internals',async t=>{
 const f=fixture();t.after(f.close);
 const handler=createErpD1QaReadinessHandler();
 assert.equal((await handler(req(),{...f.env,DB:null})).status,503);
 assert.equal((await handler(req(),{...f.env,TEMO_ERP_QA_DIAGNOSTIC_SECRET:'short'})).status,404);
 const resp=await handler(req(),{...f.env,DB:{prepare(){throw Error('sensitive internal SQL data')}}});
 assert.equal(resp.status,503);
 assert.doesNotMatch(await resp.text(),/sensitive|SQL/);
});

test('TDD all 114 ERP base-table and 1137 base-column manifest entries match pinned source in independent SQLite',t=>{
 const {readFileSync}=require('node:fs');
 const {extractPinnedErpBaseDdl,createDisposableErpSchema}=require('../services/d1-erp-full-schema-preflight.mjs');
 const {ERP_D1_BASE_TABLES}=require('../services/d1-erp-base-table-manifest-qa.mjs');
 const {ERP_D1_BASE_COLUMNS}=require('../services/d1-erp-base-column-manifest-qa.mjs');
 const source=readFileSync(require('node:path').resolve(__dirname,'../server.js'),'utf8');
 const ddl=extractPinnedErpBaseDdl(source),sqlite=new DatabaseSync(':memory:');
 t.after(()=>sqlite.close());
 createDisposableErpSchema(sqlite,ddl);
 assert.deepEqual(ERP_D1_BASE_TABLES,ddl.map(x=>x.name).sort());
 assert.equal(Object.keys(ERP_D1_BASE_COLUMNS).length,114);
 for(const name of ERP_D1_BASE_TABLES){
  const actual=sqlite.prepare("PRAGMA table_info('"+name+"')").all().map(x=>[x.name,String(x.type).toUpperCase()]);
  assert.deepEqual(ERP_D1_BASE_COLUMNS[name],actual,name);
 }
});
test('TDD isolated D1 with all 114 base tables and required runtime tenant fields is only schema-ready; finance still disabled',async t=>{
 const {readFileSync}=require('node:fs');
 const {extractPinnedErpBaseDdl,createDisposableErpSchema}=require('../services/d1-erp-full-schema-preflight.mjs');
 const {ERP_D1_BASE_TABLES}=require('../services/d1-erp-base-table-manifest-qa.mjs');
 const f=fixture();t.after(f.close);
 const ddl=extractPinnedErpBaseDdl(readFileSync(require('node:path').resolve(__dirname,'../server.js'),'utf8'));
 createDisposableErpSchema(f.sqlite,ddl);
 for(const name of ERP_D1_CORE_TABLES)
  if(!ERP_D1_BASE_TABLES.includes(name))
   f.sqlite.exec('CREATE TABLE '+name+'(id INTEGER PRIMARY KEY,company_id INTEGER)');
 for(const [table,fields] of Object.entries({
  customers:{company_id:'INTEGER'},products:{company_id:'INTEGER'},
  payments:{company_id:'INTEGER',delivery_id:'INTEGER'}
 })){
  const actual=new Set(f.sqlite.prepare("PRAGMA table_info('"+table+"')").all().map(x=>x.name));
  for(const [field,type] of Object.entries(fields))
   if(!actual.has(field))f.sqlite.exec('ALTER TABLE '+table+' ADD COLUMN '+field+' '+type);
 }
 const handler=createErpD1QaReadinessHandler();
 const response=await handler(req(),f.env);
 assert.equal(response.status,200);
 const r=await response.json();
 assert.equal(r.coreSchemaReady,true);
 assert.equal(r.baseSchemaNameAndColumnReady,true);
 assert.equal(r.canonicalSchemaReady,true);
 assert.equal(r.missingTables.length,0);
 assert.equal(r.baseColumnGaps.length,0);
 assert.equal(r.criticalColumnGaps.length,0);
 assert.equal(r.financeCutoverAllowed,false,'only schema checks; no signed finance sync or deployment');
 assert.ok(f.audit.length>=114);
 assert.ok(f.audit.every(sql=>/^SELECT |^PRAGMA (?:table_info|foreign_key_list)\('/.test(sql)));
 assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,0);
});
test('TDD 114 table names with renamed users.active cannot pass full D1 base-column/tenant readiness',async t=>{
 const {readFileSync}=require('node:fs');
 const {extractPinnedErpBaseDdl,createDisposableErpSchema}=require('../services/d1-erp-full-schema-preflight.mjs');
 const f=fixture();t.after(f.close);
 createDisposableErpSchema(f.sqlite,extractPinnedErpBaseDdl(readFileSync(require('node:path').resolve(__dirname,'../server.js'),'utf8')));
 f.sqlite.exec('ALTER TABLE users RENAME COLUMN active TO is_active');
 const r=await createErpD1QaReadinessHandler()(req(),f.env);
 assert.equal(r.status,200);
 const data=await r.json();
 assert.equal(data.canonicalSchemaReady,false);
 assert.ok(data.baseColumnGaps.some(x=>x.table==='users'&&x.fields.includes('active')));
 assert.ok(data.criticalColumnGaps.some(x=>x.table==='users'&&x.fields.includes('active')));
 assert.equal(data.financeCutoverAllowed,false);
});
test('TDD malformed PRAGMA schema response refuses success without leaking D1 internals',async t=>{
 const f=fixture();t.after(f.close);
 f.sqlite.exec('CREATE TABLE companies(id INTEGER PRIMARY KEY)');
 const badDb={prepare(sql){
  if(sql.startsWith('SELECT '))return{all:async()=>({results:[{name:'companies'}]})};
  return{all:async()=>({success:false,results:[]})};
 }};
 const r=await createErpD1QaReadinessHandler()(req(),{...f.env,DB:badDb});
 assert.equal(r.status,503);
 assert.doesNotMatch(await r.text(),/SELECT|PRAGMA|customer|internal/i);
});

test('TDD pinned 276 ERP foreign keys match independent 114-table disposable SQLite baseline',t=>{
 const {readFileSync}=require('node:fs'),{resolve}=require('node:path');
 const {ERP_D1_BASE_FOREIGN_KEYS}=require('../services/d1-erp-base-fk-manifest-qa.mjs');
 const {extractPinnedErpBaseDdl,createDisposableErpSchema}=require('../services/d1-erp-full-schema-preflight.mjs');
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const source=readFileSync(resolve(__dirname,'../server.js'),'utf8');
 createDisposableErpSchema(sqlite,extractPinnedErpBaseDdl(source));
 let n=0;
 for(const [table,expected] of Object.entries(ERP_D1_BASE_FOREIGN_KEYS)){
  const fks=sqlite.prepare("PRAGMA foreign_key_list('"+table+"')").all()
   .map(r=>({from:r.from,table:r.table,to:r.to,onDelete:r.on_delete})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  assert.deepEqual(fks,expected,table);
  n+=fks.length;
 }
 assert.equal(n,276);
});
test('TDD 114 table-name and all column matches can NEVER pass when one ERP foreign key is missing',async t=>{
 const {readFileSync}=require('node:fs'),{resolve}=require('node:path');
 const {extractPinnedErpBaseDdl,createDisposableErpSchema}=require('../services/d1-erp-full-schema-preflight.mjs');
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 createDisposableErpSchema(sqlite,extractPinnedErpBaseDdl(readFileSync(resolve(__dirname,'../server.js'),'utf8')));
 const legacy=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get().sql;
 assert.match(legacy,/FOREIGN KEY/i);
 sqlite.exec('PRAGMA foreign_keys=OFF;BEGIN IMMEDIATE;');
 try{
  sqlite.exec("CREATE TABLE users_fk_replacement AS SELECT * FROM users WHERE 0");
  sqlite.exec('DROP TABLE users');
  sqlite.exec('ALTER TABLE users_fk_replacement RENAME TO users');
  sqlite.exec('COMMIT');
 }catch(e){sqlite.exec('ROLLBACK');throw e}
 const audit=[];
 const env={DB:{prepare(sql){audit.push(sql);return{all:async()=>({results:sqlite.prepare(sql).all()})}}},
  TEMO_ERP_D1_QA_MODE:'1',TEMO_ERP_QA_DIAGNOSTIC_SECRET:secret};
 const response=await createErpD1QaReadinessHandler()(req(),env),report=await response.json();
 assert.equal(response.status,200);
 assert.equal(report.canonicalSchemaReady,false);
 assert.ok(report.baseFkGaps.some(x=>x.table==='users'&&x.missing.some(r=>r.from==='company_id')));
 assert.equal(report.financeCutoverAllowed,false);
 assert.ok(audit.some(sql=>sql==="PRAGMA foreign_key_list('users')"));
});
test('TDD malformed FK metadata cannot be interpreted as a successful canonical ERP schema',async t=>{
 const f=fixture();t.after(f.close);
 f.sqlite.exec('CREATE TABLE companies(id INTEGER PRIMARY KEY)');
 const DB={prepare(sql){
  if(sql.startsWith('SELECT'))return{all:async()=>({results:[{name:'companies'}]})};
  if(sql.startsWith("PRAGMA table_info"))return{all:async()=>({results:[{name:'id',type:'INTEGER'}]})};
  return{all:async()=>({success:false,results:[]})};
 }};
 const response=await createErpD1QaReadinessHandler()(req(),{...f.env,DB});
 assert.equal(response.status,503);
 assert.equal((await response.json()).error,'qa_d1_schema_unavailable');
});

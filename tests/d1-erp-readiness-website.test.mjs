import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {auditSchemaNames, inspectD1ReadOnly, SCREENSHOT_D1_APP_TABLES, CRITICAL_ERP_TABLES} from '../services/d1-erp-readiness-qa.mjs';
import {createD1DriverReadOnlyHandler} from '../services/d1-driver-readonly-worker-qa.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sqlNamesFromRepo=()=>{
 const fixture=JSON.parse(fs.readFileSync(path.join(root,'tests','fixtures','erp-schema-table-names.json'),'utf8'));
 assert.equal(fixture.expectedTableCount,116);
 const serverPath=path.join(root,'server.js');
 if(fs.existsSync(serverPath)){
   const server=fs.readFileSync(serverPath,'utf8');
   const fresh=[...new Set([...server.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+["']?([A-Za-z_]\w*)/gi)].map(x=>x[1]))].sort();
   assert.deepEqual(fresh,fixture.tableNames,'ERP schema inventory fixture is stale');
 }
 return fixture.tableNames;
};
function syntheticD1(){
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE companies(id INTEGER PRIMARY KEY);CREATE TABLE users(id INTEGER PRIMARY KEY,company_id INTEGER,role TEXT,active INTEGER);CREATE TABLE orders(id INTEGER PRIMARY KEY,company_id INTEGER,customer_id INTEGER,status TEXT);CREATE TABLE deliveries(id INTEGER PRIMARY KEY,company_id INTEGER,order_id INTEGER,driver_id INTEGER,status TEXT);INSERT INTO users VALUES(11,1,'driver',1),(12,1,'driver',0),(21,2,'driver',1);INSERT INTO orders VALUES(201,1,41,'assigned'),(202,2,42,'assigned');INSERT INTO deliveries VALUES(301,1,201,11,'assigned'),(302,2,202,21,'assigned');");
 const queries=[];
 const d1={prepare(sql){
   queries.push(sql);
   return {
     bind(...params){return {all:async()=>({results:db.prepare(sql).all(...params)}),first:async()=>db.prepare(sql).get(...params)||null};},
     all:async()=>({results:db.prepare(sql).all()}),first:async()=>db.prepare(sql).get()||null
   };
 }};
 return {db,d1,queries,close(){db.close()}};
}
test('TDD: photographed D1 app names are not confused with full ERP schema',()=>{
 const report=auditSchemaNames(sqlNamesFromRepo(),SCREENSHOT_D1_APP_TABLES);
 assert.equal(report.existing.length,8);
 assert.deepEqual(report.d1Only,['bottle_returns','inventory','sync_queue']);
 assert.equal(report.expectedTotal,116);
 assert.equal(report.missing.length,108);
 assert.equal(report.ready,false);
 assert.equal(report.columnCompatibility,'unverified');
 assert.ok(report.missing.includes('delivery_otp_challenges'));
 assert.ok(report.missing.includes('audit_logs'));
 assert.ok(!SCREENSHOT_D1_APP_TABLES.includes('sqlite_sequence'));
});
test('TDD: inspector only issues schema reads, detects columns and returns no private rows',async t=>{
 const f=syntheticD1();t.after(f.close);
 const a=await inspectD1ReadOnly(f.d1,CRITICAL_ERP_TABLES);
 assert.equal(a.tableNames.includes('users'),true);
 assert.equal(a.tableNames.includes('deliveries'),true);
 assert.equal(a.columns.deliveries.includes('company_id'),true);
 assert.equal(a.columns.deliveries.includes('driver_id'),true);
 assert.ok(f.queries.every(q=>/^\s*(SELECT\s+name\s+FROM\s+sqlite_master|PRAGMA\s+table_info)/i.test(q)));
 assert.ok(!JSON.stringify(a).includes('Synthetic Customer'));
});
test('TDD: API requires trusted actor and restricts foreign company/driver',async t=>{
 const f=syntheticD1();t.after(f.close);
 const identity=async req=>req.headers.get('X-QA-Verified-Actor')==='v1'?{id:11,companyId:1,role:'driver'}:null;
 const handler=createD1DriverReadOnlyHandler({resolveActor:identity});
 const own=await handler(new Request('https://qa.invalid/api/driver/deliveries/301',{headers:{'X-QA-Verified-Actor':'v1'}}),{DB:f.d1});
 assert.equal(own.status,200);
 assert.deepEqual(await own.json(),{id:301,company_id:1,order_id:201,driver_id:11,status:'assigned'});
 const foreign=await handler(new Request('https://qa.invalid/api/driver/deliveries/302',{headers:{'X-QA-Verified-Actor':'v1'}}),{DB:f.d1});
 assert.equal(foreign.status,404);
 const missing=await handler(new Request('https://qa.invalid/api/driver/deliveries/301'),{DB:f.d1});
 assert.equal(missing.status,401);
});
test('TDD: read-only bridge ignores client companyId and rejects writes',async t=>{
 const f=syntheticD1();t.after(f.close);
 const handler=createD1DriverReadOnlyHandler({resolveActor:async()=>({id:11,companyId:1,role:'driver'})});
 const blocked=await handler(new Request('https://qa.invalid/api/driver/deliveries/301?companyId=2',{method:'POST',body:'{}'}),{DB:f.d1});
 assert.equal(blocked.status,405);
 const read=await handler(new Request('https://qa.invalid/api/driver/deliveries/301?companyId=2'),{DB:f.d1});
 assert.equal(read.status,200);
 assert.equal((await read.json()).company_id,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM deliveries').get().n,2);
 assert.ok(f.queries.every(q=>/^\s*(SELECT\s+name\s+FROM\s+sqlite_master|PRAGMA\s+table_info|SELECT\s+id,)/i.test(q)));
});
test('TDD: absent identity resolver and missing D1 schema fail closed',async t=>{
 const f=syntheticD1();t.after(f.close);
 assert.throws(()=>createD1DriverReadOnlyHandler({}),/trusted identity resolver/i);
 f.db.exec('ALTER TABLE deliveries RENAME TO delivery_archive');
 const handler=createD1DriverReadOnlyHandler({resolveActor:async()=>({id:11,companyId:1,role:'driver'})});
 const resp=await handler(new Request('https://qa.invalid/api/driver/deliveries/301'),{DB:f.d1});
 assert.equal(resp.status,503);
});
test('TDD: ERP public landing is responsive, accessible and links real existing login',()=>{
 const html=fs.readFileSync(path.join(root,'public','erp-landing-qa.html'),'utf8');
 assert.match(html,/<html lang="en"/);
 assert.match(html,/name="viewport"/);
 assert.match(html,/@media\s*\(max-width:/);
 assert.match(html,/href="\/index\.html"/);
 assert.match(html,/TEMO AQUAFLOW/);
 assert.match(html,/Driver App/);
 assert.match(html,/Company Dashboard/);
 assert.match(html,/<details/);
 assert.doesNotMatch(html,/admin123|value="admin"|fake-login|href="#"/i);
});
test('TDD: ERP login never ships hardcoded admin/admin123 prefills',()=>{
 const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
 assert.doesNotMatch(html,/id="loginPassword"[^>]*value="admin123"/i);
 assert.doesNotMatch(html,/id="loginUsername"[^>]*value="admin"/i);
});

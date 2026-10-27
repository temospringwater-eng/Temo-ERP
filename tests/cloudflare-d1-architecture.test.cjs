'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const plan=fs.readFileSync('docs/TEMO-ERP-DRIVER-MASTER-PLAN.md','utf8');
const decision=fs.readFileSync('docs/CLOUDFLARE-WORKERS-D1-ARCHITECTURE.md','utf8');
const {auditPortability}=require('../scripts/cloudflare-d1-portability-audit.cjs');
test('TDD: Cloudflare Workers + D1 replaces external Node hosting in official architecture',()=>{
 assert.match(plan,/Cloudflare Workers \+ D1/);
 assert.match(decision,/Cloudflare Workers \+ D1/);
 assert.doesNotMatch(plan+'\n'+decision,/\brender\b/i);
 assert.match(plan,/env\.DB/);
 assert.match(decision,/sqlite3/);
 assert.match(decision,/not directly portable/i);
});
test('TDD: never claim ERP finance sync live until D1 source-of-truth, migration and UAT gates pass',()=>{
 assert.match(decision,/canonical ERP D1/i);
 assert.match(decision,/separate QA D1/i);
 assert.match(decision,/no distributed transaction/i);
 assert.match(decision,/Time Travel/);
 assert.match(decision,/migration rollback/i);
 assert.match(plan,/zero live customer financial receipts synchronized/i);
});
test('TDD: existing Express/Node SQLite ERP cannot be declared Worker-D1 ready unchanged',()=>{
 const actual=fs.readFileSync('server.js','utf8');
 const report=auditPortability(actual);
 assert.equal(report.readyForWorkersD1,false);
 assert.deepEqual(report.blockers,['node-sqlite3','local-db-path','node-http-listener']);
});
test('TDD: pure Worker with D1 binding is recognized without inventing backend compatibility',()=>{
 const worker="export default { async fetch(request, env) { return Response.json(await env.DB.prepare('SELECT 1').first()); } }";
 const result=auditPortability(worker);
 assert.equal(result.readyForWorkersD1,true);
 assert.deepEqual(result.blockers,[]);
});

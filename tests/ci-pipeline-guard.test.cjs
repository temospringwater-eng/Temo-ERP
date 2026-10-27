'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const yaml=fs.readFileSync('.github/workflows/erp-driver-staging-qa.yml','utf8');

test('TDD: owning ERP CI runs all 51 app unit and integration tests on fresh QA DB only',()=>{
 assert.match(yaml,/NODE_ENV:\s*test/,'CI must never start server in production mode');
 assert.match(yaml,/TEMO_DRIVER_FIELD_OPS_QA:\s*['"]?0/,'driver finance QA must remain disabled outside disposable integration tests');
 assert.match(yaml,/node --test --test-force-exit --test-concurrency=1 --test-timeout=90000 tests\/\*\.test\.js/,'Full app suite must be mandatory, not just spot tests');
 assert.match(yaml,/tests\/bootstrap-security\.test\.js/,'Production-bootstrap security regression required');
});
test('TDD: owning CI executes independent SQLite driver field integration and source integrity',()=>{
 assert.match(yaml,/tests\/source-integrity\.test\.cjs/);
 assert.match(yaml,/tests\/driver-field-operations\.integration\.test\.cjs/);
 assert.match(yaml,/tests\/driver-field-six-modules\.integration\.test\.cjs/);
 assert.match(yaml,/timeout-minutes:\s*(?:1[0-5]|[1-9])\b/,'Bounded runner budget required');
 assert.doesNotMatch(yaml,/wrangler\s+deploy|cloudflare\s+deploy|\bnpm\s+run\s+deploy\b/i,'Never ship production in recovery CI');
});

test('TDD: ERP CI must prove disposable SQLite backup/restore without live-data access before release',()=>{
 assert.ok(yaml.includes('node --test tests/sqlite-restore-drill.test.cjs'),
  'Require isolated backup and restore drill in ERP CI');
 assert.ok(!yaml.includes('hayrila.db'),'CI must never read a tracked production-like ERP database');
});

test('TDD: full ERP regression MUST run after merge onto main, not PR only',()=>{
 assert.match(yaml,/^  push:\s*\n\s+branches:\s*\[main\]/m,
  'Merged main must run the same full unit/integration test workflow before claiming QA green');
 assert.match(yaml,/^  pull_request:/m,'Pre-merge PR validation still required');
 assert.match(yaml,/"services\/\*\*"/,'Production services must stay in CI path gate');
 assert.match(yaml,/"tests\/\*\*"/,'Unit and integration tests must stay in CI path gate');
});

test('TDD: native D1 readiness gate runs when its schema manifests or worker contract change',()=>{
 const nativeD1=fs.readFileSync('.github/workflows/erp-full-native-d1-local-qa.yml','utf8');
 for(const path of [
 "'services/erp-d1-worker-readiness-qa.mjs'",
 "'services/d1-erp-base-*-manifest-qa.mjs'",
 "'tests/erp-d1-worker-readiness.integration.test.cjs'"
 ]){
 assert.ok(nativeD1.split(path).length-1>=2,
  `Native D1 QA must watch ${path} on pull requests and main pushes`);
 }
 assert.match(nativeD1,/node --experimental-sqlite --test [^\n]*tests\/erp-d1-worker-readiness\.integration\.test\.cjs/,
 'Native D1 QA must execute the pinned schema, FK, and unique parity integration tests');
});

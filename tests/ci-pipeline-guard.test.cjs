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

test('TDD: private ERP Actions choose economical verified Linux slim runner',()=>{
 assert.match(yaml,/runs-on:\s*ubuntu-slim\b/,'Prefer 1-CPU Linux runner after independent full ERP test');
 assert.match(yaml,/timeout-minutes:\s*(?:[1-9]|1[0-5])\b/);
});

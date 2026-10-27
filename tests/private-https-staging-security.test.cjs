'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('scripts/private-https-staging-qa.js','utf8');
const ci=fs.readFileSync('.github/workflows/erp-driver-staging-qa.yml','utf8');
test('TDD: ephemeral TLS QA server uses isolated hosted QA mode and never exposes production seed',()=>{
 assert.match(source,/NODE_ENV:\s*'test'/);
 assert.match(source,/TEMO_ERP_HOSTED_QA:\s*'1'/);
 assert.match(source,/staging-qa\.db/);
 assert.doesNotMatch(source,/NODE_ENV:\s*'production'/);
 assert.match(source,/hostname:\s*'127\.0\.0\.1'/);
 assert.match(source,/server\.listen\(port,\s*'127\.0\.0\.1'/);
 assert.match(source,/rejectUnauthorized:\s*true/);
});
test('TDD: required ERP CI actually performs local TLS, default-password, auth and readiness integration',()=>{
 assert.match(ci,/node scripts\/private-https-staging-qa\.js/);
 assert.match(ci,/node --test tests\/private-https-staging-security\.test\.cjs/);
 assert.doesNotMatch(ci,/wrangler deploy|cloudflare deploy/i);
});

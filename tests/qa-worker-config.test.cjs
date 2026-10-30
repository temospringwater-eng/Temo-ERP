const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'config/wrangler.qa-d1.example.toml'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'worker/erp-d1-stage1-qa.mjs'), 'utf8');
test('QA config points to actual diagnostic Worker, not static assets', () => {
 assert.match(config, /^main = "worker\/erp-d1-stage1-qa\.mjs"$/m);
 assert.doesNotMatch(config, /^\[assets\]/m);
 assert.doesNotMatch(config, /^name = "temo-erp-qa-api"$/m);
 assert.match(worker, /createErpD1QaReadinessHandler/);
});
test('QA D1 binding points to the verified isolated QA database', () => {
 assert.match(config, /^binding = "DB"$/m);
 assert.match(config, /^database_id = "30f7fa07-1053-4fe3-8a3f-8089b146a271"$/m);
 assert.match(config, /^workers_dev = false$/m);
 assert.doesNotMatch(config, /^TEMO_ERP_QA_DIAGNOSTIC_SECRET\s*=/m);
});
test('QA mode and diagnostic route are intentionally restricted', () => {
 assert.match(config, /^TEMO_ERP_D1_QA_MODE = "1"$/m);
 const handler = fs.readFileSync(path.join(root, 'services/erp-d1-worker-readiness-qa.mjs'), 'utf8');
 assert.match(handler, /\/internal\/qa\/erp-d1-readiness/);
 assert.match(handler, /x-temo-qa-token/);
});

'use strict';
// Central ERP owns backend driver authorization. The native Android client lives
// in the separate babar200/TEMO-Driver-Android-QA private repository, where
// package signing, emulator, secure storage and offline UI regressions run.
// Do not make Central ERP recovery depend on a deleted in-repo Android subtree.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const code=()=>fs.readFileSync(path.join(root,'server.js'),'utf8');

test('native driver client remains in its separate repository, not the central ERP recovery tree',()=>{
  assert.equal(fs.existsSync(path.join(root,'android-driver')),false,
    'Android native client should be independently CI-tested in its own repository');
  for(const asset of ['public/index.html','public/customer.html'])
    assert.ok(fs.existsSync(path.join(root,asset)),'ERP web frontend missing: '+asset);
});

test('central ERP native driver endpoints enforce driver-only access, not admin access',()=>{
  const source=code();
  assert.match(source,/const mobileDriverRoles\s*=\s*\['driver', 'delivery_driver'\]/);
  for(const [method,route] of [
    ['get','/api/driver/deliveries'],
    ['post','/api/driver/deliveries/:id/otp'],
    ['post','/api/driver/deliveries/:id/action'],
    ['post','/api/driver/offline-sync'],
    ['get','/api/driver/offline-sync/status']
  ]){
    const signature=`app.${method}('${route}', requireRole(...mobileDriverRoles)`;
    assert.ok(source.includes(signature),'Missing driver-only role guard: '+signature);
  }
});

test('central ERP assigned deliveries bind the delivery to driver and company, never admin panel',()=>{
  const source=code();
  const start=source.indexOf("app.post('/api/driver/deliveries/:id/action'");
  const end=source.indexOf("app.post('/api/driver/offline-sync'",start);
  assert.ok(start>=0&&end>start,'Driver completion route missing');
  const action=source.slice(start,end);
  assert.match(action,/d\.company_id\s*=\s*\?\s+AND\s+d\.driver_id\s*=\s*\?/);
  assert.match(action,/req\.companyId, req\.user\.id/);
});

test('driver six-field financial QA can run only in non-production disposable QA database',()=>{
  const source=code();
  const start=source.indexOf('const fieldQaDbReady=');
  const end=source.indexOf('createDriverFieldOpsQa({',start);
  assert.ok(start>=0&&end>start,'Isolated driver field gate missing');
  const gate=source.slice(start,end);
  assert.match(gate,/process\.env\.NODE_ENV!=='production'/);
  assert.match(gate,/qa\[\^/); // Require explicit QA filename regex, not a broad DB toggle.
  assert.match(gate,/process\.env\.TEMO_DRIVER_FIELD_OPS_QA==='1'/);
  assert.match(source.slice(end,end+150),/qaEnabled:fieldQaDbReady/);
});

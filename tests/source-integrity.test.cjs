'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('ERP boot imports all exist after source recovery',()=>{
  const source=fs.readFileSync('server.js','utf8');
  const imported=[...source.matchAll(/require\(['"]\.(\/[^'"]+)['"]\)/g)].map(match=>match[1]);
  assert.ok(imported.length>=10,'expected full ERP boot import inventory');
  for(const file of imported)assert.ok(
    fs.existsSync(path.join(__dirname,'..',file+'.js')) ||
    fs.existsSync(path.join(__dirname,'..',file,'index.js')),
    'Missing ERP runtime module: '+file
  );
});
test('Company and customer frontend sources are available',()=>{
  for(const file of ['public/index.html','public/app.js','public/styles.css','public/customer.html','public/customer.js'])
    assert.ok(fs.existsSync(file),'Missing ERP frontend: '+file);
});
test('Driver field operations remain off outside explicit disposable QA database',()=>{
  const server=fs.readFileSync('server.js','utf8');
  assert.match(server,/process\.env\.NODE_ENV!=='production'/);
  assert.match(server,/process\.env\.TEMO_DRIVER_FIELD_OPS_QA==='1'/);
  assert.match(server,/qaEnabled:fieldQaDbReady/);
});

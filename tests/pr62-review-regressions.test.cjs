const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const wf=read('.github/workflows/erp-driver-staging-qa.yml');
const doc=read('docs/D1-QA-BACKUP-AND-SCHEMA-COMPARE-PROCEDURE.md');
const plan=read('docs/D1-QA-MIGRATION-0001-PLAN.md');
const section=name=>wf.slice(wf.indexOf('  '+name+':'));
const filters=()=>[...wf.matchAll(/paths:\n((?:\s+- ".*"\n)+)/g)].map(m=>m[1]);

test('#1 workflow runs on pull_request and push for every database/sidecar path and the guard is a CI step',()=>{
 const f=filters();assert.equal(f.length,2);
 for(const block of f)for(const p of ['"*.db"','"**/*.db"','"**/*.db-*"','"**/*.sqlite"','"**/*.sqlite-*"','"**/*.sqlite3"','"**/*.sqlite3-*"','".github/workflows/erp-driver-staging-qa.yml"'])
  assert.ok(block.includes(p),p);
 assert.match(wf,/tests\/no-tracked-database-files\.test\.cjs/);
});
test('#2 bootstrap test reads the child actual port, never pre-reserves one',()=>{
 const s=read('tests/bootstrap-security.test.js');
 assert.match(s,/PORT: '0'/);assert.ok(s.includes('Hayrila starter running at http:'));
 assert.doesNotMatch(s,/net\.createServer|freePort|reservedPorts/);
});
test('#3 migration test includes runtime ensureColumn additions present in server.js',()=>{
 const t=read('tests/d1-qa-migration-0001.test.mjs'),server=read('server.js');
 const needed=['sales','sale_items','bottles','bottle_movements'];
 for(const m of server.matchAll(/ensureColumn\('(\w+)', '(\w+)'/g))
  if(needed.includes(m[1])&&!['sales','sale_items'].includes(m[1])||m[1]==='sales')
   assert.ok(t.includes(`['${m[1]}','${m[2]}'`),m[1]+'.'+m[2]);
 assert.ok(t.includes("['sale_items','company_id'"));
});
test('#4 database guard matches db/sqlite/sqlite3 plus -wal/-shm, and gitignore covers them',()=>{
 const re=/\.(?:db|sqlite3?)(?:-(?:wal|shm))?$/i;
 for(const n of ['a.db','a.db-wal','a.db-shm','a.sqlite-wal','a.sqlite3-shm','x/y.SQLITE3'])assert.ok(re.test(n),n);
 assert.ok(!re.test('docs/a.sql'));
 const gi=read('.gitignore');for(const p of ['*.db','*.db-*','*.sqlite','*.sqlite-*','*.sqlite3','*.sqlite3-*','backups/'])assert.ok(gi.split('\n').includes(p),p);
});
test('#5 exports go only to ignored backups/ directory',()=>{
 for(const text of [doc,plan]){assert.doesNotMatch(text,/(?<!\w)backup\/[\w$()-]*\.sql|--output backup\.sql|<backup\.sql>/);}
 assert.match(doc,/mkdir -p backups/);assert.match(doc,/--output backups\//);
});
test('#6 schema comparison loop is executable shell',()=>{
 const m=doc.match(/for t in \$\(([\s\S]*?)\); do\n([\s\S]*?)\ndone/);
 assert.ok(m,'for ... do ... done');assert.doesNotMatch(doc,/list of 114/);
 assert.match(m[1],/d1-erp-base-table-manifest-qa\.mjs/);
});
test('#7 docs do not claim the 8-table migration closes the 114-table gap',()=>{
 assert.doesNotMatch(doc,/8 of the 114 absent|Expected before migration: 19 tables/);
 assert.match(doc,/partial proposal/);assert.match(plan,/partial proposal/);
 assert.doesNotMatch(plan,/existing 11 overlapping tables/);
});

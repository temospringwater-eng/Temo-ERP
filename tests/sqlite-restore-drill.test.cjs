'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const script=path.join(__dirname,'../scripts/sqlite-restore-drill.py');
const sha=path=>crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
function python(args){
 return spawnSync('python3',args,{encoding:'utf8',timeout:30000});
}
function temp(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'temo-erp-safe-restore-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return dir;
}
function seedQA(filepath){
 const source=`import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
c.execute("PRAGMA foreign_keys=ON")
c.executescript("CREATE TABLE owner(id INTEGER PRIMARY KEY,name TEXT);CREATE TABLE orders(id INTEGER PRIMARY KEY,owner_id INTEGER REFERENCES owner(id));INSERT INTO owner VALUES(1,'Synthetic QA');INSERT INTO orders VALUES(7,1);")
c.commit()
c.close()
`;
 const proc=python(['-c',source,filepath]);
 assert.equal(proc.status,0,proc.stderr);
}
test('TDD release gate: isolated SQLite restore has intact FK, checksum and source byte identity',t=>{
 const dir=temp(t),source=path.join(dir,'disposable-release-qa.db');
 seedQA(source);
 const before=sha(source);
 const run=python([script,'--source',source]);
 assert.equal(run.status,0,run.stderr);
 const report=JSON.parse(run.stdout.trim());
 assert.equal(report.success,true);
 assert.equal(report.mode,'isolated-read-only-restore-drill');
 assert.equal(report.source_unchanged,true);
 assert.equal(report.restored_copy_retained,false);
 assert.equal(report.sqlite_integrity,'ok');
 assert.equal(report.foreign_keys,'ok');
 assert.equal(report.table_count,2);
 assert.equal(report.row_count,2);
 assert.match(report.restored_sha256,/^[a-f0-9]{64}$/);
 assert.equal(sha(source),before,'never modify the source backup');
});
test('TDD release gate: corrupt and symlink SQLite inputs fail closed without source mutation',t=>{
 const dir=temp(t),valid=path.join(dir,'disposable-release-qa.db');
 seedQA(valid);
 const before=sha(valid);
 const corrupt=path.join(dir,'corrupt-qa.db');
 fs.writeFileSync(corrupt,Buffer.from('not-a-sqlite-database'));
 const broken=python([script,'--source',corrupt]);
 assert.notEqual(broken.status,0,'corrupt backup must not appear restored');
 assert.equal(JSON.parse(broken.stderr.trim()).success,false);
 const link=path.join(dir,'symlink-qa.db');
 fs.symlinkSync(valid,link);
 const symlink=python([script,'--source',link]);
 assert.notEqual(symlink.status,0,'symlinks must never be treated as trusted backup');
 assert.equal(JSON.parse(symlink.stderr.trim()).success,false);
 assert.equal(sha(valid),before);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const backup=path.join(__dirname,'../scripts/qa-sqlite-online-backup.py');
const restore=path.join(__dirname,'../scripts/sqlite-restore-drill.py');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const py=(...args)=>spawnSync('python3',args,{encoding:'utf8',timeout:30000});
function fixture(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'temo-phase1-qa-backup-'));
 const source=path.join(base,'persistent','temo-service-qa.db');
 const dest=path.join(base,'private-snapshots');
 fs.mkdirSync(path.dirname(source),{mode:0o700});
 fs.mkdirSync(dest,{mode:0o700});
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const seed=py('-c',[
  'import sqlite3,sys',
  'db=sqlite3.connect(sys.argv[1])',
  'db.executescript("PRAGMA foreign_keys=ON;CREATE TABLE company(id INTEGER PRIMARY KEY,name TEXT);CREATE TABLE invoices(id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL REFERENCES company(id),amount INTEGER NOT NULL);INSERT INTO company VALUES(1,\'QA synthetic\');INSERT INTO invoices VALUES(77,1,550);")',
  'db.commit();db.close()'
 ].join('\n'),source);
 assert.equal(seed.status,0,seed.stderr);
 return {base,source,dest};
}
function backupRun(src,dir){return py(backup,'--source',src,'--backup-dir',dir)}
test('TDD: live-compatible SQLite backup is private, immutable source, independently restorable',t=>{
 const f=fixture(t),before=sha(f.source);
 const result=backupRun(f.source,f.dest);
 assert.equal(result.status,0,result.stderr);
 const data=JSON.parse(result.stdout);
 assert.equal(data.success,true);
 assert.equal(data.mode,'isolated-qa-online-sqlite-backup');
 assert.equal(data.sqlite_integrity,'ok');assert.equal(data.foreign_keys,'ok');
 assert.match(data.sha256,/^[a-f0-9]{64}$/);
 assert.ok(fs.statSync(data.backup_path).isFile());
 assert.equal(path.dirname(data.backup_path),f.dest);
 assert.equal(fs.statSync(data.backup_path).mode&0o777,0o600);
 assert.equal(sha(data.backup_path),data.sha256);
 assert.equal(sha(f.source),before);
 const drill=py(restore,'--source',data.backup_path);
 assert.equal(drill.status,0,drill.stderr);
 const proof=JSON.parse(drill.stdout);
 assert.equal(proof.sqlite_integrity,'ok');assert.equal(proof.foreign_keys,'ok');
 assert.equal(proof.table_count,2);assert.equal(proof.row_count,2);
 assert.equal(fs.readdirSync(f.dest).length,1,'no intermediate backup files');
});
test('TDD: repeated backups create separate snapshots without overwrite',t=>{
 const f=fixture(t),one=backupRun(f.source,f.dest),two=backupRun(f.source,f.dest);
 assert.equal(one.status,0,one.stderr);assert.equal(two.status,0,two.stderr);
 const a=JSON.parse(one.stdout),b=JSON.parse(two.stdout);
 assert.notEqual(a.backup_path,b.backup_path);
 assert.equal(fs.readdirSync(f.dest).length,2);
});
test('TDD: reject symlinks, corrupt DB, normal ERP path, unsafe permissions and same directory',t=>{
 const f=fixture(t),before=sha(f.source);
 const normal=path.join(f.base,'hayrila.db');fs.copyFileSync(f.source,normal);
 const corrupt=path.join(f.base,'broken-qa.db');fs.writeFileSync(corrupt,'definitely not SQLite');
 const link=path.join(f.base,'linked-qa.db');fs.symlinkSync(f.source,link);
 const world=path.join(f.base,'world-snapshots');fs.mkdirSync(world,{mode:0o755});fs.chmodSync(world,0o755);
 const variants=[[normal,f.dest],[corrupt,f.dest],[link,f.dest],[f.source,world],[f.source,path.dirname(f.source)]];
 for(const [source,dest] of variants){
  const result=backupRun(source,dest);
  assert.notEqual(result.status,0,'unsafe config must fail: '+source);
  assert.match(result.stderr,/STOP|error|backup|QA|permissions|SQLite/i);
 }
 assert.equal(fs.readdirSync(f.dest).length,0);
 assert.equal(sha(f.source),before);
});
test('TDD: SQLite WAL pending commits included in consistent backup with active source connection',t=>{
 const f=fixture(t);
 const source=[
  'import sqlite3,subprocess,sys,json',
  'source,backup_script,dest,drill=sys.argv[1:]',
  'con=sqlite3.connect(source)',
  'con.execute("PRAGMA journal_mode=WAL")',
  'con.execute("INSERT INTO invoices VALUES(78,1,900)")',
  'con.commit()',
  'run=subprocess.run([sys.executable,backup_script,"--source",source,"--backup-dir",dest],capture_output=True,text=True,timeout=20)',
  'assert run.returncode==0,run.stderr',
  'snapshot=json.loads(run.stdout)["backup_path"]',
  'check=sqlite3.connect(snapshot)',
  'assert check.execute("SELECT COUNT(*) FROM invoices").fetchone()[0]==2',
  'check.close()',
  'assert subprocess.run([sys.executable,drill,"--source",snapshot],capture_output=True).returncode==0',
  'con.close()'
 ].join('\n');
 const run=py('-c',source,f.source,backup,f.dest,restore);
 assert.equal(run.status,0,run.stderr);
});

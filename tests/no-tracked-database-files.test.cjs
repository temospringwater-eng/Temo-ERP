const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const sqliteFile=/\.(?:db|sqlite3?)(?:-(?:wal|shm))?$/i;
test('git never tracks real SQLite/D1 database files',()=>{
 const files=execFileSync('git',['ls-files'],{cwd:__dirname+'/..',encoding:'utf8'}).split('\n');
 assert.ok(['customer.sqlite-wal','customer.sqlite3-wal','customer.db-shm'].every(f=>sqliteFile.test(f)));
 assert.deepEqual(files.filter(f=>sqliteFile.test(f)),[]);
});

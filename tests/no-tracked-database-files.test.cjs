const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
test('git never tracks real SQLite/D1 database files',()=>{
 const files=execFileSync('git',['ls-files'],{cwd:__dirname+'/..',encoding:'utf8'}).split('\n');
 assert.deepEqual(files.filter(f=>/\.(db|db-wal|db-shm|sqlite3?)$/i.test(f)),[]);
});

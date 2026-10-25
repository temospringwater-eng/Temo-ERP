'use strict';
// Real sqlite3 connection adapter for the existing ERP database file.
// EACH transaction uses a dedicated connection: no other Express requests can
// interleave their SQL on this connection between BEGIN and COMMIT.
function createSqlite3AtomicAdapter({sqlite3,dbPath}){
 if(!sqlite3?.Database || !dbPath || typeof dbPath!=='string')
   throw Error('Dedicated SQLite transaction requires a verified adapter and DB path');
 return {
  async transaction(fn){
   const handle=await new Promise((resolve,reject)=>{
    const db=new sqlite3.Database(dbPath,sqlite3.OPEN_READWRITE,(error)=>
      error?reject(error):resolve(db));
   });
   const exec=sql=>new Promise((resolve,reject)=>handle.exec(sql,err=>err?reject(err):resolve()));
   const get=(sql,...args)=>new Promise((resolve,reject)=>
     handle.get(sql,args,(error,row)=>error?reject(error):resolve(row)));
   const run=(sql,...args)=>new Promise((resolve,reject)=>
     handle.run(sql,args,function(error){
       if(error)reject(error);else resolve({changes:this.changes,lastID:this.lastID});
     }));
   let started=false;
   try{
    await exec('PRAGMA busy_timeout=5000');
    await exec('BEGIN IMMEDIATE');
    started=true;
    const outcome=await fn({get,run});
    await exec('COMMIT');
    started=false;
    return outcome;
   }catch(error){
    if(started){try{await exec('ROLLBACK');}catch(_ignored){}}
    throw error;
   }finally{
    await new Promise(resolve=>handle.close(()=>resolve()));
   }
  }
 };
}
module.exports={createSqlite3AtomicAdapter};

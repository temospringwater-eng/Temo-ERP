'use strict';
// Read-only portability report; does NOT connect to, change, or deploy any Cloudflare database.
function auditPortability(code){
 if(typeof code!=='string'||!code.trim())throw new Error('Source code required');
 const blockers=[];
 if(/require\(\s*['"]sqlite3['"]\s*\)|new\s+sqlite3\.Database\b/.test(code))
  blockers.push('node-sqlite3');
 if(/\bDB_PATH\b|new\s+sqlite3\.Database\s*\(|\bhayrila\.db\b/.test(code))
  blockers.push('local-db-path');
 if(/\bapp\.listen\s*\(|\bhttp\.createServer\s*\(/.test(code))
  blockers.push('node-http-listener');
 const hasD1Binding=/\benv\.DB\.prepare\s*\(/.test(code);
 return {
  readyForWorkersD1:blockers.length===0&&hasD1Binding,
  blockers,
  hasD1Binding,
  explanation:'D1 uses Workers env.DB bindings; Node sqlite3/local DB_PATH and app.listen are not a direct Workers deployment.'
 };
}
module.exports={auditPortability};
if(require.main===module){
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
 const result=auditPortability(source);
 console.log(JSON.stringify(result,null,2));
 if(!result.readyForWorkersD1)process.exitCode=2; // explicit refusal to describe migration as done
}

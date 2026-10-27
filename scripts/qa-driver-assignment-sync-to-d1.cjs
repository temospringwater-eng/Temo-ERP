'use strict';
// Manual QA source-to-D1 import. This script makes no ERP database edits.
// Run only after reviewing the D1 mapping, taking QA D1 backup, applying the
// additive migration to isolated staging and verifying the Worker preview.
const fs=require('node:fs');
const path=require('node:path');
const sqlite3=require('sqlite3').verbose();
const {buildQaDriverAssignmentSnapshot}=require('../services/driver-assignment-snapshot-qa');
const {sendSignedQaAssignmentSnapshot}=require('../services/driver-assignment-transport-qa');
const int=(key)=>{const text=process.env[key];if(!/^[1-9]\d{0,9}$/.test(text||''))throw Error('Invalid '+key);return Number(text);};
async function main(){
 const file=process.env.DB_PATH;
 if(process.env.NODE_ENV!=='test'||process.env.TEMO_QA_ASSIGNMENT_SYNC!=='1'||
  !file||!/(?:^|[\\/])[^\\/]*qa[^\\/]*\.db$/i.test(file)||
  path.resolve(file)===path.resolve(__dirname,'../hayrila.db'))
   throw Error('STOP: isolated QA-only assignment sync not authorized');
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink())
  throw Error('STOP: existing disposable QA SQLite file required');
 const date=process.env.TEMO_ASSIGNMENT_DATE;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))
  throw Error('STOP: explicit ISO assignment date required');
 const db=new sqlite3.Database(file,sqlite3.OPEN_READONLY);
 const query=(sql,args)=>new Promise((resolve,reject)=>db.all(sql,args,(err,rows)=>err?reject(err):resolve(rows)));
 try{
  const {snapshot,signature}=await buildQaDriverAssignmentSnapshot({
   query,dbPath:file,qaEnabled:true,nodeEnv:'test',
   secret:process.env.TEMO_QA_ASSIGNMENT_HMAC_SECRET,
   erpCompanyId:int('TEMO_ERP_COMPANY_ID'),erpDriverId:int('TEMO_ERP_DRIVER_ID'),
   d1CompanyId:int('TEMO_D1_COMPANY_ID'),d1DriverId:int('TEMO_D1_DRIVER_ID'),
   date,sequence:int('TEMO_QA_ASSIGNMENT_SEQUENCE')
  });
  const receipt=await sendSignedQaAssignmentSnapshot({
   snapshot,signature,origin:process.env.TEMO_QA_D1_ORIGIN,enabled:true,nodeEnv:'test'
  });
  // Identifiers, customer data and secrets deliberately never logged.
  console.log('QA_ERP_D1_ASSIGNMENTS_VERIFIED',JSON.stringify(receipt));
 }finally{await new Promise(resolve=>db.close(()=>resolve()));}
}
if(require.main===module)main().catch(e=>{
 console.error('STOP: ERP-to-D1 QA assignment sync not confirmed:',e.message);
 process.exitCode=1;
});
module.exports={main};

'use strict';
// Offline QA administration utility. No public API endpoint and no live ERP path.
// Trusted D1 receipt JSON must be signed by the source D1 Worker with a separate
// server-side secret. Store only on short-lived QA machines.
const fs=require('node:fs');
const path=require('node:path');
const sqlite3=require('sqlite3').verbose();
const {createDriverFinancialBridgeQa}=require('../services/driver-financial-bridge-qa');
async function main(){
 const filepath=process.env.TEMO_BRIDGE_RECEIPT_FILE;
 const dbPath=process.env.DB_PATH;
 if(process.env.NODE_ENV!=='test'||process.env.TEMO_FINANCE_BRIDGE_QA!=='1'||
    !filepath||!dbPath||!/(?:^|[\\/])[^\\/]*qa[^\\/]*\.db$/i.test(dbPath)||
    path.resolve(dbPath)===path.resolve(__dirname,'../hayrila.db'))
  throw Error('STOP: QA-only receipt import requires explicit opt-in and disposable QA database');
 const bytes=fs.readFileSync(filepath);
 if(bytes.length<100||bytes.length>100000)throw Error('STOP: signed receipt file size invalid');
 const envelope=JSON.parse(bytes.toString('utf8'));
 const service=createDriverFinancialBridgeQa({sqlite3,dbPath,
   secret:process.env.TEMO_D1_ERP_BRIDGE_SECRET,qaEnabled:true,nodeEnv:'test'});
 const receipt=await service.post(envelope);
 // No customer PII, JWT or proof image bytes in console output.
 console.log('QA_DRIVER_BRIDGE_POSTED',JSON.stringify({
  status:receipt.status,companyId:receipt.companyId,
  erpDeliveryId:receipt.erpDeliveryId,d1DeliveryId:receipt.d1DeliveryId}));
}
if(require.main===module)main().catch(e=>{
 console.error('STOP: QA finance bridge refused import:',e.message);
 process.exitCode=1;
});
module.exports={main};

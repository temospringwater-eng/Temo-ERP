'use strict';
const crypto=require('node:crypto');
const path=require('node:path');
// Serialize only QA bridge writers targeting the same disposable SQLite file.
// BEGIN IMMEDIATE still protects cross-process writes; this queue avoids busy-lock
// contention within a single Node process (including offline replay bursts).
const dbWriteTails=new Map();
function enqueueQaWrite(dbPath,work){
 const key=path.resolve(dbPath);
 const previous=dbWriteTails.get(key)||Promise.resolve();
 const active=previous.then(work);
 const tail=active.then(()=>undefined,()=>undefined);
 dbWriteTails.set(key,tail);
 return active.finally(()=>{if(dbWriteTails.get(key)===tail)dbWriteTails.delete(key)});
}
const {createSqlite3AtomicAdapter}=require('./driver-field-tx-qa');
const {bridgeSchema}=require('./driver-financial-bridge-schema-qa');
const safety=require('./driver-financial-bridge-validation-qa');
const {applyVerifiedBridgeReceipt}=require('./driver-financial-bridge-posting-qa');
function createDriverFinancialBridgeQa(config){
 const {sqlite3,dbPath,secret,qaEnabled=false,nodeEnv=process.env.NODE_ENV}=config||{};
 if(!qaEnabled||nodeEnv==='production'||!/(?:^|[\\/])[^\\/]*qa[^\\/]*\.db$/i.test(dbPath||''))
   safety.fail('QA-only disposable database required');
 if(!sqlite3?.Database)safety.fail('sqlite3 adapter missing');
 safety.signBridgeEvent(secret,{test:true});
 const adapter=createSqlite3AtomicAdapter({sqlite3,dbPath});
 return {async post({event,signature}){
  safety.validateBridgeEvent(event);
  safety.verifyBridgeSignature(secret,event,signature);
  const digest=crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
  return enqueueQaWrite(dbPath,()=>adapter.transaction(tx=>applyVerifiedBridgeReceipt(tx,event,digest)));

 }};
}
module.exports={bridgeSchema,signBridgeEvent:safety.signBridgeEvent,createDriverFinancialBridgeQa};

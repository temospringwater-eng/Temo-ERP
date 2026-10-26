'use strict';
const crypto=require('node:crypto');
const fail=msg=>{throw Error('QA bridge STOP: '+msg)};
const pos=x=>Number.isSafeInteger(x)&&x>0;
const count=x=>Number.isSafeInteger(x)&&x>=0&&x<=100000;
const hex=/^[a-f0-9]{64}$/;
function signBridgeEvent(secret,event){
 if(typeof secret!=='string'||Buffer.byteLength(secret)<32)fail('dedicated 32-byte HMAC secret missing');
 return crypto.createHmac('sha256',secret).update(JSON.stringify(event)).digest('hex');
}
function verifyBridgeSignature(secret,event,signature){
 if(typeof signature!=='string'||!hex.test(signature)||
    !crypto.timingSafeEqual(Buffer.from(signBridgeEvent(secret,event),'hex'),Buffer.from(signature,'hex')))
  fail('signature invalid');
}
function validateBridgeEvent(e){
 if(!e||typeof e!=='object'||Array.isArray(e)||e.status!=='completed')fail('only completed source event permitted');
 const s=e.source;
 if(!s||!['companyId','driverId','orderId','deliveryId'].every(k=>pos(s[k]))||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(s.idempotencyKey||'')||!hex.test(s.requestHash||''))
  fail('source event identity invalid');
 const pay=e.payment;
 if(!pay||typeof pay.amount!=='number'||!Number.isFinite(pay.amount)||pay.amount<0||
  pay.amount>1000000||Math.abs(Math.round(pay.amount*100)/100-pay.amount)>1e-8||
  !['cash','card','transfer','bank_transfer','other'].includes(pay.method))fail('payment invalid');
 if(!count(e.returnedCount)||!count(e.emptyCount))fail('bottle quantities invalid');
 const proof=e.proof;
 if(!proof||typeof proof!=='object')fail('proof missing');
 for(const kind of ['signature','photo']){
  const v=proof[kind];
  if(!v||!/^[a-zA-Z0-9._:/-]{3,250}$/.test(v.storageKey||'')||
   !hex.test(v.sha256||'')||!Number.isSafeInteger(v.byteSize)||v.byteSize<12||
   v.byteSize>524288||!['image/png','image/jpeg'].includes(v.contentType)||
   (kind==='signature'&&v.contentType!=='image/png'))fail('proof '+kind+' invalid');
 }
 const gps=proof.gps;
 if(!gps||typeof gps.latitude!=='number'||!Number.isFinite(gps.latitude)||
  Math.abs(gps.latitude)>90||typeof gps.longitude!=='number'||!Number.isFinite(gps.longitude)||
  Math.abs(gps.longitude)>180||typeof gps.accuracyMeters!=='number'||
  !Number.isFinite(gps.accuracyMeters)||gps.accuracyMeters<=0||gps.accuracyMeters>200)
  fail('GPS accuracy invalid');
 if(typeof gps.capturedAt!=='string'||!Number.isFinite(Date.parse(gps.capturedAt))||
  Math.abs(Date.now()-Date.parse(gps.capturedAt))>7*86400000)fail('GPS capturedAt invalid');
}
module.exports={signBridgeEvent,verifyBridgeSignature,validateBridgeEvent,fail,pos};

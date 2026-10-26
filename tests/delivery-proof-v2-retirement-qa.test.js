'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {deliveryProofPolicy,ensureNoLegacyDeliveryOtp,assertProofV2BridgeOnly}=require('../services/delivery-proof-v2-retirement-qa');
const qa='/tmp/temo-disposable-qa.db';
test('TDD: OTP-free delivery policy enabled only for disposable QA and explicit trusted proof mode',()=>{
 assert.equal(deliveryProofPolicy({NODE_ENV:'test',TEMO_DELIVERY_PROOF_MODE:'signature_photo_gps'},qa).otpRequired,false);
 assert.deepEqual(deliveryProofPolicy({NODE_ENV:'test',TEMO_DELIVERY_PROOF_MODE:'signature_photo_gps'},qa),{
  otpRequired:false,proofMode:'signature_photo_gps',signatureRequired:true,photoRequired:true,gpsRequired:true});
 assert.equal(deliveryProofPolicy({NODE_ENV:'production',TEMO_DELIVERY_PROOF_MODE:'signature_photo_gps'},qa).otpRequired,true);
 assert.equal(deliveryProofPolicy({NODE_ENV:'test',TEMO_DELIVERY_PROOF_MODE:'signature_photo_gps'},'/srv/hayrila.db').otpRequired,true);
 assert.equal(deliveryProofPolicy({NODE_ENV:'test'},qa).otpRequired,true);
});
test('TDD: retired delivery OTP cannot be requested or supplied in QA proof-v2',()=>{
 const env={NODE_ENV:'test',TEMO_DELIVERY_PROOF_MODE:'signature_photo_gps'};
 assert.equal(ensureNoLegacyDeliveryOtp(env,qa).status,410);
 assert.throws(()=>assertProofV2BridgeOnly({otpCode:'123456'},env,qa),/OTP/);
 assert.throws(()=>assertProofV2BridgeOnly({otpChallengeId:3},env,qa),/OTP/);
 assert.throws(()=>assertProofV2BridgeOnly({},env,qa),/signed bridge/);
 assert.equal(ensureNoLegacyDeliveryOtp({NODE_ENV:'production'},'/srv/hayrila.db'),null);
});
test('TDD: central ERP direct delivery and offline financial posting are denied until signed bridge is fully wired',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../services/driver-read-contract-qa.js'),'utf8');
 for(const exact of [
  "app.post('/api/driver/deliveries/:id/otp'",
  "app.post('/api/customer/deliveries/:id/otp'",
  "app.post('/api/driver/deliveries/:id/action'",
  "app.post('/api/driver/offline-sync'"
 ])assert.ok(src.includes(exact),exact);
 assert.match(src,/ensureNoLegacyDeliveryOtp\(process\.env,\s*process\.env\.DB_PATH\)/);
 assert.match(src,/assertProofV2BridgeOnly\(req\.body,process\.env,process\.env\.DB_PATH\)/);
 assert.match(src,/assertProofV2BridgeOnly\(operation\.payload,process\.env,process\.env\.DB_PATH\)/);
});

test('TDD integration: QA HTTP routes retire OTP and deny unsigned direct/offline payments before legacy handlers',async t=>{
 const express=require('express');
 const {createDriverReadContractQa}=require('../services/driver-read-contract-qa');
 const prior={mode:process.env.TEMO_DELIVERY_PROOF_MODE,db:process.env.DB_PATH,node:process.env.NODE_ENV};
 process.env.NODE_ENV='test';
 process.env.TEMO_DELIVERY_PROOF_MODE='signature_photo_gps';
 process.env.DB_PATH=qa;
 t.after(()=>{
  for(const [name,value] of [['TEMO_DELIVERY_PROOF_MODE',prior.mode],['DB_PATH',prior.db],['NODE_ENV',prior.node]])
   if(value===undefined)delete process.env[name];else process.env[name]=value;
 });
 const app=express();
 app.use(express.json());
 app.use((req,_res,next)=>{
  if(req.headers.authorization==='Bearer driver'){
   req.user={id:7,role:'driver',company_id:4};req.companyId=4;
  }else if(req.headers.authorization==='Bearer customer'){
   req.user={id:8,role:'customer',company_id:4,customer_id:31};req.companyId=4;
  }
  next();
 });
 const query=async(sql,args)=>{
  if(sql.includes('FROM deliveries WHERE'))return args[0]===99&&args[1]===4&&args[2]===7?[{id:99}]:[];
  if(sql.includes('FROM deliveries d JOIN orders o'))return args[0]===99&&args[1]===4&&args[2]===31?[{id:99}]:[];
  return [];
 };
 createDriverReadContractQa({app,query,qaEnabled:true});
 let legacyCalls=0;
 for(const route of ['/api/driver/deliveries/:id/otp',
  '/api/customer/deliveries/:id/otp','/api/driver/deliveries/:id/action','/api/driver/offline-sync'])
  app.post(route,(_req,res)=>{legacyCalls++;res.json({unsafe:true});});
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const root='http://127.0.0.1:'+server.address().port;
 const request=async(path,token,body={})=>{
  const response=await fetch(root+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
 };
 const driverOtp=await request('/api/driver/deliveries/99/otp','driver');
 assert.equal(driverOtp.status,410);
 const customerOtp=await request('/api/customer/deliveries/99/otp','customer');
 assert.equal(customerOtp.status,410);
 assert.equal((await request('/api/driver/deliveries/99/otp','driver',{otpRequired:false})).status,410);
 assert.equal((await request('/api/driver/deliveries/99/action','driver',{action:'deliver',otpCode:'000000'})).status,400);
 assert.equal((await request('/api/driver/deliveries/99/action','driver',{action:'deliver',signature:{},photo:{},gps:{}})).status,409);
 assert.equal((await request('/api/driver/offline-sync','driver',{operations:[{operationType:'deliver',payload:{}}]})).status,409);
 assert.equal((await request('/api/driver/deliveries/123/otp','driver')).status,404);
 assert.equal((await request('/api/driver/deliveries/99/otp','unknown')).status,401);
 assert.equal(legacyCalls,0);
});

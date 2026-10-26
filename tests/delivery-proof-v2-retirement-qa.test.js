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
 assert.match(src,/ensureNoLegacyDeliveryOtp\(process\.env, process\.env\.DB_PATH\)/);
 assert.match(src,/assertProofV2BridgeOnly\(req\.body,process\.env,process\.env\.DB_PATH\)/);
 assert.match(src,/assertProofV2BridgeOnly\(operation\.payload,process\.env,process\.env\.DB_PATH\)/);
});

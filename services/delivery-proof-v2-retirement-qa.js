'use strict';
// Delivery OTP retirement is QA-gated. Login/forgot-password verification is unrelated.
const proof={otpRequired:false,proofMode:'signature_photo_gps',signatureRequired:true,photoRequired:true,gpsRequired:true};
function isProofV2Qa(env,dbPath){
 return env?.NODE_ENV!=='production'&&env?.TEMO_DELIVERY_PROOF_MODE==='signature_photo_gps'&&
  typeof dbPath==='string'&&/(?:^|[\\/])[^\\/]*qa[^\\/]*\\.db$/i.test(dbPath);
}
function deliveryProofPolicy(env,dbPath){
 return isProofV2Qa(env,dbPath)?{...proof}:{otpRequired:true,source:'legacy-until-verified-migration'};
}
function ensureNoLegacyDeliveryOtp(env,dbPath){
 return isProofV2Qa(env,dbPath)?{status:410,message:'Delivery OTP retired; signature, photo and GPS are required'}:null;
}
function assertProofV2BridgeOnly(payload,env,dbPath){
 if(!isProofV2Qa(env,dbPath))return null;
 const reject=(status,code,message)=>{
  const error=Object.assign(new Error(message),{status,code,conflict:status===409});
  throw error;
 };
 if(payload?.otpCode!==undefined||payload?.otpChallengeId!==undefined||payload?.otpRequired!==undefined)
  reject(400,'DELIVERY_OTP_RETIRED','Delivery OTP is retired and is not accepted in proof-v2 mode');
 reject(409,'proof_v2_bridge_required','Delivery requires signed bridge with signature, photo and GPS; legacy direct financial posting blocked');
}
module.exports={isProofV2Qa,deliveryProofPolicy,ensureNoLegacyDeliveryOtp,assertProofV2BridgeOnly};

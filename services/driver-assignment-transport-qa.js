'use strict';
// Outbound QA-only, one-shot, verified HTTPS transport for signed ERP assignment
// snapshots. Does not use browser/driver auth, touch live hayrila.db or send
// payments, stock or proof events. Operator runs separately after QA approvals.
const QA_ORIGINS=new Set([
 'https://temo-erp-qa-api.temospringwater.workers.dev',
 'https://driver-proof-v2-qa-temo-erp-qa-api.temospringwater.workers.dev'
]);
function required(flag,message){if(!flag)throw Error(message);}
async function sendSignedQaAssignmentSnapshot({
 snapshot,signature,origin,enabled=false,nodeEnv=process.env.NODE_ENV,
 fetchImpl=fetch
}={}){
 required(enabled===true&&nodeEnv==='test','QA-only assignment transport disabled');
 required(typeof origin==='string'&&QA_ORIGINS.has(origin),
  'QA Worker origin must match approved HTTPS allowlist');
 required(snapshot&&snapshot.version===1&&Number.isSafeInteger(snapshot.sequence)&&
  snapshot.sequence>0&&typeof snapshot.date==='string'&&
  Array.isArray(snapshot.rows)&&snapshot.rows.length<=100,
  'Invalid QA assignment snapshot');
 required(typeof signature==='string'&&/^[a-f0-9]{64}$/.test(signature),
  'Invalid QA signed assignment signature');
 required(typeof fetchImpl==='function','QA transport unavailable');
 const response=await fetchImpl(origin+'/__qa/erp/driver-assignments',{
  method:'POST',redirect:'error',headers:{'content-type':'application/json','accept':'application/json'},
  body:JSON.stringify({snapshot,signature}),signal:AbortSignal.timeout(18000)
 });
 if(!response||response.status!==200||!response.ok)
  throw Error('QA assignment import rejected; no ERP-to-D1 sync confirmed');
 let receipt;
 try {receipt=await response.json();}catch {throw Error('QA import receipt is not JSON');}
 required(receipt&&receipt.success===true&&
  receipt.date===snapshot.date&&receipt.sequence===snapshot.sequence&&
  receipt.applied===snapshot.rows.length&&receipt.readBack===snapshot.rows.length&&
  typeof receipt.replayed==='boolean',
  'QA D1 receipt/read-back not verified');
 return {success:true,date:receipt.date,sequence:receipt.sequence,
  readBack:receipt.readBack,replayed:receipt.replayed};
}
module.exports={sendSignedQaAssignmentSnapshot};

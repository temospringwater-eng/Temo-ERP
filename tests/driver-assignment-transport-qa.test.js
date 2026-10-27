'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {sendSignedQaAssignmentSnapshot}=require('../services/driver-assignment-transport-qa');
const ORIGIN='https://temo-erp-qa-api.temospringwater.workers.dev';
const key='only-for-test-qa-assignment-key-with-no-real-records';
const snapshot={version:1,issuedAt:'2026-10-27T04:00:00Z',sequence:4,date:'2026-10-27',
 company:{erpId:51,d1Id:1},driver:{erpId:53,d1Id:3},
 rows:[{deliveryId:81,orderId:71,customerName:'Dummy',phone:'000',
 address:'Test St',totalAmount:450,status:'assigned',scheduledDate:'2026-10-27'}]};
const signature='b'.repeat(64);
const config=(fetchImpl)=>({snapshot,signature,origin:ORIGIN,enabled:true,nodeEnv:'test',fetchImpl});

test('TDD: HTTPS server-to-server QA snapshot reaches exact endpoint with no redirect and verified D1 receipt',async()=>{
 let seen;
 const fetchImpl=async(url,opts)=>{seen={url,opts};
  return {ok:true,status:200,async json(){return {
   success:true,sequence:4,date:'2026-10-27',applied:1,readBack:1,replayed:false
  };}};
 };
 const result=await sendSignedQaAssignmentSnapshot(config(fetchImpl));
 assert.equal(result.readBack,1);
 assert.equal(seen.url,ORIGIN+'/__qa/erp/driver-assignments');
 assert.equal(seen.opts.redirect,'error');
 assert.equal(seen.opts.method,'POST');
 assert.deepEqual(JSON.parse(seen.opts.body),{snapshot,signature});
 assert.equal(seen.opts.headers['content-type'],'application/json');
});

test('TDD: normal production, unapproved destination, malformed signature and no opt-in never send',async()=>{
 let calls=0;const mock=async()=>{calls++;throw Error('Unexpected network');};
 for(const change of [
  {enabled:false},{nodeEnv:'production'},
  {origin:'https://attacker.example'},{origin:'http://temo-erp-qa-api.temospringwater.workers.dev'},
  {origin:ORIGIN+'/api/health'},{signature:'short'},{snapshot:{...snapshot,rows:null}}
 ])await assert.rejects(sendSignedQaAssignmentSnapshot({...config(mock),...change}),/QA|origin|signature|snapshot|disabled/i);
 assert.equal(calls,0);
});

test('TDD: missing or conflicting D1 readback never reports synchronization successful',async()=>{
 for(const [status,payload] of [
 [200,{success:true,sequence:4,date:snapshot.date,applied:1,readBack:0}],
 [200,{success:true,sequence:5,date:snapshot.date,applied:1,readBack:1}],
 [409,{error:'mapping conflict'}],
 [500,{error:'server unavailable'}]
 ]) {
  const f=async()=>({ok:status===200,status,async json(){return payload;}});
  await assert.rejects(sendSignedQaAssignmentSnapshot(config(f)),/verified|rejected|receipt|read.back|QA/i);
 }
});

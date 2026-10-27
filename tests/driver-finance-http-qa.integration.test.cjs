'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),crypto=require('node:crypto');
const {createDriverFinanceHttpQa,requestMac}=require('../services/driver-finance-http-qa');
const transportSecret='transport-secret-separated-from-receipt-signature-2026';
const proofSecret='proof-hmac-secret-is-independent-12345';
const event={source:{companyId:1,deliveryId:301,idempotencyKey:'delivery-301-qa'},status:'completed'};
function setup(post=async()=>({status:'applied',erpDeliveryId:801,d1DeliveryId:301,d1CompanyId:1,companyId:40,paymentId:991})){
 const app=express(),calls=[];
 const signer=(stamp,body)=>requestMac(transportSecret,stamp,body);
 createDriverFinanceHttpQa({app,qaEnabled:true,nodeEnv:'test',dbPath:'/tmp/finance-test-qa.db',
  transportSecret,receiptSecret:proofSecret,service:{post:async payload=>{calls.push(payload);return post(payload);}}});
 return {app,calls,signer};
}
async function start(t,post){
 const f=setup(post),server=f.app.listen(0,'127.0.0.1');await new Promise(ok=>server.once('listening',ok));
 t.after(()=>new Promise(ok=>server.close(ok)));
 return {...f,url:'http://127.0.0.1:'+server.address().port+'/internal/qa/d1-driver-finance'};
}
async function send(f,{body=JSON.stringify({event,signature:'a'.repeat(64)}),
 stamp=String(Date.now()),mac=f.signer(stamp,body),headers={},method='POST'}={}){
 const response=await fetch(f.url,{method,headers:{'content-type':'application/json',
  'x-temo-qa-timestamp':stamp,'x-temo-qa-auth':mac,...headers},body:method==='POST'?body:undefined});
 const raw=await response.text();
 return {status:response.status,raw,headers:response.headers,data:JSON.parse(raw)};
}
test('TDD private QA endpoint signs authenticated success acknowledgement and replays same receipt once',async t=>{
 const f=await start(t);
 const a=await send(f);
 assert.equal(a.status,200,a.raw);
 assert.equal(a.data.receipt.erpDeliveryId,801);
 assert.equal(a.data.receipt.d1CompanyId,1);
 assert.equal(a.data.receipt.companyId,40);
 assert.equal(f.calls.length,1);
 assert.equal(a.headers.get('cache-control'),'no-store');
 const header=a.headers.get('x-temo-qa-ack');
 assert.equal(header,requestMac(transportSecret,a.headers.get('x-temo-qa-ack-time'),a.raw));
});
test('TDD malformed, expired, forged transport requests never reach ERP ledger',async t=>{
 const f=await start(t);
 const body=JSON.stringify({event,signature:'a'.repeat(64)});
 for(const props of [
  {headers:{'x-temo-qa-auth':'0'.repeat(64)}},
  {stamp:String(Date.now()-1000*60*15)},
  {body:body.slice(0,-2)+'42}'},
  {headers:{'content-type':'text/plain'}},
  {body:'not-json'},
  {body:JSON.stringify({event})}
 ]){const r=await send(f,props);assert.ok(r.status>=400,r.raw)}
 assert.equal(f.calls.length,0);
});
test('TDD no route when QA opt-in missing, prod environment or main ERP database',async t=>{
 for(const [qaEnabled,nodeEnv,dbPath] of [[false,'test','/tmp/x-qa.db'],[true,'production','/tmp/x-qa.db'],[true,'test','/srv/hayrila.db']]){
  const app=express();
  assert.equal(createDriverFinanceHttpQa({app,qaEnabled,nodeEnv,dbPath,transportSecret,
   receiptSecret:proofSecret,service:{post:async()=>({})}}),false);
  const server=app.listen(0,'127.0.0.1');await new Promise(ok=>server.once('listening',ok));
  t.after(()=>new Promise(ok=>server.close(ok)));
  const res=await fetch('http://127.0.0.1:'+server.address().port+'/internal/qa/d1-driver-finance',{method:'POST'});
  assert.equal(res.status,404);
 }
});
test('TDD backend posting error reveals no sensitive SQL or credentials, never acknowledges',async t=>{
 const f=await start(t,async()=>{throw Error('SQL tenant_table secret string')});
 const v=await send(f);
 assert.equal(v.status,409);
 assert.equal(v.headers.get('x-temo-qa-ack'),null);
 assert.doesNotMatch(v.raw,/SQL|secret|tenant_table/);
});

test('TDD signed HTTP ACK must reject a different D1 origin company even with valid transport HMAC',async t=>{
 const f=await start(t,async()=>({status:'applied',erpDeliveryId:801,d1DeliveryId:301,d1CompanyId:2,companyId:40}));
 const response=await send(f);
 assert.equal(response.status,409);
 assert.equal(response.headers.get('x-temo-qa-ack'),null);
});
test('TDD signed HTTP ACK must reject invalid ERP target company ID and missing source company',async t=>{
 for(const receipt of [
  {status:'applied',erpDeliveryId:801,d1DeliveryId:301,d1CompanyId:1,companyId:0},
  {status:'applied',erpDeliveryId:801,d1DeliveryId:301,companyId:40},
 ]){
  const f=await start(t,async()=>receipt);
  const response=await send(f);
  assert.equal(response.status,409);
  assert.equal(response.headers.get('x-temo-qa-ack'),null);
 }
});

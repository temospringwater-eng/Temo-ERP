import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1DeliveryPreflightQaHandler} from '../services/d1-driver-delivery-preflight-qa.mjs';
const url='https://qa.example/api/driver/deliveries/19/preflight';
const proof={signatureRef:'signed-1234',photoRef:'photo-12345',latitude:24.47,longitude:39.61};
const make=(actor={role:'driver',companyId:2,driverId:7},found={id:19,status:'assigned'})=>{
 let bindArgs;
 const db={prepare(sql){assert.match(sql,/company_id=\? AND driver_id=\?/);assert.match(sql,/status IN \('assigned','out_for_delivery'\)/);return {bind(...args){bindArgs=args;return {async first(){return found}}}}}};
 const handler=createD1DeliveryPreflightQaHandler({db,authenticate:async()=>actor});
 return {handler,args:()=>bindArgs};
};
const request=(p=proof)=>new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});
test('proof and assigned driver/company preflight succeeds but never posts',async()=>{
 const f=make();const res=await f.handler(request());assert.equal(res.status,200);
 assert.deepEqual(f.args(),[19,2,7]);assert.equal((await res.json()).postingEnabled,false);
});
test('started out-for-delivery item passes preflight',async()=>{
 const f=make({role:'driver',companyId:2,driverId:7},{id:19,status:'out_for_delivery'});
 const res=await f.handler(request());
 assert.equal(res.status,200);assert.equal((await res.json()).eligible,true);
});
test('missing signature photo or GPS is rejected',async()=>{
 for(const key of Object.keys(proof)){
  const f=make();const p={...proof};delete p[key];
  assert.equal((await f.handler(request(p))).status,400);
 }
});
test('foreign delivery and non-driver access denied',async()=>{
 assert.equal((await make(undefined,null).handler(request())).status,404);
 assert.equal((await make({role:'admin',companyId:2,driverId:7}).handler(request())).status,403);
});
test('delivery preflight never mutates DB and fails closed',async()=>{
 const f=make();assert.equal((await f.handler(new Request(url,{method:'GET'}))).status,404);
 const db={prepare(){throw Error('private database failure')}};
 const handler=createD1DeliveryPreflightQaHandler({db,authenticate:async()=>({role:'driver',companyId:2,driverId:7})});
 const res=await handler(request());assert.equal(res.status,503);
 assert.doesNotMatch(await res.text(),/private database failure/);
});

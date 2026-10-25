import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {safeDeliveryPolicy,createDriverDeliveryPolicyRoutes}=
 require('../services/driver-delivery-policy-service.js');

function fixture({dbUnavailable=false}={}){
 const identities=new Map([
  [11,{id:11,company:1,role:'driver',active:true,companyActive:true}],
  [12,{id:12,company:1,role:'delivery_driver',active:true,companyActive:true}],
  [21,{id:21,company:2,role:'driver',active:true,companyActive:true}],
  [31,{id:31,company:1,role:'company_admin',active:true,companyActive:true}],
  [41,{id:41,company:1,role:'staff',active:true,companyActive:true}],
  [13,{id:13,company:1,role:'driver',active:false,companyActive:true}],
  [33,{id:33,company:3,role:'driver',active:true,companyActive:false}],
 ]);
 const routes=new Map(),calls=[];
 const query=async(sql,args)=>{
  if(dbUnavailable) throw new Error('isolated QA database unavailable');
  calls.push({sql,args});
  const user=identities.get(args[0]);
  return user&&user.company===args[1]&&user.role===args[2]&&
     user.active&&user.companyActive ? [{id:user.id}]:[];
 };
 const app={get:(name,handler)=>routes.set('GET '+name,handler),
   post:()=>{throw Error('Policy route must not add writes');},
   put:()=>{throw Error('Policy route must not add writes');}};
 createDriverDeliveryPolicyRoutes({app,query});
 const send=async(actor,{companyId=actor?.company,body}={})=>{
  const res={code:200,status(n){this.code=n;return this;},json(value){this.data=value;return this;}};
  await routes.get('GET /api/driver/delivery-policy')({
    user:actor&&{id:actor.id,role:actor.role},companyId,body
  },res);
  return res;
 };
 return {identities,routes,calls,send};
}
test('unit: policy always defaults to OTP ON and mandatory customer signature',()=>{
 assert.deepEqual(safeDeliveryPolicy(),{otpRequired:true,signatureRequired:true});
 assert.deepEqual(safeDeliveryPolicy({otpRequired:false,signatureRequired:false}),
   {otpRequired:true,signatureRequired:true},'unverified client flags cannot disable proof');
});
test('integration: authenticated active assigned drivers receive only conservative policy',async()=>{
 const f=fixture();
 for(const id of [11,12,21]){
  const res=await f.send(f.identities.get(id));
  assert.equal(res.code,200);
  assert.deepEqual(res.data,{otpRequired:true,signatureRequired:true});
 }
 assert.deepEqual([...f.routes.keys()],['GET /api/driver/delivery-policy']);
});
test('integration: admin, staff, unknown and unauthenticated actors rejected',async()=>{
 const f=fixture();
 for(const id of [31,41]){
  assert.equal((await f.send(f.identities.get(id))).code,403);
 }
 assert.equal((await f.send(null)).code,401);
});
test('integration: forged company, inactive identity, inactive company always denied',async()=>{
 const f=fixture();
 assert.equal((await f.send(f.identities.get(11),{companyId:2})).code,403);
 assert.equal((await f.send(f.identities.get(13))).code,403);
 assert.equal((await f.send(f.identities.get(33))).code,403);
 assert.equal(f.calls.some(x=>x.sql.includes('u.status')&&x.sql.includes('c.status')),true);
});
test('integration: SQL failure returns unavailable rather than disabling OTP',async()=>{
 const f=fixture({dbUnavailable:true});
 const res=await f.send(f.identities.get(11));
 assert.equal(res.code,503);
 assert.equal(res.data.otpRequired,undefined);
});

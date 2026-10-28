import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1DriverInventoryQaHandler} from '../services/d1-driver-inventory-qa.mjs';
const url='https://qa.example/api/driver/van-stock';
test('driver van-stock is scoped to authenticated company and driver',async()=>{
 let binds;
 const db={prepare(sql){assert.match(sql,/b.company_id=\? AND b.driver_id=\?/);return {bind(...args){binds=args;return {async all(){return {results:[{productId:1,productName:'Water',quantity:4}]}}}}}}};
 const handler=createD1DriverInventoryQaHandler({db,authenticate:async()=>({companyId:2,driverId:7,role:'driver'})});
 const response=await handler(new Request(url));
 assert.equal(response.status,200);assert.deepEqual(binds,[2,7]);
 assert.deepEqual((await response.json()).items,[{productId:1,productName:'Water',quantity:4}]);
});
test('unauthenticated or admin users cannot access driver stock',async()=>{
 const db={prepare(){throw Error('DB must not be accessed')}};
 for(const actor of [null,{companyId:1,driverId:2,role:'admin'}]){
  const handler=createD1DriverInventoryQaHandler({db,authenticate:async()=>actor});
  assert.equal((await handler(new Request(url))).status,403);
 }
});
test('D1 failure returns 503 and no data',async()=>{
 const db={prepare(){return {bind(){return {async all(){throw Error('sensitive SQL')}}}}}};
 const handler=createD1DriverInventoryQaHandler({db,authenticate:async()=>({companyId:1,driverId:2,role:'driver'})});
 const response=await handler(new Request(url));assert.equal(response.status,503);
 assert.doesNotMatch(await response.text(),/sensitive SQL/);
});
test('read contract rejects all write methods',async()=>{
 const handler=createD1DriverInventoryQaHandler({db:{prepare(){throw Error('no DB access')}},authenticate:async()=>({companyId:1,driverId:2,role:'driver'})});
 assert.equal((await handler(new Request(url,{method:'POST'}))).status,404);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDeliveryFinanceInput,postDeliveryFinanceQa} from '../services/d1-driver-delivery-finance-qa.mjs';
const p={companyId:1,driverId:2,deliveryId:3,productId:4,quantity:5,
 cashCents:1000,creditCents:500,bottlesReturned:2,idempotencyKey:'delivery-3',
 signatureRef:'signature-1',photoRef:'photo-123',latitude:24.47,longitude:39.61};
test('valid proof, amounts and identifiers accepted',()=>assert.equal(validateDeliveryFinanceInput(p).deliveryId,3));
test('missing proof and negative amounts fail closed',()=>{
 for(const key of ['signatureRef','photoRef','latitude','longitude']){
  const x={...p};delete x[key];assert.throws(()=>validateDeliveryFinanceInput(x));
 }
 for(const key of ['cashCents','creditCents','bottlesReturned'])
  assert.throws(()=>validateDeliveryFinanceInput({...p,[key]:-1}));
});
test('finance posting remains disabled until one atomic D1 transaction exists',async()=>{
 let calls=0;const db={prepare(){calls++;throw Error('must not touch database')},batch(){calls++;throw Error('must not touch database')}};
 await assert.rejects(postDeliveryFinanceQa(db,p),/QA BLOCKED/);
 assert.equal(calls,0);
});

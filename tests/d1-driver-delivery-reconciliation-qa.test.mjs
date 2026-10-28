import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileDeliveryJournals} from '../services/d1-driver-delivery-reconciliation-qa.mjs';
function fixture(override={}){
 const data={
  driver_delivery_posting_receipts:{company_id:1,delivery_id:3,driver_id:2,idempotency_key:'delivery-3',request_hash:'abc',amount_cents:1000,credit_cents:500,bottles_out:5,bottles_returned:2},
  driver_delivery_cash_journal:{value:1000},
  driver_delivery_credit_journal:{value:500},
  driver_delivery_bottle_ledger:{bottles_out:5,bottles_returned:2},
  van_stock_movements:{quantity:5,request_hash:'abc',movement_type:'deliver'},
  driver_delivery_proofs:{signature_ref:'signed-123',photo_ref:'photo-123'},
  deliveries:{status:'delivered',driver_id:2},...override
 };
 return {prepare(sql){const name=Object.keys(data).find(k=>sql.includes('FROM '+k));return {bind(...args){return {async first(){assert.equal(args[0],1);return data[name]??null}}}}}};
}
test('matching delivery journals reconcile',async()=>assert.deepEqual(await reconcileDeliveryJournals(fixture(),1,3),{ok:true,issues:[]}));
test('missing receipt blocks reconciliation',async()=>assert.deepEqual(await reconcileDeliveryJournals(fixture({driver_delivery_posting_receipts:null}),1,3),{ok:false,issues:['receipt_missing']}));
test('cash, credit, bottles, stock, proof and delivery mismatches detected',async()=>{
 const db=fixture({driver_delivery_cash_journal:{value:900},driver_delivery_credit_journal:null,driver_delivery_bottle_ledger:{bottles_out:4,bottles_returned:1},van_stock_movements:{quantity:4,request_hash:'wrong',movement_type:'deliver'},driver_delivery_proofs:null,deliveries:{status:'assigned',driver_id:2}});
 const result=await reconcileDeliveryJournals(db,1,3);
 assert.deepEqual(result.issues,['cash_mismatch','credit_mismatch','bottles_out_mismatch','bottles_returned_mismatch','stock_mismatch','proof_missing','delivery_mismatch']);
});
test('invalid scope rejected before database access',async()=>{
 await assert.rejects(reconcileDeliveryJournals(fixture(),0,3),/invalid scope/);
});

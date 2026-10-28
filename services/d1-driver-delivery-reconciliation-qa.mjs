// QA-only read-side reconciliation; never modifies D1.
export async function reconcileDeliveryJournals(db,companyId,deliveryId){
 if(!Number.isSafeInteger(companyId)||companyId<=0||!Number.isSafeInteger(deliveryId)||deliveryId<=0)throw Error('invalid scope');
 const one=(sql,...args)=>db.prepare(sql).bind(...args).first();
 const receipt=await one('SELECT * FROM driver_delivery_posting_receipts WHERE company_id=? AND delivery_id=?',companyId,deliveryId);
 if(!receipt)return {ok:false,issues:['receipt_missing']};
 const checks=[
  ['cash', 'SELECT cash_cents AS value FROM driver_delivery_cash_journal WHERE company_id=? AND delivery_id=?',receipt.amount_cents],
  ['credit','SELECT credit_cents AS value FROM driver_delivery_credit_journal WHERE company_id=? AND delivery_id=?',receipt.credit_cents],
  ['bottles_out','SELECT bottles_out AS value FROM driver_delivery_bottle_ledger WHERE company_id=? AND delivery_id=?',receipt.bottles_out],
  ['bottles_returned','SELECT bottles_returned AS value FROM driver_delivery_bottle_ledger WHERE company_id=? AND delivery_id=?',receipt.bottles_returned]
 ];
 const issues=[];
 for(const [name,sql,expected] of checks){
  const row=await one(sql,companyId,deliveryId);
  if(!row||row.value!==expected)issues.push(name+'_mismatch');
 }
 const movement=await one('SELECT quantity,request_hash,movement_type FROM van_stock_movements WHERE company_id=? AND idempotency_key=?',companyId,receipt.idempotency_key);
 if(!movement||movement.quantity!==receipt.bottles_out||movement.request_hash!==receipt.request_hash||movement.movement_type!=='deliver')issues.push('stock_mismatch');
 const proof=await one('SELECT signature_ref,photo_ref FROM driver_delivery_proofs WHERE company_id=? AND delivery_id=?',companyId,deliveryId);
 if(!proof||!proof.signature_ref||!proof.photo_ref)issues.push('proof_missing');
 const delivery=await one('SELECT status,driver_id FROM deliveries WHERE company_id=? AND id=?',companyId,deliveryId);
 if(!delivery||delivery.status!=='delivered'||delivery.driver_id!==receipt.driver_id)issues.push('delivery_mismatch');
 return {ok:issues.length===0,issues};
}

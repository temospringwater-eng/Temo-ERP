'use strict';
const {fail}=require('./driver-financial-bridge-validation-qa');
// Called inside an already-verified, dedicated BEGIN IMMEDIATE transaction.
async function postLedger(tx,{m,event,items,customer,orderTotal,reference,digest}){
 const source=event.source;
 const changed=await tx.run("UPDATE deliveries SET status='delivered',collected_amount=?,collected_method=?,bottle_return_count=?,empty_count=?,delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=? AND status IN ('assigned','out_for_delivery')",
  event.payment.amount,event.payment.amount?event.payment.method:'',event.returnedCount,event.emptyCount,m.erp_delivery_id,m.erp_company_id);
 if(changed.changes!==1)fail('ERP delivery changed concurrently');
 await tx.run("UPDATE orders SET status='delivered' WHERE id=? AND company_id=?",m.erp_order_id,m.erp_company_id);
 await tx.run("INSERT INTO credit_ledger(company_id,customer_id,entry_type,amount,note,created_by) VALUES(?,?,'debit',?,?,?)",
  m.erp_company_id,m.erp_customer_id,orderTotal/100,reference,m.erp_driver_id);
 let paymentId=null;
 if(event.payment.amount>0){
  const payment=await tx.run('INSERT INTO payments(company_id,customer_name,amount,method,note,direction,party_type,reference,created_by,delivery_id,order_id,collected_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
   m.erp_company_id,customer.name,event.payment.amount,event.payment.method,'D1 signed proof-v2 delivery QA',
   'receipt','customer',reference,m.erp_driver_id,m.erp_delivery_id,m.erp_order_id,m.erp_driver_id);
  paymentId=payment.lastID;
  await tx.run("INSERT INTO credit_ledger(company_id,customer_id,payment_id,entry_type,amount,note,created_by) VALUES(?,?,?,'payment',?,?,?)",
   m.erp_company_id,m.erp_customer_id,paymentId,event.payment.amount,reference,m.erp_driver_id);
 }
 for(const item of items){
  const changed=await tx.run('UPDATE products SET stock=stock-? WHERE id=? AND company_id=? AND stock>=?',
   item.quantity,item.product_id,m.erp_company_id,item.quantity);
  if(changed.changes!==1)fail('ERP stock changed while posting');
  await tx.run('UPDATE order_items SET delivered_quantity=quantity WHERE company_id=? AND order_id=? AND product_id=?',
   m.erp_company_id,m.erp_order_id,item.product_id);
  await tx.run("INSERT INTO stock_movements(company_id,product_id,customer_id,movement_type,quantity,reference,notes,created_by) VALUES(?,?,?,'customer_out',?,?,?,?)",
   m.erp_company_id,item.product_id,m.erp_customer_id,item.quantity,reference,'D1 signed warehouse delivery',m.erp_driver_id);
 }
 if(event.returnedCount||event.emptyCount){
  await tx.run('INSERT INTO delivery_bottle_counts(company_id,delivery_id,bottle_id,returned_quantity,empty_quantity,notes,created_by) VALUES(?,?,?,?,?,?,?)',
   m.erp_company_id,m.erp_delivery_id,m.erp_bottle_id,event.returnedCount,event.emptyCount,'D1 proof-v2',m.erp_driver_id);
  if(event.returnedCount){
   await tx.run("INSERT INTO bottle_movements(company_id,bottle_id,customer_id,movement_type,quantity,reference,notes,created_by) VALUES(?,?,?,'returned',?,?,?,?)",
    m.erp_company_id,m.erp_bottle_id,m.erp_customer_id,event.returnedCount,reference,'D1 signed receipt',m.erp_driver_id);
  }
 }
 const proof=event.proof;
 await tx.run('INSERT INTO delivery_proofs(company_id,delivery_id,otp_challenge_id,signature_storage_key,signature_content_type,signature_byte_size,signature_sha256,photo_storage_key,photo_content_type,photo_byte_size,photo_sha256,captured_at,captured_by) VALUES(?,?,NULL,?,?,?,?,?,?,?,?,?,?)',
  m.erp_company_id,m.erp_delivery_id,proof.signature.storageKey,proof.signature.contentType,proof.signature.byteSize,proof.signature.sha256,
  proof.photo.storageKey,proof.photo.contentType,proof.photo.byteSize,proof.photo.sha256,proof.gps.capturedAt,m.erp_driver_id);
 await tx.run('INSERT INTO driver_finance_bridge_proof_gps(erp_delivery_id,company_id,latitude,longitude,accuracy_m,captured_at,signature_sha256,photo_sha256,source_delivery_id) VALUES(?,?,?,?,?,?,?,?,?)',
  m.erp_delivery_id,m.erp_company_id,proof.gps.latitude,proof.gps.longitude,proof.gps.accuracyMeters,proof.gps.capturedAt,
  proof.signature.sha256,proof.photo.sha256,source.deliveryId);
 const receipt={status:'applied',erpDeliveryId:m.erp_delivery_id,d1DeliveryId:source.deliveryId,
  companyId:m.erp_company_id,paymentId,amount:event.payment.amount,
  returnedCount:event.returnedCount,emptyCount:event.emptyCount,stockLines:items.length};
 await tx.run('INSERT INTO driver_finance_bridge_receipts(company_id,d1_company_id,d1_delivery_id,erp_delivery_id,source_key,event_sha256,payment_id,result_json) VALUES(?,?,?,?,?,?,?,?)',
  m.erp_company_id,source.companyId,source.deliveryId,m.erp_delivery_id,source.idempotencyKey,digest,paymentId,JSON.stringify(receipt));
 return receipt;
}
module.exports={postLedger};

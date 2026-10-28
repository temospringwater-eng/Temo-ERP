'use strict';
const {fail,pos}=require('./driver-financial-bridge-validation-qa');
const {postLedger}=require('./driver-financial-bridge-ledger-qa');
const {reconcileAppliedBridgeReceiptQa}=require('./driver-financial-bridge-reconcile-qa');
async function applyVerifiedBridgeReceipt(tx,event,digest){
 const s=event.source;
 const m=await tx.get('SELECT * FROM driver_finance_bridge_map WHERE d1_company_id=? AND d1_delivery_id=?',s.companyId,s.deliveryId);
 if(!m||m.d1_driver_id!==s.driverId||m.d1_order_id!==s.orderId)
  fail('explicit source-to-central ERP mapping mismatch');
 const previous=await tx.get('SELECT * FROM driver_finance_bridge_receipts WHERE d1_company_id=? AND d1_delivery_id=?',s.companyId,s.deliveryId);
 if(previous){
  // A lost-ACK/offline retry may re-ack only the exact original ERP posting.
  // Never silently accept a remapped company/delivery even if the signed D1 event is unchanged.
  if(Number(previous.company_id)!==Number(m.erp_company_id)||
     Number(previous.erp_delivery_id)!==Number(m.erp_delivery_id))
   fail('ERP mapping changed after posting: reconcile before acknowledgement');
  if(previous.event_sha256!==digest||previous.source_key!==s.idempotencyKey)
   fail('conflict: same D1 delivery changed financial receipt');
  return reconcileAppliedBridgeReceiptQa(tx,{m,event,previous});
 }
 if(await tx.get('SELECT id FROM driver_finance_bridge_receipts WHERE company_id=? AND source_key=?',m.erp_company_id,s.idempotencyKey))
  fail('conflict: replay key belongs to different delivery');
 // D1 van stock is already debited atomically at delivery. The legacy ERP\n // warehouse-on-delivery bridge would debit products.stock again: fail closed.\n if(event?.source?.inventorySource==='d1_van_stock')\n  fail('D1 van delivery cannot use warehouse-on-delivery bridge: double stock debit');\n if(m.inventory_policy!=='warehouse_on_delivery'||m.invoice_policy!=='new_order_invoice')
  fail('inventory or invoice policy blocked until ownership review');
 const company=await tx.get('SELECT id FROM companies WHERE id=? AND active=1',m.erp_company_id);
 const driver=await tx.get("SELECT id FROM users WHERE id=? AND company_id=? AND role IN ('driver','delivery_driver') AND active=1",m.erp_driver_id,m.erp_company_id);
 const customer=await tx.get('SELECT id,name FROM customers WHERE id=? AND company_id=?',m.erp_customer_id,m.erp_company_id);
 const order=await tx.get('SELECT * FROM orders WHERE id=? AND company_id=? AND customer_id=?',m.erp_order_id,m.erp_company_id,m.erp_customer_id);
 const delivery=await tx.get('SELECT * FROM deliveries WHERE id=? AND company_id=? AND order_id=? AND driver_id=?',m.erp_delivery_id,m.erp_company_id,m.erp_order_id,m.erp_driver_id);
 if(!company||!driver||!customer||!order||!delivery)
  fail('ERP tenant/driver/customer/order/delivery identity mismatch');
 if(!['assigned','out_for_delivery'].includes(delivery.status)||
    !['pending','confirmed','assigned','out_for_delivery'].includes(order.status))
  fail('ERP delivery or order not in safely postable state');
 if(event.payment.amount>Number(order.total_amount))fail('cash exceeds ERP invoice');
 const reference='DELIVERY-'+m.erp_delivery_id;
 if(await tx.get('SELECT id FROM payments WHERE company_id=? AND delivery_id=?',m.erp_company_id,m.erp_delivery_id)||
    await tx.get('SELECT id FROM credit_ledger WHERE company_id=? AND customer_id=? AND note=?',m.erp_company_id,m.erp_customer_id,reference)||
    await tx.get('SELECT id FROM delivery_bottle_counts WHERE company_id=? AND delivery_id=?',m.erp_company_id,m.erp_delivery_id)||
    await tx.get('SELECT id FROM stock_movements WHERE company_id=? AND reference=?',m.erp_company_id,reference)||
    await tx.get('SELECT id FROM delivery_proofs WHERE company_id=? AND delivery_id=?',m.erp_company_id,m.erp_delivery_id))
  fail('ERP has existing posting: reconcile manually, do not debit again');
 const items=await tx.all('SELECT oi.product_id,oi.quantity,oi.delivered_quantity,oi.total_price,p.stock FROM order_items oi JOIN products p ON p.id=oi.product_id AND p.company_id=oi.company_id WHERE oi.company_id=? AND oi.order_id=? ORDER BY oi.id',m.erp_company_id,m.erp_order_id);
 if(!items.length||items.some(i=>!pos(i.quantity)||Number(i.delivered_quantity)!==0||
    typeof i.stock!=='number'||!Number.isFinite(i.stock)||i.stock<i.quantity))
  fail('ERP stock quantity invalid or insufficient');
 const orderTotal=Math.round(Number(order.total_amount)*100);
 const lineTotal=items.reduce((n,i)=>n+Math.round(Number(i.total_price)*100),0);
 if(!Number.isSafeInteger(orderTotal)||orderTotal<=0||orderTotal!==lineTotal)
  fail('ERP invoice total differs from source order lines');
 if(event.returnedCount||event.emptyCount){
  if(!pos(m.erp_bottle_id)||!await tx.get('SELECT id FROM bottles WHERE id=? AND company_id=? AND active=1',m.erp_bottle_id,m.erp_company_id))
   fail('ERP bottle mapping invalid or foreign');
 }
 // First-post ACK must be reconciled while BEGIN IMMEDIATE still owns the ledger.
 // Otherwise a successful INSERT silently corrupted by an accounting trigger could
 // commit and return 'applied'; checking only on lost-ACK retries is too late.
 const posted=await postLedger(tx,{m,event,items,customer,orderTotal,reference,digest});
 const persisted=await tx.get(
  'SELECT * FROM driver_finance_bridge_receipts WHERE d1_company_id=? AND d1_delivery_id=?',
  s.companyId,s.deliveryId);
 if(!persisted||persisted.event_sha256!==digest||
    persisted.source_key!==s.idempotencyKey||
    Number(persisted.company_id)!==Number(m.erp_company_id)||
    Number(persisted.erp_delivery_id)!==Number(m.erp_delivery_id))
  fail('initial ERP finance receipt persistence mismatch');
 const checked=await reconcileAppliedBridgeReceiptQa(tx,{m,event,previous:persisted});
 if(JSON.stringify(checked)!==JSON.stringify(posted))
  fail('initial ERP financial ACK differs from reconciled ledgers');
 return posted;
}
module.exports={applyVerifiedBridgeReceipt};

'use strict';
// Strictly read-only disposable QA comparison. This is NOT an ERP posting adapter:
// D1 and Express/SQLite use different primary keys, schemas and financial ledgers.
const dimensions=['d1Company','d1Driver','d1Order','d1Delivery',
 'erpCompany','erpDriver','erpOrder','erpDelivery'];
function validateCrosswalk(mapping) {
 if(!mapping||dimensions.some(k=>!Number.isSafeInteger(mapping[k])||mapping[k]<=0))
  throw new Error('Invalid explicit tenant/driver/order/delivery crosswalk');
 return true;
}
const cents=x=>Number.isFinite(Number(x))?Math.round(Number(x)*100):NaN;
const safeCount=x=>Number.isSafeInteger(Number(x))?Number(x):NaN;
function auditCrossSystemDelivery({d1,erp,mapping}) {
 validateCrosswalk(mapping);
 if(!d1?.prepare||!erp?.prepare)throw new Error('Disposable SQLite connections required');
 const m=mapping,issues=[],add=(code)=>{if(!issues.includes(code))issues.push(code);};
 const d1Delivery=d1.prepare('SELECT * FROM deliveries WHERE id=? AND company_id=? AND driver_id=? AND order_id=?')
  .get(m.d1Delivery,m.d1Company,m.d1Driver,m.d1Order);
 if(!d1Delivery||d1Delivery.status!=='completed')add('D1_DELIVERY_SCOPE_MISMATCH');
 const completed=d1.prepare('SELECT * FROM driver_delivery_completions WHERE delivery_id=? AND company_id=? AND driver_id=?')
  .get(m.d1Delivery,m.d1Company,m.d1Driver);
 if(!completed){
  const anyCompletion=d1.prepare('SELECT 1 FROM driver_delivery_completions WHERE delivery_id=? AND company_id=? LIMIT 1')
   .get(m.d1Delivery,m.d1Company);
  add(anyCompletion?'D1_COMPLETION_SCOPE_MISMATCH':'D1_COMPLETION_MISSING');
 }
 const proof=d1.prepare('SELECT * FROM driver_delivery_evidence WHERE delivery_id=? AND company_id=? AND driver_id=?')
  .get(m.d1Delivery,m.d1Company,m.d1Driver);
 if(!proof||!proof.signature_key||!proof.photo_key||
    proof.signature_key!==completed?.proof_key||!Number.isFinite(proof.latitude)||
    !Number.isFinite(proof.longitude)||!(proof.accuracy_m>0))
   add('D1_PROOF_INCOMPLETE');
 const delivery=erp.prepare('SELECT * FROM deliveries WHERE id=? AND company_id=? AND driver_id=? AND order_id=?')
  .get(m.erpDelivery,m.erpCompany,m.erpDriver,m.erpOrder);
 if(!delivery||delivery.status!=='delivered')add('ERP_DELIVERY_SCOPE_MISMATCH');
 if(completed&&delivery){
  if(cents(completed.amount)!==cents(delivery.collected_amount))
   add('ERP_DELIVERY_CASH_MISMATCH');
  if(safeCount(completed.returned_count)!==safeCount(delivery.bottle_return_count)||
     safeCount(completed.empty_count)!==safeCount(delivery.empty_count))
   add('ERP_DELIVERY_BOTTLE_MISMATCH');
 }
 const payments=erp.prepare('SELECT id,amount FROM payments WHERE company_id=? AND delivery_id=? AND order_id=?')
  .all(m.erpCompany,m.erpDelivery,m.erpOrder);
 if(completed&&cents(completed.amount)>0){
  if(!payments.length)add('ERP_PAYMENT_MISSING');
  else if(payments.length!==1)add('ERP_PAYMENT_DUPLICATE');
  else if(cents(payments[0].amount)!==cents(completed.amount))add('ERP_PAYMENT_AMOUNT_MISMATCH');
  if(payments.length!==1||!erp.prepare(
    "SELECT 1 FROM credit_ledger WHERE company_id=? AND payment_id=? AND entry_type='payment' AND amount=? LIMIT 1"
   ).get(m.erpCompany,payments[0]?.id||-1,Number(completed.amount)))
   add('ERP_CUSTOMER_LEDGER_MISSING');
 }
 if(completed&&(completed.returned_count>0||completed.empty_count>0)){
  const bottle=erp.prepare('SELECT COALESCE(SUM(returned_quantity),0) returned, COALESCE(SUM(empty_quantity),0) empty, COUNT(*) n FROM delivery_bottle_counts WHERE company_id=? AND delivery_id=?')
   .get(m.erpCompany,m.erpDelivery);
  if(!bottle?.n)add('ERP_BOTTLE_LEDGER_MISSING');
  else if(bottle.returned!==completed.returned_count||bottle.empty!==completed.empty_count)
   add('ERP_BOTTLE_LEDGER_MISMATCH');
 }
 // Verify quantity-aware ERP financial ledgers against the scoped central order.
 // Merely finding any stock movement is not reconciliation; duplicated stock deductions
 // or another tenant's movement must never make a completed D1 receipt appear valid.
 const reference='DELIVERY-'+m.erpDelivery;
 const order=erp.prepare('SELECT id,company_id,customer_id,total_amount,status FROM orders WHERE id=? AND company_id=?')
  .get(m.erpOrder,m.erpCompany);
 if(!order||order.status!=='delivered')add('ERP_ORDER_SCOPE_MISMATCH');
 if(order){
  const debit=erp.prepare("SELECT amount FROM credit_ledger WHERE company_id=? AND customer_id=? AND note=? AND entry_type='debit'")
   .all(m.erpCompany,order.customer_id,reference);
  if(!debit.length)add('ERP_INVOICE_DEBIT_MISSING');
  else if(debit.length!==1||cents(debit[0].amount)!==cents(order.total_amount))
   add('ERP_INVOICE_DEBIT_MISMATCH');
 }
 const items=erp.prepare('SELECT product_id,quantity,delivered_quantity FROM order_items WHERE company_id=? AND order_id=?')
  .all(m.erpCompany,m.erpOrder);
 const moves=erp.prepare("SELECT product_id,quantity FROM stock_movements WHERE company_id=? AND reference=? AND movement_type='customer_out'")
  .all(m.erpCompany,reference);
 if(!moves.length)add('ERP_STOCK_LEDGER_UNVERIFIED');
 else{
  const line=x=>x.map(z=>Number(z.product_id)+':'+Number(z.quantity)).sort();
  if(!items.length||items.some(z=>!Number.isSafeInteger(Number(z.quantity))||Number(z.quantity)<=0||
       Number(z.delivered_quantity)!==Number(z.quantity))||
     JSON.stringify(line(items))!==JSON.stringify(line(moves)))
   add('ERP_STOCK_LEDGER_QUANTITY_MISMATCH');
 }
 if(completed){
  const returned=erp.prepare("SELECT quantity FROM bottle_movements WHERE company_id=? AND reference=? AND movement_type='returned'")
   .all(m.erpCompany,reference);
  const expected=safeCount(completed.returned_count);
  if(expected>0&&!returned.length)add('ERP_BOTTLE_RETURN_MOVEMENT_MISSING');
  else if(returned.length!==(expected>0?1:0)||
    (expected>0&&safeCount(returned[0].quantity)!==expected))
   add('ERP_BOTTLE_RETURN_MOVEMENT_MISMATCH');
 }
 return {
  ready:false, // A local comparison can NEVER authorize production writes.
  comparisonPassed:issues.length===0,issues,
  d1DeliveryId:m.d1Delivery,erpDeliveryId:m.erpDelivery,
  scope:'QA_READ_ONLY_CROSSWALK_NO_POSTING'
 };
}
module.exports={auditCrossSystemDelivery,validateCrosswalk};

'use strict';
// QA-only post-commit integrity check before re-acknowledging an offline D1 receipt.
// Called within a dedicated BEGIN IMMEDIATE SQLite transaction: strictly SELECTs.
const {fail}=require('./driver-financial-bridge-validation-qa');
const cents=x=>Number.isFinite(Number(x))?Math.round(Number(x)*100):NaN;
function sameRows(a,b){
 if(a.length!==b.length)return false;
 const sorted=x=>x.map(r=>Number(r.product_id)+':'+Number(r.quantity)).sort();
 return JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
}
async function reconcileAppliedBridgeReceiptQa(tx,{m,event,previous}){
 const stop=()=>fail('reconciliation required: committed ERP financial receipt differs from source');
 const s=event.source,ref='DELIVERY-'+m.erp_delivery_id;
 let recorded;
 try{recorded=JSON.parse(previous.result_json)}catch{stop()}
 if(recorded.status!=='applied'||recorded.companyId!==m.erp_company_id||
    recorded.d1CompanyId!==s.companyId||
    recorded.erpDeliveryId!==m.erp_delivery_id||recorded.d1DeliveryId!==s.deliveryId||
    cents(recorded.amount)!==cents(event.payment.amount)||
    recorded.paymentId!==previous.payment_id)stop();
 const d=await tx.get('SELECT status,order_id,driver_id,collected_amount,collected_method,bottle_return_count,empty_count FROM deliveries WHERE id=? AND company_id=?',
  m.erp_delivery_id,m.erp_company_id);
 const o=await tx.get('SELECT status,total_amount,customer_id FROM orders WHERE id=? AND company_id=?',m.erp_order_id,m.erp_company_id);
 if(!d||!o||d.status!=='delivered'||o.status!=='delivered'||
    d.order_id!==m.erp_order_id||d.driver_id!==m.erp_driver_id||
    o.customer_id!==m.erp_customer_id||cents(d.collected_amount)!==cents(event.payment.amount)||
    Number(d.bottle_return_count)!==event.returnedCount||
    Number(d.empty_count)!==event.emptyCount)stop();
 const pays=await tx.all('SELECT id,amount,method,order_id,collected_by FROM payments WHERE company_id=? AND delivery_id=?',m.erp_company_id,m.erp_delivery_id);
 const expectedPaid=event.payment.amount>0?1:0;
 if(pays.length!==expectedPaid)stop();
 if(expectedPaid&&(pays[0].id!==previous.payment_id||cents(pays[0].amount)!==cents(event.payment.amount)||
    pays[0].method!==event.payment.method||pays[0].order_id!==m.erp_order_id||
    pays[0].collected_by!==m.erp_driver_id||d.collected_method!==event.payment.method))stop();
 const entries=await tx.all('SELECT entry_type,amount,payment_id FROM credit_ledger WHERE company_id=? AND customer_id=? AND note=?',m.erp_company_id,m.erp_customer_id,ref);
 if(entries.length!==1+expectedPaid)stop();
 const debit=entries.filter(e=>e.entry_type==='debit');
 const credits=entries.filter(e=>e.entry_type==='payment');
 if(debit.length!==1||cents(debit[0].amount)!==cents(o.total_amount)||credits.length!==expectedPaid)stop();
 if(expectedPaid&&(credits[0].payment_id!==previous.payment_id||
    cents(credits[0].amount)!==cents(event.payment.amount)))stop();
 const items=await tx.all('SELECT product_id,quantity,delivered_quantity FROM order_items WHERE company_id=? AND order_id=? ORDER BY id',m.erp_company_id,m.erp_order_id);
 const moves=await tx.all("SELECT product_id,quantity FROM stock_movements WHERE company_id=? AND reference=? AND movement_type='customer_out' ORDER BY id",m.erp_company_id,ref);
 if(!items.length||items.some(i=>Number(i.quantity)!==Number(i.delivered_quantity))||
    !sameRows(items,moves))stop();
 const bottleRows=await tx.all('SELECT bottle_id,returned_quantity,empty_quantity FROM delivery_bottle_counts WHERE company_id=? AND delivery_id=?',m.erp_company_id,m.erp_delivery_id);
 const expectedBottle=(event.returnedCount||event.emptyCount)?1:0;
 if(bottleRows.length!==expectedBottle)stop();
 if(expectedBottle&&(bottleRows[0].bottle_id!==m.erp_bottle_id||
    Number(bottleRows[0].returned_quantity)!==event.returnedCount||
    Number(bottleRows[0].empty_quantity)!==event.emptyCount))stop();
 const returned=await tx.all("SELECT bottle_id,quantity FROM bottle_movements WHERE company_id=? AND reference=? AND movement_type='returned'",m.erp_company_id,ref);
 if(returned.length!==(event.returnedCount?1:0))stop();
 if(event.returnedCount&&(returned[0].bottle_id!==m.erp_bottle_id||Number(returned[0].quantity)!==event.returnedCount))stop();
 const proof=await tx.get('SELECT signature_sha256,photo_sha256,signature_storage_key,photo_storage_key FROM delivery_proofs WHERE company_id=? AND delivery_id=?',m.erp_company_id,m.erp_delivery_id);
 const gps=await tx.get('SELECT signature_sha256,photo_sha256,latitude,longitude,accuracy_m,source_delivery_id FROM driver_finance_bridge_proof_gps WHERE company_id=? AND erp_delivery_id=?',m.erp_company_id,m.erp_delivery_id);
 if(!proof||!gps||proof.signature_sha256!==event.proof.signature.sha256||
    proof.photo_sha256!==event.proof.photo.sha256||
    proof.signature_storage_key!==event.proof.signature.storageKey||
    proof.photo_storage_key!==event.proof.photo.storageKey||
    gps.signature_sha256!==event.proof.signature.sha256||
    gps.photo_sha256!==event.proof.photo.sha256||
    gps.source_delivery_id!==s.deliveryId||gps.latitude!==event.proof.gps.latitude||
    gps.longitude!==event.proof.gps.longitude||gps.accuracy_m!==event.proof.gps.accuracyMeters)stop();
 return recorded;
}
module.exports={reconcileAppliedBridgeReceiptQa};

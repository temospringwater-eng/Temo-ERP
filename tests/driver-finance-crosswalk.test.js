'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {auditCrossSystemDelivery,validateCrosswalk}=require('../services/driver-finance-crosswalk-qa');
const map={d1Company:1,d1Driver:11,d1Order:201,d1Delivery:301,
 erpCompany:40,erpDriver:41,erpOrder:701,erpDelivery:801};
function fixture(){
 const d1=new DatabaseSync(':memory:'),erp=new DatabaseSync(':memory:');
 d1.exec("CREATE TABLE deliveries(id INTEGER,company_id INTEGER,driver_id INTEGER,order_id INTEGER,status TEXT);"+
 "CREATE TABLE driver_delivery_completions(delivery_id INTEGER,company_id INTEGER,driver_id INTEGER,amount REAL,returned_count INTEGER,empty_count INTEGER,proof_key TEXT);"+
 "CREATE TABLE driver_delivery_evidence(delivery_id INTEGER,company_id INTEGER,driver_id INTEGER,signature_key TEXT,photo_key TEXT,latitude REAL,longitude REAL,accuracy_m REAL);"+
 "INSERT INTO deliveries VALUES(301,1,11,201,'completed');"+
 "INSERT INTO driver_delivery_completions VALUES(301,1,11,150,2,1,'sig-301');"+
 "INSERT INTO driver_delivery_evidence VALUES(301,1,11,'sig-301','photo-301',24.7,46.6,15);");
 erp.exec("CREATE TABLE deliveries(id INTEGER,company_id INTEGER,driver_id INTEGER,order_id INTEGER,status TEXT,collected_amount REAL,bottle_return_count INTEGER,empty_count INTEGER);"+
 "CREATE TABLE payments(id INTEGER,company_id INTEGER,delivery_id INTEGER,order_id INTEGER,amount REAL);"+
 "CREATE TABLE delivery_bottle_counts(company_id INTEGER,delivery_id INTEGER,returned_quantity INTEGER,empty_quantity INTEGER);"+
 "CREATE TABLE credit_ledger(payment_id INTEGER,company_id INTEGER,customer_id INTEGER,entry_type TEXT,amount REAL,note TEXT);"+
 "CREATE TABLE stock_movements(company_id INTEGER,reference TEXT,product_id INTEGER,movement_type TEXT,quantity INTEGER);"+
 "CREATE TABLE orders(id INTEGER,company_id INTEGER,customer_id INTEGER,status TEXT,total_amount REAL);"+
 "CREATE TABLE order_items(id INTEGER,company_id INTEGER,order_id INTEGER,product_id INTEGER,quantity INTEGER,delivered_quantity INTEGER);"+
 "CREATE TABLE bottle_movements(company_id INTEGER,reference TEXT,movement_type TEXT,quantity INTEGER);"+
 "INSERT INTO deliveries VALUES(801,40,41,701,'delivered',150,2,1);"+
 "INSERT INTO orders VALUES(701,40,500,'delivered',200);"+
 "INSERT INTO order_items VALUES(1,40,701,51,2,2);");
 return {d1,erp,close(){d1.close();erp.close()}};
}
test('TDD: crosswalk never treats equal raw DB IDs as proof of shared source of truth',()=>{
 assert.equal(validateCrosswalk(map),true);
 assert.throws(()=>validateCrosswalk({...map,erpCompany:0}),/crosswalk/);
 assert.throws(()=>validateCrosswalk({...map,erpDelivery:undefined}),/crosswalk/);
});
test('TDD integration: successful D1 completion but missing central finance entries blocks reconciliation',()=>{
 const f=fixture();try{
  const r=auditCrossSystemDelivery({...f,mapping:map});
  assert.equal(r.ready,false);
  for(const code of ['ERP_BOTTLE_LEDGER_MISSING','ERP_CUSTOMER_LEDGER_MISSING',
   'ERP_PAYMENT_MISSING','ERP_STOCK_LEDGER_UNVERIFIED','ERP_INVOICE_DEBIT_MISSING',
   'ERP_BOTTLE_RETURN_MOVEMENT_MISSING'])assert.ok(r.issues.includes(code),code);
  assert.equal(r.d1DeliveryId,301);assert.equal(r.erpDeliveryId,801);
 }finally{f.close()}
});
test('TDD integration: duplicate central payment and mismatched tenant cannot be verified',()=>{
 const f=fixture();try{
  f.erp.exec("INSERT INTO payments VALUES(1,40,801,701,150),(2,40,801,701,150)");
  const r=auditCrossSystemDelivery({...f,mapping:map});
  assert.equal(r.ready,false);
  assert.ok(r.issues.includes('ERP_PAYMENT_DUPLICATE'));
  const wrong=auditCrossSystemDelivery({...f,mapping:{...map,erpCompany:2}});
  assert.equal(wrong.ready,false);
  assert.ok(wrong.issues.includes('ERP_DELIVERY_SCOPE_MISMATCH'));
 }finally{f.close()}
});
test('TDD integration: matching amounts never implies production readiness without immutable ledger proofs',()=>{
 const f=fixture();try{
  f.erp.exec("INSERT INTO payments VALUES(1,40,801,701,150)");
  f.erp.exec("INSERT INTO delivery_bottle_counts VALUES(40,801,2,1)");
  f.erp.exec("INSERT INTO credit_ledger VALUES(1,40,500,'payment',150,'DELIVERY-801')");
  const r=auditCrossSystemDelivery({...f,mapping:map});
  assert.equal(r.ready,false);
  assert.ok(r.issues.includes('ERP_STOCK_LEDGER_UNVERIFIED'));
 }finally{f.close()}
});

test('TDD cross-tenant proof cannot satisfy a company 1 delivery even if delivery ID and signature match',()=>{
 const f=fixture();try{
  f.d1.exec("DELETE FROM driver_delivery_evidence WHERE company_id=1");
  f.d1.exec("INSERT INTO driver_delivery_evidence VALUES(301,2,22,'sig-301','photo-301',24.7,46.6,15)");
  const report=auditCrossSystemDelivery({...f,mapping:map});
  assert.equal(report.ready,false);
  assert.ok(report.issues.includes('D1_PROOF_INCOMPLETE'));
 }finally{f.close()}
});
test('TDD wrong driver on completion/proof denies source receipt despite matching company and delivery',()=>{
 const f=fixture();try{
  f.d1.exec("UPDATE driver_delivery_completions SET driver_id=22 WHERE delivery_id=301");
  let report=auditCrossSystemDelivery({...f,mapping:map});
  assert.ok(report.issues.includes('D1_COMPLETION_SCOPE_MISMATCH'));
  f.d1.exec("UPDATE driver_delivery_completions SET driver_id=11 WHERE delivery_id=301");
  f.d1.exec("UPDATE driver_delivery_evidence SET driver_id=22 WHERE delivery_id=301");
  report=auditCrossSystemDelivery({...f,mapping:map});
  assert.ok(report.issues.includes('D1_PROOF_INCOMPLETE'));
 }finally{f.close()}
});
test('TDD matching tenant proof remains valid: errors limited to absent finance posting',()=>{
 const f=fixture();try{
  const r=auditCrossSystemDelivery({...f,mapping:map});
  assert.equal(r.issues.includes('D1_PROOF_INCOMPLETE'),false);
  assert.equal(r.issues.includes('D1_COMPLETION_SCOPE_MISMATCH'),false);
  assert.equal(r.ready,false);
 }finally{f.close()}
});

test('TDD cross-system QA ledger reconciliation requires correct invoice debit, cash, bottle movement and exact stock quantities',()=>{
 const f=fixture();try{
  f.erp.exec("INSERT INTO payments VALUES(1,40,801,701,150)");
  f.erp.exec("INSERT INTO credit_ledger VALUES(1,40,500,'payment',150,'DELIVERY-801')");
  f.erp.exec("INSERT INTO credit_ledger VALUES(NULL,40,500,'debit',200,'DELIVERY-801')");
  f.erp.exec("INSERT INTO delivery_bottle_counts VALUES(40,801,2,1)");
  f.erp.exec("INSERT INTO bottle_movements VALUES(40,'DELIVERY-801','returned',2)");
  f.erp.exec("INSERT INTO stock_movements VALUES(40,'DELIVERY-801',51,'customer_out',2)");
  const ok=auditCrossSystemDelivery({...f,mapping:map});
  assert.equal(ok.comparisonPassed,true,JSON.stringify(ok.issues));
  assert.equal(ok.ready,false,'read-only comparison cannot authorize production finance writes');
  f.erp.exec("UPDATE stock_movements SET quantity=3 WHERE company_id=40");
  const stock=auditCrossSystemDelivery({...f,mapping:map});
  assert.ok(stock.issues.includes('ERP_STOCK_LEDGER_QUANTITY_MISMATCH'));
  assert.equal(stock.comparisonPassed,false);
  f.erp.exec("UPDATE stock_movements SET quantity=2 WHERE company_id=40");
  f.erp.exec("UPDATE credit_ledger SET amount=250 WHERE entry_type='debit'");
  assert.ok(auditCrossSystemDelivery({...f,mapping:map}).issues.includes('ERP_INVOICE_DEBIT_MISMATCH'));
  f.erp.exec("UPDATE credit_ledger SET amount=200 WHERE entry_type='debit'");
  f.erp.exec("UPDATE bottle_movements SET quantity=3 WHERE company_id=40");
  assert.ok(auditCrossSystemDelivery({...f,mapping:map}).issues.includes('ERP_BOTTLE_RETURN_MOVEMENT_MISMATCH'));
 }finally{f.close()}
});
test('TDD duplicate or wrong-tenant stock movements cannot pass ERP financial reconciliation',()=>{
 const f=fixture();try{
  f.erp.exec("INSERT INTO payments VALUES(1,40,801,701,150)");
  f.erp.exec("INSERT INTO credit_ledger VALUES(1,40,500,'payment',150,'DELIVERY-801')");
  f.erp.exec("INSERT INTO credit_ledger VALUES(NULL,40,500,'debit',200,'DELIVERY-801')");
  f.erp.exec("INSERT INTO delivery_bottle_counts VALUES(40,801,2,1)");
  f.erp.exec("INSERT INTO bottle_movements VALUES(40,'DELIVERY-801','returned',2)");
  f.erp.exec("INSERT INTO stock_movements VALUES(41,'DELIVERY-801',51,'customer_out',2)");
  assert.ok(auditCrossSystemDelivery({...f,mapping:map}).issues.includes('ERP_STOCK_LEDGER_UNVERIFIED'));
  f.erp.exec("INSERT INTO stock_movements VALUES(40,'DELIVERY-801',51,'customer_out',2)");
  f.erp.exec("INSERT INTO stock_movements VALUES(40,'DELIVERY-801',51,'customer_out',2)");
  assert.ok(auditCrossSystemDelivery({...f,mapping:map}).issues.includes('ERP_STOCK_LEDGER_QUANTITY_MISMATCH'));
 }finally{f.close()}
});

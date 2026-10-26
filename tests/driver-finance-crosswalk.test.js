'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {auditCrossSystemDelivery,validateCrosswalk}=require('../services/driver-finance-crosswalk-qa');
const map={d1Company:1,d1Driver:11,d1Order:201,d1Delivery:301,
 erpCompany:40,erpDriver:41,erpOrder:701,erpDelivery:801};
function fixture(){
 const d1=new DatabaseSync(':memory:'),erp=new DatabaseSync(':memory:');
 d1.exec("CREATE TABLE deliveries(id INTEGER,company_id INTEGER,driver_id INTEGER,order_id INTEGER,status TEXT);"+
 "CREATE TABLE driver_delivery_completions(delivery_id INTEGER,company_id INTEGER,amount REAL,returned_count INTEGER,empty_count INTEGER,proof_key TEXT);"+
 "CREATE TABLE driver_delivery_evidence(delivery_id INTEGER,signature_key TEXT,photo_key TEXT,latitude REAL,longitude REAL,accuracy_m REAL);"+
 "INSERT INTO deliveries VALUES(301,1,11,201,'completed');"+
 "INSERT INTO driver_delivery_completions VALUES(301,1,150,2,1,'sig-301');"+
 "INSERT INTO driver_delivery_evidence VALUES(301,'sig-301','photo-301',24.7,46.6,15);");
 erp.exec("CREATE TABLE deliveries(id INTEGER,company_id INTEGER,driver_id INTEGER,order_id INTEGER,status TEXT,collected_amount REAL,bottle_return_count INTEGER,empty_count INTEGER);"+
 "CREATE TABLE payments(id INTEGER,company_id INTEGER,delivery_id INTEGER,order_id INTEGER,amount REAL);"+
 "CREATE TABLE delivery_bottle_counts(company_id INTEGER,delivery_id INTEGER,returned_quantity INTEGER,empty_quantity INTEGER);"+
 "CREATE TABLE credit_ledger(payment_id INTEGER,company_id INTEGER,customer_id INTEGER,entry_type TEXT,amount REAL);"+
 "CREATE TABLE stock_movements(company_id INTEGER,reference TEXT,product_id INTEGER,movement_type TEXT,quantity INTEGER);"+
 "INSERT INTO deliveries VALUES(801,40,41,701,'delivered',150,2,1);");
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
  assert.deepEqual(r.issues.sort(),['ERP_BOTTLE_LEDGER_MISSING','ERP_CUSTOMER_LEDGER_MISSING',
   'ERP_PAYMENT_MISSING','ERP_STOCK_LEDGER_UNVERIFIED'].sort());
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
  f.erp.exec("INSERT INTO credit_ledger VALUES(1,40,500,'payment',150)");
  const r=auditCrossSystemDelivery({...f,mapping:map});
  assert.equal(r.ready,false);
  assert.ok(r.issues.includes('ERP_STOCK_LEDGER_UNVERIFIED'));
 }finally{f.close()}
});

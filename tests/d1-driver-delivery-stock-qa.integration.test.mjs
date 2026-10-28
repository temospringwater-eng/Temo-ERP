import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {debitVanStockForDeliveryQa} from '../services/d1-driver-delivery-stock-qa.mjs';
function setup(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,company_id INTEGER);INSERT INTO users VALUES(5,1);');
 db.exec('CREATE TABLE products(id INTEGER PRIMARY KEY,company_id INTEGER,stock INTEGER);INSERT INTO products VALUES(10,1,100)');
 for(const file of ['0002_canonical_van_stock.sql','0003_van_delivery_stock_guard.sql'])
  db.exec(readFileSync(new URL('../migrations/d1-qa/'+file,import.meta.url),'utf8'));
 db.exec("INSERT INTO van_stock_balances VALUES(1,5,10,8)");
 const adapter={prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args)||null},run(){const x=db.prepare(sql).run(...args);return {meta:{changes:x.changes}}}}}}},async batch(items){
  db.exec('BEGIN IMMEDIATE');try{const x=items.map(i=>i.run());db.exec('COMMIT');return x}
  catch(e){db.exec('ROLLBACK');throw e}
 }};
 const balance=()=>db.prepare('SELECT quantity FROM van_stock_balances WHERE company_id=1 AND driver_id=5 AND product_id=10').get().quantity;
 const count=()=>db.prepare('SELECT COUNT(*) n FROM van_stock_movements').get().n;
 return {adapter,balance,count};
}
const payload=(extra={})=>({companyId:1,driverId:5,productId:10,deliveryId:12,quantity:3,idempotencyKey:'delivery-12',...extra});
test('delivery stock debit is atomic and idempotent',async()=>{
 const f=setup();assert.deepEqual(await debitVanStockForDeliveryQa(f.adapter,payload()),{ok:true,replayed:false});
 assert.equal(f.balance(),5);assert.equal(f.count(),1);
 assert.deepEqual(await debitVanStockForDeliveryQa(f.adapter,payload()),{ok:true,replayed:true});
 assert.equal(f.balance(),5);assert.equal(f.count(),1);
});
test('changed retry conflicts',async()=>{
 const f=setup();await debitVanStockForDeliveryQa(f.adapter,payload());
 await assert.rejects(debitVanStockForDeliveryQa(f.adapter,payload({quantity:4})),/idempotency conflict/);
 assert.equal(f.balance(),5);
});
test('insufficient van stock rolls back movement and debit',async()=>{
 const f=setup();await assert.rejects(debitVanStockForDeliveryQa(f.adapter,payload({quantity:9})),/insufficient van stock/);
 assert.equal(f.balance(),8);assert.equal(f.count(),0);
});
test('company and driver isolation',async()=>{
 const f=setup();
 await assert.rejects(debitVanStockForDeliveryQa(f.adapter,payload({companyId:2})),/insufficient van stock/);
 await assert.rejects(debitVanStockForDeliveryQa(f.adapter,payload({driverId:6})),/insufficient van stock/);
 assert.equal(f.balance(),8);assert.equal(f.count(),0);
});

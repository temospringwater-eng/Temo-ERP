import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {transferWarehouseToVan} from '../services/d1-canonical-stock.mjs';

function fixture() {
 const sql=readFileSync(new URL('../migrations/d1-qa/0002_canonical_van_stock.sql',import.meta.url),'utf8');
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL);');
 db.exec('INSERT INTO users VALUES(5,1),(6,2);');
 db.exec('CREATE TABLE products(id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, stock INTEGER NOT NULL CHECK(stock>=0));');
 db.exec('INSERT INTO products VALUES(10,1,20),(11,2,9)');
 db.exec(sql);db.exec(sql);
 const adapter={
  prepare(query){return {bind(...args){return {
   async first(){return db.prepare(query).get(...args)??null;},
   run(){const result=db.prepare(query).run(...args);return {meta:{changes:result.changes}};}
  }}}},
  async batch(statements){
   db.exec('BEGIN IMMEDIATE');
   try {const results=statements.map(s=>s.run());db.exec('COMMIT');return results;}
   catch(e){db.exec('ROLLBACK');throw e;}
  }
 };
 return {db,adapter,stock:(id=10)=>db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock,
  van:()=>db.prepare('SELECT quantity FROM van_stock_balances WHERE company_id=1 AND driver_id=5 AND product_id=10').get()?.quantity??0,
  movements:()=>db.prepare('SELECT COUNT(*) n FROM van_stock_movements').get().n};
}
const request=(overrides={})=>({companyId:1,driverId:5,productId:10,quantity:7,idempotencyKey:'load-1',...overrides});
test('warehouse-to-van transfer conserves stock atomically',async()=>{
 const f=fixture();const result=await transferWarehouseToVan(f.adapter,request());
 assert.deepEqual(result,{ok:true,replayed:false});assert.equal(f.stock(),13);assert.equal(f.van(),7);assert.equal(f.movements(),1);
});
test('identical retry does not double-post',async()=>{
 const f=fixture();await transferWarehouseToVan(f.adapter,request());
 assert.deepEqual(await transferWarehouseToVan(f.adapter,request()),{ok:true,replayed:true});
 assert.equal(f.stock(),13);assert.equal(f.van(),7);assert.equal(f.movements(),1);
});
test('changed payload with same key is rejected',async()=>{
 const f=fixture();await transferWarehouseToVan(f.adapter,request());
 await assert.rejects(transferWarehouseToVan(f.adapter,request({quantity:8})),/idempotency conflict/);
 assert.equal(f.stock(),13);assert.equal(f.van(),7);
});
test('insufficient stock rolls back all movements',async()=>{
 const f=fixture();await assert.rejects(transferWarehouseToVan(f.adapter,request({quantity:21})),/insufficient warehouse stock/);
 assert.equal(f.stock(),20);assert.equal(f.van(),0);assert.equal(f.movements(),0);
});
test('cross-company product cannot be loaded',async()=>{
 const f=fixture();await assert.rejects(transferWarehouseToVan(f.adapter,request({productId:11})),/insufficient warehouse stock/);
 assert.equal(f.stock(11),9);assert.equal(f.van(),0);assert.equal(f.movements(),0);
});
test('nonexistent or cross-company driver cannot be loaded',async()=>{
 const f=fixture();
 for(const driverId of [6,999])
  await assert.rejects(transferWarehouseToVan(f.adapter,request({driverId})),/invalid company driver/);
 assert.equal(f.stock(),20);assert.equal(f.van(),0);assert.equal(f.movements(),0);
});
test('invalid quantities and identifiers rejected',async()=>{
 const f=fixture();
 for(const q of [0,-1,1.5])await assert.rejects(transferWarehouseToVan(f.adapter,request({quantity:q})),/invalid/);
 await assert.rejects(transferWarehouseToVan(f.adapter,request({idempotencyKey:' '})),/invalid/);
 assert.equal(f.movements(),0);
});

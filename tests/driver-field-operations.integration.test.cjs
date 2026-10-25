'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createDriverFieldOpsQa}=require('../services/driver-field-operations-qa');
class SQLite3Compat {
 static OPEN_READWRITE=1;
 constructor(name,mode,callback){
  try{this.db=new DatabaseSync(name);queueMicrotask(()=>callback(null));}catch(e){queueMicrotask(()=>callback(e));}
 }
 exec(sql,callback){try{this.db.exec(sql);callback(null);}catch(e){callback(e);}}
 get(sql,args,callback){try{callback(null,this.db.prepare(sql).get(...args));}catch(e){callback(e);}}
 run(sql,args,callback){
  try{const row=this.db.prepare(sql).run(...args);
   callback.call({changes:Number(row.changes),lastID:Number(row.lastInsertRowid)},null);
  }catch(e){callback(e);}
 }
 close(callback){try{this.db.close();callback(null);}catch(e){callback(e);}}
}
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'temo-fields-'));
 const filename=path.join(dir,'disposable.db');
 const db=new DatabaseSync(filename);
 db.exec([
  "CREATE TABLE companies(id INTEGER PRIMARY KEY,active INTEGER DEFAULT 1)",
  "CREATE TABLE users(id INTEGER PRIMARY KEY,company_id INTEGER,role TEXT,active INTEGER DEFAULT 1)",
  "CREATE TABLE customers(id INTEGER PRIMARY KEY,company_id INTEGER,name TEXT,phone TEXT,address TEXT,latitude REAL,longitude REAL)",
  "CREATE TABLE orders(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER,customer_id INTEGER,customer_name TEXT,delivery_address TEXT,notes TEXT,status TEXT,total_amount REAL,created_by INTEGER)",
  "CREATE TABLE order_items(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER,order_id INTEGER,product_id INTEGER,quantity INTEGER,unit_price REAL,total_price REAL)",
  "CREATE TABLE deliveries(id INTEGER PRIMARY KEY,company_id INTEGER,order_id INTEGER,driver_id INTEGER,status TEXT)",
  "CREATE TABLE products(id INTEGER PRIMARY KEY,company_id INTEGER,name TEXT,sale_price REAL,stock INTEGER)",
  "CREATE TABLE credit_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER,customer_id INTEGER,payment_id INTEGER,entry_type TEXT,amount REAL,note TEXT,created_by INTEGER,due_date TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
  "CREATE TABLE payments(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER,customer_name TEXT,amount REAL,method TEXT,note TEXT)",
  "CREATE TABLE service_areas(id INTEGER PRIMARY KEY,company_id INTEGER,level TEXT,name TEXT,active INTEGER DEFAULT 1)",
  "CREATE TABLE service_area_drivers(company_id INTEGER,service_area_id INTEGER,driver_id INTEGER,assigned_by INTEGER,PRIMARY KEY(company_id,service_area_id,driver_id))",
  "CREATE TABLE customer_service_areas(company_id INTEGER,service_area_id INTEGER,customer_id INTEGER,PRIMARY KEY(company_id,customer_id))",
  "CREATE TABLE delivery_routes(id INTEGER PRIMARY KEY,company_id INTEGER,name TEXT,route_date TEXT,driver_id INTEGER)",
  "CREATE TABLE delivery_route_stops(id INTEGER PRIMARY KEY,company_id INTEGER,route_id INTEGER,delivery_id INTEGER,sequence INTEGER,status TEXT)",
  "CREATE TABLE stock_movements(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER,warehouse_id INTEGER,product_id INTEGER,movement_type TEXT,quantity INTEGER,reference TEXT,created_by INTEGER)"
 ].join(';')+';');
 db.exec(fs.readFileSync(path.join(__dirname,'../migrations/qa-driver-field-ops-six-modules.sql'),'utf8'));
 db.exec([
  "INSERT INTO companies VALUES(1,1),(2,1)",
  "INSERT INTO users(id,company_id,role,active) VALUES(3,1,'driver',1),(4,2,'driver',1),(11,1,'company_admin',1),(12,2,'company_admin',1),(5,1,'driver',0)",
  "INSERT INTO customers(id,company_id,name,phone,address) VALUES(501,1,'Home One','03001','Sector A'),(502,1,'Private Other','03002','Secret'),(601,2,'Other Tenant','03003','City B')",
  "INSERT INTO orders(id,company_id,customer_id,customer_name,delivery_address,status,total_amount,created_by) VALUES(201,1,501,'Home One','Sector A','assigned',500,11),(202,2,601,'Other Tenant','City B','assigned',100,12)",
  "INSERT INTO deliveries VALUES(301,1,201,3,'assigned'),(302,2,202,4,'assigned')",
  "INSERT INTO products VALUES(10,1,'TEMO 19L',200,20),(11,1,'TEMO 500ml',45,5),(20,2,'Foreign',5,100)",
  "INSERT INTO credit_ledger(company_id,customer_id,entry_type,amount,note,created_by) VALUES(1,501,'invoice',500,'Invoice',11),(2,601,'invoice',400,'Foreign invoice',12)",
  "INSERT INTO service_areas(id,company_id,level,name,active) VALUES(1,1,'zone','Sector A',1),(2,2,'zone','Other Tenant Zone',1)",
  "INSERT INTO delivery_routes(id,company_id,name,route_date,driver_id) VALUES(1,1,'AM Route','2026-10-25',3),(2,2,'Foreign Route','2026-10-25',4)",
  "INSERT INTO delivery_route_stops(id,company_id,route_id,delivery_id,sequence,status) VALUES(1,1,1,301,1,'pending'),(2,2,2,302,1,'pending')"
 ].join(';')+';');
 const query=async(sql,args=[])=>db.prepare(sql).all(...args);
 const paths={get:new Map(),post:new Map()};
 const app={get(p,fn){paths.get.set(p,fn)},post(p,fn){paths.post.set(p,fn)}};
 createDriverFieldOpsQa({app,sqlite3:{Database:SQLite3Compat},dbPath:filename,query,qaEnabled:true});
 const make=async(method,endpoint,{user={id:3,role:'driver'},companyId=1,body={},params={}}={})=>{
  const fn=paths[method].get(endpoint);assert.ok(fn,'route missing '+endpoint);
  const res={code:200,status(s){this.code=s;return this;},json(body){this.body=body;return this;}};
  await fn({user,companyId,body,params},res);
  return res;
 };
 const admin={user:{id:11,role:'company_admin'},companyId:1};
 const grant=async(permission,enabled=true)=>make('post','/api/admin/driver/field/permissions',
  {...admin,body:{driverId:3,permission,enabled}});
 const count=t=>db.prepare('SELECT COUNT(*) AS n FROM '+t).get().n;
 return {dir,db,make,grant,count,admin,close(){db.close();fs.rmSync(dir,{recursive:true,force:true})}};
}
const api='/api/driver/field';
test('all six modules are denied when no Company Admin permission exists',async t=>{
 const f=fixture();t.after(f.close);
 for(const route of ['/products','/customers/:id/ledger','/zones','/van-stock'])
  assert.equal((await f.make('get',api+route,{params:{id:'501'}})).code,403,route);
 assert.equal((await f.make('post',api+'/customers',{body:{idempotencyKey:'test-customer-1',name:'Test',phone:'123',address:'Test'}})).code,403);
 assert.equal(f.count('customers'),3);
});
test('Add Customer: same-company permission, encrypted-client idempotency, GPS and duplicate protection',async t=>{
 const f=fixture();t.after(f.close);assert.equal((await f.grant('create_customer')).code,200);
 const body={idempotencyKey:'driver3-cust-001',name:'New Home',phone:'0300033',address:'Zone Street',latitude:24.5,longitude:46.4};
 const a=await f.make('post',api+'/customers',{body});
 assert.equal(a.body.success,true);assert.equal(a.body.companyId,1);
 assert.equal((await f.make('post',api+'/customers',{body})).body.customerId,a.body.customerId);
 assert.equal(f.count('customers'),4);
 assert.equal((await f.make('post',api+'/customers',{body:{...body,name:'Tampered'}})).code,409);
 assert.equal((await f.make('post',api+'/customers',{body:{...body,idempotencyKey:'driver3-cust-002',latitude:333}})).code,400);
 assert.equal((await f.make('get',api+'/customers')).body.items.length,2);
});
test('New Order: server pricing, assigned customer, pending dispatch and retry idempotency',async t=>{
 const f=fixture();t.after(f.close);await f.grant('create_order');
 const body={idempotencyKey:'driver3-order-001',customerId:501,items:[{productId:10,quantity:2}]};
 const r=await f.make('post',api+'/orders',{body});
 assert.equal(r.body.totalAmount,400);assert.equal(r.body.status,'pending');
 assert.equal((await f.make('post',api+'/orders',{body})).body.orderId,r.body.orderId);
 assert.equal(f.count('orders'),3);assert.equal(f.count('order_items'),1);
 assert.equal(f.db.prepare('SELECT total_price FROM order_items WHERE order_id=?').get(r.body.orderId).total_price,400);
 assert.equal((await f.make('post',api+'/orders',{body:{...body,idempotencyKey:'driver3-order-002',customerId:502}})).code,404);
 assert.equal((await f.make('post',api+'/orders',{body:{...body,idempotencyKey:'driver3-order-003',items:[{productId:20,quantity:1}]}})).code,409);
 assert.equal((await f.make('post',api+'/orders',{body:{...body,idempotencyKey:'driver3-order-004',items:[{productId:10,quantity:21}]}})).code,409);
});
test('Ledger and independent recovery: atomic credited payment and no duplicate or overpayment',async t=>{
 const f=fixture();t.after(f.close);await f.grant('view_customer_ledger');await f.grant('collect_recovery');
 const before=await f.make('get',api+'/customers/:id/ledger',{params:{id:'501'}});
 assert.equal(before.body.balance,500);
 assert.equal((await f.make('get',api+'/customers/:id/ledger',{params:{id:'502'}})).code,404);
 const body={idempotencyKey:'driver3-cash-001',customerId:501,amount:125,method:'Cash'};
 const rec=await f.make('post',api+'/recoveries',{body});
 assert.equal(rec.body.success,true);assert.equal(rec.body.remainingBalance,375);
 assert.deepEqual((await f.make('post',api+'/recoveries',{body})).body,rec.body);
 assert.equal(f.count('payments'),1);assert.equal(f.count('credit_ledger'),3);
 assert.equal((await f.make('get',api+'/customers/:id/ledger',{params:{id:'501'}})).body.balance,375);
 assert.equal((await f.make('post',api+'/recoveries',{body:{...body,idempotencyKey:'driver3-cash-002',amount:500}})).code,409);
 assert.equal(f.count('payments'),1);
});
test('Recovery SQL constraint rollback: no partial cash receipt nor idempotency receipt',async t=>{
 const f=fixture();t.after(f.close);await f.grant('collect_recovery');
 f.db.exec("CREATE TRIGGER deny_payment_ledger BEFORE INSERT ON credit_ledger BEGIN SELECT RAISE(ABORT,'QA fail'); END");
 const r=await f.make('post',api+'/recoveries',{body:{idempotencyKey:'driver3-cash-rollback',customerId:501,amount:100,method:'Cash'}});
 assert.equal(r.code,503);assert.equal(f.count('payments'),0);
 assert.equal(f.count('driver_field_receipts'),0);assert.equal(f.count('credit_ledger'),2);
});
test('Zone scheduling: Company Admin assigns only own active zone and driver sees ordered route',async t=>{
 const f=fixture();t.after(f.close);await f.grant('view_zone');
 const admin=await f.make('post','/api/admin/driver/field/zones/assign',
  {...f.admin,body:{driverId:3,zoneId:1}});
 assert.equal(admin.body.success,true);
 const route=await f.make('get',api+'/zones');
 assert.equal(route.body.zones.length,1);assert.equal(route.body.routes.length,1);
 assert.equal(route.body.routes[0].delivery_id,301);
 assert.equal((await f.make('post','/api/admin/driver/field/zones/assign',{...f.admin,body:{driverId:4,zoneId:2}})).code,404);
});
test('Van Stock: Admin loads with stock debit, transfer ledger, idempotency, no overselling',async t=>{
 const f=fixture();t.after(f.close);await f.grant('view_van_stock');
 const body={idempotencyKey:'admin11-load-001',driverId:3,productId:10,quantity:4};
 const first=await f.make('post','/api/admin/driver/field/van-stock/load',{...f.admin,body});
 assert.equal(first.body.success,true);
 assert.equal((await f.make('post','/api/admin/driver/field/van-stock/load',{...f.admin,body})).body.loadedQuantity,4);
 assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=10').get().stock,16);
 assert.equal(f.count('driver_field_van_movements'),1);assert.equal(f.count('stock_movements'),1);
 assert.equal((await f.make('get',api+'/van-stock')).body.items[0].quantity,4);
 assert.equal((await f.make('post','/api/admin/driver/field/van-stock/load',{...f.admin,body:{...body,idempotencyKey:'admin11-load-002',quantity:50}})).code,409);
 assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=10').get().stock,16);
});
test('foreign-tenant actor, inactive driver and role escalation denied',async t=>{
 const f=fixture();t.after(f.close);await f.grant('create_order');await f.grant('collect_recovery');
 const wrong=await f.make('get',api+'/customers',{user:{id:4,role:'driver'},companyId:1});
 assert.equal(wrong.code,403);
 assert.equal((await f.make('post','/api/admin/driver/field/permissions',{body:{driverId:3,permission:'create_order',enabled:true}})).code,403);
 assert.equal((await f.make('get',api+'/customers',{user:{id:5,role:'driver'}})).code,403);
});
test('QA disabled: no field read or mutation executes',async t=>{
 const f=fixture();t.after(f.close);
 const paths={post(newPath,fn){this.route=fn},get(){}};
 createDriverFieldOpsQa({app:paths,sqlite3:{Database:SQLite3Compat},dbPath:path.join(f.dir,'disposable.db'),query:async()=>[],qaEnabled:false});
 const res={status(n){this.code=n;return this},json(v){this.body=v;return this}};
 await paths.route({body:{}},res);assert.equal(res.code,503);
});

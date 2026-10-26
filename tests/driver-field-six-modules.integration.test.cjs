'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createDriverFieldOpsQa}=require('../services/driver-field-operations-qa');
class Sqlite3Shim{
 constructor(file,flags,cb){this.db=new DatabaseSync(file);queueMicrotask(()=>cb(null));}
 exec(sql,cb){try{this.db.exec(sql);cb(null)}catch(e){cb(e)}}
 get(sql,args,cb){try{cb(null,this.db.prepare(sql).get(...args))}catch(e){cb(e)}}
 run(sql,args,cb){try{const x=this.db.prepare(sql).run(...args);cb.call({changes:Number(x.changes),lastID:Number(x.lastInsertRowid)},null)}catch(e){cb(e)}}
 close(cb){this.db.close();cb(null)}
}
function fixture(enabled=true){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'temo-six-')),file=path.join(dir,'disposable-qa.db');
 const db=new DatabaseSync(file);
 const tables=[
 'CREATE TABLE companies(id INTEGER PRIMARY KEY,active INTEGER)',
 'CREATE TABLE users(id INTEGER PRIMARY KEY,company_id INTEGER,role TEXT,active INTEGER)',
 'CREATE TABLE customers(id INTEGER PRIMARY KEY,company_id INTEGER,name TEXT,phone TEXT,address TEXT,latitude REAL,longitude REAL)',
 'CREATE TABLE products(id INTEGER PRIMARY KEY,company_id INTEGER,name TEXT,sale_price REAL,stock INTEGER)',
 'CREATE TABLE orders(id INTEGER PRIMARY KEY,company_id INTEGER,customer_id INTEGER,customer_name TEXT,delivery_address TEXT,notes TEXT,status TEXT,total_amount REAL,created_by INTEGER)',
 'CREATE TABLE order_items(id INTEGER PRIMARY KEY,company_id INTEGER,order_id INTEGER,product_id INTEGER,quantity INTEGER,unit_price REAL,total_price REAL)',
 'CREATE TABLE deliveries(id INTEGER PRIMARY KEY,company_id INTEGER,order_id INTEGER,driver_id INTEGER,status TEXT)',
 'CREATE TABLE payments(id INTEGER PRIMARY KEY,company_id INTEGER,customer_name TEXT,amount REAL,method TEXT,note TEXT)',
 'CREATE TABLE credit_ledger(id INTEGER PRIMARY KEY,company_id INTEGER,customer_id INTEGER,payment_id INTEGER,entry_type TEXT,amount REAL,note TEXT,created_by INTEGER,due_date TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)',
 'CREATE TABLE service_areas(id INTEGER PRIMARY KEY,company_id INTEGER,parent_id INTEGER,level TEXT,name TEXT,active INTEGER)',
 'CREATE TABLE customer_service_areas(company_id INTEGER,customer_id INTEGER,service_area_id INTEGER)',
 'CREATE TABLE service_area_drivers(company_id INTEGER,service_area_id INTEGER,driver_id INTEGER,assigned_by INTEGER,PRIMARY KEY(company_id,service_area_id,driver_id))',
 'CREATE TABLE delivery_routes(id INTEGER PRIMARY KEY,company_id INTEGER,driver_id INTEGER,name TEXT,route_date TEXT,area TEXT,status TEXT,created_by INTEGER)',
 'CREATE TABLE delivery_route_stops(id INTEGER PRIMARY KEY,company_id INTEGER,route_id INTEGER,delivery_id INTEGER,sequence INTEGER,status TEXT)',
 'CREATE TABLE stock_movements(id INTEGER PRIMARY KEY,company_id INTEGER,warehouse_id INTEGER,product_id INTEGER,movement_type TEXT,quantity INTEGER,reference TEXT,created_by INTEGER)',
 'INSERT INTO companies VALUES(1,1),(2,1)',
 "INSERT INTO users VALUES(3,1,'driver',1),(4,1,'driver',1),(8,1,'company_admin',1),(12,2,'driver',1)",
 "INSERT INTO customers VALUES(41,1,'Customer A','05012','QA Street',24.5,46.5),(42,2,'Foreign Customer','05999','Other',NULL,NULL),(43,1,'Not Assigned','05555','Private',NULL,NULL)",
 "INSERT INTO products VALUES(51,1,'19L',450,50),(52,2,'Foreign',500,30)",
 "INSERT INTO orders VALUES(61,1,41,'Customer A','QA Street','','assigned',100,8)",
 "INSERT INTO deliveries VALUES(71,1,61,3,'assigned')",
 "INSERT INTO credit_ledger(company_id,customer_id,entry_type,amount) VALUES(1,41,'invoice',350),(2,42,'invoice',900)",
 "INSERT INTO service_areas VALUES(81,1,NULL,'zone','QA North',1),(82,2,NULL,'zone','Foreign',1)",
 'INSERT INTO customer_service_areas VALUES(1,41,81),(2,42,82)',
 "INSERT INTO delivery_routes VALUES(91,1,3,'AM','2026-10-25','North','completed',8),(92,2,12,'Foreign','2026-10-25','Foreign','completed',12)",
 "INSERT INTO delivery_route_stops VALUES(101,1,91,71,1,'pending')"
 ];
 for(const sql of tables)db.exec(sql);
 db.exec(fs.readFileSync(path.join(__dirname,'../migrations/qa-driver-field-ops-six-modules.sql'),'utf8'));
 const app={routes:{},get(p,fn){this.routes['GET '+p]=fn},post(p,fn){this.routes['POST '+p]=fn}};
 const query=async(sql,args=[])=>db.prepare(sql).all(...args);
 createDriverFieldOpsQa({app,sqlite3:{Database:Sqlite3Shim,OPEN_READWRITE:2},dbPath:file,query,qaEnabled:enabled});
 const call=async(method,uri,{body={},user={id:3,role:'driver'},companyId=1,params={}}={})=>{
  const res={code:200,status(n){this.code=n;return this},json(x){this.data=x;return this}};
  assert.ok(app.routes[method+' '+uri],'missing '+uri);
  await app.routes[method+' '+uri]({user,companyId,body,params},res);return res;
 };
 const admin={id:8,role:'company_admin'};
 const grant=async permission=>call('POST','/api/admin/driver/field/permissions',{user:admin,body:{driverId:3,permission,enabled:true}});
 const count=table=>db.prepare('SELECT COUNT(*) n FROM '+table).get().n;
 return {db,call,grant,count,admin,close(){db.close();fs.rmSync(dir,{force:true,recursive:true})}};
}
test('default QA disabled: no read or write is enabled',async t=>{
 const f=fixture(false);t.after(f.close);
 assert.equal((await f.call('GET','/api/driver/field/customers')).code,503);
 assert.equal(f.count('customers'),3);
});
test('deny by default, company Admin alone can grant and revoke scope',async t=>{
 const f=fixture();t.after(f.close);
 const body={idempotencyKey:'create-test-001',name:'QA',phone:'050',address:'Street'};
 assert.equal((await f.call('POST','/api/driver/field/customers',{body})).code,403);
 assert.equal((await f.call('POST','/api/admin/driver/field/permissions',{body:{driverId:3,permission:'create_customer',enabled:true}})).code,403);
 assert.equal((await f.grant('create_customer')).code,200);
 assert.equal((await f.call('POST','/api/admin/driver/field/permissions',{user:f.admin,body:{driverId:12,permission:'create_customer',enabled:true}})).code,404);
});
test('new Customer: scoped, GPS checked, atomic idempotent insert',async t=>{
 const f=fixture();t.after(f.close);await f.grant('create_customer');
 const body={idempotencyKey:'customer-unique-001',name:'New Customer',phone:'05011',address:'QA Zone',latitude:24.5,longitude:46.7};
 const first=await f.call('POST','/api/driver/field/customers',{body});
 assert.equal(first.code,200,JSON.stringify(first.data));
 assert.equal(first.data.customerId,44);
 assert.deepEqual((await f.call('POST','/api/driver/field/customers',{body})).data,first.data);
 assert.equal(f.count('customers'),4);assert.equal(f.count('driver_field_customer_assignments'),1);
 assert.equal((await f.call('POST','/api/driver/field/customers',{body:{...body,name:'Tamper'}})).code,409);
 assert.equal((await f.call('POST','/api/driver/field/customers',{body:{...body,idempotencyKey:'bad-lat-000001',latitude:190}})).code,400);
 assert.deepEqual((await f.call('GET','/api/driver/field/customers')).data.items.map(x=>x.id).sort((a,b)=>a-b),[41,44]);
});
test('New Order: authentic ERP price, restricted customer, idempotent pending order',async t=>{
 const f=fixture();t.after(f.close);await f.grant('create_order');
 const body={idempotencyKey:'new-order-001',customerId:41,items:[{productId:51,quantity:3}]};
 const first=await f.call('POST','/api/driver/field/orders',{body});
 assert.equal(first.code,200,JSON.stringify(first.data));assert.equal(first.data.totalAmount,1350);
 assert.equal(first.data.status,'pending');
 assert.deepEqual((await f.call('POST','/api/driver/field/orders',{body})).data,first.data);
 assert.equal(f.count('orders'),2);assert.equal(f.count('order_items'),1);
 assert.equal((await f.call('POST','/api/driver/field/orders',{body:{...body,idempotencyKey:'foreign-order-01',customerId:42}})).code,404);
 assert.equal((await f.call('POST','/api/driver/field/orders',{body:{...body,idempotencyKey:'forbidden-order-01',customerId:43}})).code,404);
 assert.equal((await f.call('POST','/api/driver/field/orders',{body:{...body,idempotencyKey:'insufficient-01',items:[{productId:51,quantity:60}]}})).code,409);
 assert.equal(f.count('orders'),2);
});
test('Recovery & Customer Ledger: exact scoped credits, no overpayment, rollback on SQL failure',async t=>{
 const f=fixture();t.after(f.close);await f.grant('collect_recovery');await f.grant('view_customer_ledger');
 const uri='/api/driver/field/customers/:id/ledger',param={params:{id:'41'}};
 assert.equal((await f.call('GET',uri,param)).data.balance,350);
 const body={idempotencyKey:'recovery-cash-001',customerId:41,amount:125,method:'Cash'};
 const first=await f.call('POST','/api/driver/field/recoveries',{body});
 assert.equal(first.code,200,JSON.stringify(first.data));assert.equal(first.data.remainingBalance,225);
 assert.deepEqual(first.data,(await f.call('POST','/api/driver/field/recoveries',{body})).data);
 assert.equal((await f.call('GET',uri,param)).data.balance,225);
 assert.equal(f.count('payments'),1);assert.equal(f.count('credit_ledger'),3);
 assert.equal((await f.call('POST','/api/driver/field/recoveries',{body:{...body,idempotencyKey:'over-pay-00001',amount:500}})).code,409);
 f.db.exec("CREATE TRIGGER deny_ledger BEFORE INSERT ON credit_ledger BEGIN SELECT RAISE(ABORT,'deny'); END");
 const rollback=await f.call('POST','/api/driver/field/recoveries',{body:{...body,idempotencyKey:'rollback-00001',amount:5}});
 assert.equal(rollback.code,503);assert.equal(f.count('payments'),1);
});
test('Zone scheduling: only assigned company zone and ordered driver route',async t=>{
 const f=fixture();t.after(f.close);await f.grant('view_zone');
 const result=await f.call('POST','/api/admin/driver/field/zones/assign',{user:f.admin,body:{driverId:3,zoneId:81}});
 assert.equal(result.code,200,JSON.stringify(result.data));
 const z=await f.call('GET','/api/driver/field/zones');
 assert.equal(z.code,200);assert.equal(z.data.zones.length,1);assert.equal(z.data.routes.length,1);
 assert.equal((await f.call('POST','/api/admin/driver/field/zones/assign',{user:f.admin,body:{driverId:3,zoneId:82}})).code,404);
});
test('Van stock: admin-owned atomic ERP inventory transfer, retry does not double debit',async t=>{
 const f=fixture();t.after(f.close);await f.grant('view_van_stock');
 const body={driverId:3,productId:51,quantity:8,idempotencyKey:'van-load-00001'};
 const first=await f.call('POST','/api/admin/driver/field/van-stock/load',{user:f.admin,body});
 assert.equal(first.code,200,JSON.stringify(first.data));
 assert.deepEqual((await f.call('POST','/api/admin/driver/field/van-stock/load',{user:f.admin,body})).data,first.data);
 assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=51').get().stock,42);
 assert.equal(f.count('driver_field_van_movements'),1);assert.equal(f.count('stock_movements'),1);
 assert.equal((await f.call('GET','/api/driver/field/van-stock')).data.items[0].quantity,8);
 assert.equal((await f.call('POST','/api/admin/driver/field/van-stock/load',{user:f.admin,body:{...body,idempotencyKey:'out-stock-00001',quantity:999}})).code,409);
 assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=51').get().stock,42);
});

test('Company Admin schedules assigned driver route with ordered stops; no duplicates or foreign deliveries',async t=>{
 const f=fixture();t.after(f.close);
 const assigned=await f.call('POST','/api/admin/driver/field/zones/assign',{user:f.admin,body:{driverId:3,zoneId:81}});
 assert.equal(assigned.code,200,JSON.stringify(assigned.data));
 const data={driverId:3,zoneId:81,routeDate:'2026-10-25',deliveryIds:[71],name:'QA route',idempotencyKey:'route-schedule-001'};
 const first=await f.call('POST','/api/admin/driver/field/routes/schedule',{user:f.admin,body:data});
 assert.equal(first.code,200,JSON.stringify(first.data));assert.equal(first.data.stops,1);
 assert.equal(f.count('delivery_routes'),3);assert.equal(f.count('delivery_route_stops'),2);
 assert.deepEqual((await f.call('POST','/api/admin/driver/field/routes/schedule',{user:f.admin,body:data})).data,first.data);
 const duplicate=await f.call('POST','/api/admin/driver/field/routes/schedule',{user:f.admin,body:{...data,idempotencyKey:'another-route-01'}});
 assert.equal(duplicate.code,409);assert.equal(f.count('delivery_routes'),3);
 const foreign=await f.call('POST','/api/admin/driver/field/routes/schedule',{user:f.admin,body:{...data,idempotencyKey:'foreign-route01',deliveryIds:[999]}});
 assert.equal(foreign.code,409);
 const driverCannot=await f.call('POST','/api/admin/driver/field/routes/schedule',{body:data});
 assert.equal(driverCannot.code,403);
});
test('Admin van returns are atomic, cannot return beyond driver balance, retry idempotent',async t=>{
 const f=fixture();t.after(f.close);await f.grant('view_van_stock');
 const load={driverId:3,productId:51,quantity:8,idempotencyKey:'first-load-001'};
 assert.equal((await f.call('POST','/api/admin/driver/field/van-stock/load',{user:f.admin,body:load})).code,200);
 const back={driverId:3,productId:51,quantity:3,idempotencyKey:'return-stock-01'};
 const first=await f.call('POST','/api/admin/driver/field/van-stock/return',{user:f.admin,body:back});
 assert.equal(first.code,200,JSON.stringify(first.data));
 assert.deepEqual((await f.call('POST','/api/admin/driver/field/van-stock/return',{user:f.admin,body:back})).data,first.data);
 assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=51').get().stock,45);
 assert.equal((await f.call('GET','/api/driver/field/van-stock')).data.items[0].quantity,5);
 const tooMuch=await f.call('POST','/api/admin/driver/field/van-stock/return',{user:f.admin,body:{...back,idempotencyKey:'return-too-much',quantity:15}});
 assert.equal(tooMuch.code,409);assert.equal(f.count('driver_field_van_movements'),2);
});

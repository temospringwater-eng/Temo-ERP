'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const handlerPromise=import('../services/d1-driver-field-read-qa.mjs');
const ROOT='https://isolated-qa.example.test';
function fixture(t){
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
  sqlite.exec(`
    CREATE TABLE companies(id INTEGER PRIMARY KEY,active INTEGER);
    CREATE TABLE users(id INTEGER PRIMARY KEY,company_id INTEGER,role TEXT,active INTEGER);
    CREATE TABLE customers(id INTEGER PRIMARY KEY,company_id INTEGER,name TEXT,phone TEXT,address TEXT,latitude REAL,longitude REAL);
    CREATE TABLE products(id INTEGER PRIMARY KEY,company_id INTEGER,name TEXT,sale_price REAL,stock INTEGER);
    CREATE TABLE orders(id INTEGER PRIMARY KEY,company_id INTEGER,customer_id INTEGER);
    CREATE TABLE deliveries(id INTEGER PRIMARY KEY,company_id INTEGER,order_id INTEGER,driver_id INTEGER);
    CREATE TABLE driver_field_permissions(company_id INTEGER,driver_id INTEGER,permission TEXT,enabled INTEGER);
    CREATE TABLE driver_field_customer_assignments(company_id INTEGER,driver_id INTEGER,customer_id INTEGER);
    CREATE TABLE customer_service_areas(company_id INTEGER,service_area_id INTEGER,customer_id INTEGER);
    CREATE TABLE service_area_drivers(company_id INTEGER,service_area_id INTEGER,driver_id INTEGER);
    CREATE TABLE service_areas(id INTEGER PRIMARY KEY,company_id INTEGER,name TEXT,level TEXT,active INTEGER);
    CREATE TABLE delivery_routes(id INTEGER PRIMARY KEY,company_id INTEGER,driver_id INTEGER,name TEXT,route_date TEXT);
    CREATE TABLE delivery_route_stops(id INTEGER PRIMARY KEY,company_id INTEGER,route_id INTEGER,delivery_id INTEGER,sequence INTEGER,status TEXT);
    CREATE TABLE driver_field_van_movements(company_id INTEGER,driver_id INTEGER,product_id INTEGER,quantity INTEGER);
    CREATE TABLE credit_ledger(id INTEGER PRIMARY KEY,company_id INTEGER,customer_id INTEGER,entry_type TEXT,amount REAL,note TEXT,due_date TEXT,created_at TEXT);
    INSERT INTO companies VALUES(1,1),(2,1),(3,0);
    INSERT INTO users VALUES(3,1,'driver',1),(4,2,'driver',1),(5,1,'driver',0),(9,3,'driver',1);
    INSERT INTO customers VALUES(10,1,'Assigned A','A','Address A',24.0,46.0),(11,1,'Private A','B','Address B',NULL,NULL),(20,2,'Private B','C','Secret',NULL,NULL);
    INSERT INTO products VALUES(100,1,'19L',450,20),(200,2,'Foreign',900,200);
    INSERT INTO driver_field_customer_assignments VALUES(1,3,10),(2,4,20);
    INSERT INTO driver_field_permissions VALUES(1,3,'view_customer_ledger',1),(1,3,'view_zone',1),(1,3,'view_van_stock',1),(1,3,'create_order',1),(2,4,'view_zone',1);
    INSERT INTO service_areas VALUES(50,1,'A Zone','zone',1),(60,2,'Foreign Zone','zone',1);
    INSERT INTO service_area_drivers VALUES(1,50,3),(2,60,4);
    INSERT INTO delivery_routes VALUES(70,1,3,'AM Route','2026-11-08'),(80,2,4,'Foreign Route','2026-11-08');
    INSERT INTO delivery_route_stops VALUES(71,1,70,701,1,'pending'),(81,2,80,801,1,'pending');
    INSERT INTO driver_field_van_movements VALUES(1,3,100,8),(1,3,100,-2),(2,4,200,100);
    INSERT INTO credit_ledger VALUES(1,1,10,'invoice',500,'A',NULL,'2026-11-08'),(2,1,10,'payment',125,'Paid',NULL,'2026-11-08'),(3,2,20,'invoice',900,'Private',NULL,'2026-11-08');
  `);
  const sql=[];
  const DB={prepare(statement){
    sql.push(statement);
    assert.match(statement.trim(),/^SELECT\b/i,'D1 read-only adapter must not write');
    return {bind(...args){
      return {all:async()=>({success:true,results:sqlite.prepare(statement).all(...args)}),
              first:async()=>sqlite.prepare(statement).get(...args)};
    }};
  }};
  const env={TEMO_ERP_D1_FIELD_QA_MODE:'1',DB};
  const actor={id:3,companyId:1,role:'driver',trusted:true};
  const req=(path,method='GET')=>new Request(ROOT+path,{method});
  const handler=async (identity=actor)=>
    (await handlerPromise).createD1DriverFieldReadQaHandler({resolveActor:async()=>identity});
  return{sqlite,sql,env,actor,req,handler};
}
test('TDD: QA-only GET contract fails closed for public, POST, unknown path and missing session resolver',async t=>{
  const f=fixture(t);const handler=await f.handler();
  assert.equal((await handler(f.req('/api/driver/field/customers'),{...f.env,TEMO_ERP_D1_FIELD_QA_MODE:'0'})).status,404);
  assert.equal((await handler(f.req('/api/driver/field/customers','POST'),f.env)).status,405);
  assert.equal((await handler(f.req('/api/driver/field/customers?companyId=2'),f.env)).status,404);
  assert.equal((await handler(f.req('/api/orders'),f.env)).status,404);
  const unauth=(await handlerPromise).createD1DriverFieldReadQaHandler();
  assert.equal((await unauth(f.req('/api/driver/field/customers'),f.env)).status,503);
  assert.deepEqual(f.sql,[]);
});
test('TDD: never trust arbitrary driver/company HTTP headers, invalid sessions or inactive accounts',async t=>{
  const f=fixture(t);
  for(const who of [null,{...f.actor,trusted:false},{...f.actor,id:0},{...f.actor,companyId:2},{...f.actor,id:5}]){
    const handler=await f.handler(who);
    const response=await handler(new Request(ROOT+'/api/driver/field/customers',{headers:{'x-company-id':'2','x-driver-id':'4'}}),f.env);
    assert.ok([401,403].includes(response.status),`Unexpected ${response.status}`);
  }
  const invalid=await f.handler({id:9,companyId:3,role:'driver',trusted:true});
  assert.equal((await invalid(f.req('/api/driver/field/customers'),f.env)).status,403);
});
test('TDD: matching tenant and driver permissions expose no foreign or unassigned customers',async t=>{
  const f=fixture(t);const handler=await f.handler();
  const customer=await handler(f.req('/api/driver/field/customers'),f.env);
  assert.equal(customer.status,200);
  const body=await customer.json();
  assert.equal(body.companyId,1);
  assert.deepEqual(body.items.map(c=>c.id),[10]);
  assert.equal((await handler(f.req('/api/driver/field/customers/11/ledger'),f.env)).status,404);
  assert.equal((await handler(f.req('/api/driver/field/customers/20/ledger'),f.env)).status,404);
  const ledger=await handler(f.req('/api/driver/field/customers/10/ledger'),f.env);
  assert.equal(ledger.status,200);
  assert.equal((await ledger.json()).balance,375);
});
test('TDD: permissions, products, bottle types, zones and van stock are company-scoped native D1 reads',async t=>{
  const f=fixture(t),handler=await f.handler();
  const get=async path=>{
    const response=await handler(f.req(path),f.env);
    assert.equal(response.status,200,path);
    return response.json();
  };
  assert.equal((await get('/api/driver/permissions')).permissions.view_zone,true);
  assert.deepEqual((await get('/api/driver/bottle-types')).items.map(i=>i.id),[100]);
  assert.deepEqual((await get('/api/driver/field/products')).items.map(i=>i.id),[100]);
  const zones=await get('/api/driver/field/zones');
  assert.deepEqual(zones.zones.map(z=>z.id),[50]);
  assert.deepEqual(zones.routes.map(r=>r.id),[70]);
  assert.deepEqual((await get('/api/driver/field/van-stock')).items.map(i=>i.quantity),[6]);
  const after=f.sqlite.prepare('SELECT total_changes() AS total').get().total;
  await get('/api/driver/field/customers');
  assert.equal(f.sqlite.prepare('SELECT total_changes() AS total').get().total,after);
});
test('TDD: revoked permissions reject ledger, zones, stock and prices; driver cannot read another company',async t=>{
  const f=fixture(t),handler=await f.handler();
  f.sqlite.exec('DELETE FROM driver_field_permissions WHERE company_id=1 AND driver_id=3');
  for(const path of ['/api/driver/field/customers/10/ledger','/api/driver/field/zones',
    '/api/driver/field/van-stock','/api/driver/field/products'])
    assert.equal((await handler(f.req(path),f.env)).status,403,path);
  const second=await f.handler({id:4,companyId:2,role:'driver',trusted:true});
  assert.deepEqual((await (await second(f.req('/api/driver/field/customers'),f.env)).json()).items.map(x=>x.id),[20]);
  assert.deepEqual((await (await second(f.req('/api/driver/bottle-types'),f.env)).json()).items.map(x=>x.id),[200]);
});
test('TDD: DB outage yields sanitized 503, never a successful empty ledger',async t=>{
  const f=fixture(t),handler=await f.handler();
  assert.equal((await handler(f.req('/api/driver/field/customers'),{...f.env,DB:null})).status,503);
  const broken={...f.env,DB:{prepare(){throw Error('DB connection secret');}}};
  const response=await handler(f.req('/api/driver/field/customers'),broken);
  assert.equal(response.status,503);
  assert.doesNotMatch(await response.text(),/connection secret/);
});

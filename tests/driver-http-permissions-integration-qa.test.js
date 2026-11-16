'use strict';
// QA-only contract. No remote Worker, D1 binding, real credentials or financial writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { createServer } = require('node:http');
const { DatabaseSync } = require('node:sqlite');

const QA_SECRET = 'temo-synthetic-contract-only-not-a-live-secret';
const NOW = 1794787200; // fixed clock; independent of CI runner time
const REVOKED = new Set(['revoked-session']);
const BASE_KEYS = [
  'create_customer','create_order','view_balance','change_qty',
  'change_price','edit_notes','manage_customer_schedule',
  'gps_delivery_override','refund_security_deposit','sale_quotation',
  'stock_negative_override','view_customer_ledger','collect_recovery',
  'view_zone','view_van_stock'
];

function signSynthetic(claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256',QA_SECRET).update(payload).digest('base64url');
  return payload + '.' + signature;
}
function resolveSyntheticAuthorization(header) {
  if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(header || '')) return null;
  const [body,signature] = header.slice(7).split('.');
  const expected = createHmac('sha256',QA_SECRET).update(body).digest();
  let actual;
  try { actual = Buffer.from(signature,'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual,expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    if (!Number.isSafeInteger(claims.id) || claims.id <= 0 ||
        !Number.isSafeInteger(claims.companyId) || claims.companyId <= 0 ||
        claims.role !== 'driver' || !Number.isSafeInteger(claims.exp) ||
        claims.exp <= NOW || REVOKED.has(claims.sid)) return null;
    // Only the test resolver (never client headers) supplies trusted=true.
    return { id:claims.id, companyId:claims.companyId, role:claims.role, trusted:true };
  } catch { return null; }
}
function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(()=>sqlite.close());
  sqlite.exec(`
    CREATE TABLE companies(id INTEGER PRIMARY KEY,active INTEGER);
    CREATE TABLE users(id INTEGER PRIMARY KEY,company_id INTEGER,role TEXT,active INTEGER);
    CREATE TABLE customers(id INTEGER PRIMARY KEY,company_id INTEGER,name TEXT,phone TEXT,address TEXT,latitude REAL,longitude REAL);
    CREATE TABLE driver_field_customer_assignments(company_id INTEGER,driver_id INTEGER,customer_id INTEGER);
    CREATE TABLE orders(id INTEGER PRIMARY KEY,company_id INTEGER,customer_id INTEGER);
    CREATE TABLE deliveries(id INTEGER PRIMARY KEY,company_id INTEGER,order_id INTEGER,driver_id INTEGER);
    CREATE TABLE customer_service_areas(company_id INTEGER,service_area_id INTEGER,customer_id INTEGER);
    CREATE TABLE service_area_drivers(company_id INTEGER,service_area_id INTEGER,driver_id INTEGER);
    CREATE TABLE driver_field_permissions(company_id INTEGER,driver_id INTEGER,permission TEXT,enabled INTEGER);
    CREATE TABLE products(id INTEGER PRIMARY KEY,company_id INTEGER,name TEXT,sale_price REAL,stock INTEGER);
    INSERT INTO companies VALUES(1,1),(2,1);
    INSERT INTO users VALUES(3,1,'driver',1),(4,2,'driver',1);
    INSERT INTO customers VALUES(10,1,'A','1','A street',24,46),(20,2,'B','2','B street',25,47);
    INSERT INTO driver_field_customer_assignments VALUES(1,3,10),(2,4,20);
    INSERT INTO driver_field_permissions VALUES
      (1,3,'create_order',1),(1,3,'change_qty',1),(1,3,'view_customer_ledger',1),
      (2,4,'create_order',1);
    INSERT INTO products VALUES(100,1,'19L',450,20),(200,2,'500ml',50,60);
  `);
  let prepareCount = 0;
  const DB = { prepare(sql) {
    assert.match(sql.trim(),/^SELECT\b/i,'QA adapter cannot write');
    prepareCount++;
    return { bind(...args) {
      return {
        all:async()=>({success:true,results:sqlite.prepare(sql).all(...args)}),
        first:async()=>sqlite.prepare(sql).get(...args)
      };
    }};
  }};
  return { sqlite, DB, count:()=>prepareCount };
}

test('unit: synthetic session verifier is signed, expiring, revocable and not header-spoofable',()=>{
  const live = signSynthetic({id:3,companyId:1,role:'driver',exp:NOW+3600,sid:'current'});
  assert.deepEqual(resolveSyntheticAuthorization('Bearer '+live),
    {id:3,companyId:1,role:'driver',trusted:true});
  assert.equal(resolveSyntheticAuthorization('Bearer '+live+'x'),null);
  assert.equal(resolveSyntheticAuthorization('Bearer '+signSynthetic(
    {id:3,companyId:1,role:'driver',exp:NOW,sid:'expired'})),null);
  assert.equal(resolveSyntheticAuthorization('Bearer '+signSynthetic(
    {id:3,companyId:1,role:'driver',exp:NOW+3600,sid:'revoked-session'})),null);
  assert.equal(resolveSyntheticAuthorization('Bearer '+signSynthetic(
    {id:3,companyId:1,role:'company_admin',exp:NOW+3600,sid:'other-role'})),null);
  assert.equal(resolveSyntheticAuthorization('Bearer fake.signature'),null);
});

test('integration: synthetic HTTP phone-to-native-D1 read gateway fails closed',async t=>{
  const f = fixture(t);
  const { createD1DriverFieldReadQaHandler } = await import('../services/d1-driver-field-read-qa.mjs');
  const handler = createD1DriverFieldReadQaHandler({
    resolveActor: async request => resolveSyntheticAuthorization(request.headers.get('authorization'))
  });
  const env = {TEMO_ERP_D1_FIELD_QA_MODE:'1',DB:f.DB};
  const server = createServer(async (req,res)=>{
    try {
      const buffers = [];
      for await (const chunk of req) buffers.push(chunk);
      const payload = Buffer.concat(buffers);
      const request = new Request('http://127.0.0.1'+req.url,{
        method:req.method,headers:req.headers,
        ...(payload.length ? {body:payload} : {})
      });
      const response = await handler(request,env);
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500,{'content-type':'application/json'});
      res.end('{"error":"test_harness_error"}');
    }
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin = 'http://127.0.0.1:'+server.address().port;
  const signed = (id,companyId,sid='current')=>signSynthetic({
    id,companyId,role:'driver',exp:NOW+3600,sid
  });
  const get = (path,token,options={})=>fetch(origin+path,{
    ...options,
    headers:{...(options.headers||{}),...(token ? {authorization:'Bearer '+token} : {})}
  });
  const before = f.count();
  const anon = await get('/api/driver/permissions',null,{
    headers:{'x-company-id':'1','x-driver-id':'3','x-trusted':'true'}});
  assert.equal(anon.status,401,'caller-controlled headers never authenticate');
  assert.equal(f.count(),before,'no unauthenticated DB access');
  assert.equal((await get('/api/driver/permissions',signed(3,1,'revoked-session'))).status,401);
  assert.equal((await get('/api/driver/permissions',signed(3,2))).status,403);

  const tokenA=signed(3,1), tokenB=signed(4,2);
  const permissions = await get('/api/driver/permissions',tokenA);
  assert.equal(permissions.status,200);
  assert.match(permissions.headers.get('content-type')||'',/application\/json/);
  assert.equal(permissions.headers.get('cache-control'),'no-store');
  const body=await permissions.json();
  assert.equal(body.companyId,1);
  assert.deepEqual(Object.keys(body.permissions).sort(),[...BASE_KEYS].sort(),
    'Android DriverPermissionCatalog and ERP permissions response must agree');
  assert.equal(body.permissions.change_qty,true);
  assert.equal(body.permissions.refund_security_deposit,false);

  for (const [token,customer,product] of [[tokenA,10,100],[tokenB,20,200]]) {
    const customers = await get('/api/driver/field/customers',token);
    assert.equal(customers.status,200);
    assert.deepEqual((await customers.json()).items.map(x=>x.id),[customer]);
    const products = await get('/api/driver/field/products',token);
    assert.equal(products.status,200);
    assert.deepEqual((await products.json()).items.map(x=>x.id),[product]);
  }
  const changes=f.sqlite.prepare('SELECT total_changes() AS c').get().c;
  for(const path of ['/api/driver/field/customers','/api/driver/field/orders',
    '/api/driver/offline-sync','/api/driver/deliveries/701/proof-upload']) {
    const response=await get(path,tokenA,{method:'POST',body:'{}',
      headers:{'content-type':'application/json'}});
    assert.ok([404,405].includes(response.status),path+' must not accept writes in read QA');
  }
  assert.equal(f.sqlite.prepare('SELECT total_changes() AS c').get().c,changes,
    'isolated read gateway must never mutate finance, stock or customer data');
  assert.equal((await get('/api/driver/deliveries?date=2026-11-16',tokenA)).status,404,
    'delivery-list endpoint is not yet wired; no fake success');
});

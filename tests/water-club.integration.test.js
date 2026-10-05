const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const sqlite3 = require('sqlite3');
const net = require('node:net');

test('Water Club API integration with disposable SQLite database', async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), 'temo-integration-'));
  const dbPath = path.join(folder, 'test.db');
  const reserve = net.createServer();
  await new Promise(r => reserve.listen(0, '127.0.0.1', r));
  const port = reserve.address().port;
  await new Promise(r => reserve.close(r));
  let logs = '';
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, NODE_ENV: 'test', SMTP_HOST: '', WHATSAPP_API_URL: '', BOOTSTRAP_ADMIN_PASSWORD: '', BOOTSTRAP_SUPERADMIN_PASSWORD: 'Bootstrap-Test-8372' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', b => { logs += b; });
  server.stderr.on('data', b => { logs += b; });
  let db;
  t.after(async () => {
    if (db) await new Promise(r => db.close(r));
    server.kill();
    if (server.exitCode === null) await new Promise(r => server.once('exit', r));
    rmSync(folder, { recursive: true, force: true });
  });
  const api = async (route, { token, method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { const r = await api('/api/health'); if (r.status === 200 && r.data.ok) { ready = true; break; } } catch {}
    if (server.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready, 'Startup failed: ' + logs);
  db = new sqlite3.Database(dbPath);
  const sql = (statement, params = []) => new Promise((resolve, reject) => db.run(statement, params, function(error) { error ? reject(error) : resolve({ id: this.lastID }); }));
  // Wait for schema initialization without relying on insecure seeded accounts.
  for (let i = 0; i < 100; i++) {
    try { await sql('SELECT must_change_password FROM users LIMIT 1'); break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  const password = 'LocalTest-Only-8372';
  const accounts = [];
  for (const suffix of ['a', 'b']) {
    const r = await api('/api/signup', { method: 'POST', body: { companyName: `Test ${suffix}`, ownerName: `Owner ${suffix}`, email: `${suffix}@example.test`, username: `test_${suffix}`, password, confirmPassword: password } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    accounts.push(r.data);
  }
  const [a, b] = accounts;
  const customers = [];
  for (const [i, account] of accounts.entries()) {
    const r = await api('/api/customers', { method: 'POST', token: account.token, body: { name: `Customer ${i}`, phone: `555000${i}`, address: 'Test address' } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    customers.push(r.data);
  }
  const [ca, cb] = customers;
  await t.test('database health', async () => assert.equal((await api('/api/health')).data.database, 'reachable'));
  await t.test('anonymous requests rejected', async () => assert.equal((await api('/api/customer/dashboard')).status, 401));
  await t.test('invalid admin credentials rejected', async () => assert.equal((await api('/api/login', { method: 'POST', body: { username: 'test_a', password: 'wrong' } })).status, 401));
  await t.test('company isolation ignores spoofed company header', async () => {
    const r = await api('/api/customers', { token: a.token, headers: { 'x-company-id': String(b.user.companyId) } });
    assert.equal(r.status, 200); assert.ok(r.data.some(c => c.id === ca.id)); assert.ok(!r.data.some(c => c.id === cb.id));
  });
  await t.test('portal accepts valid email and password', async () => {
    const r = await api(`/api/customers/${ca.id}/portal-access`, { method: 'POST', token: a.token, body: { email: 'customer-a@example.test', password } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  });
  // Independent login/isolation fixtures keep failures in provisioning from hiding other defects.
  for (const [i, customer] of customers.entries()) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
    await sql("INSERT OR IGNORE INTO users (company_id, customer_id, username, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?, ?, 'customer')", [customer.company_id, customer.id, `portal_fixture_${i}`, `fixture-${i}@example.test`, hash, customer.name]);
  }
  const login = () => api('/api/customer/login', { method: 'POST', body: { email: 'fixture-0@example.test', password } });
  const customerLogin = await login(); assert.equal(customerLogin.status, 200);
  const token = customerLogin.data.token;
  await t.test('customer cannot access admin APIs', async () => assert.equal((await api('/api/customers', { token })).status, 403));
  await t.test('customer identity ignores supplied tenant and customer IDs', async () => {
    const r = await api(`/api/customer/me?companyId=${b.user.companyId}&customerId=${cb.id}`, { token, headers: { 'x-company-id': String(b.user.companyId) } });
    assert.equal(r.status, 200); assert.equal(r.data.customer.id, ca.id);
  });
  await t.test('customer order reaches own ERP with server pricing', async () => {
    const product = await sql('INSERT INTO products (company_id, name, sale_price, purchase_price, stock) VALUES (?, ?, 100, 50, 10)', [a.user.companyId, 'Test water']);
    const r = await api('/api/customer/orders', { method: 'POST', token, body: { customerId: cb.id, companyId: b.user.companyId, items: [{ productId: product.id, quantity: 2, unitPrice: 1 }] } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.customer_id, ca.id); assert.equal(r.data.total_amount, 200);
    const own = await api('/api/customer/orders', { token });
    assert.ok(own.data.some(order => order.id === r.data.id));
    const other = await api('/api/orders', { token: b.token });
    assert.equal(other.status, 200); assert.ok(!other.data.some(order => order.id === r.data.id));
  });
  await t.test('inactive customer cannot log in', async () => {
    await sql("UPDATE users SET status = 'inactive' WHERE username = 'portal_fixture_0'");
    const r = await login();
    await sql("UPDATE users SET status = 'active' WHERE username = 'portal_fixture_0'");
    assert.equal(r.status, 401);
  });
  await t.test('inactive company cannot log in through customer endpoint', async () => {
    await sql("UPDATE companies SET status = 'inactive' WHERE id = ?", [a.user.companyId]);
    const r = await login();
    await sql("UPDATE companies SET status = 'active' WHERE id = ?", [a.user.companyId]);
    assert.equal(r.status, 401);
  });
  await t.test('authenticated company admin can change own password', async () => {
    const r = await api('/api/me/password', { method: 'POST', token: a.token, body: { currentPassword: password, newPassword: 'Changed-Test-Only-8372', confirmPassword: 'Changed-Test-Only-8372' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await api('/api/login', { method: 'POST', body: { username: 'test_a', password: 'Changed-Test-Only-8372' } })).status, 200);
  });
  await t.test('known default bootstrap password cannot log in', async () => {
    for (const username of ['admin', 'superadmin']) assert.equal((await api('/api/login', { method: 'POST', body: { username, password: 'admin123' } })).status, 401);
  });
  await t.test('superadmin with null company can change password', async () => {
    const login = await api('/api/login', { method: 'POST', body: { username: 'superadmin', password: 'Bootstrap-Test-8372' } });
    assert.equal(login.status, 200);
    const change = await api('/api/me/password', { method: 'POST', token: login.data.token, body: { currentPassword: 'Bootstrap-Test-8372', newPassword: 'Changed-Bootstrap-8372', confirmPassword: 'Changed-Bootstrap-8372' } });
    assert.equal(change.status, 200, JSON.stringify(change.data));
    assert.equal((await api('/api/login', { method: 'POST', body: { username: 'superadmin', password: 'Changed-Bootstrap-8372' } })).status, 200);
  });
  await t.test('recovery never leaks tokens or account existence without SMTP', async () => {
    const known = await api('/api/forgot-password', { method: 'POST', body: { identifier: 'test_a' } });
    const unknown = await api('/api/forgot-password', { method: 'POST', body: { identifier: 'missing' } });
    assert.deepEqual(known, unknown); assert.equal(known.data.resetToken, undefined);
  });
  await t.test('reset uses hashed token, revokes sessions and refuses replay', async () => {
    const raw = crypto.randomBytes(32).toString('hex');
    const digest = crypto.createHash('sha256').update(raw).digest('hex');
    await sql("INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 minutes'))", [digest, b.user.id]);
    const body = { token: raw, password: 'Reset-Test-8372', confirmPassword: 'Reset-Test-8372' };
    const attempts = await Promise.all([api('/api/reset-password', { method: 'POST', body }), api('/api/reset-password', { method: 'POST', body })]);
    assert.deepEqual(attempts.map(r => r.status).sort(), [200, 400]);
    assert.equal((await api('/api/me', { token: b.token })).status, 401);
    assert.equal((await api('/api/reset-password', { method: 'POST', body })).status, 400);
    assert.equal((await api('/api/login', { method: 'POST', body: { username: 'test_b', password: body.password } })).status, 200);
  });
  await t.test('tenant backup is stored beside database and validates checksum', async () => {
    await sql("UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE slug = 'enterprise' LIMIT 1) WHERE company_id = ?", [a.user.companyId]);
    const r = await api('/api/backups', { method: 'POST', token: a.token, body: { scope: 'tenant' } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const payload = require('node:fs').readFileSync(path.join(folder, 'storage', 'backups', r.data.storageKey), 'utf8');
    const snapshot = JSON.parse(payload);
    assert.ok(snapshot.tables.customers.rows.some(row => row.id === ca.id));
    assert.ok(!snapshot.tables.customers.rows.some(row => row.id === cb.id));
    assert.equal(snapshot.tables.sessions, undefined);
    const valid = await api(`/api/backups/${r.data.id}/validate`, { method: 'POST', token: a.token, body: {} });
    assert.equal(valid.status, 200); assert.equal(valid.data.valid, true);
  });
  await t.test('Water Club paid delivery, referral, redemption and subscription engine', async t => {
    const worker = process.env.WC_WORKER_PATH ? (await import(process.env.WC_WORKER_PATH)).default : null;
    const env = { APP_ENV: 'local', ERP_API_BASE_URL: `http://127.0.0.1:${port}`, ALLOWED_ORIGIN: 'http://club.test' };
    let cookie;
    if (worker) {
      const loginProxy = await worker.fetch(new Request('http://club.test/api/water-club/auth/login', { method:'POST',headers:{ 'Content-Type':'application/json',Origin:'http://club.test' },body:JSON.stringify({ identifier:'fixture-0@example.test',password }) }),env);
      assert.equal(loginProxy.status,200);cookie=loginProxy.headers.get('set-cookie').split(';')[0];
    }
    const proxy = async (route,method='GET',body) => {
      if (!worker) {
        const result=await api('/api/customer/water-club/'+route,{ token,method,body });
        return { status:result.status,data:{ ok:result.status===200,data:result.data,message:result.data.message } };
      }
      const r=await worker.fetch(new Request('http://club.test/api/water-club/'+route,{ method,headers:{ Cookie:cookie,Origin:'http://club.test','Content-Type':'application/json' },...(body?{ body:JSON.stringify(body) }:{}) }),env);
      return { status:r.status,data:await r.json() };
    };
    const p = await sql('INSERT INTO products(company_id,name,sale_price,purchase_price,stock) VALUES(?,?,?,?,?)',[a.user.companyId,'19L refill',300,200,500]);
    assert.equal((await api('/api/water-club/admin/products',{ method:'POST',token:a.token,body:{ productId:p.id,kind:'refill_19l' } })).status,200);
    assert.equal((await proxy('membership','POST',{ plan:'home' })).status,200);
    const c = await api('/api/customers',{ method:'POST',token:a.token,body:{ name:'Referred club member',phone:'555012345',address:'Test address' } }); assert.equal(c.status,201);
    const provision = await api(`/api/customers/${c.data.id}/portal-access`,{ method:'POST',token:a.token,body:{ email:'referred@example.test',password } }); assert.equal(provision.status,201);
    const cLogin = await api('/api/customer/login',{ method:'POST',body:{ email:'referred@example.test',password } });assert.equal(cLogin.status,200);const ct=cLogin.data.token;
    const club = (route,body,token=ct) => api('/api/customer/water-club/'+route,{ method:'POST',token,body });
    const earn = async (token,quantity,key) => { const r = await club('orders',{ items:[{ productId:p.id,quantity }],requestKey:key },token);assert.equal(r.status,200,JSON.stringify(r.data));return r.data; };
    const status = (id,status='delivered') => api(`/api/orders/${id}/status`,{ method:'PATCH',token:a.token,body:{ status } });
    const pay = (id,amount,key,direction='receipt') => api(`/api/water-club/admin/orders/${id}/payment`,{ method:'POST',token:a.token,body:{ amount,method:'Cash',reference:key,requestKey:key,direction } });
    const rewards = (session) => api('/api/customer/water-club/rewards',{ token:session });
    await t.test('Catalog, membership and role boundaries',async()=>{
      assert.equal((await proxy('catalog')).status,200);
      const profileUpdate=await api('/api/customer/profile',{method:'PATCH',token,body:{name:'Updated customer',phone:'5550000',address:'Updated address'}});assert.equal(profileUpdate.status,200);assert.equal((await api('/api/customer/login',{method:'POST',body:{email:'fixture-0@example.test',password}})).status,200);
      assert.equal((await api('/api/water-club/admin/products',{ method:'POST',token,body:{ productId:p.id,kind:'refill_19l' } })).status,403);
      assert.equal((await club('membership',{ plan:'home' })).status,200);
      const ref = await proxy('referrals');assert.equal(ref.status,200);const code=ref.data.data.code;
      assert.equal((await club('referrals',{ code },token)).status,400);
      assert.equal((await club('referrals',{ code })).status,200);
      assert.equal((await club('referrals',{ code })).status,409);
      const other = await api('/api/customer/login',{ method:'POST',body:{ email:'fixture-1@example.test',password } });assert.equal(other.status,200);
      assert.equal((await club('membership',{ plan:'home' },other.data.token)).status,200);
      assert.equal((await club('referrals',{ code },other.data.token)).status,400);
    });
    await t.test('Company prices and security terms stay isolated and preserve placed orders',async()=>{
      const otherAdmin=(await api('/api/login',{method:'POST',body:{username:'test_b',password:'Reset-Test-8372'}})).data.token;
      const original=await club('orders',{items:[{productId:p.id,quantity:1}],requestKey:'price-snapshot-001'},token);
      assert.equal(original.status,200);assert.equal(original.data.total_amount,300);
      const save=(session,body)=>api('/api/water-club/admin/prices',{method:'POST',token:session,body});
      assert.equal((await save(token,{productId:p.id,salePrice:310})).status,403);
      assert.equal((await save(otherAdmin,{productId:p.id,salePrice:310})).status,404);
      for(const salePrice of [-1,0,1.001,'310',null])assert.equal((await save(a.token,{productId:p.id,salePrice})).status,400);
      assert.equal((await save(a.token,{productId:p.id,salePrice:310})).status,200);
      const catalog=await api('/api/customer/water-club/catalog',{token});assert.equal(catalog.data.find(x=>x.id===p.id).sale_price,310);
      const order=await club('orders',{items:[{productId:p.id,quantity:1}],requestKey:'price-snapshot-002'},token);assert.equal(order.data.total_amount,310);
      const orders=await api('/api/water-club/admin/orders',{token:a.token});assert.equal(orders.data.find(x=>x.order_id===original.data.id).total_amount,300);
      const commercial={securityAmount:900,securityTerms:'Refund after verified bottle return.',deliveryTerms:'Pilot area delivery 50; outside area quote required.'};
      assert.equal((await api('/api/water-club/admin/commercial',{method:'POST',token:a.token,body:commercial})).status,200);
      assert.equal((await api('/api/water-club/admin/commercial',{token:a.token})).data.security_amount,900);
      assert.equal((await api('/api/water-club/admin/commercial',{token:otherAdmin})).data.security_amount,null);
      assert.equal((await api('/api/water-club/admin/commercial',{method:'POST',token,body:commercial})).status,403);
      assert.equal((await api('/api/water-club/admin/commercial',{method:'POST',token:a.token,body:{...commercial,securityAmount:-1}})).status,400);
      await save(a.token,{productId:p.id,salePrice:300});
    });
    let first,second,large,reward;
    await t.test('No points until full payment AND delivery; repeated events are safe',async()=>{
      const r = await proxy('orders','POST',{ items:[{ productId:p.id,quantity:1,unitPrice:1 }],requestKey:'first-order-0001' });assert.equal(r.status,200,JSON.stringify(r.data));first=r.data.data;assert.equal(first.total_amount,300);
      assert.equal((await pay(first.id,300,'first-pay-0001')).status,200);
      assert.equal((await rewards(token)).data.points,0);
      assert.equal((await status(first.id)).status,200);
      assert.equal((await rewards(token)).data.points,10);
      assert.equal((await status(first.id)).status,200);
      assert.equal((await pay(first.id,300,'first-pay-0001')).status,200);
      assert.equal((await rewards(token)).data.points,10);
    });
    await t.test('Referral waits for first paid delivery then awards 20 once',async()=>{
      second=await earn(ct,1,'referred-order-0001');assert.equal((await status(second.id)).status,200);
      assert.equal((await rewards(token)).data.points,10);
      assert.equal((await pay(second.id,300,'referred-pay-0001')).status,200);
      assert.equal((await rewards(ct)).data.points,10);assert.equal((await rewards(token)).data.points,30);
      assert.equal((await status(second.id)).status,200);assert.equal((await rewards(token)).data.points,30);
    });
    await t.test('Concurrent redemption creates one zero-price refill order',async()=>{
      large=await earn(token,14,'large-order-0001');assert.equal((await status(large.id)).status,200);assert.equal((await pay(large.id,4200,'large-pay-0001')).status,200);
      assert.equal((await rewards(token)).data.points,100);
      const stock=(await api('/api/products',{token:a.token})).data.find(row=>row.id===p.id).stock;assert.equal(stock,484);
      const rs=await Promise.all([club('rewards/redeem',{ requestKey:'redeem-request-0001' },token),club('rewards/redeem',{ requestKey:'redeem-request-0002' },token)]);
      assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);reward=rs.find(r=>r.status===200).data;assert.equal(reward.total_amount,0);
      const again=await club('rewards/redeem',{ requestKey:rs[0].status===200?'redeem-request-0001':'redeem-request-0002' },token);assert.equal(again.data.id,reward.id);
      assert.equal((await rewards(token)).data.points,0);
    });
    await t.test('Refund reverses spent points and referral without hiding debt',async()=>{
      assert.equal((await pay(first.id,300,'refund-first-0001','payment')).status,200);assert.equal((await rewards(token)).data.pointsDebt,10);
      assert.equal((await pay(second.id,300,'refund-ref-0001','payment')).status,200);assert.equal((await rewards(token)).data.pointsDebt,30);
      assert.equal((await status(reward.id,'cancelled')).status,200);assert.equal((await rewards(token)).data.points,70);
      await sql("UPDATE water_club_lots SET expires_at = datetime('now','-1 day') WHERE company_id = ? AND customer_id = ?",[a.user.companyId,ca.id]);
      assert.equal((await rewards(token)).data.points,0);
    });
    await t.test('Cartons, first bonus, B2B opt-in and invalid request isolation',async()=>{
      const carton=await sql('INSERT INTO products(company_id,name,sale_price,purchase_price,stock) VALUES(?,?,?,?,?)',[a.user.companyId,'1.5L bottle',100,50,100]);
      assert.equal((await api('/api/water-club/admin/products',{ method:'POST',token:a.token,body:{ productId:carton.id,kind:'carton_15l',unitsPerReward:6 } })).status,200);
      const order=await club('orders',{ requestKey:'carton-order-0001',items:[{ productId:carton.id,quantity:6 }] },token);assert.equal(order.status,200);
      assert.equal((await status(order.data.id)).status,200);assert.equal((await pay(order.data.id,600,'carton-pay-0001')).status,200);assert.equal((await rewards(token)).data.points,5);
      const conflict=await club('orders',{ requestKey:'carton-order-0001',items:[{ productId:carton.id,quantity:12 }] },token);assert.equal(conflict.status,409);
      assert.equal((await club('orders',{ requestKey:'duplicate-order-001',items:[{ productId:carton.id,quantity:6 },{ productId:carton.id,quantity:6 }] },token)).status,400);
      assert.equal((await api('/api/water-club/admin/members/'+ca.id,{ method:'POST',token:a.token,body:{ rewardsEnabled:false } })).status,200);
      assert.equal((await rewards(token)).data.member.rewards_enabled,0);
      assert.equal((await pay(order.data.id,600,'carton-refund-001','payment')).status,200);assert.equal((await rewards(token)).data.points,0);
      assert.equal((await api('/api/water-club/admin/members/'+ca.id,{ method:'POST',token:a.token,body:{ rewardsEnabled:true } })).status,200);
      const adjust={ points:10,reason:'Local QA correction',requestKey:'manual-adjust-0001' };
      for(let i=0;i<2;i++)assert.equal((await api('/api/water-club/admin/members/'+ca.id+'/points',{ method:'POST',token:a.token,body:adjust })).status,200);
      assert.equal((await rewards(token)).data.points,10);
    });
    await t.test('Recurring schedules use ERP prices; concurrent generation has no duplicates',async()=>{
      const r=await proxy('subscriptions','POST',{ productId:p.id,quantity:2,unitPrice:1,frequency:'monthly',startDate:'2027-01-31',requestKey:'schedule-request-0001' });assert.equal(r.status,200,JSON.stringify(r.data));const schedule=r.data.data;assert.equal(schedule.unit_price,300);
      const calls=await Promise.all([api('/api/delivery-subscriptions/generate-due',{ method:'POST',token:a.token,body:{ upToDate:'2027-02-28' } }),api('/api/delivery-subscriptions/generate-due',{ method:'POST',token:a.token,body:{ upToDate:'2027-02-28' } })]);assert.ok(calls.every(r=>r.status===200));assert.equal(calls.reduce((n,r)=>n+r.data.count,0),2);
      const schedules=await api('/api/customer/subscriptions',{ token });assert.equal(schedules.data.find(s=>s.id===schedule.id).next_due_date,'2027-03-31');
      assert.equal((await club(`subscriptions/${schedule.id}/pause`,{ requestKey:'other-pause-0001' },ct)).status,404);
      assert.equal((await proxy(`subscriptions/${schedule.id}/pause`,'POST',{ requestKey:'pause-schedule-0001' })).status,200);
      assert.equal((await proxy(`subscriptions/${schedule.id}/resume`,'POST',{ requestKey:'resume-schedule-0001' })).status,200);
      const skipped=await proxy(`subscriptions/${schedule.id}/skip`,'POST',{ requestKey:'skip-schedule-0001' });assert.equal(skipped.status,200);
      const skippedAgain=await proxy(`subscriptions/${schedule.id}/skip`,'POST',{ requestKey:'skip-schedule-0001' });assert.equal(skippedAgain.status,200);assert.equal(skippedAgain.data.data.next_due_date,skipped.data.data.next_due_date);
      assert.equal((await proxy(`subscriptions/${schedule.id}/cancel`,'POST',{ requestKey:'cancel-schedule-0001' })).status,200);
      assert.equal((await proxy(`subscriptions/${schedule.id}/resume`,'POST',{ requestKey:'resume-schedule-0002' })).status,400);
    });
  });
  await t.test('expired customer session rejected', async () => {
    await sql("UPDATE sessions SET expires_at = datetime('now', '-1 day') WHERE token = ?", [token]);
    assert.equal((await api('/api/customer/me', { token })).status, 401);
  });
  await t.test('logout revokes session', async () => {
    const fresh = await login(); assert.equal(fresh.status, 200);
    assert.equal((await api('/api/logout', { method: 'POST', token: fresh.data.token, body: {} })).status, 200);
    assert.equal((await api('/api/customer/me', { token: fresh.data.token })).status, 401);
  });
});


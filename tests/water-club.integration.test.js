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

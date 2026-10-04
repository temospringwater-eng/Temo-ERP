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
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, NODE_ENV: 'test', SMTP_HOST: '', WHATSAPP_API_URL: '' },
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
  // Schema/seeds finish after the early health route is registered.
  for (let i = 0; i < 100; i++) {
    const r = await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
    if (r.status === 200) break;
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

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const port = 34600 + (process.pid % 100);
const databasePath = path.join(os.tmpdir(), `temo-billing-${process.pid}.db`);
let serverProcess;

async function request(route, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: options.method || 'GET', headers: options.headers || {}, body: options.body });
  const body = await response.text();
  let json = null;
  try { json = body ? JSON.parse(body) : null; } catch (_) {}
  return { status: response.status, body, json };
}

async function login(username, password) {
  const response = await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(response.status, 200, response.body);
  return { Authorization: `Bearer ${response.json.token}` };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { const response = await request('/readiness'); if (response.status === 200 && response.json.ready) return; } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Billing server did not become ready.');
}

test.before(async () => {
  serverProcess = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), DB_PATH: databasePath }, stdio: 'ignore' });
  await waitForServer();
});
test.after(() => {
  if (serverProcess) serverProcess.kill();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(databasePath + suffix); } catch (_) {} }
});

test('Super Admin records payment and renews a tenant; company admin is read-only', async () => {
  const superAdmin = await login('superadmin', 'admin123');
  const admin = await login('admin', 'admin123');
  const companies = await request('/api/companies', { headers: superAdmin });
  assert.equal(companies.status, 200, companies.body);
  const companyId = companies.json.find((company) => company.name === 'TEMO Spring Water')?.id || companies.json[0].id;

  const payment = await request(`/api/companies/${companyId}/subscription/payments`, {
    method: 'POST',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 1250, paymentMethod: 'Bank Transfer', paymentReference: 'BANK-STEP6', paymentStatus: 'paid' })
  });
  assert.equal(payment.status, 201, payment.body);
  assert.match(payment.json.invoice_number, /^SUB-/);

  const billing = await request('/api/subscription/billing', { headers: admin });
  assert.equal(billing.status, 200, billing.body);
  assert.ok(billing.json, billing.body);
  assert.equal(billing.json.payments.some((row) => row.payment_reference === 'BANK-STEP6'), true);

  const denied = await request(`/api/companies/${companyId}/subscription/renew`, {
    method: 'POST',
    headers: { ...admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ billingCycle: 'monthly' })
  });
  assert.equal(denied.status, 403);

  const before = billing.json.subscription.end_date;
  const renewed = await request(`/api/companies/${companyId}/subscription/renew`, {
    method: 'POST',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ billingCycle: 'monthly', recordPayment: true, paymentStatus: 'paid' })
  });
  assert.equal(renewed.status, 200, renewed.body);
  assert.ok(renewed.json.subscription.end_date > before);
  const dashboard = await request('/api/saas/dashboard', { headers: superAdmin });
  assert.equal(dashboard.status, 200, dashboard.body);
  assert.ok('billing' in dashboard.json);
});

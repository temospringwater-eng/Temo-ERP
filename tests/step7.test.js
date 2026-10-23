const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotificationDeliveryService } = require('../services/notification-delivery-service');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const port = 34700 + (process.pid % 100);
const databasePath = path.join(os.tmpdir(), `temo-step7-${process.pid}.db`);
let serverProcess;

async function request(route, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: options.method || 'GET', headers: options.headers || {}, body: options.body });
  const body = await response.text();
  let json = null;
  try { json = body ? JSON.parse(body) : null; } catch (_) {}
  return { status: response.status, body, json };
}

async function login(username) {
  const response = await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'admin123' }) });
  assert.equal(response.status, 200, response.body);
  return { Authorization: `Bearer ${response.json.token}` };
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try { const response = await request('/readiness'); if (response.status === 200 && response.json.ready) return; } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Step 7 server did not become ready.');
}

test.before(async () => {
  serverProcess = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), DB_PATH: databasePath }, stdio: 'ignore' });
  await waitForServer();
});
test.after(() => {
  if (serverProcess) serverProcess.kill();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(databasePath + suffix); } catch (_) {} }
});

test('notification delivery skips unconfigured providers without throwing', async () => {
  const previous = { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, from: process.env.SMTP_FROM, whatsapp: process.env.WHATSAPP_API_URL };
  delete process.env.SMTP_HOST; delete process.env.SMTP_PORT; delete process.env.SMTP_FROM; delete process.env.WHATSAPP_API_URL;
  const service = createNotificationDeliveryService({ query: async () => [], insert: async () => ({ id: 1 }), update: async () => ({ changes: 1 }) });
  assert.equal((await service.sendEmail({ recipient: 'admin@example.test', type: 'payment_due', variables: {} })).status, 'skipped');
  assert.equal((await service.sendWhatsAppNotification({ phone: '+15550000000', type: 'payment_due', variables: {} })).status, 'skipped');
  if (previous.host === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = previous.host;
  if (previous.port === undefined) delete process.env.SMTP_PORT; else process.env.SMTP_PORT = previous.port;
  if (previous.from === undefined) delete process.env.SMTP_FROM; else process.env.SMTP_FROM = previous.from;
  if (previous.whatsapp === undefined) delete process.env.WHATSAPP_API_URL; else process.env.WHATSAPP_API_URL = previous.whatsapp;
});

test('notification delivery retry stops after successful or maximum attempts', async () => {
  let updates = 0;
  const service = createNotificationDeliveryService({
    query: async () => [{ id: 7, channel: 'email', recipient: 'x@example.test', status: 'failed', attempts: 3, type: 'payment_due', message: 'Due' }],
    insert: async () => ({ id: 1 }),
    update: async () => { updates += 1; return { changes: 1 }; }
  });

  test('payment proofs validate types and remain tenant-scoped', async () => {
    const admin = await login('admin');
    const invalid = await request('/api/subscription/payment-proofs', { method: 'POST', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'proof.exe', contentType: 'application/x-msdownload', dataBase64: Buffer.from('bad').toString('base64') }) });
    assert.equal(invalid.status, 400);
    const uploaded = await request('/api/subscription/payment-proofs', { method: 'POST', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'proof.png', contentType: 'image/png', dataBase64: Buffer.from('png-bytes').toString('base64') }) });
    assert.equal(uploaded.status, 201, uploaded.body);
    assert.equal(uploaded.json.status, 'submitted');
    const listed = await request('/api/subscription/payment-proofs', { headers: admin });
    assert.equal(listed.status, 200);
    assert.equal(listed.json.some((row) => row.id === uploaded.json.id), true);
    const downloaded = await request(`/api/subscription/payment-proofs/${uploaded.json.id}/download`, { headers: admin });
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.body, /png-bytes/);
    const forbidden = await request('/api/admin/subscription/payment-proofs', { headers: admin });
    assert.equal(forbidden.status, 403);
  });

  test('custom renewal requests retain duration and can be processed by Super Admin', async () => {
    const admin = await login('admin');
    const superAdmin = await login('superadmin');
    const submitted = await request('/api/subscription/renewal-request', { method: 'POST', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestedPeriod: 'custom', requestedDays: 45, notes: 'Quarterly planning adjustment' }) });
    assert.equal(submitted.status, 201, submitted.body);
    assert.equal(submitted.json.requested_days, 45);
    const invalid = await request('/api/subscription/renewal-request', { method: 'POST', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestedPeriod: 'custom', requestedDays: 0 }) });
    assert.equal(invalid.status, 400);
    const approved = await request(`/api/admin/subscription/renewal-requests/${submitted.json.id}`, { method: 'PATCH', headers: { ...superAdmin, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) });
    assert.equal(approved.status, 200, approved.body);
    const processed = await request(`/api/admin/subscription/renewal-requests/${submitted.json.id}/process`, { method: 'POST', headers: { ...superAdmin, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(processed.status, 200, processed.body);
    assert.equal(processed.json.request.status, 'completed');
  });

  test('fresh signup receives company admin Normal trial access only', async () => {
    const username = `fresh_${process.pid}`;
    const signup = await request('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'Fresh Normal Tenant',
        ownerName: 'Fresh Owner',
        email: `${username}@example.test`,
        username,
        password: 'FreshPass123!',
        confirmPassword: 'FreshPass123!',
        language: 'en'
      })
    });
    assert.equal(signup.status, 201, signup.body);
    assert.equal(signup.json.user.role, 'company_admin');
    assert.ok(signup.json.user.companyId);
    const superAdmin = await login('superadmin');
    const companies = await request('/api/admin/companies', { headers: superAdmin });
    assert.equal(companies.status, 200, companies.body);
    const signupCompany = companies.json.find((company) => company.id === signup.json.user.companyId);
    assert.ok(signupCompany);
    assert.equal(signupCompany.plan_slug, 'normal');
    const companyUsers = await request(`/api/companies/${signup.json.user.companyId}/users`, { headers: superAdmin });
    assert.equal(companyUsers.status, 200, companyUsers.body);
    assert.equal(companyUsers.json.some((user) => user.id === signup.json.user.id && user.company_id === signup.json.user.companyId && user.role === 'company_admin'), true);
    const auth = { Authorization: `Bearer ${signup.json.token}` };
    const features = await request('/api/subscription/features', { headers: auth });
    assert.equal(features.status, 200, features.body);
    assert.equal(features.json.plan, 'normal');
    assert.equal(features.json.features.sales, true);
    assert.equal(features.json.features.inventory, true);
    assert.equal(features.json.features.payroll, false);
    assert.equal(features.json.features.multi_branch, false);
    const payroll = await request('/api/payroll/runs', { headers: auth });
    assert.equal(payroll.status, 403);
    const franchise = await request('/api/franchises', { headers: auth });
    assert.equal(franchise.status, 403);
  });
  const result = await service.retryFailedDelivery(7);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'retry_limit_reached');
  assert.equal(updates, 0);
});

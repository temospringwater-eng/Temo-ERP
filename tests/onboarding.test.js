const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const port = 34800 + (process.pid % 100);
const databasePath = path.join(os.tmpdir(), `temo-onboarding-${process.pid}.db`);
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
    try {
      const response = await request('/readiness');
      if (response.status === 200 && response.json.ready) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Onboarding server did not become ready.');
}

test.before(async () => {
  serverProcess = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), DB_PATH: databasePath }, stdio: 'ignore' });
  await waitForServer();
});

test.after(() => {
  if (serverProcess) serverProcess.kill();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(databasePath + suffix); } catch (_) {}
  }
});

test('onboarding creates a tenant admin with forced password change', async () => {
  const superAdmin = await login('superadmin', 'admin123');
  const username = `onboard${process.pid}`;
  const created = await request('/api/admin/companies', {
    method: 'POST',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyName: 'Onboard Normal Ltd',
      companyCode: `ON${process.pid}`,
      plan: 'normal',
      status: 'active',
      startDate: '2026-09-01',
      expiryDate: '2027-09-01',
      adminName: 'Onboard Admin',
      adminUsername: username,
      adminEmail: `${username}@example.test`,
      adminPassword: 'Temporary123!'
    })
  });
  assert.equal(created.status, 201, created.body);
  const admin = await login(username, 'Temporary123!');
  const blocked = await request('/api/dashboard', { headers: admin });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'PASSWORD_CHANGE_REQUIRED');

  const changed = await request('/api/me/password', {
    method: 'POST',
    headers: { ...admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'Temporary123!', newPassword: 'Permanent123!', confirmPassword: 'Permanent123!' })
  });
  assert.equal(changed.status, 200, changed.body);
  const dashboard = await request('/api/dashboard', { headers: admin });
  assert.equal(dashboard.status, 200, dashboard.body);
  const oldLogin = await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'Temporary123!' }) });
  assert.equal(oldLogin.status, 401);
  const newLogin = await login(username, 'Permanent123!');
  assert.equal((await request('/api/subscription/status', { headers: newLogin })).json.plan, 'normal');
});

test('custom onboarding persists selected feature overrides and rolls back duplicate admin creation', async () => {
  const superAdmin = await login('superadmin', 'admin123');
  const username = `custom${process.pid}`;
  const created = await request('/api/admin/companies', {
    method: 'POST',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyName: 'Onboard Custom Ltd',
      companyCode: `CU${process.pid}`,
      plan: 'custom',
      status: 'trial',
      startDate: '2026-09-23',
      expiryDate: '2026-09-30',
      adminName: 'Custom Admin',
      adminUsername: username,
      adminPassword: 'Temporary123!',
      features: { sales: true, inventory: true, payroll: false }
    })
  });


  assert.equal(created.status, 201, created.body);
  const featureResponse = await request(`/api/admin/companies/${created.json.company.id}/features`, { headers: superAdmin });
  assert.equal(featureResponse.status, 200, featureResponse.body);
  assert.equal(featureResponse.json.features.sales, true);
  assert.equal(featureResponse.json.features.payroll, false);

  const duplicate = await request('/api/admin/companies', {
    method: 'POST',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'Should Roll Back', companyCode: `RB${process.pid}`, plan: 'normal', adminName: 'Duplicate', adminUsername: username, adminPassword: 'Temporary123!' })
  });
  assert.equal(duplicate.status, 409);
  const companies = await request('/api/admin/companies?search=RB', { headers: superAdmin });
  assert.equal(companies.status, 200);
  assert.equal(companies.json.length, 0);
});

test('enterprise onboarding assigns Enterprise subscription', async () => {
  const superAdmin = await login('superadmin', 'admin123');
  const created = await request('/api/admin/companies', {
    method: 'POST',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyName: 'Onboard Enterprise Ltd',
      companyCode: `EN${process.pid}`,
      plan: 'enterprise',
      status: 'active',
      startDate: '2026-09-23',
      expiryDate: '2027-09-23',
      adminName: 'Enterprise Admin',
      adminUsername: `enterprise${process.pid}`,
      adminPassword: 'Temporary123!'
    })
  });
  assert.equal(created.status, 201, created.body);
  assert.equal(created.json.subscription.plan_slug, 'enterprise');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sqlite3 = require('sqlite3').verbose();

const port = 34200 + (process.pid % 500);
const databasePath = path.join(os.tmpdir(), `temo-subscription-${process.pid}.db`);
let serverProcess;

async function request(route, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body
  });
  const text = await response.text();
  return { status: response.status, body: text, json: text ? JSON.parse(text) : null };
}

async function login(username, password) {
  const response = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(response.status, 200, response.body);
  return { Authorization: `Bearer ${response.json.token}`, 'Content-Type': 'application/json' };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await request('/readiness');
      if (response.status === 200 && response.json.ready) return;
    } catch (_) {
      // Retry while the database is initializing.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Subscription test server did not become ready.');
}

function deleteCompanySubscription(companyId) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(databasePath);
    db.run('DELETE FROM subscriptions WHERE company_id = ?', [companyId], (error) => {
      db.close();
      if (error) reject(error);
      else resolve();
    });
  });
}

test.before(async () => {
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DB_PATH: databasePath },
    stdio: 'ignore'
  });
  await waitForServer();
});

test.after(() => {
  if (serverProcess) serverProcess.kill();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(databasePath + suffix); } catch (_) {}
  }
});

test('plans, status visibility, expiry, and suspension are enforced server-side', async () => {
  const superAdmin = await login('superadmin', 'admin123');
  const plansResponse = await request('/api/plans', { headers: superAdmin });
  assert.equal(plansResponse.status, 200, plansResponse.body);
  const planIds = Object.fromEntries(plansResponse.json.filter((plan) => ['normal', 'enterprise', 'custom'].includes(plan.slug)).map((plan) => [plan.slug, plan.id]));
  assert.deepEqual(Object.keys(planIds).sort(), ['custom', 'enterprise', 'normal']);

  const newUsername = `newadmin${process.pid}`;
  const newCompanyResponse = await request('/api/companies', {
    method: 'POST',
    headers: superAdmin,
    body: JSON.stringify({
      name: `New Subscription Company ${process.pid}`,
      adminName: 'New Company Admin',
      adminUsername: newUsername,
      adminEmail: `${newUsername}@example.com`,
      adminPassword: 'admin123'
    })
  });
  assert.equal(newCompanyResponse.status, 201, newCompanyResponse.body);
  const newCompanyAdmin = await login(newUsername, 'admin123');
  const newCompanyStatus = await request('/api/subscription/status', { headers: newCompanyAdmin });
  assert.equal(newCompanyStatus.status, 200, newCompanyStatus.body);
  assert.equal(newCompanyStatus.json.plan, 'normal');
  assert.equal(newCompanyStatus.json.status, 'trial');

  const companiesResponse = await request('/api/companies', { headers: superAdmin });
  assert.equal(companiesResponse.status, 200, companiesResponse.body);
  const seededCompany = companiesResponse.json.find((company) => company.name === 'TEMO Spring Water') || companiesResponse.json[companiesResponse.json.length - 1];
  const companyId = seededCompany.id;

  const setSubscription = async (plan, status, endDate) => {
    const response = await request(`/api/companies/${companyId}/subscription`, {
      method: 'PUT',
      headers: superAdmin,
      body: JSON.stringify({ planId: planIds[plan], status, startDate: '2026-09-01', endDate, price: 0, paymentStatus: 'paid' })
    });
    assert.equal(response.status, 200, response.body);
  };

  const admin = await login('admin', 'admin123');
  await setSubscription('normal', 'active', '2026-12-31');
  let status = await request('/api/subscription/status', { headers: admin });
  assert.equal(status.status, 200, status.body);
  assert.equal(status.json.plan, 'normal');
  assert.equal(status.json.status, 'active');
  const protectedRoute = await request('/api/customers', { headers: admin });
  assert.notEqual(protectedRoute.status, 403);

  await setSubscription('enterprise', 'active', '2026-12-31');
  status = await request('/api/subscription/status', { headers: admin });
  assert.equal(status.json.plan, 'enterprise');

  await setSubscription('normal', 'active', '2026-12-31');
  status = await request('/api/subscription/status', { headers: admin });
  assert.equal(status.json.plan, 'normal');

  const normalFeatures = await request('/api/subscription/features', { headers: admin });
  assert.equal(normalFeatures.status, 200, normalFeatures.body);
  assert.equal(normalFeatures.json.features.sales, true);
  assert.equal(normalFeatures.json.features.payroll, false);
  assert.equal(normalFeatures.json.features.crm, false);
  assert.equal(normalFeatures.json.features.audit_logs, false);

  const normalPayroll = await request('/api/payroll/runs', { headers: admin });
  assert.equal(normalPayroll.status, 403);
  assert.equal(normalPayroll.json.code, 'FEATURE_NOT_AVAILABLE');
  const normalReports = await request('/api/reports', { headers: admin });
  assert.notEqual(normalReports.status, 403);

  await setSubscription('enterprise', 'active', '2026-12-31');
  const enterprisePayroll = await request('/api/payroll/runs', { headers: admin });
  assert.notEqual(enterprisePayroll.status, 403);
  const enterpriseCrm = await request('/api/loyalty', { headers: admin });
  assert.notEqual(enterpriseCrm.status, 403);
  const enterpriseAudit = await request('/api/audit-logs', { headers: admin });
  assert.notEqual(enterpriseAudit.status, 403);
  const enterpriseAdvancedReports = await request('/api/report-definitions', { headers: admin });
  assert.notEqual(enterpriseAdvancedReports.status, 403);

  await setSubscription('custom', 'active', '2026-12-31');
  const customAdminFeatures = await request(`/api/admin/companies/${companyId}/features`, { headers: superAdmin });
  assert.equal(customAdminFeatures.status, 200, customAdminFeatures.body);
  const customUpdate = await request(`/api/admin/companies/${companyId}/features`, {
    method: 'PUT',
    headers: superAdmin,
    body: JSON.stringify({ features: { sales: true, inventory: true, crm: true, payroll: false, audit_logs: true } })
  });
  assert.equal(customUpdate.status, 200, customUpdate.body);
  const customFeatures = await request('/api/subscription/features', { headers: admin });
  assert.equal(customFeatures.json.features.sales, true);
  assert.equal(customFeatures.json.features.inventory, true);
  assert.equal(customFeatures.json.features.crm, true);
  assert.equal(customFeatures.json.features.payroll, false);
  assert.equal(customFeatures.json.features.audit_logs, true);
  const customPayroll = await request('/api/payroll/runs', { headers: admin });
  assert.equal(customPayroll.status, 403);
  const customCrm = await request('/api/salesmen', { headers: admin });
  assert.notEqual(customCrm.status, 403);

  await setSubscription('custom', 'active', '2020-01-01');
  const expiredLogin = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  assert.equal(expiredLogin.status, 200, expiredLogin.body);
  const expiredAdmin = { Authorization: `Bearer ${expiredLogin.json.token}` };
  status = await request('/api/subscription/status', { headers: expiredAdmin });
  assert.equal(status.json.status, 'expired');
  const expiredProtected = await request('/api/customers', { headers: expiredAdmin });
  assert.equal(expiredProtected.status, 403);
  assert.equal(expiredProtected.json.code, 'SUBSCRIPTION_EXPIRED');

  await setSubscription('custom', 'suspended', '2026-12-31');
  status = await request('/api/subscription/status', { headers: admin });
  assert.equal(status.json.status, 'suspended');
  const suspendedProtected = await request('/api/customers', { headers: admin });
  assert.equal(suspendedProtected.status, 403);
  assert.equal(suspendedProtected.json.code, 'SUBSCRIPTION_SUSPENDED');

  await deleteCompanySubscription(companyId);
  status = await request('/api/subscription/status', { headers: admin });
  assert.equal(status.json.status, 'missing');
  const missingProtected = await request('/api/customers', { headers: admin });
  assert.equal(missingProtected.status, 403);
  assert.equal(missingProtected.json.code, 'SUBSCRIPTION_MISSING');
});

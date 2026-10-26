const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const port = 34700 + (process.pid % 200);
const databasePath = path.join(os.tmpdir(), `temo-admin-${process.pid}.db`);
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
  throw new Error('Super Admin test server did not become ready.');
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

test('Super Admin company management is protected and persists changes', async () => {
  const superAdmin = await login('superadmin', 'admin123');
  const normalUser = await login('admin', 'admin123');
  const denied = await request('/api/admin/companies', { headers: normalUser });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.code, 'ADMIN_ACCESS_REQUIRED');

  const created = await request('/api/admin/companies', {
    method: 'POST',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyName: `Admin Managed ${process.pid}`,
      companyCode: `QA${process.pid}`,
      plan: 'custom',
      adminName: 'Managed Admin',
      adminUsername: `managed${process.pid}`,
      adminPassword: 'admin12345'
    })
  });
  assert.equal(created.status, 201, created.body);
  const companyId = created.json.company.id;
  const duplicate = await request('/api/admin/companies', {
    method: 'POST',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'Duplicate', companyCode: `QA${process.pid}`, plan: 'normal' })
  });
  assert.equal(duplicate.status, 409);

  const edited = await request(`/api/admin/companies/${companyId}`, {
    method: 'PUT',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Renamed Managed Company', companyCode: `QB${process.pid}` })
  });
  assert.equal(edited.status, 200, edited.body);
  assert.equal(edited.json.company.company_code, `QB${process.pid}`);

  const suspended = await request(`/api/admin/companies/${companyId}/status`, {
    method: 'PATCH',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: false })
  });
  assert.equal(suspended.status, 200, suspended.body);
  assert.equal(suspended.json.company.active, 0);

  const features = await request(`/api/admin/companies/${companyId}/features`, { headers: superAdmin });
  assert.equal(features.status, 200, features.body);
  const updatedFeatures = await request(`/api/admin/companies/${companyId}/features`, {
    method: 'PUT',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ features: { sales: true, payroll: false } })
  });
  assert.equal(updatedFeatures.status, 200, updatedFeatures.body);
  assert.equal(updatedFeatures.json.features.sales, true);
  assert.equal(updatedFeatures.json.features.payroll, false);

  const extended = await request(`/api/admin/companies/${companyId}/subscription/extend`, {
    method: 'POST',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ days: 30 })
  });
  assert.equal(extended.status, 200, extended.body);
  assert.equal(extended.json.success, true);

  const listed = await request(`/api/admin/companies?search=QB${process.pid}`, { headers: superAdmin });
  assert.equal(listed.status, 200, listed.body);
  assert.equal(listed.json[0].company_code, `QB${process.pid}`);
  const restoredAfterInitialSuspend = await request(`/api/admin/companies/${companyId}/status`, {
    method: 'PATCH',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active' })
  });
  assert.equal(restoredAfterInitialSuspend.status, 200, restoredAfterInitialSuspend.body);

  const managedAdmin = await login(`managed${process.pid}`, 'admin12345');
  const passwordChanged = await request('/api/me/password', {
    method: 'POST',
    headers: { ...managedAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'admin12345', newPassword: 'managed12345', confirmPassword: 'managed12345' })
  });
  assert.equal(passwordChanged.status, 200, passwordChanged.body);
  const createdStaff = await request(`/api/companies/${companyId}/users`, {
    method: 'POST',
    headers: { ...managedAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `staff${process.pid}`, email: `staff${process.pid}@example.test`, password: 'staff12345', name: 'Managed Staff', role: 'staff' })
  });
  assert.equal(createdStaff.status, 201, createdStaff.body);
  const staffId = createdStaff.json.id;
  const editedUser = await request(`/api/users/${staffId}`, {
    method: 'PATCH',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Edited Staff', email: 'edited@example.test', role: 'manager' })
  });
  assert.equal(editedUser.status, 200, editedUser.body);
  assert.equal(editedUser.json.user.role, 'manager');
  const deactivated = await request(`/api/users/${staffId}`, {
    method: 'PATCH',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'inactive' })
  });
  assert.equal(deactivated.status, 200, deactivated.body);
  const inactiveLogin = await login(`staff${process.pid}`, 'staff12345').catch((error) => ({ error }));
  assert.ok(inactiveLogin.error);
  const reactivated = await request(`/api/users/${staffId}`, {
    method: 'PATCH',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active', password: 'staff12345' })
  });
  assert.equal(reactivated.status, 200, reactivated.body);
  const archived = await request(`/api/users/${staffId}`, {
    method: 'PATCH',
    headers: { ...managedAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'archived' })
  });
  assert.equal(archived.status, 200, archived.body);
  const crossTenant = await request(`/api/users/${staffId}`, {
    method: 'PATCH',
    headers: { ...normalUser, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Tampered' })
  });
  assert.equal(crossTenant.status, 404);
  const suspendedState = await request(`/api/admin/companies/${companyId}/status`, {
    method: 'PATCH',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'suspended' })
  });
  assert.equal(suspendedState.status, 200);
  assert.equal(suspendedState.json.company.status, 'suspended');
  const suspendedLogin = await login(`managed${process.pid}`, 'managed12345').catch((error) => ({ error }));
  assert.ok(suspendedLogin.error);
  const restored = await request(`/api/admin/companies/${companyId}/status`, {
    method: 'PATCH',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active' })
  });
  assert.equal(restored.status, 200);

  const superSubscription = await request('/api/subscription/status', { headers: superAdmin });
  assert.equal(superSubscription.status, 403);
  assert.equal(superSubscription.json.code, 'SUPER_ADMIN_SUBSCRIPTION_FORBIDDEN');
  const superRenewal = await request('/api/subscription/renewal-request', {
    method: 'POST',
    headers: { ...superAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestedPeriod: 'monthly' })
  });
  assert.equal(superRenewal.status, 403);
});

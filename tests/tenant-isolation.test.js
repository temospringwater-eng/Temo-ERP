const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const port = 34900 + (process.pid % 100);
const databasePath = path.join(os.tmpdir(), `temo-tenant-isolation-${process.pid}.db`);
let serverProcess;

async function request(route, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { status: response.status, body: text, json };
}

async function signup(slug) {
  const password = 'TenantTest123!';
  const username = `tenant_${slug}_${process.pid}`;
  const response = await request('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyName: `Isolation ${slug}`,
      ownerName: `Owner ${slug}`,
      email: `${username}@example.test`,
      username,
      password,
      confirmPassword: password
    })
  });
  assert.equal(response.status, 201, response.body);
  return { companyId: response.json.user.companyId, token: response.json.token };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await request('/readiness');
      if (response.status === 200 && response.json.ready) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Tenant isolation server did not become ready.');
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

test('company data stays isolated and company-id tampering is ignored', async () => {
  const companyA = await signup('a');
  const companyB = await signup('b');

  const createdA = await request('/api/customers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${companyA.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Company A customer', company_id: companyB.companyId })
  });
  assert.equal(createdA.status, 201, createdA.body);
  assert.equal(createdA.json.company_id, companyA.companyId);

  const createdB = await request('/api/customers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${companyB.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Company B customer' })
  });
  assert.equal(createdB.status, 201, createdB.body);

  const listA = await request('/api/customers', {
    headers: { Authorization: `Bearer ${companyA.token}`, 'X-Company-Id': String(companyB.companyId) }
  });
  assert.equal(listA.status, 200, listA.body);
  assert.deepEqual(listA.json.map((row) => row.company_id), [companyA.companyId]);

  const createdProductB = await request('/api/products', {
    method: 'POST',
    headers: { Authorization: `Bearer ${companyB.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Company B product', purchasePrice: 10, salePrice: 20, stock: 5 })
  });
  assert.equal(createdProductB.status, 201, createdProductB.body);

  const crossCompanyUpdate = await request(`/api/products/${createdProductB.json.id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${companyA.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Tampered product', purchasePrice: 1, salePrice: 2, stock: 1, company_id: companyB.companyId })
  });
  assert.equal(crossCompanyUpdate.status, 404, crossCompanyUpdate.body);

  const crossCompanyUsers = await request(`/api/companies/${companyB.companyId}/users`, {
    headers: { Authorization: `Bearer ${companyA.token}` }
  });
  assert.equal(crossCompanyUsers.status, 403, crossCompanyUsers.body);

  const dashboardA = await request('/api/dashboard', {
    headers: { Authorization: `Bearer ${companyA.token}`, 'X-Company-Id': String(companyB.companyId) }
  });
  assert.equal(dashboardA.status, 200, dashboardA.body);
  assert.equal(dashboardA.json.customersCount, 1);
  assert.equal(dashboardA.json.totalProducts, 0);

  const exportA = await request('/api/exports/customers', {
    headers: { Authorization: `Bearer ${companyA.token}` }
  });
  assert.equal(exportA.status, 200, exportA.body);
  assert.match(exportA.body, /Company A customer/);
  assert.doesNotMatch(exportA.body, /Company B customer/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const port = 34100 + (process.pid % 1000);
let serverProcess;
let authHeaders;
const employeeCode = `EMP-DATE-${process.pid}`;

async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body || undefined
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text,
    json: text ? JSON.parse(text) : null
  };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await request('/health');
      if (response.status === 200) return;
    } catch (_) {
      // try again until server is ready
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Employee test server did not start.');
}

test.before(async () => {
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  });
  await waitForServer();

  const loginResponse = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  assert.equal(loginResponse.status, 200, `Login failed: ${loginResponse.body}`);
  const token = loginResponse.json.token;
  authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const superAdminResponse = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'superadmin', password: 'admin123' })
  });
  assert.equal(superAdminResponse.status, 200, `Super admin login failed: ${superAdminResponse.body}`);
  const superHeaders = { Authorization: `Bearer ${superAdminResponse.json.token}`, 'Content-Type': 'application/json' };
  const companyId = loginResponse.json.user.companyId;
  const plansResponse = await request('/api/plans', { headers: superHeaders });
  const enterprisePlan = plansResponse.json.find((plan) => plan.slug === 'enterprise');
  const subscriptionResponse = await request(`/api/companies/${companyId}/subscription`, { headers: superHeaders });
  assert.equal(subscriptionResponse.status, 200, subscriptionResponse.body);
  const subscription = subscriptionResponse.json.subscription;
  const updateResponse = await request(`/api/companies/${companyId}/subscription`, {
    method: 'PUT',
    headers: superHeaders,
    body: JSON.stringify({
      planId: enterprisePlan.id,
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2027-12-31',
      price: subscription.price || 0,
      paymentStatus: subscription.payment_status || 'paid'
    })
  });
  assert.equal(updateResponse.status, 200, updateResponse.body);
});

test.after(() => {
  if (serverProcess) serverProcess.kill();
});

test('employee create and update accept the selected company format and store ISO dates', async () => {
  const companyResponse = await request('/api/company', { headers: authHeaders });
  assert.equal(companyResponse.status, 200, `Company lookup failed: ${companyResponse.body}`);

  const setFormatResponse = await request('/api/company', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      name: companyResponse.json.name,
      defaultLanguage: 'en',
      dateFormat: 'DD-MM-YYYY'
    })
  });
  assert.equal(setFormatResponse.status, 200, `Company date format update failed: ${setFormatResponse.body}`);
  assert.equal(setFormatResponse.json.date_format, 'DD-MM-YYYY');

  const invalidCreateResponse = await request('/api/employees', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      employeeId: `${employeeCode}-INVALID`,
      fullName: 'Invalid Hire Date',
      department: 'Operations',
      role: 'Supervisor',
      salary: 50000,
      hireDate: '09-22-2026',
      status: 'active'
    })
  });
  assert.equal(invalidCreateResponse.status, 400, `Invalid hire date was unexpectedly accepted: ${invalidCreateResponse.body}`);
  assert.match(String(invalidCreateResponse.json.message || ''), /hire date/i);

  const createResponse = await request('/api/employees', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      employeeId: employeeCode,
      fullName: 'Valid Hire Date User',
      department: 'Operations',
      role: 'Supervisor',
      salary: 50000,
      hireDate: '22-09-2026',
      status: 'active'
    })
  });
  assert.equal(createResponse.status, 201, `Employee create failed: ${createResponse.body}`);
  assert.equal(createResponse.json.hire_date, '2026-09-22');

  const employeeId = createResponse.json.id;
  const invalidUpdateResponse = await request(`/api/employees/${employeeId}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      employeeId: employeeCode,
      fullName: 'Valid Hire Date User',
      department: 'Operations',
      role: 'Supervisor',
      salary: 55000,
      hireDate: '31-02-2026',
      status: 'active'
    })
  });
  assert.equal(invalidUpdateResponse.status, 400, `Invalid employee update was unexpectedly accepted: ${invalidUpdateResponse.body}`);
  assert.match(String(invalidUpdateResponse.json.message || ''), /hire date/i);

  const validUpdateResponse = await request(`/api/employees/${employeeId}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      employeeId: employeeCode,
      fullName: 'Valid Hire Date User',
      department: 'Operations',
      role: 'Supervisor',
      salary: 55000,
      hireDate: '15-10-2026',
      status: 'active'
    })
  });
  assert.equal(validUpdateResponse.status, 200, `Employee update failed: ${validUpdateResponse.body}`);
  assert.equal(validUpdateResponse.json.hire_date, '2026-10-15');
});

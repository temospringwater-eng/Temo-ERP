const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.join(__dirname, '..');
const artifactRoot = path.join(__dirname, `.franchise-api-${process.pid}-${Date.now()}`);
const dbPath = path.join(artifactRoot, 'fresh-database.db');
let port;
let serverProcess;
let startupReadiness;
let tenants;
let relationship;
let branchRelationship;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function api(requestPath, options = {}) {
  const method = options.method || 'GET';
  const body = options.body === undefined ? null : JSON.stringify(options.body);
  const headers = { ...(options.headers || {}) };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (body !== null) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: requestPath, method, headers }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => {
        let json = null;
        try { json = responseBody ? JSON.parse(responseBody) : null; } catch (_) {}
        resolve({ status: response.statusCode, headers: response.headers, body: responseBody, json });
      });
    });
    request.on('error', reject);
    if (body !== null) request.write(body);
    request.end();
  });
}

function assertStatus(response, expectedStatus) {
  assert.equal(response.status, expectedStatus, `Expected ${expectedStatus}, received ${response.status}: ${response.body}`);
  return response.json;
}

async function waitForReadiness() {
  let lastError = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await api('/readiness');
      if (response.status === 200 && response.json?.ready === true) return response;
      lastError = new Error(`Readiness returned ${response.status}: ${response.body}`);
    } catch (error) {
      lastError = error;
    }
    if (serverProcess && serverProcess.exitCode !== null) break;
    await sleep(100);
  }
  throw new Error(`Server did not become ready: ${lastError?.message || 'unknown startup failure'}`);
}

async function signup(slug) {
  const suffix = `${process.pid}_${Date.now()}_${slug}`;
  const password = 'FranchiseTest123!';
  const response = await api('/api/signup', {
    method: 'POST',
    body: {
      companyName: `Franchise API Test ${slug}`,
      ownerName: `Franchise API Owner ${slug}`,
      email: `franchise-api-${suffix}@example.test`,
      username: `franchise_api_${suffix}`,
      password,
      confirmPassword: password,
      country: 'Testland',
      address: 'Isolated test fixture'
    }
  });
  const body = assertStatus(response, 201);
  return { id: Number(body.user.companyId), userId: Number(body.user.id), token: body.token };
}

async function login(username, password) {
  const response = await api('/api/login', {
    method: 'POST',
    body: { username, password }
  });
  const body = assertStatus(response, 200);
  return body.token;
}

async function createTenantData(tenant, slug) {
  const customer = assertStatus(await api('/api/customers', {
    method: 'POST',
    token: tenant.token,
    body: { name: `Franchise API Customer ${slug}`, phone: `000-${slug}`, address: `Fixture ${slug}` }
  }), 201);
  const product = assertStatus(await api('/api/products', {
    method: 'POST',
    token: tenant.token,
    body: { name: `Franchise API Product ${slug}`, category: 'Test fixture', purchasePrice: 10, salePrice: 20, stock: 10 }
  }), 201);
  return { customer, product };
}

async function stopServer() {
  if (serverProcess && serverProcess.exitCode === null) {
    const exited = new Promise((resolve) => serverProcess.once('exit', resolve));
    serverProcess.kill();
    await Promise.race([exited, sleep(2000)]);
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(artifactRoot, { recursive: true, force: true });
      if (!fs.existsSync(artifactRoot)) return;
    } catch (_) {}
    await sleep(100);
  }
}

test.before(async () => {
  fs.rmSync(artifactRoot, { recursive: true, force: true });
  fs.mkdirSync(artifactRoot, { recursive: true });
  port = await freePort();
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), NODE_ENV: 'test' },
    stdio: 'ignore'
  });

  startupReadiness = await waitForReadiness();
  tenants = {
    parent: await signup('parent'),
    child: await signup('child'),
    branch: await signup('branch'),
    outsider: await signup('outsider')
  };
  const superAdminToken = await login('superadmin', 'admin123');
  const plans = assertStatus(await api('/api/plans', { token: superAdminToken }), 200);
  const enterprisePlan = plans.find((plan) => plan.slug === 'enterprise');
  assert.ok(enterprisePlan, 'Enterprise plan must be seeded for franchise fixtures.');
  for (const tenant of Object.values(tenants)) {
    assertStatus(await api(`/api/companies/${tenant.id}/subscription`, {
      method: 'PUT',
      token: superAdminToken,
      body: {
        planId: enterprisePlan.id,
        status: 'active',
        startDate: '2026-01-01',
        endDate: '2027-01-01',
        price: 0,
        paymentStatus: 'paid'
      }
    }), 200);
  }
  for (const [name, tenant] of Object.entries(tenants)) tenant.data = await createTenantData(tenant, name);

  relationship = assertStatus(await api('/api/franchises', {
    method: 'POST',
    token: tenants.parent.token,
    body: {
      parentCompanyId: tenants.parent.id,
      childCompanyId: tenants.child.id,
      relationshipType: 'franchise',
      status: 'active',
      agreementNumber: 'FRANCHISE-API-TEST',
      notes: 'Isolated automated test relationship'
    }
  }), 201);

  branchRelationship = assertStatus(await api(`/api/franchises/${relationship.id}/branches`, {
    method: 'POST',
    token: tenants.parent.token,
    body: {
      childCompanyId: tenants.branch.id,
      status: 'active',
      agreementNumber: 'BRANCH-API-TEST'
    }
  }), 201);
});

test.after(async () => {
  await stopServer();
});

test('fresh database starts and reports readiness after franchise schema initialization', () => {
  assert.equal(fs.existsSync(dbPath), true);
  assert.equal(startupReadiness.status, 200);
  assert.equal(startupReadiness.json.ready, true);
  assert.equal(startupReadiness.json.database, 'ok');
});

test('franchise relationship creation rejects duplicates and conflicting parents', async () => {
  const duplicate = await api('/api/franchises', {
    method: 'POST',
    token: tenants.parent.token,
    body: { parentCompanyId: tenants.parent.id, childCompanyId: tenants.child.id, relationshipType: 'franchise' }
  });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.json.message, /already exists/i);

  const conflictingParent = await api('/api/franchises', {
    method: 'POST',
    token: tenants.parent.token,
    body: { parentCompanyId: tenants.parent.id, childCompanyId: tenants.branch.id, relationshipType: 'franchise' }
  });
  assert.equal(conflictingParent.status, 409);
  assert.match(conflictingParent.json.message, /another active franchise hierarchy/i);
});

test('agreements, fees, and revenue shares persist validated commercial metadata', async () => {
  const agreement = assertStatus(await api(`/api/franchises/${relationship.id}/agreements`, {
    method: 'POST',
    token: tenants.parent.token,
    body: {
      agreementNumber: 'AGREEMENT-API-TEST',
      status: 'active',
      signedOn: '2026-01-01',
      effectiveOn: '2026-01-01',
      expiresOn: '2027-01-01',
      joiningFee: 100,
      recurringFee: 25,
      currency: 'USD',
      revenueSharePercent: 10,
      terms: 'Automated fixture agreement'
    }
  }), 201);
  assert.equal(agreement.agreement_number, 'AGREEMENT-API-TEST');
  assert.equal(agreement.currency, 'USD');
  assert.equal(Number(agreement.revenue_share_percent), 10);

  const fee = assertStatus(await api(`/api/franchises/${relationship.id}/fees`, {
    method: 'POST',
    token: tenants.parent.token,
    body: { feeType: 'recurring', amount: 25, currency: 'USD', frequency: 'monthly', dueDate: '2026-02-01', status: 'pending' }
  }), 201);
  assert.equal(fee.fee_type, 'recurring');
  assert.equal(Number(fee.amount), 25);
  const invalidFee = await api(`/api/franchises/${relationship.id}/fees`, {
    method: 'POST',
    token: tenants.parent.token,
    body: { feeType: 'joining', amount: -1 }
  });
  assert.equal(invalidFee.status, 400);

  const revenueShare = assertStatus(await api(`/api/franchises/${relationship.id}/revenue-shares`, {
    method: 'POST',
    token: tenants.parent.token,
    body: { periodStart: '2026-01-01', periodEnd: '2026-01-31', grossRevenue: 1000, deductions: 100, sharePercent: 10, status: 'calculated' }
  }), 201);
  assert.equal(Number(revenueShare.basis_amount), 900);
  assert.equal(Number(revenueShare.parent_amount), 90);
  assert.equal(Number(revenueShare.child_amount), 810);
  const invalidRevenue = await api(`/api/franchises/${relationship.id}/revenue-shares`, {
    method: 'POST',
    token: tenants.parent.token,
    body: { periodStart: '2026-02-01', periodEnd: '2026-02-28', grossRevenue: 100, deductions: 101, sharePercent: 10 }
  });
  assert.equal(invalidRevenue.status, 400);

  for (const entityType of ['franchise_agreement', 'franchise_fee', 'franchise_revenue_share']) {
    const audit = assertStatus(await api(`/api/audit-logs?entityType=${entityType}&pageSize=100`, { token: tenants.parent.token }), 200);
    assert.ok(audit.logs.length > 0, `Expected audit record for ${entityType}`);
    assert.ok(audit.logs.every((row) => Number(row.company_id) === tenants.parent.id));
  }
});

test('branch hierarchy exposes descendants and rejects self and cyclic links', async () => {
  const branches = assertStatus(await api(`/api/franchises/${relationship.id}/branches`, { token: tenants.parent.token }), 200);
  assert.equal(branches.length, 1);
  assert.equal(Number(branches[0].id), Number(branchRelationship.id));
  assert.equal(Number(branches[0].parent_company_id), tenants.child.id);
  assert.equal(Number(branches[0].child_company_id), tenants.branch.id);

  const selfBranch = await api(`/api/franchises/${relationship.id}/branches`, {
    method: 'POST',
    token: tenants.parent.token,
    body: { childCompanyId: tenants.child.id }
  });
  assert.equal(selfBranch.status, 400);
  assert.match(selfBranch.json.message, /different child company/i);

  const cycle = await api(`/api/franchises/${relationship.id}/branches`, {
    method: 'POST',
    token: tenants.parent.token,
    body: { childCompanyId: tenants.parent.id }
  });
  assert.equal(cycle.status, 400);
  assert.match(cycle.json.message, /cycle/i);
});

test('assignments grant explicit scopes and expose scoped tenant data', async () => {
  const assignment = assertStatus(await api(`/api/franchises/${relationship.id}/assignments`, {
    method: 'POST',
    token: tenants.parent.token,
    body: {
      userId: tenants.child.userId,
      assignmentType: 'manager',
      scopes: ['customers', 'reports'],
      permissions: {
        customers: { canRead: true, canWrite: false },
        reports: { canRead: true, canWrite: false }
      }
    }
  }), 201);
  assert.equal(Number(assignment.user.id), tenants.child.userId);
  assert.equal(assignment.assignment_type, 'manager');
  assert.deepEqual(assignment.scopes.map((scope) => scope.scope), ['customers', 'reports']);

  const inventoryScope = assertStatus(await api(`/api/franchises/${relationship.id}/scopes`, {
    method: 'POST',
    token: tenants.parent.token,
    body: { userId: tenants.child.userId, scope: 'inventory', canRead: true, canWrite: false }
  }), 201);
  assert.equal(inventoryScope.scope, 'inventory');
  assert.equal(Number(inventoryScope.can_read), 1);
  assert.equal(Number(inventoryScope.can_write), 0);

  const assignmentRows = assertStatus(await api(`/api/franchises/${relationship.id}/assignments`, { token: tenants.parent.token }), 200);
  assert.equal(assignmentRows.length, 1);
  assert.equal(Number(assignmentRows[0].user_id), tenants.child.userId);
  assert.equal(Number(assignmentRows[0].active), 1);

  const scopeRows = assertStatus(await api(`/api/franchises/${relationship.id}/scopes`, { token: tenants.parent.token }), 200);
  assert.deepEqual(scopeRows.filter((row) => Number(row.user_id) === tenants.child.userId).map((row) => row.scope).sort(), ['customers', 'inventory', 'reports']);

  const childDetail = assertStatus(await api(`/api/franchises/${relationship.id}`, { token: tenants.child.token }), 200);
  assert.equal(Number(childDetail.id), Number(relationship.id));
  assert.deepEqual(childDetail.assignments, []);

  const childScope = assertStatus(await api('/api/franchise-scope', { token: tenants.child.token }), 200);
  assert.ok(childScope.relationships.some((row) => Number(row.id) === Number(relationship.id)));
  assert.ok(childScope.scopes.some((row) => Number(row.relationship_id) === Number(relationship.id) && row.scope === 'inventory'));

  const scopedCustomers = assertStatus(await api(`/api/franchises/${tenants.parent.id}/scope/customers`, { token: tenants.child.token }), 200);
  assert.deepEqual([...scopedCustomers.companyIds].sort((a, b) => a - b), [tenants.branch.id, tenants.child.id].sort((a, b) => a - b));
  assert.ok(scopedCustomers.rows.some((row) => Number(row.company_id) === tenants.child.id));
  assert.ok(scopedCustomers.rows.some((row) => Number(row.company_id) === tenants.branch.id));
  assert.equal(scopedCustomers.rows.some((row) => Number(row.company_id) === tenants.parent.id), false);

  const scopedInventory = assertStatus(await api(`/api/franchises/${tenants.parent.id}/scope/inventory`, { token: tenants.child.token }), 200);
  assert.deepEqual([...scopedInventory.companyIds].sort((a, b) => a - b), [tenants.branch.id, tenants.child.id].sort((a, b) => a - b));
  assert.ok(scopedInventory.rows.every((row) => [tenants.child.id, tenants.branch.id].includes(Number(row.company_id))));
});

test('unassigned child employees cannot use franchise data scopes', async () => {
  const password = 'FranchiseEmployee123!';
  const username = `franchise_unassigned_${process.pid}_${Date.now()}`;
  const created = assertStatus(await api(`/api/companies/${tenants.child.id}/users`, {
    method: 'POST',
    token: tenants.child.token,
    body: { username, email: `${username}@example.test`, password, name: 'Unassigned franchise employee', role: 'staff' }
  }), 201);
  assert.equal(Number(created.company_id), tenants.child.id);
  const loggedIn = assertStatus(await api('/api/login', {
    method: 'POST',
    body: { username, password }
  }), 200);
  const denied = await api(`/api/franchises/${tenants.parent.id}/scope/customers`, { token: loggedIn.token });
  assert.equal(denied.status, 403);
});

test('report permissions enforce report keys and isolate consolidated data by tenant', async () => {
  const beforeGrant = await api(`/api/franchises/${tenants.parent.id}/consolidated-reports?reportKey=consolidated_sales`, { token: tenants.child.token });
  assert.equal(beforeGrant.status, 403);
  assert.match(beforeGrant.json.message, /consolidated report/i);

  const permission = assertStatus(await api(`/api/franchises/${relationship.id}/report-permissions`, {
    method: 'POST',
    token: tenants.parent.token,
    body: { userId: tenants.child.userId, reportKey: 'consolidated_sales', canView: true, canExport: false, consolidated: true }
  }), 201);
  assert.equal(permission.report_key, 'consolidated_sales');
  assert.equal(Number(permission.can_view), 1);
  assert.equal(Number(permission.consolidated), 1);

  const childReportPermissions = assertStatus(await api(`/api/franchises/${relationship.id}/report-permissions`, { token: tenants.child.token }), 200);
  assert.equal(childReportPermissions.length, 1);
  assert.equal(Number(childReportPermissions[0].user_id), tenants.child.userId);

  const childSales = assertStatus(await api(`/api/franchises/${tenants.parent.id}/consolidated-reports?reportKey=consolidated_sales`, { token: tenants.child.token }), 200);
  assert.equal(childSales.reportKey, 'consolidated_sales');
  assert.deepEqual([...childSales.companyIds].sort((a, b) => a - b), [tenants.child.id, tenants.branch.id].sort((a, b) => a - b));
  assert.equal(childSales.companyIds.includes(tenants.parent.id), false);
  assert.equal(childSales.companyIds.includes(tenants.outsider.id), false);
  assert.ok(childSales.rows.every((row) => !Object.prototype.hasOwnProperty.call(row, 'product_count')));
  assert.ok(childSales.rows.every((row) => !Object.prototype.hasOwnProperty.call(row, 'customer_count')));

  const reportKeyDenied = await api(`/api/franchises/${tenants.parent.id}/consolidated-reports?reportKey=consolidated_inventory`, { token: tenants.child.token });
  assert.equal(reportKeyDenied.status, 403);

  const parentSales = assertStatus(await api(`/api/franchises/${tenants.parent.id}/consolidated-reports?reportKey=consolidated_sales`, { token: tenants.parent.token }), 200);
  assert.deepEqual([...parentSales.companyIds].sort((a, b) => a - b), [tenants.parent.id, tenants.child.id, tenants.branch.id].sort((a, b) => a - b));
  assert.equal(parentSales.companyIds.includes(tenants.outsider.id), false);
  assert.ok(parentSales.rows.every((row) => Object.prototype.hasOwnProperty.call(row, 'revenue')));
});

test('cross-tenant users cannot view, create, scope, or report on another hierarchy', async () => {
  const visible = assertStatus(await api('/api/franchises', { token: tenants.outsider.token }), 200);
  assert.deepEqual(visible, []);

  const relationshipDenied = await api(`/api/franchises/${relationship.id}`, { token: tenants.outsider.token });
  assert.equal(relationshipDenied.status, 403);

  const scopeDenied = await api(`/api/franchises/${tenants.parent.id}/scope/customers`, { token: tenants.outsider.token });
  assert.equal(scopeDenied.status, 403);

  const reportDenied = await api(`/api/franchises/${tenants.parent.id}/consolidated-reports?reportKey=consolidated_sales`, { token: tenants.outsider.token });
  assert.equal(reportDenied.status, 403);

  const createDenied = await api('/api/franchises', {
    method: 'POST',
    token: tenants.outsider.token,
    body: { parentCompanyId: tenants.parent.id, childCompanyId: tenants.outsider.id, relationshipType: 'franchise' }
  });
  assert.equal(createDenied.status, 403);

  const outsiderAudit = assertStatus(await api('/api/audit-logs?entityType=franchise_relationship&pageSize=100', { token: tenants.outsider.token }), 200);
  assert.equal(outsiderAudit.total, 0);
});

test('franchise mutations write tenant-scoped audit records', async () => {
  const relationshipAudit = assertStatus(await api('/api/audit-logs?entityType=franchise_relationship&pageSize=100', { token: tenants.parent.token }), 200);
  assert.ok(relationshipAudit.logs.some((row) => row.action === 'create' && Number(row.entity_id) === Number(relationship.id)));
  assert.ok(relationshipAudit.logs.every((row) => Number(row.company_id) === tenants.parent.id));

  const assignmentAudit = assertStatus(await api('/api/audit-logs?entityType=franchise_user_assignment&pageSize=100', { token: tenants.parent.token }), 200);
  assert.ok(assignmentAudit.logs.some((row) => row.action === 'assign' && Number(row.entity_id) > 0));

  const scopeAudit = assertStatus(await api('/api/audit-logs?entityType=franchise_scope&pageSize=100', { token: tenants.parent.token }), 200);
  assert.ok(scopeAudit.logs.some((row) => row.action === 'grant'));

  const reportAudit = assertStatus(await api('/api/audit-logs?entityType=franchise_report_permission&pageSize=100', { token: tenants.parent.token }), 200);
  assert.ok(reportAudit.logs.some((row) => row.action === 'grant'));
});

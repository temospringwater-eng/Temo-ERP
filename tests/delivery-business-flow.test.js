'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const port = 38300 + (process.pid % 700);
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'temo-delivery-e2e-'));
const dbPath = path.join(sandbox, 'e2e.db');
let proc;
let errors = '';

async function api(route, token, method = 'GET', payload) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch (_) { data = raw; }
  return { status: response.status, data, raw };
}

async function expect(route, token, method, payload, status) {
  const result = await api(route, token, method, payload);
  assert.equal(result.status, status, `${method} ${route}: ${result.raw}`);
  return result.data;
}

async function tenant(suffix) {
  const password = 'TenantDeliveryTest2026!';
  const username = `delivery_tenant_${suffix}_${process.pid}`;
  const result = await expect('/api/signup', null, 'POST', {
    companyName: `Delivery Test ${suffix}`,
    ownerName: `Owner ${suffix}`,
    email: `${username}@example.test`,
    username, password, confirmPassword: password
  }, 201);
  return { token: result.token, companyId: result.user.companyId };
}

test.before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', DB_PATH: dbPath, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  proc.stderr.on('data', (chunk) => { errors += chunk.toString(); });
  for (let i = 0; i < 120; i += 1) {
    if (proc.exitCode !== null) throw new Error('ERP failed to start: ' + errors);
    try {
      const ready = await api('/readiness');
      if (ready.status === 200 && ready.data.ready) return;
    } catch (_) { /* waiting for DB setup */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('ERP readiness timeout: ' + errors);
});

test.after(async () => {
  if (proc && proc.exitCode === null) {
    proc.kill();
    await new Promise((resolve) => proc.once('exit', resolve));
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('tenant-isolated order → assigned driver → OTP delivery → payment/bottle ledger; backup checksum validates', async () => {
  const a = await tenant('a');
  const b = await tenant('b');
  const customer = await expect('/api/customers', a.token, 'POST', {
    name: 'E2E Customer', phone: '+923000000000', address: 'Test Street', area: 'Test Zone'
  }, 201);
  const product = await expect('/api/products', a.token, 'POST', {
    name: 'E2E 19L Water', purchasePrice: 50, salePrice: 100, stock: 20
  }, 201);
  const driverName = `e2e_driver_${process.pid}`;
  const driverPassword = 'DriverTesting2026!';
  const driver = await expect(`/api/companies/${a.companyId}/users`, a.token, 'POST', {
    username: driverName, name: 'E2E Driver', password: driverPassword, role: 'driver'
  }, 201);
  assert.equal(driver.role, 'driver');

  const login = await expect('/api/login', null, 'POST', { username: driverName, password: driverPassword }, 200);
  const driverToken = login.token;
  const bottle = await expect('/api/bottles', a.token, 'POST', {
    name: 'E2E Returnable 19L', code: `E2E-${process.pid}`, capacityLitres: 19
  }, 201);
  await expect('/api/bottle-movements', a.token, 'POST', {
    bottleId: bottle.id, movementType: 'received', quantity: 5, reference: 'E2E-IN'
  }, 201);
  await expect('/api/bottle-movements', a.token, 'POST', {
    bottleId: bottle.id, customerId: customer.id, movementType: 'dispatched', quantity: 2, reference: 'E2E-OUT'
  }, 201);

  const order = await expect('/api/orders', a.token, 'POST', {
    customerId: customer.id, customerName: customer.name,
    items: [{ productId: product.id, quantity: 2 }]
  }, 201);
  assert.equal(Number(order.total_amount), 200);
  await expect(`/api/orders/${order.id}`, b.token, 'GET', undefined, 404);
  await expect(`/api/orders/${order.id}/delivery`, b.token, 'POST', { driverId: driver.id }, 404);

  const assigned = await expect(`/api/orders/${order.id}/delivery`, a.token, 'POST', { driverId: driver.id }, 201);
  assert.equal(assigned.status, 'assigned');
  const allDeliveries = await expect('/api/deliveries', a.token, 'GET', undefined, 200);
  const linked = allDeliveries.find((item) => item.order_id === order.id);
  assert.ok(linked, 'Assigned delivery must be visible');
  await expect(`/api/deliveries/${linked.id}`, b.token, 'PATCH', { status: 'delivered' }, 404);

  const driverDeliveries = await expect('/api/driver/deliveries', driverToken, 'GET', undefined, 200);
  assert.ok(JSON.stringify(driverDeliveries).includes(String(linked.id)), 'Driver should see assigned delivery');
  const started = await expect(`/api/driver/deliveries/${linked.id}/action`, driverToken, 'POST', { action: 'start' }, 200);
  assert.equal(started.status, 'out_for_delivery');

  const portalPassword = 'CustomerPortalTest2026!';
  await expect(`/api/customers/${customer.id}/portal-access`, a.token, 'POST', {
    email: `e2e_customer_${process.pid}@example.test`, password: portalPassword
  }, 201);
  const customerLogin = await expect('/api/customer/login', null, 'POST', {
    identifier: `e2e_customer_${process.pid}@example.test`, password: portalPassword
  }, 200);
  const otp = await expect(`/api/customer/deliveries/${linked.id}/otp`, customerLogin.token, 'POST', {}, 201);
  assert.match(otp.otpCode, /^\d{6}$/);

  const signature = { storageKey: `test/signature-${process.pid}.png`, contentType: 'image/png', byteSize: 100, sha256: 'a'.repeat(64), width: 120, height: 80 };
  const completed = await expect(`/api/driver/deliveries/${linked.id}/action`, driverToken, 'POST', {
    action: 'deliver', otpChallengeId: otp.challengeId, otpCode: otp.otpCode,
    signature, bottleId: bottle.id, bottleReturnCount: 1, emptyCount: 1,
    payment: { amount: 200, method: 'Cash', reference: 'E2E-COLLECTION' }
  }, 200);
  assert.equal(completed.status, 'delivered');
  const finalOrder = await expect(`/api/orders/${order.id}`, a.token, 'GET', undefined, 200);
  assert.equal(finalOrder.status, 'delivered');
  const payments = await expect('/api/payments', a.token, 'GET', undefined, 200);
  assert.equal(payments.filter((p) => p.delivery_id === linked.id && Number(p.amount) === 200).length, 1);
  const movements = await expect('/api/bottle-movements', a.token, 'GET', undefined, 200);
  assert.equal(movements.filter((m) => m.reference === `DELIVERY-${linked.id}` && m.movement_type === 'returned').reduce((sum, m) => sum + Number(m.quantity), 0), 1);
  const proof = await expect(`/api/deliveries/${linked.id}/proof`, a.token, 'GET', undefined, 200);
  assert.equal(proof.signature_sha256, signature.sha256);
  await expect(`/api/driver/deliveries/${linked.id}/action`, driverToken, 'POST', { action: 'deliver' }, 409);
  const paymentsAfterRetry = await expect('/api/payments', a.token, 'GET', undefined, 200);
  assert.equal(paymentsAfterRetry.filter((p) => p.delivery_id === linked.id).length, 1);

  const backup = await expect('/api/backups', a.token, 'POST', { scope: 'tenant' }, 201);
  const validation = await expect(`/api/backups/${backup.id}/validate`, a.token, 'POST', {}, 200);
  assert.equal(validation.valid, true);
  assert.equal(validation.restore.destructive, false);
  await expect(`/api/backups/${backup.id}/validate`, b.token, 'POST', {}, 404);
});

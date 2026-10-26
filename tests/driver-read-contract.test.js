'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createDriverReadContractQa, DRIVER_PERMISSION_KEYS } = require('../services/driver-read-contract-qa');

function fixture({ qaEnabled = true, errors = false } = {}) {
  const app = express();
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (errors) throw new Error('database unavailable');
    if (sql.includes('driver_field_permissions')) return [
      { permission: 'create_customer', enabled: 1 },
      { permission: 'collect_recovery', enabled: 0 },
      { permission: 'invalid_flag', enabled: 1 }
    ];
    if (sql.includes('FROM products')) return [
      { id: 42, name: '19L Spring Water', category: 'Water', stock: 12 }
    ];
    throw Error('Unexpected SQL query: ' + sql);
  };
  // Isolated express harness; central ERP production authentication is not stubbed or modified.
  app.use((req, _res, next) => {
    if (req.headers['x-test-user'] !== 'none') {
      req.user = { id: 7, company_id: 4, role: req.headers['x-test-role'] || 'driver' };
      req.companyId = 4;
    }
    next();
  });
  createDriverReadContractQa({ app, query, qaEnabled });
  let server, origin;
  async function start() {
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    origin = 'http://127.0.0.1:' + server.address().port;
  }
  async function get(path, headers = {}) {
    const response = await fetch(origin + path, { headers });
    return { status: response.status, body: await response.json().catch(() => null) };
  }
  async function stop() { if (server) await new Promise(resolve => server.close(resolve)); }
  return { start, get, stop, calls };
}
test('TDD: QA driver permissions are strictly driver/tenant scoped; unknown flags remain denied', async t => {
  const f = fixture(); await f.start(); t.after(f.stop);
  const good = await f.get('/api/driver/permissions?companyId=999');
  assert.equal(good.status, 200);
  assert.equal(good.body.driverId, 7);
  assert.equal(good.body.permissions.create_customer, true);
  assert.equal(good.body.permissions.collect_recovery, false);
  assert.equal(good.body.permissions.view_customer_ledger, false);
  assert.equal(good.body.permissions.invalid_flag, undefined);
  assert.deepEqual(f.calls[0].params, [4, 7]);
  assert.equal(Object.keys(good.body.permissions).length, DRIVER_PERMISSION_KEYS.length);
  const denied = await f.get('/api/driver/permissions', { 'x-test-role': 'company_admin' });
  assert.equal(denied.status, 403);
  const absent = await f.get('/api/driver/permissions', { 'x-test-user': 'none' });
  assert.equal(absent.status, 401);
});
test('TDD: bottle products only from authenticated company, never request-controlled tenant', async t => {
  const f = fixture(); await f.start(); t.after(f.stop);
  const good = await f.get('/api/driver/bottle-types?companyId=999');
  assert.equal(good.status, 200);
  assert.equal(good.body.items[0].name, '19L Spring Water');
  assert.deepEqual(f.calls[0].params, [4]);
  assert.equal((await f.get('/api/driver/bottle-types', { 'x-test-role': 'super_admin' })).status, 403);
});
test('TDD: delivery policy fails closed to OTP ON, never accept client OTP override', async t => {
  const f = fixture(); await f.start(); t.after(f.stop);
  const policy = await f.get('/api/driver/delivery-policy?otpRequired=false');
  assert.equal(policy.status, 200);
  assert.equal(policy.body.otpRequired, true);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.get('/api/driver/delivery-policy', { 'x-test-role': 'customer' })).status, 403);
});
test('TDD: QA-only driver routes disabled by default; read errors never expose DB internals', async t => {
  const off = fixture({ qaEnabled: false }); await off.start(); t.after(off.stop);
  assert.equal((await off.get('/api/driver/permissions')).status, 404);
  assert.equal((await off.get('/api/driver/delivery-policy')).status, 404);
  assert.equal((await off.get('/api/driver/bottle-types')).status, 404);
  const bad = fixture({ errors: true }); await bad.start(); t.after(bad.stop);
  const result = await bad.get('/api/driver/bottle-types');
  assert.equal(result.status, 503);
  assert.doesNotMatch(JSON.stringify(result.body), /database unavailable/);
});
test('TDD: all fifteen approved permissions are explicit deny-by-default', () => {
  assert.equal(new Set(DRIVER_PERMISSION_KEYS).size, 15);
  for (const key of ['create_customer', 'create_order', 'view_balance', 'change_qty', 'change_price',
    'edit_notes', 'manage_customer_schedule', 'gps_delivery_override', 'refund_security_deposit',
    'sale_quotation', 'stock_negative_override', 'view_customer_ledger',
    'collect_recovery', 'view_zone', 'view_van_stock'])
    assert.ok(DRIVER_PERMISSION_KEYS.includes(key), key);
});

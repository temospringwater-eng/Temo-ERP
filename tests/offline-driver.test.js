'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const driverSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'offline-driver.js'), 'utf8');
const QUEUE_KEY = 'temo_aquaflow_offline_driver_queue';

function harness(online = false) {
  const entries = new Map();
  const handlers = new Map();
  let responder = async () => { throw new Error('Network unavailable'); };
  const requests = [];
  const store = {
    getItem(key) { return entries.has(key) ? entries.get(key) : null; },
    setItem(key, value) { entries.set(key, String(value)); }
  };
  const navigator = { onLine: online };
  const window = {
    indexedDB: null,
    addEventListener(event, fn) { handlers.set(event, fn); }
  };
  const context = { window, navigator, localStorage: store, Date, Promise, JSON,
    fetch: async (...args) => { requests.push(args); return responder(...args); }
  };
  vm.runInNewContext(driverSource, context, { filename: 'public/offline-driver.js' });
  return {
    driver: window.OfflineDriver, navigator, store, requests,
    rows() { return JSON.parse(store.getItem(QUEUE_KEY) || '[]'); },
    respond(fn) { responder = fn; },
    async reconnect() { navigator.onLine = true; const callback = handlers.get('online'); if (callback) callback(); }
  };
}

const operation = (id) => ({
  idempotencyKey: id,
  operationType: 'start',
  deliveryId: 12,
  baseUpdatedAt: '2026-10-23T08:00:00Z',
  payload: { notes: 'Recorded by driver offline' }
});
const reply = (results, status = 200) => ({ ok: status >= 200 && status < 300, status,
  async json() { return { success: status === 200, results }; } });

test('offline operations and delivery cache survive storage fallback', async () => {
  const h = harness(false);
  await h.driver.queueAction(operation('safe-1'));
  assert.equal(await h.driver.count(), 1);
  assert.equal(h.rows()[0].state, 'pending');
  await h.driver.cacheDeliveries('2026-10-23', [{ id: 12 }], []);
  const cached = await h.driver.getCachedDeliveries('2026-10-23');
  assert.equal(cached.deliveries[0].id, 12);
  assert.equal((await h.driver.sync()).synced, 0);
  assert.equal(h.rows().length, 1);
});

test('a partial server response retains unacknowledged offline updates', async () => {
  const h = harness(true);
  await h.driver.queueAction(operation('safe-1'));
  await h.driver.queueAction(operation('safe-2'));
  let calls = 0;
  h.respond(async () => {
    calls += 1;
    if (calls === 1) return reply([{ idempotencyKey: 'safe-1', status: 'applied' }]);
    return reply([{ idempotencyKey: 'safe-2', status: 'applied' }]);
  });
  const first = await h.driver.sync();
  assert.equal(first.synced, 1);
  assert.deepEqual(h.rows().map(row => row.id), ['safe-2']);
  const second = await h.driver.sync();
  assert.equal(second.synced, 1);
  assert.equal(await h.driver.count(), 0);
});

test('conflicts and rejected operations are saved for review, never silently discarded', async () => {
  const h = harness(true);
  await h.driver.queueAction(operation('conflict-1'));
  await h.driver.queueAction(operation('failed-1'));
  h.respond(async () => reply([
    { idempotencyKey: 'conflict-1', status: 'conflict', code: 'stale_delivery' },
    { idempotencyKey: 'failed-1', status: 'failed', message: 'Invalid delivery action' }
  ], 409));
  const result = await h.driver.sync();
  assert.equal(result.conflicts, 1);
  assert.equal(result.synced, 0);
  assert.deepEqual(h.rows().map(row => row.state), ['conflict', 'failed']);
  await h.driver.sync();
  assert.equal(h.requests.length, 1, 'do not automatically replay invalid operations');
});

test('connection and server errors do not delete queued delivery updates', async () => {
  const h = harness(true);
  await h.driver.queueAction(operation('safe-1'));
  h.respond(async () => { throw new Error('Connection dropped'); });
  assert.equal((await h.driver.sync()).synced, 0);
  assert.equal(h.rows().length, 1);
  h.respond(async () => reply([], 500));
  assert.equal((await h.driver.sync()).synced, 0);
  assert.equal(h.rows()[0].state, 'pending');
});

test('missing or unsafe idempotency key is rejected before storing an operation', async () => {
  const h = harness(false);
  await assert.rejects(() => h.driver.queueAction({ operationType: 'start' }), /idempotency key/);
  await assert.rejects(() => h.driver.queueAction(operation('bad key')), /idempotency key/);
  assert.equal(h.rows().length, 0);
});

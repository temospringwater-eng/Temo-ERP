'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { parseServerPort, nextServerPort } = require('../services/server-port');

test('TDD: PORT strings are normalized to safe integer socket ports', () => {
  assert.equal(parseServerPort(undefined), 3000);
  assert.equal(parseServerPort(''), 3000);
  assert.equal(parseServerPort('34040'), 34040);
  assert.equal(parseServerPort('0'), 0); // kernel-assigned port in isolated smoke tests
  assert.equal(parseServerPort(65535), 65535);
  for (const bad of ['340401', '-1', '3.5', '0x12', ' 34040 ', 'Infinity', 'NaN']) {
    assert.throws(() => parseServerPort(bad), /port/i);
  }
});

test('TDD: EADDRINUSE fallback advances numerically and fails closed at the TCP limit', () => {
  assert.equal(nextServerPort(parseServerPort('34040')), 34041);
  assert.equal(nextServerPort(65534), 65535);
  for (const bad of [0, 65535, -1, 34040.5, '34040']) {
    assert.throws(() => nextServerPort(bad), /port/i);
  }
});

test('Integration: normalized numeric retry port can be bound by Node TCP server', async (t) => {
  const busy = net.createServer();
  await new Promise((resolve, reject) => {
    busy.once('error', reject);
    busy.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => busy.close());
  const occupied = busy.address().port;
  assert.throws(() => parseServerPort(String(occupied + '1')), /port/i);
  const next = nextServerPort(occupied);
  assert.equal(next, occupied + 1);
  if (next > 65535) return;
  const fallback = net.createServer();
  t.after(() => fallback.close());
  await new Promise((resolve, reject) => {
    fallback.once('error', reject);
    fallback.listen(next, '127.0.0.1', resolve);
  });
  assert.equal(fallback.address().port, next);
});

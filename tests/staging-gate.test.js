'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createStagingGate } = require('../services/staging-gate');

test('staging gate validates secret strength and denies weak setup', () => {
  assert.throws(() => createStagingGate('admin123'), /24\+/);
});

test('private staging gate protects ERP HTML, API and files until correct unlock', async () => {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(createStagingGate('Secure-Unique-Testing-Gate-Secret-2026-abc'));
  app.get('/index.html', (_req, res) => res.send('PROTECTED_ERP_INTERFACE'));
  app.get('/app.js', (_req, res) => res.send('PROTECTED_JS'));
  app.get('/api/private', (_req, res) => res.json({ confidential: true }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const locked = await fetch(base + '/index.html');
    const lockedBody = await locked.text();
    assert.equal(locked.status, 200);
    assert.match(lockedBody, /Private Test/);
    assert.doesNotMatch(lockedBody, /PROTECTED_ERP_INTERFACE/);
    assert.equal((await fetch(base + '/app.js')).headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal((await fetch(base + '/api/private')).status, 401);
    const wrong = await fetch(base + '/__staging/unlock', {
      method: 'POST', body: new URLSearchParams({ code: 'wrong' }), redirect: 'manual'
    });
    assert.equal(wrong.status, 403);
    const granted = await fetch(base + '/__staging/unlock', {
      method: 'POST', body: new URLSearchParams({ code: 'Secure-Unique-Testing-Gate-Secret-2026-abc' }),
      redirect: 'manual'
    });
    assert.equal(granted.status, 303);
    assert.equal(granted.headers.get('location'), '/index.html');
    const cookie = granted.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=Strict/i);
    const credential = cookie.split(';')[0];
    assert.equal((await (await fetch(base + '/index.html', { headers: { Cookie: credential } })).text()), 'PROTECTED_ERP_INTERFACE');
    assert.equal((await (await fetch(base + '/app.js', { headers: { Cookie: credential } })).text()), 'PROTECTED_JS');
    const api = await fetch(base + '/api/private', { headers: { Cookie: credential } });
    assert.equal(api.status, 200);
    assert.equal((await api.json()).confidential, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

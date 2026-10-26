'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'temo-password-route-'));
const dbPath = path.join(folder, 'isolated.sqlite');
const port = 37300 + process.pid % 1200;
let server, stderr = '';

async function request(route, method = 'GET', payload, token) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
  });
  let body = '';
  try { body = await res.json(); } catch (_) { /* non-json response */ }
  return { status: res.status, body };
}

test.before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DB_PATH: dbPath,
      TEMO_BOOTSTRAP_SUPERADMIN_PASSWORD: 'admin123', TEMO_BOOTSTRAP_COMPANY_ADMIN_PASSWORD: 'admin123' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 1000); });
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error('ERP failed to start: ' + stderr);
    try {
      const health = await request('/readiness');
      if (health.status === 200 && health.body.ready) return;
    } catch (_) { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('ERP startup timeout: ' + stderr);
});
test.after(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise(resolve => server.once('exit', resolve));
  }
  fs.rmSync(folder, { force: true, recursive: true });
});

test('change-password is authenticated, registered once, self-scoped and supports platform administrator', async () => {
  for (let i = 0; i < 12; i++) assert.equal((await request('/health')).status, 200);
  const noSession = await request('/api/me/password', 'POST', {
    currentPassword: 'admin123', newPassword: 'AnotherGoodPassword2026!', confirmPassword: 'AnotherGoodPassword2026!'
  });
  assert.equal(noSession.status, 401);

  const adminLogin = await request('/api/login', 'POST', { username: 'admin', password: 'admin123' });
  const ownerLogin = await request('/api/login', 'POST', { username: 'superadmin', password: 'admin123' });
  assert.equal(adminLogin.status, 200);
  assert.equal(ownerLogin.status, 200);
  const adminToken = adminLogin.body.token;
  const ownerToken = ownerLogin.body.token;

  const wrong = await request('/api/me/password', 'POST', {
    currentPassword: 'wrong', newPassword: 'GoodAdminPassword2026!', confirmPassword: 'GoodAdminPassword2026!'
  }, adminToken);
  assert.equal(wrong.status, 400);

  const changed = await request('/api/me/password', 'POST', {
    currentPassword: 'admin123', newPassword: 'GoodAdminPassword2026!', confirmPassword: 'GoodAdminPassword2026!'
  }, adminToken);
  assert.equal(changed.status, 200);
  assert.equal(changed.body.success, true);
  assert.equal((await request('/api/login', 'POST', { username: 'admin', password: 'admin123' })).status, 401);
  assert.equal((await request('/api/login', 'POST', { username: 'admin', password: 'GoodAdminPassword2026!' })).status, 200);
  // A company admin must not be able to change the platform owner's password.
  assert.equal((await request('/api/login', 'POST', { username: 'superadmin', password: 'admin123' })).status, 200);

  const ownerChanged = await request('/api/me/password', 'POST', {
    currentPassword: 'admin123', newPassword: 'GoodSuperAdminPassword2026!', confirmPassword: 'GoodSuperAdminPassword2026!'
  }, ownerToken);
  assert.equal(ownerChanged.status, 200);
  assert.equal((await request('/api/login', 'POST', { username: 'superadmin', password: 'admin123' })).status, 401);
  assert.equal((await request('/api/login', 'POST', { username: 'superadmin', password: 'GoodSuperAdminPassword2026!' })).status, 200);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'temo-bootstrap-test-'));
const strongSuper = 'CI-Only-Strong-Super-2026!';
const strongAdmin = 'CI-Only-Strong-Admin-2026!';
let nextPort = 36500 + (process.pid % 1300);
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function launch(database, overrides = {}) {
  const env = { ...process.env, NODE_ENV: 'production', DB_PATH: database, PORT: String(++nextPort) };
  delete env.TEMO_BOOTSTRAP_SUPERADMIN_PASSWORD;
  delete env.TEMO_BOOTSTRAP_COMPANY_ADMIN_PASSWORD;
  Object.assign(env, overrides);
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (part) => { stderr += part.toString(); });
  return { child, port: nextPort, errors: () => stderr };
}

async function waitForReady(proc) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (proc.child.exitCode !== null) throw new Error('Startup failed: ' + proc.errors());
    try {
      const response = await fetch('http://127.0.0.1:' + proc.port + '/readiness');
      if (response.ok && (await response.json()).ready) return;
    } catch (_) { /* startup not complete */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server timed out: ' + proc.errors());
}
async function login(proc, username, password) {
  return fetch('http://127.0.0.1:' + proc.port + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
}
async function stop(proc) {
  if (proc.child.exitCode !== null) return;
  proc.child.kill();
  await new Promise((resolve) => proc.child.once('exit', resolve));
}
async function failsStartup(proc, errorText) {
  const code = await Promise.race([
    new Promise((resolve) => proc.child.once('exit', resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Expected failed startup')), 12000))
  ]);
  assert.notEqual(code, 0);
  assert.match(proc.errors(), errorText);
}

test('production refuses first run without Super Admin credentials', async () => {
  await failsStartup(launch(path.join(dir, 'missing.db')), /Super Admin is not provisioned/);
});
test('production rejects known default bootstrap password', async () => {
  await failsStartup(launch(path.join(dir, 'weak.db'), { TEMO_BOOTSTRAP_SUPERADMIN_PASSWORD: 'admin123' }), /at least 16 characters/);
});
test('strong production bootstrap rejects default passwords and accepts configured ones', async () => {
  const proc = launch(path.join(dir, 'strong.db'), { TEMO_BOOTSTRAP_SUPERADMIN_PASSWORD: strongSuper, TEMO_BOOTSTRAP_COMPANY_ADMIN_PASSWORD: strongAdmin });
  try {
    await waitForReady(proc);
    assert.equal((await login(proc, 'superadmin', 'admin123')).status, 401);
    assert.equal((await login(proc, 'admin', 'admin123')).status, 401);
    assert.equal((await login(proc, 'superadmin', strongSuper)).status, 200);
    assert.equal((await login(proc, 'admin', strongAdmin)).status, 200);
  } finally { await stop(proc); }
});
test('legacy default passwords rotate on restart and stop working', async () => {
  const database = path.join(dir, 'legacy.db');
  const old = launch(database, { NODE_ENV: 'test', TEMO_BOOTSTRAP_SUPERADMIN_PASSWORD: 'admin123', TEMO_BOOTSTRAP_COMPANY_ADMIN_PASSWORD: 'admin123' });
  try { await waitForReady(old); assert.equal((await login(old, 'superadmin', 'admin123')).status, 200); } finally { await stop(old); }
  const secure = launch(database, { TEMO_BOOTSTRAP_SUPERADMIN_PASSWORD: strongSuper, TEMO_BOOTSTRAP_COMPANY_ADMIN_PASSWORD: strongAdmin });
  try {
    await waitForReady(secure);
    assert.equal((await login(secure, 'superadmin', 'admin123')).status, 401);
    assert.equal((await login(secure, 'admin', 'admin123')).status, 401);
    assert.equal((await login(secure, 'superadmin', strongSuper)).status, 200);
    assert.equal((await login(secure, 'admin', strongAdmin)).status, 200);
  } finally { await stop(secure); }
});

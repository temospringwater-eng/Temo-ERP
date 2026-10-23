const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const port = 34000 + (process.pid % 500);
const databasePath = path.join(os.tmpdir(), `temo-smoke-${process.pid}.db`);
let serverProcess;
let startupErrors = '';
function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
}
async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { return await request('/health'); } catch (_) { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error(`Server did not start: ${startupErrors.slice(0, 1200)}`);
}

test.before(async () => {
  serverProcess = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), DB_PATH: databasePath }, stdio: ['ignore', 'ignore', 'pipe'] });
  serverProcess.stderr.on('data', (chunk) => { startupErrors += chunk.toString(); });
  const health = await waitForServer();
  assert.equal(health.status, 200);
});
test.after(() => {
  serverProcess?.kill();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(databasePath + suffix); } catch (_) {}
  }
});

test('health, readiness, metrics and UI are served safely', async () => {
  const [health, readiness, metrics, ui] = await Promise.all([request('/health'), request('/readiness'), request('/metrics'), request('/')]);
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(readiness.body).ready, true);
  assert.match(metrics.body, /temo_requests_total/);
  assert.equal(ui.status, 200);
  assert.match(ui.body, /TEMO AQUAFLOW/);
});

test('report definitions require authentication', async () => {
  const response = await request('/api/report-definitions');
  assert.equal(response.status, 401);
});

'use strict';
// CI-only, ephemeral HTTPS staging QA. Binds its TLS reverse proxy to loopback,
// uses an isolated temporary SQLite database, random bootstrap credentials and
// a short-lived self-signed certificate trusted solely by this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');

function temporaryPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); });
  });
}
function requestTls(port, certificate, route, method = 'GET', body, token) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = https.request({
      hostname: '127.0.0.1', port, path: route, method, ca: certificate,
      rejectUnauthorized: true, timeout: 5000,
      headers: { ...(payload === null ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: 'Bearer ' + token } : {}) }
    }, res => {
      let result = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { result += chunk; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(result); } catch (_) { json = null; }
        resolve({ status: res.statusCode, result, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('TLS request timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function startTlsProxy(port, upstreamPort, key, cert) {
  return new Promise((resolve, reject) => {
    const server = https.createServer({ key, cert }, (req, res) => {
      const proxy = http.request({
        hostname: '127.0.0.1', port: upstreamPort, path: req.url,
        method: req.method,
        headers: { ...req.headers, host: '127.0.0.1:' + upstreamPort }
      }, upstream => { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res); });
      proxy.on('error', () => { res.writeHead(502); res.end('Upstream unavailable'); });
      req.pipe(proxy);
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
async function waitForReady(port) {
  for (let i = 0; i < 120; i++) {
    try {
      const body = await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:' + port + '/readiness', res => {
          let text = ''; res.on('data', chunk => text += chunk);
          res.on('end', () => resolve({ status: res.statusCode, text }));
        }).on('error', reject);
      });
      if (body.status === 200 && JSON.parse(body.text).ready) return;
    } catch (_) { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('ERP server readiness timeout');
}
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'temo-private-https-staging-'));
  const backendPort = await temporaryPort();
  const tlsPort = await temporaryPort();
  const superPassword = crypto.randomBytes(32).toString('base64url');
  const companyPassword = crypto.randomBytes(32).toString('base64url');
  let child = null, proxy = null;
  try {
    const key = path.join(dir, 'server.key');
    const cert = path.join(dir, 'server.crt');
    const openssl = spawnSync('openssl', [
      'req', '-x509', '-nodes', '-newkey', 'rsa:2048',
      '-keyout', key, '-out', cert, '-days', '1',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'
    ], { encoding: 'utf8' });
    assert.equal(openssl.status, 0, 'OpenSSL staging certificate setup failed');
    child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test', TEMO_ERP_HOSTED_QA: '1', DB_PATH: path.join(dir, 'staging-qa.db'),
        PORT: String(backendPort),
        TEMO_BOOTSTRAP_SUPERADMIN_PASSWORD: superPassword,
        TEMO_BOOTSTRAP_COMPANY_ADMIN_PASSWORD: companyPassword }
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 1500); });
    await waitForReady(backendPort);
    proxy = await startTlsProxy(tlsPort, backendPort, fs.readFileSync(key), fs.readFileSync(cert));
    const trust = fs.readFileSync(cert);
    const health = await requestTls(tlsPort, trust, '/health');
    assert.equal(health.status, 200);
    const readiness = await requestTls(tlsPort, trust, '/readiness');
    assert.equal(readiness.status, 200);
    assert.equal(readiness.json.ready, true);
    const ui = await requestTls(tlsPort, trust, '/');
    assert.equal(ui.status, 200);
    assert.match(ui.result, /TEMO AQUAFLOW/);
    const unauthorized = await requestTls(tlsPort, trust, '/api/companies');
    assert.equal(unauthorized.status, 401);
    const defaultLogin = await requestTls(tlsPort, trust, '/api/login', 'POST',
      { username: 'superadmin', password: 'admin123' });
    assert.equal(defaultLogin.status, 401);
    const authorized = await requestTls(tlsPort, trust, '/api/login', 'POST',
      { username: 'superadmin', password: superPassword });
    assert.equal(authorized.status, 200);
    assert.ok(authorized.json.token);
    const companies = await requestTls(tlsPort, trust, '/api/companies', 'GET', undefined, authorized.json.token);
    assert.equal(companies.status, 200);
    console.log('PASS: ephemeral private HTTPS staging — trusted TLS, health, readiness, UI, auth, privileged API, rejected default password');
    console.log('No public service, live data, permanent secrets or network endpoint created.');
  } finally {
    if (proxy) await new Promise(resolve => proxy.close(resolve));
    if (child && child.exitCode === null) {
      child.kill();
      await once(child, 'exit').catch(() => {});
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

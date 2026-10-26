'use strict';

// Opt-in, password-protected staging entry screen. Never enable for live ERP
// as a substitute for normal user authentication, TLS, or network isolation.
const crypto = require('node:crypto');

function createStagingGate(secret) {
  const expected = String(secret || '');
  if (expected.length < 24) throw new Error('TEMO_STAGING_GATE_SECRET must have 24+ characters');
  const cookieName = '__Host-temo_staging';
  const cookieValue = crypto.createHmac('sha256', expected).update('temo-staging-session-v1').digest('hex');
  const attempts = new Map();
  const retryWindowMs = 5 * 60 * 1000;
  const maxAttempts = 8;
  function equal(left, right) {
    const a = Buffer.from(String(left || ''), 'utf8');
    const b = Buffer.from(String(right || ''), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  function page(error = '') {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TEMO Driver — Private QA</title>
<style>body{font-family:system-ui,Arial;background:#f4f8fb;color:#123e58;
display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
main{background:white;padding:28px;max-width:400px;width:90%;border-radius:12px;
box-shadow:0 8px 32px #123e5820}h1{font-size:24px}
input,button{box-sizing:border-box;width:100%;padding:14px;margin:10px 0;
font:inherit;border-radius:8px}input{border:1px solid #a9b6c0}
button{background:#125577;color:white;border:0}
p{line-height:1.5}small{color:#65757b}</style></head><body><main>
<h1>TEMO ERP — Private Test</h1>
<p>Enter the private testing access code to open TEMO ERP.</p>
${error ? '<p role="alert">Invalid access code or too many attempts.</p>' : ''}
<form method="post" action="/__staging/unlock">
<label for="code">Access code</label>
<input id="code" name="code" type="password" autocomplete="off" minlength="1" required>
<button type="submit">Unlock testing server</button>
</form><small>Test environment only. Do not enter real customer data.</small>
</main></body></html>`;
  }
  function sendPage(res, status = 200, error = '') {
    return res.status(status).set({
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    }).send(page(error));
  }
  return (req, res, next) => {
    const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const parts = String(req.headers.cookie || '').split(';').map(x => x.trim());
    const cookie = parts.find(x => x.startsWith(cookieName + '='));
    if (cookie && equal(cookie.slice(cookieName.length + 1), cookieValue)) return next();
    if (req.path === '/__staging/unlock' && req.method === 'POST') {
      const entry = attempts.get(key) || { count: 0, start: Date.now() };
      if (Date.now() - entry.start > retryWindowMs) { entry.count = 0; entry.start = Date.now(); }
      if (entry.count >= maxAttempts) return sendPage(res, 429, 'rate-limited');
      const value = typeof req.body?.code === 'string' ? req.body.code : '';
      if (equal(value, expected)) {
        attempts.delete(key);
        res.set('Cache-Control', 'no-store');
        res.set('Set-Cookie', `${cookieName}=${cookieValue}; Max-Age=43200; Path=/; Secure; HttpOnly; SameSite=Strict`);
        return res.redirect(303, '/index.html');
      }
      entry.count += 1;
      attempts.set(key, entry);
      return sendPage(res, 403, 'bad-code');
    }
    if (req.path.startsWith('/api/')) return res.status(401).set('Cache-Control', 'no-store').json({ message: 'Private QA access code required.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(401).set('Cache-Control', 'no-store').send('Private QA access code required.');
    return sendPage(res);
  };
}

module.exports = { createStagingGate };

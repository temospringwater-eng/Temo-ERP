const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class LocalBackupProvider {
  constructor(rootDir) { this.rootDir = rootDir; }
  async put(key, payload) {
    fs.mkdirSync(this.rootDir, { recursive: true });
    const filePath = path.join(this.rootDir, key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, payload, { encoding: 'utf8', flag: 'wx' });
    return { provider: 'local', key, path: filePath };
  }
  async read(key) { return fs.readFileSync(path.join(this.rootDir, key), 'utf8'); }
}

class OffsiteBackupProvider {
  constructor() { this.name = 'offsite-unconfigured'; }
  async put() { throw new Error('Off-site backup provider is not configured. No external upload was attempted.'); }
  async read() { throw new Error('Off-site backup provider is not configured.'); }
}

const safeJson = (value) => { try { return JSON.parse(value); } catch (_) { return null; } };
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const redact = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => (/password|token|secret|api_key_hash/i.test(key) ? [key, '[redacted]'] : [key, value])));

function createService({ db, query, insert, update, writeAudit, rootDir }) {
  const providers = { local: new LocalBackupProvider(path.join(rootDir, 'backups')), offsite: new OffsiteBackupProvider() };
  const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) { if (error) reject(error); else resolve({ id: this.lastID, changes: this.changes }); }));

  async function initialize() {
    await run(`CREATE TABLE IF NOT EXISTS backup_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'tenant', provider TEXT NOT NULL DEFAULT 'local', schedule TEXT, retention_days INTEGER NOT NULL DEFAULT 30, enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    await run(`CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, job_id INTEGER, scope TEXT NOT NULL, provider TEXT NOT NULL, storage_key TEXT NOT NULL, checksum_sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'completed', validation_status TEXT NOT NULL DEFAULT 'pending', created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    await run(`CREATE TABLE IF NOT EXISTS security_api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, name TEXT NOT NULL, key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL DEFAULT '[]', expires_at TEXT, revoked_at TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_used_at TEXT)`);
    await run(`CREATE TABLE IF NOT EXISTS integration_adapters (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, endpoint TEXT, enabled INTEGER NOT NULL DEFAULT 0, configuration TEXT NOT NULL DEFAULT '{}', created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(company_id, name))`);
    await run(`CREATE TABLE IF NOT EXISTS integration_delivery_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, adapter_id INTEGER, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, response_code INTEGER, error_message TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(company_id, idempotency_key))`);
    await run(`CREATE TABLE IF NOT EXISTS api_request_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, user_id INTEGER, version TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, status_code INTEGER, request_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    const scheduler = setInterval(() => runScheduledJobs().catch((error) => console.error('Backup scheduler failed:', error.message)), 60000);
    scheduler.unref?.();
  }

  async function tableSnapshot(companyId, scope) {
    const tables = await query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const snapshot = { format: 'temo-aquaflow-backup', version: 1, scope, companyId: scope === 'full' ? null : companyId, generatedAt: new Date().toISOString(), tables: {} };
    for (const { name } of tables) {
      const columns = await query(`PRAGMA table_info(${JSON.stringify(name)})`);
      const hasCompany = columns.some((column) => column.name === 'company_id');
      const rows = await query(`SELECT * FROM "${name.replace(/"/g, '""')}"${scope === 'full' || !hasCompany ? '' : ' WHERE company_id = ?'}`, scope === 'full' || !hasCompany ? [] : [companyId]);
      snapshot.tables[name] = { columns: columns.map((column) => column.name), rowCount: rows.length, rows: rows.map(redact) };
    }
    return snapshot;
  }

  async function createBackup(req, options = {}) {
    const scope = options.scope || 'tenant';
    if (scope === 'full' && req.user.role !== 'super_admin') throw new Error('Only super administrators can create full backups.');
    const companyId = scope === 'full' ? null : req.companyId;
    if (!companyId && scope !== 'full') throw new Error('A tenant is required for this backup.');
    const provider = options.provider || 'local';
    if (!providers[provider]) throw new Error('Unsupported backup provider.');
    const payload = JSON.stringify(await tableSnapshot(companyId, scope));
    const checksum = hash(payload);
    const key = `${scope}/${new Date().toISOString().replace(/[:.]/g, '-')}-${checksum.slice(0, 12)}.json`;
    const stored = await providers[provider].put(key, payload);
    const created = await insert('INSERT INTO backups (company_id, job_id, scope, provider, storage_key, checksum_sha256, byte_size, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [companyId, options.jobId || null, scope, provider, key, checksum, Buffer.byteLength(payload), req.user.id]);
    await writeAudit(req, 'backup_created', 'backup', created.id, null, { scope, provider, checksum: checksum.slice(0, 12) });
    return { id: created.id, scope, provider, storageKey: stored.key, checksumSha256: checksum, byteSize: Buffer.byteLength(payload), status: 'completed' };
  }

  async function validateBackup(row) {
    const payload = await providers[row.provider].read(row.storage_key);
    const checksum = hash(payload);
    const metadata = safeJson(payload);
    const valid = checksum === row.checksum_sha256 && metadata?.format === 'temo-aquaflow-backup' && Number(metadata?.version) === 1;
    return { valid, checksumSha256: checksum, metadata: metadata ? { format: metadata.format, version: metadata.version, scope: metadata.scope, companyId: metadata.companyId, generatedAt: metadata.generatedAt, tables: Object.keys(metadata.tables || {}).length } : null };
  }

  function adminOrTenant(req, res, next) { if (['super_admin', 'company_admin', 'manager'].includes(req.user.role)) return next(); return res.status(403).json({ message: 'You do not have permission for this action.' }); }

  function scheduleDue(job) {
    if (!job.last_run_at) return true;
    const elapsed = Date.now() - new Date(`${job.last_run_at}Z`).getTime();
    const interval = job.schedule === 'hourly' ? 3600000 : job.schedule === 'weekly' ? 604800000 : 86400000;
    return elapsed >= interval;
  }

  async function runScheduledJobs() {
    const jobs = await query('SELECT * FROM backup_jobs WHERE enabled = 1');
    for (const job of jobs) {
      if (!scheduleDue(job)) continue;
      const owner = (await query('SELECT id, role, company_id FROM users WHERE id = ?', [job.created_by]))[0];
      if (!owner || (job.scope === 'full' && owner.role !== 'super_admin')) continue;
      const request = { user: owner, companyId: job.company_id };
      try {
        await createBackup(request, { scope: job.scope, provider: job.provider, jobId: job.id });
        await update('DELETE FROM backups WHERE job_id = ? AND created_at < datetime(\'now\', ?)', [job.id, `-${Math.max(1, Number(job.retention_days) || 30)} days`]);
        await update('UPDATE backup_jobs SET last_run_at = CURRENT_TIMESTAMP WHERE id = ?', [job.id]);
      } catch (error) {
        await update('UPDATE backup_jobs SET last_run_at = CURRENT_TIMESTAMP WHERE id = ?', [job.id]);
        console.error(`Scheduled backup ${job.id} was not completed: ${error.message}`);
      }
    }
  }

  function registerRoutes(app, requireAuth, requireRole) {
    app.use('/api/v1', (req, res, next) => { req.apiVersion = 'v1'; next(); });
    app.get('/api/v1/metadata', (req, res) => res.json({ name: 'TEMO AQUAFLOW API', version: 'v1', status: 'stable', authentication: ['session'], resources: ['backups', 'security', 'integrations'], generatedAt: new Date().toISOString() }));
    app.post('/api/backups', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => { try { const result = await createBackup(req, { scope: req.body?.scope === 'full' ? 'full' : 'tenant', provider: req.body?.provider || 'local' }); res.status(201).json(result); } catch (error) { res.status(error.message.includes('Only') ? 403 : 400).json({ message: error.message }); } });
    app.get('/api/backups', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => { try { const params = []; let sql = 'SELECT * FROM backups WHERE 1=1'; if (req.user.role !== 'super_admin') { sql += ' AND company_id = ?'; params.push(req.companyId); } sql += ' ORDER BY id DESC LIMIT 100'; res.json(await query(sql, params)); } catch (error) { res.status(500).json({ message: error.message }); } });
    app.post('/api/backups/:id/validate', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => { try { const row = (await query('SELECT * FROM backups WHERE id = ? AND (company_id = ? OR ? = 1)', [Number(req.params.id), req.companyId, req.user.role === 'super_admin' ? 1 : 0]))[0]; if (!row) return res.status(404).json({ message: 'Backup not found.' }); const result = await validateBackup(row); await update('UPDATE backups SET validation_status = ? WHERE id = ?', [result.valid ? 'valid' : 'invalid', row.id]); res.json({ ...result, restore: { mode: 'metadata-only', destructive: false, message: 'Automatic restore is disabled. Use a controlled, reviewed restore process.' } }); } catch (error) { res.status(400).json({ message: error.message }); } });
    app.post('/api/backup-jobs', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => { try { const body = req.body || {}; const scope = body.scope === 'full' ? 'full' : 'tenant'; if (scope === 'full' && req.user.role !== 'super_admin') return res.status(403).json({ message: 'Only super administrators can schedule full backups.' }); const created = await insert('INSERT INTO backup_jobs (company_id, name, scope, provider, schedule, retention_days, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [scope === 'full' ? null : req.companyId, String(body.name || 'Scheduled backup').slice(0, 120), scope, body.provider || 'local', body.schedule || 'daily', Math.min(3650, Math.max(1, Number(body.retentionDays) || 30)), req.user.id]); res.status(201).json((await query('SELECT * FROM backup_jobs WHERE id = ?', [created.id]))[0]); } catch (error) { res.status(400).json({ message: error.message }); } });
    app.get('/api/backup-jobs', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => { const rows = await query('SELECT * FROM backup_jobs WHERE company_id = ? OR (? = 1 AND company_id IS NULL) ORDER BY id DESC', [req.companyId, req.user.role === 'super_admin' ? 1 : 0]); res.json(rows); });
    app.get('/api/security/diagnostics', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => { const companyId = req.companyId; const [sessions, keys, audit] = await Promise.all([query('SELECT COUNT(*) AS count FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.company_id = ? AND datetime(s.expires_at) > datetime(\'now\')', [companyId]), query('SELECT COUNT(*) AS count FROM security_api_keys WHERE company_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)', [companyId]), query('SELECT COUNT(*) AS count FROM audit_logs WHERE company_id = ?', [companyId])]); res.json({ generatedAt: new Date().toISOString(), checks: [{ key: 'active_sessions', status: 'pass', count: sessions[0].count }, { key: 'active_api_keys', status: 'warning', count: keys[0].count }, { key: 'audit_logging', status: 'pass', count: audit[0].count }, { key: 'automatic_restore', status: 'disabled', count: 0 }] }); });
    app.get('/api/security/sessions', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => res.json(await query('SELECT substr(s.token, 1, 8) AS token_prefix, s.created_at, s.expires_at, u.id AS user_id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.company_id = ? ORDER BY s.created_at DESC LIMIT 200', [req.companyId])));
    app.delete('/api/security/sessions/:tokenPrefix', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => { const prefix = String(req.params.tokenPrefix || '').slice(0, 16); const result = await update('DELETE FROM sessions WHERE token LIKE ? AND user_id IN (SELECT id FROM users WHERE company_id = ?)', [`${prefix}%`, req.companyId]); await writeAudit(req, 'session_revoked', 'session', prefix, null, { changes: result.changes }); res.json({ success: true, changes: result.changes }); });
    app.post('/api/security/api-keys', requireRole('super_admin', 'company_admin'), async (req, res) => { const raw = `temo_${crypto.randomBytes(24).toString('hex')}`; const created = await insert('INSERT INTO security_api_keys (company_id, name, key_prefix, key_hash, scopes, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.companyId, String(req.body?.name || 'Integration key').slice(0, 100), raw.slice(0, 12), hash(raw), JSON.stringify(Array.isArray(req.body?.scopes) ? req.body.scopes.slice(0, 20) : []), req.body?.expiresAt || null, req.user.id]); await writeAudit(req, 'api_key_created', 'security_api_key', created.id, null, { prefix: raw.slice(0, 12) }); res.status(201).json({ id: created.id, name: req.body?.name || 'Integration key', key: raw, warning: 'Store this key now; it will not be shown again.' }); });
    app.get('/api/security/api-keys', requireRole('super_admin', 'company_admin'), async (req, res) => res.json((await query('SELECT id, name, key_prefix, scopes, expires_at, revoked_at, created_at, last_used_at FROM security_api_keys WHERE company_id = ? ORDER BY id DESC', [req.companyId])).map((row) => ({ ...row, scopes: safeJson(row.scopes) || [] }))));
    app.post('/api/security/api-keys/:id/revoke', requireRole('super_admin', 'company_admin'), async (req, res) => { await update('UPDATE security_api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]); await writeAudit(req, 'api_key_revoked', 'security_api_key', req.params.id, null, null); res.json({ success: true }); });
    app.get('/api/integrations', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => res.json((await query('SELECT id, name, kind, endpoint, enabled, created_at, updated_at FROM integration_adapters WHERE company_id = ? ORDER BY id DESC', [req.companyId]))));
    app.post('/api/integrations', requireRole('super_admin', 'company_admin'), async (req, res) => { const body = req.body || {}; if (!/^[A-Za-z0-9._-]{1,80}$/.test(String(body.kind || ''))) return res.status(400).json({ message: 'A valid adapter kind is required.' }); const created = await insert('INSERT INTO integration_adapters (company_id, name, kind, endpoint, enabled, configuration, created_by) VALUES (?, ?, ?, ?, 0, ?, ?)', [req.companyId, String(body.name || 'Adapter').slice(0, 100), body.kind, body.endpoint ? String(body.endpoint).slice(0, 500) : null, JSON.stringify(body.configuration && typeof body.configuration === 'object' ? { configured: true } : {}), req.user.id]); await writeAudit(req, 'integration_created', 'integration_adapter', created.id, null, { kind: body.kind }); res.status(201).json((await query('SELECT id, name, kind, endpoint, enabled, created_at FROM integration_adapters WHERE id = ?', [created.id]))[0]); });
    app.post('/api/integrations/:id/deliver', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => { const body = req.body || {}; const key = String(body.idempotencyKey || '').trim(); if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key)) return res.status(400).json({ message: 'A valid idempotencyKey is required.' }); const adapter = (await query('SELECT * FROM integration_adapters WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]; if (!adapter) return res.status(404).json({ message: 'Integration adapter not found.' }); const requestHash = hash(JSON.stringify(body.payload || {})); const existing = (await query('SELECT * FROM integration_delivery_logs WHERE company_id = ? AND idempotency_key = ?', [req.companyId, key]))[0]; if (existing) return res.status(200).json({ ...existing, idempotent: true }); const created = await insert('INSERT INTO integration_delivery_logs (company_id, adapter_id, idempotency_key, request_hash, status, error_message) VALUES (?, ?, ?, ?, \'blocked\', ?)', [req.companyId, adapter.id, key, requestHash, adapter.enabled ? 'Provider adapter is not implemented; no external request was sent.' : 'Adapter is disabled; no external request was sent.']); await writeAudit(req, 'integration_delivery_blocked', 'integration_delivery', created.id, null, { adapterId: adapter.id, idempotencyKey: key }); res.status(202).json({ id: created.id, status: 'blocked', attempts: 0, idempotent: false, message: 'Delivery recorded safely; no external integration was fabricated or called.' }); });
    app.post('/api/integrations/deliveries/:id/retry', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => { const log = (await query('SELECT * FROM integration_delivery_logs WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]; if (!log) return res.status(404).json({ message: 'Delivery log not found.' }); await update('UPDATE integration_delivery_logs SET attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?', ['Retry recorded; external provider remains unconfigured, so no request was sent.', log.id]); await writeAudit(req, 'integration_delivery_retry', 'integration_delivery', log.id, { attempts: log.attempts }, { attempts: log.attempts + 1 }); res.json({ id: log.id, status: 'blocked', attempts: log.attempts + 1, message: 'Retry recorded safely; no external request was sent.' }); });
  }
  return { initialize, registerRoutes, createBackup, providers };
}

module.exports = { createService, LocalBackupProvider, OffsiteBackupProvider };

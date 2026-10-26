'use strict';

const crypto = require('crypto');

const CHANNELS = ['in_app', 'email', 'whatsapp', 'sms'];
const MUTATION_ROLES = ['super_admin', 'company_admin', 'manager'];
const READ_ROLES = ['super_admin', 'company_admin', 'manager', 'accountant', 'sales_staff', 'inventory_staff', 'staff'];

function createService({ db, query, insert, update }) {
  const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) {
    if (error) return reject(error);
    resolve({ id: this.lastID, changes: this.changes });
  }));

  function initialize() {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS ai_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
        message TEXT NOT NULL, response TEXT NOT NULL DEFAULT '', provider_status TEXT NOT NULL DEFAULT 'not_configured',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(user_id) REFERENCES users(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS ai_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, conversation_id INTEGER, action_type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','executed','failed')),
        requested_by INTEGER NOT NULL, approved_by INTEGER, approved_at TEXT, executed_at TEXT, idempotency_key TEXT NOT NULL,
        result TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(company_id, idempotency_key),
        FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id),
        FOREIGN KEY(requested_by) REFERENCES users(id), FOREIGN KEY(approved_by) REFERENCES users(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS automation_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '',
        trigger_type TEXT NOT NULL, trigger_config TEXT NOT NULL DEFAULT '{}', action_type TEXT NOT NULL, action_config TEXT NOT NULL DEFAULT '{}',
        schedule TEXT, active INTEGER NOT NULL DEFAULT 1, created_by INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, name), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(created_by) REFERENCES users(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS automation_executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, rule_id INTEGER NOT NULL, idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('started','completed','skipped','failed')), input TEXT NOT NULL DEFAULT '{}', output TEXT,
        error TEXT, started_at TEXT DEFAULT CURRENT_TIMESTAMP, completed_at TEXT, UNIQUE(company_id, idempotency_key),
        FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(rule_id) REFERENCES automation_rules(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS notification_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL, channel TEXT NOT NULL,
        subject TEXT DEFAULT '', body TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_by INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, name, channel), CHECK(channel IN ('in_app','email','whatsapp','sms')), FOREIGN KEY(company_id) REFERENCES companies(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS notification_preferences (
        company_id INTEGER NOT NULL, user_id INTEGER NOT NULL, channel TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        quiet_start TEXT, quiet_end TEXT, timezone TEXT DEFAULT 'UTC', updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(company_id, user_id, channel), CHECK(channel IN ('in_app','email','whatsapp','sms')), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(user_id) REFERENCES users(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS notification_delivery_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER, channel TEXT NOT NULL,
        template_id INTEGER, status TEXT NOT NULL, provider TEXT, payload TEXT NOT NULL DEFAULT '{}', error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(template_id) REFERENCES notification_templates(id)
      )`);
      db.run('CREATE INDEX IF NOT EXISTS idx_ai_conversations_company ON ai_conversations(company_id, created_at DESC)');
      db.run('CREATE INDEX IF NOT EXISTS idx_automation_exec_company ON automation_executions(company_id, started_at DESC)');
    });
  }

  // A key alone is not a provider adapter. Only an explicitly registered adapter is configured.
  const providerStatus = () => process.env.AI_ASSISTANT_PROVIDER ? 'configured' : 'not_configured';
  const json = (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } };
  const validText = (value, max) => String(value == null ? '' : value).trim().slice(0, max);

  async function realDataInsights(companyId) {
    const tables = [
      ['products', 'SELECT COUNT(*) AS count, COALESCE(SUM(stock),0) AS stock FROM products WHERE company_id = ?'],
      ['customers', 'SELECT COUNT(*) AS count FROM customers WHERE company_id = ?'],
      ['orders', "SELECT COUNT(*) AS count FROM orders WHERE company_id = ? AND date(created_at) >= date('now','-30 day')"],
      ['complaints', "SELECT COUNT(*) AS count FROM complaints WHERE company_id = ? AND status NOT IN ('resolved','closed')"]
    ];
    const metrics = {};
    for (const [name, sql] of tables) { try { metrics[name] = (await query(sql, [companyId]))[0] || {}; } catch (_) { metrics[name] = {}; } }
    const insights = [];
    if (Number(metrics.products?.stock || 0) === 0 && Number(metrics.products?.count || 0) > 0) insights.push({ key: 'inventory_empty', severity: 'high', title: 'Inventory needs attention', detail: 'Recorded product stock is currently zero.' });
    if (Number(metrics.complaints?.count || 0) > 0) insights.push({ key: 'open_complaints', severity: 'medium', title: 'Open complaints require review', detail: `${metrics.complaints.count} unresolved complaint(s) are recorded.` });
    if (!insights.length) insights.push({ key: 'operational_snapshot', severity: 'info', title: 'Operational snapshot', detail: `${metrics.customers.count || 0} customer(s), ${metrics.orders.count || 0} order(s) in the last 30 days, and ${metrics.products.count || 0} product(s) are recorded.` });
    return { provider: providerStatus(), source: 'database', generatedAt: new Date().toISOString(), metrics, insights };
  }

  function routeGuard(req, res, roles) {
    if (!req.companyId) { res.status(400).json({ message: 'A company scope is required.' }); return false; }
    if (!roles.includes(req.user.role)) { res.status(403).json({ message: 'You do not have permission for this action.' }); return false; }
    return true;
  }

  function registerRoutes(app, requireAuth, requireRole) {
    app.get('/api/assistant/insights', requireAuth, (req, res) => {
      if (!routeGuard(req, res, READ_ROLES)) return;
      realDataInsights(req.companyId).then((data) => res.json(data)).catch((error) => res.status(500).json({ message: error.message }));
    });
    app.get('/api/assistant/conversations', requireAuth, async (req, res) => {
      if (!routeGuard(req, res, READ_ROLES)) return;
      res.json(await query('SELECT * FROM ai_conversations WHERE company_id = ? ORDER BY id DESC LIMIT 100', [req.companyId]));
    });
    app.post('/api/assistant/conversations', requireAuth, async (req, res) => {
      if (!routeGuard(req, res, READ_ROLES)) return;
      const message = validText(req.body?.message, 4000);
      if (!message) return res.status(400).json({ message: 'message is required.' });
      const data = await realDataInsights(req.companyId);
      const response = data.insights.map((item) => `${item.title}: ${item.detail}`).join(' ');
      const result = await insert('INSERT INTO ai_conversations (company_id, user_id, message, response, provider_status) VALUES (?, ?, ?, ?, ?)', [req.companyId, req.user.id, message, response, data.provider]);
      res.status(201).json({ id: result.id, message, response, provider: data.provider, source: 'database', insights: data.insights });
    });
    app.get('/api/assistant/actions', requireAuth, async (req, res) => {
      if (!routeGuard(req, res, READ_ROLES)) return;
      res.json((await query('SELECT * FROM ai_actions WHERE company_id = ? ORDER BY id DESC LIMIT 200', [req.companyId])).map((row) => ({ ...row, payload: json(row.payload, {}) })));
    });
    app.post('/api/assistant/actions', requireAuth, async (req, res) => {
      if (!routeGuard(req, res, READ_ROLES)) return;
      const actionType = validText(req.body?.actionType, 80); const idempotencyKey = validText(req.body?.idempotencyKey || crypto.randomUUID(), 160);
      if (!actionType) return res.status(400).json({ message: 'actionType is required.' });
      try {
        const result = await insert('INSERT INTO ai_actions (company_id, conversation_id, action_type, payload, requested_by, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, req.body?.conversationId || null, actionType, JSON.stringify(req.body?.payload || {}), req.user.id, idempotencyKey]);
        res.status(201).json(await query('SELECT * FROM ai_actions WHERE id = ?', [result.id]).then((rows) => rows[0]));
      } catch (error) { if (/UNIQUE/i.test(error.message)) return res.status(409).json({ message: 'An action with this idempotency key already exists.' }); res.status(500).json({ message: error.message }); }
    });
    app.post('/api/assistant/actions/:id/approve', requireAuth, async (req, res) => {
      if (!routeGuard(req, res, MUTATION_ROLES)) return;
      const action = (await query('SELECT * FROM ai_actions WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0];
      if (!action) return res.status(404).json({ message: 'Action not found.' });
      if (action.status !== 'pending') return res.status(409).json({ message: 'Only pending actions can be approved.' });
      await update("UPDATE ai_actions SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ? AND status = 'pending'", [req.user.id, action.id, req.companyId]);
      res.json((await query('SELECT * FROM ai_actions WHERE id = ?', [action.id]))[0]);
    });
    app.post('/api/assistant/actions/:id/reject', requireAuth, async (req, res) => {
      if (!routeGuard(req, res, MUTATION_ROLES)) return;
      const result = await update("UPDATE ai_actions SET status = 'rejected', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ? AND status = 'pending'", [req.user.id, Number(req.params.id), req.companyId]);
      if (!result.changes) return res.status(404).json({ message: 'Pending action not found.' });
      res.json((await query('SELECT * FROM ai_actions WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]);
    });
    app.post('/api/assistant/actions/:id/execute', requireAuth, async (req, res) => {
      if (!routeGuard(req, res, MUTATION_ROLES)) return;
      const action = (await query('SELECT * FROM ai_actions WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0];
      if (!action || action.status !== 'approved') return res.status(409).json({ message: 'Only approved actions can be executed.' });
      await update("UPDATE ai_actions SET status = 'executed', executed_at = CURRENT_TIMESTAMP, result = ? WHERE id = ? AND company_id = ? AND status = 'approved'", [JSON.stringify({ executed: true, mode: 'audited' }), action.id, req.companyId]);
      res.json((await query('SELECT * FROM ai_actions WHERE id = ?', [action.id]))[0]);
    });

    app.get('/api/automations/rules', requireAuth, async (req, res) => { if (!routeGuard(req, res, READ_ROLES)) return; res.json((await query('SELECT * FROM automation_rules WHERE company_id = ? ORDER BY id DESC', [req.companyId])).map((r) => ({ ...r, trigger_config: json(r.trigger_config, {}), action_config: json(r.action_config, {}) }))); });
    app.post('/api/automations/rules', requireAuth, async (req, res) => {
      if (!routeGuard(req, res, MUTATION_ROLES)) return;
      const name = validText(req.body?.name, 120), triggerType = validText(req.body?.triggerType, 60), actionType = validText(req.body?.actionType, 60);
      if (!name || !triggerType || !actionType) return res.status(400).json({ message: 'name, triggerType and actionType are required.' });
      try { const r = await insert('INSERT INTO automation_rules (company_id, name, description, trigger_type, trigger_config, action_type, action_config, schedule, active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, name, validText(req.body?.description, 1000), triggerType, JSON.stringify(req.body?.triggerConfig || {}), actionType, JSON.stringify(req.body?.actionConfig || {}), validText(req.body?.schedule, 120) || null, req.body?.active === false ? 0 : 1, req.user.id]); res.status(201).json((await query('SELECT * FROM automation_rules WHERE id = ?', [r.id]))[0]); } catch (error) { res.status(/UNIQUE/i.test(error.message) ? 409 : 500).json({ message: error.message }); }
    });
    app.patch('/api/automations/rules/:id', requireAuth, async (req, res) => { if (!routeGuard(req, res, MUTATION_ROLES)) return; const id = Number(req.params.id); const existing = (await query('SELECT * FROM automation_rules WHERE id = ? AND company_id = ?', [id, req.companyId]))[0]; if (!existing) return res.status(404).json({ message: 'Rule not found.' }); await update('UPDATE automation_rules SET name = ?, description = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [validText(req.body?.name || existing.name, 120), validText(req.body?.description == null ? existing.description : req.body.description, 1000), req.body?.active === undefined ? existing.active : (req.body.active ? 1 : 0), id, req.companyId]); res.json((await query('SELECT * FROM automation_rules WHERE id = ?', [id]))[0]); });
    app.get('/api/automations/executions', requireAuth, async (req, res) => { if (!routeGuard(req, res, READ_ROLES)) return; res.json(await query('SELECT * FROM automation_executions WHERE company_id = ? ORDER BY id DESC LIMIT 200', [req.companyId])); });
    // Event triggers use the same idempotent execution path and always create an approval-required action.
    app.post('/api/automations/trigger', requireAuth, async (req, res) => {
      if (!routeGuard(req, res, MUTATION_ROLES)) return;
      const triggerType = validText(req.body?.triggerType, 60); const eventKey = validText(req.body?.idempotencyKey || `${triggerType}:${new Date().toISOString()}`, 160);
      if (!triggerType) return res.status(400).json({ message: 'triggerType is required.' });
      const rules = await query('SELECT * FROM automation_rules WHERE company_id = ? AND trigger_type = ? AND active = 1', [req.companyId, triggerType]);
      const results = [];
      for (const rule of rules) {
        const key = `${rule.id}:${eventKey}`;
        try {
          const execution = await insert('INSERT INTO automation_executions (company_id, rule_id, idempotency_key, status, input) VALUES (?, ?, ?, ?, ?)', [req.companyId, rule.id, key, 'started', JSON.stringify(req.body?.input || {})]);
          const action = await insert('INSERT INTO ai_actions (company_id, action_type, payload, requested_by, idempotency_key) VALUES (?, ?, ?, ?, ?)', [req.companyId, rule.action_type, rule.action_config || '{}', req.user.id, `automation:${execution.id}`]);
          await update("UPDATE automation_executions SET status = 'completed', output = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?", [JSON.stringify({ action: 'approval_required', actionId: action.id }), execution.id]);
          results.push({ ruleId: rule.id, executionId: execution.id, actionId: action.id, status: 'completed' });
        } catch (error) { if (!/UNIQUE/i.test(error.message)) results.push({ ruleId: rule.id, status: 'failed', error: 'Execution failed.' }); }
      }
      res.status(201).json({ triggerType, matchedRules: rules.length, results });
    });
    app.post('/api/automations/rules/:id/run', requireAuth, async (req, res) => { if (!routeGuard(req, res, MUTATION_ROLES)) return; const id = Number(req.params.id); const rule = (await query('SELECT * FROM automation_rules WHERE id = ? AND company_id = ? AND active = 1', [id, req.companyId]))[0]; if (!rule) return res.status(404).json({ message: 'Active rule not found.' }); const key = validText(req.body?.idempotencyKey || `${id}:${new Date().toISOString().slice(0, 10)}`, 160); try { const e = await insert('INSERT INTO automation_executions (company_id, rule_id, idempotency_key, status, input) VALUES (?, ?, ?, ?, ?)', [req.companyId, id, key, 'started', JSON.stringify(req.body?.input || {})]); const action = await insert('INSERT INTO ai_actions (company_id, action_type, payload, requested_by, idempotency_key) VALUES (?, ?, ?, ?, ?)', [req.companyId, rule.action_type, rule.action_config || '{}', req.user.id, `automation:${e.id}`]); await update("UPDATE automation_executions SET status = 'completed', output = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?", [JSON.stringify({ action: 'approval_required', actionId: action.id, actionType: rule.action_type }), e.id]); res.status(201).json((await query('SELECT * FROM automation_executions WHERE id = ?', [e.id]))[0]); } catch (error) { if (/UNIQUE/i.test(error.message)) return res.status(409).json({ message: 'This automation execution was already processed.' }); res.status(500).json({ message: error.message }); } });

    app.get('/api/notifications/templates', requireAuth, async (req, res) => { if (!routeGuard(req, res, READ_ROLES)) return; res.json(await query('SELECT * FROM notification_templates WHERE company_id = ? ORDER BY id DESC', [req.companyId])); });
    app.post('/api/notifications/templates', requireAuth, async (req, res) => { if (!routeGuard(req, res, MUTATION_ROLES)) return; const name = validText(req.body?.name, 120), channel = validText(req.body?.channel, 20), body = validText(req.body?.body, 10000); if (!name || !CHANNELS.includes(channel) || !body) return res.status(400).json({ message: 'name, valid channel and body are required.' }); try { const r = await insert('INSERT INTO notification_templates (company_id, name, channel, subject, body, created_by) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, name, channel, validText(req.body?.subject, 200), body, req.user.id]); res.status(201).json((await query('SELECT * FROM notification_templates WHERE id = ?', [r.id]))[0]); } catch (error) { res.status(/UNIQUE/i.test(error.message) ? 409 : 500).json({ message: error.message }); } });
    app.get('/api/notifications/preferences', requireAuth, async (req, res) => { if (!routeGuard(req, res, READ_ROLES)) return; res.json(await query('SELECT * FROM notification_preferences WHERE company_id = ? AND user_id = ?', [req.companyId, req.user.id])); });
    app.put('/api/notifications/preferences', requireAuth, async (req, res) => { if (!routeGuard(req, res, READ_ROLES)) return; const channel = validText(req.body?.channel, 20); if (!CHANNELS.includes(channel)) return res.status(400).json({ message: 'Invalid notification channel.' }); await run('INSERT INTO notification_preferences (company_id, user_id, channel, enabled, quiet_start, quiet_end, timezone) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_id, user_id, channel) DO UPDATE SET enabled=excluded.enabled, quiet_start=excluded.quiet_start, quiet_end=excluded.quiet_end, timezone=excluded.timezone, updated_at=CURRENT_TIMESTAMP', [req.companyId, req.user.id, channel, req.body?.enabled === false ? 0 : 1, req.body?.quietStart || null, req.body?.quietEnd || null, validText(req.body?.timezone || 'UTC', 64)]); res.json((await query('SELECT * FROM notification_preferences WHERE company_id = ? AND user_id = ? AND channel = ?', [req.companyId, req.user.id, channel]))[0]); });
    app.get('/api/notifications/deliveries', requireAuth, async (req, res) => { if (!routeGuard(req, res, READ_ROLES)) return; res.json(await query('SELECT * FROM notification_delivery_logs WHERE company_id = ? ORDER BY id DESC LIMIT 200', [req.companyId])); });
    app.post('/api/notifications/send', requireAuth, async (req, res) => { if (!routeGuard(req, res, MUTATION_ROLES)) return; const channel = validText(req.body?.channel, 20); if (!CHANNELS.includes(channel)) return res.status(400).json({ message: 'Invalid notification channel.' }); const recipientId = Number(req.body?.userId || req.user.id); const recipient = (await query('SELECT id FROM users WHERE id = ? AND company_id = ? AND active = 1', [recipientId, req.companyId]))[0]; if (!recipient) return res.status(404).json({ message: 'Recipient is not part of this company.' }); const status = channel === 'in_app' ? 'sent' : 'provider_not_configured'; const provider = channel === 'in_app' ? 'sqlite' : null; let notificationId = null; if (channel === 'in_app') { const n = await insert('INSERT INTO notifications (company_id, user_id, type, title, message) VALUES (?, ?, ?, ?, ?)', [req.companyId, recipientId, 'assistant', validText(req.body?.title || 'Assistant notification', 200), validText(req.body?.message, 4000)]); notificationId = n.id; } const l = await insert('INSERT INTO notification_delivery_logs (company_id, user_id, channel, status, provider, payload, error) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.companyId, recipientId, channel, status, provider, JSON.stringify({ templateId: req.body?.templateId || null }), status === 'sent' ? null : 'No configured provider; no external send attempted.']); res.status(status === 'sent' ? 201 : 503).json({ status, notificationId, deliveryLogId: l.id, message: status === 'sent' ? 'In-app notification recorded.' : 'Notification provider is not configured; no message was sent.' }); });
  }

  return { initialize, registerRoutes, realDataInsights };
}

module.exports = { createService, CHANNELS };

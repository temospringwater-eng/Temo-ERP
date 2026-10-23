'use strict';

const crypto = require('crypto');

const READ_ROLES = ['super_admin', 'company_admin', 'manager', 'staff', 'sales_staff', 'inventory_staff', 'accountant'];
const MANAGE_ROLES = ['super_admin', 'company_admin', 'manager'];
const INTENTS = ['place_order', 'repeat_order', 'order_status', 'balance', 'invoice_payment', 'bottle_pickup', 'subscription_pause', 'subscription_resume', 'complaint_support', 'human_escalation', 'unknown'];

function createService({ db, query, insert, update, writeAudit }) {
  const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) {
    if (error) return reject(error);
    resolve({ id: this.lastID, changes: this.changes });
  }));

  function initialize() {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS whatsapp_configurations (
        company_id INTEGER PRIMARY KEY, provider TEXT NOT NULL DEFAULT 'not_configured', phone_number TEXT NOT NULL DEFAULT '',
        phone_number_id TEXT NOT NULL DEFAULT '', access_token TEXT NOT NULL DEFAULT '', webhook_secret TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 0, updated_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(updated_by) REFERENCES users(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS whatsapp_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, phone TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','escalated','closed')), last_intent TEXT NOT NULL DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(customer_id) REFERENCES customers(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, conversation_id INTEGER NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
        body TEXT NOT NULL, intent TEXT NOT NULL DEFAULT 'unknown', provider_message_id TEXT NOT NULL DEFAULT '', provider_status TEXT NOT NULL DEFAULT 'recorded', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(conversation_id) REFERENCES whatsapp_conversations(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS bottle_pickup_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0),
        status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','scheduled','completed','cancelled')), source TEXT NOT NULL DEFAULT 'whatsapp', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(customer_id) REFERENCES customers(id)
      )`);
      db.run('CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_company ON whatsapp_conversations(company_id, updated_at DESC)');
      db.run('CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation ON whatsapp_messages(company_id, conversation_id, created_at)');
      db.run('CREATE INDEX IF NOT EXISTS idx_bottle_pickups_company ON bottle_pickup_requests(company_id, status, created_at DESC)');
    });
  }

  const normalizePhone = (value) => String(value == null ? '' : value).replace(/[^0-9]/g, '').replace(/^00/, '');
  const text = (value, max = 4000) => String(value == null ? '' : value).trim().slice(0, max);
  const providerStatus = (config) => config && config.enabled && config.provider && config.provider !== 'not_configured' ? 'configured' : 'not_configured';
  const adapter = (config) => ({
    provider: config?.provider || 'not_configured',
    status: providerStatus(config),
    async sendMessage() { return { status: providerStatus(config), provider: config?.provider || 'not_configured', sent: false, message: providerStatus(config) === 'configured' ? 'Outbound adapter is registered but transport is not implemented.' : 'WhatsApp provider is not configured.' }; }
  });

  function detectIntent(message) {
    const value = String(message || '').toLowerCase();
    if (/human|agent|representative|person|call me|escalat/.test(value)) return 'human_escalation';
    if (/repeat|again|same order|last order/.test(value)) return 'repeat_order';
    if (/pause|stop.*subscription|suspend/.test(value)) return 'subscription_pause';
    if (/resume|restart.*subscription|reactivat/.test(value)) return 'subscription_resume';
    if (/complaint|complain|support|problem|issue|leak|late|damaged/.test(value)) return 'complaint_support';
    if (/pickup|pick up|collect|empty bottle|return bottle/.test(value)) return 'bottle_pickup';
    if (/invoice|payment|paid|receipt|bill/.test(value)) return 'invoice_payment';
    if (/balance|owe|outstanding|credit/.test(value)) return 'balance';
    if (/status|where.*order|delivery|track/.test(value)) return 'order_status';
    if (/order|buy|deliver|need/.test(value)) return 'place_order';
    return 'unknown';
  }

  function incoming(payload) {
    const body = payload || {};
    return { from: body.from || body.phone || body.sender?.phone, message: text(body.text || body.message || body.body), messageId: text(body.messageId || body.id, 160) };
  }

  function verifySignature(rawBody, signature, secret) {
    if (!secret) return false;
    const supplied = String(signature || '').replace(/^sha256=/, '');
    if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'));
  }

  async function customerByPhone(companyId, phone) {
    const normalized = normalizePhone(phone);
    if (normalized.length < 7) return null;
    const rows = await query(`SELECT id, name, phone, address, email FROM customers WHERE company_id = ? AND REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', ''), '(', '') LIKE ?`, [companyId, `%${normalized.slice(-10)}`]);
    return rows.length === 1 ? rows[0] : null;
  }

  async function lastOrder(companyId, customerId) {
    return (await query('SELECT * FROM orders WHERE company_id = ? AND customer_id = ? AND status != \'cancelled\' ORDER BY created_at DESC, id DESC LIMIT 1', [companyId, customerId]))[0] || null;
  }

  async function respondToIntent(companyId, customer, message) {
    const intent = detectIntent(message);
    if (intent === 'unknown') return { intent, response: 'Please specify an order, order status, balance, invoice/payment, bottle pickup, subscription, complaint, or human support request.' };
    if (intent === 'human_escalation') return { intent, response: 'Your request has been marked for human support. A team member can continue this conversation.' };
    if (intent === 'order_status') {
      const rows = await query(`SELECT o.id, o.status, o.total_amount, o.created_at, d.status AS delivery_status, d.scheduled_date FROM orders o LEFT JOIN deliveries d ON d.order_id = o.id AND d.company_id = o.company_id WHERE o.company_id = ? AND o.customer_id = ? ORDER BY o.created_at DESC LIMIT 3`, [companyId, customer.id]);
      return { intent, response: rows.length ? rows.map((r) => `Order #${r.id}: ${r.status}${r.delivery_status ? `, delivery ${r.delivery_status}` : ''}${r.scheduled_date ? `, scheduled ${r.scheduled_date}` : ''}.`).join(' ') : 'No recorded orders were found for this customer.', data: rows };
    }
    if (intent === 'balance') {
      const invoices = await query('SELECT COALESCE(SUM(total_amount),0) AS total FROM sales WHERE company_id = ? AND customer_id = ? AND status != \'cancelled\'', [companyId, customer.id]);
      const payments = await query("SELECT COALESCE(SUM(CASE WHEN direction = 'payment' THEN amount ELSE -amount END),0) AS total FROM payments WHERE company_id = ? AND customer_id = ?", [companyId, customer.id]);
      const outstanding = Math.max(0, Number(invoices[0]?.total || 0) - Number(payments[0]?.total || 0));
      return { intent, response: `Recorded outstanding balance: ${outstanding.toFixed(2)}.`, data: { invoiced: Number(invoices[0]?.total || 0), netPayments: Number(payments[0]?.total || 0), outstanding } };
    }
    if (intent === 'invoice_payment') {
      const rows = await query('SELECT id, invoice_number, total_amount, status, due_date, created_at FROM sales WHERE company_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT 5', [companyId, customer.id]);
      return { intent, response: rows.length ? rows.map((r) => `Invoice ${r.invoice_number || `#${r.id}`}: ${Number(r.total_amount || 0).toFixed(2)}, ${r.status}${r.due_date ? `, due ${r.due_date}` : ''}.`).join(' ') : 'No recorded invoices were found for this customer.', data: rows };
    }
    if (intent === 'bottle_pickup') {
      const match = String(message).match(/\b(\d{1,4})\b/); const quantity = match ? Number(match[1]) : 0;
      return quantity > 0 ? { intent, action: 'create_bottle_pickup', quantity, response: `Bottle pickup request for ${quantity} bottle(s) is ready for confirmation.` } : { intent, response: 'Please include the number of bottles to pick up, for example: pickup 4 bottles.' };
    }
    if (intent === 'subscription_pause' || intent === 'subscription_resume') {
      const status = intent === 'subscription_pause' ? 'paused' : 'active';
      const existing = (await query(`SELECT id, product_id, status, next_due_date FROM delivery_subscriptions WHERE company_id = ? AND customer_id = ? AND status ${status === 'paused' ? '= \'active\'' : '= \'paused\''} ORDER BY id LIMIT 1`, [companyId, customer.id]))[0];
      return existing ? { intent, action: 'update_subscription', subscriptionId: existing.id, status, response: `Subscription #${existing.id} is ready to be ${status === 'paused' ? 'paused' : 'resumed'} for confirmation.` } : { intent, response: `No ${status === 'paused' ? 'active' : 'paused'} subscription was found for this customer.` };
    }
    if (intent === 'repeat_order') {
      const order = await lastOrder(companyId, customer.id);
      return order ? { intent, action: 'repeat_order', orderId: order.id, response: `Repeat order for recorded order #${order.id} is ready for confirmation.` } : { intent, response: 'No previous order was found to repeat.' };
    }
    if (intent === 'complaint_support') return { intent, action: 'create_complaint', title: 'WhatsApp support request', description: text(message, 2000), response: 'Your support request is ready to be recorded.' };
    if (intent === 'place_order') {
      const match = String(message).match(/(?:order|buy|need|deliver)\s+(?:(\d{1,4})\s*(?:x|bottles?|units?)?\s+)?(.+?)(?:\s+(\d{1,4})\s*(?:x|bottles?|units?)?)?$/i);
      const quantity = Number(match?.[1] || match?.[3] || 0);
      const productName = text(match?.[2], 160).replace(/\bplease\b/ig, '').trim();
      if (!quantity || !productName) return { intent, response: 'Please provide the product name and quantity. No order has been created.' };
      const products = await query('SELECT id, name, sale_price, stock FROM products WHERE company_id = ? AND stock >= ? AND LOWER(name) LIKE LOWER(?) ORDER BY name LIMIT 2', [companyId, quantity, `%${productName}%`]);
      if (products.length !== 1) return { intent, response: products.length > 1 ? 'More than one recorded product matched. Please provide the exact product name.' : 'No in-stock recorded product matched that request. No order has been created.' };
      const product = products[0];
      return { intent, action: 'create_order', productId: product.id, productName: product.name, quantity, unitPrice: Number(product.sale_price || 0), response: `Order for ${quantity} × ${product.name} is ready for confirmation.` };
    }
    return { intent, response: `Your request was recorded as ${intent}.` };
  }

  async function executeAction(companyId, customer, result) {
    if (result.action === 'create_bottle_pickup') {
      const row = await insert('INSERT INTO bottle_pickup_requests (company_id, customer_id, quantity, source) VALUES (?, ?, ?, ?)', [companyId, customer.id, result.quantity, 'whatsapp']);
      return { ...result, response: `Bottle pickup request #${row.id} was recorded for ${result.quantity} bottle(s).`, actionId: row.id };
    }
    if (result.action === 'create_complaint') {
      const row = await insert('INSERT INTO complaints (company_id, customer_id, title, description, priority, created_by) VALUES (?, ?, ?, ?, ?, NULL)', [companyId, customer.id, result.title, result.description, 'normal']);
      return { ...result, response: `Support request #${row.id} was recorded for human follow-up.`, complaintId: row.id };
    }
    if (result.action === 'update_subscription') {
      await update('UPDATE delivery_subscriptions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ? AND customer_id = ?', [result.status, result.subscriptionId, companyId, customer.id]);
      return { ...result, response: `Subscription #${result.subscriptionId} is now ${result.status}.` };
    }
    if (result.action === 'create_order') {
      const total = Number((result.quantity * result.unitPrice).toFixed(2));
      const copy = await insert('INSERT INTO orders (company_id, customer_id, customer_name, delivery_address, notes, total_amount, created_by) VALUES (?, ?, ?, ?, ?, ?, NULL)', [companyId, customer.id, customer.name, customer.address || '', 'Created from WhatsApp', total]);
      await insert('INSERT INTO order_items (company_id, order_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?)', [companyId, copy.id, result.productId, result.quantity, result.unitPrice, total]);
      return { ...result, response: `Order #${copy.id} was created for ${result.quantity} × ${result.productName}.`, orderId: copy.id };
    }
    if (result.action === 'repeat_order') {
      const order = (await query('SELECT * FROM orders WHERE id = ? AND company_id = ? AND customer_id = ?', [result.orderId, companyId, customer.id]))[0];
      const items = await query('SELECT product_id, quantity, unit_price, total_price FROM order_items WHERE company_id = ? AND order_id = ?', [companyId, result.orderId]);
      if (!order || !items.length) return { ...result, response: 'The recorded order could not be repeated because its items are unavailable.' };
      const copy = await insert('INSERT INTO orders (company_id, customer_id, customer_name, delivery_address, notes, total_amount, created_by) VALUES (?, ?, ?, ?, ?, ?, NULL)', [companyId, customer.id, customer.name, order.delivery_address || customer.address || '', 'Repeated from WhatsApp order #' + order.id, order.total_amount]);
      for (const item of items) await insert('INSERT INTO order_items (company_id, order_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?)', [companyId, copy.id, item.product_id, item.quantity, item.unit_price, item.total_price]);
      return { ...result, response: `Repeat order #${copy.id} was created from recorded order #${order.id}.`, orderId: copy.id };
    }
    return result;
  }

  async function handleWebhook(companyId, req) {
    const config = (await query('SELECT * FROM whatsapp_configurations WHERE company_id = ?', [companyId]))[0];
    if (!config || !config.webhook_secret) return { status: 503, body: { code: 'provider_not_configured', message: 'WhatsApp provider is not configured.' } };
    const rawBody = JSON.stringify(req.body || {});
    if (!verifySignature(rawBody, req.headers['x-whatsapp-signature'], config.webhook_secret)) return { status: 401, body: { message: 'Invalid webhook signature.' } };
    const incomingMessage = incoming(req.body); const customer = await customerByPhone(companyId, incomingMessage.from);
    if (!customer) return { status: 404, body: { message: 'Customer could not be securely identified for this company.' } };
    if (!incomingMessage.message) return { status: 400, body: { message: 'A text message is required.' } };
    let conversation = (await query('SELECT * FROM whatsapp_conversations WHERE company_id = ? AND customer_id = ? AND status != \'closed\' ORDER BY id DESC LIMIT 1', [companyId, customer.id]))[0];
    if (!conversation) { const created = await insert('INSERT INTO whatsapp_conversations (company_id, customer_id, phone) VALUES (?, ?, ?)', [companyId, customer.id, normalizePhone(incomingMessage.from)]); conversation = { id: created.id, status: 'open' }; }
    const result = await insert('INSERT INTO whatsapp_messages (company_id, conversation_id, direction, body, intent, provider_message_id) VALUES (?, ?, \'inbound\', ?, ?, ?)', [companyId, conversation.id, incomingMessage.message, detectIntent(incomingMessage.message), incomingMessage.messageId]);
    let answer = await respondToIntent(companyId, customer, incomingMessage.message);
    if (answer.intent === 'human_escalation' || answer.intent === 'complaint_support') await update("UPDATE whatsapp_conversations SET status = 'escalated', last_intent = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?", [answer.intent, conversation.id, companyId]);
    else await update('UPDATE whatsapp_conversations SET last_intent = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [answer.intent, conversation.id, companyId]);
    if (answer.action && req.body?.confirm === true) answer = await executeAction(companyId, customer, answer);
    await insert('INSERT INTO whatsapp_messages (company_id, conversation_id, direction, body, intent, provider_status) VALUES (?, ?, \'outbound\', ?, ?, ?)', [companyId, conversation.id, answer.response, answer.intent, providerStatus(config)]);
    await insert('INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, new_value) VALUES (?, NULL, ?, ?, ?, ?)', [companyId, 'whatsapp_message', 'whatsapp_conversation', conversation.id, JSON.stringify({ intent: answer.intent, messageId: result.id })]);
    return { status: 200, body: { provider: config.provider, customer: { id: customer.id, name: customer.name }, conversationId: conversation.id, intent: answer.intent, response: answer.response, confirmationRequired: Boolean(answer.action && req.body?.confirm !== true), data: answer.data || null } };
  }

  function guard(req, res, roles) { if (!req.companyId) { res.status(400).json({ message: 'A company scope is required.' }); return false; } if (!roles.includes(req.user.role)) { res.status(403).json({ message: 'You do not have permission for this action.' }); return false; } return true; }

  function registerRoutes(app, requireAuth, requireRole) {
    app.get('/api/whatsapp/config', requireAuth, async (req, res) => { if (!guard(req, res, READ_ROLES)) return; const config = (await query('SELECT company_id, provider, phone_number, phone_number_id, enabled, updated_at FROM whatsapp_configurations WHERE company_id = ?', [req.companyId]))[0] || { company_id: req.companyId, provider: 'not_configured', phone_number: '', phone_number_id: '', enabled: 0 }; res.json({ ...config, status: providerStatus(config), supportedIntents: INTENTS }); });
    app.put('/api/whatsapp/config', requireAuth, async (req, res) => { if (!guard(req, res, MANAGE_ROLES)) return; const provider = text(req.body?.provider, 60) || 'not_configured'; const phoneNumber = text(req.body?.phoneNumber, 40); const secret = text(req.body?.webhookSecret, 200); if (provider !== 'not_configured' && (!phoneNumber || !secret)) return res.status(400).json({ message: 'phoneNumber and webhookSecret are required for a configured provider.' }); await run(`INSERT INTO whatsapp_configurations (company_id, provider, phone_number, phone_number_id, access_token, webhook_secret, enabled, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(company_id) DO UPDATE SET provider=excluded.provider, phone_number=excluded.phone_number, phone_number_id=excluded.phone_number_id, access_token=CASE WHEN excluded.access_token = '' THEN whatsapp_configurations.access_token ELSE excluded.access_token END, webhook_secret=CASE WHEN excluded.webhook_secret = '' THEN whatsapp_configurations.webhook_secret ELSE excluded.webhook_secret END, enabled=excluded.enabled, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`, [req.companyId, provider, phoneNumber, text(req.body?.phoneNumberId, 160), text(req.body?.accessToken, 500), secret, provider !== 'not_configured' && req.body?.enabled !== false ? 1 : 0, req.user.id]); await writeAudit(req, 'update', 'whatsapp_configuration', req.companyId, null, { provider, enabled: provider !== 'not_configured' }); const config = (await query('SELECT company_id, provider, phone_number, phone_number_id, enabled, updated_at FROM whatsapp_configurations WHERE company_id = ?', [req.companyId]))[0]; res.json({ ...config, status: providerStatus(config), supportedIntents: INTENTS }); });
    app.get('/api/whatsapp/conversations', requireAuth, async (req, res) => { if (!guard(req, res, READ_ROLES)) return; const rows = await query(`SELECT c.id, c.customer_id, cu.name AS customer_name, c.phone, c.status, c.last_intent, c.updated_at, (SELECT COUNT(*) FROM whatsapp_messages m WHERE m.conversation_id = c.id AND m.company_id = c.company_id) AS message_count FROM whatsapp_conversations c JOIN customers cu ON cu.id = c.customer_id AND cu.company_id = c.company_id WHERE c.company_id = ? ORDER BY c.updated_at DESC LIMIT 100`, [req.companyId]); res.json(rows); });
    app.get('/api/whatsapp/conversations/:id/messages', requireAuth, async (req, res) => { if (!guard(req, res, READ_ROLES)) return; const conversation = (await query('SELECT id FROM whatsapp_conversations WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]; if (!conversation) return res.status(404).json({ message: 'Conversation not found.' }); res.json(await query('SELECT id, direction, body, intent, provider_message_id, provider_status, created_at FROM whatsapp_messages WHERE conversation_id = ? AND company_id = ? ORDER BY created_at, id', [conversation.id, req.companyId])); });
    app.patch('/api/whatsapp/conversations/:id', requireAuth, async (req, res) => { if (!guard(req, res, MANAGE_ROLES)) return; const status = ['open','escalated','closed'].includes(req.body?.status) ? req.body.status : null; if (!status) return res.status(400).json({ message: 'status must be open, escalated, or closed.' }); const result = await update('UPDATE whatsapp_conversations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [status, Number(req.params.id), req.companyId]); if (!result.changes) return res.status(404).json({ message: 'Conversation not found.' }); await writeAudit(req, 'update', 'whatsapp_conversation', Number(req.params.id), null, { status }); res.json((await query('SELECT * FROM whatsapp_conversations WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]); });
    app.post('/api/whatsapp/send', requireAuth, async (req, res) => { if (!guard(req, res, MANAGE_ROLES)) return; const message = text(req.body?.message); if (!message) return res.status(400).json({ message: 'message is required; providers do not generate message content.' }); const config = (await query('SELECT * FROM whatsapp_configurations WHERE company_id = ?', [req.companyId]))[0]; const result = await adapter(config).sendMessage(req.body?.to, message); if (result.status !== 'configured') return res.status(503).json({ code: 'provider_not_configured', ...result }); res.json(result); });
    app.get('/api/analytics/delivery-heatmap', requireAuth, async (req, res) => { if (!guard(req, res, READ_ROLES)) return; const from = text(req.query?.from, 10); const to = text(req.query?.to, 10); const dateFilter = `${from ? ' AND d.created_at >= ?' : ''}${to ? ' AND d.created_at < date(?, \'+1 day\')' : ''}`; const params = [req.companyId, ...(from ? [from] : []), ...(to ? [to] : [])]; const rows = await query(`SELECT d.id AS delivery_id, d.status, d.created_at, c.id AS customer_id, c.name AS customer_name, c.latitude, c.longitude FROM deliveries d JOIN orders o ON o.id = d.order_id AND o.company_id = d.company_id JOIN customers c ON c.id = o.customer_id AND c.company_id = o.company_id WHERE d.company_id = ?${dateFilter}`, params); const valid = rows.filter((row) => Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude)) && Number(row.latitude) >= -90 && Number(row.latitude) <= 90 && Number(row.longitude) >= -180 && Number(row.longitude) <= 180); if (!valid.length) return res.json({ available: false, message: 'Delivery heatmap unavailable: no recorded delivery coordinates are available for this company and period.', source: 'customers.latitude/customers.longitude', totalDeliveries: rows.length, geocodedDeliveries: 0, points: [] }); const buckets = new Map(); valid.forEach((row) => { const latitude = Number(Number(row.latitude).toFixed(4)); const longitude = Number(Number(row.longitude).toFixed(4)); const key = `${latitude},${longitude}`; const bucket = buckets.get(key) || { latitude, longitude, intensity: 0, deliveries: [] }; bucket.intensity += 1; bucket.deliveries.push({ id: row.delivery_id, status: row.status, customerId: row.customer_id, customerName: row.customer_name }); buckets.set(key, bucket); }); res.json({ available: true, source: 'customers.latitude/customers.longitude', totalDeliveries: rows.length, geocodedDeliveries: valid.length, excludedDeliveries: rows.length - valid.length, points: [...buckets.values()] }); });
    app.post('/api/whatsapp/webhook/:companyId', async (req, res) => { const result = await handleWebhook(Number(req.params.companyId), req); res.status(result.status).json(result.body); });
  }

  return { initialize, registerRoutes, handleWebhook, detectIntent, normalizePhone };
}

module.exports = { createService, INTENTS };

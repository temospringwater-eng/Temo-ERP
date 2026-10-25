require("dotenv").config()
const OpenAI = require("openai");

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { ForecastingService, INSUFFICIENT_DATA_MESSAGE } = require('./services/forecasting-service');
const { calculateReorderInsight, INSUFFICIENT_HISTORY } = require('./services/reorder-service');
const { createService: createAiAutomationService } = require('./services/ai-automation-service');
const { createService: createPlatformOperationsService } = require('./services/platform-operations-service');
const { createService: createWhatsAppAssistantService } = require('./services/whatsapp-assistant-service');
const { createService: createFranchiseService } = require('./services/franchise-service');
const { createService: createSupplierProcurementService } = require('./services/supplier-procurement-service');
const { createNotificationDeliveryService } = require('./services/notification-delivery-service');
const { createDriverPasswordResetService } = require('./services/driver-password-reset-service');
const { getSubscriptionStatus, accessError } = require('./services/subscription-service');
const { NORMAL_FEATURES, ENTERPRISE_FEATURES, createFeatureAccessService } = require('./services/feature-access-service');

const {driverPermissionsSchema,driverPermissionAuditTriggers,createDriverPermissionRoutes} = require('./services/driver-permissions-service');
const {createDriverDeliveryPolicyRoutes} = require('./services/driver-delivery-policy-service');
const {createDriverCustomerOtpProvider} = require('./services/driver-customer-otp-provider');
const {qaSchema: driverAtomicQaSchema} = require('./services/driver-atomic-ledger-qa');
const {createAtomicDriverDeliveryHandler} = require('./services/driver-atomic-erp-bridge-qa');

const app = express();
const PORT = process.env.PORT || 3000;
const dbPath = process.env.DB_PATH || path.join(__dirname, 'hayrila.db');
const db = new sqlite3.Database(dbPath);
// Separate explicit TEST-only database; never enable for a live ERP database.
const driverAtomicQaEnabled=process.env.NODE_ENV==='test' &&
  process.env.TEMO_DRIVER_ATOMIC_QA_ENABLED==='true' &&
  Boolean(process.env.DB_PATH) &&
  path.resolve(dbPath)!==path.resolve(path.join(__dirname,'hayrila.db'));

// Metadata-first storage boundary: file bytes are handled by an external object-storage worker.
class DocumentStorageAdapter {
  constructor(provider = process.env.DOCUMENT_STORAGE_PROVIDER || 'external') { this.provider = provider; }
  createUploadDescriptor(companyId, documentId, versionId, filename) {
    const safeName = String(filename || 'document').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
    return { provider: this.provider, storageKey: `companies/${companyId}/documents/${documentId}/versions/${versionId}/${safeName}`, uploadUrl: null, method: 'PUT' };
  }
  getAccessDescriptor(version) { return { provider: version.storage_provider, storageKey: version.storage_key, downloadUrl: null, previewUrl: null }; }
}
const documentStorage = new DocumentStorageAdapter();

const SUPPORTED_LANGUAGES = ['en', 'ur', 'ar'];

app.use(express.json({ limit: '12mb' }));
if (process.env.TEMO_REQUIRE_STAGING_GATE === 'true' && !process.env.TEMO_STAGING_GATE_SECRET) {
  throw new Error('Private staging is locked: configure TEMO_STAGING_GATE_SECRET before starting.');
}
if (process.env.TEMO_STAGING_GATE_SECRET) {
  if (process.env.NODE_ENV !== 'production') throw new Error('Staging access gate requires NODE_ENV=production');
  app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: false, limit: '2kb' }));
  app.use(require('./services/staging-gate').createStagingGate(process.env.TEMO_STAGING_GATE_SECRET));
}
app.use(express.static(path.join(__dirname, 'public')));

const runtimeMetrics = { requests: 0, errors: 0, startedAt: Date.now(), durationsMs: 0 };
const MONITORED_ERROR_STATUSES = new Set([400, 401, 403, 404, 409, 429, 500, 502, 503]);
app.use((req, res, next) => {
  const started = Date.now();
  runtimeMetrics.requests += 1;
  res.on('finish', () => {
    const duration = Date.now() - started;
    runtimeMetrics.durationsMs += duration;
    if (res.statusCode >= 500) runtimeMetrics.errors += 1;
    if (MONITORED_ERROR_STATUSES.has(res.statusCode) && typeof insert === 'function') {
      const pathName = String(req.path || '').slice(0, 200);
      insert('INSERT INTO error_events (company_id, user_id, level, status_code, method, path, message) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.companyId || null, req.user?.id || null, res.statusCode >= 500 ? 'error' : 'warning', res.statusCode, req.method, pathName, `HTTP ${res.statusCode}`]).then(() => update('DELETE FROM error_events WHERE id NOT IN (SELECT id FROM error_events ORDER BY id DESC LIMIT 1000)')).catch(() => {});
    }
  });

  next();
});

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedHash] = String(storedHash || '').split(':');
  if (!salt || !expectedHash) return false;
  const actualHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

// Bootstrap credentials must be supplied out-of-band; never seed public default passwords.
function readBootstrapPassword(name) {
  const password = String(process.env[name] || '');
  if (!password) return null;
  if (process.env.NODE_ENV !== 'test' && (password.length < 16 || password === 'admin123')) {
    throw new Error(`${name} must contain at least 16 characters and cannot be a known default.`);
  }
  return password;
}

const bootstrapSuperAdminPassword = readBootstrapPassword('TEMO_BOOTSTRAP_SUPERADMIN_PASSWORD');
const bootstrapCompanyAdminPassword = readBootstrapPassword('TEMO_BOOTSTRAP_COMPANY_ADMIN_PASSWORD');
if (process.env.NODE_ENV !== 'test' && bootstrapSuperAdminPassword && bootstrapSuperAdminPassword === bootstrapCompanyAdminPassword) {
  throw new Error('Bootstrap super admin and company admin passwords must be different.');
}

// Migrate known credentials only when an explicit secure replacement is provided.
// Without one, refuse to expose an existing weak admin account over HTTP.
async function ensureSecureAdminBootstrap() {
  const admins = await query(`SELECT id, username, role, password_hash FROM users
    WHERE username IN ('superadmin', 'admin')`);
  if (!admins.some((user) => user.username === 'superadmin' && user.role === 'super_admin')) {
    throw new Error('Super Admin is not provisioned. Configure TEMO_BOOTSTRAP_SUPERADMIN_PASSWORD for first run.');
  }
  for (const user of admins) {
    // 'admin123' is referenced solely to identify and revoke legacy seeded credentials.
    if (!verifyPassword('admin123', user.password_hash)) continue;
    const replacement = user.username === 'superadmin'
      ? bootstrapSuperAdminPassword : bootstrapCompanyAdminPassword;
    if (!replacement) {
      throw new Error(`Unsafe legacy credentials detected for ${user.username}; configure the corresponding TEMO_BOOTSTRAP_*_PASSWORD before starting.`);
    }
    if (process.env.NODE_ENV === 'test' && replacement === 'admin123') continue;
    await update('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?',
      [hashPassword(replacement), user.role === 'super_admin' ? 0 : 1, user.id]);
    await update('DELETE FROM sessions WHERE user_id = ?', [user.id]);
  }
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  return insert('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime("now", "+7 days"))', [token, userId])
    .then(() => token);
}

function runDatabase(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) return reject(error);
      resolve({ changes: this.changes, id: this.lastID });
    });
  });
}

app.post('/api/login', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    const identifier = String(username || email || '').trim().toLowerCase();
    const users = await query(`
      SELECT u.id, u.username, u.email, u.password_hash, u.name, u.role, u.company_id, u.must_change_password,
              u.language, u.status AS user_status, c.name AS company_name, c.logo AS company_logo, c.default_language,
              c.status AS company_status
      FROM users u
      LEFT JOIN companies c ON c.id = u.company_id
      WHERE (LOWER(u.username) = ? OR LOWER(u.email) = ?) AND u.active = 1
    `, [identifier, identifier]);
    const user = users[0];

    if (!user || user.user_status !== 'active' || (user.company_id && user.company_status !== 'active') || !verifyPassword(password, user.password_hash) || (user.company_id && user.company_name === null)) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    if (user.company_id) {
      const subscription = await getCompanySubscription(user.company_id);
    }

    const token = await createSession(user.id);
    await update('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email || '',
        role: user.role,
        companyId: user.company_id,
        companyName: user.company_name || 'Platform Administration',
        companyLogo: user.company_logo || '',
        language: user.language || user.default_language || 'en',
        mustChangePassword: Boolean(user.must_change_password)
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/customer/login', async (req, res) => {
  try {
    const identifier = String(req.body?.email || req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!identifier || password.length < 1) return res.status(400).json({ message: 'Email or username and password are required.' });
    const rows = await query(`SELECT u.id, u.username, u.email, u.password_hash, u.name, u.role, u.customer_id, u.company_id,
      c.name AS company_name, c.address AS company_address, cu.name AS customer_name
      FROM users u LEFT JOIN companies c ON c.id = u.company_id AND c.active = 1
      LEFT JOIN customers cu ON cu.id = u.customer_id AND cu.company_id = u.company_id
      WHERE (LOWER(u.email) = ? OR LOWER(u.username) = ?) AND u.role = 'customer' AND u.active = 1`, [identifier, identifier]);
    const user = rows[0];
    if (!user || !user.customer_id || !user.company_id || !user.customer_name || !verifyPassword(password, user.password_hash)) return res.status(401).json({ message: 'Invalid customer credentials.' });
    const token = await createSession(user.id);
    await update('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    res.json({ success: true, token, user: { id: user.id, customerId: user.customer_id, name: user.customer_name || user.name, email: user.email, companyId: user.company_id, companyName: user.company_name, companyAddress: user.company_address } });
  } catch (error) { res.status(500).json({ message: 'Unable to sign in right now.' }); }
});

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

app.post('/api/logout', async (req, res) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.headers['x-session-token'];
    if (token) await update('DELETE FROM sessions WHERE token = ?', [token]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

function insert(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID });
    });
  });
}

function update(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ changes: this.changes });
    });
  });
}

const aiAutomationService = createAiAutomationService({ db, query, insert, update });
aiAutomationService.initialize();
const whatsappAssistantService = createWhatsAppAssistantService({ db, query, insert, update, writeAudit });
whatsappAssistantService.initialize();
const notificationDeliveryService = createNotificationDeliveryService({ query, insert, update });
const issueCustomerDeliveryOtp = createDriverCustomerOtpProvider({
  query,insert,update,writeAudit,sendEmail: params => notificationDeliveryService.sendEmail(params)
});
const atomicDriverDeliveryQaHandler=createAtomicDriverDeliveryHandler({
  sqlite3,dbPath,query,qaEnabled:driverAtomicQaEnabled
});
const driverPasswordResetService = createDriverPasswordResetService({
  query, insert, update, hashPassword,
  sendEmail: (opts) => notificationDeliveryService.sendEmail(opts)
});
const platformOperationsService = createPlatformOperationsService({ db, query, insert, update, writeAudit: (...args) => writeAudit(...args), rootDir: __dirname });
platformOperationsService.initialize().catch((error) => console.error('Platform operations initialization failed:', error.message));
const franchiseService = createFranchiseService({ db, query, insert, update, writeAudit });
const featureAccessService = createFeatureAccessService({ query });
setTimeout(() => generateSubscriptionReminders().catch((error) => console.warn('Subscription reminder generation skipped:', error.message)), 1000);
setInterval(() => generateSubscriptionReminders().catch((error) => console.warn('Subscription reminder generation skipped:', error.message)), 6 * 60 * 60 * 1000).unref();

function getCompanySubscription(companyId) {
  return query(`
    SELECT s.*, p.name AS plan_name, p.slug AS plan_slug, p.max_users, p.max_customers, p.max_products, p.max_monthly_orders, p.limits, p.features
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.company_id = ? ORDER BY s.id DESC LIMIT 1
  `, [companyId]).then((rows) => rows[0] || null);
}

async function createSubscriptionNotification(companyId, type, title, message) {
  const notification = await insert('INSERT INTO notifications (company_id, user_id, type, title, message) VALUES (?, NULL, ?, ?, ?)', [companyId, type, title, message]);
  await insert('INSERT INTO notification_deliveries (company_id, notification_id, channel, status, provider_state, sent_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)', [companyId, notification.id, 'in_app', 'sent', 'accepted']);
  const recipients = await query("SELECT email, phone FROM users WHERE company_id = ? AND active = 1 AND role IN ('company_admin','super_admin')", [companyId]);
  for (const recipient of recipients) {
    if (recipient.email) {
      const result = await notificationDeliveryService.sendEmail({ recipient: recipient.email, type, variables: { message } });
      await notificationDeliveryService.recordDelivery({ companyId, notificationId: notification.id, channel: 'email', recipient: recipient.email, result });
    }
    if (recipient.phone) {
      const result = await notificationDeliveryService.sendWhatsAppNotification({ phone: recipient.phone, type, variables: {} });
      await notificationDeliveryService.recordDelivery({ companyId, notificationId: notification.id, channel: 'whatsapp', recipient: recipient.phone, result });
    }
  }
  return notification.id;
}

async function generateSubscriptionReminders() {
  const rows = await query(`SELECT s.id AS subscription_id, s.company_id, s.end_date, s.status, s.payment_status, p.name AS plan_name, c.name AS company_name
    FROM subscriptions s JOIN companies c ON c.id = s.company_id JOIN plans p ON p.id = s.plan_id
    WHERE c.active = 1 AND s.status IN ('active','trial','expired')`);
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  for (const row of rows) {
    const expiry = new Date(`${row.end_date}T00:00:00Z`);
    const days = Math.ceil((expiry - new Date(`${todayIso}T00:00:00Z`)) / 86400000);
    const reminderType = [30, 15, 7, 3, 1, 0].includes(days) ? `${row.status === 'trial' ? 'trial' : 'expiry'}_${days}` : days < 0 ? 'subscription_expired' : null;
    if (reminderType) {
      const claim = await runDatabase('INSERT OR IGNORE INTO subscription_reminders (company_id, subscription_id, reminder_type, reminder_date) VALUES (?, ?, ?, ?)', [row.company_id, row.subscription_id, reminderType, todayIso]);
      if (claim.changes) {
        const title = days < 0 ? 'Subscription expired' : days === 0 ? 'Subscription expires today' : `${row.plan_name} subscription expires in ${days} days`;
        const message = days < 0 ? 'Your subscription has expired. Please renew to restore protected ERP access.' : days === 0 ? 'Your subscription expires today. Please renew to avoid service interruption.' : `Your ${row.plan_name} subscription expires on ${row.end_date}. Please renew to avoid service interruption.`;
        const notificationId = await createSubscriptionNotification(row.company_id, 'subscription_expiring', title, message);
        await update('UPDATE subscription_reminders SET notification_id = ? WHERE id = ?', [notificationId, claim.id]);
      }
    }
    if (row.payment_status && ['pending', 'overdue', 'partially_paid'].includes(row.payment_status)) {
      const dueType = 'payment_due';
      const dueClaim = await runDatabase('INSERT OR IGNORE INTO subscription_reminders (company_id, subscription_id, reminder_type, reminder_date) VALUES (?, ?, ?, ?)', [row.company_id, row.subscription_id, dueType, todayIso]);
      if (dueClaim.changes) {
        const dueNotification = await createSubscriptionNotification(row.company_id, dueType, 'Subscription payment due', 'A subscription payment is due. Please review your billing page.');
        await update('UPDATE subscription_reminders SET notification_id = ? WHERE id = ?', [dueNotification, dueClaim.id]);
      }
    }
  }
}

function isSubscriptionUsable(subscription) {
  if (!subscription || !['active', 'trial'].includes(subscription.status)) return false;
  return new Date(`${subscription.end_date}T23:59:59`) >= new Date();
}

function subscriptionMessage(subscription) {
  if (!subscription) return 'Subscription is not configured.';
  if (new Date(`${subscription.end_date}T23:59:59`) < new Date()) return 'Subscription has expired. Please renew it to continue.';
  return `Subscription is ${subscription.status}. Please contact your administrator.`;
}

const USAGE_METRICS = { users: 'users', customers: 'customers', products: 'products', monthly_orders: 'monthly_orders', storage_mb: 'storage_mb' };
function currentUsagePeriod() { return new Date().toISOString().slice(0, 7); }
function safeTheme(input) {
  const value = input && typeof input === 'object' ? input : {};
  const hex = (v, fallback) => /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : fallback;
  return { primary: hex(value.primary, '#0a3a5c'), accent: hex(value.accent, '#7fdce6'), background: hex(value.background, '#f4fbfd'), text: hex(value.text, '#0a3a5c') };
}
function safeDomain(value, field = 'domain') {
  const domain = String(value || '').trim().toLowerCase();
  if (!domain) return '';
  if (domain.length > 253 || !/^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$/.test(domain)) throw new Error(`Invalid ${field}.`);
  return domain;
}
async function getCompanyUsage(companyId) {
  const period = currentUsagePeriod();
  const counts = await query(`SELECT 'users' AS metric, COUNT(*) AS used FROM users WHERE company_id = ? AND active = 1
    UNION ALL SELECT 'customers', COUNT(*) FROM customers WHERE company_id = ?
    UNION ALL SELECT 'products', COUNT(*) FROM products WHERE company_id = ?
    UNION ALL SELECT 'monthly_orders', COUNT(*) FROM orders WHERE company_id = ? AND created_at >= date('now', 'start of month')`, [companyId, companyId, companyId, companyId]);
  return Object.fromEntries(counts.map((row) => [row.metric, { used: Number(row.used || 0), period }]));
}
async function getPlanLimits(companyId) {
  const subscription = await getCompanySubscription(companyId);
  let limits = { users: 5, customers: 1000, products: 500, monthly_orders: 10000 };
  if (subscription) {
    try { limits = { ...limits, ...(JSON.parse(subscription.limits || '{}')) }; } catch (_) {}
    limits.users = Number(subscription.max_users || limits.users);
    limits.customers = Number(subscription.max_customers || limits.customers);
    limits.products = Number(subscription.max_products || limits.products);
    limits.monthly_orders = Number(subscription.max_monthly_orders || limits.monthly_orders);
  }
  return { subscription, limits };
}
async function enforceUsageLimit(req, metric, increment = 1) {
  if (!req.companyId || req.user?.role === 'super_admin') return;
  const { limits } = await getPlanLimits(req.companyId);
  const usage = await getCompanyUsage(req.companyId);
  const limit = Number(limits[metric]);
  if (Number.isFinite(limit) && limit >= 0 && Number(usage[metric]?.used || 0) + increment > limit) {
    const error = new Error(`Your plan limit for ${metric.replace('_', ' ')} has been reached.`); error.statusCode = 429; error.code = 'plan_limit_reached'; throw error;
  }
}

function ensureColumn(table, column, definition) {
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, () => {});
}

function initializeDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        logo TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        email TEXT DEFAULT '',
        address TEXT DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        default_language TEXT NOT NULL DEFAULT 'en',
        date_format TEXT NOT NULL DEFAULT 'YYYY-MM-DD',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER,
        username TEXT NOT NULL UNIQUE,
        email TEXT DEFAULT '',
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'staff',
        customer_id INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        language TEXT NOT NULL DEFAULT 'en',
        last_login TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id)
      )
    `);

    db.run(driverPermissionsSchema);

    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        price REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'PKR',
        duration_months INTEGER NOT NULL DEFAULT 1,
        max_users INTEGER NOT NULL DEFAULT 5,
        max_storage_mb INTEGER NOT NULL DEFAULT 1024,
        features TEXT NOT NULL DEFAULT '{}',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        plan_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'trial',
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        payment_status TEXT NOT NULL DEFAULT 'pending',
        renewal_date TEXT,
        activated_at TEXT,
        deactivated_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (plan_id) REFERENCES plans(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feature_key TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS plan_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER NOT NULL,
        feature_id INTEGER NOT NULL,
        is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
        UNIQUE(plan_id, feature_id),
        FOREIGN KEY (plan_id) REFERENCES plans(id),
        FOREIGN KEY (feature_id) REFERENCES features(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS company_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        feature_id INTEGER NOT NULL,
        is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, feature_id),
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (feature_id) REFERENCES features(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_plan_features_plan ON plan_features(plan_id, feature_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_company_features_company ON company_features(company_id, feature_id)');

    db.run(`
      CREATE TABLE IF NOT EXISTS subscription_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        subscription_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'PKR',
        payment_method TEXT NOT NULL DEFAULT 'manual',
        transaction_reference TEXT DEFAULT '',
        payment_status TEXT NOT NULL DEFAULT 'pending',
        payment_date TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS subscription_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        subscription_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        previous_value TEXT,
        new_value TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS driver_password_reset_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        used_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER,
        user_id INTEGER,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        read_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS company_currency_settings (
        company_id INTEGER PRIMARY KEY,
        base_currency TEXT NOT NULL DEFAULT 'PKR',
        display_currency TEXT NOT NULL DEFAULT 'PKR',
        supported_currencies TEXT NOT NULL DEFAULT '["PKR"]',
        rounding_scale INTEGER NOT NULL DEFAULT 2 CHECK(rounding_scale BETWEEN 0 AND 6),
        updated_by INTEGER,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (updated_by) REFERENCES users(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS exchange_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        base_currency TEXT NOT NULL,
        quote_currency TEXT NOT NULL,
        rate REAL NOT NULL CHECK(rate > 0),
        source TEXT NOT NULL DEFAULT 'manual',
        provider_state TEXT NOT NULL DEFAULT 'configured' CHECK(provider_state IN ('configured','pending','unavailable','failed')),
        effective_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, base_currency, quote_currency, effective_at),
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_exchange_rates_company_pair ON exchange_rates(company_id, base_currency, quote_currency, effective_at DESC)');
    db.run(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        company_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        notification_type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
        channels TEXT NOT NULL DEFAULT '["in_app"]',
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(company_id, user_id, notification_type),
        FOREIGN KEY(company_id) REFERENCES companies(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS notification_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        notification_type TEXT NOT NULL,
        name TEXT NOT NULL,
        title_template TEXT NOT NULL,
        message_template TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, notification_type, name),
        FOREIGN KEY(company_id) REFERENCES companies(id),
        FOREIGN KEY(created_by) REFERENCES users(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        notification_id INTEGER NOT NULL,
        channel TEXT NOT NULL DEFAULT 'in_app',
        provider TEXT NOT NULL DEFAULT 'internal',
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','delivered','failed','unavailable')),
        provider_state TEXT NOT NULL DEFAULT 'pending' CHECK(provider_state IN ('pending','accepted','delivered','failed','unavailable')),
        attempts INTEGER NOT NULL DEFAULT 0,
        provider_message_id TEXT,
        error_message TEXT,
        sent_at TEXT,
        delivered_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(company_id) REFERENCES companies(id),
        FOREIGN KEY(notification_id) REFERENCES notifications(id) ON DELETE CASCADE
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_notification_deliveries_company ON notification_deliveries(company_id, status, created_at DESC)');
    db.run(`CREATE TABLE IF NOT EXISTS subscription_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      subscription_id INTEGER NOT NULL,
      reminder_type TEXT NOT NULL,
      reminder_date TEXT NOT NULL,
      notification_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, subscription_id, reminder_type, reminder_date)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS subscription_renewal_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      subscription_id INTEGER NOT NULL,
      requested_by INTEGER NOT NULL,
      requested_period TEXT NOT NULL,
      requested_days INTEGER,
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS subscription_payment_proofs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      subscription_id INTEGER NOT NULL,
      uploaded_by INTEGER NOT NULL,
      original_name TEXT NOT NULL,
      storage_name TEXT NOT NULL UNIQUE,
      content_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted',
      review_note TEXT DEFAULT '',
      reviewed_by INTEGER,
      reviewed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(company_id) REFERENCES companies(id),
      FOREIGN KEY(subscription_id) REFERENCES subscriptions(id),
      FOREIGN KEY(uploaded_by) REFERENCES users(id),
      FOREIGN KEY(reviewed_by) REFERENCES users(id)
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_subscription_payment_proofs_company ON subscription_payment_proofs(company_id, status, created_at DESC)');

    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT,
        purchase_price REAL NOT NULL,
        sale_price REAL NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS complaints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        customer_id INTEGER,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','in_progress','resolved','closed')),
        assigned_to INTEGER,
        notes TEXT NOT NULL DEFAULT '',
        resolution TEXT NOT NULL DEFAULT '',
        created_by INTEGER,
        resolved_at TEXT,
        closed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (assigned_to) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_complaints_company_status ON complaints(company_id, status, updated_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_complaints_company_assignee ON complaints(company_id, assigned_to)');

    db.run(`
      CREATE TABLE IF NOT EXISTS service_areas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        parent_id INTEGER,
        level TEXT NOT NULL CHECK (level IN ('country','city','area','zone','sector','route')),
        name TEXT NOT NULL,
        code TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, parent_id, level, name),
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (parent_id) REFERENCES service_areas(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_service_areas_company_parent ON service_areas(company_id, parent_id, level, active)');
    db.run(`
      CREATE TABLE IF NOT EXISTS customer_service_areas (
        company_id INTEGER NOT NULL,
        customer_id INTEGER NOT NULL,
        service_area_id INTEGER NOT NULL,
        assigned_by INTEGER,
        assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (company_id, customer_id),
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (service_area_id) REFERENCES service_areas(id),
        FOREIGN KEY (assigned_by) REFERENCES users(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_customer_service_areas_area ON customer_service_areas(company_id, service_area_id)');
    db.run(`
      CREATE TABLE IF NOT EXISTS service_area_drivers (
        company_id INTEGER NOT NULL,
        service_area_id INTEGER NOT NULL,
        driver_id INTEGER NOT NULL,
        assigned_by INTEGER,
        assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (company_id, service_area_id, driver_id),
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (service_area_id) REFERENCES service_areas(id),
        FOREIGN KEY (driver_id) REFERENCES users(id),
        FOREIGN KEY (assigned_by) REFERENCES users(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_service_area_drivers_driver ON service_area_drivers(company_id, driver_id)');

    db.run(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        vehicle_number TEXT NOT NULL,
        registration TEXT NOT NULL DEFAULT '',
        vehicle_type TEXT NOT NULL,
        capacity REAL NOT NULL,
        fuel_type TEXT NOT NULL,
        mileage REAL NOT NULL DEFAULT 0,
        maintenance_date TEXT,
        insurance_expiry TEXT,
        registration_expiry TEXT,
        service_history TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive','retired')),
        driver_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, vehicle_number),
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (driver_id) REFERENCES users(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_vehicles_company_status ON vehicles(company_id, status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_vehicles_company_driver ON vehicles(company_id, driver_id)');

    db.run(`
      CREATE TABLE IF NOT EXISTS vehicle_service_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        vehicle_id INTEGER NOT NULL,
        service_type TEXT NOT NULL,
        interval_days INTEGER,
        interval_mileage REAL,
        next_due_date TEXT,
        next_due_mileage REAL,
        active INTEGER NOT NULL DEFAULT 1,
        notes TEXT NOT NULL DEFAULT '',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_vehicle_service_schedules_company_due ON vehicle_service_schedules(company_id, next_due_date)');
    db.run(`
      CREATE TABLE IF NOT EXISTS vehicle_service_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        vehicle_id INTEGER NOT NULL,
        service_date TEXT NOT NULL,
        service_type TEXT NOT NULL,
        odometer REAL NOT NULL DEFAULT 0,
        provider TEXT NOT NULL DEFAULT '',
        cost REAL NOT NULL DEFAULT 0 CHECK (cost >= 0),
        invoice_reference TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_vehicle_service_records_company_date ON vehicle_service_records(company_id, service_date DESC)');
    db.run(`
      CREATE TABLE IF NOT EXISTS vehicle_fuel_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        vehicle_id INTEGER NOT NULL,
        fuel_date TEXT NOT NULL,
        odometer REAL NOT NULL DEFAULT 0,
        quantity REAL NOT NULL CHECK (quantity > 0),
        unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
        total_cost REAL NOT NULL CHECK (total_cost >= 0),
        station TEXT NOT NULL DEFAULT '',
        driver_id INTEGER,
        receipt_reference TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
        FOREIGN KEY (driver_id) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_vehicle_fuel_logs_company_date ON vehicle_fuel_logs(company_id, fuel_date DESC)');
    db.run(`
      CREATE TABLE IF NOT EXISTS equipment_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        asset_tag TEXT NOT NULL,
        name TEXT NOT NULL,
        asset_type TEXT NOT NULL DEFAULT '',
        serial_number TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        purchase_date TEXT,
        purchase_cost REAL NOT NULL DEFAULT 0 CHECK (purchase_cost >= 0),
        current_value REAL NOT NULL DEFAULT 0 CHECK (current_value >= 0),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive','retired','lost')),
        assigned_employee_id INTEGER,
        notes TEXT NOT NULL DEFAULT '',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, asset_tag),
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (assigned_employee_id) REFERENCES employees(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_equipment_assets_company_status ON equipment_assets(company_id, status)');
    db.run(`
      CREATE TABLE IF NOT EXISTS fleet_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('vehicle','equipment')),
        entity_id INTEGER NOT NULL,
        document_type TEXT NOT NULL,
        document_number TEXT NOT NULL DEFAULT '',
        issued_on TEXT,
        expires_on TEXT,
        file_url TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_fleet_documents_company_expiry ON fleet_documents(company_id, expires_on)');
    db.run(`
      CREATE TABLE IF NOT EXISTS fleet_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('vehicle','equipment')),
        entity_id INTEGER NOT NULL,
        employee_id INTEGER,
        driver_id INTEGER,
        assigned_from TEXT NOT NULL,
        assigned_to TEXT,
        purpose TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (employee_id) REFERENCES employees(id),
        FOREIGN KEY (driver_id) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_fleet_assignments_company_entity ON fleet_assignments(company_id, entity_type, entity_id, assigned_from DESC)');

    db.run(`
      CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        user_id INTEGER,
        employee_id TEXT NOT NULL,
        full_name TEXT NOT NULL,
        department TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        salary REAL NOT NULL DEFAULT 0 CHECK (salary >= 0),
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        hire_date TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','on_leave','terminated')),
        attendance_days INTEGER NOT NULL DEFAULT 0,
        present_days INTEGER NOT NULL DEFAULT 0,
        absent_days INTEGER NOT NULL DEFAULT 0,
        late_days INTEGER NOT NULL DEFAULT 0,
        leave_days INTEGER NOT NULL DEFAULT 0,
        leave_balance INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, employee_id),
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_employees_company_status ON employees(company_id, status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_employees_company_user ON employees(company_id, user_id)');
    db.run(`
      CREATE TABLE IF NOT EXISTS attendance_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, employee_id INTEGER NOT NULL,
        attendance_date TEXT NOT NULL, check_in TEXT, check_out TEXT,
        status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present','late','absent','leave','half_day')),
        notes TEXT NOT NULL DEFAULT '', created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, employee_id, attendance_date), FOREIGN KEY (company_id) REFERENCES companies(id), FOREIGN KEY (employee_id) REFERENCES employees(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_attendance_company_date ON attendance_records(company_id, attendance_date)');
    db.run(`
      CREATE TABLE IF NOT EXISTS payroll_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'processed' CHECK (status IN ('draft','processed','void')), notes TEXT NOT NULL DEFAULT '', created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(company_id, period_start, period_end), FOREIGN KEY (company_id) REFERENCES companies(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS payslips (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, payroll_run_id INTEGER NOT NULL, employee_id INTEGER NOT NULL,
        gross_amount REAL NOT NULL DEFAULT 0 CHECK (gross_amount >= 0), deductions REAL NOT NULL DEFAULT 0 CHECK (deductions >= 0), net_amount REAL NOT NULL DEFAULT 0 CHECK (net_amount >= 0),
        payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid')), notes TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, payroll_run_id, employee_id), FOREIGN KEY (company_id) REFERENCES companies(id), FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id), FOREIGN KEY (employee_id) REFERENCES employees(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_payslips_company_run ON payslips(company_id, payroll_run_id)');

    db.run(`
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        total_amount REAL NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        total_price REAL NOT NULL,
        FOREIGN KEY (sale_id) REFERENCES sales(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_name TEXT NOT NULL,
        total_amount REAL NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS purchase_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        total_price REAL NOT NULL,
        FOREIGN KEY (purchase_id) REFERENCES purchases(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        amount REAL NOT NULL,
        category TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        amount REAL NOT NULL,
        method TEXT,
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Legacy tenant tables were created before company isolation was introduced.
    // Add their tenant columns before any company-scoped indexes are created below.
    ['products', 'customers', 'suppliers', 'sales', 'sale_items', 'purchases', 'purchase_items', 'expenses', 'payments'].forEach((table) => {
      ensureColumn(table, 'company_id', 'INTEGER');
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS warehouses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        address TEXT DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        warehouse_id INTEGER,
        product_id INTEGER NOT NULL,
        customer_id INTEGER,
        movement_type TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        reference TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS bottles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        capacity_litres REAL NOT NULL,
        bottle_type TEXT NOT NULL DEFAULT 'returnable',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, code),
        FOREIGN KEY (company_id) REFERENCES companies(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS bottle_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        bottle_id INTEGER NOT NULL,
        customer_id INTEGER,
        movement_type TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        reference TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (bottle_id) REFERENCES bottles(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        CHECK (quantity > 0)
      )
    `);
    ensureColumn('bottles', 'qr_code', "TEXT DEFAULT ''");
    ensureColumn('bottles', 'barcode', "TEXT DEFAULT ''");
    ensureColumn('bottles', 'bottle_identifier', "TEXT DEFAULT ''");
    ensureColumn('bottle_movements', 'driver_id', 'INTEGER');
    ensureColumn('bottle_movements', 'warehouse_id', 'INTEGER');
    db.run('CREATE INDEX IF NOT EXISTS idx_bottles_company ON bottles(company_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_bottles_identifiers ON bottles(company_id, barcode, qr_code, bottle_identifier)');
    db.run('CREATE INDEX IF NOT EXISTS idx_bottle_movements_company ON bottle_movements(company_id, created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_bottle_movements_driver ON bottle_movements(company_id, driver_id, created_at)');

    db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        customer_id INTEGER,
        customer_name TEXT NOT NULL,
        delivery_address TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','assigned','out_for_delivery','delivered','partially_delivered','cancelled','failed')),
        total_amount REAL NOT NULL DEFAULT 0,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        delivered_quantity INTEGER NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0),
        unit_price REAL NOT NULL,
        total_price REAL NOT NULL,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        order_id INTEGER NOT NULL,
        driver_id INTEGER,
        status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','out_for_delivery','delivered','partially_delivered','failed')),
        scheduled_date TEXT,
        started_at TEXT,
        delivered_at TEXT,
        failed_reason TEXT DEFAULT '',
        rescheduled_for TEXT,
        collected_amount REAL NOT NULL DEFAULT 0,
        collected_method TEXT DEFAULT '',
        collected_reference TEXT DEFAULT '',
        bottle_return_count INTEGER NOT NULL DEFAULT 0,
        empty_count INTEGER NOT NULL DEFAULT 0,
        notes TEXT DEFAULT '',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, order_id),
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (driver_id) REFERENCES users(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_orders_company_status ON orders(company_id, status, created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_deliveries_company_status ON deliveries(company_id, status, created_at)');
    db.run(`
      CREATE TABLE IF NOT EXISTS delivery_otp_challenges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        delivery_id INTEGER NOT NULL,
        customer_id INTEGER,
        code_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        verified_at TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(company_id) REFERENCES companies(id),
        FOREIGN KEY(delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_delivery_otp_company_delivery ON delivery_otp_challenges(company_id, delivery_id, created_at DESC)');
    db.run(`
      CREATE TABLE IF NOT EXISTS delivery_proofs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        delivery_id INTEGER NOT NULL UNIQUE,
        otp_challenge_id INTEGER,
        otp_verified_at TEXT,
        signature_storage_key TEXT,
        signature_content_type TEXT,
        signature_byte_size INTEGER,
        signature_sha256 TEXT,
        signature_width INTEGER,
        signature_height INTEGER,
        photo_storage_key TEXT,
        photo_content_type TEXT,
        photo_byte_size INTEGER,
        photo_sha256 TEXT,
        photo_width INTEGER,
        photo_height INTEGER,
        captured_at TEXT,
        captured_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(company_id) REFERENCES companies(id),
        FOREIGN KEY(delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
        FOREIGN KEY(otp_challenge_id) REFERENCES delivery_otp_challenges(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_delivery_proofs_company_created ON delivery_proofs(company_id, created_at DESC)');
    if(driverAtomicQaEnabled) for(const ddl of driverAtomicQaSchema) db.run(ddl);
    db.run(`
      CREATE TABLE IF NOT EXISTS reorder_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        minimum_orders INTEGER NOT NULL DEFAULT 2 CHECK (minimum_orders >= 2),
        reminder_lead_days INTEGER NOT NULL DEFAULT 0 CHECK (reminder_lead_days >= 0),
        quantity_buffer_percent REAL NOT NULL DEFAULT 0 CHECK (quantity_buffer_percent >= 0 AND quantity_buffer_percent <= 100),
        provider TEXT NOT NULL DEFAULT 'not_configured',
        updated_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS reorder_reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        customer_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        action TEXT NOT NULL DEFAULT 'provider_not_configured',
        status TEXT NOT NULL DEFAULT 'not_configured',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_reorder_reminders_company ON reorder_reminders(company_id, customer_id, product_id, created_at)');
    ensureColumn('customers', 'area', "TEXT DEFAULT ''");
    ensureColumn('customers', 'latitude', 'REAL');
    ensureColumn('customers', 'longitude', 'REAL');
    db.run(`
      CREATE TABLE IF NOT EXISTS delivery_routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        area TEXT NOT NULL DEFAULT '',
        driver_id INTEGER,
        route_date TEXT,
        status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','assigned','in_progress','completed','cancelled')),
        estimated_distance_km REAL NOT NULL DEFAULT 0,
        estimated_duration_minutes INTEGER NOT NULL DEFAULT 0,
        optimization_provider TEXT NOT NULL DEFAULT 'deterministic-fallback',
        optimization_message TEXT NOT NULL DEFAULT '',
        current_stop_sequence INTEGER,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id), FOREIGN KEY (driver_id) REFERENCES users(id), FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS delivery_route_stops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        route_id INTEGER NOT NULL,
        delivery_id INTEGER NOT NULL,
        sequence INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','current','completed','skipped')),
        estimated_distance_km REAL NOT NULL DEFAULT 0,
        estimated_duration_minutes INTEGER NOT NULL DEFAULT 0,
        navigation_url TEXT NOT NULL DEFAULT '',
        started_at TEXT,
        completed_at TEXT,
        skipped_at TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(route_id, sequence), FOREIGN KEY (company_id) REFERENCES companies(id), FOREIGN KEY (route_id) REFERENCES delivery_routes(id) ON DELETE CASCADE, FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_delivery_routes_company_status_date ON delivery_routes(company_id, status, route_date)');
    db.run('CREATE INDEX IF NOT EXISTS idx_delivery_routes_company_driver ON delivery_routes(company_id, driver_id, route_date)');
    db.run('CREATE INDEX IF NOT EXISTS idx_delivery_route_stops_company_route_seq ON delivery_route_stops(company_id, route_id, sequence)');
    db.run('CREATE INDEX IF NOT EXISTS idx_delivery_route_stops_company_delivery ON delivery_route_stops(company_id, delivery_id)');
    db.run('DROP INDEX IF EXISTS uq_active_delivery_route_stop');
    db.run('CREATE INDEX IF NOT EXISTS idx_delivery_route_stops_active_delivery ON delivery_route_stops(company_id, delivery_id, status)');
    ensureColumn('orders', 'delivery_subscription_id', 'INTEGER');
    ensureColumn('orders', 'subscription_occurrence_id', 'INTEGER');
    ['scheduled_date', 'started_at', 'delivered_at', 'failed_reason', 'rescheduled_for', 'collected_amount', 'collected_method', 'collected_reference', 'bottle_return_count', 'empty_count'].forEach((column) => {
      const definitions = {
        scheduled_date: 'TEXT', started_at: 'TEXT', delivered_at: 'TEXT', failed_reason: "TEXT DEFAULT ''",
        rescheduled_for: 'TEXT', collected_amount: 'REAL DEFAULT 0', collected_method: "TEXT DEFAULT ''",
        collected_reference: "TEXT DEFAULT ''", bottle_return_count: 'INTEGER DEFAULT 0', empty_count: 'INTEGER DEFAULT 0'
      };
      ensureColumn('deliveries', column, definitions[column]);
    });
    ensureColumn('payments', 'delivery_id', 'INTEGER');
    ensureColumn('payments', 'order_id', 'INTEGER');
    ensureColumn('payments', 'collected_by', 'INTEGER');

    db.run(`
      CREATE TABLE IF NOT EXISTS delivery_bottle_counts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        delivery_id INTEGER NOT NULL,
        bottle_id INTEGER,
        returned_quantity INTEGER NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
        empty_quantity INTEGER NOT NULL DEFAULT 0 CHECK (empty_quantity >= 0),
        notes TEXT DEFAULT '',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
        FOREIGN KEY (bottle_id) REFERENCES bottles(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS delivery_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        customer_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price REAL NOT NULL CHECK (unit_price >= 0),
        frequency TEXT NOT NULL CHECK (frequency IN ('daily','alternate_days','weekly','monthly','custom')),
        custom_interval INTEGER,
        custom_unit TEXT CHECK (custom_unit IN ('days','weeks','months')),
        start_date TEXT NOT NULL,
        end_date TEXT,
        next_due_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','cancelled')),
        delivery_address TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS delivery_subscription_occurrences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        delivery_subscription_id INTEGER NOT NULL,
        due_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generated','skipped')),
        order_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, delivery_subscription_id, due_date),
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (delivery_subscription_id) REFERENCES delivery_subscriptions(id) ON DELETE CASCADE,
        FOREIGN KEY (order_id) REFERENCES orders(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_delivery_subscriptions_company_status ON delivery_subscriptions(company_id, status, next_due_date)');
    db.run('CREATE INDEX IF NOT EXISTS idx_delivery_subscription_occurrences_due ON delivery_subscription_occurrences(company_id, due_date, status)');

    db.run(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER,
        user_id INTEGER,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        previous_value TEXT,
        new_value TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created ON audit_logs(company_id, created_at DESC, id DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_company_action ON audit_logs(company_id, action)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_company_entity ON audit_logs(company_id, entity_type)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_company_user ON audit_logs(company_id, user_id)');
    for (const sql of driverPermissionAuditTriggers) db.run(sql);
    db.run(`CREATE TABLE IF NOT EXISTS report_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL,
      source TEXT NOT NULL, configuration TEXT NOT NULL DEFAULT '{}', created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, name), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_report_definitions_company_updated ON report_definitions(company_id, updated_at DESC)');
    db.run(`CREATE TABLE IF NOT EXISTS error_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, user_id INTEGER, level TEXT NOT NULL,
      status_code INTEGER NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, message TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_error_events_created ON error_events(created_at DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_error_events_company_created ON error_events(company_id, created_at DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_users_company_active ON users(company_id, active)');
    db.run('CREATE INDEX IF NOT EXISTS idx_orders_company_created ON orders(company_id, created_at DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sales_company_created ON sales(company_id, created_at DESC)');

    db.run(`CREATE TABLE IF NOT EXISTS production_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL DEFAULT '',
      location TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','maintenance','inactive')), capacity_per_hour REAL,
      created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, code), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS production_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, batch_number TEXT NOT NULL, product_id INTEGER NOT NULL,
      planned_quantity REAL NOT NULL CHECK(planned_quantity > 0), actual_quantity REAL NOT NULL DEFAULT 0 CHECK(actual_quantity >= 0),
      unit TEXT NOT NULL DEFAULT 'unit', line_id INTEGER, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_progress','completed','released','blocked','cancelled')),
      started_at TEXT, completed_at TEXT, released_at TEXT, notes TEXT DEFAULT '', created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, batch_number), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(line_id) REFERENCES production_lines(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS production_batch_inputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, batch_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
      planned_quantity REAL NOT NULL CHECK(planned_quantity > 0), consumed_quantity REAL NOT NULL DEFAULT 0 CHECK(consumed_quantity >= 0), warehouse_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(company_id, batch_id, product_id), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(batch_id) REFERENCES production_batches(id) ON DELETE CASCADE, FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(warehouse_id) REFERENCES warehouses(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS lab_parameters (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL, unit TEXT DEFAULT '', min_value REAL, max_value REAL, allowed_text TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(company_id, name), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS lab_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, batch_id INTEGER NOT NULL, test_number TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_progress','passed','failed','released')),
      sampled_at TEXT, tested_at TEXT, tested_by INTEGER, reviewed_by INTEGER, reviewed_at TEXT, notes TEXT DEFAULT '', created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, test_number), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(batch_id) REFERENCES production_batches(id), FOREIGN KEY(tested_by) REFERENCES users(id), FOREIGN KEY(reviewed_by) REFERENCES users(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS lab_test_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, test_id INTEGER NOT NULL, parameter_id INTEGER NOT NULL, numeric_value REAL, text_value TEXT DEFAULT '', pass INTEGER NOT NULL DEFAULT 0, notes TEXT DEFAULT '',
      UNIQUE(company_id, test_id, parameter_id), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(test_id) REFERENCES lab_tests(id) ON DELETE CASCADE, FOREIGN KEY(parameter_id) REFERENCES lab_parameters(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS quality_certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, batch_id INTEGER NOT NULL, test_id INTEGER NOT NULL, certificate_number TEXT NOT NULL, issued_at TEXT DEFAULT CURRENT_TIMESTAMP, issued_by INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')), traceability_code TEXT NOT NULL,
      UNIQUE(company_id, certificate_number), UNIQUE(company_id, traceability_code), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(batch_id) REFERENCES production_batches(id), FOREIGN KEY(test_id) REFERENCES lab_tests(id), FOREIGN KEY(issued_by) REFERENCES users(id)
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_production_batches_company_status ON production_batches(company_id, status, created_at DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_lab_tests_company_status ON lab_tests(company_id, status, created_at DESC)');

    db.run(`CREATE TABLE IF NOT EXISTS document_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, entity_type TEXT NOT NULL CHECK(entity_type IN ('company_asset','vehicle','employee','production_batch','lab_result','customer','supplier','supplier_contract','purchase_order','supplier_invoice')),
      entity_id INTEGER, title TEXT NOT NULL, document_type TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','revoked')),
      visibility TEXT NOT NULL DEFAULT 'company' CHECK(visibility IN ('company','restricted')), expires_on TEXT, current_version_id INTEGER, created_by INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS document_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, document_id INTEGER NOT NULL, version_number INTEGER NOT NULL, original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL CHECK(byte_size >= 0), checksum_sha256 TEXT NOT NULL, storage_provider TEXT NOT NULL DEFAULT 'external', storage_key TEXT NOT NULL,
      upload_status TEXT NOT NULL DEFAULT 'pending' CHECK(upload_status IN ('pending','uploaded','quarantined','rejected')), preview_available INTEGER NOT NULL DEFAULT 0, created_by INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, document_id, version_number), UNIQUE(company_id, storage_key), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(document_id) REFERENCES document_records(id) ON DELETE CASCADE, FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS document_access (
      company_id INTEGER NOT NULL, document_id INTEGER NOT NULL, role TEXT NOT NULL, can_view INTEGER NOT NULL DEFAULT 1, can_download INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(company_id, document_id, role), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(document_id) REFERENCES document_records(id) ON DELETE CASCADE
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS document_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, document_id INTEGER NOT NULL, remind_before_days INTEGER NOT NULL DEFAULT 30 CHECK(remind_before_days >= 0), last_notified_on TEXT,
      UNIQUE(company_id, document_id), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(document_id) REFERENCES document_records(id) ON DELETE CASCADE
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_documents_company_entity ON document_records(company_id, entity_type, entity_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_documents_company_expiry ON document_records(company_id, expires_on, status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_document_versions_document ON document_versions(company_id, document_id, version_number DESC)');
    db.run(`CREATE TABLE IF NOT EXISTS certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, certificate_number TEXT NOT NULL, certificate_type TEXT NOT NULL,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('company_asset','vehicle','employee','production_batch','lab_result','customer','supplier','supplier_contract','purchase_order','supplier_invoice')), entity_id INTEGER, document_id INTEGER,
      issued_on TEXT NOT NULL, expires_on TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','expired','revoked','superseded')),
      issuer TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, certificate_number), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(document_id) REFERENCES document_records(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_certificates_company_status_expiry ON certificates(company_id, status, expires_on)');

    // Offline driver sync migration v2: idempotent, company/driver-scoped operation records.
    db.run(`CREATE TABLE IF NOT EXISTS offline_sync_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      driver_id INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT 'delivery',
      entity_id INTEGER,
      request_hash TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','conflict','failed')),
      result TEXT,
      conflict_code TEXT,
      conflict_message TEXT,
      client_timestamp TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT,
      UNIQUE(company_id, driver_id, idempotency_key),
      FOREIGN KEY (company_id) REFERENCES companies(id),
      FOREIGN KEY (driver_id) REFERENCES users(id)
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_offline_sync_company_driver_created ON offline_sync_operations(company_id, driver_id, created_at DESC, id DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_offline_sync_company_status ON offline_sync_operations(company_id, status, created_at DESC)');

    // CRM/loyalty migration v1: all records are company-scoped and reference existing entities.
    db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    db.run("INSERT OR IGNORE INTO schema_migrations(version, name) VALUES (2, 'advanced-offline-driver-sync')");
    db.run(`CREATE TABLE IF NOT EXISTS loyalty_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL,
      minimum_points INTEGER NOT NULL DEFAULT 0 CHECK (minimum_points >= 0), multiplier REAL NOT NULL DEFAULT 1 CHECK (multiplier > 0),
      reward_percent REAL NOT NULL DEFAULT 0 CHECK (reward_percent >= 0), active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(company_id, name), FOREIGN KEY(company_id) REFERENCES companies(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS loyalty_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, customer_id INTEGER NOT NULL,
      points_balance INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0), lifetime_points INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
      tier_id INTEGER, total_spend REAL NOT NULL DEFAULT 0 CHECK (total_spend >= 0), last_earned_at TEXT,
      UNIQUE(company_id, customer_id), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(tier_id) REFERENCES loyalty_tiers(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, account_id INTEGER NOT NULL,
      order_id INTEGER, sale_id INTEGER, type TEXT NOT NULL CHECK (type IN ('earn','redeem','adjust','referral_reward','refund')),
      points INTEGER NOT NULL, description TEXT NOT NULL DEFAULT '', idempotency_key TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, idempotency_key), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(account_id) REFERENCES loyalty_accounts(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS referral_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, code TEXT NOT NULL,
      reward_points INTEGER NOT NULL DEFAULT 100 CHECK (reward_points >= 0), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','revoked')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(company_id, code), UNIQUE(company_id, customer_id), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(customer_id) REFERENCES customers(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, referral_code_id INTEGER NOT NULL, referrer_customer_id INTEGER NOT NULL,
      referred_customer_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','qualified','rewarded','cancelled')),
      qualified_sale_id INTEGER, rewarded_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(company_id, referred_customer_id),
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(referral_code_id) REFERENCES referral_codes(id), FOREIGN KEY(referrer_customer_id) REFERENCES customers(id), FOREIGN KEY(referred_customer_id) REFERENCES customers(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS salesman_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, salesman_id INTEGER NOT NULL,
      assigned_by INTEGER, active INTEGER NOT NULL DEFAULT 1, assigned_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(company_id, customer_id),
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(salesman_id) REFERENCES users(id), FOREIGN KEY(assigned_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS salesman_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, salesman_id INTEGER NOT NULL, customer_id INTEGER, order_id INTEGER,
      activity_type TEXT NOT NULL CHECK(activity_type IN ('call','visit','message','note','follow_up','sale')), notes TEXT NOT NULL DEFAULT '', activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(salesman_id) REFERENCES users(id), FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(order_id) REFERENCES orders(id)
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_loyalty_company_customer ON loyalty_accounts(company_id, customer_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_loyalty_tx_company_created ON loyalty_transactions(company_id, created_at DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_referrals_company_status ON referrals(company_id, status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_salesman_activity_company_date ON salesman_activities(company_id, activity_at DESC)');
    ensureColumn('customers', 'email', "TEXT DEFAULT ''");
    ensureColumn('sales', 'customer_id', 'INTEGER');
    ensureColumn('sales', 'salesman_id', 'INTEGER');
    db.run("INSERT OR IGNORE INTO schema_migrations(version, name) VALUES (1, 'customer-loyalty-referral-salesman-crm')");

    // Advanced credit control, pricing, discounts, and commission engine migration v3.
    db.run(`CREATE TABLE IF NOT EXISTS credit_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL UNIQUE,
      default_limit REAL NOT NULL DEFAULT 0 CHECK(default_limit >= 0), default_terms_days INTEGER NOT NULL DEFAULT 0 CHECK(default_terms_days >= 0),
      overdue_grace_days INTEGER NOT NULL DEFAULT 0 CHECK(overdue_grace_days >= 0), block_on_overdue INTEGER NOT NULL DEFAULT 1,
      require_approval_above REAL NOT NULL DEFAULT 0 CHECK(require_approval_above >= 0), updated_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(updated_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS customer_credit_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, customer_id INTEGER NOT NULL,
      credit_limit REAL NOT NULL DEFAULT 0 CHECK(credit_limit >= 0), terms_days INTEGER NOT NULL DEFAULT 0 CHECK(terms_days >= 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','hold','closed')), opened_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, customer_id), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(customer_id) REFERENCES customers(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, sale_id INTEGER, payment_id INTEGER,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('invoice','payment','credit','debit','writeoff')), amount REAL NOT NULL, due_date TEXT, note TEXT DEFAULT '', created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(sale_id) REFERENCES sales(id), FOREIGN KEY(payment_id) REFERENCES payments(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS credit_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, reason TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER, released_by INTEGER, released_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(customer_id) REFERENCES customers(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS price_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'PKR', active INTEGER NOT NULL DEFAULT 1,
      valid_from TEXT, valid_to TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, name), FOREIGN KEY(company_id) REFERENCES companies(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS price_list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, price_list_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
      unit_price REAL NOT NULL CHECK(unit_price >= 0), min_quantity REAL NOT NULL DEFAULT 1 CHECK(min_quantity > 0), max_discount_percent REAL NOT NULL DEFAULT 0 CHECK(max_discount_percent >= 0 AND max_discount_percent <= 100),
      UNIQUE(company_id, price_list_id, product_id, min_quantity), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(price_list_id) REFERENCES price_lists(id) ON DELETE CASCADE, FOREIGN KEY(product_id) REFERENCES products(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS customer_price_lists (
      company_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, price_list_id INTEGER NOT NULL, assigned_by INTEGER, assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(company_id, customer_id), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(price_list_id) REFERENCES price_lists(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS discount_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, sale_id INTEGER, customer_id INTEGER, requested_by INTEGER NOT NULL, approved_by INTEGER,
      discount_percent REAL NOT NULL CHECK(discount_percent >= 0 AND discount_percent <= 100), amount_before REAL NOT NULL, amount_after REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), reason TEXT DEFAULT '', decided_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(sale_id) REFERENCES sales(id), FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(requested_by) REFERENCES users(id), FOREIGN KEY(approved_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS commission_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'salesman', basis TEXT NOT NULL DEFAULT 'net_sales' CHECK(basis IN ('gross_sales','net_sales','collected_cash')),
      rate_percent REAL NOT NULL DEFAULT 0 CHECK(rate_percent >= 0 AND rate_percent <= 100), active INTEGER NOT NULL DEFAULT 1, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, name), FOREIGN KEY(company_id) REFERENCES companies(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS commission_statements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, beneficiary_id INTEGER NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
      gross_amount REAL NOT NULL DEFAULT 0, deductions REAL NOT NULL DEFAULT 0, net_amount REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','approved','settled','void')),
      approved_by INTEGER, settled_at TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(company_id, beneficiary_id, period_start, period_end), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(beneficiary_id) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS commission_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, statement_id INTEGER NOT NULL, sale_id INTEGER, delivery_id INTEGER, rule_id INTEGER, basis_amount REAL NOT NULL, rate_percent REAL NOT NULL, commission_amount REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(company_id, statement_id, sale_id, delivery_id), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(statement_id) REFERENCES commission_statements(id) ON DELETE CASCADE)
    `);
    db.run(`CREATE TABLE IF NOT EXISTS commission_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, statement_id INTEGER NOT NULL, amount REAL NOT NULL CHECK(amount >= 0), method TEXT NOT NULL DEFAULT 'manual', reference TEXT DEFAULT '', settled_by INTEGER NOT NULL, settled_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(statement_id) REFERENCES commission_statements(id), FOREIGN KEY(settled_by) REFERENCES users(id)
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_credit_ledger_company_customer ON credit_ledger(company_id, customer_id, created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_price_items_company_product ON price_list_items(company_id, product_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_commission_statements_company_period ON commission_statements(company_id, period_start, period_end)');
    db.run("INSERT OR IGNORE INTO schema_migrations(version, name) VALUES (3, 'advanced-credit-pricing-commission')");

    // Private supplier and procurement marketplace migration v4. Every record is tenant-scoped;
    // no marketplace seed data is inserted here.
    db.run(`CREATE TABLE IF NOT EXISTS supplier_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, name), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS supplier_category_assignments (
      company_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL, category_id INTEGER NOT NULL,
      assigned_by INTEGER, assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(company_id, supplier_id, category_id),
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
      FOREIGN KEY(category_id) REFERENCES supplier_categories(id) ON DELETE CASCADE, FOREIGN KEY(assigned_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS supplier_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL,
      name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', job_title TEXT NOT NULL DEFAULT '',
      is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)), notes TEXT NOT NULL DEFAULT '',
      created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
      FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS supplier_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL, product_id INTEGER,
      supplier_sku TEXT NOT NULL DEFAULT '', product_name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT 'unit',
      unit_price REAL NOT NULL CHECK(unit_price >= 0), currency TEXT NOT NULL DEFAULT 'PKR', min_order_quantity REAL NOT NULL DEFAULT 1 CHECK(min_order_quantity > 0),
      lead_time_days INTEGER NOT NULL DEFAULT 0 CHECK(lead_time_days >= 0), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS supplier_quotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL,
      quotation_number TEXT NOT NULL, quote_date TEXT NOT NULL, valid_until TEXT, currency TEXT NOT NULL DEFAULT 'PKR',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','accepted','rejected','expired','cancelled')),
      notes TEXT NOT NULL DEFAULT '', subtotal REAL NOT NULL DEFAULT 0 CHECK(subtotal >= 0), tax REAL NOT NULL DEFAULT 0 CHECK(tax >= 0),
      total REAL NOT NULL DEFAULT 0 CHECK(total >= 0), created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, quotation_number), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(supplier_id) REFERENCES suppliers(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS supplier_quotation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, quotation_id INTEGER NOT NULL, product_id INTEGER, supplied_product_id INTEGER,
      description TEXT NOT NULL, quantity REAL NOT NULL CHECK(quantity > 0), unit_price REAL NOT NULL CHECK(unit_price >= 0), tax_rate REAL NOT NULL DEFAULT 0 CHECK(tax_rate >= 0 AND tax_rate <= 100),
      tax_amount REAL NOT NULL DEFAULT 0 CHECK(tax_amount >= 0), total_price REAL NOT NULL CHECK(total_price >= 0),
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(quotation_id) REFERENCES supplier_quotations(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(supplied_product_id) REFERENCES supplier_products(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS quotation_comparisons (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL, criteria TEXT NOT NULL DEFAULT '',
      created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS quotation_comparison_items (
      company_id INTEGER NOT NULL, comparison_id INTEGER NOT NULL, quotation_id INTEGER NOT NULL,
      PRIMARY KEY(company_id, comparison_id, quotation_id), FOREIGN KEY(company_id) REFERENCES companies(id),
      FOREIGN KEY(comparison_id) REFERENCES quotation_comparisons(id) ON DELETE CASCADE, FOREIGN KEY(quotation_id) REFERENCES supplier_quotations(id) ON DELETE CASCADE
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL, quotation_id INTEGER,
      po_number TEXT NOT NULL, order_date TEXT NOT NULL, expected_date TEXT, currency TEXT NOT NULL DEFAULT 'PKR',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','partially_received','received','cancelled')),
      notes TEXT NOT NULL DEFAULT '', subtotal REAL NOT NULL DEFAULT 0 CHECK(subtotal >= 0), tax REAL NOT NULL DEFAULT 0 CHECK(tax >= 0),
      total REAL NOT NULL DEFAULT 0 CHECK(total >= 0), created_by INTEGER, approved_by INTEGER, approved_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(company_id, po_number),
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(supplier_id) REFERENCES suppliers(id), FOREIGN KEY(quotation_id) REFERENCES supplier_quotations(id),
      FOREIGN KEY(created_by) REFERENCES users(id), FOREIGN KEY(approved_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS purchase_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, purchase_order_id INTEGER NOT NULL, product_id INTEGER, supplied_product_id INTEGER,
      description TEXT NOT NULL, quantity REAL NOT NULL CHECK(quantity > 0), unit_price REAL NOT NULL CHECK(unit_price >= 0), tax_rate REAL NOT NULL DEFAULT 0 CHECK(tax_rate >= 0 AND tax_rate <= 100),
      tax_amount REAL NOT NULL DEFAULT 0 CHECK(tax_amount >= 0), total_price REAL NOT NULL CHECK(total_price >= 0),
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(supplied_product_id) REFERENCES supplier_products(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS supplier_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL, purchase_order_id INTEGER,
      invoice_number TEXT NOT NULL, invoice_date TEXT NOT NULL, due_date TEXT, currency TEXT NOT NULL DEFAULT 'PKR',
      status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('draft','received','approved','partially_paid','paid','overdue','cancelled')),
      subtotal REAL NOT NULL DEFAULT 0 CHECK(subtotal >= 0), tax REAL NOT NULL DEFAULT 0 CHECK(tax >= 0), total REAL NOT NULL CHECK(total >= 0),
      paid_amount REAL NOT NULL DEFAULT 0 CHECK(paid_amount >= 0), balance REAL NOT NULL DEFAULT 0 CHECK(balance >= 0), notes TEXT NOT NULL DEFAULT '',
      created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, supplier_id, invoice_number), FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS supplier_invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, supplier_invoice_id INTEGER NOT NULL, product_id INTEGER, supplied_product_id INTEGER,
      description TEXT NOT NULL, quantity REAL NOT NULL CHECK(quantity > 0), unit_price REAL NOT NULL CHECK(unit_price >= 0), tax_rate REAL NOT NULL DEFAULT 0 CHECK(tax_rate >= 0 AND tax_rate <= 100),
      tax_amount REAL NOT NULL DEFAULT 0 CHECK(tax_amount >= 0), total_price REAL NOT NULL CHECK(total_price >= 0),
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(supplier_invoice_id) REFERENCES supplier_invoices(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(supplied_product_id) REFERENCES supplier_products(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS supplier_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL, invoice_id INTEGER, payment_id INTEGER,
      amount REAL NOT NULL CHECK(amount > 0), method TEXT NOT NULL DEFAULT 'Bank Transfer', reference TEXT NOT NULL DEFAULT '', payment_date TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '', created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(supplier_id) REFERENCES suppliers(id), FOREIGN KEY(invoice_id) REFERENCES supplier_invoices(id),
      FOREIGN KEY(payment_id) REFERENCES payments(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS supplier_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL, purchase_order_id INTEGER,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), quality_rating INTEGER NOT NULL CHECK(quality_rating BETWEEN 1 AND 5),
      delivery_rating INTEGER NOT NULL CHECK(delivery_rating BETWEEN 1 AND 5), price_rating INTEGER NOT NULL CHECK(price_rating BETWEEN 1 AND 5),
      service_rating INTEGER NOT NULL CHECK(service_rating BETWEEN 1 AND 5), comment TEXT NOT NULL DEFAULT '', created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(supplier_id) REFERENCES suppliers(id), FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS supplier_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL, contract_number TEXT NOT NULL DEFAULT '',
      contract_type TEXT NOT NULL DEFAULT 'supplier', title TEXT NOT NULL, starts_on TEXT, expires_on TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','renewed','expired','cancelled')), value REAL NOT NULL DEFAULT 0 CHECK(value >= 0),
      currency TEXT NOT NULL DEFAULT 'PKR', document_id INTEGER, notes TEXT NOT NULL DEFAULT '', created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(supplier_id) REFERENCES suppliers(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_supplier_categories_company ON supplier_categories(company_id, active, name)');
    db.run('CREATE INDEX IF NOT EXISTS idx_supplier_contacts_company_supplier ON supplier_contacts(company_id, supplier_id, is_primary)');
    db.run('CREATE INDEX IF NOT EXISTS idx_supplier_products_company_supplier ON supplier_products(company_id, supplier_id, active)');
    db.run('CREATE INDEX IF NOT EXISTS idx_supplier_quotations_company_status ON supplier_quotations(company_id, status, quote_date DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_purchase_orders_company_status ON purchase_orders(company_id, status, order_date DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_supplier_invoices_company_balance ON supplier_invoices(company_id, supplier_id, balance, due_date)');
    db.run('CREATE INDEX IF NOT EXISTS idx_supplier_payments_company_supplier ON supplier_payments(company_id, supplier_id, payment_date DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_supplier_contracts_company_expiry ON supplier_contracts(company_id, expires_on, status)');
    db.run("INSERT OR IGNORE INTO schema_migrations(version, name) VALUES (4, 'private-supplier-procurement-marketplace')");

    db.run(`
      CREATE TABLE IF NOT EXISTS qr_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        qr_key TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, entity_type, entity_id),
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS qr_lookup_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        qr_record_id INTEGER,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        lookup_type TEXT NOT NULL DEFAULT 'authorized',
        user_id INTEGER,
        result TEXT NOT NULL DEFAULT 'success',
        ip_address TEXT DEFAULT '',
        user_agent TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (qr_record_id) REFERENCES qr_records(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_qr_records_company_entity ON qr_records(company_id, entity_type, entity_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_qr_records_company_key ON qr_records(company_id, qr_key)');
    db.run('CREATE INDEX IF NOT EXISTS idx_qr_lookup_company_created ON qr_lookup_history(company_id, created_at DESC, id DESC)');

    ensureColumn('companies', 'opening_cash', 'REAL DEFAULT 0');
    ensureColumn('companies', 'company_code', "TEXT DEFAULT ''");
    ensureColumn('companies', 'status', "TEXT NOT NULL DEFAULT 'active'");
    ensureColumn('companies', 'theme_json', "TEXT NOT NULL DEFAULT '{}'");
    ensureColumn('companies', 'custom_domain', "TEXT DEFAULT ''");
    ensureColumn('companies', 'subdomain', "TEXT DEFAULT ''");
    ensureColumn('companies', 'favicon_url', "TEXT DEFAULT ''");
    ensureColumn('companies', 'support_email', "TEXT DEFAULT ''");
    ensureColumn('plans', 'limits', "TEXT NOT NULL DEFAULT '{}'");
    ensureColumn('plans', 'display_name', "TEXT NOT NULL DEFAULT ''");
    ensureColumn('plans', 'description', "TEXT NOT NULL DEFAULT ''");
    ensureColumn('plans', 'max_customers', 'INTEGER NOT NULL DEFAULT 1000');
    ensureColumn('plans', 'max_products', 'INTEGER NOT NULL DEFAULT 500');
    ensureColumn('plans', 'max_monthly_orders', 'INTEGER NOT NULL DEFAULT 10000');
    ensureColumn('companies', 'default_language', "TEXT NOT NULL DEFAULT 'en'");
    ensureColumn('users', 'language', "TEXT NOT NULL DEFAULT 'en'");
    ensureColumn('companies', 'opening_bank', 'REAL DEFAULT 0');
    ensureColumn('companies', 'country', "TEXT DEFAULT ''");
    ensureColumn('products', 'unit', "TEXT DEFAULT 'unit'");
    ensureColumn('products', 'min_stock', 'INTEGER DEFAULT 0');
    ensureColumn('products', 'reorder_level', 'INTEGER DEFAULT 0');
    ensureColumn('suppliers', 'email', "TEXT DEFAULT ''");
    ensureColumn('suppliers', 'website', "TEXT DEFAULT ''");
    ensureColumn('suppliers', 'tax_id', "TEXT DEFAULT ''");
    ensureColumn('suppliers', 'payment_terms_days', 'INTEGER DEFAULT 0');
    ensureColumn('suppliers', 'currency', "TEXT DEFAULT 'PKR'");
    ensureColumn('suppliers', 'status', "TEXT DEFAULT 'active'");
    ensureColumn('suppliers', 'notes', "TEXT DEFAULT ''");
    ensureColumn('payments', 'supplier_id', 'INTEGER');
    ensureColumn('payments', 'direction', "TEXT DEFAULT 'receipt'");
    ensureColumn('payments', 'party_type', "TEXT DEFAULT 'customer'");
    ensureColumn('payments', 'supplier_name', "TEXT DEFAULT ''");
    ensureColumn('payments', 'reference', "TEXT DEFAULT ''");
    ensureColumn('payments', 'due_date', 'TEXT');
    ensureColumn('payments', 'created_by', 'INTEGER');
    ensureColumn('payments', 'customer_id', 'INTEGER');
    ensureColumn('expenses', 'payment_method', "TEXT DEFAULT 'Cash'");
    ensureColumn('expenses', 'description', "TEXT DEFAULT ''");
    ensureColumn('expenses', 'created_by', 'INTEGER');
    ensureColumn('sales', 'created_by', 'INTEGER');
    ensureColumn('sales', 'invoice_number', "TEXT DEFAULT ''");
    ensureColumn('sales', 'status', "TEXT DEFAULT 'pending'");
    ensureColumn('sales', 'discount', 'REAL DEFAULT 0');
    ensureColumn('sales', 'tax', 'REAL DEFAULT 0');
    ensureColumn('sales', 'due_date', 'TEXT');
    ensureColumn('purchases', 'invoice_number', "TEXT DEFAULT ''");
    ensureColumn('purchases', 'status', "TEXT DEFAULT 'pending'");
    ensureColumn('purchases', 'due_date', 'TEXT');
    ensureColumn('users', 'email', "TEXT DEFAULT ''");
    ensureColumn('users', 'customer_id', 'INTEGER');
    ensureColumn('users', 'last_login', 'TEXT');
    ensureColumn('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn('users', 'phone', "TEXT DEFAULT ''");
    ensureColumn('users', 'status', "TEXT NOT NULL DEFAULT 'active'");
    ensureColumn('users', 'archived_at', 'TEXT');
    ensureColumn('subscriptions', 'billing_cycle', "TEXT NOT NULL DEFAULT 'monthly'");
    ensureColumn('subscriptions', 'next_billing_date', 'TEXT');
    ensureColumn('subscriptions', 'last_payment_date', 'TEXT');
    ensureColumn('subscriptions', 'auto_renew', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn('subscriptions', 'grace_period_days', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn('subscriptions', 'currency', "TEXT NOT NULL DEFAULT 'PKR'");
    ensureColumn('subscription_payments', 'invoice_number', "TEXT DEFAULT ''");
    ensureColumn('subscription_payments', 'amount_due', 'REAL NOT NULL DEFAULT 0');
    ensureColumn('subscription_payments', 'payment_reference', "TEXT DEFAULT ''");
    ensureColumn('subscription_payments', 'notes', "TEXT DEFAULT ''");
    ensureColumn('subscription_payments', 'created_by', 'INTEGER');
    db.run('CREATE INDEX IF NOT EXISTS idx_subscription_payments_company_date ON subscription_payments(company_id, payment_date DESC)');
    ensureColumn('vehicles', 'registration', "TEXT DEFAULT ''");
    ensureColumn('notifications', 'category', "TEXT DEFAULT 'general'");
    ensureColumn('notifications', 'priority', "TEXT DEFAULT 'normal'");
    ensureColumn('notifications', 'entity_type', 'TEXT');
    ensureColumn('notifications', 'entity_id', 'INTEGER');
    ensureColumn('notifications', 'metadata_json', "TEXT DEFAULT '{}'");
    ensureColumn('notifications', 'provider_state', "TEXT DEFAULT 'in_app'");
    ensureColumn('notifications', 'template_id', 'INTEGER');
    ensureColumn('notification_deliveries', 'recipient', "TEXT DEFAULT ''");
    ensureColumn('subscription_renewal_requests', 'requested_days', 'INTEGER');
    ensureColumn('notification_preferences', 'notification_type', "TEXT DEFAULT 'general'");
    ensureColumn('notification_preferences', 'channels', "TEXT DEFAULT '[\"in_app\"]'");
    ensureColumn('notification_templates', 'notification_type', "TEXT DEFAULT 'general'");
    ensureColumn('notification_templates', 'title_template', "TEXT DEFAULT ''");
    ensureColumn('notification_templates', 'message_template', "TEXT DEFAULT ''");
    db.run(`CREATE TABLE IF NOT EXISTS usage_counters (
      company_id INTEGER NOT NULL, metric TEXT NOT NULL, period TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (company_id, metric, period), FOREIGN KEY (company_id) REFERENCES companies(id)
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_usage_counters_company_period ON usage_counters(company_id, period)');
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_company_code ON companies(company_code) WHERE company_code IS NOT NULL AND company_code <> ""');

    db.run(`INSERT INTO companies (name, logo, phone, email, address) SELECT 'TEMO Spring Water', '', '', '', '' WHERE NOT EXISTS (SELECT 1 FROM companies)`);
    db.run(`UPDATE companies SET company_code = 'TEMO' || printf('%03d', id) WHERE company_code IS NULL OR company_code = ''`);
    db.run(`INSERT OR IGNORE INTO plans (name, slug, price, duration_months, max_users, features) VALUES
      ('Monthly', 'monthly', 5000, 1, 5, '{"customers":true,"sales":true,"reports":true}'),
      ('Quarterly', 'quarterly', 13500, 3, 15, '{"customers":true,"sales":true,"purchases":true,"inventory":true,"reports":true}'),
      ('Annual', 'annual', 48000, 12, 100, '{"customers":true,"sales":true,"purchases":true,"inventory":true,"advanced_reports":true,"warehouses":true}')
    `);
    db.run(`INSERT OR IGNORE INTO plans (name, display_name, description, slug, price, duration_months, max_users, max_customers, max_products, max_monthly_orders, max_storage_mb, limits, features)
      VALUES
        ('Normal', 'Normal', 'Standard plan for growing companies.', 'normal', 0, 1, 25, 5000, 2500, 25000, 2048, '{}', '{"customers":true,"sales":true,"purchases":true,"inventory":true,"reports":true}'),
        ('Enterprise', 'Enterprise', 'Expanded limits and operational capabilities.', 'enterprise', 0, 1, 250, 50000, 25000, 250000, 10240, '{}', '{"customers":true,"sales":true,"purchases":true,"inventory":true,"reports":true,"advanced_reports":true,"warehouses":true}'),
        ('Custom', 'Custom', 'Configurable plan for negotiated requirements.', 'custom', 0, 1, 1000, 1000000, 1000000, 1000000, 102400, '{}', '{"customers":true,"sales":true,"purchases":true,"inventory":true,"reports":true,"advanced_reports":true,"warehouses":true,"custom":true}')
    `);
    const featureDefinitions = [
      ['dashboard', 'Dashboard'], ['customers', 'Customers'], ['suppliers', 'Suppliers'], ['sales', 'Sales'],
      ['invoices', 'Invoices'], ['purchases', 'Purchases'], ['inventory', 'Inventory'], ['expenses', 'Expenses'],
      ['basic_reports', 'Basic Reports'], ['hr', 'HR'], ['employees', 'Employees'], ['attendance', 'Attendance'],
      ['payroll', 'Payroll'], ['crm', 'CRM'], ['loyalty', 'Loyalty'], ['qr_code', 'QR Code'], ['barcode', 'Barcode'],
      ['audit_logs', 'Audit Logs'], ['advanced_reports', 'Advanced Reports'], ['multi_branch', 'Multiple Branches'],
      ['multi_warehouse', 'Multiple Warehouses'], ['approval_system', 'Approval System'], ['api_access', 'API Access']
    ];
    for (const [featureKey, displayName] of featureDefinitions) {
      db.run('INSERT OR IGNORE INTO features (feature_key, display_name) VALUES (?, ?)', [featureKey, displayName]);
    }
    db.run(`INSERT OR IGNORE INTO plan_features (plan_id, feature_id, is_enabled)
      SELECT p.id, f.id, 1 FROM plans p JOIN features f ON f.feature_key IN (${NORMAL_FEATURES.map(() => '?').join(',')})
      WHERE p.slug = 'normal'`, NORMAL_FEATURES);
    db.run(`INSERT OR IGNORE INTO plan_features (plan_id, feature_id, is_enabled)
      SELECT p.id, f.id, 1 FROM plans p JOIN features f ON f.feature_key IN (${ENTERPRISE_FEATURES.map(() => '?').join(',')})
      WHERE p.slug = 'enterprise'`, ENTERPRISE_FEATURES);
    db.run(`INSERT OR IGNORE INTO plan_features (plan_id, feature_id, is_enabled)
      SELECT p.id, f.id, 1 FROM plans p JOIN features f ON f.feature_key IN (${NORMAL_FEATURES.map(() => '?').join(',')})
      WHERE p.slug = 'monthly'`, NORMAL_FEATURES);
    db.run(`INSERT OR IGNORE INTO plan_features (plan_id, feature_id, is_enabled)
      SELECT p.id, f.id, 1 FROM plans p JOIN features f ON f.feature_key IN (${ENTERPRISE_FEATURES.map(() => '?').join(',')})
      WHERE p.slug IN ('quarterly', 'annual')`, ENTERPRISE_FEATURES);
    db.run(`INSERT INTO subscriptions (company_id, plan_id, status, start_date, end_date, price, payment_status, renewal_date)
      SELECT c.id, (SELECT id FROM plans WHERE slug = 'normal'), 'trial', date('now'), date('now', '+14 days'), 0, 'pending', date('now', '+14 days')
      FROM companies c WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.company_id = c.id)`);
    db.run(`UPDATE products SET company_id = (SELECT id FROM companies ORDER BY id LIMIT 1) WHERE company_id IS NULL`);
    db.run(`UPDATE customers SET company_id = (SELECT id FROM companies ORDER BY id LIMIT 1) WHERE company_id IS NULL`);
    db.run(`UPDATE suppliers SET company_id = (SELECT id FROM companies ORDER BY id LIMIT 1) WHERE company_id IS NULL`);
    db.run(`UPDATE sales SET company_id = (SELECT id FROM companies ORDER BY id LIMIT 1) WHERE company_id IS NULL`);
    db.run(`UPDATE sale_items SET company_id = (SELECT company_id FROM sales WHERE sales.id = sale_items.sale_id) WHERE company_id IS NULL`);
    db.run(`UPDATE purchases SET company_id = (SELECT id FROM companies ORDER BY id LIMIT 1) WHERE company_id IS NULL`);
    db.run(`UPDATE purchase_items SET company_id = (SELECT company_id FROM purchases WHERE purchases.id = purchase_items.purchase_id) WHERE company_id IS NULL`);
    db.run(`UPDATE expenses SET company_id = (SELECT id FROM companies ORDER BY id LIMIT 1) WHERE company_id IS NULL`);
    db.run(`UPDATE payments SET company_id = (SELECT id FROM companies ORDER BY id LIMIT 1) WHERE company_id IS NULL`);
    db.run(`INSERT INTO warehouses (company_id, name, address) SELECT id, 'Main Warehouse', address FROM companies WHERE NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.company_id = companies.id)`);
    db.run(`
      INSERT INTO stock_movements (company_id, warehouse_id, product_id, customer_id, movement_type, quantity, reference, created_at)
      SELECT s.company_id, (SELECT id FROM warehouses WHERE company_id = s.company_id ORDER BY id LIMIT 1), si.product_id, c.id, 'customer_out', si.quantity, 'SALE-' || s.id, s.created_at
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.id
      LEFT JOIN customers c ON c.company_id = s.company_id AND c.name = s.customer_name
      WHERE NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.company_id = s.company_id AND sm.reference = 'SALE-' || s.id AND sm.product_id = si.product_id)
    `);
    db.run(`
      INSERT INTO stock_movements (company_id, warehouse_id, product_id, movement_type, quantity, reference, created_at)
      SELECT p.company_id, (SELECT id FROM warehouses WHERE company_id = p.company_id ORDER BY id LIMIT 1), pi.product_id, 'stock_in', pi.quantity, 'PURCHASE-' || p.id, p.created_at
      FROM purchases p
      JOIN purchase_items pi ON pi.purchase_id = p.id
      WHERE NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.company_id = p.company_id AND sm.reference = 'PURCHASE-' || p.id AND sm.product_id = pi.product_id)
    `);

    if (bootstrapSuperAdminPassword) {
      db.run(`INSERT INTO users (company_id, username, password_hash, name, role) SELECT NULL, 'superadmin', ?, 'Platform Owner', 'super_admin' WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'superadmin')`, [hashPassword(bootstrapSuperAdminPassword)]);
    }
    if (bootstrapCompanyAdminPassword) {
      db.run(`INSERT INTO users (company_id, username, password_hash, name, role, must_change_password) SELECT (SELECT id FROM companies ORDER BY id LIMIT 1), 'admin', ?, 'Company Admin', 'company_admin', ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin')`, [hashPassword(bootstrapCompanyAdminPassword), process.env.NODE_ENV === 'test' ? 0 : 1]);
    }

    db.get('SELECT COUNT(*) AS count FROM products', (err, row) => {
      if (err) return console.error('Seed check failed:', err.message);
      if (row.count === 0) {
        db.run(`
          INSERT INTO products (company_id, name, category, purchase_price, sale_price, stock) VALUES
          ((SELECT id FROM companies ORDER BY id LIMIT 1), 'TEMO 19L Bottle', 'Large Format Water', 420, 550, 35),
          ((SELECT id FROM companies ORDER BY id LIMIT 1), 'TEMO 1.5L Bottle', 'Bottled Water', 55, 85, 120),
          ((SELECT id FROM companies ORDER BY id LIMIT 1), 'TEMO 500ml Bottle', 'Bottled Water', 28, 45, 180),
          ((SELECT id FROM companies ORDER BY id LIMIT 1), 'TEMO 6 Bottle Pack', 'Water Pack', 165, 240, 60),
          ((SELECT id FROM companies ORDER BY id LIMIT 1), 'Empty 19L Bottle', 'Returnable Bottle', 650, 850, 24)
        `);
      }
    });

    db.get('SELECT COUNT(*) AS count FROM customers', (err, row) => {
      if (err) return console.error('Customer seed check failed:', err.message);
      if (row.count === 0) {
        db.run(`
          INSERT INTO customers (company_id, name, phone, address) VALUES
          ((SELECT id FROM companies ORDER BY id LIMIT 1), 'Ali Khan', '0300-1111111', 'Lahore'),
          ((SELECT id FROM companies ORDER BY id LIMIT 1), 'Sara Ahmad', '0300-2222222', 'Karachi')
        `);
      }
    });

    db.get('SELECT COUNT(*) AS count FROM suppliers', (err, row) => {
      if (err) return console.error('Supplier seed check failed:', err.message);
      if (row.count === 0) {
        db.run(`
          INSERT INTO suppliers (company_id, name, phone, address) VALUES
          ((SELECT id FROM companies ORDER BY id LIMIT 1), 'Aqua Supplies', '0300-3333333', 'Islamabad'),
          ((SELECT id FROM companies ORDER BY id LIMIT 1), 'Prime Goods', '0300-4444444', 'Rawalpindi')
        `);
      }
    });
  });
}

function migrateCompanyDateFormat() {
  db.all('PRAGMA table_info(companies)', (error, columns) => {
    if (error || columns.some((column) => column.name === 'date_format')) return;
    db.run("ALTER TABLE companies ADD COLUMN date_format TEXT NOT NULL DEFAULT 'YYYY-MM-DD'", (migrationError) => {
      if (migrationError) console.error('Company date format migration failed:', migrationError.message);
    });
  });
}

function migrateDocumentEntityTypes() {
  db.get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'document_records'", (error, row) => {
    if (error || !row?.sql || row.sql.includes("'supplier'")) return;
    db.serialize(() => {
      const run = (sql) => db.run(sql, (migrationError) => {
        if (migrationError) console.error('Document entity migration failed:', migrationError.message);
      });
      run('PRAGMA foreign_keys = OFF');
      run('DROP TABLE IF EXISTS document_records_v4');
      run(`CREATE TABLE document_records_v4 (
        id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL,
        entity_type TEXT NOT NULL CHECK(entity_type IN ('company_asset','vehicle','employee','production_batch','lab_result','customer','supplier','supplier_contract','purchase_order','supplier_invoice')),
        entity_id INTEGER, title TEXT NOT NULL, document_type TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','revoked')), visibility TEXT NOT NULL DEFAULT 'company' CHECK(visibility IN ('company','restricted')),
        expires_on TEXT, current_version_id INTEGER, created_by INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(created_by) REFERENCES users(id)
      )`);
      run('INSERT INTO document_records_v4 (id, company_id, entity_type, entity_id, title, document_type, description, status, visibility, expires_on, current_version_id, created_by, created_at, updated_at) SELECT id, company_id, entity_type, entity_id, title, document_type, description, status, visibility, expires_on, current_version_id, created_by, created_at, updated_at FROM document_records');
      run('DROP TABLE document_records');
      run('ALTER TABLE document_records_v4 RENAME TO document_records');
      run('CREATE INDEX IF NOT EXISTS idx_documents_company_entity ON document_records(company_id, entity_type, entity_id)');
      run('CREATE INDEX IF NOT EXISTS idx_documents_company_expiry ON document_records(company_id, expires_on, status)');
      run('PRAGMA foreign_keys = ON');
    });
  });
}

initializeDatabase();
migrateCompanyDateFormat();
migrateDocumentEntityTypes();
franchiseService.initialize();

function publicHealthPayload() {
  return { status: 'ok', service: 'temo-aquaflow', uptimeSeconds: Math.floor(process.uptime()), timestamp: new Date().toISOString() };
}
async function readinessHandler(req, res) {
  try {
    await query('SELECT 1 AS ready');
    await franchiseService.ready();
    res.json({ ...publicHealthPayload(), ready: true, database: 'ok' });
  } catch (_) {
    res.status(503).json({ status: 'degraded', ready: false, database: 'unavailable' });
  }
}
app.get(['/health', '/api/health'], (req, res) => res.json(publicHealthPayload()));
app.get(['/readiness', '/api/readiness'], readinessHandler);
app.get(['/metrics', '/api/metrics'], (req, res) => {
  const averageDuration = runtimeMetrics.requests ? runtimeMetrics.durationsMs / runtimeMetrics.requests : 0;
  res.type('text/plain').send([
    `temo_requests_total ${runtimeMetrics.requests}`,
    `temo_errors_total ${runtimeMetrics.errors}`,
    `temo_request_duration_ms_avg ${averageDuration.toFixed(2)}`,
    `temo_process_uptime_seconds ${Math.floor(process.uptime())}`
  ].join('\n') + '\n');
});

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.headers['x-session-token'];
    if (!token) return res.status(401).json({ message: 'Authentication required.' });

    const rows = await query(`
      SELECT u.id, u.username, u.name, u.role, u.customer_id, u.company_id, u.language, u.must_change_password,
              c.name AS company_name, c.logo AS company_logo, c.default_language, c.active AS company_active, c.status AS company_status,
              u.status AS user_status
      FROM sessions s
      JOIN users u ON u.id = s.user_id AND u.active = 1
      LEFT JOIN companies c ON c.id = u.company_id
      WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
    `, [token]);
    const user = rows[0];
    if (!user || (user.company_id && !user.company_name) || user.user_status !== 'active' || (user.company_id && user.company_status !== 'active')) return res.status(401).json({ message: 'This account or company is not active.' });

    req.user = user;
    req.user.must_change_password = Boolean(user.must_change_password);
    req.companyId = user.company_id;
    if (user.role === 'customer' && !(['/logout', '/me'].includes(req.path) || req.path.startsWith('/customer/'))) {
      return res.status(403).json({ message: 'This account is restricted to the customer portal.' });
    }
    const adminScopedPaths = req.path.startsWith('/admin/')
      || req.path.startsWith('/companies/')
      || ['/company', '/company/usage'].includes(req.path);
    if (user.role === 'super_admin' && adminScopedPaths && req.headers['x-company-id']) {
      const company = await query('SELECT id FROM companies WHERE id = ?', [Number(req.headers['x-company-id'])]);
      if (!company[0]) return res.status(404).json({ message: 'Company not found.' });
      req.companyId = company[0].id;
    }
    if (req.companyId) {
      const company = (await query('SELECT id, name, active FROM companies WHERE id = ?', [req.companyId]))[0] || null;
      const subscription = await getCompanySubscription(req.companyId);
      req.subscription = subscription;
      req.subscriptionStatus = getSubscriptionStatus(subscription, company);
    } else {
      req.subscription = null;
      req.subscriptionStatus = getSubscriptionStatus(null, null);
    }
    req.passwordChangeRequired = req.user.must_change_password && req.user.role !== 'super_admin';
    req.tenant = {
      companyId: req.companyId || null,
      userId: user.id,
      isSuperAdmin: user.role === 'super_admin'
    };
    next();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }

}

async function checkSubscription(req, res, next) {
  if (!req.companyId || req.user?.role === 'super_admin') return next();
  if (req.subscriptionStatus?.usable) return next();
  const error = accessError(req.subscriptionStatus || { status: 'missing', companyId: req.companyId });
  return res.status(403).json({ success: false, ...error });
}

function featureForApiPath(pathname) {
  const path = String(pathname || '');
  if (/^\/(products|inventory)(\/|$)/.test(path)) return 'inventory';
  if (/^\/(bottles|vehicles|fleet|production)(\/|$)/.test(path)) return 'inventory';
  if (/^\/customers(\/|$)/.test(path)) return 'customers';
  if (/^\/suppliers(\/|$)|^\/supplier-/.test(path)) return 'suppliers';
  if (/^\/sales(\/|$)/.test(path)) return 'sales';
  if (/^\/(orders|deliveries|delivery-subscriptions|routes)(\/|$)/.test(path)) return 'sales';
  if (/\/invoice(\/|$)/.test(path)) return 'invoices';
  if (/^\/payments(\/|$)/.test(path)) return 'invoices';
  if (/^\/purchases(\/|$)|^\/quotation|^\/procurement/.test(path)) return 'purchases';
  if (/^\/expenses(\/|$)/.test(path)) return 'expenses';
  if (/^\/(complaints|customer-support)(\/|$)/.test(path)) return 'customers';
  if (/^\/(credit|pricing|price-lists)(\/|$)/.test(path)) return 'sales';
  if (/^\/(commissions|salesmen)(\/|$)/.test(path)) return 'crm';
  if (/^\/employees(\/|$)/.test(path)) return 'employees';
  if (/^\/attendance(\/|$)/.test(path)) return 'attendance';
  if (/^\/payroll(\/|$)/.test(path)) return 'payroll';
  if (/^\/loyalty(\/|$)/.test(path)) return 'loyalty';
  if (/^\/(crm|salesmen)(\/|$)|^\/reports\/loyalty/.test(path)) return 'crm';
  if (/^\/qr-(records|lookup)(\/|$)/.test(path)) return 'qr_code';
  if (/^\/barcode(\/|$)/.test(path)) return 'barcode';
  if (/^\/audit-logs(\/|$)/.test(path)) return 'audit_logs';
  if (/^\/(operations|backups?)(\/|$)/.test(path)) return 'audit_logs';
  if (/^\/report-definitions(\/|$)/.test(path)) return 'advanced_reports';
  if (/^\/reports(\/|$)/.test(path)) return 'basic_reports';
  if (/^\/warehouses(\/|$)/.test(path)) return 'multi_warehouse';
  if (/^\/territories(\/|$)/.test(path)) return 'multi_branch';
  if (/^\/franchises(\/|$)|^\/branches(\/|$)/.test(path)) return 'multi_branch';
  if (/^\/approvals?(\/|$)/.test(path)) return 'approval_system';
  if (/^\/(security\/api-keys|integrations)(\/|$)/.test(path)) return 'api_access';
  return null;
}

async function checkFeatureForRoute(req, res, next) {
  const featureKey = featureForApiPath(req.path);
  if (!featureKey || req.user?.role === 'super_admin') return next();
  return featureAccessService.requireFeature(featureKey)(req, res, next);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'You do not have permission for this action.' });
    next();
  };
}

function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'super_admin') {
    return res.status(403).json({ success: false, code: 'ADMIN_ACCESS_REQUIRED', message: 'Super Admin access required.' });
  }
  return next();
}

function requireCompanySubscriptionUser(req, res, next) {
  if (req.user?.role === 'super_admin') {
    return res.status(403).json({ success: false, code: 'SUPER_ADMIN_SUBSCRIPTION_FORBIDDEN', message: 'Super Admin does not use a company subscription.' });
  }
  return next();
}

function getPeriodRange(queryParams = {}) {
  const { type, date, startDate, endDate, month, year } = queryParams;
  let start = null;
  let end = null;

  if (type === 'daily' && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    start = date;
    end = next.toISOString().slice(0, 10);
  } else if (type === 'monthly' && month && /^\d{4}-\d{2}$/.test(month)) {
    const [selectedYear, selectedMonth] = month.split('-').map(Number);
    start = `${month}-01`;
    end = selectedMonth === 12 ? `${selectedYear + 1}-01-01` : `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-01`;
  } else if (type === 'annual' && year && /^\d{4}$/.test(year)) {
    start = `${year}-01-01`;
    end = `${Number(year) + 1}-01-01`;
  } else if (type === 'custom' && startDate && endDate) {
    const next = new Date(`${endDate}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    start = startDate;
    end = next.toISOString().slice(0, 10);
  }

  return { start, end };
}

async function writeAudit(req, action, entityType, entityId, previousValue = null, newValue = null) {
  await insert(
    'INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, previous_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.companyId, req.user?.id || null, action, entityType, entityId || null, previousValue ? JSON.stringify(previousValue) : null, newValue ? JSON.stringify(newValue) : null]
  );
}

app.use('/api', (req, res, next) => {
  if (['/login', '/signup', '/forgot-password', '/reset-password', '/driver/password-reset/request', '/driver/password-reset/confirm', '/customer/login', '/health', '/readiness', '/metrics'].includes(req.path)) return next();
  if (req.path.startsWith('/subscription') || ['/me', '/me/password', '/logout'].includes(req.path) || req.path.startsWith('/admin/')) return requireAuth(req, res, next);
  return requireAuth(req, res, (error) => {
    if (error) return next(error);
    if (req.passwordChangeRequired) return res.status(403).json({ success: false, code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change your temporary password before using the ERP.' });
    return checkSubscription(req, res, (subscriptionError) => {
      if (subscriptionError) return next(subscriptionError);
      return checkFeatureForRoute(req, res, next);
    });
  });
});

createDriverPermissionRoutes({app,query,insert});
createDriverDeliveryPolicyRoutes({app,query});
aiAutomationService.registerRoutes(app, requireAuth, requireRole);
whatsappAssistantService.registerRoutes(app, requireAuth, requireRole);
platformOperationsService.registerRoutes(app, requireAuth, requireRole);
franchiseService.registerRoutes(app);
const supplierProcurementService = createSupplierProcurementService({ query, insert, update, writeAudit });
supplierProcurementService.registerRoutes(app, requireRole);

const documentReadRoles = ['super_admin', 'company_admin', 'manager', 'accountant', 'sales_staff', 'inventory_staff', 'staff', 'driver', 'delivery_driver', 'lab_technician', 'quality_manager', 'production_manager'];
const documentManageRoles = ['super_admin', 'company_admin', 'manager', 'quality_manager', 'production_manager'];
const documentTargetTables = { company_asset: 'equipment_assets', vehicle: 'vehicles', employee: 'employees', production_batch: 'production_batches', lab_result: 'lab_tests', customer: 'customers', supplier: 'suppliers', supplier_contract: 'supplier_contracts', purchase_order: 'purchase_orders', supplier_invoice: 'supplier_invoices' };
const documentDate = (value) => value == null || value === '' || /^\d{4}-\d{2}-\d{2}$/.test(String(value));
async function validateDocumentTarget(companyId, entityType, entityId) {
  if (!Object.prototype.hasOwnProperty.call(documentTargetTables, entityType)) return false;
  if (entityId == null || entityId === '') return entityType === 'company_asset';
  return Boolean((await query(`SELECT id FROM ${documentTargetTables[entityType]} WHERE id = ? AND company_id = ?`, [Number(entityId), companyId]))[0]);
}
function documentViewAllowed(req, document, accessRows = []) {
  if (document.visibility !== 'restricted') return true;
  return accessRows.some((row) => row.role === req.user.role && Number(row.can_view) === 1);
}

app.get('/api/documents', requireRole(...documentReadRoles), async (req, res) => {
  try {
    const params = [req.companyId]; let sql = `SELECT d.*, v.version_number, v.original_filename, v.mime_type, v.byte_size, v.checksum_sha256, v.upload_status, v.preview_available FROM document_records d LEFT JOIN document_versions v ON v.id = d.current_version_id WHERE d.company_id = ?`;
    if (req.query.entityType && Object.prototype.hasOwnProperty.call(documentTargetTables, req.query.entityType)) { sql += ' AND d.entity_type = ?'; params.push(req.query.entityType); }
    if (req.query.entityId) { sql += ' AND d.entity_id = ?'; params.push(Number(req.query.entityId)); }
    if (req.query.status) { sql += ' AND d.status = ?'; params.push(String(req.query.status)); }
    sql += ' ORDER BY COALESCE(d.expires_on, \'9999-12-31\'), d.updated_at DESC, d.id DESC LIMIT 500';
    const rows = await query(sql, params); const visible = [];
    for (const row of rows) { const access = await query('SELECT role, can_view, can_download FROM document_access WHERE company_id = ? AND document_id = ?', [req.companyId, row.id]); if (documentViewAllowed(req, row, access)) visible.push({ ...row, access: access.find((item) => item.role === req.user.role) || null }); }
    res.json(visible);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/documents', requireRole(...documentManageRoles), async (req, res) => {
  try {
    const b = req.body || {}, entityType = String(b.entityType || ''), entityId = b.entityId == null || b.entityId === '' ? null : Number(b.entityId);
    const title = String(b.title || '').trim(), documentType = String(b.documentType || '').trim(), visibility = b.visibility === 'restricted' ? 'restricted' : 'company';
    const reminderDays = b.remindBeforeDays === undefined || b.remindBeforeDays === '' ? 30 : Number(b.remindBeforeDays);
    if (!title || title.length > 160 || !documentType || documentType.length > 80 || !documentDate(b.expiresOn) || !Number.isInteger(reminderDays) || reminderDays < 0 || reminderDays > 3650 || !(await validateDocumentTarget(req.companyId, entityType, entityId))) return res.status(400).json({ message: 'Valid document title, type, target, expiry date and reminder are required.' });
    const result = await insert('INSERT INTO document_records (company_id, entity_type, entity_id, title, document_type, description, visibility, expires_on, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, entityType, entityId, title, documentType, String(b.description || '').trim().slice(0, 2000), visibility, b.expiresOn || null, req.user.id]);
    if (b.expiresOn) await insert('INSERT INTO document_reminders (company_id, document_id, remind_before_days) VALUES (?, ?, ?)', [req.companyId, result.id, reminderDays]);
    const row = (await query('SELECT * FROM document_records WHERE id = ? AND company_id = ?', [result.id, req.companyId]))[0];
    await writeAudit(req, 'create', 'document', result.id, null, row); res.status(201).json(row);
  } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 500).json({ message: error.message }); }
});

app.post('/api/documents/:id/versions', requireRole(...documentManageRoles), async (req, res) => {
  try {
    const id = Number(req.params.id), document = (await query('SELECT * FROM document_records WHERE id = ? AND company_id = ?', [id, req.companyId]))[0];
    const b = req.body || {}, filename = String(b.originalFilename || '').trim(), mimeType = String(b.mimeType || '').trim().toLowerCase(), byteSize = Number(b.byteSize), checksum = String(b.checksumSha256 || '').trim().toLowerCase();
    if (!document || !filename || filename.length > 160 || !/^[^/]+\/[^/]+$/.test(mimeType) || !Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > 50 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(checksum)) return res.status(400).json({ message: 'Valid filename, MIME type, size (max 50 MB) and SHA-256 checksum are required.' });
    const latest = (await query('SELECT COALESCE(MAX(version_number), 0) AS version FROM document_versions WHERE company_id = ? AND document_id = ?', [req.companyId, id]))[0].version + 1;
    const version = await insert('INSERT INTO document_versions (company_id, document_id, version_number, original_filename, mime_type, byte_size, checksum_sha256, upload_status, preview_available, created_by, storage_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, id, latest, filename, mimeType, byteSize, checksum, ['pending','uploaded','quarantined','rejected'].includes(b.uploadStatus) ? b.uploadStatus : 'pending', mimeType === 'application/pdf' || mimeType.startsWith('image/') ? 1 : 0, req.user.id, `pending/${crypto.randomBytes(16).toString('hex')}`]);
    const descriptor = documentStorage.createUploadDescriptor(req.companyId, id, version.id, filename);
    await update('UPDATE document_versions SET storage_provider = ?, storage_key = ? WHERE id = ? AND company_id = ?', [descriptor.provider, descriptor.storageKey, version.id, req.companyId]);
    await update('UPDATE document_records SET current_version_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [version.id, id, req.companyId]);
    const row = (await query('SELECT * FROM document_versions WHERE id = ? AND company_id = ?', [version.id, req.companyId]))[0]; await writeAudit(req, 'version', 'document', id, null, row);
    res.status(201).json({ version: row, upload: descriptor });
  } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 500).json({ message: error.message }); }
});

app.patch('/api/documents/:id/status', requireRole(...documentManageRoles), async (req, res) => {
  try { const id = Number(req.params.id), status = String(req.body?.status || ''); if (!['active','archived','revoked'].includes(status)) return res.status(400).json({ message: 'Invalid document status.' }); const existing = (await query('SELECT * FROM document_records WHERE id = ? AND company_id = ?', [id, req.companyId]))[0]; if (!existing) return res.status(404).json({ message: 'Document not found.' }); await update('UPDATE document_records SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [status, id, req.companyId]); const row = (await query('SELECT * FROM document_records WHERE id = ? AND company_id = ?', [id, req.companyId]))[0]; await writeAudit(req, 'status_change', 'document', id, existing, row); res.json(row); } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/documents/:id/versions', requireRole(...documentReadRoles), async (req, res) => {
  try { const document = (await query('SELECT * FROM document_records WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]; if (!document) return res.status(404).json({ message: 'Document not found.' }); const access = await query('SELECT role, can_view FROM document_access WHERE company_id = ? AND document_id = ?', [req.companyId, document.id]); if (!documentViewAllowed(req, document, access)) return res.status(403).json({ message: 'You do not have access to this document.' }); res.json(await query('SELECT id, document_id, version_number, original_filename, mime_type, byte_size, checksum_sha256, storage_provider, storage_key, upload_status, preview_available, created_at FROM document_versions WHERE company_id = ? AND document_id = ? ORDER BY version_number DESC', [req.companyId, document.id])); } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/documents/:id/:action', requireRole(...documentReadRoles), async (req, res) => {
  try { if (!['download','preview'].includes(req.params.action)) return res.status(404).json({ message: 'Unknown document action.' }); const document = (await query('SELECT d.*, v.* FROM document_records d LEFT JOIN document_versions v ON v.id = d.current_version_id WHERE d.id = ? AND d.company_id = ?', [Number(req.params.id), req.companyId]))[0]; if (!document) return res.status(404).json({ message: 'Document not found.' }); const access = await query('SELECT role, can_view, can_download FROM document_access WHERE company_id = ? AND document_id = ?', [req.companyId, document.id]); if (!documentViewAllowed(req, document, access) || (req.params.action === 'download' && document.visibility === 'restricted' && !access.some((row) => row.role === req.user.role && Number(row.can_download) === 1))) return res.status(403).json({ message: 'You do not have access to this document action.' }); await writeAudit(req, req.params.action, 'document', document.id, null, { versionId: document.id }); res.json({ documentId: document.id, versionId: document.current_version_id, filename: document.original_filename, mimeType: document.mime_type, byteSize: document.byte_size, checksumSha256: document.checksum_sha256, storage: documentStorage.getAccessDescriptor(document), note: 'File bytes are served by the configured storage adapter.' }); } catch (error) { res.status(500).json({ message: error.message }); }
});

app.put('/api/documents/:id/access', requireRole(...documentManageRoles), async (req, res) => {
  try { const id = Number(req.params.id), document = (await query('SELECT id FROM document_records WHERE id = ? AND company_id = ?', [id, req.companyId]))[0]; if (!document || !Array.isArray(req.body?.roles)) return res.status(400).json({ message: 'Document and roles are required.' }); await update('DELETE FROM document_access WHERE company_id = ? AND document_id = ?', [req.companyId, id]); for (const item of req.body.roles.slice(0, 20)) { const role = String(item.role || '').trim(); if (role && role.length <= 40) await insert('INSERT INTO document_access (company_id, document_id, role, can_view, can_download) VALUES (?, ?, ?, ?, ?)', [req.companyId, id, role, item.canView === false ? 0 : 1, item.canDownload === true ? 1 : 0]); } await writeAudit(req, 'access_update', 'document', id, null, req.body.roles); res.json(await query('SELECT role, can_view, can_download FROM document_access WHERE company_id = ? AND document_id = ?', [req.companyId, id])); } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/documents/reminders', requireRole(...documentReadRoles), async (req, res) => {
  try { const rows = await query(`SELECT d.id, d.title, d.entity_type, d.entity_id, d.expires_on, r.remind_before_days, CASE WHEN date(d.expires_on) < date('now') THEN 'expired' WHEN date(d.expires_on) <= date('now', '+' || r.remind_before_days || ' day') THEN 'due' ELSE 'upcoming' END AS reminder_status FROM document_records d JOIN document_reminders r ON r.document_id = d.id AND r.company_id = d.company_id WHERE d.company_id = ? AND d.status = 'active' AND d.expires_on IS NOT NULL ORDER BY d.expires_on LIMIT 500`, [req.companyId]); res.json(rows); } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/documents/:id/reminder', requireRole(...documentManageRoles), async (req, res) => {
  try { const id = Number(req.params.id), days = Number(req.body?.remindBeforeDays); if (!Number.isInteger(days) || days < 0 || days > 3650 || !(await query('SELECT id FROM document_records WHERE id = ? AND company_id = ?', [id, req.companyId]))[0]) return res.status(400).json({ message: 'Valid document and reminder days are required.' }); await update('INSERT INTO document_reminders (company_id, document_id, remind_before_days) VALUES (?, ?, ?) ON CONFLICT(company_id, document_id) DO UPDATE SET remind_before_days = excluded.remind_before_days', [req.companyId, id, days]); await writeAudit(req, 'reminder_update', 'document', id, null, { remindBeforeDays: days }); res.json((await query('SELECT * FROM document_reminders WHERE company_id = ? AND document_id = ?', [req.companyId, id]))[0]); } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/certificates', requireRole(...documentReadRoles), async (req, res) => { try { await update("UPDATE certificates SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND status = 'active' AND expires_on IS NOT NULL AND date(expires_on) < date('now')", [req.companyId]); const rows = await query(`SELECT c.*, d.title AS document_title FROM certificates c LEFT JOIN document_records d ON d.id = c.document_id AND d.company_id = c.company_id WHERE c.company_id = ? ORDER BY COALESCE(c.expires_on, '9999-12-31'), c.id DESC`, [req.companyId]); res.json(rows); } catch (error) { res.status(500).json({ message: error.message }); } });
app.post('/api/certificates', requireRole(...documentManageRoles), async (req, res) => { try { const b=req.body||{}, number=String(b.certificateNumber||'').trim(), type=String(b.certificateType||'').trim(), entityType=String(b.entityType||''), entityId=b.entityId==null||b.entityId===''?null:Number(b.entityId), issuedOn=String(b.issuedOn||'').trim(); if(!number||number.length>100||!type||type.length>100||!/^\\d{4}-\\d{2}-\\d{2}$/.test(issuedOn)||!documentDate(b.expiresOn)||!(await validateDocumentTarget(req.companyId,entityType,entityId))) return res.status(400).json({message:'Valid certificate number, type, target and issued date are required.'}); const r=await insert('INSERT INTO certificates (company_id,certificate_number,certificate_type,entity_type,entity_id,document_id,issued_on,expires_on,status,issuer,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[req.companyId,number,type,entityType,entityId,b.documentId?Number(b.documentId):null,issuedOn,b.expiresOn||null,['draft','active','revoked','superseded'].includes(b.status)?b.status:'active',String(b.issuer||'').trim().slice(0,160),String(b.notes||'').trim().slice(0,2000),req.user.id]); const row=(await query('SELECT * FROM certificates WHERE id=? AND company_id=?',[r.id,req.companyId]))[0]; await writeAudit(req,'create','certificate',r.id,null,row); res.status(201).json(row); } catch(error){res.status(error.message.includes('UNIQUE')?409:500).json({message:error.message});} });
app.patch('/api/certificates/:id/status', requireRole(...documentManageRoles), async (req,res)=>{ try { const id=Number(req.params.id), status=String(req.body?.status||''); if(!['draft','active','expired','revoked','superseded'].includes(status)) return res.status(400).json({message:'Invalid certificate status.'}); const existing=(await query('SELECT * FROM certificates WHERE id=? AND company_id=?',[id,req.companyId]))[0]; if(!existing)return res.status(404).json({message:'Certificate not found.'}); await update('UPDATE certificates SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?',[status,id,req.companyId]); const row=(await query('SELECT * FROM certificates WHERE id=? AND company_id=?',[id,req.companyId]))[0]; await writeAudit(req,'status_change','certificate',id,existing,row); res.json(row); } catch(error){res.status(500).json({message:error.message});} });

const exportRoles = ['super_admin', 'company_admin', 'manager', 'accountant'];
const backupRoles = ['super_admin'];

function parseExportDate(value, fieldName) {
  if (value === undefined || value === '') return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${fieldName} must be a valid date in YYYY-MM-DD format.`);
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error(`${fieldName} must be a valid date in YYYY-MM-DD format.`);
  return text;
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(res, headers, rows) {
  res.write(`${headers.map(csvCell).join(',')}\r\n`);
  rows.forEach((row) => res.write(`${headers.map((header) => csvCell(row[header])).join(',')}\r\n`));
}

function exportDateClause(column, from, to) {
  return { sql: `${from ? ` AND ${column} >= ?` : ''}${to ? ` AND ${column} < date(?, '+1 day')` : ''}`, params: [...(from ? [from] : []), ...(to ? [to] : [])] };
}

app.use('/api', (req, res, next) => {
  if (['/login', '/signup', '/forgot-password', '/reset-password', '/driver/password-reset/request', '/driver/password-reset/confirm', '/customer/login', '/health', '/readiness', '/metrics'].includes(req.path) || req.path.startsWith('/whatsapp/webhook/')) return next();
  return requireAuth(req, res, next);
});

const customerPortalPaths = ['/customer/', '/me'];
function requireCustomer(req, res, next) {
  if (req.user?.role !== 'customer' || !req.user.customer_id) return res.status(403).json({ message: 'Customer portal access required.' });
  next();
}

const customerPortalRoles = ['super_admin', 'company_admin', 'manager'];

app.get('/api/customer/me', requireCustomer, async (req, res) => {
  try {
    const customer = (await query(`SELECT c.id, c.name, c.email, c.phone, c.address, c.area, c.created_at, u.email AS login_email
      FROM customers c JOIN users u ON u.customer_id = c.id AND u.company_id = c.company_id
      WHERE c.id = ? AND c.company_id = ? AND u.id = ?`, [req.user.customer_id, req.companyId, req.user.id]))[0];
    if (!customer) return res.status(404).json({ message: 'Customer profile not found.' });
    res.json({ customer, user: { id: req.user.id, name: req.user.name, email: req.user.email } });
  } catch (error) { res.status(500).json({ message: 'Unable to load profile.' }); }
});

async function customerScope(req) {
  return (await query('SELECT id, name, email, phone, address FROM customers WHERE id = ? AND company_id = ?', [req.user.customer_id, req.companyId]))[0] || null;
}

app.get('/api/customer/dashboard', requireCustomer, async (req, res) => {
  try {
    const customer = await customerScope(req);
    if (!customer) return res.status(404).json({ message: 'Customer profile not found.' });
    const [orders, invoices, payments, subscriptions, complaints, bottleRows] = await Promise.all([
      query('SELECT id, customer_name, delivery_address, status, total_amount, created_at, updated_at FROM orders WHERE company_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT 10', [req.companyId, customer.id]),
      query('SELECT id, invoice_number, total_amount, status, due_date, created_at FROM sales WHERE company_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT 10', [req.companyId, customer.id]),
      query('SELECT id, amount, method, direction, reference, note, created_at FROM payments WHERE company_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT 20', [req.companyId, customer.id]),
      query(`SELECT ds.id, ds.quantity, ds.frequency, ds.next_due_date, ds.status, ds.delivery_address, p.name AS product_name
        FROM delivery_subscriptions ds JOIN products p ON p.id = ds.product_id AND p.company_id = ds.company_id
        WHERE ds.company_id = ? AND ds.customer_id = ? ORDER BY ds.status = 'active' DESC, ds.next_due_date`, [req.companyId, customer.id]),
      query('SELECT id, title, description, priority, status, notes, resolution, created_at, updated_at FROM complaints WHERE company_id = ? AND customer_id = ? ORDER BY updated_at DESC LIMIT 20', [req.companyId, customer.id]),
      query(`SELECT COALESCE(SUM(CASE WHEN movement_type IN ('customer_out','dispatched','driver_dispatched') THEN quantity WHEN movement_type IN ('customer_return','returned','driver_returned') THEN -quantity ELSE 0 END), 0) AS balance
        FROM bottle_movements WHERE company_id = ? AND customer_id = ?`, [req.companyId, customer.id])
    ]);
    const totalInvoiced = invoices.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const totalPaid = payments.filter((row) => row.direction !== 'payment').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    res.json({ customer, orders, invoices, payments, subscriptions, complaints, bottleBalance: Number(bottleRows[0]?.balance || 0), account: { totalInvoiced, totalPaid, outstanding: Math.max(0, totalInvoiced - totalPaid) } });
  } catch (error) { res.status(500).json({ message: 'Unable to load customer dashboard.' }); }
});

app.get('/api/customer/products', requireCustomer, async (req, res) => {
  try { res.json(await query('SELECT id, name, category, sale_price, stock, unit FROM products WHERE company_id = ? AND stock > 0 ORDER BY name', [req.companyId])); }
  catch (error) { res.status(500).json({ message: 'Unable to load product catalogue.' }); }
});

app.get('/api/customer/orders', requireCustomer, async (req, res) => {
  try { res.json(await query('SELECT o.*, d.status AS delivery_status, d.scheduled_date FROM orders o LEFT JOIN deliveries d ON d.order_id = o.id AND d.company_id = o.company_id WHERE o.company_id = ? AND o.customer_id = ? ORDER BY o.created_at DESC', [req.companyId, req.user.customer_id])); }
  catch (error) { res.status(500).json({ message: 'Unable to load orders.' }); }
});

app.get('/api/customer/invoices', requireCustomer, async (req, res) => {
  try { res.json(await query('SELECT id, invoice_number, total_amount, status, due_date, created_at FROM sales WHERE company_id = ? AND customer_id = ? ORDER BY created_at DESC', [req.companyId, req.user.customer_id])); }
  catch (error) { res.status(500).json({ message: 'Unable to load invoices.' }); }
});

app.get('/api/customer/payments', requireCustomer, async (req, res) => {
  try { const customer = await customerScope(req); res.json(customer ? await query('SELECT id, amount, method, direction, reference, note, created_at FROM payments WHERE company_id = ? AND customer_id = ? ORDER BY created_at DESC', [req.companyId, customer.id]) : []); }
  catch (error) { res.status(500).json({ message: 'Unable to load payments.' }); }
});

app.get('/api/customer/subscriptions', requireCustomer, async (req, res) => {
  try { res.json(await query(`SELECT ds.*, p.name AS product_name FROM delivery_subscriptions ds JOIN products p ON p.id = ds.product_id AND p.company_id = ds.company_id WHERE ds.company_id = ? AND ds.customer_id = ? ORDER BY ds.next_due_date`, [req.companyId, req.user.customer_id])); }
  catch (error) { res.status(500).json({ message: 'Unable to load subscriptions.' }); }
});

app.get('/api/customer/complaints', requireCustomer, async (req, res) => {
  try { res.json(await query('SELECT id, title, description, priority, status, notes, resolution, created_at, updated_at FROM complaints WHERE company_id = ? AND customer_id = ? ORDER BY updated_at DESC', [req.companyId, req.user.customer_id])); }
  catch (error) { res.status(500).json({ message: 'Unable to load complaints.' }); }
});

app.post('/api/customer/complaints', requireCustomer, async (req, res) => {
  try {
    const payload = complaintPayload(req.body);
    if (payload.error) return res.status(400).json({ message: payload.error });
    const result = await insert('INSERT INTO complaints (company_id, customer_id, title, description, priority, created_by) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, req.user.customer_id, payload.title, payload.description, payload.priority, req.user.id]);
    const complaint = (await query('SELECT id, title, description, priority, status, created_at FROM complaints WHERE id = ? AND company_id = ? AND customer_id = ?', [result.id, req.companyId, req.user.customer_id]))[0];
    await writeAudit(req, 'create', 'customer_complaint', result.id, null, complaint);
    res.status(201).json(complaint);
  } catch (error) { res.status(500).json({ message: 'Unable to create complaint.' }); }
});

app.post('/api/customer/orders', requireCustomer, async (req, res) => {
  try {
    const customer = await customerScope(req);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!customer || !items.length) return res.status(400).json({ message: 'At least one product is required.' });
    const records = []; let total = 0;
    for (const item of items) {
      const quantity = Number(item.quantity); const product = (await query('SELECT id, name, sale_price FROM products WHERE id = ? AND company_id = ? AND stock >= ?', [Number(item.productId), req.companyId, quantity]))[0];
      if (!product || !Number.isInteger(quantity) || quantity < 1) return res.status(400).json({ message: 'Each item must contain an available product and positive whole quantity.' });
      const lineTotal = Number(product.sale_price) * quantity; records.push({ product, quantity, lineTotal }); total += lineTotal;
    }
    const orderResult = await insert('INSERT INTO orders (company_id, customer_id, customer_name, delivery_address, notes, total_amount, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.companyId, customer.id, customer.name, String(req.body.deliveryAddress || customer.address || '').slice(0, 500), String(req.body.notes || '').slice(0, 1000), total, req.user.id]);
    for (const row of records) await insert('INSERT INTO order_items (company_id, order_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, orderResult.id, row.product.id, row.quantity, row.product.sale_price, row.lineTotal]);
    await writeAudit(req, 'create', 'customer_order', orderResult.id, null, { total, itemCount: records.length });
    res.status(201).json(await getOrderById(orderResult.id, req.companyId));
  } catch (error) { res.status(500).json({ message: 'Unable to place order.' }); }
});

app.get('/api/customer/bottle-balance', requireCustomer, async (req, res) => {
  try { const rows = await query(`SELECT b.id, b.name, b.capacity_litres, COALESCE(SUM(CASE WHEN bm.movement_type IN ('customer_out','dispatched','driver_dispatched') THEN bm.quantity WHEN bm.movement_type IN ('customer_return','returned','driver_returned') THEN -bm.quantity ELSE 0 END), 0) AS balance FROM bottles b LEFT JOIN bottle_movements bm ON bm.bottle_id = b.id AND bm.company_id = b.company_id AND bm.customer_id = ? WHERE b.company_id = ? GROUP BY b.id ORDER BY b.name`, [req.user.customer_id, req.companyId]); res.json(rows); }
  catch (error) { res.status(500).json({ message: 'Unable to load bottle balance.' }); }
});

app.patch('/api/customer/profile', requireCustomer, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim(); const phone = String(req.body?.phone || '').trim(); const address = String(req.body?.address || '').trim();
    if (!name || name.length > 160 || phone.length > 40 || address.length > 500) return res.status(400).json({ message: 'Please provide valid profile values.' });
    await update('UPDATE customers SET name = ?, phone = ?, address = ?, email = ? WHERE id = ? AND company_id = ?', [name, phone, address, String(req.body?.email || '').trim().slice(0, 160), req.user.customer_id, req.companyId]);
    await update('UPDATE users SET name = ?, email = ? WHERE id = ? AND company_id = ? AND customer_id = ?', [name, String(req.body?.email || '').trim().slice(0, 160), req.user.id, req.companyId, req.user.customer_id]);
    await writeAudit(req, 'update', 'customer_profile', req.user.customer_id, null, { name, phone, address });
    res.json((await customerScope(req)));
  } catch (error) { res.status(500).json({ message: 'Unable to update profile.' }); }
});

app.post('/api/customers/:id/portal-access', requireRole(...customerPortalRoles), async (req, res) => {
  try {
    const customerId = Number(req.params.id); const customer = (await query('SELECT * FROM customers WHERE id = ? AND company_id = ?', [customerId, req.companyId]))[0];
    const email = String(req.body?.email || customer?.email || '').trim().toLowerCase(); const password = String(req.body?.password || '');
    if (!customer) return res.status(404).json({ message: 'Customer not found.' });
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return res.status(400).json({ message: 'A valid email and password of at least 8 characters are required.' });
    const username = `customer_${customerId}`; const existing = (await query('SELECT id FROM users WHERE (LOWER(email) = ? OR username = ?) AND id != COALESCE(?, -1)', [email, username, null]))[0];
    if (existing) return res.status(409).json({ message: 'That email or customer portal username is already in use.' });
    const linked = (await query('SELECT id FROM users WHERE customer_id = ? AND company_id = ?', [customerId, req.companyId]))[0];
    if (linked) await update('UPDATE users SET email = ?, name = ?, password_hash = ?, role = \'customer\', active = 1 WHERE id = ?', [email, customer.name, hashPassword(password), linked.id]);
    else await insert('INSERT INTO users (company_id, customer_id, username, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?, ?, \'customer\')', [req.companyId, customerId, username, email, hashPassword(password), customer.name]);
    await update('UPDATE customers SET email = ? WHERE id = ? AND company_id = ?', [email, customerId, req.companyId]);
    await writeAudit(req, 'provision', 'customer_portal_access', customerId, null, { email });
    res.status(201).json({ success: true, username, email });
  } catch (error) { res.status(500).json({ message: 'Unable to provision portal access.' }); }
});

const qrEntityTypes = ['customer', 'bottle', 'product', 'order', 'delivery'];
const qrReadRoles = ['super_admin', 'company_admin', 'manager', 'accountant', 'sales_staff', 'staff', 'driver', 'delivery_driver'];
const qrWriteRoles = ['super_admin', 'company_admin', 'manager', 'sales_staff', 'staff'];
const qrEntityTables = {
  customer: { table: 'customers', label: 'name' },
  bottle: { table: 'bottles', label: 'name' },
  product: { table: 'products', label: 'name' },
  order: { table: 'orders', label: 'customer_name' },
  delivery: { table: 'deliveries', label: 'id' }
};

function validateQrEntity(entityType, entityId) {
  const type = String(entityType || '').trim().toLowerCase();
  const id = Number(entityId);
  if (!qrEntityTypes.includes(type)) throw new Error('entityType must be customer, bottle, product, order, or delivery.');
  if (!Number.isInteger(id) || id < 1) throw new Error('entityId must be a positive integer.');
  return { type, id };
}

async function getQrEntity(entityType, entityId, companyId) {
  const definition = qrEntityTables[entityType];
  const rows = await query(`SELECT * FROM ${definition.table} WHERE id = ? AND company_id = ? LIMIT 1`, [entityId, companyId]);
  return rows[0] || null;
}

async function qrRecordResponse(record, companyId) {
  const entity = await getQrEntity(record.entity_type, record.entity_id, companyId);
  const lookupUrl = `/api/qr-lookup/${encodeURIComponent(record.qr_key)}`;
  const image = await QRCode.toDataURL(lookupUrl, { errorCorrectionLevel: 'M', margin: 2, width: 280 });
  return { ...record, entity, lookup_url: lookupUrl, image_data_url: image };
}

app.get('/api/qr-records', requireRole(...qrReadRoles), async (req, res) => {
  try {
    const entityType = req.query.entityType ? String(req.query.entityType).trim().toLowerCase() : null;
    if (entityType && !qrEntityTypes.includes(entityType)) return res.status(400).json({ message: 'Invalid QR entity type.' });
    const records = await query(`SELECT q.*, u.name AS created_by_name FROM qr_records q LEFT JOIN users u ON u.id = q.created_by AND u.company_id = q.company_id WHERE q.company_id = ? ${entityType ? 'AND q.entity_type = ?' : ''} ORDER BY q.created_at DESC, q.id DESC`, entityType ? [req.companyId, entityType] : [req.companyId]);
    res.json(await Promise.all(records.map((record) => qrRecordResponse(record, req.companyId))));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/qr-records/generate', requireRole(...qrWriteRoles), async (req, res) => {
  try {
    const { type, id } = validateQrEntity(req.body?.entityType, req.body?.entityId);
    const entity = await getQrEntity(type, id, req.companyId);
    if (!entity) return res.status(404).json({ message: 'The selected record was not found in this company.' });
    let record = (await query('SELECT * FROM qr_records WHERE company_id = ? AND entity_type = ? AND entity_id = ?', [req.companyId, type, id]))[0];
    if (!record) {
      const key = crypto.randomBytes(24).toString('base64url');
      const payload = JSON.stringify({ version: 1, companyId: req.companyId, entityType: type, entityId: id, key });
      const result = await insert('INSERT INTO qr_records (company_id, entity_type, entity_id, qr_key, payload, created_by) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, type, id, key, payload, req.user.id]);
      record = (await query('SELECT * FROM qr_records WHERE id = ?', [result.id]))[0];
      await writeAudit(req, 'create', 'qr_record', result.id, null, { entityType: type, entityId: id });
    } else if (record.status === 'revoked') {
      await update('UPDATE qr_records SET status = \'active\', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [record.id, req.companyId]);
      record = (await query('SELECT * FROM qr_records WHERE id = ?', [record.id]))[0];
      await writeAudit(req, 'reactivate', 'qr_record', record.id, { status: 'revoked' }, { status: 'active' });
    }
    res.status(201).json(await qrRecordResponse(record, req.companyId));
  } catch (error) { res.status(error.message.startsWith('entity') || error.message.startsWith('entityId') ? 400 : 500).json({ message: error.message }); }
});

app.post('/api/qr-records/batch', requireRole(...qrWriteRoles), async (req, res) => {
  try {
    const items = Array.isArray(req.body?.records) ? req.body.records : [];
    if (!items.length || items.length > 100) return res.status(400).json({ message: 'Provide between 1 and 100 records.' });
    const generated = [];
    for (const item of items) {
      const { type, id } = validateQrEntity(item.entityType, item.entityId);
      const entity = await getQrEntity(type, id, req.companyId);
      if (!entity) return res.status(404).json({ message: `Record ${type} ${id} was not found in this company.` });
      const existing = (await query('SELECT * FROM qr_records WHERE company_id = ? AND entity_type = ? AND entity_id = ?', [req.companyId, type, id]))[0];
      if (existing) { generated.push(existing); continue; }
      const key = crypto.randomBytes(24).toString('base64url');
      const result = await insert('INSERT INTO qr_records (company_id, entity_type, entity_id, qr_key, payload, created_by) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, type, id, key, JSON.stringify({ version: 1, companyId: req.companyId, entityType: type, entityId: id, key }), req.user.id]);
      const record = (await query('SELECT * FROM qr_records WHERE id = ?', [result.id]))[0];
      generated.push(record);
      await writeAudit(req, 'create', 'qr_record', result.id, null, { entityType: type, entityId: id });
    }
    res.status(201).json(await Promise.all(generated.map((record) => qrRecordResponse(record, req.companyId))));
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('/api/qr-records/:id/print', requireRole(...qrReadRoles), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const record = (await query('SELECT * FROM qr_records WHERE id = ? AND company_id = ?', [id, req.companyId]))[0];
    if (!record) return res.status(404).json({ message: 'QR record not found.' });
    res.json(await qrRecordResponse(record, req.companyId));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/qr-records/:id/revoke', requireRole(...qrWriteRoles), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = (await query('SELECT * FROM qr_records WHERE id = ? AND company_id = ?', [id, req.companyId]))[0];
    if (!current) return res.status(404).json({ message: 'QR record not found.' });
    await update('UPDATE qr_records SET status = \'revoked\', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [id, req.companyId]);
    await writeAudit(req, 'revoke', 'qr_record', id, { status: current.status }, { status: 'revoked' });
    res.json(await qrRecordResponse((await query('SELECT * FROM qr_records WHERE id = ?', [id]))[0], req.companyId));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/qr-lookup/:key', requireRole(...qrReadRoles), async (req, res) => {
  try {
    const key = String(req.params.key || '');
    const record = (await query('SELECT * FROM qr_records WHERE qr_key = ? AND company_id = ? LIMIT 1', [key, req.companyId]))[0];
    if (!record) return res.status(404).json({ message: 'QR record not found for the active company.' });
    const result = record.status === 'active' ? 'success' : 'revoked';
    await insert('INSERT INTO qr_lookup_history (company_id, qr_record_id, entity_type, entity_id, lookup_type, user_id, result, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, record.id, record.entity_type, record.entity_id, 'authorized', req.user.id, result, req.ip || '', String(req.get('user-agent') || '').slice(0, 500)]);
    await writeAudit(req, 'lookup', 'qr_record', record.id, null, { result, entityType: record.entity_type, entityId: record.entity_id });
    if (record.status !== 'active') return res.status(410).json({ message: 'This QR record has been revoked.', result });
    res.json({ ...(await qrRecordResponse(record, req.companyId)), result });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/qr-lookup-history', requireRole('super_admin', 'company_admin', 'manager', 'accountant'), async (req, res) => {
  try {
    const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page || '1', 10) || 1));
    const pageSize = Math.max(1, Math.min(100, Number.parseInt(req.query.pageSize || '50', 10) || 50));
    const rows = await query(`SELECT h.*, u.name AS user_name, q.qr_key FROM qr_lookup_history h LEFT JOIN users u ON u.id = h.user_id AND u.company_id = h.company_id LEFT JOIN qr_records q ON q.id = h.qr_record_id WHERE h.company_id = ? ORDER BY h.created_at DESC, h.id DESC LIMIT ? OFFSET ?`, [req.companyId, pageSize, (page - 1) * pageSize]);
    const total = Number((await query('SELECT COUNT(*) AS total FROM qr_lookup_history WHERE company_id = ?', [req.companyId]))[0].total || 0);
    res.json({ rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/exports/:resource', requireRole('super_admin', 'company_admin', 'manager', 'accountant'), async (req, res) => {
  const resources = {
    customers: {
      headers: ['id', 'name', 'phone', 'address', 'created_at'],
      query: (companyId, from, to) => { const date = exportDateClause('created_at', from, to); return query(`SELECT id, name, phone, address, created_at FROM customers WHERE company_id = ?${date.sql} ORDER BY id`, [companyId, ...date.params]); }
    },
    orders: {
      headers: ['id', 'customer_name', 'delivery_address', 'status', 'total_amount', 'created_at', 'updated_at'],
      query: (companyId, from, to) => { const date = exportDateClause('created_at', from, to); return query(`SELECT id, customer_name, delivery_address, status, total_amount, created_at, updated_at FROM orders WHERE company_id = ?${date.sql} ORDER BY id`, [companyId, ...date.params]); }
    },
    inventory: {
      headers: ['id', 'name', 'category', 'unit', 'purchase_price', 'sale_price', 'stock', 'min_stock', 'reorder_level', 'created_at'],
      query: (companyId, from, to) => { const date = exportDateClause('created_at', from, to); return query(`SELECT id, name, category, unit, purchase_price, sale_price, stock, min_stock, reorder_level, created_at FROM products WHERE company_id = ?${date.sql} ORDER BY id`, [companyId, ...date.params]); }
    },
    finances: {
      headers: ['record_type', 'id', 'date', 'party', 'description', 'method', 'direction', 'amount', 'status'],
      query: async (companyId, from, to) => {
        const date = exportDateClause('created_at', from, to);
        const [sales, purchases, expenses, payments] = await Promise.all([
          query(`SELECT id, created_at AS date, customer_name AS party, 'Sale' AS description, '' AS method, 'receipt' AS direction, total_amount AS amount, status FROM sales WHERE company_id = ?${date.sql}`, [companyId, ...date.params]),
          query(`SELECT id, created_at AS date, supplier_name AS party, 'Purchase' AS description, '' AS method, 'payment' AS direction, total_amount AS amount, status FROM purchases WHERE company_id = ?${date.sql}`, [companyId, ...date.params]),
          query(`SELECT id, created_at AS date, '' AS party, title AS description, payment_method AS method, 'payment' AS direction, amount, '' AS status FROM expenses WHERE company_id = ?${date.sql}`, [companyId, ...date.params]),
          query(`SELECT id, created_at AS date, customer_name AS party, note AS description, method, direction, amount, '' AS status FROM payments WHERE company_id = ?${date.sql}`, [companyId, ...date.params])
        ]);
        return [...sales.map((row) => ({ ...row, record_type: 'sale' })), ...purchases.map((row) => ({ ...row, record_type: 'purchase' })), ...expenses.map((row) => ({ ...row, record_type: 'expense' })), ...payments.map((row) => ({ ...row, record_type: 'payment' }))].sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.id) - Number(b.id));
      }
    }
  };
  try {
    const resource = resources[req.params.resource];
    if (!resource) return res.status(404).json({ message: 'Unknown export type.' });
    if (!req.companyId) return res.status(400).json({ message: 'Select a company before exporting data.' });
    const from = parseExportDate(req.query.from, 'from');
    const to = parseExportDate(req.query.to, 'to');
    if (from && to && from > to) return res.status(400).json({ message: 'from must be on or before to.' });
    const rows = await resource.query(req.companyId, from, to);
    await writeAudit(req, 'export_csv', resource === resources.finances ? 'finances' : req.params.resource, null, null, { from, to, rowCount: rows.length });
    const company = (await query('SELECT name FROM companies WHERE id = ?', [req.companyId]))[0];
    const safeCompany = String(company?.name || 'company').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'company';
    res.status(200).set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${safeCompany}-${req.params.resource}-export.csv"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    writeCsv(res, resource.headers, rows);
    res.end();
  } catch (error) {
    if (!res.headersSent) res.status(400).json({ message: error.message }); else res.end();
  }
});

app.get('/api/backup', requireRole(...backupRoles), async (req, res) => {
  if (!req.companyId) return res.status(400).json({ message: 'Select a company before creating a backup.' });
  const backupPath = path.join(__dirname, `.aquaflow-backup-${crypto.randomBytes(12).toString('hex')}.db`);
  try {
    await new Promise((resolve, reject) => db.run('VACUUM INTO ?', [backupPath], (error) => error ? reject(error) : resolve()));
    await writeAudit(req, 'backup_sqlite', 'database', null, null, { format: 'sqlite' });
    const company = (await query('SELECT name FROM companies WHERE id = ?', [req.companyId]))[0];
    const safeCompany = String(company?.name || 'company').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'company';
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${safeCompany}-backup.db"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const stream = fs.createReadStream(backupPath);
    stream.on('error', (error) => { if (!res.headersSent) res.status(500).json({ message: error.message }); else res.destroy(error); });
    stream.on('close', () => fs.unlink(backupPath, () => {}));
    stream.pipe(res);
  } catch (error) {
    fs.unlink(backupPath, () => {});
    res.status(500).json({ message: 'Backup could not be created.' });
  }
});

app.post('/api/signup', async (req, res) => {
  try {
    const { companyName, ownerName, email, phone, username, password, confirmPassword, country, address, language = 'en' } = req.body || {};
    const selectedLanguage = String(language).trim().toLowerCase();
    if (!SUPPORTED_LANGUAGES.includes(selectedLanguage)) return res.status(400).json({ message: 'Unsupported language.' });
    if (!companyName || !ownerName || !email || !username || !password || !confirmPassword) {
      return res.status(400).json({ message: 'Company name, owner name, email, username, and password are required.' });
    }
    if (password !== confirmPassword || password.length < 8) {
      return res.status(400).json({ message: 'Passwords must match and contain at least 8 characters.' });
    }
    const existing = await query('SELECT id FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)', [username.trim(), email.trim()]);
    if (existing[0]) return res.status(409).json({ message: 'That username or email is already registered.' });
    const company = await insert('INSERT INTO companies (name, email, phone, address, country, default_language) VALUES (?, ?, ?, ?, ?, ?)', [companyName.trim(), email.trim(), phone || '', address || '', country || '', selectedLanguage]);
        const user = await insert('INSERT INTO users (company_id, username, email, password_hash, name, role, language) VALUES (?, ?, ?, ?, ?, ?, ?)', [company.id, username.trim(), email.trim(), hashPassword(password), ownerName.trim(), 'company_admin', selectedLanguage]);
    const plan = await query('SELECT id FROM plans WHERE slug = ? LIMIT 1', ['normal']);
    const subscription = await insert('INSERT INTO subscriptions (company_id, plan_id, status, start_date, end_date, price, payment_status, renewal_date) VALUES (?, ?, ?, date("now"), date("now", "+14 days"), 0, ?, date("now", "+14 days"))', [company.id, plan[0].id, 'trial', 'pending']);
    await insert('INSERT INTO subscription_history (company_id, subscription_id, action, new_value, created_by) VALUES (?, ?, ?, ?, ?)', [company.id, subscription.id, 'signup_trial', JSON.stringify({ status: 'trial' }), user.id]);
    const token = await createSession(user.id);
    res.status(201).json({ success: true, token, user: { id: user.id, name: ownerName, username, email, role: 'company_admin', companyId: company.id, companyName, language: 'en' } });
  } catch (error) {
    const duplicate = /UNIQUE/i.test(error.message);
    res.status(duplicate ? 409 : 500).json({ message: duplicate ? 'That username or email is already registered.' : error.message });
  }
});

// Anonymous driver self-service reset. One-time code is emailed to the address
// registered by the Company Admin; no code/token is exposed by the API.
app.post('/api/driver/password-reset/request', async (req, res) => {
  try {
    res.json(await driverPasswordResetService.request(req.body?.username));
  } catch (error) {
    res.status(503).json({ success: false, message: 'Recovery unavailable. Contact your company Admin.' });
  }
});

app.post('/api/driver/password-reset/confirm', async (req, res) => {
  try {
    const result = await driverPasswordResetService.confirm(
      req.body?.username, req.body?.code, req.body?.password
    );
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(503).json({ success: false, message: 'Recovery unavailable. Contact your company Admin.' });
  }
});

app.post('/api/forgot-password', async (req, res) => {
  const generic = { success: true, message: 'If the account exists and can receive email, recovery instructions will be sent.' };
  try {
    const identifier = String(req.body?.identifier || '').trim().toLowerCase();
    if (!identifier) return res.json(generic);
    const users = await query('SELECT id, email FROM users WHERE (LOWER(username) = ? OR LOWER(email) = ?) AND active = 1 LIMIT 1', [identifier, identifier]);
    const user = users[0];
    if (!user || !user.email) return res.json(generic);
    // Limit repeated reset emails per account; always return a generic response.
    const counts = await query(`SELECT COUNT(*) AS n FROM password_reset_tokens
      WHERE user_id = ? AND created_at >= datetime('now','-1 hour')`, [user.id]);
    if (Number(counts[0]?.n || 0) >= 3) return res.json(generic);
    const token = crypto.randomBytes(32).toString('hex');
    const inserted = await insert('INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, datetime("now", "+30 minutes"))', [token, user.id]);
    const mail = await notificationDeliveryService.sendEmail({
      recipient: user.email, type: 'password_reset', variables: {},
      subject: 'TEMO ERP password recovery',
      message: `Your TEMO ERP password reset token is: ${token}\n\nThis token expires in 30 minutes. Enter it only in the official TEMO ERP reset-password form. Never share it.`
    });
    if (mail.status !== 'sent') await update('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE token = ?', [token]);
    return res.json(generic);
  } catch (error) {
    return res.status(503).json({ success: false, message: 'Recovery service unavailable. Contact your company Admin.' });
  }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body || {};
    if (!token || !password || password !== confirmPassword || password.length < 8) return res.status(400).json({ message: 'A valid token and matching password of at least 8 characters are required.' });
    const rows = await query('SELECT user_id FROM password_reset_tokens WHERE token = ? AND used_at IS NULL AND datetime(expires_at) > datetime("now")', [token]);
    if (!rows[0]) return res.status(400).json({ message: 'Reset token is invalid or expired.' });
    await update('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), rows[0].user_id]);
    await update('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE token = ?', [token]);
    await update('DELETE FROM sessions WHERE user_id = ?', [rows[0].user_id]);
    res.json({ success: true, message: 'Password reset successfully.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/me/password', async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const confirmPassword = String(req.body?.confirmPassword || '');
    const user = (await query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]))[0];
    if (!user || !verifyPassword(currentPassword, user.password_hash)) return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    if (newPassword.length < 8 || newPassword !== confirmPassword) return res.status(400).json({ success: false, message: 'New passwords must match and contain at least 8 characters.' });
    await update('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hashPassword(newPassword), req.user.id]);
    await writeAudit(req, 'password_change', 'user', req.user.id, null, { firstLogin: Boolean(req.user.must_change_password) });
    res.json({ success: true, mustChangePassword: false });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to change password.' });
  }
});

app.get('/api/me', (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      username: req.user.username,
      role: req.user.role,
      companyId: req.user.company_id,
      companyName: req.user.company_name || 'Platform Administration',
      companyLogo: req.user.company_logo || '',
      language: req.user.language || req.user.default_language || 'en',
      mustChangePassword: Boolean(req.user.must_change_password)
    },
    subscription: req.subscription || null
  });
});

app.patch('/api/me/language', async (req, res) => {
  try {
    const language = String(req.body?.language || '').trim().toLowerCase();
    if (!SUPPORTED_LANGUAGES.includes(language)) return res.status(400).json({ message: 'Unsupported language.' });
    await update('UPDATE users SET language = ? WHERE id = ?', [language, req.user.id]);
    res.json({ language });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/subscription', requireCompanySubscriptionUser, async (req, res) => {
  try {
    const subscription = req.companyId ? await getCompanySubscription(req.companyId) : null;
    res.json({ success: true, subscription, status: req.subscriptionStatus || getSubscriptionStatus(null, null) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/subscription/status', requireCompanySubscriptionUser, async (req, res) => {
  try {
    if (!req.companyId) {
      return res.status(400).json({ success: false, code: 'COMPANY_REQUIRED', message: 'This account is not linked to a company.' });
    }
    const company = (await query('SELECT id, name, active FROM companies WHERE id = ?', [req.companyId]))[0];
    const status = req.subscriptionStatus || getSubscriptionStatus(await getCompanySubscription(req.companyId), company);
    res.json({
      success: true,
      company: status.company,
      companyId: status.companyId,
      plan: status.plan,
      status: status.status,
      startDate: status.startDate,
      expiryDate: status.expiryDate,
      daysRemaining: status.daysRemaining
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/subscription/billing', requireCompanySubscriptionUser, async (req, res) => {
  try {
    if (!req.companyId) return res.status(400).json({ success: false, code: 'COMPANY_REQUIRED', message: 'This account is not linked to a company.' });
    const subscription = await getCompanySubscription(req.companyId);
    const payments = await query('SELECT id, invoice_number, amount_due, amount, currency, payment_method, payment_reference, transaction_reference, payment_status, payment_date, notes, created_at FROM subscription_payments WHERE company_id = ? ORDER BY payment_date DESC, id DESC', [req.companyId]);
    const renewalRequests = await query('SELECT id, requested_period, requested_days, notes, status, created_at, updated_at FROM subscription_renewal_requests WHERE company_id = ? ORDER BY created_at DESC, id DESC', [req.companyId]);
    const paymentProofs = await query('SELECT id, original_name, content_type, byte_size, status, review_note, created_at FROM subscription_payment_proofs WHERE company_id = ? ORDER BY created_at DESC, id DESC', [req.companyId]);
    res.json({ success: true, subscription, payments, renewalRequests, paymentProofs });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to load billing information.' });
  }
});

app.post('/api/subscription/renewal-request', requireCompanySubscriptionUser, requireRole('company_admin'), async (req, res) => {
  try {
    const subscription = await getCompanySubscription(req.companyId);
    if (!subscription) return res.status(404).json({ message: 'Subscription not found.' });
    const period = String(req.body?.requestedPeriod || 'monthly').trim().toLowerCase();
    if (!['monthly', 'quarterly', '6_months', 'yearly', 'custom'].includes(period)) return res.status(400).json({ message: 'Invalid renewal period.' });
    const requestedDays = period === 'custom' ? Number(req.body?.requestedDays) : null;
    if (period === 'custom' && (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 3650)) return res.status(400).json({ message: 'Custom renewal duration must be a whole number from 1 to 3650 days.' });
    const result = await insert('INSERT INTO subscription_renewal_requests (company_id, subscription_id, requested_by, requested_period, requested_days, notes) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, subscription.id, req.user.id, period, requestedDays, String(req.body?.notes || '').trim().slice(0, 1000)]);
    await writeAudit(req, 'renewal_requested', 'subscription_renewal_request', result.id, null, { period });
    res.status(201).json((await query('SELECT * FROM subscription_renewal_requests WHERE id = ?', [result.id]))[0]);
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('/api/admin/subscription/renewal-requests', requireSuperAdmin, async (req, res) => {
  try {
    res.json(await query(`SELECT r.*, c.name AS company_name, c.company_code, p.name AS plan_name
      FROM subscription_renewal_requests r JOIN companies c ON c.id = r.company_id
      JOIN subscriptions s ON s.id = r.subscription_id JOIN plans p ON p.id = s.plan_id
      ORDER BY r.created_at DESC`));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/admin/subscription/renewal-requests/:id', requireSuperAdmin, async (req, res) => {
  try {
    const status = String(req.body?.status || '').toLowerCase();
    if (!['approved', 'rejected', 'completed'].includes(status)) return res.status(400).json({ message: 'Invalid renewal request status.' });
    const result = await update('UPDATE subscription_renewal_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, Number(req.params.id)]);
    if (!result.changes) return res.status(404).json({ message: 'Renewal request not found.' });
    await writeAudit(req, `renewal_${status}`, 'subscription_renewal_request', Number(req.params.id), null, { status });
    res.json((await query('SELECT * FROM subscription_renewal_requests WHERE id = ?', [Number(req.params.id)]))[0]);
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.post('/api/admin/subscription/renewal-requests/:id/process', requireSuperAdmin, async (req, res) => {
  try {
    const request = (await query('SELECT * FROM subscription_renewal_requests WHERE id = ?', [Number(req.params.id)]))[0];
    if (!request) return res.status(404).json({ message: 'Renewal request not found.' });
    if (!['approved', 'pending'].includes(request.status)) return res.status(409).json({ message: 'Only pending or approved renewal requests can be processed.' });
    const cycle = request.requested_period;
    const days = { monthly: 30, quarterly: 90, '6_months': 182, yearly: 365 }[cycle] || Number(request.requested_days) || Number(req.body?.days);
    if (!Number.isFinite(days) || days <= 0) return res.status(400).json({ message: 'Custom renewal requests require a positive number of days.' });
    const subscription = await getCompanySubscription(request.company_id);
    if (!subscription) return res.status(404).json({ message: 'Subscription not found.' });
    const today = new Date().toISOString().slice(0, 10);
    const base = subscription.end_date >= today ? subscription.end_date : today;
    const expiry = new Date(`${base}T00:00:00Z`);
    expiry.setUTCDate(expiry.getUTCDate() + days);
    const endDate = expiry.toISOString().slice(0, 10);
    await update('UPDATE subscriptions SET end_date = ?, renewal_date = ?, next_billing_date = ?, billing_cycle = ?, status = "active", payment_status = ? WHERE id = ?', [endDate, endDate, endDate, cycle, req.body?.paymentStatus || 'pending', subscription.id]);
    await update("UPDATE subscription_renewal_requests SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [request.id]);
    await writeAudit(req, 'renewal_completed', 'subscription_renewal_request', request.id, { status: request.status }, { status: 'completed', endDate, paymentStatus: req.body?.paymentStatus || 'pending' });
    res.json({ success: true, request: (await query('SELECT * FROM subscription_renewal_requests WHERE id = ?', [request.id]))[0], subscription: await getCompanySubscription(request.company_id) });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

function subscriptionInvoicePdf(lines) {
  const safe = (value) => String(value).replace(/[\\()]/g, '\\$&');
  const commands = ['BT', '/F1 12 Tf', '50 780 Td'];
  lines.forEach((line, index) => { if (index) commands.push('0 -20 Td'); commands.push(`(${safe(line)}) Tj`); });
  commands.push('ET');
  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, index) => { offsets[index + 1] = Buffer.byteLength(pdf); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

app.get('/api/subscription/invoice.pdf', requireCompanySubscriptionUser, async (req, res) => {
  try {
    const billing = await getCompanySubscription(req.companyId);
    if (!billing) return res.status(404).json({ message: 'Subscription not found.' });
    const company = (await query('SELECT name, company_code FROM companies WHERE id = ?', [req.companyId]))[0];
    const plan = (await query('SELECT name, display_name FROM plans WHERE id = ?', [billing.plan_id]))[0];
    const pdf = subscriptionInvoicePdf([
      'Subscription Invoice',
      `Company: ${company?.name || ''} (${company?.company_code || ''})`,
      `Plan: ${plan?.display_name || plan?.name || ''}`,
      `Period: ${billing.start_date} to ${billing.end_date}`,
      `Amount due: ${billing.price || 0}`,
      `Payment status: ${billing.payment_status || 'pending'}`
    ]);
    res.type('application/pdf').set('Content-Disposition', 'attachment; filename="subscription-invoice.pdf"').send(pdf);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

const paymentProofTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const paymentProofExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const paymentProofRoot = path.join(__dirname, 'storage', 'subscription-payment-proofs');

app.post('/api/subscription/payment-proofs', requireCompanySubscriptionUser, requireRole('company_admin'), async (req, res) => {
  try {
    const filename = String(req.body?.filename || '').trim();
    const contentType = String(req.body?.contentType || '').toLowerCase();
    const encoded = String(req.body?.dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
    const extension = path.extname(filename).toLowerCase();
    if (!filename || filename.length > 180 || filename.includes('..') || !paymentProofTypes.has(contentType) || !paymentProofExtensions.has(extension)) return res.status(400).json({ message: 'Only PDF, JPG, JPEG, and PNG payment proofs are accepted.' });
    if (!encoded || !/^[A-Za-z0-9+/]+=*$/.test(encoded)) return res.status(400).json({ message: 'A base64 payment proof is required.' });
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) return res.status(400).json({ message: 'Payment proof must be between 1 byte and 10 MB.' });
    const subscription = await getCompanySubscription(req.companyId);
    if (!subscription) return res.status(404).json({ message: 'Subscription not found.' });
    const storageName = `${req.companyId}-${crypto.randomBytes(18).toString('hex')}${extension}`;
    fs.mkdirSync(paymentProofRoot, { recursive: true });
    fs.writeFileSync(path.join(paymentProofRoot, storageName), bytes, { flag: 'wx' });
    const result = await insert(`INSERT INTO subscription_payment_proofs
      (company_id, subscription_id, uploaded_by, original_name, storage_name, content_type, byte_size, sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [req.companyId, subscription.id, req.user.id, filename.replace(/[^\w.-]/g, '_').slice(0, 180), storageName, contentType, bytes.length, crypto.createHash('sha256').update(bytes).digest('hex')]);
    const row = (await query('SELECT id, company_id, subscription_id, uploaded_by, original_name, content_type, byte_size, status, review_note, created_at FROM subscription_payment_proofs WHERE id = ?', [result.id]))[0];
    await writeAudit(req, 'payment_proof_submitted', 'subscription_payment_proof', result.id, null, { contentType, byteSize: bytes.length });
    res.status(201).json(row);
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('/api/subscription/payment-proofs', requireCompanySubscriptionUser, requireRole('company_admin'), async (req, res) => {
  try { res.json(await query('SELECT id, company_id, subscription_id, uploaded_by, original_name, content_type, byte_size, status, review_note, reviewed_by, reviewed_at, created_at FROM subscription_payment_proofs WHERE company_id = ? ORDER BY created_at DESC, id DESC', [req.companyId])); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/subscription/payment-proofs/:id/download', requireCompanySubscriptionUser, requireRole('company_admin'), async (req, res) => {
  try {
    const row = (await query('SELECT * FROM subscription_payment_proofs WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0];
    if (!row) return res.status(404).json({ message: 'Payment proof not found.' });
    const filePath = path.join(paymentProofRoot, row.storage_name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'Payment proof file is unavailable.' });
    await writeAudit(req, 'payment_proof_downloaded', 'subscription_payment_proof', row.id, null, { companyId: row.company_id });
    res.type(row.content_type).set('Content-Disposition', `attachment; filename="${row.original_name.replace(/["\r\n]/g, '_')}"`).sendFile(filePath);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/admin/subscription/payment-proofs', requireSuperAdmin, async (req, res) => {
  try { res.json(await query(`SELECT p.id, p.company_id, c.name AS company_name, c.company_code, p.subscription_id, p.uploaded_by, p.original_name, p.content_type, p.byte_size, p.status, p.review_note, p.reviewed_by, p.reviewed_at, p.created_at FROM subscription_payment_proofs p JOIN companies c ON c.id = p.company_id ORDER BY p.created_at DESC, p.id DESC`)); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/admin/subscription/payment-proofs/:id/download', requireSuperAdmin, async (req, res) => {
  try {
    const row = (await query('SELECT * FROM subscription_payment_proofs WHERE id = ?', [Number(req.params.id)]))[0];
    if (!row) return res.status(404).json({ message: 'Payment proof not found.' });
    const filePath = path.join(paymentProofRoot, row.storage_name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'Payment proof file is unavailable.' });
    await writeAudit(req, 'payment_proof_downloaded', 'subscription_payment_proof', row.id, null, { companyId: row.company_id });
    res.type(row.content_type).set('Content-Disposition', `attachment; filename="${row.original_name.replace(/["\r\n]/g, '_')}"`).sendFile(filePath);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/admin/subscription/payment-proofs/:id', requireSuperAdmin, async (req, res) => {
  try {
    const status = String(req.body?.status || '').toLowerCase();
    if (!['under_review', 'approved', 'rejected'].includes(status)) return res.status(400).json({ message: 'Invalid payment proof status.' });
    const row = (await query('SELECT * FROM subscription_payment_proofs WHERE id = ?', [Number(req.params.id)]))[0];
    if (!row) return res.status(404).json({ message: 'Payment proof not found.' });
    await update('UPDATE subscription_payment_proofs SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, String(req.body?.reviewNote || '').trim().slice(0, 1000), req.user.id, row.id]);
    await writeAudit(req, 'payment_proof_reviewed', 'subscription_payment_proof', row.id, { status: row.status }, { status, reviewNote: String(req.body?.reviewNote || '').trim().slice(0, 1000) });
    res.json((await query('SELECT id, company_id, subscription_id, original_name, content_type, byte_size, status, review_note, reviewed_by, reviewed_at, created_at FROM subscription_payment_proofs WHERE id = ?', [row.id]))[0]);
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('/api/subscription/features', async (req, res) => {
  try {
    if (!req.companyId) return res.status(400).json({ success: false, code: 'COMPANY_REQUIRED', message: 'This account is not linked to a company.' });
    const features = await featureAccessService.getFeatureMap(req.companyId, req.subscription);
    res.json({ success: true, plan: req.subscription?.plan_slug || null, features });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/admin/features', requireSuperAdmin, async (req, res) => {
  try {
    res.json(await query('SELECT * FROM features WHERE is_active = 1 ORDER BY id'));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/admin/companies/:companyId/features', requireSuperAdmin, async (req, res) => {
  try {
    const companyId = Number(req.params.companyId);
    const company = (await query('SELECT id, name FROM companies WHERE id = ?', [companyId]))[0];
    if (!company) return res.status(404).json({ message: 'Company not found.' });
    const subscription = await getCompanySubscription(companyId);
    const features = await featureAccessService.getFeatureMap(companyId, subscription);
    const overrides = await query(
      `SELECT f.feature_key, cf.is_enabled
       FROM company_features cf JOIN features f ON f.id = cf.feature_id
       WHERE cf.company_id = ? ORDER BY f.id`,
      [companyId]
    );
    res.json({ company, plan: subscription?.plan_slug || null, features, overrides });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/admin/companies/:companyId/features', requireSuperAdmin, async (req, res) => {
  try {
    const companyId = Number(req.params.companyId);
    if (!(await query('SELECT id FROM companies WHERE id = ?', [companyId]))[0]) return res.status(404).json({ message: 'Company not found.' });
    const input = req.body?.features;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return res.status(400).json({ message: 'Features must be an object keyed by feature.' });
    const known = await query('SELECT id, feature_key FROM features WHERE is_active = 1');
    const knownKeys = new Set(known.map((row) => row.feature_key));
    for (const key of Object.keys(input)) {
      if (!knownKeys.has(key) || typeof input[key] !== 'boolean') return res.status(400).json({ message: `Invalid feature override: ${key}.` });
    }
    for (const feature of known) {
      if (!Object.prototype.hasOwnProperty.call(input, feature.feature_key)) continue;
      await update(
        `INSERT INTO company_features (company_id, feature_id, is_enabled, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(company_id, feature_id) DO UPDATE SET is_enabled = excluded.is_enabled, updated_at = CURRENT_TIMESTAMP`,
        [companyId, feature.id, input[feature.feature_key] ? 1 : 0]
      );
    }
    const subscription = await getCompanySubscription(companyId);
    const features = await featureAccessService.getFeatureMap(companyId, subscription);
    await writeAudit(req, 'update', 'company_features', companyId, null, input);
    res.json({ success: true, companyId, plan: subscription?.plan_slug || null, features });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/company', async (req, res) => {
  try {
    if (!req.companyId) return res.status(400).json({ message: 'Select a company first.' });
    const company = await query('SELECT * FROM companies WHERE id = ? AND active = 1', [req.companyId]);
    if (!company[0]) return res.status(404).json({ message: 'Company not found.' });
    res.json(company[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/company', async (req, res) => {
  try {
    if (!req.companyId || !['super_admin', 'company_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only company administrators can update company settings.' });
    }
    const { name, logo, phone, email, address, defaultLanguage, dateFormat, theme, customDomain, subdomain, faviconUrl, supportEmail } = req.body || {};
    if (!name || String(name).trim().length > 160) return res.status(400).json({ message: 'Company name is required and must be at most 160 characters.' });
    const language = String(defaultLanguage || 'en').trim().toLowerCase();
    if (!SUPPORTED_LANGUAGES.includes(language)) return res.status(400).json({ message: 'Unsupported language.' });
    const supportedDateFormats = new Set(['DD-MM-YYYY', 'MM-DD-YYYY', 'YYYY-MM-DD']);
    const selectedDateFormat = String(dateFormat || 'YYYY-MM-DD').trim().toUpperCase();
    if (!supportedDateFormats.has(selectedDateFormat)) return res.status(400).json({ message: 'Unsupported date format.' });
    let domain = '', sub = '';
    try { domain = safeDomain(customDomain, 'custom domain'); sub = safeDomain(subdomain, 'subdomain'); } catch (error) { return res.status(400).json({ message: error.message }); }
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (normalizedEmail && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalizedEmail)) return res.status(400).json({ message: 'Invalid company email.' });
    await update(
      'UPDATE companies SET name = ?, logo = ?, phone = ?, email = ?, address = ?, default_language = ?, date_format = ?, theme_json = ?, custom_domain = ?, subdomain = ?, favicon_url = ?, support_email = ? WHERE id = ?',
            [String(name).trim(), String(logo || '').trim().slice(0, 500), String(phone || '').trim().slice(0, 80), normalizedEmail, String(address || '').trim().slice(0, 500), language, selectedDateFormat, JSON.stringify(safeTheme(theme)), domain, sub, String(faviconUrl || '').trim().slice(0, 500), String(supportEmail || '').trim().toLowerCase().slice(0, 160), req.companyId]
    );
    await writeAudit(req, 'update', 'company_branding', req.companyId, null, { name: String(name).trim(), customDomain: domain, subdomain: sub });
    const company = await query('SELECT * FROM companies WHERE id = ?', [req.companyId]);
    res.json(company[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/companies', requireSuperAdmin, async (req, res) => {
  try {
    const companies = await query(`
      SELECT c.*, COUNT(u.id) AS user_count,
        s.id AS subscription_id, s.status AS subscription_status, s.start_date, s.end_date, s.payment_status, s.renewal_date,
        p.name AS plan_name, p.slug AS plan_slug,
        (SELECT COUNT(*) FROM products p WHERE p.company_id = c.id) AS product_count,
        (SELECT COUNT(*) FROM customers cu WHERE cu.company_id = c.id) AS customer_count
      FROM companies c
      LEFT JOIN users u ON u.company_id = c.id
      LEFT JOIN subscriptions s ON s.company_id = c.id AND s.id = (SELECT MAX(id) FROM subscriptions WHERE company_id = c.id)
      LEFT JOIN plans p ON p.id = s.plan_id
      GROUP BY c.id
      ORDER BY c.id DESC
    `);
    res.json(companies);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/admin/companies', requireSuperAdmin, async (req, res) => {
  try {
    const params = [];
    let sql = `
      SELECT c.*, COUNT(u.id) AS user_count,
        s.id AS subscription_id, s.status AS subscription_status, s.start_date, s.end_date,
        p.name AS plan_name, p.slug AS plan_slug
      FROM companies c
      LEFT JOIN users u ON u.company_id = c.id
      LEFT JOIN subscriptions s ON s.company_id = c.id AND s.id = (SELECT MAX(id) FROM subscriptions WHERE company_id = c.id)
      LEFT JOIN plans p ON p.id = s.plan_id
      WHERE 1 = 1`;
    if (req.query.search) {
      sql += ' AND (LOWER(c.name) LIKE ? OR LOWER(c.company_code) LIKE ?)';
      const search = `%${String(req.query.search).trim().toLowerCase()}%`;
      params.push(search, search);
    }
    if (req.query.plan) { sql += ' AND p.slug = ?'; params.push(String(req.query.plan).toLowerCase()); }
    if (req.query.subscriptionStatus) { sql += ' AND s.status = ?'; params.push(String(req.query.subscriptionStatus).toLowerCase()); }
    if (req.query.companyStatus === 'active') sql += ' AND c.active = 1';
    if (req.query.companyStatus === 'inactive') sql += ' AND c.active = 0';
    sql += ' GROUP BY c.id ORDER BY c.id DESC';
    res.json(await query(sql, params));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/admin/companies/:id', requireSuperAdmin, async (req, res) => {
  try {
    const companyId = Number(req.params.id);
    const company = (await query(`
      SELECT c.*, COUNT(u.id) AS user_count
      FROM companies c LEFT JOIN users u ON u.company_id = c.id
      WHERE c.id = ? GROUP BY c.id
    `, [companyId]))[0];
    if (!company) return res.status(404).json({ success: false, code: 'COMPANY_NOT_FOUND', message: 'Company not found.' });
    const subscription = await getCompanySubscription(companyId);
    const status = getSubscriptionStatus(subscription, company);
    res.json({ success: true, company, subscription, status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/admin/users', requireSuperAdmin, async (req, res) => {
  try {
    const params = [];
    let sql = `SELECT u.id, u.company_id, c.name AS company_name, u.username, u.email, u.phone, u.name, u.role, u.active, u.status, u.must_change_password, u.archived_at, u.created_at
      FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.role <> 'super_admin'`;
    if (req.query.companyId) { sql += ' AND u.company_id = ?'; params.push(Number(req.query.companyId)); }
    if (req.query.role) { sql += ' AND u.role = ?'; params.push(String(req.query.role)); }
    if (req.query.status) { sql += ' AND u.status = ?'; params.push(String(req.query.status)); }
    if (req.query.search) { sql += ' AND (LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.username) LIKE ?)'; const search = `%${String(req.query.search).trim().toLowerCase()}%`; params.push(search, search, search); }
    sql += ' ORDER BY u.id DESC';
    res.json(await query(sql, params));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/admin/companies/:id/status', requireSuperAdmin, async (req, res) => {
  try {
    const companyId = Number(req.params.id);
    const requestedStatus = String(req.body?.status || (req.body?.active === true ? 'active' : req.body?.active === false ? 'inactive' : '')).toLowerCase();
    if (!['active', 'inactive', 'suspended', 'archived'].includes(requestedStatus)) return res.status(400).json({ success: false, message: 'Invalid company status.' });
    const company = (await query('SELECT * FROM companies WHERE id = ?', [companyId]))[0];
    if (!company) return res.status(404).json({ success: false, code: 'COMPANY_NOT_FOUND', message: 'Company not found.' });
    await update('UPDATE companies SET active = ?, status = ? WHERE id = ?', [requestedStatus === 'active' ? 1 : 0, requestedStatus, companyId]);
    await writeAudit(req, `company_${requestedStatus}`, 'company', companyId, { active: company.active, status: company.status }, { active: requestedStatus === 'active' ? 1 : 0, status: requestedStatus });
    res.json({ success: true, company: (await query('SELECT * FROM companies WHERE id = ?', [companyId]))[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/companies/:id/subscription/extend', requireSuperAdmin, async (req, res) => {
  try {
    const companyId = Number(req.params.id);
    const subscription = await getCompanySubscription(companyId);
    if (!subscription) return res.status(404).json({ success: false, code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found.' });
    const days = Number(req.body?.days);
    if (![7, 30, 90, 365].includes(days)) return res.status(400).json({ success: false, message: 'Extension must be 7, 30, 90, or 365 days.' });
    const base = subscription.end_date && /^\d{4}-\d{2}-\d{2}$/.test(subscription.end_date) && subscription.end_date > new Date().toISOString().slice(0, 10)
      ? subscription.end_date
      : new Date().toISOString().slice(0, 10);
    const result = new Date(`${base}T00:00:00Z`);
    result.setUTCDate(result.getUTCDate() + days);
    const endDate = result.toISOString().slice(0, 10);
    await update('UPDATE subscriptions SET end_date = ?, renewal_date = ?, status = CASE WHEN status IN ("expired","suspended","cancelled") THEN "active" ELSE status END WHERE id = ?', [endDate, endDate, subscription.id]);
    const updated = await getCompanySubscription(companyId);
    await writeAudit(req, 'extend', 'subscription', subscription.id, subscription, updated);
    res.json({ success: true, subscription: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/companies', requireSuperAdmin, async (req, res) => {
  let transactionStarted = false;
  try {
    const body = req.body || {};
    const name = String(body.companyName || body.name || '').trim();
    const code = String(body.companyCode || body.company_code || '').trim().toUpperCase();
    const email = String(body.email || '').trim().toLowerCase();
    const planSlug = String(body.plan || 'normal').trim().toLowerCase();
    const startDate = String(body.subscriptionStart || body.startDate || new Date().toISOString().slice(0, 10));
    const expiryDate = String(body.subscriptionExpiry || body.expiryDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
    const status = String(body.subscriptionStatus || body.status || 'trial').trim().toLowerCase();
    if (!name || name.length > 160 || !/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) return res.status(400).json({ success: false, message: 'Company name and a valid unique company code are required.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: 'Invalid company email.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) || expiryDate < startDate) return res.status(400).json({ success: false, message: 'Subscription dates must be valid ISO dates.' });
    if (!['active', 'trial', 'suspended', 'expired'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid subscription status.' });
    const plan = (await query('SELECT * FROM plans WHERE slug = ? AND active = 1', [planSlug]))[0];
    if (!plan || !['normal', 'enterprise', 'custom'].includes(planSlug)) return res.status(400).json({ success: false, message: 'Plan must be normal, enterprise, or custom.' });
    if ((await query('SELECT id FROM companies WHERE company_code = ?', [code]))[0]) return res.status(409).json({ success: false, code: 'DUPLICATE_COMPANY_CODE', message: 'Company code already exists.' });
    const adminName = String(body.adminName || '').trim();
    const adminUsername = String(body.adminUsername || '').trim().toLowerCase();
    const adminPassword = String(body.adminPassword || '');
    if (!adminName || !/^[a-z0-9_.-]{3,80}$/.test(adminUsername) || adminPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Admin name, username, and password of at least 8 characters are required.' });
    }
    if ((await query('SELECT id FROM users WHERE LOWER(username) = ?', [adminUsername]))[0]) {
      return res.status(409).json({ success: false, message: 'Admin username already exists.' });
    }
    const knownFeatures = await query('SELECT id, feature_key FROM features WHERE is_active = 1');
    const customFeatures = body.features && typeof body.features === 'object' && !Array.isArray(body.features) ? body.features : {};
    for (const [featureKey, enabled] of Object.entries(customFeatures)) {
      if (!knownFeatures.some((feature) => feature.feature_key === featureKey) || typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, message: `Invalid custom feature: ${featureKey}.` });
      }
    }
    await runDatabase('BEGIN TRANSACTION');
    transactionStarted = true;
    const company = await insert('INSERT INTO companies (name, company_code, logo, phone, email, address, country, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [name, code, String(body.logo || '').trim().slice(0, 500), String(body.phone || '').trim().slice(0, 80), email, String(body.address || '').trim().slice(0, 500), String(body.country || '').trim().slice(0, 120), body.isActive === false ? 0 : 1]);
    let admin = null;
    admin = await insert('INSERT INTO users (company_id, username, email, password_hash, name, role, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)', [company.id, adminUsername, String(body.adminEmail || email).trim().toLowerCase(), hashPassword(adminPassword), adminName, 'company_admin']);
    const subscription = await insert('INSERT INTO subscriptions (company_id, plan_id, status, start_date, end_date, price, payment_status, renewal_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [company.id, plan.id, status, startDate, expiryDate, Number(body.price || plan.price || 0), 'pending', expiryDate]);
    for (const feature of knownFeatures) {
      if (Object.prototype.hasOwnProperty.call(customFeatures, feature.feature_key)) {
        await insert('INSERT INTO company_features (company_id, feature_id, is_enabled) VALUES (?, ?, ?)', [company.id, feature.id, customFeatures[feature.feature_key] ? 1 : 0]);
      }
    }
    await writeAudit(req, 'create', 'company', company.id, null, { name, companyCode: code, plan: planSlug, adminUserId: admin?.id || null });
    await runDatabase('COMMIT');
    transactionStarted = false;
    res.status(201).json({ success: true, company: (await query('SELECT * FROM companies WHERE id = ?', [company.id]))[0], subscription: await getCompanySubscription(company.id) });
  } catch (error) {
    if (transactionStarted) {
      try { await runDatabase('ROLLBACK'); } catch (_) {}
    }
    res.status(error.message.includes('UNIQUE') ? 409 : 500).json({ success: false, message: error.message.includes('UNIQUE') ? 'Company code or username already exists.' : error.message });
  }
});

app.put('/api/admin/companies/:id', requireSuperAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = (await query('SELECT * FROM companies WHERE id = ?', [id]))[0];
    if (!existing) return res.status(404).json({ success: false, code: 'COMPANY_NOT_FOUND', message: 'Company not found.' });
    const name = String(req.body?.name ?? existing.name).trim();
    const code = String(req.body?.companyCode ?? req.body?.company_code ?? existing.company_code).trim().toUpperCase();
    const status = String(req.body?.status ?? existing.status ?? (req.body?.isActive === false ? 'inactive' : 'active')).toLowerCase();
    if (!['active', 'inactive', 'suspended', 'archived'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid company status.' });
    if (!name || name.length > 160 || !/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) return res.status(400).json({ success: false, message: 'Company name and valid company code are required.' });
    if ((await query('SELECT id FROM companies WHERE company_code = ? AND id <> ?', [code, id]))[0]) return res.status(409).json({ success: false, code: 'DUPLICATE_COMPANY_CODE', message: 'Company code already exists.' });
    await update('UPDATE companies SET name = ?, company_code = ?, phone = ?, email = ?, address = ?, active = ?, status = ? WHERE id = ?', [name, code, String(req.body?.phone ?? existing.phone).trim().slice(0, 80), String(req.body?.email ?? existing.email).trim().toLowerCase(), String(req.body?.address ?? existing.address).trim().slice(0, 500), status === 'active' ? 1 : 0, status, id]);
    const company = (await query('SELECT * FROM companies WHERE id = ?', [id]))[0];
    await writeAudit(req, 'company_edited', 'company', id, existing, company);
    await writeAudit(req, 'update', 'company', id, existing, company);
    res.json({ success: true, company });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/saas/dashboard', requireRole('super_admin'), async (req, res) => {
  try {
    const [companies, statuses, plans, revenue, renewals, expiring, billing] = await Promise.all([
      query('SELECT COUNT(*) AS total, SUM(active = 1) AS active FROM companies'),
      query('SELECT status, COUNT(*) AS count FROM subscriptions GROUP BY status'),
      query('SELECT p.slug, COUNT(s.id) AS count FROM plans p LEFT JOIN subscriptions s ON s.plan_id = p.id GROUP BY p.id'),
      query("SELECT COALESCE(SUM(amount), 0) AS total FROM subscription_payments WHERE payment_status = 'paid'"),
      query("SELECT c.name, c.company_code, s.end_date, p.name AS plan_name FROM subscriptions s JOIN companies c ON c.id = s.company_id JOIN plans p ON p.id = s.plan_id WHERE s.end_date BETWEEN date('now') AND date('now', '+30 days') ORDER BY s.end_date"),
      query(`SELECT
        SUM(CASE WHEN s.end_date BETWEEN date('now') AND date('now', '+7 days') THEN 1 ELSE 0 END) AS within_7_days,
        SUM(CASE WHEN s.end_date BETWEEN date('now') AND date('now', '+15 days') THEN 1 ELSE 0 END) AS within_15_days,
        SUM(CASE WHEN s.end_date BETWEEN date('now') AND date('now', '+30 days') THEN 1 ELSE 0 END) AS within_30_days
        FROM subscriptions s JOIN companies c ON c.id = s.company_id WHERE c.active = 1`),
      query(`SELECT
        SUM(payment_status IN ('pending','partially_paid')) AS pending_payments,
        SUM(payment_status = 'overdue') AS overdue_payments,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' AND strftime('%Y-%m', payment_date) = strftime('%Y-%m', 'now') THEN amount ELSE 0 END), 0) AS monthly_revenue,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' AND strftime('%Y', payment_date) = strftime('%Y', 'now') THEN amount ELSE 0 END), 0) AS yearly_revenue
        FROM subscription_payments`)
    ]);
    const planCounts = Object.fromEntries(plans.filter((row) => ['normal', 'enterprise', 'custom'].includes(row.slug)).map((row) => [row.slug, Number(row.count || 0)]));
    res.json({ companies: companies[0], statuses, plans, planCounts, revenue: Number(revenue[0]?.total || 0), upcomingRenewals: renewals, expiring: expiring[0] || {}, billing: billing[0] || {} });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/plans', requireRole('super_admin'), async (req, res) => {
  try { res.json(await query('SELECT * FROM plans WHERE active = 1 ORDER BY price')); } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/plans', requireRole('super_admin'), async (req, res) => {
  try {
    const { name, slug, price, durationMonths, maxUsers, maxCustomers, maxProducts, maxMonthlyOrders, maxStorageMb, limits, features } = req.body || {};
    if (!name || !slug || durationMonths === undefined) return res.status(400).json({ message: 'Plan name, slug and duration are required.' });
    const result = await insert('INSERT INTO plans (name, slug, price, duration_months, max_users, max_customers, max_products, max_monthly_orders, max_storage_mb, limits, features) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [String(name).trim().slice(0, 100), String(slug).trim().toLowerCase().slice(0, 80), Math.max(0, Number(price || 0)), Number(durationMonths), Math.max(0, Number(maxUsers || 5)), Math.max(0, Number(maxCustomers || 1000)), Math.max(0, Number(maxProducts || 500)), Math.max(0, Number(maxMonthlyOrders || 10000)), Math.max(0, Number(maxStorageMb || 1024)), JSON.stringify(limits || {}), JSON.stringify(features || {})]);
    res.status(201).json((await query('SELECT * FROM plans WHERE id = ?', [result.id]))[0]);
  } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 500).json({ message: error.message }); }
});

app.get('/api/companies/:id/subscription', requireRole('super_admin'), async (req, res) => {
  try {
    const subscription = await getCompanySubscription(Number(req.params.id));
    const history = subscription ? await query('SELECT h.*, u.name AS created_by_name FROM subscription_history h LEFT JOIN users u ON u.id = h.created_by WHERE h.subscription_id = ? ORDER BY h.created_at DESC', [subscription.id]) : [];
    res.json({ subscription, history });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.put('/api/companies/:id/subscription', requireRole('super_admin'), async (req, res) => {
  try {
    const companyId = Number(req.params.id);
    const { planId, status, startDate, endDate, price, paymentStatus, renewalDate } = req.body || {};
    const existing = await getCompanySubscription(companyId);
    if (!existing) return res.status(404).json({ message: 'Subscription not found.' });
    const validStatuses = ['active', 'trial', 'pending_payment', 'expired', 'suspended', 'cancelled'];
    const next = { planId: Number(planId || existing.plan_id), status: status || existing.status, startDate: startDate || existing.start_date, endDate: endDate || existing.end_date, price: price === undefined ? existing.price : Number(price), paymentStatus: paymentStatus || existing.payment_status, renewalDate: renewalDate || existing.renewal_date };
    if (!validStatuses.includes(next.status) || !/^\d{4}-\d{2}-\d{2}$/.test(next.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(next.endDate) || !Number.isFinite(next.price) || next.price < 0) return res.status(400).json({ message: 'Invalid subscription status, dates, or price.' });
    if (!(await query('SELECT id FROM plans WHERE id = ? AND active = 1', [next.planId]))[0]) return res.status(400).json({ message: 'Active plan not found.' });
    await update('UPDATE subscriptions SET plan_id = ?, status = ?, start_date = ?, end_date = ?, price = ?, payment_status = ?, renewal_date = ?, activated_at = CASE WHEN ? IN ("active", "trial") THEN CURRENT_TIMESTAMP ELSE activated_at END, deactivated_at = CASE WHEN ? NOT IN ("active", "trial") THEN CURRENT_TIMESTAMP ELSE deactivated_at END WHERE id = ?', [next.planId, next.status, next.startDate, next.endDate, next.price, next.paymentStatus, next.renewalDate, next.status, next.status, existing.id]);
    await insert('INSERT INTO subscription_history (company_id, subscription_id, action, previous_value, new_value, created_by) VALUES (?, ?, ?, ?, ?, ?)', [companyId, existing.id, 'update', JSON.stringify(existing), JSON.stringify(next), req.user.id]);
    const updated = await getCompanySubscription(companyId);
    res.json(updated);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/companies/:id/subscription/payments', requireRole('super_admin'), async (req, res) => {
  try {
    const companyId = Number(req.params.id);
    const subscription = await getCompanySubscription(companyId);
    if (!subscription) return res.status(404).json({ message: 'Subscription not found.' });
    const { amount, amountDue, currency, paymentMethod, paymentReference, transactionReference, notes, paymentStatus = 'paid', paymentDate } = req.body || {};
    const validStatuses = ['paid', 'pending', 'overdue', 'partially_paid', 'waived', 'failed', 'refunded'];
    const paidAmount = Number(amount || 0);
    if (!Number.isFinite(paidAmount) || paidAmount < 0 || !validStatuses.includes(paymentStatus)) return res.status(400).json({ message: 'Invalid payment amount or status.' });
    const invoiceNumber = `SUB-${new Date().getUTCFullYear()}-${String(Date.now()).slice(-6)}`;
    const result = await insert('INSERT INTO subscription_payments (company_id, subscription_id, invoice_number, amount_due, amount, currency, payment_method, payment_reference, transaction_reference, payment_status, payment_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [companyId, subscription.id, invoiceNumber, Number(amountDue === undefined ? paidAmount : amountDue), paidAmount, String(currency || subscription.currency || 'PKR').toUpperCase().slice(0, 3), String(paymentMethod || 'manual').trim().slice(0, 40), String(paymentReference || transactionReference || '').trim().slice(0, 160), String(transactionReference || '').trim().slice(0, 160), paymentStatus, paymentDate || new Date().toISOString().slice(0, 10), String(notes || '').trim().slice(0, 500), req.user.id]);
    await update('UPDATE subscriptions SET payment_status = ?, last_payment_date = CASE WHEN ? IN ("paid","partially_paid") THEN CURRENT_TIMESTAMP ELSE last_payment_date END WHERE id = ?', [paymentStatus, paymentStatus, subscription.id]);
    await writeAudit(req, 'payment_recorded', 'subscription_payment', result.id, null, { companyId, subscriptionId: subscription.id, amount: paidAmount, status: paymentStatus, paymentMethod });
    res.status(201).json((await query('SELECT * FROM subscription_payments WHERE id = ?', [result.id]))[0]);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/companies/:id/subscription/renew', requireSuperAdmin, async (req, res) => {
  try {
    const companyId = Number(req.params.id);
    const subscription = await getCompanySubscription(companyId);
    if (!subscription) return res.status(404).json({ success: false, message: 'Subscription not found.' });
    const cycle = String(req.body?.billingCycle || 'monthly').toLowerCase();
    const days = { monthly: 30, quarterly: 90, '6_months': 182, yearly: 365, custom: Number(req.body?.days) }[cycle];
    if (!Number.isFinite(days) || days <= 0) return res.status(400).json({ success: false, message: 'Select a valid billing cycle or custom number of days.' });
    const today = new Date().toISOString().slice(0, 10);
    const base = subscription.end_date && subscription.end_date >= today ? subscription.end_date : today;
    const expiry = new Date(`${base}T00:00:00Z`);
    expiry.setUTCDate(expiry.getUTCDate() + days);
    const endDate = expiry.toISOString().slice(0, 10);
    const price = Number(req.body?.price === undefined ? subscription.price : req.body.price);
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ success: false, message: 'Invalid renewal price.' });
    await update('UPDATE subscriptions SET end_date = ?, renewal_date = ?, next_billing_date = ?, billing_cycle = ?, price = ?, status = "active", payment_status = ? WHERE id = ?', [endDate, endDate, endDate, cycle, price, req.body?.paymentStatus || 'pending', subscription.id]);
    if (req.body?.recordPayment) {
      await insert('INSERT INTO subscription_payments (company_id, subscription_id, invoice_number, amount_due, amount, currency, payment_method, payment_reference, payment_status, payment_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, date("now"), ?)', [companyId, subscription.id, `SUB-${new Date().getUTCFullYear()}-${String(Date.now()).slice(-6)}`, price, Number(req.body.amountPaid || price), subscription.currency || 'PKR', String(req.body.paymentMethod || 'manual').slice(0, 40), String(req.body.paymentReference || '').slice(0, 160), req.body.paymentStatus || 'paid', req.user.id]);
    }
    const updated = await getCompanySubscription(companyId);
    await writeAudit(req, 'subscription_renewed', 'subscription', subscription.id, subscription, updated);
    res.json({ success: true, subscription: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to renew subscription.' });
  }
});

app.post('/api/companies', requireRole('super_admin'), async (req, res) => {
  try {
    const { name, logo, phone, email, address, adminName, adminUsername, adminEmail, adminPassword } = req.body || {};
    if (!name || !adminName || !adminUsername || !adminPassword) {
      return res.status(400).json({ message: 'Company name and first company admin details are required.' });
    }
    const company = await insert(
      'INSERT INTO companies (name, logo, phone, email, address) VALUES (?, ?, ?, ?, ?)',
      [name, logo || '', phone || '', email || '', address || '']
    );
    const admin = await insert(
      'INSERT INTO users (company_id, username, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?, ?)',
      [company.id, adminUsername, adminEmail || email || '', hashPassword(adminPassword), adminName, 'company_admin']
    );
    const plan = await query('SELECT id FROM plans WHERE slug = ? LIMIT 1', ['normal']);
    const subscription = await insert('INSERT INTO subscriptions (company_id, plan_id, status, start_date, end_date, price, payment_status, renewal_date) VALUES (?, ?, ?, date("now"), date("now", "+14 days"), 0, ?, date("now", "+14 days"))', [company.id, plan[0].id, 'trial', 'pending']);
    await insert('INSERT INTO subscription_history (company_id, subscription_id, action, new_value, created_by) VALUES (?, ?, ?, ?, ?)', [company.id, subscription.id, 'created_trial', JSON.stringify({ status: 'trial' }), req.user.id]);
    await insert('INSERT INTO notifications (company_id, user_id, type, title, message) VALUES (?, ?, ?, ?, ?)', [company.id, admin.id, 'signup', 'Welcome to TEMO AQUAFLOW', 'Your 14-day trial has started.']);
    const created = await query('SELECT * FROM companies WHERE id = ?', [company.id]);
    res.status(201).json(created[0]);
  } catch (error) {
    const status = error.message.includes('UNIQUE') ? 409 : 500;
    res.status(status).json({ message: status === 409 ? 'That username already exists.' : error.message });
  }
});

app.put('/api/companies/:id', requireRole('super_admin'), async (req, res) => {
  try {
    const { name, logo, phone, email, address, active, defaultLanguage } = req.body || {};
    const language = String(defaultLanguage || req.body?.default_language || 'en').trim().toLowerCase();
    if (!SUPPORTED_LANGUAGES.includes(language)) return res.status(400).json({ message: 'Unsupported language.' });
    const companyId = Number(req.params.id);
    if (!companyId || !name) return res.status(400).json({ message: 'Company name is required.' });
    await update(
      'UPDATE companies SET name = ?, logo = ?, phone = ?, email = ?, address = ?, active = ?, default_language = ? WHERE id = ?',
            [name, logo || '', phone || '', email || '', address || '', active === undefined ? 1 : Number(Boolean(active)), language, companyId]
    );
    const company = await query('SELECT * FROM companies WHERE id = ?', [companyId]);
    if (!company[0]) return res.status(404).json({ message: 'Company not found.' });
    res.json(company[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/companies/:id/users', async (req, res) => {
  try {
    const companyId = Number(req.params.id);
    if (req.user.role !== 'super_admin' && (req.companyId !== companyId || !['company_admin', 'manager'].includes(req.user.role))) {
      return res.status(403).json({ message: 'You can only view users in your own company.' });
    }
    const users = await query('SELECT id, company_id, username, email, phone, name, role, active, status, must_change_password, archived_at, created_at FROM users WHERE company_id = ? ORDER BY id DESC', [companyId]);
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/companies/:id/users', async (req, res) => {
  try {
    const companyId = Number(req.params.id);
    if (req.user.role !== 'super_admin' && (req.user.role !== 'company_admin' || req.companyId !== companyId)) {
      return res.status(403).json({ message: 'You can only manage users in your own company.' });
    }
    const { username, email, password, name, role = 'staff' } = req.body || {};
    const allowedRoles = req.user.role === 'super_admin'
      ? ['company_admin', 'manager', 'accountant', 'sales_staff', 'inventory_staff', 'staff', 'driver', 'delivery_driver']
      : ['manager', 'accountant', 'sales_staff', 'inventory_staff', 'staff', 'driver', 'delivery_driver'];
    if (!username || !password || !name || !allowedRoles.includes(role)) {
      return res.status(400).json({ message: 'Name, username, password and a valid role are required.' });
    }
    const subscription = await getCompanySubscription(companyId);
    const currentUsers = await query('SELECT COUNT(*) AS count FROM users WHERE company_id = ? AND active = 1', [companyId]);
    if (subscription && Number(currentUsers[0]?.count || 0) >= Number(subscription.max_users || 999999)) {
      return res.status(409).json({ message: 'This subscription has reached its user limit.' });
    }
    const duplicate = await query('SELECT id FROM users WHERE LOWER(username) = LOWER(?) OR (email <> "" AND LOWER(email) = LOWER(?))', [username, email || '']);
    if (duplicate[0]) return res.status(409).json({ message: 'That username or email already exists.' });
    const result = await insert(
      'INSERT INTO users (company_id, username, email, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [companyId, username, email || '', hashPassword(password), name, role, 'active']
    );
    const user = await query('SELECT id, company_id, username, name, role, active FROM users WHERE id = ?', [result.id]);
    await insert('INSERT INTO notifications (company_id, user_id, type, title, message) VALUES (?, ?, ?, ?, ?)', [companyId, result.id, 'new_user', 'New user created', `${name} was added to your company.`]);
    await writeAudit(req, 'create', 'user', result.id, null, { companyId, username, role });
    res.status(201).json(user[0]);
  } catch (error) {
    const status = error.message.includes('UNIQUE') ? 409 : 500;
    res.status(status).json({ message: status === 409 ? 'That username already exists.' : error.message });
  }
});

app.patch('/api/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const target = req.user.role === 'super_admin'
      ? (await query('SELECT id, company_id FROM users WHERE id = ?', [userId]))[0]
      : (await query('SELECT id, company_id FROM users WHERE id = ? AND company_id = ?', [userId, req.companyId]))[0];
    if (!target || (req.user.role !== 'super_admin' && req.user.role !== 'company_admin')) {
      return res.status(404).json({ message: 'User not found.' });
    }
    const { name, email, phone, role, active, status, password, mustChangePassword } = req.body || {};
    const allowedRoles = req.user.role === 'super_admin'
      ? ['company_admin', 'manager', 'accountant', 'sales_staff', 'inventory_staff', 'staff', 'driver', 'delivery_driver']
      : ['manager', 'accountant', 'sales_staff', 'inventory_staff', 'staff', 'driver', 'delivery_driver'];
    if (role && !allowedRoles.includes(role)) return res.status(400).json({ message: 'Invalid user role.' });
    if (status && !['active', 'inactive', 'suspended', 'archived'].includes(String(status).toLowerCase())) return res.status(400).json({ message: 'Invalid user status.' });
    const existing = (await query('SELECT * FROM users WHERE id = ?', [userId]))[0];
    if (!existing) return res.status(404).json({ message: 'User not found.' });
    const changes = [];
    const params = [];
    if (name) { changes.push('name = ?'); params.push(name); }
    if (email !== undefined) { changes.push('email = ?'); params.push(String(email).trim().toLowerCase()); }
    if (phone !== undefined) { changes.push('phone = ?'); params.push(String(phone).trim().slice(0, 80)); }
    if (role) { changes.push('role = ?'); params.push(role); }
    if (status) { changes.push('status = ?'); params.push(String(status).toLowerCase()); changes.push('active = ?'); params.push(String(status).toLowerCase() === 'active' ? 1 : 0); if (String(status).toLowerCase() === 'archived') { changes.push('archived_at = CURRENT_TIMESTAMP'); } }
    else if (active !== undefined) { changes.push('active = ?'); params.push(Number(Boolean(active))); changes.push('status = ?'); params.push(active ? 'active' : 'inactive'); }
    if (password) { changes.push('password_hash = ?'); params.push(hashPassword(password)); }
    if (mustChangePassword !== undefined) { changes.push('must_change_password = ?'); params.push(Number(Boolean(mustChangePassword))); }
    if (!changes.length) return res.status(400).json({ message: 'No changes supplied.' });
    params.push(userId);
    await update(`UPDATE users SET ${changes.join(', ')} WHERE id = ?${req.user.role === 'super_admin' ? '' : ' AND company_id = ?'}`, req.user.role === 'super_admin' ? params : [...params, req.companyId]);
    const updated = (await query('SELECT id, company_id, username, email, phone, name, role, active, status, must_change_password, archived_at FROM users WHERE id = ?', [userId]))[0];
    await writeAudit(req, role && role !== existing.role ? 'user_role_changed' : password ? 'user_password_reset' : status === 'archived' ? 'user_archived' : 'user_updated', 'user', userId, { name: existing.name, email: existing.email, role: existing.role, status: existing.status, active: existing.active }, { name: updated.name, email: updated.email, role: updated.role, status: updated.status, active: updated.active });
    res.json({ success: true, user: updated });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const companyId = req.companyId;
    const [revenueRow, purchasesRow, expenseRow, productRow, lowStockRows, recentSalesRows, customersRow, suppliersRow] = await Promise.all([
      query('SELECT COALESCE(SUM(total_amount), 0) AS revenue FROM sales WHERE company_id = ?', [companyId]),
      query('SELECT COALESCE(SUM(total_amount), 0) AS purchases FROM purchases WHERE company_id = ?', [companyId]),
      query('SELECT COALESCE(SUM(amount), 0) AS expenses FROM expenses WHERE company_id = ?', [companyId]),
      query('SELECT COUNT(*) AS totalProducts, COALESCE(SUM(stock), 0) AS totalStock FROM products WHERE company_id = ?', [companyId]),
      query('SELECT * FROM products WHERE company_id = ? AND stock <= 10 ORDER BY stock ASC LIMIT 5', [companyId]),
      query('SELECT s.id, s.customer_name, s.total_amount, s.created_at FROM sales s WHERE s.company_id = ? ORDER BY s.id DESC LIMIT 5', [companyId]),
      query('SELECT COUNT(*) AS customersCount FROM customers WHERE company_id = ?', [companyId]),
      query('SELECT COUNT(*) AS suppliersCount FROM suppliers WHERE company_id = ?', [companyId])
    ]);

    const revenue = Number(revenueRow[0]?.revenue || 0);
    const purchases = Number(purchasesRow[0]?.purchases || 0);
    const expenses = Number(expenseRow[0]?.expenses || 0);

    res.json({
      revenue,
      purchases,
      expenses,
      profit: revenue - purchases - expenses,
      totalProducts: Number(productRow[0]?.totalProducts || 0),
      totalStock: Number(productRow[0]?.totalStock || 0),
      customersCount: Number(customersRow[0]?.customersCount || 0),
      suppliersCount: Number(suppliersRow[0]?.suppliersCount || 0),
      lowStock: lowStockRows,
      recentSales: recentSalesRows
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/dashboard/analytics', async (req, res) => {
  try {
    const companyId = req.companyId;
    const { start, end } = getPeriodRange(req.query);
    const dateFilter = (column) => start ? ` AND ${column} >= ? AND ${column} < ?` : '';
    const periodParams = start ? [start, end] : [];
    const scoped = [companyId, ...periodParams];
    const [salesTotals, purchaseTotals, expenseTotals, paymentTotals, salesTrend, purchaseTrend, expenseTrend, inventory, lowStock, customerStock, stockMovement, pendingSales, pendingPurchases] = await Promise.all([
      query(`SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS invoices FROM sales WHERE company_id = ?${dateFilter('created_at')}`, scoped),
      query(`SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS invoices FROM purchases WHERE company_id = ?${dateFilter('created_at')}`, scoped),
      query(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE company_id = ?${dateFilter('created_at')}`, scoped),
      query(`SELECT method, direction, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS transactions FROM payments WHERE company_id = ?${dateFilter('created_at')} GROUP BY method, direction`, scoped),
      query(`SELECT DATE(created_at) AS label, SUM(total_amount) AS total FROM sales WHERE company_id = ?${dateFilter('created_at')} GROUP BY DATE(created_at) ORDER BY label`, scoped),
      query(`SELECT DATE(created_at) AS label, SUM(total_amount) AS total FROM purchases WHERE company_id = ?${dateFilter('created_at')} GROUP BY DATE(created_at) ORDER BY label`, scoped),
      query(`SELECT DATE(created_at) AS label, SUM(amount) AS total FROM expenses WHERE company_id = ?${dateFilter('created_at')} GROUP BY DATE(created_at) ORDER BY label`, scoped),
      query('SELECT COALESCE(SUM(stock * purchase_price), 0) AS cost, COALESCE(SUM(stock * sale_price), 0) AS retail, COALESCE(SUM(stock), 0) AS units FROM products WHERE company_id = ?', [companyId]),
      query('SELECT COUNT(*) AS count FROM products WHERE company_id = ? AND stock <= COALESCE(NULLIF(reorder_level, 0), min_stock, 0)', [companyId]),
      query(`
        SELECT c.id AS customer_id, c.name AS customer, p.name AS product,
          SUM(CASE WHEN sm.movement_type = 'customer_out' THEN sm.quantity WHEN sm.movement_type = 'customer_return' THEN -sm.quantity ELSE 0 END) AS quantity
        FROM stock_movements sm
        JOIN customers c ON c.id = sm.customer_id AND c.company_id = sm.company_id
        JOIN products p ON p.id = sm.product_id AND p.company_id = sm.company_id
        WHERE sm.company_id = ? AND sm.customer_id IS NOT NULL${dateFilter('sm.created_at')}
        GROUP BY c.id, p.id
        HAVING quantity > 0
        ORDER BY c.name, p.name
      `, scoped),
      query(`SELECT movement_type, COALESCE(SUM(quantity), 0) AS quantity FROM stock_movements WHERE company_id = ?${dateFilter('created_at')} GROUP BY movement_type`, scoped),
      query(`SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS count FROM sales WHERE company_id = ? AND (status IS NULL OR status != 'paid')${dateFilter('created_at')}`, scoped),
      query(`SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS count FROM purchases WHERE company_id = ? AND (status IS NULL OR status != 'paid')${dateFilter('created_at')}`, scoped)
    ]);

    const paymentRows = paymentTotals;
    const cashReceived = Number(paymentRows.find((row) => row.method === 'Cash' && row.direction !== 'payment')?.total || 0);
    const bankReceived = Number(paymentRows.find((row) => row.method === 'Bank Transfer' && row.direction !== 'payment')?.total || 0);
    const cashPaid = Number(paymentRows.find((row) => row.method === 'Cash' && row.direction === 'payment')?.total || 0) + Number((await query(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE company_id = ? AND payment_method = 'Cash'${dateFilter('created_at')}`, scoped))[0]?.total || 0);
    const bankPaid = Number(paymentRows.find((row) => row.method === 'Bank Transfer' && row.direction === 'payment')?.total || 0) + Number((await query(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE company_id = ? AND payment_method = 'Bank Transfer'${dateFilter('created_at')}`, scoped))[0]?.total || 0);
    const revenue = Number(salesTotals[0]?.total || 0);
    const purchases = Number(purchaseTotals[0]?.total || 0);
    const expenses = Number(expenseTotals[0]?.total || 0);
    const opening = await query('SELECT opening_cash, opening_bank FROM companies WHERE id = ?', [companyId]);
    const openingCash = Number(opening[0]?.opening_cash || 0);
    const openingBank = Number(opening[0]?.opening_bank || 0);
    const receivables = Math.max(0, revenue - paymentRows.filter((row) => row.direction !== 'payment').reduce((sum, row) => sum + Number(row.total || 0), 0));
    const payables = Math.max(0, purchases - paymentRows.filter((row) => row.direction === 'payment').reduce((sum, row) => sum + Number(row.total || 0), 0));
    const netCashFlow = cashReceived + bankReceived - cashPaid - bankPaid;

    res.json({
      period: { start, end },
      kpis: {
        sales: revenue,
        purchases,
        grossProfit: revenue - purchases,
        netProfit: revenue - purchases - expenses,
        cashBalance: openingCash + cashReceived - cashPaid,
        bankBalance: openingBank + bankReceived - bankPaid,
        receivables,
        payables,
        inventoryValue: Number(inventory[0]?.cost || 0),
        lowStockItems: Number(lowStock[0]?.count || 0),
        pendingInvoices: Number(pendingSales[0]?.count || 0),
        overduePayments: Number(pendingPurchases[0]?.count || 0)
      },
      cashFlow: { cashReceived, bankReceived, cashPaid, bankPaid, pendingPayments: receivables + payables, accountsReceivable: receivables, accountsPayable: payables, netCashFlow, openingBalance: openingCash + openingBank, closingBalance: openingCash + openingBank + netCashFlow },
      paymentMethods: paymentRows,
      trends: { sales: salesTrend, purchases: purchaseTrend, expenses: expenseTrend },
      inventory: { ...inventory[0], movements: stockMovement },
      customerStock,
      pending: { sales: pendingSales[0], purchases: pendingPurchases[0] }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const products = await query('SELECT * FROM products WHERE company_id = ? ORDER BY id DESC', [req.companyId]);
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, category, purchasePrice, salePrice, stock } = req.body;

    if (!name || !purchasePrice || !salePrice || !stock) {
      return res.status(400).json({ message: 'Name, purchase price, sale price and stock are required.' });
    }

    await enforceUsageLimit(req, USAGE_METRICS.products);
    const result = await insert(
      'INSERT INTO products (company_id, name, category, purchase_price, sale_price, stock) VALUES (?, ?, ?, ?, ?, ?)',
      [req.companyId, name, category || '', Number(purchasePrice), Number(salePrice), Number(stock)]
    );

    const product = await query('SELECT * FROM products WHERE id = ? AND company_id = ?', [result.id, req.companyId]);
    res.status(201).json(product[0]);
  } catch (error) {
    res.status(error.statusCode || 500).json({ code: error.code, message: error.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { name, category, purchasePrice, salePrice, stock } = req.body;
    const productId = Number(req.params.id);

    if (!productId || !name || purchasePrice === undefined || salePrice === undefined || stock === undefined) {
      return res.status(400).json({ message: 'Product name, rates and stock are required.' });
    }

    await update(
      'UPDATE products SET name = ?, category = ?, purchase_price = ?, sale_price = ?, stock = ? WHERE id = ? AND company_id = ?',
      [name, category || '', Number(purchasePrice), Number(salePrice), Number(stock), productId, req.companyId]
    );

    const product = await query('SELECT * FROM products WHERE id = ? AND company_id = ?', [productId, req.companyId]);
    if (!product[0]) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    res.json(product[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/customers', async (req, res) => {
  try {
    const customers = await query('SELECT * FROM customers WHERE company_id = ? ORDER BY id DESC', [req.companyId]);
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/customers', async (req, res) => {
  try {
    const { name, phone, address, area, latitude, longitude } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Customer name is required.' });
    }

    await enforceUsageLimit(req, USAGE_METRICS.customers);
    const parsedLatitude = latitude === '' || latitude === undefined ? null : Number(latitude);
    const parsedLongitude = longitude === '' || longitude === undefined ? null : Number(longitude);
    if ((parsedLatitude !== null && (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90)) || (parsedLongitude !== null && (!Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180))) return res.status(400).json({ message: 'Latitude must be between -90 and 90 and longitude between -180 and 180.' });
    const result = await insert(
      'INSERT INTO customers (company_id, name, phone, address, area, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.companyId, name, phone || '', address || '', String(area || '').trim().slice(0, 120), parsedLatitude, parsedLongitude]
    );

    const customer = await query('SELECT * FROM customers WHERE id = ? AND company_id = ?', [result.id, req.companyId]);
    res.status(201).json(customer[0]);
  } catch (error) {
    res.status(error.statusCode || 500).json({ code: error.code, message: error.message });
  }
});

const complaintRoles = ['super_admin', 'company_admin', 'manager', 'sales_staff', 'staff', 'accountant'];
const complaintManagerRoles = ['super_admin', 'company_admin', 'manager'];
const complaintStatuses = ['open', 'assigned', 'in_progress', 'resolved', 'closed'];

function complaintPayload(body = {}) {
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const priority = String(body.priority || 'normal').trim();
  if (!title || title.length > 160) return { error: 'A complaint title is required and must be 160 characters or fewer.' };
  if (!description || description.length > 5000) return { error: 'Complaint description is required and must be 5000 characters or fewer.' };
  if (!['low', 'normal', 'high', 'urgent'].includes(priority)) return { error: 'Invalid complaint priority.' };
  return { title, description, priority };
}

function complaintQuery() {
  return `SELECT c.*, cu.name AS customer_name, cu.phone AS customer_phone, au.name AS assignee_name, creator.name AS created_by_name
    FROM complaints c LEFT JOIN customers cu ON cu.id = c.customer_id AND cu.company_id = c.company_id
    LEFT JOIN users au ON au.id = c.assigned_to AND au.company_id = c.company_id
    LEFT JOIN users creator ON creator.id = c.created_by WHERE c.company_id = ?`;
}

app.get('/api/complaint-assignees', requireRole(...complaintRoles), async (req, res) => {
  try { res.json(await query("SELECT id, name, role FROM users WHERE company_id = ? AND active = 1 ORDER BY name", [req.companyId])); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/complaints', requireRole(...complaintRoles), async (req, res) => {
  try {
    const params = [req.companyId];
    let sql = `${complaintQuery()}`;
    if (req.query.status && complaintStatuses.includes(req.query.status)) { sql += ' AND c.status = ?'; params.push(req.query.status); }
    if (req.query.assignedTo) { sql += ' AND c.assigned_to = ?'; params.push(Number(req.query.assignedTo)); }
    sql += ' ORDER BY CASE c.priority WHEN \'urgent\' THEN 1 WHEN \'high\' THEN 2 WHEN \'normal\' THEN 3 ELSE 4 END, c.updated_at DESC';
    res.json(await query(sql, params));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/complaints', requireRole(...complaintRoles), async (req, res) => {
  try {
    const payload = complaintPayload(req.body);
    if (payload.error) return res.status(400).json({ message: payload.error });
    const customerId = req.body.customerId ? Number(req.body.customerId) : null;
    if (customerId && !(await query('SELECT id FROM customers WHERE id = ? AND company_id = ?', [customerId, req.companyId]))[0]) return res.status(400).json({ message: 'Customer is outside this company.' });
    const result = await insert('INSERT INTO complaints (company_id, customer_id, title, description, priority, created_by) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, customerId, payload.title, payload.description, payload.priority, req.user.id]);
    const complaint = (await query(`${complaintQuery()} AND c.id = ?`, [req.companyId, result.id]))[0];
    await writeAudit(req, 'create', 'complaint', result.id, null, complaint);
    res.status(201).json(complaint);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/complaints/:id', requireRole(...complaintRoles), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = (await query(`${complaintQuery()} AND c.id = ?`, [req.companyId, id]))[0];
    if (!existing) return res.status(404).json({ message: 'Complaint not found.' });
    const body = req.body || {};
    const nextStatus = body.status === undefined ? existing.status : String(body.status);
    if (!complaintStatuses.includes(nextStatus)) return res.status(400).json({ message: 'Invalid complaint status.' });
    if ((body.assignedTo !== undefined || body.status !== undefined) && !complaintManagerRoles.includes(req.user.role)) return res.status(403).json({ message: 'Only managers can assign or change complaint status.' });
    let assignedTo = body.assignedTo === undefined ? existing.assigned_to : (body.assignedTo ? Number(body.assignedTo) : null);
    if (assignedTo && !(await query('SELECT id FROM users WHERE id = ? AND company_id = ? AND active = 1', [assignedTo, req.companyId]))[0]) return res.status(400).json({ message: 'Assignee is outside this company or inactive.' });
    const title = body.title === undefined ? existing.title : String(body.title).trim();
    const description = body.description === undefined ? existing.description : String(body.description).trim();
    const priority = body.priority === undefined ? existing.priority : String(body.priority);
    if (!title || title.length > 160 || !description || description.length > 5000 || !['low','normal','high','urgent'].includes(priority)) return res.status(400).json({ message: 'Invalid complaint fields.' });
    const notes = body.notes === undefined ? existing.notes : String(body.notes).trim().slice(0, 5000);
    const resolution = body.resolution === undefined ? existing.resolution : String(body.resolution).trim().slice(0, 5000);
    const resolvedAt = nextStatus === 'resolved' ? (existing.resolved_at || new Date().toISOString()) : null;
    const closedAt = nextStatus === 'closed' ? (existing.closed_at || new Date().toISOString()) : null;
    await update('UPDATE complaints SET title = ?, description = ?, priority = ?, status = ?, assigned_to = ?, notes = ?, resolution = ?, resolved_at = ?, closed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [title, description, priority, nextStatus, assignedTo, notes, resolution, resolvedAt, closedAt, id, req.companyId]);
    const complaint = (await query(`${complaintQuery()} AND c.id = ?`, [req.companyId, id]))[0];
    await writeAudit(req, 'update', 'complaint', id, existing, complaint);
    res.json(complaint);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/complaints/:id/notes', requireRole(...complaintRoles), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const note = String(req.body?.notes || '').trim();
    if (!note || note.length > 5000) return res.status(400).json({ message: 'A note of 1-5000 characters is required.' });
    const existing = (await query(`${complaintQuery()} AND c.id = ?`, [req.companyId, id]))[0];
    if (!existing) return res.status(404).json({ message: 'Complaint not found.' });
    const notes = existing.notes ? `${existing.notes}\n${note}` : note;
    await update('UPDATE complaints SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [notes, id, req.companyId]);
    const complaint = (await query(`${complaintQuery()} AND c.id = ?`, [req.companyId, id]))[0];
    await writeAudit(req, 'note', 'complaint', id, existing, complaint);
    res.json(complaint);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/complaints/:id/resolve', requireRole(...complaintManagerRoles), async (req, res) => {
  try {
    const resolution = String(req.body?.resolution || '').trim();
    const id = Number(req.params.id);
    if (!resolution || resolution.length > 5000) return res.status(400).json({ message: 'Resolution of 1-5000 characters is required.' });
    const existing = (await query(`${complaintQuery()} AND c.id = ?`, [req.companyId, id]))[0];
    if (!existing) return res.status(404).json({ message: 'Complaint not found.' });
    await update('UPDATE complaints SET status = \'resolved\', resolution = ?, resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [resolution, id, req.companyId]);
    const complaint = (await query(`${complaintQuery()} AND c.id = ?`, [req.companyId, id]))[0];
    await writeAudit(req, 'resolve', 'complaint', id, existing, complaint);
    res.json(complaint);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

const vehicleManagerRoles = ['super_admin', 'company_admin', 'manager'];
const vehicleReadRoles = ['super_admin', 'company_admin', 'manager', 'accountant', 'sales_staff', 'staff', 'driver', 'delivery_driver'];
const vehicleStatuses = ['active', 'maintenance', 'inactive', 'retired'];
const vehicleFuelTypes = ['petrol', 'diesel', 'cng', 'electric', 'hybrid', 'other'];

function vehiclePayload(body = {}, existing = {}) {
  const vehicleNumber = String(body.vehicleNumber ?? existing.vehicle_number ?? '').trim();
  const registration = String(body.registration ?? existing.registration ?? '').trim();
  const vehicleType = String(body.vehicleType ?? existing.vehicle_type ?? '').trim();
  const capacity = body.capacity === undefined ? Number(existing.capacity) : Number(body.capacity);
  const fuelType = String(body.fuelType ?? existing.fuel_type ?? '').trim().toLowerCase();
  const mileage = body.mileage === undefined ? Number(existing.mileage || 0) : Number(body.mileage);
  const maintenanceDate = body.maintenanceDate === undefined ? (existing.maintenance_date || null) : (body.maintenanceDate || null);
  const insuranceExpiry = body.insuranceExpiry === undefined ? (existing.insurance_expiry || null) : (body.insuranceExpiry || null);
  const registrationExpiry = body.registrationExpiry === undefined ? (existing.registration_expiry || null) : (body.registrationExpiry || null);
  const serviceHistory = body.serviceHistory === undefined ? String(existing.service_history || '') : String(body.serviceHistory || '').trim();
  const status = String(body.status ?? existing.status ?? 'active').trim().toLowerCase();
  if (!vehicleNumber || vehicleNumber.length > 60) return { error: 'Vehicle number is required and must be 60 characters or fewer.' };
  if (registration.length > 100) return { error: 'Registration must be 100 characters or fewer.' };
  if (!vehicleType || vehicleType.length > 80) return { error: 'Vehicle type is required and must be 80 characters or fewer.' };
  if (!Number.isFinite(capacity) || capacity <= 0 || capacity > 100000) return { error: 'Capacity must be greater than zero.' };
  if (!vehicleFuelTypes.includes(fuelType)) return { error: 'Select a valid fuel type.' };
  if (!Number.isFinite(mileage) || mileage < 0) return { error: 'Mileage must be zero or greater.' };
  if (!vehicleStatuses.includes(status)) return { error: 'Invalid vehicle status.' };
  for (const date of [maintenanceDate, insuranceExpiry, registrationExpiry]) {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return { error: 'Dates must use YYYY-MM-DD format.' };
  }
  if (serviceHistory.length > 10000) return { error: 'Service history must be 10,000 characters or fewer.' };
  return { vehicleNumber, registration, vehicleType, capacity, fuelType, mileage, maintenanceDate, insuranceExpiry, registrationExpiry, serviceHistory, status };
}

function vehicleQuery() {
  return `SELECT v.*, u.name AS driver_name, u.username AS driver_username, u.role AS driver_role
    FROM vehicles v LEFT JOIN users u ON u.id = v.driver_id AND u.company_id = v.company_id WHERE v.company_id = ?`;
}

app.get('/api/vehicles', requireRole(...vehicleReadRoles), async (req, res) => {
  try {
    let sql = vehicleQuery();
    const params = [req.companyId];
    if (req.query.status && vehicleStatuses.includes(String(req.query.status))) { sql += ' AND v.status = ?'; params.push(String(req.query.status)); }
    sql += ' ORDER BY v.vehicle_number COLLATE NOCASE';
    res.json(await query(sql, params));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/vehicles', requireRole(...vehicleManagerRoles), async (req, res) => {
  try {
    const payload = vehiclePayload(req.body);
    if (payload.error) return res.status(400).json({ message: payload.error });
    const driverId = req.body?.driverId ? Number(req.body.driverId) : null;
    if (driverId && !(await query("SELECT id FROM users WHERE id = ? AND company_id = ? AND active = 1 AND role IN ('driver','delivery_driver')", [driverId, req.companyId]))[0]) return res.status(400).json({ message: 'Driver must be an active driver in this company.' });
    const result = await insert('INSERT INTO vehicles (company_id, vehicle_number, registration, vehicle_type, capacity, fuel_type, mileage, maintenance_date, insurance_expiry, registration_expiry, service_history, status, driver_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, payload.vehicleNumber, payload.registration, payload.vehicleType, payload.capacity, payload.fuelType, payload.mileage, payload.maintenanceDate, payload.insuranceExpiry, payload.registrationExpiry, payload.serviceHistory, payload.status, driverId]);
    const vehicle = (await query(`${vehicleQuery()} AND v.id = ?`, [req.companyId, result.id]))[0];
    await writeAudit(req, 'create', 'vehicle', result.id, null, vehicle);
    res.status(201).json(vehicle);
  } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 500).json({ message: error.message.includes('UNIQUE') ? 'Vehicle number already exists in this company.' : error.message }); }
});

app.patch('/api/vehicles/:id', requireRole(...vehicleManagerRoles), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = (await query(`${vehicleQuery()} AND v.id = ?`, [req.companyId, id]))[0];
    if (!existing) return res.status(404).json({ message: 'Vehicle not found.' });
    const payload = vehiclePayload(req.body, existing);
    if (payload.error) return res.status(400).json({ message: payload.error });
    const driverId = req.body?.driverId === undefined ? existing.driver_id : (req.body.driverId ? Number(req.body.driverId) : null);
    if (driverId && !(await query("SELECT id FROM users WHERE id = ? AND company_id = ? AND active = 1 AND role IN ('driver','delivery_driver')", [driverId, req.companyId]))[0]) return res.status(400).json({ message: 'Driver must be an active driver in this company.' });
    await update('UPDATE vehicles SET vehicle_number = ?, registration = ?, vehicle_type = ?, capacity = ?, fuel_type = ?, mileage = ?, maintenance_date = ?, insurance_expiry = ?, registration_expiry = ?, service_history = ?, status = ?, driver_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [payload.vehicleNumber, payload.registration, payload.vehicleType, payload.capacity, payload.fuelType, payload.mileage, payload.maintenanceDate, payload.insuranceExpiry, payload.registrationExpiry, payload.serviceHistory, payload.status, driverId, id, req.companyId]);
    const vehicle = (await query(`${vehicleQuery()} AND v.id = ?`, [req.companyId, id]))[0];
    await writeAudit(req, 'update', 'vehicle', id, existing, vehicle);
    res.json(vehicle);
  } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 500).json({ message: error.message.includes('UNIQUE') ? 'Vehicle number already exists in this company.' : error.message }); }
});

app.patch('/api/vehicles/:id/status', requireRole(...vehicleManagerRoles), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!vehicleStatuses.includes(status)) return res.status(400).json({ message: 'Invalid vehicle status.' });
    const existing = (await query(`${vehicleQuery()} AND v.id = ?`, [req.companyId, id]))[0];
    if (!existing) return res.status(404).json({ message: 'Vehicle not found.' });
    await update('UPDATE vehicles SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [status, id, req.companyId]);
    const vehicle = (await query(`${vehicleQuery()} AND v.id = ?`, [req.companyId, id]))[0];
    await writeAudit(req, 'status_change', 'vehicle', id, { status: existing.status }, { status: vehicle.status });
    res.json(vehicle);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

const fleetWriteRoles = ['super_admin', 'company_admin', 'manager'];
const fleetReadRoles = [...vehicleReadRoles, 'inventory_staff'];
const equipmentStatuses = ['active', 'maintenance', 'inactive', 'retired', 'lost'];
const fleetEntityTypes = ['vehicle', 'equipment'];
const dateValue = (value) => value == null || value === '' || /^\\d{4}-\\d{2}-\\d{2}$/.test(String(value));
const fleetEntity = async (companyId, entityType, entityId) => {
  if (!fleetEntityTypes.includes(entityType) || !Number.isInteger(Number(entityId))) return null;
  const table = entityType === 'vehicle' ? 'vehicles' : 'equipment_assets';
  return (await query(`SELECT * FROM ${table} WHERE id = ? AND company_id = ?`, [Number(entityId), companyId]))[0] || null;
};

app.get('/api/fleet/service-schedules', requireRole(...fleetReadRoles), async (req, res) => {
  try { const params = [req.companyId]; let sql = `SELECT s.*, v.vehicle_number, v.vehicle_type FROM vehicle_service_schedules s JOIN vehicles v ON v.id=s.vehicle_id AND v.company_id=s.company_id WHERE s.company_id=?`; if (req.query.vehicleId) { sql += ' AND s.vehicle_id=?'; params.push(Number(req.query.vehicleId)); } sql += ' ORDER BY COALESCE(s.next_due_date, \'9999-12-31\'), s.id DESC'; res.json(await query(sql, params)); } catch (error) { res.status(500).json({ message: error.message }); }
});
app.post('/api/fleet/service-schedules', requireRole(...fleetWriteRoles), async (req, res) => {
  try { const b=req.body||{}, vehicleId=Number(b.vehicleId), serviceType=String(b.serviceType||'').trim(), days=b.intervalDays==null||b.intervalDays===''?null:Number(b.intervalDays), mileage=b.intervalMileage==null||b.intervalMileage===''?null:Number(b.intervalMileage); if (!(await fleetEntity(req.companyId,'vehicle',vehicleId)) || !serviceType || serviceType.length>120 || (days!==null && (!Number.isInteger(days)||days<1)) || (mileage!==null && (!Number.isFinite(mileage)||mileage<0)) || !dateValue(b.nextDueDate) || (b.nextDueMileage!=null && b.nextDueMileage!=='' && (!Number.isFinite(Number(b.nextDueMileage))||Number(b.nextDueMileage)<0))) return res.status(400).json({message:'Valid vehicle, service type, intervals and dates are required.'}); const r=await insert('INSERT INTO vehicle_service_schedules (company_id,vehicle_id,service_type,interval_days,interval_mileage,next_due_date,next_due_mileage,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?)',[req.companyId,vehicleId,serviceType,days,mileage,b.nextDueDate||null,b.nextDueMileage==null||b.nextDueMileage===''?null:Number(b.nextDueMileage),String(b.notes||'').trim().slice(0,2000),req.user.id]); const row=(await query('SELECT * FROM vehicle_service_schedules WHERE id=? AND company_id=?',[r.id,req.companyId]))[0]; await writeAudit(req,'create','vehicle_service_schedule',r.id,null,row); res.status(201).json(row); } catch(error){res.status(500).json({message:error.message});}
});
app.get('/api/fleet/service-records', requireRole(...fleetReadRoles), async (req,res)=>{try{const p=[req.companyId];let s=`SELECT r.*,v.vehicle_number FROM vehicle_service_records r JOIN vehicles v ON v.id=r.vehicle_id AND v.company_id=r.company_id WHERE r.company_id=?`;if(req.query.vehicleId){s+=' AND r.vehicle_id=?';p.push(Number(req.query.vehicleId));}s+=' ORDER BY r.service_date DESC,r.id DESC LIMIT 500';res.json(await query(s,p));}catch(e){res.status(500).json({message:e.message});}});
app.post('/api/fleet/service-records', requireRole(...fleetWriteRoles), async (req,res)=>{try{const b=req.body||{}, vehicleId=Number(b.vehicleId), cost=Number(b.cost||0), odo=Number(b.odometer||0), serviceDate=String(b.serviceDate||'');if(!(await fleetEntity(req.companyId,'vehicle',vehicleId))||!/^\\d{4}-\\d{2}-\\d{2}$/.test(serviceDate)||!String(b.serviceType||'').trim()||!Number.isFinite(cost)||cost<0||!Number.isFinite(odo)||odo<0)return res.status(400).json({message:'Valid vehicle, service date, type, odometer and non-negative cost are required.'});const r=await insert('INSERT INTO vehicle_service_records (company_id,vehicle_id,service_date,service_type,odometer,provider,cost,invoice_reference,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',[req.companyId,vehicleId,serviceDate,String(b.serviceType).trim().slice(0,120),odo,String(b.provider||'').trim().slice(0,160),cost,String(b.invoiceReference||'').trim().slice(0,120),String(b.notes||'').trim().slice(0,3000),req.user.id]);await update('UPDATE vehicles SET mileage=CASE WHEN mileage<? THEN ? ELSE mileage END,maintenance_date=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?',[odo,odo,vehicleId,req.companyId]);const row=(await query('SELECT * FROM vehicle_service_records WHERE id=? AND company_id=?',[r.id,req.companyId]))[0];await writeAudit(req,'create','vehicle_service_record',r.id,null,row);res.status(201).json(row);}catch(e){res.status(500).json({message:e.message});}});
app.get('/api/fleet/fuel-logs', requireRole(...fleetReadRoles), async (req,res)=>{try{const p=[req.companyId];let s=`SELECT f.*,v.vehicle_number,u.name AS driver_name FROM vehicle_fuel_logs f JOIN vehicles v ON v.id=f.vehicle_id AND v.company_id=f.company_id LEFT JOIN users u ON u.id=f.driver_id AND u.company_id=f.company_id WHERE f.company_id=?`;if(req.query.vehicleId){s+=' AND f.vehicle_id=?';p.push(Number(req.query.vehicleId));}s+=' ORDER BY f.fuel_date DESC,f.id DESC LIMIT 500';res.json(await query(s,p));}catch(e){res.status(500).json({message:e.message});}});
app.post('/api/fleet/fuel-logs', requireRole(...fleetWriteRoles), async (req,res)=>{try{const b=req.body||{},vehicleId=Number(b.vehicleId),quantity=Number(b.quantity),unitCost=Number(b.unitCost),odo=Number(b.odometer||0),fuelDate=String(b.fuelDate||'');if(!(await fleetEntity(req.companyId,'vehicle',vehicleId))||!/^\\d{4}-\\d{2}-\\d{2}$/.test(fuelDate)||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitCost)||unitCost<0||!Number.isFinite(odo)||odo<0)return res.status(400).json({message:'Valid vehicle, date, quantity, unit cost and odometer are required.'});const driverId=b.driverId?Number(b.driverId):null;if(driverId&&!(await query("SELECT id FROM users WHERE id=? AND company_id=? AND active=1 AND role IN ('driver','delivery_driver')",[driverId,req.companyId]))[0])return res.status(400).json({message:'Driver must belong to this company.'});const totalCost=Number((quantity*unitCost).toFixed(2)),r=await insert('INSERT INTO vehicle_fuel_logs (company_id,vehicle_id,fuel_date,odometer,quantity,unit_cost,total_cost,station,driver_id,receipt_reference,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[req.companyId,vehicleId,fuelDate,odo,quantity,unitCost,totalCost,String(b.station||'').trim().slice(0,160),driverId,String(b.receiptReference||'').trim().slice(0,120),String(b.notes||'').trim().slice(0,2000),req.user.id]);await update('UPDATE vehicles SET mileage=CASE WHEN mileage<? THEN ? ELSE mileage END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?',[odo,odo,vehicleId,req.companyId]);const row=(await query('SELECT * FROM vehicle_fuel_logs WHERE id=? AND company_id=?',[r.id,req.companyId]))[0];await writeAudit(req,'create','vehicle_fuel_log',r.id,null,row);res.status(201).json(row);}catch(e){res.status(500).json({message:e.message});}});
app.get('/api/equipment', requireRole(...fleetReadRoles), async (req,res)=>{try{let s=`SELECT a.*,e.full_name AS assigned_employee_name FROM equipment_assets a LEFT JOIN employees e ON e.id=a.assigned_employee_id AND e.company_id=a.company_id WHERE a.company_id=?`,p=[req.companyId];if(req.query.status&&equipmentStatuses.includes(String(req.query.status))){s+=' AND a.status=?';p.push(String(req.query.status));}s+=' ORDER BY a.name COLLATE NOCASE';res.json(await query(s,p));}catch(e){res.status(500).json({message:e.message});}});
app.post('/api/equipment', requireRole(...fleetWriteRoles), async (req,res)=>{try{const b=req.body||{},tag=String(b.assetTag||'').trim(),name=String(b.name||'').trim(),status=String(b.status||'active').toLowerCase(),cost=Number(b.purchaseCost||0),value=Number(b.currentValue==null?cost:b.currentValue),employeeId=b.assignedEmployeeId?Number(b.assignedEmployeeId):null;if(!tag||tag.length>80||!name||name.length>160||!equipmentStatuses.includes(status)||!Number.isFinite(cost)||cost<0||!Number.isFinite(value)||value<0||!dateValue(b.purchaseDate)||(employeeId&&!(await query('SELECT id FROM employees WHERE id=? AND company_id=? AND status<>?',[employeeId,req.companyId,'terminated']))[0]))return res.status(400).json({message:'Valid asset tag, name, status, values, date and employee are required.'});const r=await insert('INSERT INTO equipment_assets (company_id,asset_tag,name,asset_type,serial_number,location,purchase_date,purchase_cost,current_value,status,assigned_employee_id,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[req.companyId,tag,name,String(b.assetType||'').trim().slice(0,100),String(b.serialNumber||'').trim().slice(0,120),String(b.location||'').trim().slice(0,160),b.purchaseDate||null,cost,value,status,employeeId,String(b.notes||'').trim().slice(0,3000),req.user.id]);const row=(await query('SELECT * FROM equipment_assets WHERE id=? AND company_id=?',[r.id,req.companyId]))[0];await writeAudit(req,'create','equipment',r.id,null,row);res.status(201).json(row);}catch(e){res.status(e.message.includes('UNIQUE')?409:500).json({message:e.message.includes('UNIQUE')?'Asset tag already exists in this company.':e.message});}});
app.patch('/api/equipment/:id', requireRole(...fleetWriteRoles), async (req,res)=>{try{const id=Number(req.params.id),old=(await query('SELECT * FROM equipment_assets WHERE id=? AND company_id=?',[id,req.companyId]))[0];if(!old)return res.status(404).json({message:'Equipment asset not found.'});const b=req.body||{},tag=String(b.assetTag??old.asset_tag).trim(),name=String(b.name??old.name).trim(),status=String(b.status??old.status).toLowerCase(),cost=Number(b.purchaseCost??old.purchase_cost),value=Number(b.currentValue??old.current_value),employeeId=b.assignedEmployeeId===undefined?old.assigned_employee_id:(b.assignedEmployeeId?Number(b.assignedEmployeeId):null);if(!tag||!name||!equipmentStatuses.includes(status)||!Number.isFinite(cost)||cost<0||!Number.isFinite(value)||value<0||!dateValue(b.purchaseDate===undefined?old.purchase_date:b.purchaseDate))return res.status(400).json({message:'Invalid equipment fields.'});await update('UPDATE equipment_assets SET asset_tag=?,name=?,asset_type=?,serial_number=?,location=?,purchase_date=?,purchase_cost=?,current_value=?,status=?,assigned_employee_id=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?',[tag,name,String(b.assetType??old.asset_type).trim().slice(0,100),String(b.serialNumber??old.serial_number).trim().slice(0,120),String(b.location??old.location).trim().slice(0,160),b.purchaseDate===undefined?old.purchase_date:(b.purchaseDate||null),cost,value,status,employeeId,String(b.notes??old.notes).trim().slice(0,3000),id,req.companyId]);const row=(await query('SELECT * FROM equipment_assets WHERE id=? AND company_id=?',[id,req.companyId]))[0];await writeAudit(req,'update','equipment',id,old,row);res.json(row);}catch(e){res.status(e.message.includes('UNIQUE')?409:500).json({message:e.message});}});
app.get('/api/fleet/documents', requireRole(...fleetReadRoles), async (req,res)=>{try{const p=[req.companyId];let s=`SELECT d.*,CASE WHEN d.entity_type='vehicle' THEN v.vehicle_number ELSE a.name END AS entity_name FROM fleet_documents d LEFT JOIN vehicles v ON d.entity_type='vehicle' AND v.id=d.entity_id AND v.company_id=d.company_id LEFT JOIN equipment_assets a ON d.entity_type='equipment' AND a.id=d.entity_id AND a.company_id=d.company_id WHERE d.company_id=?`;if(req.query.expiringDays){const days=Math.min(365,Math.max(0,Number(req.query.expiringDays)));s+=` AND d.expires_on BETWEEN date('now') AND date('now','+'||?||' days')`;p.push(days);}s+=' ORDER BY d.expires_on IS NULL,d.expires_on';res.json(await query(s,p));}catch(e){res.status(500).json({message:e.message});}});
app.post('/api/fleet/documents', requireRole(...fleetWriteRoles), async (req,res)=>{try{const b=req.body||{},type=String(b.entityType||''),entityId=Number(b.entityId),docType=String(b.documentType||'').trim();if(!(await fleetEntity(req.companyId,type,entityId))||!docType||docType.length>120||!dateValue(b.issuedOn)||!dateValue(b.expiresOn)||!String(b.fileUrl||'').trim().match(/^.{0,500}$/s))return res.status(400).json({message:'Valid entity, document type, dates and file reference are required.'});const r=await insert('INSERT INTO fleet_documents (company_id,entity_type,entity_id,document_type,document_number,issued_on,expires_on,file_url,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',[req.companyId,type,entityId,docType,String(b.documentNumber||'').trim().slice(0,120),b.issuedOn||null,b.expiresOn||null,String(b.fileUrl||'').trim(),String(b.notes||'').trim().slice(0,2000),req.user.id]);const row=(await query('SELECT * FROM fleet_documents WHERE id=? AND company_id=?',[r.id,req.companyId]))[0];await writeAudit(req,'create','fleet_document',r.id,null,row);res.status(201).json(row);}catch(e){res.status(500).json({message:e.message});}});
app.get('/api/fleet/assignments', requireRole(...fleetReadRoles), async (req,res)=>{try{res.json(await query(`SELECT x.*,CASE WHEN x.entity_type='vehicle' THEN v.vehicle_number ELSE a.name END AS entity_name,e.full_name AS employee_name,u.name AS driver_name FROM fleet_assignments x LEFT JOIN vehicles v ON x.entity_type='vehicle' AND v.id=x.entity_id AND v.company_id=x.company_id LEFT JOIN equipment_assets a ON x.entity_type='equipment' AND a.id=x.entity_id AND a.company_id=x.company_id LEFT JOIN employees e ON e.id=x.employee_id AND e.company_id=x.company_id LEFT JOIN users u ON u.id=x.driver_id AND u.company_id=x.company_id WHERE x.company_id=? ORDER BY x.assigned_from DESC,x.id DESC`,[req.companyId]));}catch(e){res.status(500).json({message:e.message});}});
app.get('/api/fleet/alerts', requireRole(...fleetReadRoles), async (req,res)=>{try{const days=Math.min(365,Math.max(0,Number(req.query.days||30)));const documents=await query(`SELECT d.*,CASE WHEN d.entity_type='vehicle' THEN v.vehicle_number ELSE a.name END AS entity_name FROM fleet_documents d LEFT JOIN vehicles v ON d.entity_type='vehicle' AND v.id=d.entity_id AND v.company_id=d.company_id LEFT JOIN equipment_assets a ON d.entity_type='equipment' AND a.id=d.entity_id AND a.company_id=d.company_id WHERE d.company_id=? AND d.expires_on IS NOT NULL AND d.expires_on BETWEEN date('now') AND date('now','+'||?||' days') ORDER BY d.expires_on`,[req.companyId,days]);const services=await query(`SELECT s.*,v.vehicle_number FROM vehicle_service_schedules s JOIN vehicles v ON v.id=s.vehicle_id AND v.company_id=s.company_id WHERE s.company_id=? AND s.active=1 AND ((s.next_due_date IS NOT NULL AND s.next_due_date BETWEEN date('now') AND date('now','+'||?||' days') )) ORDER BY s.next_due_date`,[req.companyId,days]);res.json({documents,services});}catch(e){res.status(500).json({message:e.message});}});
app.post('/api/fleet/assignments', requireRole(...fleetWriteRoles), async (req,res)=>{try{const b=req.body||{},type=String(b.entityType||''),entityId=Number(b.entityId),from=String(b.assignedFrom||'');if(!(await fleetEntity(req.companyId,type,entityId))||!/^\\d{4}-\\d{2}-\\d{2}$/.test(from)||!dateValue(b.assignedTo))return res.status(400).json({message:'Valid entity and assignment dates are required.'});const employeeId=b.employeeId?Number(b.employeeId):null,driverId=b.driverId?Number(b.driverId):null;if(employeeId&&!(await query('SELECT id FROM employees WHERE id=? AND company_id=? AND status<>?',[employeeId,req.companyId,'terminated']))[0])return res.status(400).json({message:'Employee must belong to this company.'});if(driverId&&!(await query("SELECT id FROM users WHERE id=? AND company_id=? AND active=1 AND role IN ('driver','delivery_driver')",[driverId,req.companyId]))[0])return res.status(400).json({message:'Driver must belong to this company.'});const r=await insert('INSERT INTO fleet_assignments (company_id,entity_type,entity_id,employee_id,driver_id,assigned_from,assigned_to,purpose,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',[req.companyId,type,entityId,employeeId,driverId,from,b.assignedTo||null,String(b.purpose||'').trim().slice(0,160),String(b.notes||'').trim().slice(0,2000),req.user.id]);await writeAudit(req,'create','fleet_assignment',r.id,null,b);res.status(201).json((await query('SELECT * FROM fleet_assignments WHERE id=? AND company_id=?',[r.id,req.companyId]))[0]);}catch(e){res.status(500).json({message:e.message});}});
app.get('/api/fleet/reports', requireRole(...fleetReadRoles), async (req,res)=>{try{const p=[req.companyId],from=req.query.from&&/^\\d{4}-\\d{2}-\\d{2}$/.test(req.query.from)?req.query.from:null,to=req.query.to&&/^\\d{4}-\\d{2}-\\d{2}$/.test(req.query.to)?req.query.to:null,range=(column)=>`${from?` AND ${column} >= ?`:''}${to?` AND ${column} <= ?`:''}`;if(from)p.push(from);if(to)p.push(to);const [vehicles,equipment,services,fuel,docs]=await Promise.all([query('SELECT status,COUNT(*) AS count FROM vehicles WHERE company_id=? GROUP BY status',[req.companyId]),query('SELECT status,COUNT(*) AS count FROM equipment_assets WHERE company_id=? GROUP BY status',[req.companyId]),query(`SELECT COUNT(*) AS count,COALESCE(SUM(cost),0) AS total_cost FROM vehicle_service_records WHERE company_id=?${range('service_date')}`,p.slice()),query(`SELECT COUNT(*) AS count,COALESCE(SUM(total_cost),0) AS total_cost,COALESCE(SUM(quantity),0) AS quantity FROM vehicle_fuel_logs WHERE company_id=?${range('fuel_date')}`,p.slice()),query("SELECT COUNT(*) AS expiring FROM fleet_documents WHERE company_id=? AND expires_on IS NOT NULL AND expires_on BETWEEN date('now') AND date('now','+30 days')",[req.companyId])]);res.json({vehicles,equipment,services:services[0],fuel:fuel[0],documents:docs[0]});}catch(e){res.status(500).json({message:e.message});}});

const employeeManagerRoles = ['super_admin', 'company_admin', 'manager'];
const employeeReadRoles = ['super_admin', 'company_admin', 'manager', 'accountant', 'sales_staff', 'inventory_staff', 'staff', 'driver', 'delivery_driver'];
const employeeStatuses = ['active', 'inactive', 'on_leave', 'terminated'];

function normalizeCompanyDateForStorage(value, companyDateFormat = 'YYYY-MM-DD') {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
    return raw;
  }
  const parts = raw.split(/[\-\/]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 3) return null;
  const format = String(companyDateFormat || 'YYYY-MM-DD').toUpperCase();
  let day, month, year;
  if (format === 'DD-MM-YYYY') [day, month, year] = parts;
  else if (format === 'MM-DD-YYYY') [month, day, year] = parts;
  else [year, month, day] = parts;
  if (!day || !month || !year || !/^\d+$/.test(day) || !/^\d+$/.test(month) || !/^\d+$/.test(year)) return null;
  const dayNumber = Number(day);
  const monthNumber = Number(month);
  const yearNumber = Number(year);
  if (!Number.isInteger(dayNumber) || !Number.isInteger(monthNumber) || !Number.isInteger(yearNumber)) return null;
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return null;
  const parsed = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() !== yearNumber || parsed.getUTCMonth() !== monthNumber - 1 || parsed.getUTCDate() !== dayNumber) return null;
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
}

function employeePayload(body = {}, existing = {}, companyDateFormat = 'YYYY-MM-DD') {
  const employeeId = String(body.employeeId ?? existing.employee_id ?? '').trim();
  const fullName = String(body.fullName ?? existing.full_name ?? '').trim();
  const department = String(body.department ?? existing.department ?? '').trim();
  const role = String(body.role ?? existing.role ?? '').trim();
  const salary = body.salary === undefined ? Number(existing.salary || 0) : Number(body.salary);
  const phone = String(body.phone ?? existing.phone ?? '').trim();
  const email = String(body.email ?? existing.email ?? '').trim().toLowerCase();
  const rawHireDate = body.hireDate === undefined ? (existing.hire_date || null) : (body.hireDate || null);
  const hireDate = normalizeCompanyDateForStorage(rawHireDate, companyDateFormat);
  const status = String(body.status ?? existing.status ?? 'active').trim().toLowerCase();
  const attendanceDays = body.attendanceDays === undefined ? Number(existing.attendance_days || 0) : Number(body.attendanceDays);
  const presentDays = body.presentDays === undefined ? Number(existing.present_days || 0) : Number(body.presentDays);
  const absentDays = body.absentDays === undefined ? Number(existing.absent_days || 0) : Number(body.absentDays);
  const lateDays = body.lateDays === undefined ? Number(existing.late_days || 0) : Number(body.lateDays);
  const leaveDays = body.leaveDays === undefined ? Number(existing.leave_days || 0) : Number(body.leaveDays);
  const leaveBalance = body.leaveBalance === undefined ? Number(existing.leave_balance || 0) : Number(body.leaveBalance);
  const notes = String(body.notes ?? existing.notes ?? '').trim();
  if (!employeeId || employeeId.length > 60) return { error: 'Employee ID is required and must be 60 characters or fewer.' };
  if (!fullName || fullName.length > 160) return { error: 'Full name is required and must be 160 characters or fewer.' };
  if (department.length > 100 || role.length > 100) return { error: 'Department and role must be 100 characters or fewer.' };
  if (!Number.isFinite(salary) || salary < 0) return { error: 'Salary must be zero or greater.' };
  if (phone.length > 40) return { error: 'Phone must be 40 characters or fewer.' };
  if (email && (!email.includes('@') || email.length > 160)) return { error: 'Enter a valid email address.' };
  if (rawHireDate !== null && rawHireDate !== undefined && String(rawHireDate).trim() !== '' && !hireDate) return { error: 'Hire date must use YYYY-MM-DD format.' };
  if (!employeeStatuses.includes(status)) return { error: 'Invalid employee status.' };
  for (const value of [attendanceDays, presentDays, absentDays, lateDays, leaveDays, leaveBalance]) {
    if (!Number.isInteger(value) || value < 0) return { error: 'Attendance and leave values must be whole numbers of zero or greater.' };
  }
  if (notes.length > 5000) return { error: 'Notes must be 5,000 characters or fewer.' };
  return { employeeId, fullName, department, role, salary, phone, email, hireDate, status, attendanceDays, presentDays, absentDays, lateDays, leaveDays, leaveBalance, notes };
}

function employeeQuery() {
  return `SELECT e.*, u.username AS linked_username, u.role AS linked_user_role,
    CASE WHEN u.role IN ('driver','delivery_driver') AND u.active = 1 THEN 1 ELSE 0 END AS is_driver
    FROM employees e LEFT JOIN users u ON u.id = e.user_id AND u.company_id = e.company_id WHERE e.company_id = ?`;
}

app.get('/api/employees', requireRole(...employeeReadRoles), async (req, res) => {
  try {
    let sql = employeeQuery();
    const params = [req.companyId];
    if (req.query.status && employeeStatuses.includes(String(req.query.status))) { sql += ' AND e.status = ?'; params.push(String(req.query.status)); }
    sql += ' ORDER BY e.full_name COLLATE NOCASE';
    res.json(await query(sql, params));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/employees', requireRole(...employeeManagerRoles), async (req, res) => {
  try {
    const company = (await query('SELECT date_format FROM companies WHERE id = ? AND active = 1', [req.companyId]))[0] || {};
    const companyDateFormat = String(company.date_format || 'YYYY-MM-DD').toUpperCase();
    const payload = employeePayload(req.body, {}, companyDateFormat);
    if (payload.error) return res.status(400).json({ message: payload.error });
    const userId = req.body?.userId ? Number(req.body.userId) : null;
    if (userId && !(await query('SELECT id FROM users WHERE id = ? AND company_id = ?', [userId, req.companyId]))[0]) return res.status(400).json({ message: 'Linked user must belong to this company.' });
    const result = await insert('INSERT INTO employees (company_id, user_id, employee_id, full_name, department, role, salary, phone, email, hire_date, status, attendance_days, present_days, absent_days, late_days, leave_days, leave_balance, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, userId, payload.employeeId, payload.fullName, payload.department, payload.role, payload.salary, payload.phone, payload.email, payload.hireDate, payload.status, payload.attendanceDays, payload.presentDays, payload.absentDays, payload.lateDays, payload.leaveDays, payload.leaveBalance, payload.notes, req.user.id]);
    const employee = (await query(`${employeeQuery()} AND e.id = ?`, [req.companyId, result.id]))[0];
    await writeAudit(req, 'create', 'employee', result.id, null, employee);
    res.status(201).json(employee);
  } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 500).json({ message: error.message.includes('UNIQUE') ? 'Employee ID already exists in this company.' : error.message }); }
});

app.patch('/api/employees/:id', requireRole(...employeeManagerRoles), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = (await query(`${employeeQuery()} AND e.id = ?`, [req.companyId, id]))[0];
    if (!existing) return res.status(404).json({ message: 'Employee not found.' });
    const company = (await query('SELECT date_format FROM companies WHERE id = ? AND active = 1', [req.companyId]))[0] || {};
    const companyDateFormat = String(company.date_format || 'YYYY-MM-DD').toUpperCase();
    const payload = employeePayload(req.body, existing, companyDateFormat);
    if (payload.error) return res.status(400).json({ message: payload.error });
    const userId = req.body?.userId === undefined ? existing.user_id : (req.body.userId ? Number(req.body.userId) : null);
    if (userId && !(await query('SELECT id FROM users WHERE id = ? AND company_id = ?', [userId, req.companyId]))[0]) return res.status(400).json({ message: 'Linked user must belong to this company.' });
    await update('UPDATE employees SET user_id = ?, employee_id = ?, full_name = ?, department = ?, role = ?, salary = ?, phone = ?, email = ?, hire_date = ?, status = ?, attendance_days = ?, present_days = ?, absent_days = ?, late_days = ?, leave_days = ?, leave_balance = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [userId, payload.employeeId, payload.fullName, payload.department, payload.role, payload.salary, payload.phone, payload.email, payload.hireDate, payload.status, payload.attendanceDays, payload.presentDays, payload.absentDays, payload.lateDays, payload.leaveDays, payload.leaveBalance, payload.notes, id, req.companyId]);
    const employee = (await query(`${employeeQuery()} AND e.id = ?`, [req.companyId, id]))[0];
    await writeAudit(req, 'update', 'employee', id, existing, employee);
    res.json(employee);
  } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 500).json({ message: error.message.includes('UNIQUE') ? 'Employee ID already exists in this company.' : error.message }); }
});

app.patch('/api/employees/:id/status', requireRole(...employeeManagerRoles), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!employeeStatuses.includes(status)) return res.status(400).json({ message: 'Invalid employee status.' });
    const existing = (await query(`${employeeQuery()} AND e.id = ?`, [req.companyId, id]))[0];
    if (!existing) return res.status(404).json({ message: 'Employee not found.' });
    await update('UPDATE employees SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [status, id, req.companyId]);
    const employee = (await query(`${employeeQuery()} AND e.id = ?`, [req.companyId, id]))[0];
    await writeAudit(req, 'status_change', 'employee', id, { status: existing.status }, { status: employee.status });
    res.json(employee);
  } catch (error) { res.status(500).json({ message: error.message }); }
});


const attendanceReadRoles = [...employeeReadRoles];
const attendanceManagerRoles = ['super_admin', 'company_admin', 'manager'];
const payrollRoles = ['super_admin', 'company_admin', 'manager', 'accountant'];
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const employeeForCompany = async (req, id) => (await query('SELECT * FROM employees WHERE id = ? AND company_id = ?', [Number(id), req.companyId]))[0];
const attendanceSelect = () => 'SELECT a.*, e.employee_id AS employee_code, e.full_name, e.department, e.role FROM attendance_records a JOIN employees e ON e.id = a.employee_id AND e.company_id = a.company_id WHERE a.company_id = ?';

app.get('/api/attendance', requireRole(...attendanceReadRoles), async (req, res) => {
  try { let sql = attendanceSelect(); const params = [req.companyId]; const start = req.query.startDate || req.query.date; const end = req.query.endDate || req.query.date;
    if ((start && !validDate(start)) || (end && !validDate(end))) return res.status(400).json({ message: 'Date must use YYYY-MM-DD format.' });
    if (start) { sql += ' AND a.attendance_date >= ?'; params.push(start); } if (end) { sql += ' AND a.attendance_date <= ?'; params.push(end); }
    if (req.query.employeeId) { const employee = await employeeForCompany(req, req.query.employeeId); if (!employee) return res.status(404).json({ message: 'Employee not found.' }); sql += ' AND a.employee_id = ?'; params.push(employee.id); }
    if (!attendanceManagerRoles.includes(req.user.role) && req.user.role !== 'accountant') { const linked = (await query("SELECT id FROM employees WHERE company_id = ? AND user_id = ?", [req.companyId, req.user.id]))[0]; if (!linked) return res.json([]); sql += ' AND a.employee_id = ?'; params.push(linked.id); }
    sql += ' ORDER BY a.attendance_date DESC, e.full_name COLLATE NOCASE'; res.json(await query(sql, params));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

async function recordAttendance(req, res, action) {
  const linked = (await query("SELECT id FROM employees WHERE company_id = ? AND user_id = ? AND status = 'active'", [req.companyId, req.user.id]))[0];
  const manager = attendanceManagerRoles.includes(req.user.role); const employeeId = req.body?.employeeId ? Number(req.body.employeeId) : linked?.id;
  if (!employeeId || (!manager && (!linked || linked.id !== employeeId))) return res.status(403).json({ message: 'You may only record attendance for your linked employee account.' });
  if (!await employeeForCompany(req, employeeId)) return res.status(404).json({ message: 'Employee not found.' });
  const date = String(req.body?.date || new Date().toISOString().slice(0, 10)); if (!validDate(date)) return res.status(400).json({ message: 'Date must use YYYY-MM-DD format.' });
  const status = String(req.body?.status || 'present'); if (!['present', 'late', 'half_day', 'leave'].includes(status)) return res.status(400).json({ message: 'Invalid attendance status.' });
  const existing = (await query('SELECT * FROM attendance_records WHERE company_id = ? AND employee_id = ? AND attendance_date = ?', [req.companyId, employeeId, date]))[0];
  if (action === 'in' && existing?.check_in) return res.status(409).json({ message: 'Employee is already checked in for this date.' });
  if (action === 'out' && (!existing || !existing.check_in)) return res.status(400).json({ message: 'Check in before checking out.' });
  const now = new Date().toISOString();
  if (action === 'in') {
    const result = existing ? await update('UPDATE attendance_records SET check_in = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [req.body?.checkIn || now, status, String(req.body?.notes || '').trim().slice(0, 1000), existing.id, req.companyId]) : await insert('INSERT INTO attendance_records (company_id, employee_id, attendance_date, check_in, status, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.companyId, employeeId, date, req.body?.checkIn || now, status, String(req.body?.notes || '').trim().slice(0, 1000), req.user.id]);
    const id = existing?.id || result.id; const record = (await query(attendanceSelect() + ' AND a.id = ?', [req.companyId, id]))[0]; await writeAudit(req, 'check_in', 'attendance', id, existing, record); return res.status(existing ? 200 : 201).json(record);
  }
  await update('UPDATE attendance_records SET check_out = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [req.body?.checkOut || now, existing.id, req.companyId]); const record = (await query(attendanceSelect() + ' AND a.id = ?', [req.companyId, existing.id]))[0]; await writeAudit(req, 'check_out', 'attendance', existing.id, existing, record); res.json(record);
}
app.post('/api/attendance/check-in', async (req, res) => { try { await recordAttendance(req, res, 'in'); } catch (error) { res.status(500).json({ message: error.message }); } });
app.post('/api/attendance/check-out', async (req, res) => { try { await recordAttendance(req, res, 'out'); } catch (error) { res.status(500).json({ message: error.message }); } });

app.get('/api/payroll/runs', requireRole(...payrollRoles), async (req, res) => { try { res.json(await query('SELECT r.*, u.name AS created_by_name, COUNT(p.id) AS payslip_count, COALESCE(SUM(p.net_amount), 0) AS total_net FROM payroll_runs r LEFT JOIN users u ON u.id = r.created_by LEFT JOIN payslips p ON p.payroll_run_id = r.id AND p.company_id = r.company_id WHERE r.company_id = ? GROUP BY r.id ORDER BY r.period_end DESC, r.id DESC', [req.companyId])); } catch (error) { res.status(500).json({ message: error.message }); } });
app.get('/api/payroll/runs/:id/payslips', requireRole(...payrollRoles), async (req, res) => { try { const run = (await query('SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]; if (!run) return res.status(404).json({ message: 'Payroll run not found.' }); res.json(await query('SELECT p.*, e.employee_id AS employee_code, e.full_name, e.department, e.role FROM payslips p JOIN employees e ON e.id = p.employee_id AND e.company_id = p.company_id WHERE p.payroll_run_id = ? AND p.company_id = ? ORDER BY e.full_name COLLATE NOCASE', [run.id, req.companyId])); } catch (error) { res.status(500).json({ message: error.message }); } });
app.post('/api/payroll/runs', requireRole(...payrollRoles), async (req, res) => {
  try { const start = String(req.body?.periodStart || ''), end = String(req.body?.periodEnd || ''); if (!validDate(start) || !validDate(end) || start > end) return res.status(400).json({ message: 'A valid period start and end date are required.' });
    const employees = await query("SELECT * FROM employees WHERE company_id = ? AND status = 'active' ORDER BY full_name", [req.companyId]); if (!employees.length) return res.status(400).json({ message: 'Add an active employee before running payroll.' });
    if ((await query('SELECT id FROM payroll_runs WHERE company_id = ? AND period_start = ? AND period_end = ?', [req.companyId, start, end]))[0]) return res.status(409).json({ message: 'A payroll run already exists for this period.' });
    const deductionsByEmployee = employees.map(employee => ({ employee, gross: Number(employee.salary || 0), deductions: Number(req.body?.deductions?.[employee.id] || 0) }));
    if (deductionsByEmployee.some(item => !Number.isFinite(item.deductions) || item.deductions < 0 || item.deductions > item.gross)) return res.status(400).json({ message: 'Deductions must be between zero and the employee salary.' });
    const run = await insert('INSERT INTO payroll_runs (company_id, period_start, period_end, notes, created_by) VALUES (?, ?, ?, ?, ?)', [req.companyId, start, end, String(req.body?.notes || '').trim().slice(0, 1000), req.user.id]);
    for (const { employee, gross, deductions } of deductionsByEmployee) { await insert('INSERT INTO payslips (company_id, payroll_run_id, employee_id, gross_amount, deductions, net_amount) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, run.id, employee.id, gross, deductions, gross - deductions]); }
    const result = (await query('SELECT r.*, COUNT(p.id) AS payslip_count, COALESCE(SUM(p.net_amount), 0) AS total_net FROM payroll_runs r LEFT JOIN payslips p ON p.payroll_run_id = r.id WHERE r.id = ? AND r.company_id = ? GROUP BY r.id', [run.id, req.companyId]))[0]; await writeAudit(req, 'create', 'payroll_run', run.id, null, result); res.status(201).json(result);
  } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 500).json({ message: error.message.includes('UNIQUE') ? 'A payroll run already exists for this period.' : error.message }); }
});

app.get('/api/suppliers', async (req, res) => {
  try {
    const suppliers = await query('SELECT * FROM suppliers WHERE company_id = ? ORDER BY id DESC', [req.companyId]);
    res.json(suppliers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/suppliers', async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Supplier name is required.' });
    }

    const result = await insert(
      'INSERT INTO suppliers (company_id, name, phone, address) VALUES (?, ?, ?, ?)',
      [req.companyId, name, phone || '', address || '']
    );

    const supplier = await query('SELECT * FROM suppliers WHERE id = ? AND company_id = ?', [result.id, req.companyId]);
    res.status(201).json(supplier[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const reorderReadRoles = ['super_admin', 'company_admin', 'manager', 'accountant', 'sales_staff', 'staff'];
const reorderWriteRoles = ['super_admin', 'company_admin', 'manager', 'sales_staff', 'staff'];
const reorderRuleRoles = ['super_admin', 'company_admin', 'manager'];

async function getReorderRule(companyId) {
  let rows = await query('SELECT * FROM reorder_rules WHERE company_id = ?', [companyId]);
  if (!rows[0]) {
    await insert('INSERT OR IGNORE INTO reorder_rules (company_id) VALUES (?)', [companyId]);
    rows = await query('SELECT * FROM reorder_rules WHERE company_id = ?', [companyId]);
  }
  return rows[0];
}

async function getCustomerReorderInsights(companyId, customerId, productId = null) {
  const customer = (await query('SELECT id, name, phone, address FROM customers WHERE id = ? AND company_id = ?', [customerId, companyId]))[0];
  if (!customer) return null;
  const rule = await getReorderRule(companyId);
  const products = await query(`
    SELECT p.id AS product_id, p.name AS product_name
    FROM products p
    WHERE p.company_id = ? AND (? IS NULL OR p.id = ?)
      AND EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.company_id = oi.company_id WHERE oi.product_id = p.id AND oi.company_id = ? AND o.customer_id = ? AND o.status <> 'cancelled')
    ORDER BY p.name
  `, [companyId, productId, productId, companyId, customerId]);
  const result = [];
  for (const product of products) {
    const rows = await query(`
      SELECT o.id AS order_id, date(o.created_at) AS order_date, oi.quantity
      FROM orders o JOIN order_items oi ON oi.order_id = o.id AND oi.company_id = o.company_id
      WHERE o.company_id = ? AND o.customer_id = ? AND oi.product_id = ? AND o.status <> 'cancelled'
      ORDER BY o.created_at
    `, [companyId, customerId, product.product_id]);
    result.push({ productId: product.product_id, productName: product.product_name, ...calculateReorderInsight(rows, rule), provider: rule.provider, reminderProviderConfigured: false });
  }
  return { customer, rule, insights: result, generatedAt: new Date().toISOString() };
}

app.get('/api/reorder-rules', requireRole(...reorderRuleRoles), async (req, res) => {
  try { res.json(await getReorderRule(req.companyId)); } catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/reorder-rules', requireRole(...reorderRuleRoles), async (req, res) => {
  try {
    const body = req.body || {};
    const current = await getReorderRule(req.companyId);
    const enabled = body.enabled === undefined ? Number(current.enabled) : (body.enabled ? 1 : 0);
    const minimumOrders = body.minimumOrders === undefined ? Number(current.minimum_orders) : Number(body.minimumOrders);
    const leadDays = body.reminderLeadDays === undefined ? Number(current.reminder_lead_days) : Number(body.reminderLeadDays);
    const buffer = body.quantityBufferPercent === undefined ? Number(current.quantity_buffer_percent) : Number(body.quantityBufferPercent);
    if (!Number.isInteger(minimumOrders) || minimumOrders < 2 || minimumOrders > 100) return res.status(400).json({ message: 'Minimum orders must be a whole number from 2 to 100.' });
    if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365) return res.status(400).json({ message: 'Reminder lead days must be a whole number from 0 to 365.' });
    if (!Number.isFinite(buffer) || buffer < 0 || buffer > 100) return res.status(400).json({ message: 'Quantity buffer must be between 0 and 100 percent.' });
    await getReorderRule(req.companyId);
    await update('UPDATE reorder_rules SET enabled = ?, minimum_orders = ?, reminder_lead_days = ?, quantity_buffer_percent = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?', [enabled, minimumOrders, leadDays, buffer, req.user.id, req.companyId]);
    const rule = await getReorderRule(req.companyId);
    await writeAudit(req, 'update', 'reorder_rule', rule.id, null, rule);
    res.json(rule);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/customers/:id/reorder-insights', requireRole(...reorderReadRoles), async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    if (!Number.isInteger(customerId) || customerId < 1) return res.status(400).json({ message: 'A valid customer id is required.' });
    const productId = req.query.productId ? Number(req.query.productId) : null;
    if (productId !== null && (!Number.isInteger(productId) || productId < 1)) return res.status(400).json({ message: 'A valid product id is required.' });
    const data = await getCustomerReorderInsights(req.companyId, customerId, productId);
    if (!data) return res.status(404).json({ message: 'Customer not found.' });
    await writeAudit(req, 'read', 'customer_reorder_insights', customerId, null, { productId });
    res.json(data);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/analytics/customer-reorder', requireRole(...reorderReadRoles), async (req, res) => {
  try {
    const customerId = Number(req.query.customerId);
    const productId = req.query.productId ? Number(req.query.productId) : null;
    if (!Number.isInteger(customerId) || customerId < 1) return res.status(400).json({ message: 'A valid customerId is required.' });
    if (productId !== null && (!Number.isInteger(productId) || productId < 1)) return res.status(400).json({ message: 'A valid productId is required.' });
    const data = await getCustomerReorderInsights(req.companyId, customerId, productId);
    if (!data) return res.status(404).json({ message: 'Customer not found.' });
    await writeAudit(req, 'read', 'customer_reorder_insights', customerId, null, { productId: req.query.productId || null });
    res.json(data);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/analytics/reorder', requireRole(...reorderReadRoles), async (req, res) => {
  try {
    const customerId = req.query.customerId ? Number(req.query.customerId) : null;
    const productId = req.query.productId ? Number(req.query.productId) : null;
    if (customerId !== null && (!Number.isInteger(customerId) || customerId < 1)) return res.status(400).json({ message: 'A valid customer id is required.' });
    if (productId !== null && (!Number.isInteger(productId) || productId < 1)) return res.status(400).json({ message: 'A valid product id is required.' });
    const customers = customerId ? await query('SELECT id FROM customers WHERE id = ? AND company_id = ?', [customerId, req.companyId]) : await query('SELECT id FROM customers WHERE company_id = ? ORDER BY name', [req.companyId]);
    if (customerId && !customers[0]) return res.status(404).json({ message: 'Customer not found.' });
    const rows = [];
    for (const customer of customers) {
      const data = await getCustomerReorderInsights(req.companyId, customer.id, productId);
      data.insights.forEach((insight) => rows.push({ customerId: customer.id, customerName: data.customer.name, customerPhone: data.customer.phone, ...insight }));
    }
    await writeAudit(req, 'read', 'reorder_analytics', null, null, { customerId, rowCount: rows.length });
    res.json({ rule: await getReorderRule(req.companyId), insights: rows, insufficientHistoryStatus: INSUFFICIENT_HISTORY, generatedAt: new Date().toISOString() });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/customers/:id/reorder', requireRole(...reorderWriteRoles), async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const requestedProductId = req.body?.productId === undefined || req.body.productId === '' ? null : Number(req.body.productId);
    if (requestedProductId !== null && (!Number.isInteger(requestedProductId) || requestedProductId < 1)) return res.status(400).json({ message: 'A valid product id is required.' });
    const data = await getCustomerReorderInsights(req.companyId, customerId, requestedProductId);
    if (!data) return res.status(404).json({ message: 'Customer not found.' });
    let selected = data.insights.filter((item) => item.reliable);
    if (requestedProductId !== null) selected = selected.filter((item) => item.productId === requestedProductId);
    if (!selected.length) return res.status(400).json({ code: INSUFFICIENT_HISTORY, message: 'Reorder requires sufficient history for at least one product.' });
    const requestedQuantity = req.body?.quantity === undefined ? null : Number(req.body.quantity);
    if (requestedQuantity !== null && (!Number.isInteger(requestedQuantity) || requestedQuantity < 1)) return res.status(400).json({ message: 'Quantity must be a positive whole number.' });
    const records = [];
    let total = 0;
    for (const item of selected) {
      const product = (await query('SELECT id, name, sale_price FROM products WHERE id = ? AND company_id = ?', [item.productId, req.companyId]))[0];
      const quantity = requestedQuantity === null ? item.suggestedQuantity : requestedQuantity;
      if (!product) return res.status(404).json({ message: 'Product not found in this company.' });
      records.push({ product, quantity, total: Number(product.sale_price) * quantity });
      total += Number(product.sale_price) * quantity;
    }
    const order = await insert('INSERT INTO orders (company_id, customer_id, customer_name, delivery_address, notes, total_amount, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.companyId, customerId, data.customer.name, data.customer.address || '', 'Created by smart reorder', total, req.user.id]);
    for (const record of records) await insert('INSERT INTO order_items (company_id, order_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, order.id, record.product.id, record.quantity, record.product.sale_price, record.total]);
    const created = await getOrderById(order.id, req.companyId);
    await writeAudit(req, 'create_smart_reorder', 'order', order.id, null, { customerId, items: records.map((r) => ({ productId: r.product.id, quantity: r.quantity })) });
    res.status(201).json(created);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/customers/:id/reorder-reminder', requireRole(...reorderWriteRoles), async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const productId = Number(req.body?.productId);
    if (!Number.isInteger(productId) || productId < 1) return res.status(400).json({ message: 'A valid product id is required.' });
    const data = await getCustomerReorderInsights(req.companyId, customerId, productId);
    const insight = data?.insights?.[0];
    if (!data) return res.status(404).json({ message: 'Customer not found.' });
    if (!insight) return res.status(404).json({ message: 'Product history not found.' });
    if (!insight.reminderEligible) return res.status(400).json({ message: 'This customer is not currently eligible for a reminder.' });
    const result = await insert("INSERT INTO reorder_reminders (company_id, customer_id, product_id, action, status, created_by) VALUES (?, ?, ?, 'provider_not_configured', 'not_configured', ?)", [req.companyId, customerId, productId, req.user.id]);
    await writeAudit(req, 'reminder_not_configured', 'reorder_reminder', result.id, null, { customerId, productId });
    res.status(202).json({ status: 'not_configured', provider: 'not_configured', message: 'Reminder provider is not configured. No message was sent.', id: result.id });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/customers/:id/account', async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const customer = await query('SELECT * FROM customers WHERE id = ? AND company_id = ?', [customerId, req.companyId]);
    if (!customer[0]) return res.status(404).json({ message: 'Customer not found.' });
    const name = customer[0].name;
    const [sales, payments, stockLedger] = await Promise.all([
      query('SELECT id, invoice_number, total_amount, status, due_date, created_at FROM sales WHERE company_id = ? AND customer_name = ? ORDER BY created_at DESC', [req.companyId, name]),
      query('SELECT id, amount, method, direction, reference, note, created_at FROM payments WHERE company_id = ? AND customer_name = ? ORDER BY created_at DESC', [req.companyId, name]),
      query(`
        SELECT sm.created_at, p.name AS product, sm.movement_type, sm.quantity, sm.reference, sm.notes
        FROM stock_movements sm JOIN products p ON p.id = sm.product_id AND p.company_id = sm.company_id
        WHERE sm.company_id = ? AND sm.customer_id = ? ORDER BY sm.created_at DESC
      `, [req.companyId, customerId])
    ]);
    const totalSales = sales.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const totalReceived = payments.filter((row) => row.direction !== 'payment').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    res.json({ customer: customer[0], sales, payments, stockLedger, totals: { totalSales, totalReceived, pending: Math.max(0, totalSales - totalReceived), creditBalance: Math.max(0, totalReceived - totalSales) } });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/suppliers/:id/account', async (req, res) => {
  try {
    const supplierId = Number(req.params.id);
    const supplier = await query('SELECT * FROM suppliers WHERE id = ? AND company_id = ?', [supplierId, req.companyId]);
    if (!supplier[0]) return res.status(404).json({ message: 'Supplier not found.' });
    const name = supplier[0].name;
    const [purchases, payments] = await Promise.all([
      query('SELECT id, invoice_number, total_amount, status, due_date, created_at FROM purchases WHERE company_id = ? AND supplier_name = ? ORDER BY created_at DESC', [req.companyId, name]),
      query('SELECT id, amount, method, direction, reference, note, created_at FROM payments WHERE company_id = ? AND supplier_name = ? ORDER BY created_at DESC', [req.companyId, name])
    ]);
    const totalPurchases = purchases.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const totalPaid = payments.filter((row) => row.direction === 'payment').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    res.json({ supplier: supplier[0], purchases, payments, totals: { totalPurchases, totalPaid, pending: Math.max(0, totalPurchases - totalPaid) } });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/customer-stock', async (req, res) => {
  try {
    const rows = await query(`
      SELECT c.id AS customer_id, c.name AS customer, p.id AS product_id, p.name AS product,
        SUM(CASE WHEN sm.movement_type = 'customer_out' THEN sm.quantity WHEN sm.movement_type = 'customer_return' THEN -sm.quantity ELSE 0 END) AS quantity
      FROM stock_movements sm
      JOIN customers c ON c.id = sm.customer_id AND c.company_id = sm.company_id
      JOIN products p ON p.id = sm.product_id AND p.company_id = sm.company_id
      WHERE sm.company_id = ? AND sm.customer_id IS NOT NULL
      GROUP BY c.id, p.id
      HAVING quantity > 0
      ORDER BY c.name, p.name
    `, [req.companyId]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const bottleMovementTypes = ['received', 'dispatched', 'returned', 'driver_dispatched', 'driver_returned', 'damaged', 'lost', 'adjustment_in', 'adjustment_out'];
const bottleBalanceDelta = {
  received: 1, returned: 1, driver_returned: 1, adjustment_in: 1,
  dispatched: -1, driver_dispatched: -1, damaged: -1, lost: -1, adjustment_out: -1
};
const bottleReconciliationRoles = ['super_admin', 'company_admin', 'manager', 'accountant', 'inventory_staff', 'sales_staff', 'staff', 'driver', 'delivery_driver'];

app.get('/api/bottles', async (req, res) => {
  try {
    const bottles = await query(`
      SELECT b.*,
        COALESCE(SUM(CASE WHEN bm.movement_type IN ('received', 'returned', 'adjustment_in', 'driver_returned') THEN bm.quantity ELSE 0 END), 0) AS total_in,
        COALESCE(SUM(CASE WHEN bm.movement_type IN ('dispatched', 'driver_dispatched', 'damaged', 'lost', 'adjustment_out') THEN bm.quantity ELSE 0 END), 0) AS total_out,
        COALESCE(SUM(CASE WHEN bm.movement_type IN ('received', 'returned', 'driver_returned', 'adjustment_in') THEN bm.quantity WHEN bm.movement_type IN ('dispatched', 'driver_dispatched', 'damaged', 'lost', 'adjustment_out') THEN -bm.quantity ELSE 0 END), 0) AS available_balance
      FROM bottles b
      LEFT JOIN bottle_movements bm ON bm.bottle_id = b.id AND bm.company_id = b.company_id
      WHERE b.company_id = ?
      GROUP BY b.id
      ORDER BY b.active DESC, b.name
    `, [req.companyId]);
    res.json(bottles);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/bottles', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => {
  try {
    const { name, code, capacityLitres, bottleType = 'returnable', active = true, qrCode = '', barcode = '', bottleIdentifier = '' } = req.body || {};
    const capacity = Number(capacityLitres);
    if (!String(name || '').trim() || !String(code || '').trim() || !Number.isFinite(capacity) || capacity <= 0 || !['returnable', 'disposable'].includes(bottleType)) {
      return res.status(400).json({ message: 'Name, code, valid bottle type and a positive capacity are required.' });
    }
    const result = await insert('INSERT INTO bottles (company_id, name, code, capacity_litres, bottle_type, qr_code, barcode, bottle_identifier, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, name.trim(), code.trim(), capacity, bottleType, String(qrCode).trim(), String(barcode).trim(), String(bottleIdentifier).trim(), active ? 1 : 0]);
    const bottle = await query('SELECT * FROM bottles WHERE id = ? AND company_id = ?', [result.id, req.companyId]);
    await writeAudit(req, 'create', 'bottle', result.id, null, bottle[0]);
    res.status(201).json(bottle[0]);
  } catch (error) {
    res.status(/UNIQUE/i.test(error.message) ? 409 : 500).json({ message: /UNIQUE/i.test(error.message) ? 'Bottle code already exists in this company.' : error.message });
  }
});

app.patch('/api/bottles/:id', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = (await query('SELECT * FROM bottles WHERE id = ? AND company_id = ?', [id, req.companyId]))[0];
    if (!existing) return res.status(404).json({ message: 'Bottle type not found.' });
    const name = String(req.body?.name ?? existing.name).trim();
    const code = String(req.body?.code ?? existing.code).trim();
    const capacity = Number(req.body?.capacityLitres ?? existing.capacity_litres);
    const bottleType = req.body?.bottleType || existing.bottle_type;
    const qrCode = String(req.body?.qrCode ?? existing.qr_code ?? '').trim();
    const barcode = String(req.body?.barcode ?? existing.barcode ?? '').trim();
    const bottleIdentifier = String(req.body?.bottleIdentifier ?? existing.bottle_identifier ?? '').trim();
    if (!name || !code || !Number.isFinite(capacity) || capacity <= 0 || !['returnable', 'disposable'].includes(bottleType)) return res.status(400).json({ message: 'Name, code, valid bottle type and a positive capacity are required.' });
    const active = req.body?.active === undefined ? existing.active : (req.body.active ? 1 : 0);
    await update('UPDATE bottles SET name = ?, code = ?, capacity_litres = ?, bottle_type = ?, qr_code = ?, barcode = ?, bottle_identifier = ?, active = ? WHERE id = ? AND company_id = ?', [name, code, capacity, bottleType, qrCode, barcode, bottleIdentifier, active, id, req.companyId]);
    const bottle = (await query('SELECT * FROM bottles WHERE id = ? AND company_id = ?', [id, req.companyId]))[0];
    await writeAudit(req, 'update', 'bottle', id, existing, bottle);
    res.json(bottle);
  } catch (error) { res.status(/UNIQUE/i.test(error.message) ? 409 : 500).json({ message: /UNIQUE/i.test(error.message) ? 'Bottle code already exists in this company.' : error.message }); }
});

app.get('/api/bottle-movements', async (req, res) => {
  try {
    const params = [req.companyId];
    let customerFilter = '';
    if (req.query.customerId) { customerFilter = ' AND bm.customer_id = ?'; params.push(Number(req.query.customerId)); }
    const movements = await query(`
      SELECT bm.*, b.name AS bottle_name, b.code AS bottle_code, c.name AS customer, d.name AS driver_name, u.name AS created_by_name
      FROM bottle_movements bm
      JOIN bottles b ON b.id = bm.bottle_id AND b.company_id = bm.company_id
      LEFT JOIN customers c ON c.id = bm.customer_id AND c.company_id = bm.company_id
      LEFT JOIN users d ON d.id = bm.driver_id AND d.company_id = bm.company_id
      LEFT JOIN users u ON u.id = bm.created_by
      WHERE bm.company_id = ?${customerFilter}
      ORDER BY bm.created_at DESC, bm.id DESC LIMIT 500
    `, params);
    res.json(movements);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/bottle-balances', async (req, res) => {
  try {
    const params = [req.companyId];
    const customerFilter = req.query.customerId ? ' AND bm.customer_id = ?' : '';
    if (req.query.customerId) params.push(Number(req.query.customerId));
    const balances = await query(`
      SELECT b.id, b.name, b.code, b.capacity_litres, b.bottle_type,
        COALESCE(SUM(CASE WHEN bm.movement_type IN ('received', 'returned', 'driver_returned', 'adjustment_in') THEN bm.quantity WHEN bm.movement_type IN ('dispatched', 'driver_dispatched', 'damaged', 'lost', 'adjustment_out') THEN -bm.quantity ELSE 0 END), 0) AS available_balance,
        COALESCE(SUM(CASE WHEN bm.movement_type = 'dispatched' THEN bm.quantity WHEN bm.movement_type = 'returned' THEN -bm.quantity ELSE 0 END), 0) AS customer_held
      FROM bottles b LEFT JOIN bottle_movements bm ON bm.bottle_id = b.id AND bm.company_id = b.company_id${customerFilter}
      WHERE b.company_id = ?
      GROUP BY b.id ORDER BY b.name
    `, req.query.customerId ? [Number(req.query.customerId), req.companyId] : [req.companyId]);
    res.json(balances);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/bottle-movements', requireRole('super_admin', 'company_admin', 'manager', 'inventory_staff'), async (req, res) => {
  try {
    const { bottleId, customerId, movementType, quantity, reference = '', notes = '' } = req.body || {};
    const amount = Number(quantity);
    if (!bottleMovementTypes.includes(movementType) || !Number.isInteger(amount) || amount <= 0 || !bottleId) return res.status(400).json({ message: 'Bottle, movement type and a positive whole quantity are required.' });
    if (['dispatched', 'returned'].includes(movementType) && !customerId) return res.status(400).json({ message: 'A customer is required for dispatched and returned movements.' });
    if (['driver_dispatched', 'driver_returned'].includes(movementType) && !req.body?.driverId) return res.status(400).json({ message: 'A driver is required for driver-held movements.' });
    if (['dispatched', 'returned', 'driver_dispatched', 'driver_returned'].includes(movementType) && ['dispatched', 'returned'].includes(movementType) && req.body?.driverId) return res.status(400).json({ message: 'Choose either a customer or a driver, not both.' });
    const bottle = (await query('SELECT * FROM bottles WHERE id = ? AND company_id = ? AND active = 1', [Number(bottleId), req.companyId]))[0];
    if (!bottle) return res.status(404).json({ message: 'Active bottle type not found.' });
    if (customerId && !(await query('SELECT id FROM customers WHERE id = ? AND company_id = ?', [Number(customerId), req.companyId]))[0]) return res.status(404).json({ message: 'Customer not found.' });
    const driverId = req.body?.driverId ? Number(req.body.driverId) : null;
    if (driverId && !(await query("SELECT id FROM users WHERE id = ? AND company_id = ? AND active = 1 AND role IN ('driver','delivery_driver','staff','sales_staff','manager','company_admin')", [driverId, req.companyId]))[0]) return res.status(404).json({ message: 'Driver not found in this company.' });
    const currentRows = await query(`SELECT COALESCE(SUM(CASE WHEN movement_type IN ('received', 'returned', 'driver_returned', 'adjustment_in') THEN quantity WHEN movement_type IN ('dispatched', 'driver_dispatched', 'damaged', 'lost', 'adjustment_out') THEN -quantity ELSE 0 END), 0) AS balance FROM bottle_movements WHERE bottle_id = ? AND company_id = ?`, [bottle.id, req.companyId]);
    if (Number(currentRows[0].balance) + bottleBalanceDelta[movementType] * amount < 0) return res.status(400).json({ message: 'Movement would make the bottle balance negative.' });
    if (movementType === 'returned') {
      const held = await query("SELECT COALESCE(SUM(CASE WHEN movement_type = 'dispatched' THEN quantity WHEN movement_type = 'returned' THEN -quantity ELSE 0 END), 0) AS balance FROM bottle_movements WHERE bottle_id = ? AND company_id = ? AND customer_id = ?", [bottle.id, req.companyId, Number(customerId)]);
      if (Number(held[0].balance) < amount) return res.status(400).json({ message: 'Return quantity exceeds this customer\'s bottle balance.' });
    }
    if (movementType === 'driver_returned') {
      const held = await query("SELECT COALESCE(SUM(CASE WHEN movement_type = 'driver_dispatched' THEN quantity WHEN movement_type = 'driver_returned' THEN -quantity ELSE 0 END), 0) AS balance FROM bottle_movements WHERE bottle_id = ? AND company_id = ? AND driver_id = ?", [bottle.id, req.companyId, driverId]);
      if (Number(held[0].balance) < amount) return res.status(400).json({ message: 'Return quantity exceeds this driver\'s bottle balance.' });
    }
    const result = await insert('INSERT INTO bottle_movements (company_id, bottle_id, customer_id, driver_id, quantity, movement_type, reference, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, bottle.id, customerId ? Number(customerId) : null, driverId, amount, movementType, String(reference).trim(), String(notes).trim(), req.user.id]);
    await writeAudit(req, 'create', 'bottle_movement', result.id, null, { bottleId: bottle.id, customerId: customerId || null, movementType, quantity: amount });
    res.status(201).json((await query('SELECT * FROM bottle_movements WHERE id = ? AND company_id = ?', [result.id, req.companyId]))[0]);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/bottle-reconciliation', requireRole(...bottleReconciliationRoles), async (req, res) => {
  try {
    const params = [];
    const filters = [];
    if (req.query.customerId) { filters.push('bm.customer_id = ?'); params.push(Number(req.query.customerId)); }
    if (req.query.driverId) { filters.push('bm.driver_id = ?'); params.push(Number(req.query.driverId)); }
    params.push(req.companyId);
    const rows = await query(`
      SELECT b.id, b.name, b.code, b.capacity_litres, b.bottle_type, b.qr_code, b.barcode, b.bottle_identifier,
        COALESCE(SUM(CASE WHEN bm.movement_type IN ('received','returned','driver_returned','adjustment_in') THEN bm.quantity WHEN bm.movement_type IN ('dispatched','driver_dispatched','damaged','lost','adjustment_out') THEN -bm.quantity ELSE 0 END), 0) AS warehouse_available,
        COALESCE(SUM(CASE WHEN bm.movement_type = 'dispatched' THEN bm.quantity WHEN bm.movement_type = 'returned' THEN -bm.quantity ELSE 0 END), 0) AS customer_held,
        COALESCE(SUM(CASE WHEN bm.movement_type = 'driver_dispatched' THEN bm.quantity WHEN bm.movement_type = 'driver_returned' THEN -bm.quantity ELSE 0 END), 0) AS driver_held,
        COALESCE(SUM(CASE WHEN bm.movement_type = 'damaged' THEN bm.quantity ELSE 0 END), 0) AS damaged,
        COALESCE(SUM(CASE WHEN bm.movement_type = 'lost' THEN bm.quantity ELSE 0 END), 0) AS lost,
        COALESCE((SELECT SUM(dbc.returned_quantity) FROM delivery_bottle_counts dbc WHERE dbc.company_id = b.company_id AND dbc.bottle_id = b.id), 0) AS delivery_returned,
        COALESCE((SELECT SUM(dbc.empty_quantity) FROM delivery_bottle_counts dbc WHERE dbc.company_id = b.company_id AND dbc.bottle_id = b.id), 0) AS delivery_empty
      FROM bottles b LEFT JOIN bottle_movements bm ON bm.bottle_id = b.id AND bm.company_id = b.company_id
        ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
      WHERE b.company_id = ? GROUP BY b.id ORDER BY b.name
    `, params);
    res.json({ generatedAt: new Date().toISOString(), balances: rows });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/bottle-reconciliation/export', requireRole('super_admin', 'company_admin', 'manager', 'accountant'), async (req, res) => {
  try {
    const result = await query(`SELECT b.name, b.code, b.bottle_identifier, b.barcode, b.qr_code,
      COALESCE(SUM(CASE WHEN bm.movement_type IN ('received','returned','driver_returned','adjustment_in') THEN bm.quantity WHEN bm.movement_type IN ('dispatched','driver_dispatched','damaged','lost','adjustment_out') THEN -bm.quantity ELSE 0 END), 0) AS warehouse_available,
      COALESCE(SUM(CASE WHEN bm.movement_type = 'dispatched' THEN bm.quantity WHEN bm.movement_type = 'returned' THEN -bm.quantity ELSE 0 END), 0) AS customer_held,
      COALESCE(SUM(CASE WHEN bm.movement_type = 'driver_dispatched' THEN bm.quantity WHEN bm.movement_type = 'driver_returned' THEN -bm.quantity ELSE 0 END), 0) AS driver_held,
      COALESCE(SUM(CASE WHEN bm.movement_type = 'damaged' THEN bm.quantity ELSE 0 END), 0) AS damaged,
      COALESCE(SUM(CASE WHEN bm.movement_type = 'lost' THEN bm.quantity ELSE 0 END), 0) AS lost
      FROM bottles b LEFT JOIN bottle_movements bm ON bm.bottle_id = b.id AND bm.company_id = b.company_id WHERE b.company_id = ? GROUP BY b.id ORDER BY b.name`, [req.companyId]);
    await writeAudit(req, 'export_csv', 'bottle_reconciliation', null, null, { rowCount: result.length });
    res.status(200).set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bottle-reconciliation.csv"', 'Cache-Control': 'no-store' });
    writeCsv(res, ['name','code','bottle_identifier','barcode','qr_code','warehouse_available','customer_held','driver_held','damaged','lost'], result); res.end();
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/stock-movements', async (req, res) => {
  try {
    const rows = await query(`
      SELECT sm.*, p.name AS product, c.name AS customer, w.name AS warehouse
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id AND p.company_id = sm.company_id
      LEFT JOIN customers c ON c.id = sm.customer_id AND c.company_id = sm.company_id
      LEFT JOIN warehouses w ON w.id = sm.warehouse_id AND w.company_id = sm.company_id
      WHERE sm.company_id = ? ORDER BY sm.created_at DESC LIMIT 500
    `, [req.companyId]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/stock-movements', requireRole('super_admin', 'company_admin', 'manager', 'inventory_staff'), async (req, res) => {
  try {
    const { productId, warehouseId, customerId, movementType, quantity, reference, notes } = req.body || {};
    const allowedTypes = ['stock_in', 'stock_out', 'customer_out', 'customer_return', 'damaged', 'adjustment', 'transfer_in', 'transfer_out'];
    const amount = Number(quantity);
    if (!productId || !allowedTypes.includes(movementType) || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Product, movement type and a positive quantity are required.' });
    }
    const product = await query('SELECT * FROM products WHERE id = ? AND company_id = ?', [Number(productId), req.companyId]);
    if (!product[0]) return res.status(404).json({ message: 'Product not found.' });
    const increases = ['stock_in', 'customer_return', 'transfer_in'];
    const delta = increases.includes(movementType) ? amount : -amount;
    if (product[0].stock + delta < 0) return res.status(400).json({ message: 'Movement would make stock negative.' });
    const result = await insert(
      'INSERT INTO stock_movements (company_id, warehouse_id, product_id, customer_id, movement_type, quantity, reference, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.companyId, warehouseId || null, Number(productId), customerId || null, movementType, amount, reference || '', notes || '', req.user.id]
    );
    await update('UPDATE products SET stock = stock + ? WHERE id = ? AND company_id = ?', [delta, Number(productId), req.companyId]);
    await writeAudit(req, 'create', 'stock_movement', result.id, null, { movementType, quantity: amount, productId });
    res.status(201).json({ id: result.id, stock: product[0].stock + delta });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/warehouses', async (req, res) => {
  try {
    const warehouses = await query(`
      SELECT w.*, COALESCE(SUM(CASE WHEN sm.movement_type IN ('stock_in', 'customer_return') THEN sm.quantity WHEN sm.movement_type IN ('stock_out', 'customer_out', 'damaged') THEN -sm.quantity ELSE 0 END), 0) AS available_units
      FROM warehouses w LEFT JOIN stock_movements sm ON sm.warehouse_id = w.id AND sm.company_id = w.company_id
      WHERE w.company_id = ? GROUP BY w.id ORDER BY w.id
    `, [req.companyId]);
    res.json(warehouses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const orderStatuses = ['pending', 'confirmed', 'assigned', 'out_for_delivery', 'delivered', 'partially_delivered', 'cancelled', 'failed'];
const deliveryStatuses = ['assigned', 'out_for_delivery', 'delivered', 'partially_delivered', 'failed'];
const driverRoles = ['driver', 'delivery_driver', 'staff', 'sales_staff', 'manager', 'company_admin'];

async function getOrderById(id, companyId) {
  const orders = await query(`
    SELECT o.*, c.name AS customer_record_name,
      u.name AS created_by_name, d.id AS delivery_id, d.driver_id, d.status AS delivery_status,
      du.name AS driver_name
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id AND c.company_id = o.company_id
    LEFT JOIN users u ON u.id = o.created_by
    LEFT JOIN deliveries d ON d.order_id = o.id AND d.company_id = o.company_id
    LEFT JOIN users du ON du.id = d.driver_id
    WHERE o.id = ? AND o.company_id = ?
  `, [id, companyId]);
  if (!orders[0]) return null;
  orders[0].items = await query(`
    SELECT oi.*, p.name AS product_name, p.unit
    FROM order_items oi JOIN products p ON p.id = oi.product_id AND p.company_id = oi.company_id
    WHERE oi.order_id = ? AND oi.company_id = ? ORDER BY oi.id
  `, [id, companyId]);
  return orders[0];
}

app.get('/api/drivers', async (req, res) => {
  try {
    const drivers = await query(`SELECT id, name, username, role FROM users WHERE company_id = ? AND active = 1 AND role IN (${driverRoles.map(() => '?').join(',')}) ORDER BY name`, [req.companyId, ...driverRoles]);
    res.json(drivers);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/orders', async (req, res) => {
  try {
    const status = req.query.status && orderStatuses.includes(req.query.status) ? req.query.status : null;
    const params = [req.companyId];
    const filter = status ? ' AND o.status = ?' : '';
    if (status) params.push(status);
    const orders = await query(`
      SELECT o.*, c.name AS customer_record_name, COUNT(oi.id) AS item_count,
        COALESCE(SUM(oi.quantity), 0) AS item_quantity, d.id AS delivery_id, d.driver_id,
        d.status AS delivery_status, u.name AS driver_name
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id AND c.company_id = o.company_id
      LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.company_id = o.company_id
      LEFT JOIN deliveries d ON d.order_id = o.id AND d.company_id = o.company_id
      LEFT JOIN users u ON u.id = d.driver_id
      WHERE o.company_id = ?${filter}
      GROUP BY o.id ORDER BY o.id DESC
    `, params);
    res.json(orders);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await getOrderById(Number(req.params.id), req.companyId);
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    res.json(order);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { customerId, customerName, deliveryAddress = '', notes = '', items } = req.body || {};
    if (!String(customerName || '').trim() || !Array.isArray(items) || items.length === 0) return res.status(400).json({ message: 'Customer name and at least one item are required.' });
    const customer = customerId ? (await query('SELECT id, name, address FROM customers WHERE id = ? AND company_id = ?', [Number(customerId), req.companyId]))[0] : null;
    if (customerId && !customer) return res.status(404).json({ message: 'Customer not found in this company.' });
    const records = [];
    let total = 0;
    for (const item of items) {
      const quantity = Number(item.quantity);
      const product = (await query('SELECT id, name, sale_price FROM products WHERE id = ? AND company_id = ?', [Number(item.productId), req.companyId]))[0];
      if (!product || !Number.isInteger(quantity) || quantity < 1) return res.status(400).json({ message: 'Each item must contain a valid product and positive whole quantity.' });
      const lineTotal = Number(product.sale_price) * quantity;
      records.push({ product, quantity, lineTotal });
      total += lineTotal;
    }
    const orderResult = await insert('INSERT INTO orders (company_id, customer_id, customer_name, delivery_address, notes, total_amount, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.companyId, customer?.id || null, customer?.name || String(customerName).trim(), deliveryAddress || customer?.address || '', notes || '', total, req.user.id]);
    for (const record of records) await insert('INSERT INTO order_items (company_id, order_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, orderResult.id, record.product.id, record.quantity, record.product.sale_price, record.lineTotal]);
    const order = await getOrderById(orderResult.id, req.companyId);
    await writeAudit(req, 'create', 'order', orderResult.id, null, { customerName: order.customer_name, totalAmount: total });
    res.status(201).json(order);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

const deliveryFrequencyValues = ['daily', 'alternate_days', 'weekly', 'monthly', 'custom'];
const deliverySubscriptionStatuses = ['active', 'paused', 'completed', 'cancelled'];

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function nextSubscriptionDate(dateString, subscription) {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (subscription.frequency === 'daily') date.setUTCDate(date.getUTCDate() + 1);
  else if (subscription.frequency === 'alternate_days') date.setUTCDate(date.getUTCDate() + 2);
  else if (subscription.frequency === 'weekly') date.setUTCDate(date.getUTCDate() + 7);
  else if (subscription.frequency === 'monthly') date.setUTCMonth(date.getUTCMonth() + 1);
  else if (subscription.custom_unit === 'weeks') date.setUTCDate(date.getUTCDate() + (Number(subscription.custom_interval) * 7));
  else if (subscription.custom_unit === 'months') date.setUTCMonth(date.getUTCMonth() + Number(subscription.custom_interval));
  else date.setUTCDate(date.getUTCDate() + Number(subscription.custom_interval));
  return date.toISOString().slice(0, 10);
}

function validateSubscriptionSchedule({ frequency, customInterval, customUnit, startDate, endDate }) {
  if (!deliveryFrequencyValues.includes(frequency) || !isIsoDate(startDate)) return 'A valid frequency and start date are required.';
  if (endDate && (!isIsoDate(endDate) || endDate < startDate)) return 'End date must be a valid date on or after the start date.';
  if (frequency === 'custom' && (!Number.isInteger(Number(customInterval)) || Number(customInterval) < 1 || !['days', 'weeks', 'months'].includes(customUnit))) return 'Custom frequency requires a positive interval and days, weeks, or months unit.';
  return null;
}

async function getDeliverySubscription(id, companyId) {
  const rows = await query(`
    SELECT ds.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address,
      p.name AS product_name, p.sale_price AS product_sale_price
    FROM delivery_subscriptions ds
    JOIN customers c ON c.id = ds.customer_id AND c.company_id = ds.company_id
    JOIN products p ON p.id = ds.product_id AND p.company_id = ds.company_id
    WHERE ds.id = ? AND ds.company_id = ?
  `, [id, companyId]);
  if (!rows[0]) return null;
  rows[0].occurrences = await query('SELECT * FROM delivery_subscription_occurrences WHERE delivery_subscription_id = ? AND company_id = ? ORDER BY due_date DESC LIMIT 30', [id, companyId]);
  return rows[0];
}

app.get('/api/delivery-subscriptions', async (req, res) => {
  try {
    const rows = await query(`SELECT ds.*, c.name AS customer_name, p.name AS product_name,
      (SELECT COUNT(*) FROM delivery_subscription_occurrences dso WHERE dso.delivery_subscription_id = ds.id AND dso.status = 'generated') AS generated_count
      FROM delivery_subscriptions ds JOIN customers c ON c.id = ds.customer_id AND c.company_id = ds.company_id
      JOIN products p ON p.id = ds.product_id AND p.company_id = ds.company_id
      WHERE ds.company_id = ? ORDER BY ds.status = 'active' DESC, ds.next_due_date, ds.id DESC`, [req.companyId]);
    res.json(rows);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/delivery-subscriptions/:id', async (req, res) => {
  try {
    const subscription = await getDeliverySubscription(Number(req.params.id), req.companyId);
    if (!subscription) return res.status(404).json({ message: 'Delivery subscription not found.' });
    res.json(subscription);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/delivery-subscriptions', requireRole('super_admin', 'company_admin', 'manager', 'sales_staff', 'staff'), async (req, res) => {
  try {
    const body = req.body || {};
    const customerId = Number(body.customerId);
    const productId = Number(body.productId);
    const quantity = Number(body.quantity);
    const customer = (await query('SELECT id, address FROM customers WHERE id = ? AND company_id = ?', [customerId, req.companyId]))[0];
    const product = (await query('SELECT id, sale_price FROM products WHERE id = ? AND company_id = ?', [productId, req.companyId]))[0];
    if (!customer || !product || !Number.isInteger(quantity) || quantity < 1) return res.status(400).json({ message: 'A valid customer, product, and positive whole quantity are required.' });
    const frequency = String(body.frequency || 'weekly');
    const startDate = String(body.startDate || '');
    const endDate = body.endDate ? String(body.endDate) : null;
    const scheduleError = validateSubscriptionSchedule({ frequency, customInterval: body.customInterval, customUnit: body.customUnit, startDate, endDate });
    if (scheduleError) return res.status(400).json({ message: scheduleError });
    const unitPrice = body.unitPrice === undefined || body.unitPrice === '' ? Number(product.sale_price) : Number(body.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return res.status(400).json({ message: 'Unit price must be zero or greater.' });
    const result = await insert(`INSERT INTO delivery_subscriptions
      (company_id, customer_id, product_id, quantity, unit_price, frequency, custom_interval, custom_unit, start_date, end_date, next_due_date, delivery_address, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [req.companyId, customerId, productId, quantity, unitPrice, frequency, frequency === 'custom' ? Number(body.customInterval) : null, frequency === 'custom' ? body.customUnit : null, startDate, endDate, startDate, body.deliveryAddress || customer.address || '', body.notes || '', req.user.id]);
    const subscription = await getDeliverySubscription(result.id, req.companyId);
    await writeAudit(req, 'create', 'delivery_subscription', result.id, null, subscription);
    res.status(201).json(subscription);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/delivery-subscriptions/:id', requireRole('super_admin', 'company_admin', 'manager', 'sales_staff', 'staff'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await getDeliverySubscription(id, req.companyId);
    if (!existing) return res.status(404).json({ message: 'Delivery subscription not found.' });
    const body = req.body || {};
    const frequency = body.frequency === undefined ? existing.frequency : String(body.frequency);
    const startDate = body.startDate === undefined ? existing.start_date : String(body.startDate);
    const endDate = body.endDate === undefined ? existing.end_date : (body.endDate ? String(body.endDate) : null);
    const scheduleError = validateSubscriptionSchedule({ frequency, customInterval: body.customInterval === undefined ? existing.custom_interval : body.customInterval, customUnit: body.customUnit === undefined ? existing.custom_unit : body.customUnit, startDate, endDate });
    if (scheduleError) return res.status(400).json({ message: scheduleError });
    const customerId = body.customerId === undefined ? existing.customer_id : Number(body.customerId);
    const productId = body.productId === undefined ? existing.product_id : Number(body.productId);
    const quantity = body.quantity === undefined ? existing.quantity : Number(body.quantity);
    const customer = (await query('SELECT id, address FROM customers WHERE id = ? AND company_id = ?', [customerId, req.companyId]))[0];
    const product = (await query('SELECT id, sale_price FROM products WHERE id = ? AND company_id = ?', [productId, req.companyId]))[0];
    if (!customer || !product || !Number.isInteger(quantity) || quantity < 1) return res.status(400).json({ message: 'Customer, product, and quantity are invalid.' });
    const unitPrice = body.unitPrice === undefined ? existing.unit_price : Number(body.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return res.status(400).json({ message: 'Unit price must be zero or greater.' });
    const nextDueDate = body.startDate === undefined ? existing.next_due_date : startDate;
    await update(`UPDATE delivery_subscriptions SET customer_id = ?, product_id = ?, quantity = ?, unit_price = ?, frequency = ?, custom_interval = ?, custom_unit = ?, start_date = ?, end_date = ?, next_due_date = ?, delivery_address = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`, [customerId, productId, quantity, unitPrice, frequency, frequency === 'custom' ? Number(body.customInterval === undefined ? existing.custom_interval : body.customInterval) : null, frequency === 'custom' ? (body.customUnit === undefined ? existing.custom_unit : body.customUnit) : null, startDate, endDate, nextDueDate, body.deliveryAddress === undefined ? existing.delivery_address : body.deliveryAddress, body.notes === undefined ? existing.notes : body.notes, id, req.companyId]);
    const subscription = await getDeliverySubscription(id, req.companyId);
    await writeAudit(req, 'update', 'delivery_subscription', id, existing, subscription);
    res.json(subscription);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

async function setDeliverySubscriptionStatus(req, res, status) {
  const id = Number(req.params.id);
  const existing = await getDeliverySubscription(id, req.companyId);
  if (!existing) return res.status(404).json({ message: 'Delivery subscription not found.' });
  if (status === 'resume' && existing.status === 'completed') return res.status(400).json({ message: 'Completed subscriptions cannot be resumed.' });
  const nextStatus = status === 'pause' ? 'paused' : 'active';
  await update('UPDATE delivery_subscriptions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [nextStatus, id, req.companyId]);
  res.json(await getDeliverySubscription(id, req.companyId));
}
app.post('/api/delivery-subscriptions/:id/pause', requireRole('super_admin', 'company_admin', 'manager', 'sales_staff', 'staff'), (req, res) => setDeliverySubscriptionStatus(req, res, 'pause').catch((error) => res.status(500).json({ message: error.message })));
app.post('/api/delivery-subscriptions/:id/resume', requireRole('super_admin', 'company_admin', 'manager', 'sales_staff', 'staff'), (req, res) => setDeliverySubscriptionStatus(req, res, 'resume').catch((error) => res.status(500).json({ message: error.message })));

app.post('/api/delivery-subscriptions/:id/skip', requireRole('super_admin', 'company_admin', 'manager', 'sales_staff', 'staff'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const subscription = await getDeliverySubscription(id, req.companyId);
    if (!subscription) return res.status(404).json({ message: 'Delivery subscription not found.' });
    if (subscription.status !== 'active') return res.status(400).json({ message: 'Only active subscriptions can be skipped.' });
    await insert('INSERT OR IGNORE INTO delivery_subscription_occurrences (company_id, delivery_subscription_id, due_date, status) VALUES (?, ?, ?, \'skipped\')', [req.companyId, id, subscription.next_due_date]);
    const nextDueDate = nextSubscriptionDate(subscription.next_due_date, subscription);
    const nextStatus = subscription.end_date && nextDueDate > subscription.end_date ? 'completed' : 'active';
    await update('UPDATE delivery_subscriptions SET next_due_date = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [nextDueDate, nextStatus, id, req.companyId]);
    res.json(await getDeliverySubscription(id, req.companyId));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/delivery-subscriptions/generate-due', requireRole('super_admin', 'company_admin', 'manager', 'sales_staff', 'staff'), async (req, res) => {
  try {
    const requestedDate = req.body?.upToDate || req.query.upToDate || new Date().toISOString().slice(0, 10);
    if (!isIsoDate(requestedDate)) return res.status(400).json({ message: 'upToDate must be a valid YYYY-MM-DD date.' });
    const subscriptions = await query(`SELECT * FROM delivery_subscriptions WHERE company_id = ? AND status = 'active' AND next_due_date <= ? ORDER BY id`, [req.companyId, requestedDate]);
    const generated = [];
    for (const subscription of subscriptions) {
      let dueDate = subscription.next_due_date;
      let guard = 0;
      while (dueDate <= requestedDate && guard++ < 366) {
        if (subscription.end_date && dueDate > subscription.end_date) break;
        await insert('INSERT OR IGNORE INTO delivery_subscription_occurrences (company_id, delivery_subscription_id, due_date, status) VALUES (?, ?, ?, \'pending\')', [req.companyId, subscription.id, dueDate]);
        const occurrence = (await query('SELECT * FROM delivery_subscription_occurrences WHERE company_id = ? AND delivery_subscription_id = ? AND due_date = ?', [req.companyId, subscription.id, dueDate]))[0];
        if (occurrence.status === 'pending') {
          const orderResult = await insert('INSERT INTO orders (company_id, customer_id, customer_name, delivery_address, notes, total_amount, created_by, delivery_subscription_id, subscription_occurrence_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, subscription.customer_id, subscription.customer_name || (await query('SELECT name FROM customers WHERE id = ? AND company_id = ?', [subscription.customer_id, req.companyId]))[0]?.name || '', subscription.delivery_address || '', subscription.notes || `Recurring delivery ${dueDate}`, Number(subscription.unit_price) * Number(subscription.quantity), req.user.id, subscription.id, occurrence.id]);
          await insert('INSERT INTO order_items (company_id, order_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, orderResult.id, subscription.product_id, subscription.quantity, subscription.unit_price, Number(subscription.unit_price) * Number(subscription.quantity)]);
          await update('UPDATE delivery_subscription_occurrences SET status = \'generated\', order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = \'pending\'', [orderResult.id, occurrence.id]);
          generated.push({ subscriptionId: subscription.id, occurrenceId: occurrence.id, orderId: orderResult.id, dueDate });
        }
        dueDate = nextSubscriptionDate(dueDate, subscription);
      }
      const nextStatus = subscription.end_date && dueDate > subscription.end_date ? 'completed' : 'active';
      await update('UPDATE delivery_subscriptions SET next_due_date = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [dueDate, nextStatus, subscription.id, req.companyId]);
    }
    res.json({ generated, count: generated.length });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/orders/:id/status', requireRole('super_admin', 'company_admin', 'manager', 'sales_staff', 'staff', 'driver', 'delivery_driver'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const order = await getOrderById(id, req.companyId);
    const status = String(req.body?.status || '');
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    if (!orderStatuses.includes(status)) return res.status(400).json({ message: 'Invalid order status.' });
    await update('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [status, id, req.companyId]);
    if (status === 'delivered' && order.customer_id) await awardLoyalty(req, order.customer_id, order.total_amount, 'order', id, `Points earned on delivered order #${id}`);
    await writeAudit(req, 'status_change', 'order', id, { status: order.status }, { status });
    res.json(await getOrderById(id, req.companyId));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/deliveries/:id/proof', requireRole('super_admin', 'company_admin', 'manager', 'staff', 'sales_staff', 'driver', 'delivery_driver'), async (req, res) => {
  try {
    const delivery = (await query('SELECT id, driver_id FROM deliveries WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0];
    if (!delivery) return res.status(404).json({ message: 'Delivery not found.' });
    if (mobileDriverRoles.includes(req.user.role) && delivery.driver_id !== req.user.id) return res.status(403).json({ message: 'Drivers can view only their assigned proof.' });
    const proof = (await query('SELECT * FROM delivery_proofs WHERE delivery_id = ? AND company_id = ?', [delivery.id, req.companyId]))[0];
    if (!proof) return res.status(404).json({ message: 'Proof of delivery not found.' });
    res.json(proof);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/deliveries', async (req, res) => {
  try {
    const deliveries = await query(`
      SELECT d.*, o.customer_name, o.delivery_address, o.total_amount, o.status AS order_status,
        c.phone AS customer_phone, c.address AS customer_address, u.name AS driver_name
      FROM deliveries d JOIN orders o ON o.id = d.order_id AND o.company_id = d.company_id
      LEFT JOIN customers c ON c.id = o.customer_id AND c.company_id = o.company_id
      LEFT JOIN users u ON u.id = d.driver_id
      WHERE d.company_id = ? ORDER BY COALESCE(d.scheduled_date, date(d.created_at)) DESC, d.id DESC
    `, [req.companyId]);
    res.json(deliveries);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/orders/:id/delivery', requireRole('super_admin', 'company_admin', 'manager', 'staff', 'sales_staff'), async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const order = await getOrderById(orderId, req.companyId);
    const driverId = Number(req.body?.driverId);
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    if (!Number.isInteger(driverId)) return res.status(400).json({ message: 'A driver is required.' });
    const driver = (await query(`SELECT id FROM users WHERE id = ? AND company_id = ? AND active = 1 AND role IN (${driverRoles.map(() => '?').join(',')})`, [driverId, req.companyId, ...driverRoles]))[0];
    if (!driver) return res.status(400).json({ message: 'Driver is not active or is outside this company.' });
    const scheduledDate = req.body?.scheduledDate || new Date().toISOString().slice(0, 10);
    if (!isIsoDate(scheduledDate)) return res.status(400).json({ message: 'Scheduled date must be a valid date.' });
    const deliveryResult = await insert('INSERT INTO deliveries (company_id, order_id, driver_id, status, scheduled_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_id, order_id) DO UPDATE SET driver_id = excluded.driver_id, status = excluded.status, scheduled_date = excluded.scheduled_date, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP', [req.companyId, orderId, driverId, 'assigned', scheduledDate, req.body?.notes || '', req.user.id]);
    await update('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', ['assigned', orderId, req.companyId]);
    await writeAudit(req, 'assign', 'delivery', deliveryResult.id, null, { orderId, driverId, scheduledDate });
    res.status(201).json(await getOrderById(orderId, req.companyId));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/deliveries/:id', requireRole('super_admin', 'company_admin', 'manager', 'staff', 'sales_staff', 'driver', 'delivery_driver'), async (req, res) => {
  try {
    const deliveryId = Number(req.params.id);
    const delivery = (await query('SELECT * FROM deliveries WHERE id = ? AND company_id = ?', [deliveryId, req.companyId]))[0];
    const status = String(req.body?.status || '');
    if (!delivery) return res.status(404).json({ message: 'Delivery not found.' });
    if (!deliveryStatuses.includes(status)) return res.status(400).json({ message: 'Invalid delivery status.' });
    if (['driver', 'delivery_driver'].includes(req.user.role) && delivery.driver_id !== req.user.id) return res.status(403).json({ message: 'Drivers can update only their assigned deliveries.' });
    const deliveredAt = ['delivered', 'partially_delivered'].includes(status) ? 'CURRENT_TIMESTAMP' : 'NULL';
    if (Array.isArray(req.body?.items)) {
      for (const item of req.body.items) {
        const quantity = Number(item.deliveredQuantity);
        if (!Number.isInteger(quantity) || quantity < 0) return res.status(400).json({ message: 'Delivered quantities must be whole numbers.' });
        const updated = await update('UPDATE order_items SET delivered_quantity = ? WHERE id = ? AND order_id = ? AND company_id = ? AND quantity >= ?', [quantity, Number(item.itemId), delivery.order_id, req.companyId, quantity]);
        if (!updated.changes) return res.status(400).json({ message: 'Invalid order item or delivered quantity exceeds ordered quantity.' });
      }
    }
    await update(`UPDATE deliveries SET status = ?, notes = ?, delivered_at = ${deliveredAt}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`, [status, req.body?.notes || delivery.notes || '', deliveryId, req.companyId]);
    await update('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [status, delivery.order_id, req.companyId]);
    if (status === 'delivered' || status === 'partially_delivered') await createCommissionLineForDelivery(req.companyId, delivery, delivery.driver_id, req.user.id);
    await writeAudit(req, 'status_change', 'delivery', deliveryId, { status: delivery.status }, { status, driverId: delivery.driver_id });
    res.json(await getOrderById(delivery.order_id, req.companyId));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

const mobileDriverRoles = ['driver', 'delivery_driver'];
const mobileDeliveryActions = ['start', 'deliver', 'fail', 'reschedule'];
const proofContentTypes = ['image/png', 'image/jpeg', 'image/webp'];

function validateProofMetadata(value, fieldName) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${fieldName} metadata is invalid.`);
  const storageKey = String(value.storageKey || '').trim();
  const contentType = String(value.contentType || '').toLowerCase();
  const byteSize = Number(value.byteSize);
  const sha256 = String(value.sha256 || '').toLowerCase();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,250}$/.test(storageKey) || storageKey.includes('..') || storageKey.startsWith('/')) throw new Error(`${fieldName} storage key is invalid.`);
  if (!proofContentTypes.includes(contentType) || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > 10 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`${fieldName} metadata must include a valid type, size and SHA-256 hash.`);
  const width = value.width === undefined ? null : Number(value.width);
  const height = value.height === undefined ? null : Number(value.height);
  if (width !== null && (!Number.isInteger(width) || width < 1 || width > 10000) || height !== null && (!Number.isInteger(height) || height < 1 || height > 10000)) throw new Error(`${fieldName} dimensions are invalid.`);
  return { storageKey, contentType, byteSize, sha256, width, height };
}

function otpHash(code) { return crypto.createHash('sha256').update(String(code)).digest('hex'); }
async function createDeliveryOtp(req, delivery, _includeCode = false) {
  // Both driver and customer portals send the OTP only to the customer email.
  // The _includeCode legacy argument is ignored: never return OTP in an API.
  return issueCustomerDeliveryOtp({
    companyId:req.companyId,deliveryId:delivery.id,actorId:req.user.id,req,
    driverId:['driver','delivery_driver'].includes(req.user.role)?req.user.id:null,
    customerId:req.user.role==='customer'?req.user.customer_id:null
  });
}
async function verifyDeliveryOtp(req, delivery, challengeId, code) {
  const challenge = (await query('SELECT * FROM delivery_otp_challenges WHERE id = ? AND delivery_id = ? AND company_id = ? AND verified_at IS NULL', [Number(challengeId), delivery.id, req.companyId]))[0];
  if (!challenge || new Date(challenge.expires_at).getTime() < Date.now() || challenge.attempts >= 5) return false;
  await update('UPDATE delivery_otp_challenges SET attempts = attempts + 1 WHERE id = ?', [challenge.id]);
  if (!/^\d{6}$/.test(String(code || '')) || otpHash(code) !== challenge.code_hash) return false;
  await update('UPDATE delivery_otp_challenges SET verified_at = CURRENT_TIMESTAMP WHERE id = ?', [challenge.id]);
  req.verifiedOtp = challenge;
  return true;
}

app.get('/api/driver/bottle-types', requireRole(...mobileDriverRoles), async (req, res) => {
  try {
    const bottles = await query('SELECT id, name FROM bottles WHERE company_id = ? AND active = 1 ORDER BY name, id', [req.companyId]);
    res.json(bottles);
  } catch (_) { res.status(500).json({ message: 'Could not fetch bottle types.' }); }
});

app.get('/api/driver/deliveries', requireRole(...mobileDriverRoles), async (req, res) => {
  try {
    const requestedDate = req.query.date || new Date().toISOString().slice(0, 10);
    if (!isIsoDate(requestedDate)) return res.status(400).json({ message: 'Date must use YYYY-MM-DD.' });
    const history = req.query.history === 'true';
    const deliveries = await query(`
      SELECT d.*, o.customer_name, o.delivery_address, o.total_amount, o.notes AS order_notes,
        c.phone AS customer_phone, c.address AS customer_address, o.status AS order_status,
        (SELECT COUNT(*) FROM delivery_bottle_counts dbc WHERE dbc.delivery_id = d.id AND dbc.company_id = d.company_id) AS bottle_count_records
      FROM deliveries d JOIN orders o ON o.id = d.order_id AND o.company_id = d.company_id
      LEFT JOIN customers c ON c.id = o.customer_id AND c.company_id = o.company_id
      WHERE d.company_id = ? AND d.driver_id = ?
        AND ${history ? "d.status IN ('delivered','partially_delivered','failed')" : "date(COALESCE(d.scheduled_date, d.created_at)) = ? AND d.status NOT IN ('delivered','partially_delivered','failed')"}
      ORDER BY COALESCE(d.scheduled_date, date(d.created_at)), d.id`, history ? [req.companyId, req.user.id] : [req.companyId, req.user.id, requestedDate]);
    res.json(deliveries);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/driver/deliveries/:id/otp', requireRole(...mobileDriverRoles), async (req, res) => {
  try {
    const delivery = (await query('SELECT * FROM deliveries WHERE id = ? AND company_id = ? AND driver_id = ?', [Number(req.params.id), req.companyId, req.user.id]))[0];
    if (!delivery) return res.status(404).json({ message: 'Assigned delivery not found.' });
    res.status(201).json(await createDeliveryOtp(req, delivery));
  } catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : 'Customer OTP delivery unavailable' }); }
});

app.post('/api/customer/deliveries/:id/otp', requireCustomer, async (req, res) => {
  try {
    const delivery = (await query('SELECT d.*, o.customer_id FROM deliveries d JOIN orders o ON o.id = d.order_id AND o.company_id = d.company_id WHERE d.id = ? AND d.company_id = ? AND o.customer_id = ?', [Number(req.params.id), req.companyId, req.user.customer_id]))[0];
    if (!delivery) return res.status(404).json({ message: 'Delivery not found.' });
    res.status(201).json(await createDeliveryOtp(req, delivery, true));
  } catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : 'Customer OTP delivery unavailable' }); }
});

app.get('/api/customer/deliveries/:id/proof', requireCustomer, async (req, res) => {
  const proof = (await query(`SELECT p.* FROM delivery_proofs p JOIN deliveries d ON d.id = p.delivery_id AND d.company_id = p.company_id JOIN orders o ON o.id = d.order_id AND o.company_id = d.company_id WHERE p.delivery_id = ? AND p.company_id = ? AND o.customer_id = ?`, [Number(req.params.id), req.companyId, req.user.customer_id]))[0];
  if (!proof) return res.status(404).json({ message: 'Proof of delivery not found.' });
  res.json(proof);
});

// Native driver uploads the actual bytes before a completion records proof metadata.
// File paths are server-managed, outside public assets. Never trust a caller-supplied key.
app.post('/api/driver/deliveries/:id/proof-upload', requireRole(...mobileDriverRoles), async (req, res) => {
  try {
    const deliveryId = Number(req.params.id);
    const rows = await query('SELECT id, status FROM deliveries WHERE id = ? AND company_id = ? AND driver_id = ?', [deliveryId, req.companyId, req.user.id]);
    if (!rows[0]) return res.status(404).json({ message: 'Assigned delivery not found.' });
    if (['delivered', 'failed', 'partially_delivered'].includes(rows[0].status)) return res.status(409).json({ message: 'Delivery is closed.' });
    const kind = String(req.body?.kind || '');
    if (!['signature', 'photo'].includes(kind)) return res.status(400).json({ message: 'Proof must be signature or photo.' });
    const value = String(req.body?.imageBase64 || '');
    if (value.length < 8 || value.length > 3 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      return res.status(400).json({ message: 'Invalid proof image encoding or size.' });
    }
    const bytes = Buffer.from(value, 'base64');
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) return res.status(400).json({ message: 'Proof image must be under 2MB.' });
    const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const isJpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    if (!isPng && !isJpeg) return res.status(400).json({ message: 'Only real PNG/JPEG proof images are accepted.' });
    const root = process.env.TEMO_PROOF_STORAGE_DIR || path.join(__dirname, 'private-proofs');
    const storageKey = [String(req.companyId), String(deliveryId), crypto.randomBytes(16).toString('hex') + (isPng ? '.png' : '.jpg')].join('/');
    const fullPath = path.join(root, storageKey);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(fullPath, bytes, { flag: 'wx', mode: 0o600 });
    const metadata = {
      storageKey, contentType: isPng ? 'image/png' : 'image/jpeg',
      byteSize: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    };
    if(driverAtomicQaEnabled){
      const verified=await insert(`INSERT INTO driver_qa_verified_proofs(
        company_id,delivery_id,driver_id,kind,storage_key,sha256,content_type,byte_size)
        VALUES(?,?,?,?,?,?,?,?)`,
        [req.companyId,deliveryId,req.user.id,kind,metadata.storageKey,
         metadata.sha256,metadata.contentType,metadata.byteSize]);
      metadata.proofId=verified.id;
    }
    res.status(201).json({ success: true, proof: metadata });
  } catch (error) {
    res.status(500).json({ message: 'Unable to store proof. Try again when connected.' });
  }
});

app.post('/api/driver/deliveries/:id/action', requireRole(...mobileDriverRoles), async (req, res) => {
  if(driverAtomicQaEnabled && req.body?.action==='deliver')
    return atomicDriverDeliveryQaHandler(req,res);
  try {
    const deliveryId = Number(req.params.id);
    const action = String(req.body?.action || '');
    const delivery = (await query(`
      SELECT d.*, o.customer_name, o.total_amount FROM deliveries d
      JOIN orders o ON o.id = d.order_id AND o.company_id = d.company_id
      WHERE d.id = ? AND d.company_id = ? AND d.driver_id = ?`, [deliveryId, req.companyId, req.user.id]))[0];
    if (!delivery) return res.status(404).json({ message: 'Assigned delivery not found.' });
    if (!mobileDeliveryActions.includes(action)) return res.status(400).json({ message: 'Invalid delivery action.' });
    if (['delivered', 'partially_delivered'].includes(delivery.status) && action !== 'reschedule') return res.status(409).json({ message: 'This delivery is already completed.' });

    const notes = String(req.body?.notes || '').trim().slice(0, 1000);
    const amount = req.body?.payment?.amount === undefined ? 0 : Number(req.body.payment.amount);
    const bottleReturnCount = req.body?.bottleReturnCount === undefined ? 0 : Number(req.body.bottleReturnCount);
    const emptyCount = req.body?.emptyCount === undefined ? 0 : Number(req.body.emptyCount);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(bottleReturnCount) || bottleReturnCount < 0 || !Number.isInteger(emptyCount) || emptyCount < 0) return res.status(400).json({ message: 'Payment and bottle counts must be valid non-negative values.' });
    if (action === 'deliver' && amount > 0 && !String(req.body?.payment?.method || '').trim()) return res.status(400).json({ message: 'Payment method is required when collecting payment.' });
    const rescheduledFor = req.body?.rescheduledFor || null;
    if (action === 'reschedule' && !isIsoDate(rescheduledFor)) return res.status(400).json({ message: 'A valid rescheduled date is required.' });
    if (action === 'fail' && !notes) return res.status(400).json({ message: 'A reason is required when a delivery fails.' });
    let signature = null; let photo = null;
    try { signature = validateProofMetadata(req.body?.signature, 'Signature'); photo = validateProofMetadata(req.body?.photo, 'Photo'); } catch (error) { return res.status(400).json({ message: error.message }); }
    if (action === 'deliver') {
      if (!signature) return res.status(400).json({ message: 'Signature metadata is required to complete delivery.' });
      if (!req.body?.otpChallengeId || !(await verifyDeliveryOtp(req, delivery, req.body.otpChallengeId, req.body.otpCode))) return res.status(400).json({ message: 'A valid customer OTP is required to complete delivery.' });
    }
    const bottleId = req.body?.bottleId ? Number(req.body.bottleId) : null;
    if (bottleId) {
      const bottle = (await query('SELECT id FROM bottles WHERE id = ? AND company_id = ? AND active = 1', [bottleId, req.companyId]))[0];
      if (!bottle) return res.status(400).json({ message: 'Bottle type not found in this company.' });
    }

    const nextStatus = action === 'start' ? 'out_for_delivery' : action === 'deliver' ? 'delivered' : action === 'reschedule' ? 'failed' : 'failed';
    const startedAt = action === 'start' ? 'CURRENT_TIMESTAMP' : 'started_at';
    const completedAt = action === 'deliver' ? 'CURRENT_TIMESTAMP' : 'delivered_at';
    await update(`UPDATE deliveries SET status = ?, started_at = ${startedAt}, delivered_at = ${completedAt}, failed_reason = ?, rescheduled_for = ?, collected_amount = ?, collected_method = ?, collected_reference = ?, bottle_return_count = ?, empty_count = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ? AND driver_id = ?`, [nextStatus, action === 'fail' || action === 'reschedule' ? notes : '', action === 'reschedule' ? rescheduledFor : null, amount, amount > 0 ? String(req.body.payment.method).trim().slice(0, 40) : '', amount > 0 ? String(req.body.payment.reference || '').trim().slice(0, 100) : '', bottleReturnCount, emptyCount, notes, deliveryId, req.companyId, req.user.id]);
    await update('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [nextStatus, delivery.order_id, req.companyId]);

    if (amount > 0) {
      const payment = await insert('INSERT INTO payments (company_id, customer_name, amount, method, note, direction, party_type, reference, created_by, delivery_id, order_id, collected_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, delivery.customer_name, amount, req.body.payment.method, notes || `Collected for delivery #${deliveryId}`, 'receipt', 'customer', req.body.payment.reference || `DELIVERY-${deliveryId}`, req.user.id, deliveryId, delivery.order_id, req.user.id]);
      await writeAudit(req, 'collect', 'payment', payment.id, null, { deliveryId, amount, method: req.body.payment.method });
    }
    if (bottleReturnCount || emptyCount) {
      await insert('INSERT INTO delivery_bottle_counts (company_id, delivery_id, bottle_id, returned_quantity, empty_quantity, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.companyId, deliveryId, bottleId, bottleReturnCount, emptyCount, notes, req.user.id]);
      if (bottleId && bottleReturnCount) await insert('INSERT INTO bottle_movements (company_id, bottle_id, customer_id, movement_type, quantity, reference, notes, created_by) SELECT ?, ?, o.customer_id, \'returned\', ?, ?, ?, ? FROM orders o WHERE o.id = ? AND o.company_id = ?', [req.companyId, bottleId, bottleReturnCount, `DELIVERY-${deliveryId}`, notes, req.user.id, delivery.order_id, req.companyId]);
    }
    if (action === 'deliver') {
      await insert(`INSERT INTO delivery_proofs (company_id, delivery_id, otp_challenge_id, otp_verified_at, signature_storage_key, signature_content_type, signature_byte_size, signature_sha256, signature_width, signature_height, photo_storage_key, photo_content_type, photo_byte_size, photo_sha256, photo_width, photo_height, captured_at, captured_by) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(delivery_id) DO UPDATE SET otp_challenge_id = excluded.otp_challenge_id, otp_verified_at = CURRENT_TIMESTAMP, signature_storage_key = excluded.signature_storage_key, signature_content_type = excluded.signature_content_type, signature_byte_size = excluded.signature_byte_size, signature_sha256 = excluded.signature_sha256, signature_width = excluded.signature_width, signature_height = excluded.signature_height, photo_storage_key = excluded.photo_storage_key, photo_content_type = excluded.photo_content_type, photo_byte_size = excluded.photo_byte_size, photo_sha256 = excluded.photo_sha256, photo_width = excluded.photo_width, photo_height = excluded.photo_height, captured_at = excluded.captured_at, captured_by = excluded.captured_by, updated_at = CURRENT_TIMESTAMP`, [req.companyId, deliveryId, req.verifiedOtp.id, signature.storageKey, signature.contentType, signature.byteSize, signature.sha256, signature.width, signature.height, photo?.storageKey || null, photo?.contentType || null, photo?.byteSize || null, photo?.sha256 || null, photo?.width || null, photo?.height || null, req.body.capturedAt || new Date().toISOString(), req.user.id]);
    }
    await writeAudit(req, action, 'delivery', deliveryId, { status: delivery.status }, { status: nextStatus, amount, bottleReturnCount, emptyCount, rescheduledFor, notes, proofCaptured: action === 'deliver' });
    const updated = (await query('SELECT * FROM deliveries WHERE id = ? AND company_id = ?', [deliveryId, req.companyId]))[0];
    res.json(updated);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

function offlineOperationHash(operation) {
  return crypto.createHash('sha256').update(JSON.stringify({
    operationType: operation.operationType,
    deliveryId: operation.deliveryId,
    payload: operation.payload || {},
    baseUpdatedAt: operation.baseUpdatedAt || null,
    clientTimestamp: operation.clientTimestamp || null
  })).digest('hex');
}

function offlineConflict(code, message) {
  const error = new Error(message);
  error.code = code;
  error.conflict = true;
  return error;
}

async function applyOfflineDriverOperation(req, operation, syncRecordId) {
  const deliveryId = Number(operation.deliveryId);
  const action = String(operation.operationType || operation.action || '');
  const payload = operation.payload && typeof operation.payload === 'object' ? operation.payload : {};
  if (!Number.isInteger(deliveryId) || deliveryId < 1) throw new Error('deliveryId must be a positive integer.');
  if (!mobileDeliveryActions.includes(action)) throw new Error('Invalid delivery action.');

  const delivery = (await query(`
    SELECT d.*, o.customer_name, o.total_amount FROM deliveries d
    JOIN orders o ON o.id = d.order_id AND o.company_id = d.company_id
    WHERE d.id = ? AND d.company_id = ? AND d.driver_id = ?`, [deliveryId, req.companyId, req.user.id]))[0];
  if (!delivery) throw offlineConflict('ownership_conflict', 'Assigned delivery not found for this driver.');
  if (operation.baseUpdatedAt && String(delivery.updated_at) !== String(operation.baseUpdatedAt)) {
    throw offlineConflict('stale_delivery', 'The delivery changed while this operation was offline.');
  }
  if (['delivered', 'partially_delivered'].includes(delivery.status) && action !== 'reschedule') {
    throw offlineConflict('already_completed', 'This delivery is already completed.');
  }

  const notes = String(payload.notes || '').trim().slice(0, 1000);
  const amount = payload.payment?.amount === undefined ? 0 : Number(payload.payment.amount);
  const bottleReturnCount = payload.bottleReturnCount === undefined ? 0 : Number(payload.bottleReturnCount);
  const emptyCount = payload.emptyCount === undefined ? 0 : Number(payload.emptyCount);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(bottleReturnCount) || bottleReturnCount < 0 || !Number.isInteger(emptyCount) || emptyCount < 0) throw new Error('Payment and bottle counts must be valid non-negative values.');
  if (action === 'deliver' && amount > 0 && !String(payload.payment?.method || '').trim()) throw new Error('Payment method is required when collecting payment.');
  const rescheduledFor = payload.rescheduledFor || null;
  if (action === 'reschedule' && !isIsoDate(rescheduledFor)) throw new Error('A valid rescheduled date is required.');
  if (action === 'fail' && !notes) throw new Error('A reason is required when a delivery fails.');
  let signature = null; let photo = null;
  try { signature = validateProofMetadata(payload.signature, 'Signature'); photo = validateProofMetadata(payload.photo, 'Photo'); } catch (error) { throw new Error(error.message); }
  let verifiedOtp = null;
  if (action === 'deliver') {
    if (!signature) throw new Error('Signature metadata is required to complete delivery.');
    if (!payload.otpChallengeId || !(await verifyDeliveryOtp(req, delivery, payload.otpChallengeId, payload.otpCode))) throw offlineConflict('otp_required', 'A valid customer OTP is required to complete delivery.');
    verifiedOtp = req.verifiedOtp;
  }
  const bottleId = payload.bottleId ? Number(payload.bottleId) : null;
  if (bottleId && !(await query('SELECT id FROM bottles WHERE id = ? AND company_id = ? AND active = 1', [bottleId, req.companyId]))[0]) throw new Error('Bottle type not found in this company.');

  const nextStatus = action === 'start' ? 'out_for_delivery' : action === 'deliver' ? 'delivered' : 'failed';
  const startedAt = action === 'start' ? 'CURRENT_TIMESTAMP' : 'started_at';
  const completedAt = action === 'deliver' ? 'CURRENT_TIMESTAMP' : 'delivered_at';
  await update(`UPDATE deliveries SET status = ?, started_at = ${startedAt}, delivered_at = ${completedAt}, failed_reason = ?, rescheduled_for = ?, collected_amount = ?, collected_method = ?, collected_reference = ?, bottle_return_count = ?, empty_count = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ? AND driver_id = ?`, [nextStatus, action === 'fail' || action === 'reschedule' ? notes : '', action === 'reschedule' ? rescheduledFor : null, amount, amount > 0 ? String(payload.payment.method).trim().slice(0, 40) : '', amount > 0 ? String(payload.payment.reference || '').trim().slice(0, 100) : '', bottleReturnCount, emptyCount, notes, deliveryId, req.companyId, req.user.id]);
  await update('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [nextStatus, delivery.order_id, req.companyId]);
  if (amount > 0) {
    const payment = await insert('INSERT INTO payments (company_id, customer_name, amount, method, note, direction, party_type, reference, created_by, delivery_id, order_id, collected_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, delivery.customer_name, amount, payload.payment.method, notes || `Collected for delivery #${deliveryId}`, 'receipt', 'customer', payload.payment.reference || `DELIVERY-${deliveryId}`, req.user.id, deliveryId, delivery.order_id, req.user.id]);
    await writeAudit(req, 'collect', 'payment', payment.id, null, { deliveryId, amount, method: payload.payment.method, offlineSyncOperationId: syncRecordId });
  }
  if (bottleReturnCount || emptyCount) {
    await insert('INSERT INTO delivery_bottle_counts (company_id, delivery_id, bottle_id, returned_quantity, empty_quantity, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.companyId, deliveryId, bottleId, bottleReturnCount, emptyCount, notes, req.user.id]);
    if (bottleId && bottleReturnCount) await insert('INSERT INTO bottle_movements (company_id, bottle_id, customer_id, movement_type, quantity, reference, notes, created_by) SELECT ?, ?, o.customer_id, \'returned\', ?, ?, ?, ? FROM orders o WHERE o.id = ? AND o.company_id = ?', [req.companyId, bottleId, bottleReturnCount, `DELIVERY-${deliveryId}`, notes, req.user.id, delivery.order_id, req.companyId]);
  }
  if (action === 'deliver') await insert(`INSERT INTO delivery_proofs (company_id, delivery_id, otp_challenge_id, otp_verified_at, signature_storage_key, signature_content_type, signature_byte_size, signature_sha256, signature_width, signature_height, photo_storage_key, photo_content_type, photo_byte_size, photo_sha256, photo_width, photo_height, captured_at, captured_by) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(delivery_id) DO UPDATE SET otp_challenge_id = excluded.otp_challenge_id, otp_verified_at = CURRENT_TIMESTAMP, signature_storage_key = excluded.signature_storage_key, signature_content_type = excluded.signature_content_type, signature_byte_size = excluded.signature_byte_size, signature_sha256 = excluded.signature_sha256, signature_width = excluded.signature_width, signature_height = excluded.signature_height, photo_storage_key = excluded.photo_storage_key, photo_content_type = excluded.photo_content_type, photo_byte_size = excluded.photo_byte_size, photo_sha256 = excluded.photo_sha256, photo_width = excluded.photo_width, photo_height = excluded.photo_height, captured_at = excluded.captured_at, captured_by = excluded.captured_by, updated_at = CURRENT_TIMESTAMP`, [req.companyId, deliveryId, verifiedOtp.id, signature.storageKey, signature.contentType, signature.byteSize, signature.sha256, signature.width, signature.height, photo?.storageKey || null, photo?.contentType || null, photo?.byteSize || null, photo?.sha256 || null, photo?.width || null, photo?.height || null, payload.capturedAt || new Date().toISOString(), req.user.id]);
  const result = (await query('SELECT * FROM deliveries WHERE id = ? AND company_id = ?', [deliveryId, req.companyId]))[0];
  await writeAudit(req, `offline_${action}`, 'delivery', deliveryId, { status: delivery.status }, { status: nextStatus, syncOperationId: syncRecordId });
  return result;
}

app.post('/api/driver/offline-sync', requireRole(...mobileDriverRoles), async (req, res) => {
  try {
    const operations = req.body?.operations;
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > 100) return res.status(400).json({ message: 'operations must contain between 1 and 100 items.' });
    const results = [];
    for (const rawOperation of operations) {
      const operation = rawOperation && typeof rawOperation === 'object' ? rawOperation : {};
      const idempotencyKey = String(operation.idempotencyKey || '').trim();
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) { results.push({ idempotencyKey, status: 'failed', message: 'A valid idempotencyKey is required.' }); continue; }
      const requestHash = offlineOperationHash(operation || {});
      let record = (await query('SELECT * FROM offline_sync_operations WHERE company_id = ? AND driver_id = ? AND idempotency_key = ?', [req.companyId, req.user.id, idempotencyKey]))[0];
      if (record) {
        if (record.request_hash !== requestHash) {
          results.push({ idempotencyKey, status: 'conflict', code: 'idempotency_key_reused', message: 'The idempotency key was already used with a different operation.', operationId: record.id });
          continue;
        }
        results.push({ idempotencyKey, operationId: record.id, status: record.status, result: record.result ? JSON.parse(record.result) : null, code: record.conflict_code || undefined, message: record.conflict_message || undefined });
        continue;
      }
      try {
        const created = await insert('INSERT INTO offline_sync_operations (company_id, driver_id, idempotency_key, operation_type, entity_id, request_hash, payload, client_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, req.user.id, idempotencyKey, String(operation.operationType || operation.action || ''), Number(operation.deliveryId) || null, requestHash, JSON.stringify(operation.payload || {}), operation.clientTimestamp || null]);
        record = { id: created.id };
      } catch (error) {
        record = (await query('SELECT * FROM offline_sync_operations WHERE company_id = ? AND driver_id = ? AND idempotency_key = ?', [req.companyId, req.user.id, idempotencyKey]))[0];
        if (!record) throw error;
        if (record.request_hash !== requestHash) { results.push({ idempotencyKey, status: 'conflict', code: 'idempotency_key_reused', message: 'The idempotency key was already used with a different operation.', operationId: record.id }); continue; }
      }
      try {
        const applied = await applyOfflineDriverOperation(req, operation, record.id);
        await update('UPDATE offline_sync_operations SET status = \'applied\', result = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(applied), record.id]);
        await writeAudit(req, 'offline_sync_applied', 'offline_sync_operation', record.id, null, { deliveryId: operation.deliveryId, action: operation.operationType || operation.action });
        results.push({ idempotencyKey, operationId: record.id, status: 'applied', result: applied });
      } catch (error) {
        const status = error.conflict ? 'conflict' : 'failed';
        await update('UPDATE offline_sync_operations SET status = ?, conflict_code = ?, conflict_message = ?, result = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?', [status, error.code || null, error.message, JSON.stringify({ message: error.message }), record.id]);
        await writeAudit(req, `offline_sync_${status}`, 'offline_sync_operation', record.id, null, { deliveryId: operation.deliveryId, code: error.code || 'validation_error', message: error.message });
        results.push({ idempotencyKey, operationId: record.id, status, code: error.code || 'validation_error', message: error.message });
      }
    }
    const hasConflict = results.some((item) => item.status === 'conflict');
    const hasApplied = results.some((item) => item.status === 'applied');
    res.status(hasConflict ? (hasApplied ? 207 : 409) : 200).json({ success: !hasConflict, results });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/driver/offline-sync/status', requireRole(...mobileDriverRoles), async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '50', 10) || 50));
    const rows = await query('SELECT id AS operationId, idempotency_key AS idempotencyKey, operation_type AS operationType, entity_id AS deliveryId, status, result, conflict_code AS conflictCode, conflict_message AS conflictMessage, client_timestamp AS clientTimestamp, created_at AS createdAt, processed_at AS processedAt FROM offline_sync_operations WHERE company_id = ? AND driver_id = ? ORDER BY id DESC LIMIT ?', [req.companyId, req.user.id, limit]);
    res.json({ operations: rows.map((row) => ({ ...row, result: row.result ? JSON.parse(row.result) : null })) });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

const auditLogRoles = ['super_admin', 'company_admin', 'manager', 'accountant'];

function parseAuditFilters(queryParams = {}) {
  const from = parseExportDate(queryParams.from, 'from');
  const to = parseExportDate(queryParams.to, 'to');
  if (from && to && from > to) throw new Error('from must be on or before to.');
  const action = queryParams.action === undefined || queryParams.action === '' ? null : String(queryParams.action).trim();
  const entityType = queryParams.entityType === undefined || queryParams.entityType === '' ? null : String(queryParams.entityType).trim();
  if (action && !/^[A-Za-z0-9_.:-]{1,100}$/.test(action)) throw new Error('action must contain only letters, numbers, underscores, dots, colons, or hyphens.');
  if (entityType && !/^[A-Za-z0-9_.:-]{1,100}$/.test(entityType)) throw new Error('entityType must contain only letters, numbers, underscores, dots, or hyphens.');
  let userId = null;
  if (queryParams.userId !== undefined && queryParams.userId !== '') {
    userId = Number(queryParams.userId);
    if (!Number.isInteger(userId) || userId < 1) throw new Error('userId must be a positive integer.');
  }
  const user = queryParams.user === undefined || queryParams.user === '' ? null : String(queryParams.user).trim();
  if (user && (user.length > 100 || /[%_]/.test(user))) throw new Error('user must be at most 100 characters and cannot contain wildcard characters.');
  const page = Math.max(1, Math.min(100000, Number.parseInt(queryParams.page || '1', 10)) || 1);
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(queryParams.pageSize || '50', 10)) || 50);
  return { from, to, action, entityType, userId, user, page, pageSize };
}

function auditWhere(companyId, filters) {
  const clauses = ['a.company_id = ?'];
  const params = [companyId];
  if (filters.from) { clauses.push('a.created_at >= ?'); params.push(filters.from); }
  if (filters.to) { clauses.push("a.created_at < date(?, '+1 day')"); params.push(filters.to); }
  if (filters.action) { clauses.push('a.action = ?'); params.push(filters.action); }
  if (filters.entityType) { clauses.push('a.entity_type = ?'); params.push(filters.entityType); }
  if (filters.userId) { clauses.push('a.user_id = ?'); params.push(filters.userId); }
  if (filters.user) {
    clauses.push('a.user_id IN (SELECT id FROM users WHERE company_id = ? AND (name LIKE ? OR username LIKE ?))');
    params.push(companyId, `%${filters.user}%`, `%${filters.user}%`);
  }
  return { sql: clauses.join(' AND '), params };
}

async function getAuditLogs(companyId, filters, bounded = true) {
  const where = auditWhere(companyId, filters);
  const countRows = await query(`SELECT COUNT(*) AS total FROM audit_logs a WHERE ${where.sql}`, where.params);
  const total = Number(countRows[0]?.total || 0);
  const limit = bounded ? filters.pageSize : Math.min(total, 5000);
  const offset = bounded ? (filters.page - 1) * filters.pageSize : 0;
  const logs = await query(`
    SELECT a.id, a.company_id, a.user_id, a.action, a.entity_type, a.entity_id,
           a.previous_value, a.new_value, a.created_at, u.name AS user_name,
           u.username AS user_username
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id AND u.company_id = a.company_id
    WHERE ${where.sql}
    ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?
  `, [...where.params, limit, offset]);
  return { logs, total, page: filters.page, pageSize: filters.pageSize, totalPages: Math.max(1, Math.ceil(total / filters.pageSize)) };
}

app.get('/api/audit-logs', requireRole(...auditLogRoles), async (req, res) => {
  try {
    if (!req.companyId) return res.status(400).json({ message: 'Select a company before viewing audit logs.' });
    const filters = parseAuditFilters(req.query);
    res.json(await getAuditLogs(req.companyId, filters));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.get('/api/audit-logs/export', requireRole(...auditLogRoles), async (req, res) => {
  try {
    if (!req.companyId) return res.status(400).json({ message: 'Select a company before exporting audit logs.' });
    const filters = parseAuditFilters(req.query);
    const result = await getAuditLogs(req.companyId, { ...filters, page: 1, pageSize: 5000 }, false);
    await writeAudit(req, 'export_csv', 'audit_logs', null, null, { filters: { from: filters.from, to: filters.to, action: filters.action, entityType: filters.entityType, user: filters.user, userId: filters.userId }, rowCount: result.logs.length });
    res.status(200).set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="audit-logs-export.csv"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    writeCsv(res, ['id', 'company_id', 'user_id', 'user_name', 'user_username', 'action', 'entity_type', 'entity_id', 'previous_value', 'new_value', 'created_at'], result.logs);
    res.end();
  } catch (error) {
    if (!res.headersSent) res.status(400).json({ message: error.message }); else res.end();
  }
});

const creditReadRoles = ['super_admin', 'company_admin', 'manager', 'accountant', 'sales_staff', 'staff'];
const creditManageRoles = ['super_admin', 'company_admin', 'manager', 'accountant'];
const pricingReadRoles = ['super_admin', 'company_admin', 'manager', 'accountant', 'sales_staff', 'staff'];
const pricingManageRoles = ['super_admin', 'company_admin', 'manager'];
const commissionReadRoles = ['super_admin', 'company_admin', 'manager', 'accountant', 'sales_staff', 'staff'];
const commissionManageRoles = ['super_admin', 'company_admin', 'manager', 'accountant'];

function positiveNumber(value, field, allowZero = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) throw new Error(`${field} must be ${allowZero ? 'a non-negative' : 'greater than zero'} number.`);
  return number;
}

async function getCreditSnapshot(companyId, customerId) {
  const customer = (await query('SELECT id, name FROM customers WHERE id = ? AND company_id = ?', [customerId, companyId]))[0];
  if (!customer) return null;
  const policy = (await query('SELECT * FROM credit_policies WHERE company_id = ?', [companyId]))[0] || { default_limit: 0, default_terms_days: 0, overdue_grace_days: 0, block_on_overdue: 1, require_approval_above: 0 };
  const account = (await query('SELECT * FROM customer_credit_accounts WHERE company_id = ? AND customer_id = ?', [companyId, customerId]))[0] || { credit_limit: policy.default_limit, terms_days: policy.default_terms_days, status: 'active' };
  const rows = await query(`SELECT COALESCE(SUM(CASE WHEN entry_type IN ('invoice','debit') THEN amount WHEN entry_type IN ('payment','credit','writeoff') THEN -amount ELSE 0 END), 0) AS outstanding,
    COALESCE(SUM(CASE WHEN entry_type IN ('invoice','debit') AND due_date < date('now') THEN amount ELSE 0 END), 0) AS overdue
    FROM credit_ledger WHERE company_id = ? AND customer_id = ?`, [companyId, customerId]);
  const block = (await query('SELECT * FROM credit_blocks WHERE company_id = ? AND customer_id = ? AND active = 1 ORDER BY id DESC LIMIT 1', [companyId, customerId]))[0] || null;
  const outstanding = Number(rows[0]?.outstanding || 0);
  const overdue = Number(rows[0]?.overdue || 0);
  return { customer, policy, account, outstanding, overdue, available: Math.max(0, Number(account.credit_limit || 0) - outstanding), blocked: account.status !== 'active' || Boolean(block) || (Number(policy.block_on_overdue) === 1 && overdue > 0), block };
}

async function assertCreditAllowed(req, customerId, amount) {
  if (!customerId) return null;
  const snapshot = await getCreditSnapshot(req.companyId, customerId);
  if (!snapshot) throw new Error('Customer not found in this company.');
  const policyThreshold = Number(snapshot.policy.require_approval_above || 0);
  if (snapshot.blocked) { const error = new Error('Credit is blocked for this customer because the account is on hold or overdue.'); error.code = 'credit_blocked'; throw error; }
  if (Number(snapshot.account.credit_limit || 0) > 0 && snapshot.outstanding + amount > Number(snapshot.account.credit_limit)) { const error = new Error('Sale exceeds the customer credit limit.'); error.code = 'credit_limit_exceeded'; throw error; }
  return { snapshot, approvalRequired: policyThreshold > 0 && amount > policyThreshold };
}

async function resolveSalePrice(companyId, customerId, productId, quantity) {
  const product = (await query('SELECT * FROM products WHERE id = ? AND company_id = ?', [productId, companyId]))[0];
  if (!product) return null;
  const assigned = customerId ? (await query(`SELECT pli.unit_price, pli.max_discount_percent FROM customer_price_lists cpl JOIN price_list_items pli ON pli.price_list_id = cpl.price_list_id AND pli.company_id = cpl.company_id WHERE cpl.company_id = ? AND cpl.customer_id = ? AND pli.product_id = ? AND pli.min_quantity <= ? AND (pli.max_discount_percent >= 0) ORDER BY pli.min_quantity DESC LIMIT 1`, [companyId, customerId, productId, quantity]))[0] : null;
  return { product, unitPrice: Number(assigned?.unit_price ?? product.sale_price), maxDiscountPercent: Number(assigned?.max_discount_percent || 0), priceListApplied: Boolean(assigned) };
}

async function createCommissionLineForDelivery(companyId, delivery, driverId, createdBy) {
  if (!driverId) return;
  const rule = (await query(`SELECT * FROM commission_rules WHERE company_id = ? AND active = 1 AND role = 'driver' ORDER BY id LIMIT 1`, [companyId]))[0];
  if (!rule) return;
  const order = (await query('SELECT total_amount FROM orders WHERE id = ? AND company_id = ?', [delivery.order_id, companyId]))[0];
  const basis = Number(order?.total_amount || 0);
  const amount = Math.max(0, basis * Number(rule.rate_percent || 0) / 100);
  const period = new Date().toISOString().slice(0, 10);
  const start = period.slice(0, 7) + '-01';
  const statement = (await query('SELECT id FROM commission_statements WHERE company_id = ? AND beneficiary_id = ? AND period_start = ? AND period_end = ?', [companyId, driverId, start, period]))[0];
  const statementId = statement?.id || (await insert('INSERT INTO commission_statements (company_id, beneficiary_id, period_start, period_end, created_by) VALUES (?, ?, ?, ?, ?)', [companyId, driverId, start, period, createdBy || null])).id;
  await insert('INSERT OR IGNORE INTO commission_lines (company_id, statement_id, delivery_id, rule_id, basis_amount, rate_percent, commission_amount) VALUES (?, ?, ?, ?, ?, ?, ?)', [companyId, statementId, delivery.id, rule.id, basis, rule.rate_percent, amount]);
  await update('UPDATE commission_statements SET gross_amount = (SELECT COALESCE(SUM(commission_amount),0) FROM commission_lines WHERE statement_id = ?), net_amount = (SELECT COALESCE(SUM(commission_amount),0) FROM commission_lines WHERE statement_id = ?) WHERE id = ? AND company_id = ?', [statementId, statementId, statementId, companyId]);
}

async function createCommissionLineForSale(companyId, sale, salesmanId) {
  if (!salesmanId) return;
  const rule = (await query(`SELECT * FROM commission_rules WHERE company_id = ? AND active = 1 AND role = 'salesman' ORDER BY id LIMIT 1`, [companyId]))[0];
  if (!rule) return;
  const basis = rule.basis === 'gross_sales' ? Number(sale.total_amount || 0) : Number(sale.total_amount || 0) - Number(sale.discount || 0);
  const amount = Math.max(0, basis * Number(rule.rate_percent || 0) / 100);
  const period = String(sale.created_at || new Date().toISOString()).slice(0, 10);
  const statement = (await query('SELECT * FROM commission_statements WHERE company_id = ? AND beneficiary_id = ? AND period_start = ? AND period_end = ?', [companyId, salesmanId, period.slice(0, 7) + '-01', period]))[0] || null;
  let statementId = statement?.id;
  if (!statementId) statementId = (await insert('INSERT INTO commission_statements (company_id, beneficiary_id, period_start, period_end, created_by) VALUES (?, ?, ?, ?, ?)', [companyId, salesmanId, period.slice(0, 7) + '-01', period, sale.created_by || null])).id;
  const line = await insert('INSERT OR IGNORE INTO commission_lines (company_id, statement_id, sale_id, rule_id, basis_amount, rate_percent, commission_amount) VALUES (?, ?, ?, ?, ?, ?, ?)', [companyId, statementId, sale.id, rule.id, basis, rule.rate_percent, amount]);
  if (line.id) await update('UPDATE commission_statements SET gross_amount = (SELECT COALESCE(SUM(commission_amount),0) FROM commission_lines WHERE statement_id = ?), net_amount = (SELECT COALESCE(SUM(commission_amount),0) FROM commission_lines WHERE statement_id = ?) WHERE id = ? AND company_id = ?', [statementId, statementId, statementId, companyId]);
}

app.get('/api/credit/customers/:customerId', requireRole(...creditReadRoles), async (req, res) => {
  try { const snapshot = await getCreditSnapshot(req.companyId, Number(req.params.customerId)); if (!snapshot) return res.status(404).json({ message: 'Customer not found.' }); res.json(snapshot); } catch (error) { res.status(500).json({ message: error.message }); }
});
app.get('/api/credit/overview', requireRole(...creditReadRoles), async (req, res) => {
  try { const rows = await query(`SELECT c.id, c.name, COALESCE(a.credit_limit, p.default_limit, 0) AS credit_limit, COALESCE(SUM(CASE WHEN l.entry_type IN ('invoice','debit') THEN l.amount WHEN l.entry_type IN ('payment','credit','writeoff') THEN -l.amount ELSE 0 END),0) AS outstanding, COALESCE(SUM(CASE WHEN l.entry_type IN ('invoice','debit') AND l.due_date < date('now') THEN l.amount ELSE 0 END),0) AS overdue, a.status FROM customers c LEFT JOIN credit_policies p ON p.company_id = c.company_id LEFT JOIN customer_credit_accounts a ON a.company_id = c.company_id AND a.customer_id = c.id LEFT JOIN credit_ledger l ON l.company_id = c.company_id AND l.customer_id = c.id WHERE c.company_id = ? GROUP BY c.id ORDER BY overdue DESC, outstanding DESC`, [req.companyId]); res.json(rows); } catch (error) { res.status(500).json({ message: error.message }); }
});
app.put('/api/credit/policy', requireRole(...creditManageRoles), async (req, res) => {
  try { const values = { defaultLimit: positiveNumber(req.body?.defaultLimit || 0, 'defaultLimit', true), defaultTermsDays: Math.floor(positiveNumber(req.body?.defaultTermsDays || 0, 'defaultTermsDays', true)), overdueGraceDays: Math.floor(positiveNumber(req.body?.overdueGraceDays || 0, 'overdueGraceDays', true)), blockOnOverdue: req.body?.blockOnOverdue === false ? 0 : 1, requireApprovalAbove: positiveNumber(req.body?.requireApprovalAbove || 0, 'requireApprovalAbove', true) }; const current = (await query('SELECT * FROM credit_policies WHERE company_id = ?', [req.companyId]))[0] || null; await update(`INSERT INTO credit_policies (company_id, default_limit, default_terms_days, overdue_grace_days, block_on_overdue, require_approval_above, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_id) DO UPDATE SET default_limit=excluded.default_limit, default_terms_days=excluded.default_terms_days, overdue_grace_days=excluded.overdue_grace_days, block_on_overdue=excluded.block_on_overdue, require_approval_above=excluded.require_approval_above, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`, [req.companyId, values.defaultLimit, values.defaultTermsDays, values.overdueGraceDays, values.blockOnOverdue, values.requireApprovalAbove, req.user.id]); await writeAudit(req, 'update', 'credit_policy', req.companyId, current, values); res.json((await query('SELECT * FROM credit_policies WHERE company_id = ?', [req.companyId]))[0]); } catch (error) { res.status(400).json({ message: error.message }); }
});
app.put('/api/credit/customers/:customerId', requireRole(...creditManageRoles), async (req, res) => {
  try { const customerId = Number(req.params.customerId); if (!(await query('SELECT id FROM customers WHERE id = ? AND company_id = ?', [customerId, req.companyId]))[0]) return res.status(404).json({ message: 'Customer not found.' }); const limit = positiveNumber(req.body?.creditLimit || 0, 'creditLimit', true); const terms = Math.floor(positiveNumber(req.body?.termsDays || 0, 'termsDays', true)); const status = ['active','hold','closed'].includes(req.body?.status) ? req.body.status : 'active'; await update(`INSERT INTO customer_credit_accounts (company_id, customer_id, credit_limit, terms_days, status) VALUES (?, ?, ?, ?, ?) ON CONFLICT(company_id, customer_id) DO UPDATE SET credit_limit=excluded.credit_limit, terms_days=excluded.terms_days, status=excluded.status, updated_at=CURRENT_TIMESTAMP`, [req.companyId, customerId, limit, terms, status]); await writeAudit(req, 'update', 'customer_credit_account', customerId, null, { creditLimit: limit, termsDays: terms, status }); res.json(await getCreditSnapshot(req.companyId, customerId)); } catch (error) { res.status(400).json({ message: error.message }); }
});
app.post('/api/credit/blocks', requireRole(...creditManageRoles), async (req, res) => { try { const customerId = Number(req.body?.customerId); const reason = String(req.body?.reason || '').trim(); if (!customerId || !reason) return res.status(400).json({ message: 'customerId and reason are required.' }); const result = await insert('INSERT INTO credit_blocks (company_id, customer_id, reason, created_by) SELECT ?, id, ?, ? FROM customers WHERE id = ? AND company_id = ?', [req.companyId, reason, req.user.id, customerId, req.companyId]); if (!result.id) return res.status(404).json({ message: 'Customer not found.' }); await writeAudit(req, 'create', 'credit_block', result.id, null, { customerId, reason }); res.status(201).json(await getCreditSnapshot(req.companyId, customerId)); } catch (error) { res.status(400).json({ message: error.message }); } });
app.post('/api/credit/blocks/:id/release', requireRole(...creditManageRoles), async (req, res) => { try { const block = (await query('SELECT * FROM credit_blocks WHERE id = ? AND company_id = ? AND active = 1', [Number(req.params.id), req.companyId]))[0]; if (!block) return res.status(404).json({ message: 'Active credit block not found.' }); await update('UPDATE credit_blocks SET active = 0, released_by = ?, released_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [req.user.id, block.id, req.companyId]); await writeAudit(req, 'release', 'credit_block', block.id, block, { active: 0 }); res.json(await getCreditSnapshot(req.companyId, block.customer_id)); } catch (error) { res.status(500).json({ message: error.message }); } });

app.get('/api/price-lists', requireRole(...pricingReadRoles), async (req, res) => { try { const lists = await query('SELECT pl.*, COUNT(pli.id) AS item_count FROM price_lists pl LEFT JOIN price_list_items pli ON pli.price_list_id = pl.id AND pli.company_id = pl.company_id WHERE pl.company_id = ? GROUP BY pl.id ORDER BY pl.name', [req.companyId]); res.json(lists); } catch (error) { res.status(500).json({ message: error.message }); } });
app.post('/api/price-lists', requireRole(...pricingManageRoles), async (req, res) => { try { const name = String(req.body?.name || '').trim(); if (!name) return res.status(400).json({ message: 'Price list name is required.' }); const result = await insert('INSERT INTO price_lists (company_id, name, currency, valid_from, valid_to, created_by) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, name, String(req.body?.currency || 'PKR'), req.body?.validFrom || null, req.body?.validTo || null, req.user.id]); await writeAudit(req, 'create', 'price_list', result.id, null, { name }); res.status(201).json((await query('SELECT * FROM price_lists WHERE id = ? AND company_id = ?', [result.id, req.companyId]))[0]); } catch (error) { res.status(400).json({ message: error.message }); } });
app.post('/api/price-lists/:id/items', requireRole(...pricingManageRoles), async (req, res) => { try { const listId = Number(req.params.id); const productId = Number(req.body?.productId); const unitPrice = positiveNumber(req.body?.unitPrice, 'unitPrice', true); const minQuantity = positiveNumber(req.body?.minQuantity || 1, 'minQuantity'); if (!(await query('SELECT id FROM price_lists WHERE id = ? AND company_id = ?', [listId, req.companyId]))[0] || !(await query('SELECT id FROM products WHERE id = ? AND company_id = ?', [productId, req.companyId]))[0]) return res.status(404).json({ message: 'Price list or product not found in this company.' }); const result = await insert('INSERT INTO price_list_items (company_id, price_list_id, product_id, unit_price, min_quantity, max_discount_percent) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, listId, productId, unitPrice, minQuantity, positiveNumber(req.body?.maxDiscountPercent || 0, 'maxDiscountPercent', true)]); await writeAudit(req, 'create', 'price_list_item', result.id, null, req.body); res.status(201).json((await query('SELECT * FROM price_list_items WHERE id = ? AND company_id = ?', [result.id, req.companyId]))[0]); } catch (error) { res.status(400).json({ message: error.message }); } });
app.put('/api/customers/:customerId/price-list', requireRole(...pricingManageRoles), async (req, res) => { try { const customerId = Number(req.params.customerId); const listId = Number(req.body?.priceListId); if (!(await query('SELECT id FROM customers WHERE id = ? AND company_id = ?', [customerId, req.companyId]))[0] || !(await query('SELECT id FROM price_lists WHERE id = ? AND company_id = ? AND active = 1', [listId, req.companyId]))[0]) return res.status(404).json({ message: 'Customer or price list not found in this company.' }); await update('INSERT INTO customer_price_lists (company_id, customer_id, price_list_id, assigned_by) VALUES (?, ?, ?, ?) ON CONFLICT(company_id, customer_id) DO UPDATE SET price_list_id=excluded.price_list_id, assigned_by=excluded.assigned_by, assigned_at=CURRENT_TIMESTAMP', [req.companyId, customerId, listId, req.user.id]); await writeAudit(req, 'assign', 'customer_price_list', customerId, null, { priceListId: listId }); res.json({ success: true }); } catch (error) { res.status(400).json({ message: error.message }); } });
app.get('/api/commission-rules', requireRole(...commissionReadRoles), async (req, res) => { try { res.json(await query('SELECT * FROM commission_rules WHERE company_id = ? ORDER BY active DESC, name', [req.companyId])); } catch (error) { res.status(500).json({ message: error.message }); } });
app.post('/api/commission-rules', requireRole(...commissionManageRoles), async (req, res) => { try { const name = String(req.body?.name || '').trim(); const role = ['salesman','driver'].includes(req.body?.role) ? req.body.role : 'salesman'; const basis = ['gross_sales','net_sales','collected_cash'].includes(req.body?.basis) ? req.body.basis : 'net_sales'; const rate = positiveNumber(req.body?.ratePercent || 0, 'ratePercent', true); if (!name) return res.status(400).json({ message: 'Rule name is required.' }); const result = await insert('INSERT INTO commission_rules (company_id, name, role, basis, rate_percent, created_by) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, name, role, basis, rate, req.user.id]); await writeAudit(req, 'create', 'commission_rule', result.id, null, { name, role, basis, ratePercent: rate }); res.status(201).json((await query('SELECT * FROM commission_rules WHERE id = ? AND company_id = ?', [result.id, req.companyId]))[0]); } catch (error) { res.status(400).json({ message: error.message }); } });
app.patch('/api/commission-rules/:id', requireRole(...commissionManageRoles), async (req, res) => { try { const current = (await query('SELECT * FROM commission_rules WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]; if (!current) return res.status(404).json({ message: 'Commission rule not found.' }); const active = req.body?.active === undefined ? current.active : (req.body.active ? 1 : 0); const rate = req.body?.ratePercent === undefined ? current.rate_percent : positiveNumber(req.body.ratePercent, 'ratePercent', true); await update('UPDATE commission_rules SET rate_percent = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [rate, active, current.id, req.companyId]); await writeAudit(req, 'update', 'commission_rule', current.id, current, { ratePercent: rate, active }); res.json((await query('SELECT * FROM commission_rules WHERE id = ? AND company_id = ?', [current.id, req.companyId]))[0]); } catch (error) { res.status(400).json({ message: error.message }); } });
app.get('/api/discount-approvals', requireRole(...creditReadRoles), async (req, res) => { try { res.json(await query(`SELECT da.*, c.name AS customer_name, ru.name AS requested_by_name, au.name AS approved_by_name FROM discount_approvals da LEFT JOIN customers c ON c.id = da.customer_id AND c.company_id = da.company_id LEFT JOIN users ru ON ru.id = da.requested_by AND ru.company_id = da.company_id LEFT JOIN users au ON au.id = da.approved_by AND au.company_id = da.company_id WHERE da.company_id = ? ORDER BY da.created_at DESC`, [req.companyId])); } catch (error) { res.status(500).json({ message: error.message }); } });
app.post('/api/discount-approvals', requireRole(...pricingManageRoles), async (req, res) => { try { const customerId = req.body?.customerId ? Number(req.body.customerId) : null; const before = positiveNumber(req.body?.amountBefore, 'amountBefore'); const discount = positiveNumber(req.body?.discountPercent || 0, 'discountPercent', true); if (discount > 100) return res.status(400).json({ message: 'discountPercent must be between 0 and 100.' }); const customer = customerId ? (await query('SELECT id FROM customers WHERE id = ? AND company_id = ?', [customerId, req.companyId]))[0] : null; if (customerId && !customer) return res.status(404).json({ message: 'Customer not found in this company.' }); const result = await insert('INSERT INTO discount_approvals (company_id, customer_id, requested_by, discount_percent, amount_before, amount_after, reason) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.companyId, customerId, req.user.id, discount, before, before * (1 - discount / 100), String(req.body?.reason || '').trim()]); await writeAudit(req, 'create', 'discount_approval', result.id, null, req.body); res.status(201).json((await query('SELECT * FROM discount_approvals WHERE id = ? AND company_id = ?', [result.id, req.companyId]))[0]); } catch (error) { res.status(400).json({ message: error.message }); } });
app.post('/api/discount-approvals/:id/decision', requireRole(...creditManageRoles), async (req, res) => { try { const approval = (await query('SELECT * FROM discount_approvals WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]; if (!approval) return res.status(404).json({ message: 'Discount approval not found.' }); const status = ['approved','rejected'].includes(req.body?.status) ? req.body.status : null; if (!status) return res.status(400).json({ message: 'Decision must be approved or rejected.' }); await update('UPDATE discount_approvals SET status = ?, approved_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ? AND status = \'pending\'', [status, req.user.id, approval.id, req.companyId]); await writeAudit(req, status, 'discount_approval', approval.id, approval, { status }); res.json((await query('SELECT * FROM discount_approvals WHERE id = ? AND company_id = ?', [approval.id, req.companyId]))[0]); } catch (error) { res.status(400).json({ message: error.message }); } });
app.get('/api/commissions/statements', requireRole(...commissionReadRoles), async (req, res) => { try { const from = req.query.from || '0000-01-01'; const to = req.query.to || '9999-12-31'; const rows = await query(`SELECT cs.*, u.name AS beneficiary_name, COALESCE(SUM(cl.commission_amount),0) AS calculated_amount FROM commission_statements cs JOIN users u ON u.id = cs.beneficiary_id AND u.company_id = cs.company_id LEFT JOIN commission_lines cl ON cl.statement_id = cs.id AND cl.company_id = cs.company_id WHERE cs.company_id = ? AND cs.period_start >= ? AND cs.period_end <= ? GROUP BY cs.id ORDER BY cs.period_end DESC`, [req.companyId, from, to]); res.json(rows); } catch (error) { res.status(500).json({ message: error.message }); } });
app.get('/api/commissions/export', requireRole(...commissionReadRoles), async (req, res) => { try { const rows = await query(`SELECT cs.id, u.name AS beneficiary_name, cs.period_start, cs.period_end, cs.gross_amount, cs.deductions, cs.net_amount, cs.status, cs.settled_at FROM commission_statements cs JOIN users u ON u.id = cs.beneficiary_id AND u.company_id = cs.company_id WHERE cs.company_id = ? ORDER BY cs.period_end DESC`, [req.companyId]); res.status(200).set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="commission-statements.csv"' }); writeCsv(res, ['id','beneficiary_name','period_start','period_end','gross_amount','deductions','net_amount','status','settled_at'], rows); res.end(); } catch (error) { if (!res.headersSent) res.status(500).json({ message: error.message }); else res.end(); } });
app.post('/api/commissions/:id/settle', requireRole(...commissionManageRoles), async (req, res) => { try { const statement = (await query('SELECT * FROM commission_statements WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]; if (!statement) return res.status(404).json({ message: 'Commission statement not found.' }); if (statement.status === 'settled' || statement.status === 'void') return res.status(400).json({ message: 'Statement cannot be settled in its current status.' }); const amount = positiveNumber(req.body?.amount ?? statement.net_amount, 'amount', true); const result = await insert('INSERT INTO commission_settlements (company_id, statement_id, amount, method, reference, settled_by) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, statement.id, amount, String(req.body?.method || 'manual'), String(req.body?.reference || ''), req.user.id]); await update('UPDATE commission_statements SET status = \'settled\', settled_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [statement.id, req.companyId]); await writeAudit(req, 'settle', 'commission_statement', statement.id, statement, { amount }); res.status(201).json((await query('SELECT * FROM commission_statements WHERE id = ? AND company_id = ?', [statement.id, req.companyId]))[0]); } catch (error) { res.status(400).json({ message: error.message }); } });

async function getSaleInvoice(saleId, companyId) {
  const sales = await query(`
    SELECT s.id, s.company_id, s.customer_name, s.total_amount, s.invoice_number, s.status,
      s.discount, s.tax, s.due_date, s.created_at,
      c.name AS company_name, c.logo AS company_logo, c.phone AS company_phone,
      c.email AS company_email, c.address AS company_address, c.country AS company_country,
      cu.phone AS customer_phone, cu.address AS customer_address,
      creator.name AS created_by_name
    FROM sales s
    JOIN companies c ON c.id = s.company_id
    LEFT JOIN customers cu ON cu.company_id = s.company_id AND cu.name = s.customer_name
    LEFT JOIN users creator ON creator.id = s.created_by AND creator.company_id = s.company_id
    WHERE s.id = ? AND s.company_id = ?
    LIMIT 1
  `, [saleId, companyId]);
  const sale = sales[0];
  if (!sale) return null;
  sale.items = await query(`
    SELECT si.id, si.product_id, si.quantity, si.unit_price, si.total_price,
      p.name AS product_name, p.unit
    FROM sale_items si
    JOIN products p ON p.id = si.product_id AND p.company_id = si.company_id
    WHERE si.sale_id = ? AND si.company_id = ?
    ORDER BY si.id
  `, [saleId, companyId]);
  sale.invoice_number = sale.invoice_number || `INV-${String(sale.id).padStart(6, '0')}`;
  return sale;
}

app.get('/api/sales/:id/invoice', async (req, res) => {
  try {
    const saleId = Number(req.params.id);
    if (!Number.isInteger(saleId) || saleId <= 0) return res.status(400).json({ message: 'Invalid sale id.' });
    const action = String(req.query.action || 'view');
    if (!['view', 'print'].includes(action)) return res.status(400).json({ message: 'Invalid invoice action.' });
    const invoice = await getSaleInvoice(saleId, req.companyId);
    if (!invoice) return res.status(404).json({ message: 'Invoice not found.' });
    await writeAudit(req, action === 'print' ? 'print_invoice' : 'view_invoice', 'sale_invoice', saleId, null, {
      invoiceNumber: invoice.invoice_number,
      output: action === 'print' ? 'browser_print_save_as_pdf' : 'preview'
    });
    res.json({ invoice });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/sales', async (req, res) => {
  try {
    const sales = await query(`
      SELECT s.*, COUNT(si.id) AS item_count
      FROM sales s
      LEFT JOIN sale_items si ON si.sale_id = s.id AND si.company_id = s.company_id
      WHERE s.company_id = ?
      GROUP BY s.id
      ORDER BY s.id DESC
    `, [req.companyId]);
    res.json(sales);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/sales', async (req, res) => {
  try {
    const { customerName, customerId, salesmanId, items, discountPercent = 0, discountReason = '' } = req.body;

    if (!customerName || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Customer name and at least one product are required.' });
    }

    const selectedCustomer = customerId ? await getCustomer(req.companyId, customerId) : (await query('SELECT * FROM customers WHERE company_id = ? AND name = ? LIMIT 1', [req.companyId, String(customerName).trim()]))[0] || null;
    if (customerId && !selectedCustomer) return res.status(404).json({ message: 'Customer not found in this company.' });
    const productRecords = [];
    let amountBeforeDiscount = 0;

    for (const item of items) {
      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ message: 'Each quantity must be a positive whole number.' });
      const pricing = await resolveSalePrice(req.companyId, selectedCustomer?.id || null, Number(item.productId), qty);
      if (!pricing) return res.status(404).json({ message: `Product not found: ${item.productId}` });
      if (pricing.product.stock < qty) return res.status(400).json({ message: `Not enough stock for ${pricing.product.name}` });
      const lineTotal = pricing.unitPrice * qty;
      amountBeforeDiscount += lineTotal;
      productRecords.push({ product: pricing.product, quantity: qty, unitPrice: pricing.unitPrice, total: lineTotal, maxDiscountPercent: pricing.maxDiscountPercent });
    }
    const normalizedDiscount = Number(discountPercent || 0);
    if (!Number.isFinite(normalizedDiscount) || normalizedDiscount < 0 || normalizedDiscount > 100) return res.status(400).json({ message: 'discountPercent must be between 0 and 100.' });
    const discountAmount = amountBeforeDiscount * normalizedDiscount / 100;
    const totalAmount = amountBeforeDiscount - discountAmount;
    let creditCheck = null;
    try { creditCheck = await assertCreditAllowed(req, selectedCustomer?.id, totalAmount); } catch (error) { return res.status(error.code === 'credit_blocked' || error.code === 'credit_limit_exceeded' ? 409 : 400).json({ code: error.code, message: error.message }); }
    if (normalizedDiscount > 0 && creditCheck?.snapshot?.policy?.require_approval_above > 0 && normalizedDiscount > 0) return res.status(409).json({ code: 'discount_approval_required', message: 'This discount requires approval before the sale can be posted.' });
    const selectedSalesman = salesmanId ? (await query(`SELECT id FROM users WHERE id = ? AND company_id = ? AND active = 1 AND role IN ('company_admin','manager','sales_staff','staff')`, [Number(salesmanId), req.companyId]))[0] : null;
    if (salesmanId && !selectedSalesman) return res.status(400).json({ message: 'Salesman not found in this company.' });
    const saleResult = await insert(
      'INSERT INTO sales (company_id, customer_id, salesman_id, customer_name, total_amount, discount, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.companyId, selectedCustomer?.id || null, selectedSalesman?.id || null, selectedCustomer?.name || String(customerName).trim(), totalAmount, discountAmount, req.user.id]
    );
    const invoiceNumber = `INV-${String(saleResult.id).padStart(6, '0')}`;
    await update('UPDATE sales SET invoice_number = ? WHERE id = ? AND company_id = ?', [invoiceNumber, saleResult.id, req.companyId]);
    const customer = selectedCustomer ? [selectedCustomer] : [];

    for (const record of productRecords) {
      await insert(
        'INSERT INTO sale_items (company_id, sale_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?)',
        [req.companyId, saleResult.id, record.product.id, record.quantity, record.unitPrice, record.total]
      );

      await update(
        'UPDATE products SET stock = stock - ? WHERE id = ? AND company_id = ?',
        [record.quantity, record.product.id, req.companyId]
      );

      await insert(
        'INSERT INTO stock_movements (company_id, warehouse_id, product_id, customer_id, movement_type, quantity, reference, created_by) VALUES (?, (SELECT id FROM warehouses WHERE company_id = ? ORDER BY id LIMIT 1), ?, ?, ?, ?, ?, ?)',
        [req.companyId, req.companyId, record.product.id, customer[0]?.id || null, 'customer_out', record.quantity, `SALE-${saleResult.id}`, req.user.id]
      );
    }

    if (selectedCustomer) {
      await awardLoyalty(req, selectedCustomer.id, totalAmount, 'sale', saleResult.id, `Points earned on sale ${invoiceNumber}`);
      await awardReferral(req, selectedCustomer.id, saleResult.id);
      const termsDays = Number(creditCheck?.snapshot?.account?.terms_days || creditCheck?.snapshot?.policy?.default_terms_days || 0);
      const dueDate = termsDays ? new Date(Date.now() + termsDays * 86400000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      await update('UPDATE sales SET due_date = ? WHERE id = ? AND company_id = ?', [dueDate, saleResult.id, req.companyId]);
      await insert('INSERT INTO credit_ledger (company_id, customer_id, sale_id, entry_type, amount, due_date, note, created_by) VALUES (?, ?, ?, \'invoice\', ?, ?, ?, ?)', [req.companyId, selectedCustomer.id, saleResult.id, totalAmount, dueDate, `Invoice ${invoiceNumber}`, req.user.id]);
      if (selectedSalesman) {
        await insert('INSERT INTO salesman_activities (company_id, salesman_id, customer_id, activity_type, notes, created_by) VALUES (?, ?, ?, \'sale\', ?, ?)', [req.companyId, selectedSalesman.id, selectedCustomer.id, `Sale ${invoiceNumber}`, req.user.id]);
        await createCommissionLineForSale(req.companyId, { id: saleResult.id, total_amount: totalAmount, discount: discountAmount, created_at: new Date().toISOString(), created_by: req.user.id }, selectedSalesman.id);
      }
    }
    await writeAudit(req, 'create', 'sale', saleResult.id, null, { customerName, customerId: selectedCustomer?.id || null, amountBeforeDiscount, discountPercent: normalizedDiscount, totalAmount, discountReason });

    res.status(201).json({
      id: saleResult.id,
      invoiceNumber,
      customerName,
      totalAmount,
      itemCount: productRecords.length
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/purchases', async (req, res) => {
  try {
    const purchases = await query('SELECT * FROM purchases WHERE company_id = ? ORDER BY id DESC', [req.companyId]);
    res.json(purchases);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/purchases', async (req, res) => {
  try {
    const { supplierName, items } = req.body;

    if (!supplierName || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Supplier name and purchase items are required.' });
    }

    let totalAmount = 0;
    const purchaseItems = [];

    for (const item of items) {
      const [product] = await query('SELECT * FROM products WHERE id = ? AND company_id = ?', [item.productId, req.companyId]);
      if (!product) {
        return res.status(404).json({ message: `Product not found: ${item.productId}` });
      }

      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unitPrice || 0);
      const total = quantity * unitPrice;
      totalAmount += total;

      purchaseItems.push({
        product,
        quantity,
        unitPrice,
        total
      });
    }

    const purchaseResult = await insert(
      'INSERT INTO purchases (company_id, supplier_name, total_amount) VALUES (?, ?, ?)',
      [req.companyId, supplierName, totalAmount]
    );

    for (const entry of purchaseItems) {
      await insert(
        'INSERT INTO purchase_items (company_id, purchase_id, product_id, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?)',
        [req.companyId, purchaseResult.id, entry.product.id, entry.quantity, entry.unitPrice, entry.total]
      );

      await update(
        'UPDATE products SET stock = stock + ?, purchase_price = ? WHERE id = ? AND company_id = ?',
        [entry.quantity, entry.unitPrice, entry.product.id, req.companyId]
      );

      await insert(
        'INSERT INTO stock_movements (company_id, warehouse_id, product_id, movement_type, quantity, reference, created_by) VALUES (?, (SELECT id FROM warehouses WHERE company_id = ? ORDER BY id LIMIT 1), ?, ?, ?, ?, ?)',
        [req.companyId, req.companyId, entry.product.id, 'stock_in', entry.quantity, `PURCHASE-${purchaseResult.id}`, req.user.id]
      );
    }

    await writeAudit(req, 'create', 'purchase', purchaseResult.id, null, { supplierName, totalAmount });

    res.status(201).json({
      id: purchaseResult.id,
      supplierName,
      totalAmount,
      itemCount: purchaseItems.length
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/expenses', async (req, res) => {
  try {
    const expenses = await query('SELECT * FROM expenses WHERE company_id = ? ORDER BY id DESC', [req.companyId]);
    res.json(expenses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/payments', async (req, res) => {
  try {
    const payments = await query('SELECT * FROM payments WHERE company_id = ? ORDER BY id DESC', [req.companyId]);
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/payments', async (req, res) => {
  try {
    const { customerName, supplierName, amount, method, note, direction = 'receipt', partyType = 'customer', reference, dueDate } = req.body;

    if (!customerName || !amount) {
      return res.status(400).json({ message: 'Customer name and amount are required.' });
    }

    const paymentCustomer = partyType === 'customer' ? (await query('SELECT id FROM customers WHERE company_id = ? AND name = ? LIMIT 1', [req.companyId, String(customerName).trim()]))[0] : null;
    const result = await insert(
      'INSERT INTO payments (company_id, customer_id, customer_name, supplier_name, amount, method, note, direction, party_type, reference, due_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.companyId, paymentCustomer?.id || null, customerName || '', supplierName || '', Number(amount), method || 'Cash', note || '', direction, partyType, reference || '', dueDate || null, req.user.id]
    );

    const payment = await query('SELECT * FROM payments WHERE id = ? AND company_id = ?', [result.id, req.companyId]);
    if (paymentCustomer?.id && partyType === 'customer') {
      const entryType = direction === 'payment' ? 'payment' : 'credit';
      await insert('INSERT INTO credit_ledger (company_id, customer_id, payment_id, entry_type, amount, due_date, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, paymentCustomer.id, result.id, entryType, Number(amount), dueDate || null, note || `Payment ${result.id}`, req.user.id]);
    }
    await writeAudit(req, 'create', 'payment', result.id, null, payment[0]);
    res.status(201).json(payment[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/expenses', async (req, res) => {
  try {
    const { title, amount, category, paymentMethod, description } = req.body;

    if (!title || !amount) {
      return res.status(400).json({ message: 'Expense title and amount are required.' });
    }

    const result = await insert(
      'INSERT INTO expenses (company_id, title, amount, category, payment_method, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.companyId, title, Number(amount), category || 'Other', paymentMethod || 'Cash', description || '', req.user.id]
    );

    const expense = await query('SELECT * FROM expenses WHERE id = ? AND company_id = ?', [result.id, req.companyId]);
    await writeAudit(req, 'create', 'expense', result.id, null, expense[0]);
    res.status(201).json(expense[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const forecastingService = new ForecastingService();
const forecastRoles = ['super_admin', 'company_admin', 'manager', 'accountant'];

function forecastMonthStart(value) {
  return `${value}-01`;
}

function addForecastMonth(value, amount) {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return date.toISOString().slice(0, 7);
}

function buildForecastPeriods(rows, metric) {
  const byMonth = new Map();
  rows.forEach((row) => {
    const month = String(row.month || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    byMonth.set(month, (byMonth.get(month) || 0) + Number(row[metric] || 0));
  });
  const months = [...byMonth.keys()].sort();
  if (!months.length) return [];
  const start = months[0];
  const end = months[months.length - 1];
  const periods = [];
  for (let month = start; month <= end; month = addForecastMonth(month, 1)) {
    periods.push({ period: month, value: Number((byMonth.get(month) || 0).toFixed(2)) });
  }
  return periods.slice(-24);
}

app.get('/api/analytics/forecast', requireRole(...forecastRoles), async (req, res) => {
  try {
    const metric = String(req.query.metric || 'units').trim().toLowerCase();
    if (!['units', 'revenue'].includes(metric)) return res.status(400).json({ message: 'metric must be units or revenue.' });
    const horizon = Number(req.query.horizon || 3);
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > 12) return res.status(400).json({ message: 'horizon must be an integer from 1 to 12.' });
    const productId = req.query.productId === undefined || req.query.productId === '' ? null : Number(req.query.productId);
    if (productId !== null && (!Number.isInteger(productId) || productId < 1)) return res.status(400).json({ message: 'productId must be a positive integer.' });
    if (productId !== null) {
      const product = (await query('SELECT id FROM products WHERE id = ? AND company_id = ?', [productId, req.companyId]))[0];
      if (!product) return res.status(400).json({ message: 'Product not found in this company.' });
    }

    const history = await forecastingService.forecast({
      metric,
      horizon,
      loadHistoricalData: async () => {
        const productSalesFilter = productId === null ? '' : ' AND si.product_id = ?';
        const productOrderFilter = productId === null ? '' : ' AND oi.product_id = ?';
        const productSubscriptionFilter = productId === null ? '' : ' AND ds.product_id = ?';
        const salesParams = productId === null ? [req.companyId] : [req.companyId, productId];
        const ordersParams = productId === null ? [req.companyId] : [req.companyId, productId];
        const subscriptionParams = productId === null ? [req.companyId] : [req.companyId, productId];
        const [sales, orders, subscriptions] = await Promise.all([
          query(`SELECT DATE(sa.created_at) AS created_at, strftime('%Y-%m', sa.created_at) AS month, COALESCE(SUM(si.quantity), 0) AS units, COALESCE(SUM(si.total_price), 0) AS revenue FROM sales sa JOIN sale_items si ON si.sale_id = sa.id AND si.company_id = sa.company_id WHERE sa.company_id = ?${productSalesFilter} GROUP BY sa.id, DATE(sa.created_at), strftime('%Y-%m', sa.created_at)`, salesParams),
          query(`SELECT DATE(o.created_at) AS created_at, strftime('%Y-%m', o.created_at) AS month, COALESCE(SUM(oi.quantity), 0) AS units, COALESCE(SUM(oi.total_price), 0) AS revenue FROM orders o JOIN order_items oi ON oi.order_id = o.id AND oi.company_id = o.company_id WHERE o.company_id = ? AND o.status != 'cancelled'${productOrderFilter} GROUP BY o.id, DATE(o.created_at), strftime('%Y-%m', o.created_at)`, ordersParams),
          query(`SELECT DATE(ds.created_at) AS created_at, strftime('%Y-%m', ds.created_at) AS month, COALESCE(SUM(ds.quantity), 0) AS units, COALESCE(SUM(ds.quantity * ds.unit_price), 0) AS revenue FROM delivery_subscriptions ds WHERE ds.company_id = ?${productSubscriptionFilter} GROUP BY ds.id, DATE(ds.created_at), strftime('%Y-%m', ds.created_at)`, subscriptionParams)
        ]);
        const rows = [...sales, ...orders, ...subscriptions];
        const periods = buildForecastPeriods(rows, metric);
        const dates = rows.map((row) => row.created_at).filter(Boolean).sort();
        return {
          periods,
          dataWindow: { from: dates[0] || null, to: dates[dates.length - 1] || null, period: 'calendar month', recordCount: rows.length },
          sourceCounts: { sales: sales.length, orders: orders.length, subscriptions: subscriptions.length }
        };
      }
    });
    const forecastPeriods = history.reliable ? Array.from({ length: horizon }, (_, index) => ({ period: addForecastMonth(history.periods[history.periods.length - 1].period, index + 1), value: history.forecast })) : [];
    await writeAudit(req, 'read_forecast', 'forecast', null, null, { metric, horizon, productId, reliable: history.reliable, dataWindow: history.dataWindow });
    res.json({ ...history, productId, baseline: history.forecast ?? null, forecast: forecastPeriods, insufficientDataMessage: INSUFFICIENT_DATA_MESSAGE });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const profitabilityRoles = ['super_admin', 'company_admin', 'manager', 'accountant'];

function parseProfitabilityRange(queryParams = {}) {
  const { startDate, endDate, type, date, month, year } = queryParams;
  let start = startDate || null;
  let end = endDate || null;
  if (type || date || month || year) {
    const parsed = getPeriodRange(queryParams);
    if (!parsed.start || !parsed.end) throw new Error('A valid report period is required.');
    start = parsed.start;
    end = parsed.end;
  }
  if (start && !/^\\d{4}-\\d{2}-\\d{2}$/.test(start)) throw new Error('startDate must use YYYY-MM-DD.');
  if (end && !/^\\d{4}-\\d{2}-\\d{2}$/.test(end)) throw new Error('endDate must use YYYY-MM-DD.');
  if (start && end && start > end) throw new Error('startDate must not be after endDate.');
  return { start, end };
}

function profitabilityDateClause(column, range) {
  return range.start ? { sql: ` AND ${column} >= ? AND ${column} < date(?, '+1 day')`, params: [range.start, range.end] } : { sql: '', params: [] };
}

function numberValue(value) { return Number(Number(value || 0).toFixed(2)); }

async function loadProfitability(companyId, range) {
  const salesDate = profitabilityDateClause('s.created_at', range);
  const orderDate = profitabilityDateClause('o.created_at', range);
  const expenseDate = profitabilityDateClause('e.created_at', range);
  const [sales, orders, expenses, purchases] = await Promise.all([
    query(`SELECT COALESCE(SUM(s.total_amount), 0) AS revenue, COALESCE(SUM(si.quantity * COALESCE(p.purchase_price, 0)), 0) AS cogs, COALESCE(SUM(si.total_price), 0) AS item_revenue FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id AND si.company_id = s.company_id LEFT JOIN products p ON p.id = si.product_id AND p.company_id = s.company_id WHERE s.company_id = ? AND COALESCE(s.status, 'posted') != 'cancelled'${salesDate.sql}`, [companyId, ...salesDate.params]),
    query(`SELECT COALESCE(SUM(o.total_amount), 0) AS revenue, COALESCE(SUM(oi.quantity * COALESCE(p.purchase_price, 0)), 0) AS cogs, COUNT(DISTINCT o.id) AS order_count FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.company_id = o.company_id LEFT JOIN products p ON p.id = oi.product_id AND p.company_id = o.company_id WHERE o.company_id = ? AND o.status != 'cancelled'${orderDate.sql}`, [companyId, ...orderDate.params]),
    query(`SELECT COALESCE(SUM(e.amount), 0) AS total, COALESCE(SUM(CASE WHEN LOWER(COALESCE(e.category, '')) LIKE '%deliver%' OR LOWER(COALESCE(e.title, '')) LIKE '%fuel%' OR LOWER(COALESCE(e.title, '')) LIKE '%route%' THEN e.amount ELSE 0 END), 0) AS delivery FROM expenses e WHERE e.company_id = ?${expenseDate.sql}`, [companyId, ...expenseDate.params]),
    query(`SELECT COALESCE(SUM(total_amount), 0) AS total FROM purchases p WHERE p.company_id = ?${profitabilityDateClause('p.created_at', range).sql}`, [companyId, ...profitabilityDateClause('p.created_at', range).params])
  ]);
  const salesRevenue = numberValue(sales[0].revenue);
  const cogs = numberValue(sales[0].cogs);
  const orderRevenue = numberValue(orders[0].revenue);
  const orderCogs = numberValue(orders[0].cogs);
  const revenue = numberValue(salesRevenue + orderRevenue);
  const totalCogs = numberValue(cogs + orderCogs);
  const operatingExpenses = numberValue(expenses[0].total);
  const grossProfit = numberValue(revenue - totalCogs);
  const netProfit = numberValue(grossProfit - operatingExpenses);
  return { revenue, salesRevenue, orderRevenue, cogs: totalCogs, grossProfit, netProfit, operatingExpenses, deliveryExpenses: numberValue(expenses[0].delivery), purchases: numberValue(purchases[0].total), grossMarginPercent: revenue ? numberValue(grossProfit / revenue * 100) : 0, netMarginPercent: revenue ? numberValue(netProfit / revenue * 100) : 0, orderCount: Number(orders[0].order_count || 0), methodology: 'Revenue combines non-cancelled posted sales and non-cancelled orders. COGS uses each product purchase price at report time; expenses are recorded company expenses. No estimates are added.' };
}

app.get('/api/analytics/profitability', requireRole(...profitabilityRoles), async (req, res) => {
  try {
    const range = parseProfitabilityRange(req.query);
    const summary = await loadProfitability(req.companyId, range);
    await writeAudit(req, 'view', 'profitability_report', null, null, { range, report: 'summary' });
    res.json({ filter: range, summary, costBreakdown: { cogs: summary.cogs, operatingExpenses: summary.operatingExpenses, deliveryExpenses: summary.deliveryExpenses, purchases: summary.purchases } });
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('/api/analytics/customer-profitability', requireRole(...profitabilityRoles), async (req, res) => {
  try {
    const range = parseProfitabilityRange(req.query);
    const customerId = req.query.customerId === undefined || req.query.customerId === '' ? null : Number(req.query.customerId);
    if (customerId !== null && (!Number.isInteger(customerId) || customerId < 1)) return res.status(400).json({ message: 'customerId must be a positive integer.' });
    if (customerId !== null && !(await query('SELECT id FROM customers WHERE id = ? AND company_id = ?', [customerId, req.companyId]))[0]) return res.status(400).json({ message: 'Customer not found in this company.' });
    const dateSales = profitabilityDateClause('s.created_at', range);
    const dateOrders = profitabilityDateClause('o.created_at', range);
    const rows = await query(`
      WITH customer_ledger AS (
        SELECT COALESCE(c.id, 0) AS customer_id, COALESCE(c.name, s.customer_name, 'Unlinked customer') AS customer,
          s.total_amount AS revenue, COALESCE((SELECT SUM(si.quantity * COALESCE(p.purchase_price, 0)) FROM sale_items si JOIN products p ON p.id = si.product_id AND p.company_id = s.company_id WHERE si.sale_id = s.id AND si.company_id = s.company_id), 0) AS cogs
        FROM sales s LEFT JOIN customers c ON c.company_id = s.company_id AND LOWER(c.name) = LOWER(s.customer_name)
        WHERE s.company_id = ? AND COALESCE(s.status, 'posted') != 'cancelled'${dateSales.sql}
        UNION ALL
        SELECT COALESCE(c.id, 0), COALESCE(c.name, o.customer_name, 'Unlinked customer'), o.total_amount,
          COALESCE((SELECT SUM(oi.quantity * COALESCE(p.purchase_price, 0)) FROM order_items oi JOIN products p ON p.id = oi.product_id AND p.company_id = o.company_id WHERE oi.order_id = o.id AND oi.company_id = o.company_id), 0)
        FROM orders o LEFT JOIN customers c ON c.id = o.customer_id AND c.company_id = o.company_id
        WHERE o.company_id = ? AND o.status != 'cancelled'${dateOrders.sql}
      )
      SELECT customer_id, customer, COUNT(*) AS transactions, ROUND(SUM(revenue), 2) AS revenue, ROUND(SUM(cogs), 2) AS cogs, ROUND(SUM(revenue - cogs), 2) AS gross_profit,
        CASE WHEN SUM(revenue) = 0 THEN 0 ELSE ROUND(SUM(revenue - cogs) * 100.0 / SUM(revenue), 2) END AS gross_margin_percent
      FROM customer_ledger ${customerId !== null ? 'WHERE customer_id = ?' : ''} GROUP BY customer_id, customer ORDER BY revenue DESC`, [req.companyId, ...dateSales.params, req.companyId, ...dateOrders.params, ...(customerId !== null ? [customerId] : [])]);
    await writeAudit(req, 'view', 'customer_profitability_report', customerId, null, { range, customerId });
    res.json({ filter: range, rows, methodology: 'Customer revenue and COGS are sourced from company-scoped sales and non-cancelled orders. Unlinked records remain visible instead of being assigned.' });
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('/api/analytics/route-profitability', requireRole(...profitabilityRoles), async (req, res) => {
  try {
    const range = parseProfitabilityRange(req.query);
    const routeDate = profitabilityDateClause('r.route_date', range);
    const routeId = req.query.routeId ? Number(req.query.routeId) : null;
    if (req.query.routeId && (!Number.isInteger(routeId) || routeId < 1)) return res.status(400).json({ message: 'routeId must be a positive integer.' });
    const rows = await query(`
      SELECT r.id AS route_id, r.name, r.area, r.route_date, r.status, COUNT(DISTINCT o.id) AS deliveries,
        ROUND(COALESCE(SUM(o.total_amount), 0), 2) AS revenue,
        ROUND(COALESCE(SUM((SELECT SUM(oi.quantity * COALESCE(p.purchase_price, 0)) FROM order_items oi JOIN products p ON p.id = oi.product_id AND p.company_id = o.company_id WHERE oi.order_id = o.id AND oi.company_id = o.company_id)), 0), 2) AS cogs,
        ROUND(COALESCE(SUM(o.total_amount), 0) - COALESCE(SUM((SELECT SUM(oi.quantity * COALESCE(p.purchase_price, 0)) FROM order_items oi JOIN products p ON p.id = oi.product_id AND p.company_id = o.company_id WHERE oi.order_id = o.id AND oi.company_id = o.company_id)), 0), 2) AS gross_profit
      FROM delivery_routes r LEFT JOIN delivery_route_stops rs ON rs.route_id = r.id AND rs.company_id = r.company_id
      LEFT JOIN deliveries d ON d.id = rs.delivery_id AND d.company_id = r.company_id LEFT JOIN orders o ON o.id = d.order_id AND o.company_id = r.company_id AND o.status != 'cancelled'
      WHERE r.company_id = ?${routeDate.sql}${routeId ? ' AND r.id = ?' : ''} GROUP BY r.id ORDER BY r.route_date DESC, r.id DESC`, [req.companyId, ...routeDate.params, ...(routeId ? [routeId] : [])]);
    await writeAudit(req, 'view', 'route_profitability_report', routeId, null, { range });
    res.json({ filter: range, rows: rows.map((row) => ({ ...row, gross_margin_percent: row.revenue ? numberValue(row.gross_profit / row.revenue * 100) : 0, net_profit: numberValue(row.gross_profit), net_margin_percent: row.revenue ? numberValue(row.gross_profit / row.revenue * 100) : 0 })), methodology: 'Route revenue and COGS use only deliveries assigned to recorded route stops. No route expense is allocated without an explicit route-linked expense record.' });
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('/api/analytics/profitability/export', requireRole(...profitabilityRoles), async (req, res) => {
  try {
    const report = String(req.query.report || 'summary');
    const range = parseProfitabilityRange(req.query);
    let headers; let rows;
    if (report === 'summary') { const summary = await loadProfitability(req.companyId, range); headers = ['metric', 'value']; rows = Object.entries(summary).filter(([, value]) => typeof value === 'number').map(([metric, value]) => ({ metric, value })); }
    else return res.status(400).json({ message: 'report must be summary.' });
    await writeAudit(req, 'export_csv', 'profitability_report', null, null, { report, range, rowCount: rows.length });
    res.status(200).set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="profitability-summary.csv"', 'X-Content-Type-Options': 'nosniff' }); writeCsv(res, headers, rows); res.end();
  } catch (error) { res.status(400).json({ message: error.message }); }
});

const reportRoles = ['super_admin', 'company_admin', 'manager', 'accountant'];
const reportSources = {
  sales: { table: 'sales', fields: { id: 's.id', customer_name: 's.customer_name', total_amount: 's.total_amount', created_at: 's.created_at' }, defaultOrder: 's.created_at DESC' },
  orders: { table: 'orders', fields: { id: 'o.id', customer_name: 'o.customer_name', total_amount: 'o.total_amount', status: 'o.status', created_at: 'o.created_at' }, defaultOrder: 'o.created_at DESC' },
  customers: { table: 'customers', fields: { id: 'c.id', name: 'c.name', phone: 'c.phone', area: 'c.area', created_at: 'c.created_at' }, defaultOrder: 'c.name COLLATE NOCASE' },
  products: { table: 'products', fields: { id: 'p.id', name: 'p.name', category: 'p.category', stock: 'p.stock', sale_price: 'p.sale_price', purchase_price: 'p.purchase_price', created_at: 'p.created_at' }, defaultOrder: 'p.name COLLATE NOCASE' },
  expenses: { table: 'expenses', fields: { id: 'e.id', title: 'e.title', category: 'e.category', amount: 'e.amount', created_at: 'e.created_at' }, defaultOrder: 'e.created_at DESC' },
  payments: { table: 'payments', fields: { id: 'pm.id', customer_name: 'pm.customer_name', amount: 'pm.amount', method: 'pm.method', created_at: 'pm.created_at' }, defaultOrder: 'pm.created_at DESC' }
};
function parseReportConfig(body) {
  const source = String(body.source || '');
  const definition = reportSources[source];
  if (!definition) throw new Error('Unsupported report source.');
  const fields = Array.isArray(body.fields) && body.fields.length ? body.fields : Object.keys(definition.fields);
  if (fields.length > 12 || fields.some((field) => !Object.prototype.hasOwnProperty.call(definition.fields, String(field)))) throw new Error('Report fields are invalid or too numerous.');
  if (body.filters !== undefined && (!Array.isArray(body.filters) || body.filters.length > 5)) throw new Error('A report may contain at most five filters.');
  const filters = Array.isArray(body.filters) ? body.filters : [];
  const normalizedFilters = filters.map((filter) => {
    const field = String(filter?.field || ''), operator = String(filter?.operator || 'eq');
    if (!Object.prototype.hasOwnProperty.call(definition.fields, field) || !['eq', 'contains', 'gte', 'lte'].includes(operator)) throw new Error('Report filter is invalid.');
    const value = String(filter?.value ?? '').slice(0, 200);
    if (!value) throw new Error('Report filter values are required.');
    return { field, operator, value };
  });
  const groupBy = body.groupBy == null || body.groupBy === '' ? null : String(body.groupBy);
  if (groupBy && !Object.prototype.hasOwnProperty.call(definition.fields, groupBy)) throw new Error('Report grouping is invalid.');
  const limit = body.limit === undefined ? 200 : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Report limit must be between 1 and 500.');
  return { source, fields, filters: normalizedFilters, groupBy, limit };
}
function buildReportQuery(companyId, config) {
  const definition = reportSources[config.source], selected = config.fields.map((field) => `${definition.fields[field]} AS "${field}"`);
  const params = [companyId];
  let sql = `SELECT ${selected.join(', ')} FROM ${definition.table} ${config.source === 'sales' ? 's' : config.source === 'orders' ? 'o' : config.source === 'customers' ? 'c' : config.source === 'products' ? 'p' : config.source === 'expenses' ? 'e' : 'pm'} WHERE ${definition.table === 'sales' ? 's' : config.source === 'orders' ? 'o' : config.source === 'customers' ? 'c' : config.source === 'products' ? 'p' : config.source === 'expenses' ? 'e' : 'pm'}.company_id = ?`;
  config.filters.forEach((filter) => {
    const expression = definition.fields[filter.field];
    if (filter.operator === 'contains') sql += ` AND CAST(${expression} AS TEXT) LIKE ?`, params.push(`%${filter.value.replace(/[\\%_]/g, '\\$&')}%`);
    else if (filter.operator === 'gte') sql += ` AND ${expression} >= ?`, params.push(filter.value);
    else if (filter.operator === 'lte') sql += ` AND ${expression} <= ?`, params.push(filter.value);
    else sql += ` AND ${expression} = ?`, params.push(filter.value);
  });
  if (config.groupBy) { const group = definition.fields[config.groupBy]; sql += ` GROUP BY ${group}`; }
  sql += ` ORDER BY ${definition.defaultOrder} LIMIT ?`; params.push(config.limit);
  return { sql, params };
}
async function executeReport(companyId, config) { return query(...Object.values(buildReportQuery(companyId, config))); }
app.get('/api/report-definitions', requireRole(...reportRoles), async (req, res) => {
  try {
    const rows = await query('SELECT id, name, source, configuration, created_by, created_at, updated_at FROM report_definitions WHERE company_id = ? ORDER BY updated_at DESC, id DESC LIMIT 100', [req.companyId]);
    res.json(rows.map((row) => ({ ...row, configuration: JSON.parse(row.configuration || '{}') })));
  } catch (error) { res.status(500).json({ message: 'Unable to load report definitions.' }); }
});
app.post('/api/report-definitions', requireRole(...reportRoles), async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 120); if (!name) return res.status(400).json({ message: 'Report name is required.' });
    const configuration = parseReportConfig(req.body || {});
    const result = await insert('INSERT INTO report_definitions (company_id, name, source, configuration, created_by) VALUES (?, ?, ?, ?, ?)', [req.companyId, name, configuration.source, JSON.stringify(configuration), req.user.id]);
    const row = (await query('SELECT id, name, source, configuration, created_at, updated_at FROM report_definitions WHERE id = ? AND company_id = ?', [result.id, req.companyId]))[0];
    await writeAudit(req, 'create', 'report_definition', result.id, null, { name, source: configuration.source }); res.status(201).json({ ...row, configuration: JSON.parse(row.configuration) });
  } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 400).json({ message: error.message }); }
});
app.put('/api/report-definitions/:id', requireRole(...reportRoles), async (req, res) => {
  try {
    const id = Number(req.params.id), existing = (await query('SELECT * FROM report_definitions WHERE id = ? AND company_id = ?', [id, req.companyId]))[0];
    if (!existing) return res.status(404).json({ message: 'Report definition not found.' });
    const name = String(req.body?.name || existing.name).trim().slice(0, 120), configuration = parseReportConfig(req.body || {});
    await update('UPDATE report_definitions SET name = ?, source = ?, configuration = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [name, configuration.source, JSON.stringify(configuration), id, req.companyId]);
    const row = (await query('SELECT id, name, source, configuration, created_at, updated_at FROM report_definitions WHERE id = ? AND company_id = ?', [id, req.companyId]))[0];
    await writeAudit(req, 'update', 'report_definition', id, null, { name, source: configuration.source }); res.json({ ...row, configuration: JSON.parse(row.configuration) });
  } catch (error) { res.status(error.message.includes('UNIQUE') ? 409 : 400).json({ message: error.message }); }
});
app.delete('/api/report-definitions/:id', requireRole(...reportRoles), async (req, res) => {
  try { const id = Number(req.params.id), result = await update('DELETE FROM report_definitions WHERE id = ? AND company_id = ?', [id, req.companyId]); if (!result.changes) return res.status(404).json({ message: 'Report definition not found.' }); await writeAudit(req, 'delete', 'report_definition', id); res.status(204).end(); } catch (error) { res.status(500).json({ message: 'Unable to delete report definition.' }); }
});
app.post('/api/report-definitions/:id/run', requireRole(...reportRoles), async (req, res) => {
  try {
    const row = (await query('SELECT * FROM report_definitions WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]; if (!row) return res.status(404).json({ message: 'Report definition not found.' });
    const config = parseReportConfig(JSON.parse(row.configuration)); const rows = await executeReport(req.companyId, config); await writeAudit(req, 'run', 'report_definition', row.id, null, { source: config.source, rowCount: rows.length }); res.json({ definition: { id: row.id, name: row.name, ...config }, rows });
  } catch (error) { res.status(400).json({ message: error.message }); }
});
app.get('/api/monitoring/errors', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => {
  try { const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50)); res.json(await query('SELECT id, level, status_code, method, path, message, created_at FROM error_events WHERE company_id = ? ORDER BY id DESC LIMIT ?', [req.companyId, limit])); } catch (error) { res.status(500).json({ message: 'Unable to load monitoring events.' }); }
});
app.get('/api/report-definitions/:id/export', requireRole(...reportRoles), async (req, res) => {
  try {
    const row = (await query('SELECT * FROM report_definitions WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]; if (!row) return res.status(404).json({ message: 'Report definition not found.' });
    const config = parseReportConfig(JSON.parse(row.configuration)); const rows = await executeReport(req.companyId, config); const headers = config.fields;
    res.status(200).set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="report-${row.id}.csv"`, 'X-Content-Type-Options': 'nosniff' }); writeCsv(res, headers, rows); res.end();
    await writeAudit(req, 'export_csv', 'report_definition', row.id, null, { rowCount: rows.length });
  } catch (error) { if (!res.headersSent) res.status(400).json({ message: error.message }); else res.end(); }
});

app.get('/api/reports', async (req, res) => {
  try {
    const companyId = req.companyId;
    const { type, date, year, month, startDate: queryStartDate, endDate: queryEndDate } = req.query;
    let startDate = null;
    let endDate = null;

    if (type === 'daily' && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const selectedDate = new Date(`${date}T00:00:00Z`);
      selectedDate.setUTCDate(selectedDate.getUTCDate() + 1);
      startDate = date;
      endDate = selectedDate.toISOString().slice(0, 10);
    } else if (type === 'monthly' && month && /^\d{4}-\d{2}$/.test(month)) {
      const [monthYear, monthNumber] = month.split('-').map(Number);
      const nextMonth = monthNumber === 12 ? `${monthYear + 1}-01` : `${monthYear}-${String(monthNumber + 1).padStart(2, '0')}`;
      startDate = `${month}-01`;
      endDate = `${nextMonth}-01`;
    } else if (type === 'annual' && year && /^\d{4}$/.test(year)) {
      startDate = `${year}-01-01`;
      endDate = `${Number(year) + 1}-01-01`;
    } else if (!type && year && /^\d{4}$/.test(year)) {
      startDate = `${year}-01-01`;
      endDate = `${Number(year) + 1}-01-01`;
    } else if (!type && month && /^\d{4}-\d{2}$/.test(month)) {
      const [monthYear, monthNumber] = month.split('-').map(Number);
      const nextMonth = monthNumber === 12 ? `${monthYear + 1}-01` : `${monthYear}-${String(monthNumber + 1).padStart(2, '0')}`;
      startDate = `${month}-01`;
      endDate = `${nextMonth}-01`;
    } else if (type === 'custom' && queryStartDate && queryEndDate) {
      const next = new Date(`${queryEndDate}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      startDate = queryStartDate;
      endDate = next.toISOString().slice(0, 10);
    }

    const dateFilter = (column) => startDate ? ` AND ${column} >= ? AND ${column} < ?` : '';
    const dateParams = startDate ? [startDate, endDate] : [];
    const companyFilter = (column) => ` AND ${column} = ?`;
    const scopedDateParams = [companyId, ...dateParams];
    const inventoryReportQuery = startDate
      ? query(`
        SELECT name, category,
          (SELECT COALESCE(SUM(pi.quantity), 0) FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id WHERE pi.product_id = products.id${companyFilter('pi.company_id')}${dateFilter('pu.created_at')}) AS purchased_units,
          (SELECT COALESCE(SUM(si.quantity), 0) FROM sale_items si JOIN sales sa ON sa.id = si.sale_id WHERE si.product_id = products.id${companyFilter('si.company_id')}${dateFilter('sa.created_at')}) AS sold_units,
          ((SELECT COALESCE(SUM(pi.quantity), 0) FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id WHERE pi.product_id = products.id${companyFilter('pi.company_id')}${dateFilter('pu.created_at')}) -
           (SELECT COALESCE(SUM(si.quantity), 0) FROM sale_items si JOIN sales sa ON sa.id = si.sale_id WHERE si.product_id = products.id${companyFilter('si.company_id')}${dateFilter('sa.created_at')})) AS stock,
          (SELECT COALESCE(SUM(pi.total_price), 0) FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id WHERE pi.product_id = products.id${companyFilter('pi.company_id')}${dateFilter('pu.created_at')}) AS cost_value,
          (SELECT COALESCE(SUM(si.total_price), 0) FROM sale_items si JOIN sales sa ON sa.id = si.sale_id WHERE si.product_id = products.id${companyFilter('si.company_id')}${dateFilter('sa.created_at')}) AS retail_value
        FROM products
        WHERE products.company_id = ?
        ORDER BY retail_value DESC
      `, [...scopedDateParams, ...scopedDateParams, ...scopedDateParams, ...scopedDateParams, ...scopedDateParams, ...scopedDateParams, companyId])
      : query(`
        SELECT name, category, stock, purchase_price, sale_price,
          stock * purchase_price AS cost_value,
          stock * sale_price AS retail_value
        FROM products WHERE company_id = ?
        ORDER BY retail_value DESC
      `, [companyId]);

    const [salesReport, purchasesReport, expensesReport, customerReport, inventoryReport, monthlyReport, supplierReport, paymentReport] = await Promise.all([
      query(`SELECT DATE(created_at) AS date, SUM(total_amount) AS total FROM sales WHERE 1 = 1${companyFilter('company_id')}${dateFilter('created_at')} GROUP BY DATE(created_at) ORDER BY DATE(created_at) DESC LIMIT 31`, scopedDateParams),
      query(`SELECT DATE(created_at) AS date, SUM(total_amount) AS total FROM purchases WHERE 1 = 1${companyFilter('company_id')}${dateFilter('created_at')} GROUP BY DATE(created_at) ORDER BY DATE(created_at) DESC LIMIT 31`, scopedDateParams),
      query(`SELECT category, SUM(amount) AS total FROM expenses WHERE 1 = 1${companyFilter('company_id')}${dateFilter('created_at')} GROUP BY category ORDER BY total DESC`, scopedDateParams),
      query(`
        SELECT customer_name AS customer, COUNT(*) AS orders, SUM(total_amount) AS total
        FROM sales
        WHERE 1 = 1${companyFilter('company_id')}${dateFilter('created_at')}
        GROUP BY customer_name
        ORDER BY total DESC
      `, scopedDateParams),
      inventoryReportQuery,
      query(`
        SELECT strftime('%Y-%m', created_at) AS month,
          COALESCE((SELECT SUM(total_amount) FROM sales s2 WHERE s2.company_id = ? AND strftime('%Y-%m', s2.created_at) = strftime('%Y-%m', s.created_at)${dateFilter('s2.created_at')}), 0) AS sales,
          COALESCE((SELECT SUM(total_amount) FROM purchases p2 WHERE p2.company_id = ? AND strftime('%Y-%m', p2.created_at) = strftime('%Y-%m', s.created_at)${dateFilter('p2.created_at')}), 0) AS purchases,
          COALESCE((SELECT SUM(amount) FROM expenses e2 WHERE e2.company_id = ? AND strftime('%Y-%m', e2.created_at) = strftime('%Y-%m', s.created_at)${dateFilter('e2.created_at')}), 0) AS expenses
        FROM sales s
        WHERE s.company_id = ?${dateFilter('s.created_at')}
        GROUP BY month
        ORDER BY month DESC
        LIMIT 12
      `, [...scopedDateParams, ...scopedDateParams, ...scopedDateParams, ...scopedDateParams]),
      query(`SELECT supplier_name AS supplier, COUNT(*) AS orders, SUM(total_amount) AS total FROM purchases WHERE 1 = 1${companyFilter('company_id')}${dateFilter('created_at')} GROUP BY supplier_name ORDER BY total DESC`, scopedDateParams),
      query(`SELECT method, COUNT(*) AS transactions, SUM(amount) AS total FROM payments WHERE 1 = 1${companyFilter('company_id')}${dateFilter('created_at')} GROUP BY method ORDER BY total DESC`, scopedDateParams)
    ]);

    const inventoryCostExpression = startDate
      ? `(SELECT COALESCE(SUM(pi.total_price), 0) FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id WHERE pi.company_id = ? AND pu.created_at >= ? AND pu.created_at < ?)`
      : '(SELECT COALESCE(SUM(stock * purchase_price), 0) FROM products WHERE company_id = ?)';
    const inventoryRetailExpression = startDate
      ? `(SELECT COALESCE(SUM(si.total_price), 0) FROM sale_items si JOIN sales sa ON sa.id = si.sale_id WHERE si.company_id = ? AND sa.created_at >= ? AND sa.created_at < ?)`
      : '(SELECT COALESCE(SUM(stock * sale_price), 0) FROM products WHERE company_id = ?)';
    const totalsParams = [
      ...scopedDateParams,
      ...scopedDateParams,
      ...scopedDateParams,
      ...scopedDateParams,
      ...(startDate ? [...scopedDateParams, ...scopedDateParams] : [companyId, companyId])
    ];

    const totals = await query(`
      SELECT
        (SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE company_id = ?${dateFilter('created_at')}) AS revenue,
        (SELECT COALESCE(SUM(total_amount), 0) FROM purchases WHERE company_id = ?${dateFilter('created_at')}) AS purchases,
        (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE company_id = ?${dateFilter('created_at')}) AS expenses,
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE company_id = ?${dateFilter('created_at')}) AS payments,
        ${inventoryCostExpression} AS inventoryCost,
        ${inventoryRetailExpression} AS inventoryRetail
    `, totalsParams);

    res.json({
      salesReport,
      purchasesReport,
      expensesReport,
      customerReport,
      inventoryReport,
      monthlyReport,
      supplierReport,
      paymentReport,
      totals: totals[0],
      filter: { type: type || '', date: date || '', year: year || '', month: month || '', startDate: startDate || '', endDate: endDate || '' }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Provider-agnostic route optimization. This intentionally performs no network calls.
const routeReadRoles = ['super_admin', 'company_admin', 'manager', 'staff', 'sales_staff', 'inventory_staff', 'driver', 'delivery_driver'];
const routeManageRoles = ['super_admin', 'company_admin', 'manager', 'staff', 'sales_staff'];
const routeStatuses = ['planned', 'assigned', 'in_progress', 'completed', 'cancelled'];
const routeStopStatuses = ['pending', 'current', 'completed', 'skipped'];

function normalizeCoordinate(value, min, max) {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}
function normalizeCoordinates(latitude, longitude) {
  const lat = normalizeCoordinate(latitude, -90, 90);
  const lng = normalizeCoordinate(longitude, -180, 180);
  return lat === null || lng === null ? null : { latitude: lat, longitude: lng };
}
function haversineDistanceKm(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}
function fallbackNavigationUrl(stop) {
  const coordinates = normalizeCoordinates(stop.latitude, stop.longitude);
  return coordinates ? `geo:${coordinates.latitude},${coordinates.longitude}` : '';
}
function optimizeRouteStops(deliveries) {
  const withCoordinates = deliveries.filter((delivery) => normalizeCoordinates(delivery.latitude, delivery.longitude));
  const allHaveCoordinates = withCoordinates.length === deliveries.length && deliveries.length > 0;
  const remaining = deliveries.slice().sort((a, b) => Number(a.id) - Number(b.id));
  const ordered = [];
  let distance = 0;
  if (allHaveCoordinates) {
    let current = null;
    while (remaining.length) {
      const next = remaining.reduce((best, candidate) => {
        if (!best) return candidate;
        const bestDistance = current ? haversineDistanceKm(current, normalizeCoordinates(best.latitude, best.longitude)) : 0;
        const candidateDistance = current ? haversineDistanceKm(current, normalizeCoordinates(candidate.latitude, candidate.longitude)) : 0;
        return candidateDistance < bestDistance || (candidateDistance === bestDistance && Number(candidate.id) < Number(best.id)) ? candidate : best;
      }, null);
      if (current) distance += haversineDistanceKm(current, normalizeCoordinates(next.latitude, next.longitude));
      ordered.push(next);
      remaining.splice(remaining.indexOf(next), 1);
      current = normalizeCoordinates(next.latitude, next.longitude);
    }
  } else {
    ordered.sort((a, b) => String(a.area || '').localeCompare(String(b.area || ''), undefined, { sensitivity: 'base' }) || String(a.delivery_address || '').localeCompare(String(b.delivery_address || ''), undefined, { sensitivity: 'base' }) || Number(a.id) - Number(b.id));
  }
  return { ordered, distance, provider: 'deterministic-fallback', message: allHaveCoordinates ? 'Optimized with deterministic nearest-neighbor ordering.' : 'Insufficient location data for distance optimization; ordered by area, address, and delivery ID.' };
}
function routeDate(value) { return value === undefined || value === null || value === '' ? null : (isIsoDate(String(value)) ? String(value) : false); }
async function getRouteForCompany(req, id) {
  const route = (await query(`SELECT r.*, u.name AS driver_name, creator.name AS created_by_name, COUNT(s.id) AS stop_count
    FROM delivery_routes r LEFT JOIN users u ON u.id = r.driver_id LEFT JOIN users creator ON creator.id = r.created_by
    LEFT JOIN delivery_route_stops s ON s.route_id = r.id AND s.company_id = r.company_id
    WHERE r.id = ? AND r.company_id = ? GROUP BY r.id`, [Number(id), req.companyId]))[0];
  if (!route) return null;
  if (['driver', 'delivery_driver'].includes(req.user.role) && route.driver_id !== req.user.id) return null;
  route.stops = await query(`  SELECT s.*, d.status AS delivery_status, d.scheduled_date, o.id AS order_id, o.customer_name, o.delivery_address,      c.area, c.latitude, c.longitude, c.phone AS customer_phone
    FROM delivery_route_stops s JOIN deliveries d ON d.id = s.delivery_id AND d.company_id = s.company_id
    JOIN orders o ON o.id = d.order_id AND o.company_id = d.company_id LEFT JOIN customers c ON c.id = o.customer_id AND c.company_id = o.company_id
    WHERE s.route_id = ? AND s.company_id = ? ORDER BY s.sequence`, [route.id, req.companyId]);
  return route;
}
async function validateRouteDriver(companyId, driverId) {
  if (driverId === null || driverId === undefined || driverId === '') return null;
  const driver = (await query(`SELECT id, name FROM users WHERE id = ? AND company_id = ? AND active = 1 AND role IN ('driver','delivery_driver')`, [Number(driverId), companyId]))[0];
  return driver || false;
}

app.get('/api/routes/candidates', requireRole(...routeReadRoles), async (req, res) => {
  try {
    const params = [req.companyId]; let sql = `SELECT d.id, d.order_id, d.status, d.scheduled_date, o.customer_name, o.delivery_address, c.area, c.latitude, c.longitude,
      c.phone AS customer_phone FROM deliveries d JOIN orders o ON o.id = d.order_id AND o.company_id = d.company_id
      LEFT JOIN customers c ON c.id = o.customer_id AND c.company_id = o.company_id
      WHERE d.company_id = ? AND d.status NOT IN ('delivered','partially_delivered','failed')
      AND NOT EXISTS (SELECT 1 FROM delivery_route_stops rs JOIN delivery_routes rr ON rr.id = rs.route_id WHERE rs.company_id = d.company_id AND rs.delivery_id = d.id AND rr.status IN ('planned','assigned','in_progress'))`;
    if (req.query.date !== undefined) { if (!isIsoDate(String(req.query.date))) return res.status(400).json({ message: 'Date must be a valid date.' }); sql += ' AND d.scheduled_date = ?'; params.push(String(req.query.date)); }
    if (req.query.area) { sql += ' AND LOWER(COALESCE(c.area, o.delivery_address, \'\')) = LOWER(?)'; params.push(String(req.query.area).trim()); }
    sql += ' ORDER BY COALESCE(c.area, \'\'), COALESCE(o.delivery_address, \'\'), d.id';
    res.json(await query(sql, params));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/routes', requireRole(...routeReadRoles), async (req, res) => {
  try {
    const params = [req.companyId]; let sql = `SELECT r.*, u.name AS driver_name, COUNT(s.id) AS stop_count FROM delivery_routes r LEFT JOIN users u ON u.id = r.driver_id LEFT JOIN delivery_route_stops s ON s.route_id = r.id AND s.company_id = r.company_id WHERE r.company_id = ?`;
    if (['driver', 'delivery_driver'].includes(req.user.role)) { sql += ' AND r.driver_id = ?'; params.push(req.user.id); }
    if (req.query.status) { if (!routeStatuses.includes(String(req.query.status))) return res.status(400).json({ message: 'Invalid route status.' }); sql += ' AND r.status = ?'; params.push(String(req.query.status)); }
    if (req.query.date) { if (!isIsoDate(String(req.query.date))) return res.status(400).json({ message: 'Date must be a valid date.' }); sql += ' AND r.route_date = ?'; params.push(String(req.query.date)); }
    sql += ' GROUP BY r.id ORDER BY COALESCE(r.route_date, \'9999-12-31\') DESC, r.id DESC'; res.json(await query(sql, params));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/routes/:id', requireRole(...routeReadRoles), async (req, res) => { try { const route = await getRouteForCompany(req, req.params.id); if (!route) return res.status(404).json({ message: 'Route not found.' }); res.json(route); } catch (error) { res.status(500).json({ message: error.message }); } });

app.post('/api/routes', requireRole(...routeManageRoles), async (req, res) => {
  try {
    const rawIds = req.body?.deliveryIds || req.body?.deliveries;
    if (!Array.isArray(rawIds) || !rawIds.length) return res.status(400).json({ message: 'At least one delivery ID is required.' });
    const ids = rawIds.map((item) => Number(item?.deliveryId ?? item)).filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length !== rawIds.length || new Set(ids).size !== ids.length) return res.status(400).json({ message: 'Delivery IDs must be unique positive integers.' });
    const placeholders = ids.map(() => '?').join(',');
    const deliveries = await query(`SELECT d.id, d.order_id, d.status, d.scheduled_date, o.customer_name, o.delivery_address, c.area, c.latitude, c.longitude
      FROM deliveries d JOIN orders o ON o.id = d.order_id AND o.company_id = d.company_id LEFT JOIN customers c ON c.id = o.customer_id AND c.company_id = o.company_id
      WHERE d.company_id = ? AND d.id IN (${placeholders})`, [req.companyId, ...ids]);
    if (deliveries.length !== ids.length) return res.status(404).json({ message: 'One or more deliveries were not found in this company.' });
    if (deliveries.some((d) => ['delivered', 'partially_delivered', 'failed'].includes(d.status))) return res.status(409).json({ message: 'Completed or failed deliveries cannot be routed.' });
    const activeStops = await query(`SELECT rs.delivery_id FROM delivery_route_stops rs JOIN delivery_routes r ON r.id = rs.route_id WHERE rs.company_id = ? AND rs.delivery_id IN (${placeholders}) AND r.status IN ('planned','assigned','in_progress')`, [req.companyId, ...ids]);
    if (activeStops.length) return res.status(409).json({ message: 'One or more deliveries are already assigned to an active route.', deliveryIds: activeStops.map((s) => s.delivery_id) });
    const requestedDate = routeDate(req.body?.routeDate); if (requestedDate === false) return res.status(400).json({ message: 'Route date must be a valid date.' });
    const requestedDriver = await validateRouteDriver(req.companyId, req.body?.driverId); if (requestedDriver === false) return res.status(400).json({ message: 'Driver is not active or is outside this company.' });
    const groups = new Map(); deliveries.forEach((d) => { const area = String(d.area || d.delivery_address || 'Unspecified').trim() || 'Unspecified'; if (!groups.has(area)) groups.set(area, []); groups.get(area).push(d); });
    const created = [];
    for (const [area, group] of groups) {
      const optimized = optimizeRouteStops(group); const name = String(req.body?.name || `Route - ${area}`).trim().slice(0, 120); const estimatedMinutes = Math.round(optimized.distance / 30 * 60 + group.length * 10);
      const route = await insert('INSERT INTO delivery_routes (company_id, name, area, driver_id, route_date, status, estimated_distance_km, estimated_duration_minutes, optimization_provider, optimization_message, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, name, area, requestedDriver?.id || null, requestedDate || group.map((d) => d.scheduled_date).find(Boolean) || null, requestedDriver ? 'assigned' : 'planned', optimized.distance, estimatedMinutes, optimized.provider, optimized.message, req.user.id]);
      for (let index = 0; index < optimized.ordered.length; index += 1) { const stop = optimized.ordered[index]; const from = index ? normalizeCoordinates(optimized.ordered[index - 1].latitude, optimized.ordered[index - 1].longitude) : null; const to = normalizeCoordinates(stop.latitude, stop.longitude); const leg = from && to ? haversineDistanceKm(from, to) : 0; await insert('INSERT INTO delivery_route_stops (company_id, route_id, delivery_id, sequence, estimated_distance_km, estimated_duration_minutes, navigation_url) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.companyId, route.id, stop.id, index + 1, leg, Math.round(leg / 30 * 60 + 10), fallbackNavigationUrl(stop)]); await update('UPDATE deliveries SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [stop.id, req.companyId]); }
      await writeAudit(req, 'create', 'delivery_route', route.id, null, { area, deliveryIds: optimized.ordered.map((d) => d.id), message: optimized.message }); created.push(await getRouteForCompany(req, route.id));
    }
    res.status(201).json(created.length === 1 ? created[0] : { routes: created });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/routes/:id', requireRole(...routeManageRoles), async (req, res) => {
  try {
    const route = (await query('SELECT * FROM delivery_routes WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]; if (!route) return res.status(404).json({ message: 'Route not found.' });
    const fields = [], params = [], previous = { name: route.name, driver_id: route.driver_id, status: route.status, route_date: route.route_date };
    if (req.body?.name !== undefined) { const name = String(req.body.name).trim(); if (!name) return res.status(400).json({ message: 'Route name cannot be empty.' }); fields.push('name = ?'); params.push(name.slice(0, 120)); }
    if (req.body?.driverId !== undefined) { const driver = await validateRouteDriver(req.companyId, req.body.driverId); if (driver === false) return res.status(400).json({ message: 'Driver is not active or is outside this company.' }); fields.push('driver_id = ?', 'status = ?'); params.push(driver?.id || null, driver ? 'assigned' : route.status); }
    if (req.body?.status !== undefined) { const status = String(req.body.status); if (!routeStatuses.includes(status)) return res.status(400).json({ message: 'Invalid route status.' }); if (['driver','delivery_driver'].includes(req.user.role)) return res.status(403).json({ message: 'Drivers may progress routes only through the progress endpoint.' }); fields.push('status = ?'); params.push(status); }
    if (req.body?.routeDate !== undefined) { const date = routeDate(req.body.routeDate); if (date === false) return res.status(400).json({ message: 'Route date must be a valid date.' }); fields.push('route_date = ?'); params.push(date); }
    if (!fields.length) return res.status(400).json({ message: 'No route changes supplied.' }); params.push(Number(req.params.id), req.companyId); await update(`UPDATE delivery_routes SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`, params); const updated = await getRouteForCompany(req, req.params.id); await writeAudit(req, 'update', 'delivery_route', route.id, previous, updated); res.json(updated);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/routes/:id/reorder', requireRole(...routeManageRoles), async (req, res) => {
  try { const route = (await query('SELECT * FROM delivery_routes WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]; if (!route) return res.status(404).json({ message: 'Route not found.' }); const order = req.body?.deliveryIds || req.body?.stopIds; if (!Array.isArray(order) || !order.length) return res.status(400).json({ message: 'An ordered deliveryIds array is required.' }); const stops = await query('SELECT * FROM delivery_route_stops WHERE route_id = ? AND company_id = ?', [route.id, req.companyId]); const ids = order.map(Number); if (ids.length !== stops.length || new Set(ids).size !== ids.length || stops.some((s) => !ids.includes(s.delivery_id))) return res.status(400).json({ message: 'Reorder must include each route delivery exactly once.' }); for (let i = 0; i < ids.length; i += 1) await update('UPDATE delivery_route_stops SET sequence = ?, updated_at = CURRENT_TIMESTAMP WHERE route_id = ? AND delivery_id = ? AND company_id = ?', [1000000 + i, route.id, ids[i], req.companyId]); for (let i = 0; i < ids.length; i += 1) await update('UPDATE delivery_route_stops SET sequence = ?, updated_at = CURRENT_TIMESTAMP WHERE route_id = ? AND delivery_id = ? AND company_id = ?', [i + 1, route.id, ids[i], req.companyId]); const updated = await getRouteForCompany(req, route.id); await writeAudit(req, 'reorder', 'delivery_route', route.id, null, { deliveryIds: ids }); res.json(updated);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/routes/:id/progress', requireRole(...routeReadRoles), async (req, res) => {
  try {
    const route = (await query('SELECT * FROM delivery_routes WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]; if (!route) return res.status(404).json({ message: 'Route not found.' }); if (['driver','delivery_driver'].includes(req.user.role) && route.driver_id !== req.user.id) return res.status(403).json({ message: 'Drivers may update only their assigned routes.' });
    const action = String(req.body?.action || ''); if (!['start','complete','skip','current'].includes(action)) return res.status(400).json({ message: 'Action must be start, complete, skip, or current.' }); const stopId = req.body?.stopId || req.body?.deliveryId; const stop = stopId ? (await query('SELECT * FROM delivery_route_stops WHERE route_id = ? AND company_id = ? AND (id = ? OR delivery_id = ?)', [route.id, req.companyId, Number(stopId), Number(stopId)]))[0] : null;
    if (['complete','skip','current'].includes(action) && !stop) return res.status(404).json({ message: 'Route stop not found.' });
    if (action === 'start') { if (route.status === 'completed' || route.status === 'cancelled') return res.status(409).json({ message: 'This route cannot be started.' }); await update("UPDATE delivery_routes SET status = 'in_progress', current_stop_sequence = COALESCE(current_stop_sequence, 1), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?", [route.id, req.companyId]); const first = (await query('SELECT * FROM delivery_route_stops WHERE route_id = ? AND company_id = ? ORDER BY sequence LIMIT 1', [route.id, req.companyId]))[0]; if (first) await update("UPDATE delivery_route_stops SET status = 'current', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'", [first.id]); }
    else if (action === 'current') { await update("UPDATE delivery_route_stops SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE route_id = ? AND company_id = ? AND status = 'current'", [route.id, req.companyId]); await update("UPDATE delivery_route_stops SET status = 'current', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND route_id = ? AND company_id = ?", [stop.id, route.id, req.companyId]); await update('UPDATE delivery_routes SET status = \'in_progress\', current_stop_sequence = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [stop.sequence, route.id, req.companyId]); }
    else { const nextStatus = action === 'complete' ? 'completed' : 'skipped'; await update('UPDATE delivery_route_stops SET status = ?, completed_at = CASE WHEN ? = \'completed\' THEN CURRENT_TIMESTAMP ELSE completed_at END, skipped_at = CASE WHEN ? = \'skipped\' THEN CURRENT_TIMESTAMP ELSE skipped_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND route_id = ? AND company_id = ?', [nextStatus, nextStatus, nextStatus, stop.id, route.id, req.companyId]); const next = (await query("SELECT * FROM delivery_route_stops WHERE route_id = ? AND company_id = ? AND status = 'pending' ORDER BY sequence LIMIT 1", [route.id, req.companyId]))[0]; if (next) { await update("UPDATE delivery_route_stops SET status = 'current', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?", [next.id]); await update('UPDATE delivery_routes SET status = \'in_progress\', current_stop_sequence = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [next.sequence, route.id]); } else await update("UPDATE delivery_routes SET status = 'completed', current_stop_sequence = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?", [route.id, req.companyId]); }
    const updated = await getRouteForCompany(req, route.id); await writeAudit(req, action, 'delivery_route', route.id, route, updated); res.json(updated);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/routes/:id/stops/:stopId', requireRole(...routeReadRoles), async (req, res) => {
  try { const route = (await query('SELECT * FROM delivery_routes WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]; if (!route) return res.status(404).json({ message: 'Route not found.' }); if (['driver','delivery_driver'].includes(req.user.role) && route.driver_id !== req.user.id) return res.status(403).json({ message: 'Drivers may update only their assigned routes.' }); const status = String(req.body?.status || ''); if (!routeStopStatuses.includes(status)) return res.status(400).json({ message: 'Invalid stop status.' }); const changed = await update('UPDATE delivery_route_stops SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND route_id = ? AND company_id = ?', [status, Number(req.params.stopId), route.id, req.companyId]); if (!changed.changes) return res.status(404).json({ message: 'Route stop not found.' }); await writeAudit(req, 'update_stop', 'delivery_route_stop', req.params.stopId, null, { status }); res.json(await getRouteForCompany(req, route.id)); } catch (error) { res.status(500).json({ message: error.message }); }
});

const territoryRoles = ['super_admin', 'company_admin', 'manager'];
const territoryReadRoles = ['super_admin', 'company_admin', 'manager', 'accountant', 'sales_staff', 'staff', 'driver', 'delivery_driver'];
const territoryLevels = ['country', 'city', 'area', 'zone', 'sector', 'route'];

async function getTerritory(id, companyId) {
  return (await query('SELECT * FROM service_areas WHERE id = ? AND company_id = ?', [Number(id), companyId]))[0] || null;
}

async function validateTerritoryParent(companyId, level, parentId) {
  const expectedParent = territoryLevels[territoryLevels.indexOf(level) - 1];
  if (!expectedParent) return null;
  if (!Number.isInteger(Number(parentId)) || Number(parentId) < 1) throw new Error(`${level} records require a ${expectedParent} parent.`);
  const parent = await getTerritory(parentId, companyId);
  if (!parent || parent.level !== expectedParent || !parent.active) throw new Error(`Selected parent must be an active ${expectedParent} in this company.`);
  return parent;
}

app.get('/api/territories', requireRole(...territoryReadRoles), async (req, res) => {
  try {
    const params = [req.companyId]; let sql = `SELECT a.*, p.name AS parent_name, COUNT(DISTINCT csa.customer_id) AS customer_count, COUNT(DISTINCT sad.driver_id) AS driver_count FROM service_areas a LEFT JOIN service_areas p ON p.id = a.parent_id AND p.company_id = a.company_id LEFT JOIN customer_service_areas csa ON csa.service_area_id = a.id AND csa.company_id = a.company_id LEFT JOIN service_area_drivers sad ON sad.service_area_id = a.id AND sad.company_id = a.company_id WHERE a.company_id = ?`;
    if (req.query.level && territoryLevels.includes(String(req.query.level))) { sql += ' AND a.level = ?'; params.push(String(req.query.level)); }
    if (req.query.parentId) { sql += ' AND a.parent_id = ?'; params.push(Number(req.query.parentId)); }
    sql += ' GROUP BY a.id ORDER BY CASE a.level WHEN \'country\' THEN 1 WHEN \'city\' THEN 2 WHEN \'area\' THEN 3 WHEN \'zone\' THEN 4 WHEN \'sector\' THEN 5 ELSE 6 END, a.name COLLATE NOCASE';
    res.json(await query(sql, params));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/territories', requireRole(...territoryRoles), async (req, res) => {
  try {
    const level = String(req.body?.level || '').trim().toLowerCase(); const name = String(req.body?.name || '').trim();
    if (!territoryLevels.includes(level) || !name || name.length > 120) return res.status(400).json({ message: 'A valid level and name (1-120 characters) are required.' });
    const parent = await validateTerritoryParent(req.companyId, level, req.body?.parentId);
    const code = String(req.body?.code || '').trim().slice(0, 40); const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? JSON.stringify(req.body.metadata) : '{}';
    const duplicate = await query('SELECT id FROM service_areas WHERE company_id = ? AND parent_id IS ? AND level = ? AND LOWER(name) = LOWER(?) LIMIT 1', [req.companyId, parent?.id || null, level, name]);
    if (duplicate[0]) return res.status(409).json({ message: 'A record with this name already exists under the selected parent.' });
    const row = await insert('INSERT INTO service_areas (company_id, parent_id, level, name, code, metadata, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.companyId, parent?.id || null, level, name, code, metadata, req.user.id]);
    await writeAudit(req, 'create', 'service_area', row.id, null, { level, name, parentId: parent?.id || null, code });
    res.status(201).json(await getTerritory(row.id, req.companyId));
  } catch (error) { res.status(/UNIQUE/i.test(error.message) ? 409 : 400).json({ message: /UNIQUE/i.test(error.message) ? 'A record with this name already exists under the selected parent.' : error.message }); }
});

app.patch('/api/territories/:id', requireRole(...territoryRoles), async (req, res) => {
  try {
    const current = await getTerritory(req.params.id, req.companyId); if (!current) return res.status(404).json({ message: 'Territory not found.' });
    const name = req.body?.name === undefined ? current.name : String(req.body.name).trim(); if (!name || name.length > 120) return res.status(400).json({ message: 'Name must be 1-120 characters.' });
    const active = req.body?.active === undefined ? current.active : (req.body.active ? 1 : 0);
    if (!active) { const children = await query('SELECT id FROM service_areas WHERE company_id = ? AND parent_id = ? AND active = 1 LIMIT 1', [req.companyId, current.id]); if (children[0]) return res.status(409).json({ message: 'Remove or deactivate child records first.' }); }
    await update('UPDATE service_areas SET name = ?, code = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [name, String(req.body?.code ?? current.code).trim().slice(0, 40), active, current.id, req.companyId]);
    const updated = await getTerritory(current.id, req.companyId); await writeAudit(req, 'update', 'service_area', current.id, current, updated); res.json(updated);
  } catch (error) { res.status(/UNIQUE/i.test(error.message) ? 409 : 400).json({ message: error.message }); }
});

app.delete('/api/territories/:id', requireRole(...territoryRoles), async (req, res) => {
  try {
    const current = await getTerritory(req.params.id, req.companyId); if (!current) return res.status(404).json({ message: 'Territory not found.' });
    const refs = await query('SELECT (SELECT COUNT(*) FROM service_areas WHERE parent_id = ?) AS children, (SELECT COUNT(*) FROM customer_service_areas WHERE service_area_id = ?) AS customers, (SELECT COUNT(*) FROM service_area_drivers WHERE service_area_id = ?) AS drivers', [current.id, current.id, current.id]);
    if (refs[0].children || refs[0].customers || refs[0].drivers) return res.status(409).json({ message: 'This record is in use. Deactivate it instead.' });
    await update('DELETE FROM service_areas WHERE id = ? AND company_id = ?', [current.id, req.companyId]); await writeAudit(req, 'delete', 'service_area', current.id, current, null); res.json({ success: true });
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('/api/territories/assignments', requireRole(...territoryReadRoles), async (req, res) => {
  try {
    const customers = await query(`SELECT c.id, c.name, c.phone, c.address, csa.service_area_id, a.name AS service_area_name, a.level AS service_area_level FROM customers c LEFT JOIN customer_service_areas csa ON csa.customer_id = c.id AND csa.company_id = c.company_id LEFT JOIN service_areas a ON a.id = csa.service_area_id AND a.company_id = c.company_id WHERE c.company_id = ? ORDER BY c.name COLLATE NOCASE`, [req.companyId]);
    const drivers = await query(`SELECT u.id, u.name, u.role, sad.service_area_id, a.name AS service_area_name FROM users u LEFT JOIN service_area_drivers sad ON sad.driver_id = u.id AND sad.company_id = u.company_id LEFT JOIN service_areas a ON a.id = sad.service_area_id AND a.company_id = sad.company_id WHERE u.company_id = ? AND u.active = 1 AND u.role IN ('driver','delivery_driver') ORDER BY u.name COLLATE NOCASE`, [req.companyId]);
    res.json({ customers, drivers });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.put('/api/territories/customers/:customerId', requireRole(...territoryRoles), async (req, res) => {
  try {
    const customer = (await query('SELECT id FROM customers WHERE id = ? AND company_id = ?', [Number(req.params.customerId), req.companyId]))[0]; if (!customer) return res.status(404).json({ message: 'Customer not found.' });
    const area = await getTerritory(req.body?.serviceAreaId, req.companyId); if (!area || !area.active) return res.status(400).json({ message: 'Select an active territory.' });
    const previous = (await query('SELECT * FROM customer_service_areas WHERE customer_id = ? AND company_id = ?', [customer.id, req.companyId]))[0] || null;
    await update('DELETE FROM customer_service_areas WHERE customer_id = ? AND company_id = ?', [customer.id, req.companyId]); await insert('INSERT INTO customer_service_areas (company_id, customer_id, service_area_id, assigned_by) VALUES (?, ?, ?, ?)', [req.companyId, customer.id, area.id, req.user.id]);
    await writeAudit(req, 'assign_customer', 'customer_service_area', customer.id, previous, { serviceAreaId: area.id }); res.json({ success: true, serviceAreaId: area.id });
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.put('/api/territories/drivers/:driverId', requireRole(...territoryRoles), async (req, res) => {
  try {
    const driver = (await query("SELECT id, name, role FROM users WHERE id = ? AND company_id = ? AND active = 1 AND role IN ('driver','delivery_driver')", [Number(req.params.driverId), req.companyId]))[0]; if (!driver) return res.status(404).json({ message: 'Active driver not found.' });
    const area = await getTerritory(req.body?.serviceAreaId, req.companyId); if (!area || !area.active) return res.status(400).json({ message: 'Select an active territory.' });
    await insert('INSERT OR IGNORE INTO service_area_drivers (company_id, service_area_id, driver_id, assigned_by) VALUES (?, ?, ?, ?)', [req.companyId, area.id, driver.id, req.user.id]); await writeAudit(req, 'assign_driver', 'service_area_driver', driver.id, null, { serviceAreaId: area.id }); res.json({ success: true });
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.delete('/api/territories/drivers/:driverId/:serviceAreaId', requireRole(...territoryRoles), async (req, res) => {
  try { await update('DELETE FROM service_area_drivers WHERE company_id = ? AND driver_id = ? AND service_area_id = ?', [req.companyId, Number(req.params.driverId), Number(req.params.serviceAreaId)]); await writeAudit(req, 'unassign_driver', 'service_area_driver', req.params.driverId, null, { serviceAreaId: Number(req.params.serviceAreaId) }); res.json({ success: true }); } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('/api/dashboard/territories', requireRole(...territoryReadRoles), async (req, res) => {
  try {
    const [counts, summary] = await Promise.all([
      query('SELECT level, COUNT(*) AS count FROM service_areas WHERE company_id = ? AND active = 1 GROUP BY level', [req.companyId]),
      query(`SELECT a.id, a.name, a.level, COUNT(DISTINCT csa.customer_id) AS customers, COUNT(DISTINCT sad.driver_id) AS drivers, COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(o.total_amount), 0) AS order_value FROM service_areas a LEFT JOIN customer_service_areas csa ON csa.service_area_id = a.id AND csa.company_id = a.company_id LEFT JOIN service_area_drivers sad ON sad.service_area_id = a.id AND sad.company_id = a.company_id LEFT JOIN orders o ON o.customer_id = csa.customer_id AND o.company_id = a.company_id WHERE a.company_id = ? AND a.active = 1 GROUP BY a.id ORDER BY order_value DESC, a.name COLLATE NOCASE`, [req.companyId])
    ]); res.json({ counts, summary });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

// Customer Loyalty, Referral and Salesman CRM APIs.
const crmReadRoles = ['super_admin', 'company_admin', 'manager', 'sales_staff', 'staff', 'accountant'];
const crmManageRoles = ['super_admin', 'company_admin', 'manager'];
const crmSalesRoles = ['super_admin', 'company_admin', 'manager', 'sales_staff', 'staff'];
const salesmanRoles = ['super_admin', 'company_admin', 'manager', 'sales_staff', 'staff'];
const defaultLoyaltyTiers = [
  { name: 'Bronze', minimumPoints: 0, multiplier: 1, rewardPercent: 0 },
  { name: 'Silver', minimumPoints: 500, multiplier: 1.1, rewardPercent: 2 },
  { name: 'Gold', minimumPoints: 1500, multiplier: 1.25, rewardPercent: 5 },
  { name: 'Platinum', minimumPoints: 5000, multiplier: 1.5, rewardPercent: 8 }
];

async function ensureLoyaltyTiers(companyId) {
  for (const tier of defaultLoyaltyTiers) await insert('INSERT OR IGNORE INTO loyalty_tiers (company_id, name, minimum_points, multiplier, reward_percent) VALUES (?, ?, ?, ?, ?)', [companyId, tier.name, tier.minimumPoints, tier.multiplier, tier.rewardPercent]);
}
async function getCustomer(companyId, customerId) { return (await query('SELECT * FROM customers WHERE id = ? AND company_id = ?', [Number(customerId), companyId]))[0] || null; }
async function ensureLoyaltyAccount(companyId, customerId) {
  await ensureLoyaltyTiers(companyId);
  await insert('INSERT OR IGNORE INTO loyalty_accounts (company_id, customer_id, tier_id) VALUES (?, ?, (SELECT id FROM loyalty_tiers WHERE company_id = ? ORDER BY minimum_points LIMIT 1))', [companyId, customerId, companyId]);
  return (await query('SELECT la.*, lt.name AS tier_name, lt.multiplier, lt.reward_percent FROM loyalty_accounts la LEFT JOIN loyalty_tiers lt ON lt.id = la.tier_id WHERE la.company_id = ? AND la.customer_id = ?', [companyId, customerId]))[0];
}
async function refreshLoyaltyTier(companyId, customerId) {
  const account = await ensureLoyaltyAccount(companyId, customerId);
  const tier = (await query('SELECT * FROM loyalty_tiers WHERE company_id = ? AND active = 1 AND minimum_points <= ? ORDER BY minimum_points DESC LIMIT 1', [companyId, account.lifetime_points]))[0];
  if (tier && tier.id !== account.tier_id) await update('UPDATE loyalty_accounts SET tier_id = ? WHERE company_id = ? AND customer_id = ?', [tier.id, companyId, customerId]);
  return (await query('SELECT la.*, lt.name AS tier_name, lt.multiplier, lt.reward_percent FROM loyalty_accounts la LEFT JOIN loyalty_tiers lt ON lt.id = la.tier_id WHERE la.company_id = ? AND la.customer_id = ?', [companyId, customerId]))[0];
}
async function awardLoyalty(req, customerId, amount, sourceType, sourceId, description) {
  if (!customerId || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return null;
  const account = await ensureLoyaltyAccount(req.companyId, customerId);
  const key = `${sourceType}:${sourceId}:earn`;
  const points = Math.max(0, Math.floor(Number(amount) / 100 * Number(account.multiplier || 1)));
  if (!points) return account;
  const existing = await query('SELECT id FROM loyalty_transactions WHERE company_id = ? AND idempotency_key = ?', [req.companyId, key]);
  if (!existing[0]) {
    await insert('INSERT INTO loyalty_transactions (company_id, customer_id, account_id, order_id, sale_id, type, points, description, idempotency_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, customerId, account.id, sourceType === 'order' ? sourceId : null, sourceType === 'sale' ? sourceId : null, 'earn', points, description, key, req.user.id]);
    await update('UPDATE loyalty_accounts SET points_balance = points_balance + ?, lifetime_points = lifetime_points + ?, total_spend = total_spend + ?, last_earned_at = CURRENT_TIMESTAMP WHERE id = ?', [points, points, Number(amount), account.id]);
    await refreshLoyaltyTier(req.companyId, customerId);
  }
  return refreshLoyaltyTier(req.companyId, customerId);
}
async function backfillLoyaltyForCompany(req) {
  const historicalSales = await query(`SELECT s.id, s.customer_name, s.total_amount, c.id AS customer_id FROM sales s JOIN customers c ON c.company_id = s.company_id AND c.name = s.customer_name WHERE s.company_id = ? AND s.customer_id IS NULL`, [req.companyId]);
  for (const sale of historicalSales) {
    await update('UPDATE sales SET customer_id = ? WHERE id = ? AND company_id = ? AND customer_id IS NULL', [sale.customer_id, sale.id, req.companyId]);
    await awardLoyalty(req, sale.customer_id, sale.total_amount, 'sale', sale.id, `Points earned on historical sale #${sale.id}`);
  }
}
async function awardReferral(req, customerId, saleId) {
  const referral = (await query('SELECT r.*, rc.reward_points FROM referrals r JOIN referral_codes rc ON rc.id = r.referral_code_id WHERE r.company_id = ? AND r.referred_customer_id = ? AND r.status = \'pending\'', [req.companyId, customerId]))[0];
  if (!referral) return;
  await update('UPDATE referrals SET status = \'qualified\', qualified_sale_id = ? WHERE id = ? AND company_id = ?', [saleId, referral.id, req.companyId]);
  const referrer = await ensureLoyaltyAccount(req.companyId, referral.referrer_customer_id);
  const key = `referral:${referral.id}`;
  if (!(await query('SELECT id FROM loyalty_transactions WHERE company_id = ? AND idempotency_key = ?', [req.companyId, key]))[0]) {
    await insert('INSERT INTO loyalty_transactions (company_id, customer_id, account_id, sale_id, type, points, description, idempotency_key, created_by) VALUES (?, ?, ?, ?, \'referral_reward\', ?, ?, ?, ?)', [req.companyId, referral.referrer_customer_id, referrer.id, saleId, referral.reward_points, 'Referral reward', key, req.user.id]);
    await update('UPDATE loyalty_accounts SET points_balance = points_balance + ?, lifetime_points = lifetime_points + ? WHERE id = ?', [referral.reward_points, referral.reward_points, referrer.id]);
    await refreshLoyaltyTier(req.companyId, referral.referrer_customer_id);
    await update('UPDATE referrals SET status = \'rewarded\', rewarded_at = CURRENT_TIMESTAMP WHERE id = ?', [referral.id]);
  }
}

app.get('/api/loyalty', requireRole(...crmReadRoles), async (req, res) => {
  try {
    await backfillLoyaltyForCompany(req);
    await ensureLoyaltyTiers(req.companyId);
    const customers = await query(`SELECT c.id, c.name, c.phone, c.email, la.points_balance, la.lifetime_points, la.total_spend, COALESCE(lt.name, 'Bronze') AS tier_name, la.last_earned_at FROM customers c LEFT JOIN loyalty_accounts la ON la.customer_id = c.id AND la.company_id = c.company_id LEFT JOIN loyalty_tiers lt ON lt.id = la.tier_id WHERE c.company_id = ? ORDER BY la.lifetime_points DESC, c.name COLLATE NOCASE`, [req.companyId]);
    const tiers = await query('SELECT * FROM loyalty_tiers WHERE company_id = ? AND active = 1 ORDER BY minimum_points', [req.companyId]);
    const transactions = await query('SELECT lt.*, c.name AS customer_name FROM loyalty_transactions lt JOIN customers c ON c.id = lt.customer_id AND c.company_id = lt.company_id WHERE lt.company_id = ? ORDER BY lt.id DESC LIMIT 100', [req.companyId]);
    await writeAudit(req, 'view', 'loyalty_dashboard', null, null, { customerCount: customers.length });
    res.json({ customers, tiers, transactions });
  } catch (error) { res.status(500).json({ message: error.message }); }
});
app.get('/api/loyalty/customers/:id', requireRole(...crmReadRoles), async (req, res) => {
  try { const customer = await getCustomer(req.companyId, req.params.id); if (!customer) return res.status(404).json({ message: 'Customer not found.' }); const account = await refreshLoyaltyTier(req.companyId, customer.id); const transactions = await query('SELECT * FROM loyalty_transactions WHERE company_id = ? AND customer_id = ? ORDER BY id DESC LIMIT 100', [req.companyId, customer.id]); res.json({ customer, account, transactions }); } catch (error) { res.status(500).json({ message: error.message }); }
});
app.post('/api/loyalty/adjust', requireRole(...crmManageRoles), async (req, res) => {
  try { const customer = await getCustomer(req.companyId, req.body?.customerId); const points = Number(req.body?.points); if (!customer || !Number.isInteger(points) || points === 0 || Math.abs(points) > 1000000) return res.status(400).json({ message: 'Customer and a non-zero points adjustment are required.' }); const account = await ensureLoyaltyAccount(req.companyId, customer.id); if (points < 0 && account.points_balance + points < 0) return res.status(400).json({ message: 'Points balance cannot become negative.' }); await insert('INSERT INTO loyalty_transactions (company_id, customer_id, account_id, type, points, description, created_by) VALUES (?, ?, ?, \'adjust\', ?, ?, ?)', [req.companyId, customer.id, account.id, points, String(req.body?.description || 'Manual adjustment').slice(0, 240), req.user.id]); await update('UPDATE loyalty_accounts SET points_balance = MAX(0, points_balance + ?), lifetime_points = MAX(0, lifetime_points + ?) WHERE id = ?', [points, Math.max(0, points), account.id]); const updated = await refreshLoyaltyTier(req.companyId, customer.id); await writeAudit(req, 'adjust', 'loyalty_account', customer.id, account, updated); res.json(updated); } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('/api/referrals', requireRole(...crmReadRoles), async (req, res) => {
  try { const codes = await query('SELECT rc.*, c.name AS customer_name, COUNT(r.id) AS referral_count, SUM(r.status = \'rewarded\') AS rewarded_count FROM referral_codes rc JOIN customers c ON c.id = rc.customer_id AND c.company_id = rc.company_id LEFT JOIN referrals r ON r.referral_code_id = rc.id AND r.company_id = rc.company_id WHERE rc.company_id = ? GROUP BY rc.id ORDER BY rc.id DESC', [req.companyId]); const referrals = await query('SELECT r.*, rc.code, a.name AS referrer_name, b.name AS referred_name FROM referrals r JOIN referral_codes rc ON rc.id = r.referral_code_id JOIN customers a ON a.id = r.referrer_customer_id AND a.company_id = r.company_id JOIN customers b ON b.id = r.referred_customer_id AND b.company_id = r.company_id WHERE r.company_id = ? ORDER BY r.id DESC', [req.companyId]); res.json({ codes, referrals }); } catch (error) { res.status(500).json({ message: error.message }); }
});
app.post('/api/referrals/codes', requireRole(...crmSalesRoles), async (req, res) => {
  try { const customer = await getCustomer(req.companyId, req.body?.customerId); if (!customer) return res.status(404).json({ message: 'Customer not found.' }); const existing = (await query('SELECT * FROM referral_codes WHERE company_id = ? AND customer_id = ?', [req.companyId, customer.id]))[0]; if (existing) return res.json(existing); const code = `TEMO-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; const result = await insert('INSERT INTO referral_codes (company_id, customer_id, code, reward_points) VALUES (?, ?, ?, ?)', [req.companyId, customer.id, code, Math.max(0, Math.min(10000, Number(req.body?.rewardPoints || 100)))]); const created = (await query('SELECT * FROM referral_codes WHERE id = ?', [result.id]))[0]; await writeAudit(req, 'create', 'referral_code', result.id, null, created); res.status(201).json(created); } catch (error) { res.status(400).json({ message: error.message }); }
});
app.post('/api/referrals/redeem', requireRole(...crmSalesRoles), async (req, res) => {
  try { const customer = await getCustomer(req.companyId, req.body?.referredCustomerId); const code = (await query('SELECT * FROM referral_codes WHERE company_id = ? AND UPPER(code) = UPPER(?) AND status = \'active\'', [req.companyId, String(req.body?.code || '').trim()]))[0]; if (!customer || !code) return res.status(400).json({ message: 'Active referral code and referred customer are required.' }); if (customer.id === code.customer_id) return res.status(400).json({ message: 'A customer cannot refer themselves.' }); if ((await query('SELECT id FROM referrals WHERE company_id = ? AND referred_customer_id = ?', [req.companyId, customer.id]))[0]) return res.status(409).json({ message: 'This customer already has a referral.' }); const result = await insert('INSERT INTO referrals (company_id, referral_code_id, referrer_customer_id, referred_customer_id) VALUES (?, ?, ?, ?)', [req.companyId, code.id, code.customer_id, customer.id]); const created = (await query('SELECT * FROM referrals WHERE id = ?', [result.id]))[0]; await writeAudit(req, 'create', 'referral', result.id, null, created); res.status(201).json(created); } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('/api/salesmen', requireRole(...crmReadRoles), async (req, res) => {
  try { const salesmen = await query(`SELECT id, name, username, role FROM users WHERE company_id = ? AND active = 1 AND role IN (${salesmanRoles.map(() => '?').join(',')}) ORDER BY name COLLATE NOCASE`, [req.companyId, ...salesmanRoles]); const assignments = await query('SELECT sa.*, c.name AS customer_name, u.name AS salesman_name FROM salesman_assignments sa JOIN customers c ON c.id = sa.customer_id AND c.company_id = sa.company_id JOIN users u ON u.id = sa.salesman_id AND u.company_id = sa.company_id WHERE sa.company_id = ? AND sa.active = 1 ORDER BY c.name COLLATE NOCASE', [req.companyId]); const activities = await query('SELECT a.*, u.name AS salesman_name, c.name AS customer_name FROM salesman_activities a JOIN users u ON u.id = a.salesman_id AND u.company_id = a.company_id LEFT JOIN customers c ON c.id = a.customer_id AND c.company_id = a.company_id WHERE a.company_id = ? ORDER BY a.activity_at DESC, a.id DESC LIMIT 200', [req.companyId]); const performance = await query(`SELECT u.id, u.name, COUNT(DISTINCT sa.customer_id) AS assigned_customers, COUNT(DISTINCT a.id) AS activity_count, COUNT(DISTINCT s.id) AS sale_count, COALESCE(SUM(s.total_amount), 0) AS sales_value FROM users u LEFT JOIN salesman_assignments sa ON sa.salesman_id = u.id AND sa.company_id = u.company_id AND sa.active = 1 LEFT JOIN salesman_activities a ON a.salesman_id = u.id AND a.company_id = u.company_id LEFT JOIN sales s ON s.salesman_id = u.id AND s.company_id = u.company_id WHERE u.company_id = ? AND u.active = 1 AND u.role IN (${salesmanRoles.map(() => '?').join(',')}) GROUP BY u.id ORDER BY sales_value DESC, activity_count DESC`, [req.companyId, ...salesmanRoles]); res.json({ salesmen, assignments, activities, performance }); } catch (error) { res.status(500).json({ message: error.message }); }
});
app.put('/api/salesmen/assignments/:customerId', requireRole(...crmManageRoles), async (req, res) => {
  try { const customer = await getCustomer(req.companyId, req.params.customerId); const salesman = (await query(`SELECT id, name, role FROM users WHERE id = ? AND company_id = ? AND active = 1 AND role IN (${salesmanRoles.map(() => '?').join(',')})`, [Number(req.body?.salesmanId), req.companyId, ...salesmanRoles]))[0]; if (!customer || !salesman) return res.status(400).json({ message: 'Customer and active salesman are required.' }); const previous = (await query('SELECT * FROM salesman_assignments WHERE company_id = ? AND customer_id = ?', [req.companyId, customer.id]))[0] || null; await update('INSERT INTO salesman_assignments (company_id, customer_id, salesman_id, assigned_by, active) VALUES (?, ?, ?, ?, 1) ON CONFLICT(company_id, customer_id) DO UPDATE SET salesman_id = excluded.salesman_id, assigned_by = excluded.assigned_by, active = 1, assigned_at = CURRENT_TIMESTAMP', [req.companyId, customer.id, salesman.id, req.user.id]); const updated = (await query('SELECT * FROM salesman_assignments WHERE company_id = ? AND customer_id = ?', [req.companyId, customer.id]))[0]; await writeAudit(req, 'assign', 'salesman_assignment', customer.id, previous, updated); res.json(updated); } catch (error) { res.status(400).json({ message: error.message }); }
});
app.post('/api/salesmen/activities', requireRole(...salesmanRoles), async (req, res) => {
  try { const type = String(req.body?.activityType || '').trim(); if (!['call','visit','message','note','follow_up','sale'].includes(type)) return res.status(400).json({ message: 'Invalid activity type.' }); const customer = req.body?.customerId ? await getCustomer(req.companyId, req.body.customerId) : null; const salesmanId = req.user.role === 'sales_staff' || req.user.role === 'staff' ? req.user.id : Number(req.body?.salesmanId || req.user.id); const salesman = (await query(`SELECT id FROM users WHERE id = ? AND company_id = ? AND active = 1 AND role IN (${salesmanRoles.map(() => '?').join(',')})`, [salesmanId, req.companyId, ...salesmanRoles]))[0]; if (!salesman || (req.body?.customerId && !customer)) return res.status(400).json({ message: 'Valid salesman and customer are required.' }); const result = await insert('INSERT INTO salesman_activities (company_id, salesman_id, customer_id, order_id, activity_type, notes, activity_at, created_by) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)', [req.companyId, salesman.id, customer?.id || null, req.body?.orderId ? Number(req.body.orderId) : null, type, String(req.body?.notes || '').trim().slice(0, 2000), req.body?.activityAt || null, req.user.id]); const created = (await query('SELECT * FROM salesman_activities WHERE id = ?', [result.id]))[0]; await writeAudit(req, 'create', 'salesman_activity', result.id, null, created); res.status(201).json(created); } catch (error) { res.status(400).json({ message: error.message }); }
});
app.get('/api/reports/loyalty', requireRole(...crmReadRoles), async (req, res) => {
  try { await backfillLoyaltyForCompany(req); await ensureLoyaltyTiers(req.companyId); const rows = await query(`SELECT COALESCE(lt.name, 'Bronze') AS tier, COUNT(c.id) AS customers, COALESCE(SUM(la.points_balance), 0) AS points_balance, COALESCE(SUM(la.lifetime_points), 0) AS lifetime_points, COALESCE(SUM(la.total_spend), 0) AS spend FROM customers c LEFT JOIN loyalty_accounts la ON la.customer_id = c.id AND la.company_id = c.company_id LEFT JOIN loyalty_tiers lt ON lt.id = la.tier_id WHERE c.company_id = ? GROUP BY tier ORDER BY MIN(COALESCE(lt.minimum_points, 0))`, [req.companyId]); const referral = await query('SELECT status, COUNT(*) AS count FROM referrals WHERE company_id = ? GROUP BY status', [req.companyId]); const performance = await query(`SELECT u.name, COUNT(DISTINCT sa.customer_id) AS customers, COUNT(DISTINCT a.id) AS activities, COALESCE(SUM(s.total_amount), 0) AS sales_value FROM users u LEFT JOIN salesman_assignments sa ON sa.salesman_id = u.id AND sa.company_id = u.company_id AND sa.active = 1 LEFT JOIN salesman_activities a ON a.salesman_id = u.id AND a.company_id = u.company_id LEFT JOIN sales s ON s.salesman_id = u.id AND s.company_id = u.company_id WHERE u.company_id = ? AND u.active = 1 AND u.role IN ('company_admin','manager','sales_staff','staff') GROUP BY u.id ORDER BY sales_value DESC`, [req.companyId]); await writeAudit(req, 'view', 'crm_report', null, null, { report: 'loyalty_referrals_salesmen' }); res.json({ loyalty: rows, referrals: referral, salesmen: performance }); } catch (error) { res.status(500).json({ message: error.message }); }
});

const productionReadRoles = ['super_admin', 'company_admin', 'manager', 'accountant', 'staff', 'lab_technician', 'quality_manager', 'production_manager'];
const productionManageRoles = ['super_admin', 'company_admin', 'manager', 'production_manager'];
const labManageRoles = ['super_admin', 'company_admin', 'manager', 'quality_manager', 'lab_technician'];

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be greater than zero.`);
  return number;
}

async function companyProduct(companyId, productId) {
  return (await query('SELECT * FROM products WHERE id = ? AND company_id = ?', [Number(productId), companyId]))[0] || null;
}

async function companyBatch(companyId, batchId) {
  return (await query('SELECT pb.*, p.name AS product_name, pl.name AS line_name FROM production_batches pb JOIN products p ON p.id = pb.product_id AND p.company_id = pb.company_id LEFT JOIN production_lines pl ON pl.id = pb.line_id AND pl.company_id = pb.company_id WHERE pb.id = ? AND pb.company_id = ?', [Number(batchId), companyId]))[0] || null;
}

app.get('/api/production/lines', requireRole(...productionReadRoles), async (req, res) => {
  try { res.json(await query('SELECT * FROM production_lines WHERE company_id = ? ORDER BY name COLLATE NOCASE', [req.companyId])); } catch (error) { res.status(500).json({ message: error.message }); }
});
app.post('/api/production/lines', requireRole(...productionManageRoles), async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 120) return res.status(400).json({ message: 'A line name is required.' });
    const requestedCode = String(req.body?.code || '').trim().slice(0, 40); const code = requestedCode || `LINE-${Date.now()}`; const result = await insert('INSERT INTO production_lines (company_id, name, code, location, status, capacity_per_hour, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.companyId, name, code, String(req.body?.location || '').trim().slice(0, 160), ['active','maintenance','inactive'].includes(req.body?.status) ? req.body.status : 'active', req.body?.capacityPerHour ? positiveNumber(req.body.capacityPerHour, 'Capacity') : null, req.user.id]);
    const line = (await query('SELECT * FROM production_lines WHERE id = ?', [result.id]))[0]; await writeAudit(req, 'create', 'production_line', result.id, null, line); res.status(201).json(line);
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('/api/production/batches', requireRole(...productionReadRoles), async (req, res) => {
  try {
    const batches = await query(`SELECT pb.*, p.name AS product_name, pl.name AS line_name, u.name AS creator_name,
      (SELECT COUNT(*) FROM lab_tests lt WHERE lt.batch_id = pb.id AND lt.company_id = pb.company_id) AS lab_test_count,
      (SELECT COUNT(*) FROM quality_certificates qc WHERE qc.batch_id = pb.id AND qc.company_id = pb.company_id AND qc.status = 'active') AS certificate_count
      FROM production_batches pb JOIN products p ON p.id = pb.product_id AND p.company_id = pb.company_id LEFT JOIN production_lines pl ON pl.id = pb.line_id AND pl.company_id = pb.company_id LEFT JOIN users u ON u.id = pb.created_by
      WHERE pb.company_id = ? ORDER BY pb.id DESC`, [req.companyId]);
    res.json(batches);
  } catch (error) { res.status(500).json({ message: error.message }); }
});
app.post('/api/production/batches', requireRole(...productionManageRoles), async (req, res) => {
  try {
    const product = await companyProduct(req.companyId, req.body?.productId);
    const planned = positiveNumber(req.body?.plannedQuantity, 'Planned quantity');
    if (!product) return res.status(400).json({ message: 'Select an existing company product.' });
    const batchNumber = String(req.body?.batchNumber || '').trim();
    if (!batchNumber || batchNumber.length > 60) return res.status(400).json({ message: 'A unique batch number is required.' });
    if (req.body?.lineId && !(await query('SELECT id FROM production_lines WHERE id = ? AND company_id = ?', [Number(req.body.lineId), req.companyId]))[0]) return res.status(400).json({ message: 'Production line is not in this company.' });
    const result = await insert('INSERT INTO production_batches (company_id, batch_number, product_id, planned_quantity, unit, line_id, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, batchNumber, product.id, planned, String(product.unit || req.body?.unit || 'unit').slice(0, 20), req.body?.lineId ? Number(req.body.lineId) : null, String(req.body?.notes || '').slice(0, 1000), req.user.id]);
    const batch = await companyBatch(req.companyId, result.id); await writeAudit(req, 'create', 'production_batch', result.id, null, batch); res.status(201).json(batch);
  } catch (error) { res.status(400).json({ message: error.message }); }
});
app.post('/api/production/batches/:id/inputs', requireRole(...productionManageRoles), async (req, res) => {
  try {
    const batch = await companyBatch(req.companyId, req.params.id); const product = await companyProduct(req.companyId, req.body?.productId); const planned = positiveNumber(req.body?.plannedQuantity, 'Input quantity');
    if (!batch || !product) return res.status(404).json({ message: 'Batch or input product not found in this company.' });
    if (['completed','released','cancelled'].includes(batch.status)) return res.status(409).json({ message: 'Inputs cannot be changed after completion.' });
    const result = await insert('INSERT INTO production_batch_inputs (company_id, batch_id, product_id, planned_quantity, warehouse_id) VALUES (?, ?, ?, ?, ?)', [req.companyId, batch.id, product.id, planned, req.body?.warehouseId ? Number(req.body.warehouseId) : null]);
    const input = (await query('SELECT pbi.*, p.name AS product_name FROM production_batch_inputs pbi JOIN products p ON p.id = pbi.product_id WHERE pbi.id = ?', [result.id]))[0]; await writeAudit(req, 'create', 'production_batch_input', result.id, null, input); res.status(201).json(input);
  } catch (error) { res.status(400).json({ message: error.message }); }
});
app.get('/api/production/batches/:id/inputs', requireRole(...productionReadRoles), async (req, res) => {
  try { if (!(await companyBatch(req.companyId, req.params.id))) return res.status(404).json({ message: 'Batch not found.' }); res.json(await query('SELECT pbi.*, p.name AS product_name, p.unit FROM production_batch_inputs pbi JOIN products p ON p.id = pbi.product_id WHERE pbi.company_id = ? AND pbi.batch_id = ? ORDER BY pbi.id', [req.companyId, Number(req.params.id)])); } catch (error) { res.status(500).json({ message: error.message }); }
});
app.post('/api/production/batches/:id/start', requireRole(...productionManageRoles), async (req, res) => {
  try { const batch = await companyBatch(req.companyId, req.params.id); if (!batch) return res.status(404).json({ message: 'Batch not found.' }); if (batch.status !== 'draft') return res.status(409).json({ message: 'Only draft batches can be started.' }); const inputs = await query('SELECT * FROM production_batch_inputs WHERE company_id = ? AND batch_id = ?', [req.companyId, batch.id]); if (!inputs.length) return res.status(400).json({ message: 'Add at least one raw material input before starting.' }); for (const input of inputs) { const product = await companyProduct(req.companyId, input.product_id); if (!product || Number(product.stock || 0) < Number(input.planned_quantity)) return res.status(409).json({ message: `Insufficient stock for ${product?.name || 'input product'}.` }); } for (const input of inputs) { await update('UPDATE products SET stock = stock - ? WHERE id = ? AND company_id = ?', [input.planned_quantity, input.product_id, req.companyId]); await update('UPDATE production_batch_inputs SET consumed_quantity = planned_quantity WHERE id = ? AND company_id = ?', [input.id, req.companyId]); await insert('INSERT INTO stock_movements (company_id, warehouse_id, product_id, movement_type, quantity, reference, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, input.warehouse_id, input.product_id, 'production_consumption', -Math.round(input.planned_quantity), `Batch ${batch.batch_number}`, 'Raw material consumed by production batch', req.user.id]); } await update("UPDATE production_batches SET status = 'in_progress', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?", [batch.id, req.companyId]); const updated = await companyBatch(req.companyId, batch.id); await writeAudit(req, 'start', 'production_batch', batch.id, batch, updated); res.json(updated); } catch (error) { res.status(400).json({ message: error.message }); }
});
app.post('/api/production/batches/:id/complete', requireRole(...productionManageRoles), async (req, res) => {
  try { const batch = await companyBatch(req.companyId, req.params.id); const actual = positiveNumber(req.body?.actualQuantity, 'Actual quantity'); if (!batch) return res.status(404).json({ message: 'Batch not found.' }); if (batch.status !== 'in_progress') return res.status(409).json({ message: 'Only in-progress batches can be completed.' }); if (actual > batch.planned_quantity * 1.5) return res.status(400).json({ message: 'Actual quantity exceeds the permitted variance.' }); await update("UPDATE products SET stock = stock + ? WHERE id = ? AND company_id = ?", [Math.round(actual), batch.product_id, req.companyId]); await insert('INSERT INTO stock_movements (company_id, product_id, movement_type, quantity, reference, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.companyId, batch.product_id, 'production_output', Math.round(actual), `Batch ${batch.batch_number}`, 'Finished goods received from production', req.user.id]); await update("UPDATE production_batches SET status = 'completed', actual_quantity = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?", [actual, batch.id, req.companyId]); const updated = await companyBatch(req.companyId, batch.id); await writeAudit(req, 'complete', 'production_batch', batch.id, batch, updated); res.json(updated); } catch (error) { res.status(400).json({ message: error.message }); }
});
app.post('/api/production/batches/:id/release', requireRole(...productionManageRoles), async (req, res) => {
  try { const batch = await companyBatch(req.companyId, req.params.id); if (!batch) return res.status(404).json({ message: 'Batch not found.' }); const test = (await query("SELECT * FROM lab_tests WHERE company_id = ? AND batch_id = ? AND status IN ('passed','released') ORDER BY id DESC LIMIT 1", [req.companyId, batch.id]))[0]; if (batch.status !== 'completed' || !test) return res.status(409).json({ message: 'A completed batch requires a passed lab test before release.' }); await update("UPDATE production_batches SET status = 'released', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?", [batch.id, req.companyId]); const updated = await companyBatch(req.companyId, batch.id); await writeAudit(req, 'release', 'production_batch', batch.id, batch, updated); res.json(updated); } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('/api/lab/parameters', requireRole(...productionReadRoles), async (req, res) => { try { res.json(await query('SELECT * FROM lab_parameters WHERE company_id = ? ORDER BY name COLLATE NOCASE', [req.companyId])); } catch (error) { res.status(500).json({ message: error.message }); } });
app.post('/api/lab/parameters', requireRole(...labManageRoles), async (req, res) => { try { const name = String(req.body?.name || '').trim(); if (!name || name.length > 120) return res.status(400).json({ message: 'Parameter name is required.' }); const min = req.body?.minValue === '' || req.body?.minValue == null ? null : Number(req.body.minValue); const max = req.body?.maxValue === '' || req.body?.maxValue == null ? null : Number(req.body.maxValue); if ((min != null && !Number.isFinite(min)) || (max != null && !Number.isFinite(max)) || (min != null && max != null && min > max)) return res.status(400).json({ message: 'Parameter limits are invalid.' }); const result = await insert('INSERT INTO lab_parameters (company_id, name, unit, min_value, max_value, allowed_text, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.companyId, name, String(req.body?.unit || '').slice(0, 30), min, max, String(req.body?.allowedText || '').slice(0, 500), req.user.id]); const row = (await query('SELECT * FROM lab_parameters WHERE id = ?', [result.id]))[0]; await writeAudit(req, 'create', 'lab_parameter', result.id, null, row); res.status(201).json(row); } catch (error) { res.status(400).json({ message: error.message }); } });
app.get('/api/lab/tests', requireRole(...productionReadRoles), async (req, res) => { try { res.json(await query('SELECT lt.*, pb.batch_number, p.name AS product_name, u.name AS tester_name FROM lab_tests lt JOIN production_batches pb ON pb.id = lt.batch_id AND pb.company_id = lt.company_id JOIN products p ON p.id = pb.product_id AND p.company_id = pb.company_id LEFT JOIN users u ON u.id = lt.tested_by WHERE lt.company_id = ? ORDER BY lt.id DESC', [req.companyId])); } catch (error) { res.status(500).json({ message: error.message }); } });
app.post('/api/lab/tests', requireRole(...labManageRoles), async (req, res) => { try { const batch = await companyBatch(req.companyId, req.body?.batchId); if (!batch) return res.status(404).json({ message: 'Batch not found.' }); if (!['completed','released'].includes(batch.status)) return res.status(409).json({ message: 'Lab testing starts after batch completion.' }); const testNumber = String(req.body?.testNumber || '').trim(); if (!testNumber) return res.status(400).json({ message: 'A unique test number is required.' }); const result = await insert('INSERT INTO lab_tests (company_id, batch_id, test_number, sampled_at, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, batch.id, testNumber, req.body?.sampledAt || null, String(req.body?.notes || '').slice(0, 1000), req.user.id]); const test = (await query('SELECT * FROM lab_tests WHERE id = ?', [result.id]))[0]; await writeAudit(req, 'create', 'lab_test', result.id, null, test); res.status(201).json(test); } catch (error) { res.status(400).json({ message: error.message }); } });
app.post('/api/lab/tests/:id/results', requireRole(...labManageRoles), async (req, res) => { try { const test = (await query('SELECT * FROM lab_tests WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]; const parameter = (await query('SELECT * FROM lab_parameters WHERE id = ? AND company_id = ? AND active = 1', [Number(req.body?.parameterId), req.companyId]))[0]; if (!test || !parameter) return res.status(404).json({ message: 'Test or parameter not found in this company.' }); const numeric = req.body?.numericValue === '' || req.body?.numericValue == null ? null : Number(req.body.numericValue); if (numeric != null && !Number.isFinite(numeric)) return res.status(400).json({ message: 'Numeric result is invalid.' }); const text = String(req.body?.textValue || '').trim(); let pass = false; if (numeric != null && (parameter.min_value == null || numeric >= parameter.min_value) && (parameter.max_value == null || numeric <= parameter.max_value)) pass = true; if (numeric == null && parameter.allowed_text) pass = parameter.allowed_text.split(',').map((v) => v.trim().toLowerCase()).includes(text.toLowerCase()); const existing = (await query('SELECT id FROM lab_test_results WHERE company_id = ? AND test_id = ? AND parameter_id = ?', [req.companyId, test.id, parameter.id]))[0]; const result = existing ? await update('UPDATE lab_test_results SET numeric_value = ?, text_value = ?, pass = ?, notes = ? WHERE id = ? AND company_id = ?', [numeric, text, pass ? 1 : 0, String(req.body?.notes || '').slice(0, 500), existing.id, req.companyId]).then(() => ({ id: existing.id })) : await insert('INSERT INTO lab_test_results (company_id, test_id, parameter_id, numeric_value, text_value, pass, notes) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.companyId, test.id, parameter.id, numeric, text, pass ? 1 : 0, String(req.body?.notes || '').slice(0, 500)]); await update("UPDATE lab_tests SET status = 'in_progress', tested_at = CURRENT_TIMESTAMP, tested_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?", [req.user.id, test.id, req.companyId]); const row = (await query('SELECT ltr.*, lp.name AS parameter_name, lp.unit FROM lab_test_results ltr JOIN lab_parameters lp ON lp.id = ltr.parameter_id WHERE ltr.id = ?', [result.id]))[0]; await writeAudit(req, 'record_result', 'lab_test_result', result.id, null, row); res.status(201).json(row); } catch (error) { res.status(400).json({ message: error.message }); } });
app.post('/api/lab/tests/:id/review', requireRole(...labManageRoles), async (req, res) => { try { const test = (await query('SELECT * FROM lab_tests WHERE id = ? AND company_id = ?', [Number(req.params.id), req.companyId]))[0]; if (!test) return res.status(404).json({ message: 'Test not found.' }); const results = await query('SELECT pass FROM lab_test_results WHERE test_id = ? AND company_id = ?', [test.id, req.companyId]); if (!results.length) return res.status(400).json({ message: 'Record at least one lab result before review.' }); const status = results.every((r) => Number(r.pass) === 1) ? 'passed' : 'failed'; await update('UPDATE lab_tests SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [status, req.user.id, test.id, req.companyId]); const updated = (await query('SELECT * FROM lab_tests WHERE id = ?', [test.id]))[0]; await writeAudit(req, 'review', 'lab_test', test.id, test, updated); res.json(updated); } catch (error) { res.status(400).json({ message: error.message }); } });
app.post('/api/lab/tests/:id/certificate', requireRole(...labManageRoles), async (req, res) => { try { const test = (await query("SELECT * FROM lab_tests WHERE id = ? AND company_id = ? AND status = 'passed'", [Number(req.params.id), req.companyId]))[0]; if (!test) return res.status(409).json({ message: 'Only a passed lab test can receive a certificate.' }); const batch = await companyBatch(req.companyId, test.batch_id); if (!batch || batch.status !== 'completed') return res.status(409).json({ message: 'Batch must be completed before certification.' }); const certificateNumber = String(req.body?.certificateNumber || `COA-${batch.batch_number}`).trim(); const traceabilityCode = String(req.body?.traceabilityCode || `TRACE-${req.companyId}-${batch.batch_number}`).trim(); const result = await insert('INSERT INTO quality_certificates (company_id, batch_id, test_id, certificate_number, issued_by, traceability_code) VALUES (?, ?, ?, ?, ?, ?)', [req.companyId, batch.id, test.id, certificateNumber, req.user.id, traceabilityCode]); const certificate = (await query('SELECT * FROM quality_certificates WHERE id = ?', [result.id]))[0]; await update("UPDATE lab_tests SET status = 'released', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?", [test.id, req.companyId]); await writeAudit(req, 'issue', 'quality_certificate', result.id, null, certificate); res.status(201).json(certificate); } catch (error) { res.status(400).json({ message: error.message }); } });
app.get('/api/quality/certificates', requireRole(...productionReadRoles), async (req, res) => { try { res.json(await query('SELECT qc.*, pb.batch_number, p.name AS product_name FROM quality_certificates qc JOIN production_batches pb ON pb.id = qc.batch_id AND pb.company_id = qc.company_id JOIN products p ON p.id = pb.product_id AND p.company_id = pb.company_id WHERE qc.company_id = ? ORDER BY qc.id DESC', [req.companyId])); } catch (error) { res.status(500).json({ message: error.message }); } });
app.get('/api/production/reports', requireRole(...productionReadRoles), async (req, res) => { try { const [summary, byProduct, quality] = await Promise.all([query("SELECT status, COUNT(*) AS count, COALESCE(SUM(actual_quantity),0) AS quantity FROM production_batches WHERE company_id = ? GROUP BY status", [req.companyId]), query('SELECT p.name, COUNT(pb.id) AS batches, COALESCE(SUM(pb.actual_quantity),0) AS produced_quantity FROM production_batches pb JOIN products p ON p.id = pb.product_id AND p.company_id = pb.company_id WHERE pb.company_id = ? GROUP BY p.id ORDER BY produced_quantity DESC', [req.companyId]), query("SELECT status, COUNT(*) AS count FROM lab_tests WHERE company_id = ? GROUP BY status", [req.companyId])]); res.json({ summary, byProduct, quality }); } catch (error) { res.status(500).json({ message: error.message }); } });

// Multi-currency, global search, and notification APIs are deliberately company-scoped.
const currencyCode = (value) => String(value || '').trim().toUpperCase();
const validCurrency = (value) => /^[A-Z]{3}$/.test(currencyCode(value));
const parseJsonArray = (value, fallback = []) => { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : fallback; } catch (_) { return fallback; } };

async function getCurrencySettings(companyId) {
  let rows = await query('SELECT * FROM company_currency_settings WHERE company_id = ?', [companyId]);
  if (!rows[0]) {
    await insert('INSERT OR IGNORE INTO company_currency_settings (company_id) VALUES (?)', [companyId]);
    rows = await query('SELECT * FROM company_currency_settings WHERE company_id = ?', [companyId]);
  }
  const row = rows[0];
  return { ...row, supported_currencies: parseJsonArray(row.supported_currencies, [row.base_currency]) };
}

async function resolveExchangeRate(companyId, base, quote, at) {
  if (base === quote) return { rate: 1, source: 'identity', provider_state: 'configured' };
  const rows = await query(`SELECT rate, source, provider_state, effective_at FROM exchange_rates
    WHERE company_id = ? AND base_currency = ? AND quote_currency = ? AND provider_state = 'configured'
      AND (? IS NULL OR effective_at <= ?) ORDER BY effective_at DESC, id DESC LIMIT 1`, [companyId, base, quote, at || null, at || null]);
  return rows[0] || null;
}

app.get('/api/settings/currency', async (req, res) => { try { res.json(await getCurrencySettings(req.companyId)); } catch (error) { res.status(500).json({ message: error.message }); } });
app.put('/api/settings/currency', requireRole('super_admin', 'company_admin'), async (req, res) => {
  try {
    const current = await getCurrencySettings(req.companyId);
    const base = currencyCode(req.body?.baseCurrency || current.base_currency);
    const display = currencyCode(req.body?.displayCurrency || current.display_currency);
    const supported = Array.isArray(req.body?.supportedCurrencies) ? req.body.supportedCurrencies.map(currencyCode) : current.supported_currencies;
    const rounding = req.body?.roundingScale == null ? Number(current.rounding_scale) : Number(req.body.roundingScale);
    if (!validCurrency(base) || !validCurrency(display) || !supported.length || supported.some((c) => !validCurrency(c)) || !supported.includes(base) || !supported.includes(display)) return res.status(400).json({ message: 'Currencies must be ISO 4217 codes and include base and display currency.' });
    if (!Number.isInteger(rounding) || rounding < 0 || rounding > 6) return res.status(400).json({ message: 'Rounding scale must be an integer from 0 to 6.' });
    await update('UPDATE company_currency_settings SET base_currency = ?, display_currency = ?, supported_currencies = ?, rounding_scale = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?', [base, display, JSON.stringify([...new Set(supported)]), rounding, req.user.id, req.companyId]);
    const updated = await getCurrencySettings(req.companyId); await writeAudit(req, 'update', 'currency_settings', req.companyId, current, updated); res.json(updated);
  } catch (error) { res.status(400).json({ message: error.message }); }
});
app.get('/api/settings/currency/rates', async (req, res) => { try { const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100); res.json(await query('SELECT id, base_currency, quote_currency, rate, source, provider_state, effective_at, created_at FROM exchange_rates WHERE company_id = ? ORDER BY effective_at DESC, id DESC LIMIT ?', [req.companyId, limit])); } catch (error) { res.status(500).json({ message: error.message }); } });
app.post('/api/settings/currency/rates', requireRole('super_admin', 'company_admin'), async (req, res) => {
  try {
    const base = currencyCode(req.body?.baseCurrency), quote = currencyCode(req.body?.quoteCurrency), rate = Number(req.body?.rate), source = String(req.body?.source || 'manual').trim().slice(0, 80) || 'manual';
    if (!validCurrency(base) || !validCurrency(quote) || base === quote || !Number.isFinite(rate) || rate <= 0) return res.status(400).json({ message: 'A positive rate and two different ISO 4217 currencies are required.' });
    const settings = await getCurrencySettings(req.companyId); if (!settings.supported_currencies.includes(base) || !settings.supported_currencies.includes(quote)) return res.status(400).json({ message: 'Both currencies must be enabled for this company.' });
    const effectiveAt = req.body?.effectiveAt ? String(req.body.effectiveAt) : new Date().toISOString(); if (Number.isNaN(Date.parse(effectiveAt))) return res.status(400).json({ message: 'effectiveAt must be a valid date.' });
    const result = await insert("INSERT INTO exchange_rates (company_id, base_currency, quote_currency, rate, source, provider_state, effective_at, created_by) VALUES (?, ?, ?, ?, ?, 'configured', ?, ?)", [req.companyId, base, quote, rate, source, effectiveAt, req.user.id]);
    const row = (await query('SELECT * FROM exchange_rates WHERE id = ?', [result.id]))[0]; await writeAudit(req, 'create', 'exchange_rate', result.id, null, row); res.status(201).json(row);
  } catch (error) { res.status(400).json({ message: error.message }); }
});
app.post('/api/currency/convert', async (req, res) => { try {
  const amount = Number(req.body?.amount), from = currencyCode(req.body?.fromCurrency), to = currencyCode(req.body?.toCurrency);
  if (!Number.isFinite(amount) || !validCurrency(from) || !validCurrency(to)) return res.status(400).json({ message: 'amount and ISO 4217 from/to currencies are required.' });
  const rate = await resolveExchangeRate(req.companyId, from, to, req.body?.at || null); if (!rate) return res.status(409).json({ code: 'exchange_rate_unavailable', message: 'No configured exchange rate is available; stored amounts were not changed.' });
  const settings = await getCurrencySettings(req.companyId); const value = Number((amount * Number(rate.rate)).toFixed(Number(settings.rounding_scale))); res.json({ amount, fromCurrency: from, toCurrency: to, rate: Number(rate.rate), value, source: rate.source, providerState: rate.provider_state });
} catch (error) { res.status(400).json({ message: error.message }); } });

const searchSources = {
  customers: { label: 'customer', sql: "SELECT id, 'customer' AS entity_type, name AS title, COALESCE(phone,'') || ' ' || COALESCE(email,'') || ' ' || COALESCE(address,'') AS subtitle, created_at FROM customers WHERE company_id = ? AND (name LIKE ? OR phone LIKE ? OR email LIKE ? OR address LIKE ?)" },
  orders: { label: 'order', sql: "SELECT id, 'order' AS entity_type, COALESCE(customer_name, 'Order #' || id) AS title, COALESCE(status,'') || ' ' || COALESCE(notes,'') AS subtitle, created_at FROM orders WHERE company_id = ? AND (customer_name LIKE ? OR delivery_address LIKE ? OR notes LIKE ? OR CAST(id AS TEXT) LIKE ?)" },
  products: { label: 'product', sql: "SELECT id, 'product' AS entity_type, name AS title, COALESCE(category,'') AS subtitle, created_at FROM products WHERE company_id = ? AND (name LIKE ? OR category LIKE ?)" },
  invoices: { label: 'invoice', sql: "SELECT id, 'invoice' AS entity_type, COALESCE(invoice_number, 'Invoice #' || id) AS title, COALESCE(customer_name,'') || ' ' || COALESCE(status,'') AS subtitle, created_at FROM sales WHERE company_id = ? AND (invoice_number LIKE ? OR customer_name LIKE ? OR CAST(id AS TEXT) LIKE ?)" },
  bottles: { label: 'bottle', sql: "SELECT id, 'bottle' AS entity_type, COALESCE(bottle_identifier, code, 'Bottle #' || id) AS title, COALESCE(barcode,'') || ' ' || COALESCE(qr_code,'') AS subtitle, created_at FROM bottles WHERE company_id = ? AND (bottle_identifier LIKE ? OR code LIKE ? OR barcode LIKE ? OR qr_code LIKE ?)" },
  vehicles: { label: 'vehicle', sql: "SELECT id, 'vehicle' AS entity_type, COALESCE(registration, vehicle_number, 'Vehicle #' || id) AS title, COALESCE(vehicle_type,'') || ' ' || COALESCE(status,'') AS subtitle, created_at FROM vehicles WHERE company_id = ? AND (registration LIKE ? OR vehicle_number LIKE ? OR vehicle_type LIKE ?)" },
  documents: { label: 'document', sql: "SELECT id, 'document' AS entity_type, title, COALESCE(document_type,'') || ' ' || COALESCE(description,'') AS subtitle, created_at FROM document_records WHERE company_id = ? AND (title LIKE ? OR document_type LIKE ? OR description LIKE ?)" },
  users: { label: 'user', sql: "SELECT id, 'user' AS entity_type, name AS title, COALESCE(username,'') || ' ' || COALESCE(email,'') || ' ' || COALESCE(role,'') AS subtitle, created_at FROM users WHERE company_id = ? AND (name LIKE ? OR username LIKE ? OR email LIKE ? OR role LIKE ?)" }
};
app.get('/api/search', requireRole('super_admin', 'company_admin', 'manager', 'staff', 'accountant', 'salesman', 'driver'), async (req, res) => { try {
  const q = String(req.query.q || '').trim(); if (q.length < 2) return res.status(400).json({ message: 'Search query must contain at least 2 characters.' });
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1), pageSize = Math.min(Math.max(Number.parseInt(req.query.pageSize, 10) || 20, 1), 100); const requested = req.query.types ? String(req.query.types).split(',').filter((x) => searchSources[x]) : Object.keys(searchSources); const like = `%${q}%`;
  const parts = requested.map((key) => searchSources[key]); const sql = parts.map((p) => p.sql).join(' UNION ALL ') + ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?'; const params = []; parts.forEach((p) => { const placeholders = (p.sql.match(/\?/g) || []).length - 1; params.push(req.companyId, ...Array(placeholders).fill(like)); }); params.push(pageSize, (page - 1) * pageSize);
  const rows = await query(sql, params); const countSql = `SELECT COUNT(*) AS total FROM (${parts.map((p) => p.sql).join(' UNION ALL ')})`; const countParams = []; parts.forEach((p) => { const placeholders = (p.sql.match(/\?/g) || []).length - 1; countParams.push(req.companyId, ...Array(placeholders).fill(like)); }); const total = (await query(countSql, countParams))[0].total; res.json({ items: rows, page, pageSize, total, hasNext: page * pageSize < total });
} catch (error) { res.status(400).json({ message: error.message }); } });

app.get('/api/notifications', async (req, res) => { try { const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1), pageSize = Math.min(Math.max(Number.parseInt(req.query.pageSize, 10) || 20, 1), 100); const unread = req.query.unread === 'true' ? ' AND n.read_at IS NULL' : ''; const rows = await query(`SELECT n.* FROM notifications n WHERE n.company_id = ? AND (n.user_id IS NULL OR n.user_id = ?)${unread} ORDER BY n.created_at DESC, n.id DESC LIMIT ? OFFSET ?`, [req.companyId, req.user.id, pageSize, (page - 1) * pageSize]); const count = (await query(`SELECT COUNT(*) AS total FROM notifications n WHERE n.company_id = ? AND (n.user_id IS NULL OR n.user_id = ?)${unread}`, [req.companyId, req.user.id]))[0].total; res.json({ items: rows, page, pageSize, total: count, unread: (await query('SELECT COUNT(*) AS total FROM notifications WHERE company_id = ? AND (user_id IS NULL OR user_id = ?) AND read_at IS NULL', [req.companyId, req.user.id]))[0].total }); } catch (error) { res.status(500).json({ message: error.message }); } });
app.patch('/api/notifications/:id/read', async (req, res) => { try { const row = (await query('SELECT * FROM notifications WHERE id = ? AND company_id = ? AND (user_id IS NULL OR user_id = ?)', [Number(req.params.id), req.companyId, req.user.id]))[0]; if (!row) return res.status(404).json({ message: 'Notification not found.' }); await update('UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ? AND company_id = ?', [row.id, req.companyId]); res.json({ ...row, read_at: new Date().toISOString() }); } catch (error) { res.status(400).json({ message: error.message }); } });
app.post('/api/notifications/read-all', async (req, res) => { try { const result = await update('UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE company_id = ? AND (user_id IS NULL OR user_id = ?) AND read_at IS NULL', [req.companyId, req.user.id]); res.json({ updated: result.changes }); } catch (error) { res.status(500).json({ message: error.message }); } });
app.post('/api/notifications', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => { try { const type = String(req.body?.type || '').trim().slice(0, 80), title = String(req.body?.title || '').trim().slice(0, 200), message = String(req.body?.message || '').trim().slice(0, 2000); const userId = req.body?.userId == null ? null : Number(req.body.userId); if (!type || !title || !message) return res.status(400).json({ message: 'type, title, and message are required; providers do not generate message content.' }); if (userId != null && !(await query('SELECT id FROM users WHERE id = ? AND company_id = ? AND active = 1', [userId, req.companyId]))[0]) return res.status(400).json({ message: 'Recipient is not in this company.' }); const result = await insert('INSERT INTO notifications (company_id, user_id, type, category, title, message, priority, entity_type, entity_id, metadata_json, provider_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, userId, type, String(req.body?.category || 'general').slice(0, 80), title, message, ['low','normal','high','urgent'].includes(req.body?.priority) ? req.body.priority : 'normal', req.body?.entityType ? String(req.body.entityType).slice(0, 80) : null, req.body?.entityId == null ? null : Number(req.body.entityId), JSON.stringify(req.body?.metadata || {}), 'in_app']); const row = (await query('SELECT * FROM notifications WHERE id = ?', [result.id]))[0]; await insert("INSERT INTO notification_deliveries (company_id, notification_id, channel, provider, status, provider_state, attempts, sent_at, delivered_at) VALUES (?, ?, 'in_app', 'internal', 'delivered', 'delivered', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", [req.companyId, result.id]); await writeAudit(req, 'create', 'notification', result.id, null, row); res.status(201).json(row); } catch (error) { res.status(400).json({ message: error.message }); } });
app.get('/api/notification-preferences', async (req, res) => { try { res.json(await query("SELECT COALESCE(notification_type, channel) AS notification_type, channel, enabled, COALESCE(channels, '[\"in_app\"]') AS channels, updated_at FROM notification_preferences WHERE company_id = ? AND user_id = ? ORDER BY channel", [req.companyId, req.user.id])); } catch (error) { res.status(500).json({ message: error.message }); } });
app.put('/api/notification-preferences/:type', async (req, res) => { try { const type = String(req.params.type || '').trim().slice(0, 80); const enabled = req.body?.enabled === false ? 0 : req.body?.enabled === true ? 1 : null; const channels = Array.isArray(req.body?.channels) ? req.body.channels.map((x) => String(x).trim()).filter((x) => ['in_app','email','sms','whatsapp'].includes(x)) : ['in_app']; if (!type || enabled == null || !channels.length) return res.status(400).json({ message: 'enabled and at least one supported channel are required.' }); for (const channel of [...new Set(channels)]) await insert('INSERT INTO notification_preferences (company_id, user_id, channel, notification_type, enabled, channels, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(company_id, user_id, channel) DO UPDATE SET notification_type = excluded.notification_type, enabled = excluded.enabled, channels = excluded.channels, updated_at = CURRENT_TIMESTAMP', [req.companyId, req.user.id, channel, type, enabled, JSON.stringify([...new Set(channels)])]); res.json({ notification_type: type, enabled: Boolean(enabled), channels }); } catch (error) { res.status(400).json({ message: error.message }); } });
app.get('/api/notification-deliveries', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => { try { const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100); res.json(await query('SELECT * FROM notification_deliveries WHERE company_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', [req.companyId, limit])); } catch (error) { res.status(500).json({ message: error.message }); } });
app.post('/api/admin/notification-deliveries/:id/retry', requireSuperAdmin, async (req, res) => {
  try {
    const delivery = (await query('SELECT id, company_id FROM notification_deliveries WHERE id = ?', [Number(req.params.id)]))[0];
    if (!delivery) return res.status(404).json({ message: 'Delivery record not found.' });
    const result = await notificationDeliveryService.retryFailedDelivery(delivery.id);
    await writeAudit(req, 'notification_delivery_retried', 'notification_delivery', delivery.id, null, { companyId: delivery.company_id, result });
    res.json(result);
  } catch (error) { res.status(500).json({ message: error.message }); }
});
app.get('/api/notification-templates', requireRole('super_admin', 'company_admin', 'manager'), async (req, res) => { try { res.json(await query("SELECT id, name, channel, COALESCE(notification_type, name) AS notification_type, subject, body, COALESCE(title_template, subject) AS title_template, COALESCE(message_template, body) AS message_template, active, updated_at FROM notification_templates WHERE company_id = ? ORDER BY name, channel", [req.companyId])); } catch (error) { res.status(500).json({ message: error.message }); } });
app.post('/api/notification-templates', requireRole('super_admin', 'company_admin'), async (req, res) => { try { const name = String(req.body?.name || '').trim().slice(0, 120), channel = String(req.body?.channel || 'in_app').trim(), type = String(req.body?.notificationType || name).trim().slice(0, 80), subject = String(req.body?.titleTemplate || req.body?.subject || '').trim().slice(0, 200), body = String(req.body?.messageTemplate || req.body?.body || '').trim().slice(0, 2000); if (!name || !['in_app','email','sms','whatsapp'].includes(channel) || !body) return res.status(400).json({ message: 'name, supported channel, and non-empty message template are required.' }); const result = await insert('INSERT INTO notification_templates (company_id, name, channel, notification_type, subject, body, title_template, message_template, active, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)', [req.companyId, name, channel, type, subject, body, subject, body, req.user.id]); const row = (await query('SELECT * FROM notification_templates WHERE id = ?', [result.id]))[0]; await writeAudit(req, 'create', 'notification_template', result.id, null, row); res.status(201).json(row); } catch (error) { res.status(400).json({ message: error.message }); } });
app.patch('/api/notification-templates/:id', requireRole('super_admin', 'company_admin'), async (req, res) => { try { const id = Number(req.params.id), old = (await query('SELECT * FROM notification_templates WHERE id = ? AND company_id = ?', [id, req.companyId]))[0]; if (!old) return res.status(404).json({ message: 'Template not found.' }); const active = req.body?.active == null ? old.active : (req.body.active ? 1 : 0), body = req.body?.messageTemplate == null ? old.body : String(req.body.messageTemplate).trim().slice(0, 2000), subject = req.body?.titleTemplate == null ? old.subject : String(req.body.titleTemplate).trim().slice(0, 200); if (!body) return res.status(400).json({ message: 'Message template cannot be empty.' }); await update('UPDATE notification_templates SET subject = ?, body = ?, title_template = ?, message_template = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [subject, body, subject, body, active, id, req.companyId]); const row = (await query('SELECT * FROM notification_templates WHERE id = ?', [id]))[0]; await writeAudit(req, 'update', 'notification_template', id, old, row); res.json(row); } catch (error) { res.status(400).json({ message: error.message }); } });

// Tenant branding, usage and security diagnostics are deliberately scoped at every query boundary.
app.get('/api/tenant-branding', async (req, res) => {
  try {
    if (!req.companyId) return res.status(400).json({ message: 'Company context is required.' });
    const company = (await query('SELECT id, name, logo, theme_json, custom_domain, subdomain, favicon_url, support_email, default_language FROM companies WHERE id = ? AND active = 1', [req.companyId]))[0];
    if (!company) return res.status(404).json({ message: 'Company not found.' });
    let theme = {}; try { theme = safeTheme(JSON.parse(company.theme_json || '{}')); } catch (_) { theme = safeTheme({}); }
    res.set('Cache-Control', 'private, no-store').json({ ...company, theme });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/company/usage', async (req, res) => {
  try {
    if (!req.companyId) return res.status(400).json({ message: 'Company context is required.' });
    const [{ limits, subscription }, usage] = await Promise.all([getPlanLimits(req.companyId), getCompanyUsage(req.companyId)]);
    res.json({ companyId: req.companyId, period: currentUsagePeriod(), plan: subscription ? { id: subscription.plan_id, name: subscription.plan_name, status: subscription.status } : null, limits, usage });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/companies/:id/usage', requireRole('super_admin'), async (req, res) => {
  try {
    const companyId = Number(req.params.id);
    if (!(await query('SELECT id FROM companies WHERE id = ?', [companyId]))[0]) return res.status(404).json({ message: 'Company not found.' });
    const [{ limits, subscription }, usage] = await Promise.all([getPlanLimits(companyId), getCompanyUsage(companyId)]);
    res.json({ companyId, period: currentUsagePeriod(), plan: subscription ? { id: subscription.plan_id, name: subscription.plan_name, status: subscription.status } : null, limits, usage });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/companies/:id/security-diagnostics', requireRole('super_admin'), async (req, res) => {
  try {
    const companyId = Number(req.params.id);
    const company = (await query('SELECT id, name, active FROM companies WHERE id = ?', [companyId]))[0];
    if (!company) return res.status(404).json({ message: 'Company not found.' });
    const checks = [];
    const orphaned = await query(`SELECT COUNT(*) AS count FROM users u WHERE u.company_id = ? AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = u.company_id)`, [companyId]);
    const crossTenantUsers = await query('SELECT COUNT(*) AS count FROM users WHERE company_id = ? AND customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = users.customer_id AND c.company_id = users.company_id)', [companyId]);
    const auditRows = await query('SELECT COUNT(*) AS count FROM audit_logs WHERE company_id = ?', [companyId]);
    checks.push({ key: 'tenant_foreign_keys', status: Number(orphaned[0]?.count || 0) === 0 ? 'pass' : 'fail', count: Number(orphaned[0]?.count || 0) });
    checks.push({ key: 'cross_tenant_user_links', status: Number(crossTenantUsers[0]?.count || 0) === 0 ? 'pass' : 'fail', count: Number(crossTenantUsers[0]?.count || 0) });
    checks.push({ key: 'audit_logging', status: Number(auditRows[0]?.count || 0) >= 0 ? 'pass' : 'fail', count: Number(auditRows[0]?.count || 0) });
    checks.push({ key: 'active_company', status: company.active ? 'pass' : 'warning', count: company.active ? 1 : 0 });
    res.json({ company, checks, generatedAt: new Date().toISOString() });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.put('/api/plans/:id', requireRole('super_admin'), async (req, res) => {
  try {
    const id = Number(req.params.id), body = req.body || {};
    const existing = (await query('SELECT * FROM plans WHERE id = ?', [id]))[0];
    if (!existing) return res.status(404).json({ message: 'Plan not found.' });
    const limits = body.limits && typeof body.limits === 'object' ? body.limits : {};
    const positiveInt = (value, fallback) => Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
    await update('UPDATE plans SET name = ?, price = ?, duration_months = ?, max_users = ?, max_customers = ?, max_products = ?, max_monthly_orders = ?, limits = ?, active = ? WHERE id = ?', [String(body.name || existing.name).trim().slice(0, 100), Math.max(0, Number(body.price ?? existing.price) || 0), positiveInt(body.durationMonths, existing.duration_months), positiveInt(body.maxUsers, existing.max_users), positiveInt(body.maxCustomers, existing.max_customers), positiveInt(body.maxProducts, existing.max_products), positiveInt(body.maxMonthlyOrders, existing.max_monthly_orders), JSON.stringify(limits), body.active === undefined ? existing.active : Number(Boolean(body.active)), id]);
    await writeAudit(req, 'update', 'plan', id, existing, (await query('SELECT * FROM plans WHERE id = ?', [id]))[0]);
    res.json((await query('SELECT * FROM plans WHERE id = ?', [id]))[0]);
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Hayrila starter running at http://localhost:${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const fallbackPort = port + 1;
      console.warn(`Port ${port} is busy, retrying on ${fallbackPort}`);
      startServer(fallbackPort);
      return;
    }

    console.error('Server failed to start:', error);
    process.exit(1);
  });
}

ensureSecureAdminBootstrap()
  .then(() => startServer(PORT))
  .catch((error) => {
    console.error('Startup security check failed:', error.message);
    db.close(() => process.exit(1));
  });

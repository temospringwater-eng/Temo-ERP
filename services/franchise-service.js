const RELATIONSHIP_TYPES = new Set(['franchise', 'branch']);
const RELATIONSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'terminated']);
const AGREEMENT_STATUSES = new Set(['draft', 'active', 'expired', 'terminated']);
const FEE_TYPES = new Set(['joining', 'recurring', 'marketing', 'technology', 'other']);
const FEE_FREQUENCIES = new Set(['one_time', 'monthly', 'quarterly', 'annual']);
const FEE_STATUSES = new Set(['pending', 'invoiced', 'paid', 'waived', 'cancelled']);
const REVENUE_STATUSES = new Set(['draft', 'calculated', 'invoiced', 'settled', 'disputed']);
const ASSIGNMENT_TYPES = new Set(['manager', 'employee']);
const SCOPES = new Set(['management', 'employees', 'customers', 'inventory', 'reports', 'financial', 'consolidated_reports']);
const REPORT_KEYS = new Set(['consolidated_reports', 'consolidated_sales', 'consolidated_inventory', 'consolidated_customers', 'consolidated_financial']);
const DEFAULT_MANAGER_SCOPES = ['management', 'employees', 'customers', 'inventory', 'reports'];
const DEFAULT_EMPLOYEE_SCOPES = ['customers', 'inventory'];

function createService({ db, query, insert, update, writeAudit }) {
  let schemaReady = false;
  let initializationPromise = null;

  function initialize() {
    if (initializationPromise) return initializationPromise;
    initializationPromise = new Promise((resolve, reject) => db.serialize(() => {
      // These columns make the relationship explicit on the existing tenant records without creating a second tenant model.
      db.run("ALTER TABLE companies ADD COLUMN tenant_type TEXT NOT NULL DEFAULT 'independent'", () => {});
      db.run('ALTER TABLE companies ADD COLUMN parent_company_id INTEGER', () => {});
      db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS franchise_relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_company_id INTEGER NOT NULL,
        child_company_id INTEGER NOT NULL,
        relationship_type TEXT NOT NULL DEFAULT 'franchise' CHECK (relationship_type IN ('franchise','branch')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','terminated')),
        start_date TEXT,
        end_date TEXT,
        agreement_number TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(parent_company_id, child_company_id),
        CHECK(parent_company_id <> child_company_id),
        FOREIGN KEY(parent_company_id) REFERENCES companies(id),
        FOREIGN KEY(child_company_id) REFERENCES companies(id),
        FOREIGN KEY(created_by) REFERENCES users(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS franchise_agreements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        relationship_id INTEGER NOT NULL,
        agreement_number TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','expired','terminated')),
        signed_on TEXT,
        effective_on TEXT,
        expires_on TEXT,
        document_url TEXT NOT NULL DEFAULT '',
        terms TEXT NOT NULL DEFAULT '',
        joining_fee REAL NOT NULL DEFAULT 0 CHECK(joining_fee >= 0),
        recurring_fee REAL NOT NULL DEFAULT 0 CHECK(recurring_fee >= 0),
        currency TEXT NOT NULL DEFAULT 'PKR',
        revenue_share_percent REAL NOT NULL DEFAULT 0 CHECK(revenue_share_percent >= 0 AND revenue_share_percent <= 100),
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(relationship_id, agreement_number),
        FOREIGN KEY(relationship_id) REFERENCES franchise_relationships(id) ON DELETE CASCADE,
        FOREIGN KEY(created_by) REFERENCES users(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS franchise_fees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        relationship_id INTEGER NOT NULL,
        fee_type TEXT NOT NULL CHECK(fee_type IN ('joining','recurring','marketing','technology','other')),
        description TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL CHECK(amount >= 0),
        currency TEXT NOT NULL DEFAULT 'PKR',
        frequency TEXT NOT NULL DEFAULT 'one_time' CHECK(frequency IN ('one_time','monthly','quarterly','annual')),
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','invoiced','paid','waived','cancelled')),
        paid_at TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(relationship_id) REFERENCES franchise_relationships(id) ON DELETE CASCADE,
        FOREIGN KEY(created_by) REFERENCES users(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS franchise_revenue_shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        relationship_id INTEGER NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        gross_revenue REAL NOT NULL DEFAULT 0 CHECK(gross_revenue >= 0),
        deductions REAL NOT NULL DEFAULT 0 CHECK(deductions >= 0),
        basis_amount REAL NOT NULL DEFAULT 0 CHECK(basis_amount >= 0),
        share_percent REAL NOT NULL CHECK(share_percent >= 0 AND share_percent <= 100),
        parent_amount REAL NOT NULL DEFAULT 0 CHECK(parent_amount >= 0),
        child_amount REAL NOT NULL DEFAULT 0 CHECK(child_amount >= 0),
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','calculated','invoiced','settled','disputed')),
        settled_at TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(relationship_id, period_start, period_end),
        FOREIGN KEY(relationship_id) REFERENCES franchise_relationships(id) ON DELETE CASCADE,
        FOREIGN KEY(created_by) REFERENCES users(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS franchise_user_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        relationship_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        assignment_type TEXT NOT NULL DEFAULT 'employee' CHECK(assignment_type IN ('manager','employee')),
        active INTEGER NOT NULL DEFAULT 1,
        notes TEXT NOT NULL DEFAULT '',
        assigned_by INTEGER,
        assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(relationship_id, user_id),
        FOREIGN KEY(relationship_id) REFERENCES franchise_relationships(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(assigned_by) REFERENCES users(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS franchise_scope_grants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        relationship_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('management','employees','customers','inventory','reports','financial','consolidated_reports')),
        can_read INTEGER NOT NULL DEFAULT 1,
        can_write INTEGER NOT NULL DEFAULT 0,
        granted_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(relationship_id, user_id, scope),
        FOREIGN KEY(relationship_id) REFERENCES franchise_relationships(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(granted_by) REFERENCES users(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS franchise_report_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        relationship_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        report_key TEXT NOT NULL,
        can_view INTEGER NOT NULL DEFAULT 1,
        can_export INTEGER NOT NULL DEFAULT 0,
        consolidated INTEGER NOT NULL DEFAULT 0,
        granted_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(relationship_id, user_id, report_key),
        FOREIGN KEY(relationship_id) REFERENCES franchise_relationships(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(granted_by) REFERENCES users(id)
      )`);
      db.run('CREATE INDEX IF NOT EXISTS idx_franchise_relationship_parent_status ON franchise_relationships(parent_company_id, status)');
      db.run('CREATE INDEX IF NOT EXISTS idx_franchise_relationship_child_status ON franchise_relationships(child_company_id, status)');
      db.run('CREATE INDEX IF NOT EXISTS idx_franchise_agreements_relationship_status ON franchise_agreements(relationship_id, status)');
      db.run('CREATE INDEX IF NOT EXISTS idx_franchise_fees_relationship_status ON franchise_fees(relationship_id, status, due_date)');
      db.run('CREATE INDEX IF NOT EXISTS idx_franchise_revenue_relationship_period ON franchise_revenue_shares(relationship_id, period_start, period_end)');
      db.run('CREATE INDEX IF NOT EXISTS idx_franchise_assignments_user_active ON franchise_user_assignments(user_id, active)');
      db.run('CREATE INDEX IF NOT EXISTS idx_franchise_scope_grants_user_scope ON franchise_scope_grants(user_id, scope, can_read)');
      db.run('CREATE INDEX IF NOT EXISTS idx_franchise_report_permissions_user ON franchise_report_permissions(user_id, report_key, consolidated)');
      db.run("INSERT OR IGNORE INTO schema_migrations(version, name) VALUES (4, 'franchise-management')", (error) => {
        if (error) return reject(error);
        schemaReady = true;
        resolve();
      });
    }));
    return initializationPromise;
  }

  function waitForSchema(req, res, next) {
    return (initializationPromise || Promise.resolve()).then(() => next()).catch((error) => {
      res.status(503).json({ message: 'Franchise management is temporarily unavailable.', error: error.message });
    });
  }

  const integerId = (value) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const text = (value, max = 240) => String(value == null ? '' : value).trim().slice(0, max);
  const bool = (value, fallback = false) => value === undefined ? (fallback ? 1 : 0) : (value === true || value === 1 || value === '1' ? 1 : 0);
  const validDate = (value, field, required = false) => {
    if (value == null || value === '') {
      if (required) throw Object.assign(new Error(`${field} is required.`), { statusCode: 400 });
      return null;
    }
    const valueText = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valueText) || Number.isNaN(Date.parse(`${valueText}T00:00:00Z`))) throw Object.assign(new Error(`${field} must be a valid YYYY-MM-DD date.`), { statusCode: 400 });
    return valueText;
  };
  const nonNegative = (value, field) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw Object.assign(new Error(`${field} must be a non-negative number.`), { statusCode: 400 });
    return Math.round(number * 100) / 100;
  };
  const percent = (value, field) => {
    const number = nonNegative(value, field);
    if (number > 100) throw Object.assign(new Error(`${field} must be between 0 and 100.`), { statusCode: 400 });
    return number;
  };
  const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
  const errorResponse = (res, error) => res.status(error.statusCode || (String(error.message || '').includes('UNIQUE') ? 409 : 500)).json({ message: error.message || 'Franchise request failed.' });

  async function companyExists(companyId) {
    return Boolean((await query('SELECT id, name, active, tenant_type, parent_company_id FROM companies WHERE id = ? AND active = 1', [companyId]))[0]);
  }

  async function getRelationship(id) {
    const rows = await query(`SELECT r.*, p.name AS parent_company_name, p.tenant_type AS parent_tenant_type,
      c.name AS child_company_name, c.tenant_type AS child_tenant_type,
      (SELECT COUNT(*) FROM franchise_user_assignments a WHERE a.relationship_id = r.id AND a.active = 1) AS assignment_count,
      (SELECT COUNT(*) FROM franchise_report_permissions rp WHERE rp.relationship_id = r.id AND rp.consolidated = 1 AND rp.can_view = 1) AS consolidated_permission_count
      FROM franchise_relationships r
      JOIN companies p ON p.id = r.parent_company_id
      JOIN companies c ON c.id = r.child_company_id
      WHERE r.id = ?`, [id]);
    return rows[0] || null;
  }

  async function relationForRequest(req, id, options = {}) {
    const relation = await getRelationship(id);
    if (!relation) throw fail('Franchise relationship not found.', 404);
    if (!(await canViewRelationship(req, relation, options.scope || 'management', options.write === true))) throw fail('You do not have access to this franchise relationship.', 403);
    return relation;
  }

  function actorCompanyId(req) {
    return integerId(req.user?.company_id || req.companyId);
  }

  function isSuperAdmin(req) { return req.user?.role === 'super_admin'; }
  function isParentAdmin(req, relation) {
    return isSuperAdmin(req) || (req.user?.role === 'company_admin' && actorCompanyId(req) === Number(relation.parent_company_id));
  }

  async function hasAssignment(req, relationId, scope, write = false) {
    if (scope === 'any') {
      const rows = await query(`SELECT a.id FROM franchise_user_assignments a
        JOIN franchise_scope_grants g ON g.relationship_id = a.relationship_id AND g.user_id = a.user_id
        WHERE a.relationship_id = ? AND a.user_id = ? AND a.active = 1 AND ${write ? 'g.can_write' : 'g.can_read'} = 1 LIMIT 1`, [relationId, req.user?.id]);
      return Boolean(rows[0]);
    }
    const rows = await query(`SELECT a.id, a.assignment_type, g.can_read, g.can_write
      FROM franchise_user_assignments a
      LEFT JOIN franchise_scope_grants g ON g.relationship_id = a.relationship_id AND g.user_id = a.user_id AND g.scope = ?
      WHERE a.relationship_id = ? AND a.user_id = ? AND a.active = 1`, [scope, relationId, req.user?.id]);
    const row = rows[0];
    if (!row) return false;
    return write ? Number(row.can_write) === 1 : Number(row.can_read) === 1;
  }

  async function canViewRelationship(req, relation, scope = 'management', write = false) {
    if (isSuperAdmin(req)) return true;
    const companyId = actorCompanyId(req);
    if (!companyId) return false;
    if (req.user?.role === 'company_admin' && companyId === Number(relation.parent_company_id)) return true;
    if (req.user?.role === 'company_admin' && companyId === Number(relation.child_company_id) && !write) return true;
    if (companyId === Number(relation.parent_company_id) || companyId === Number(relation.child_company_id)) return hasAssignment(req, relation.id, scope, write);
    return hasAssignment(req, relation.id, scope, write);
  }

  async function canManageRelationship(req, relation) {
    if (isSuperAdmin(req)) return true;
    if (req.user?.role === 'company_admin' && actorCompanyId(req) === Number(relation.parent_company_id)) return true;
    return hasAssignment(req, relation.id, 'management', true);
  }

  async function canGrantScopes(req, relation) {
    return canManageRelationship(req, relation);
  }

  async function visibleRelationships(req) {
    if (isSuperAdmin(req)) return query(`SELECT r.*, p.name AS parent_company_name, c.name AS child_company_name,
      (SELECT COUNT(*) FROM franchise_user_assignments a WHERE a.relationship_id = r.id AND a.active = 1) AS assignment_count
      FROM franchise_relationships r JOIN companies p ON p.id = r.parent_company_id JOIN companies c ON c.id = r.child_company_id
      ORDER BY r.id DESC`);
    const companyId = actorCompanyId(req);
    if (!companyId) return [];
    return query(`SELECT DISTINCT r.*, p.name AS parent_company_name, c.name AS child_company_name,
      (SELECT COUNT(*) FROM franchise_user_assignments a WHERE a.relationship_id = r.id AND a.active = 1) AS assignment_count
      FROM franchise_relationships r JOIN companies p ON p.id = r.parent_company_id JOIN companies c ON c.id = r.child_company_id
      LEFT JOIN franchise_user_assignments ua ON ua.relationship_id = r.id AND ua.user_id = ? AND ua.active = 1
      WHERE r.parent_company_id = ? OR r.child_company_id = ? OR ua.id IS NOT NULL
      ORDER BY r.id DESC`, [req.user.id, companyId, companyId]);
  }

  async function validateCompanies(parentId, childId) {
    if (!parentId || !childId || parentId === childId) throw fail('A parent and a different child company are required.');
    const rows = await query('SELECT id, active FROM companies WHERE id IN (?, ?)', [parentId, childId]);
    if (rows.length !== 2 || rows.some((row) => Number(row.active) !== 1)) throw fail('Both companies must exist and be active.', 404);
    const existing = await query(`SELECT id, parent_company_id, status FROM franchise_relationships
      WHERE child_company_id = ? AND status <> 'terminated' LIMIT 1`, [childId]);
    if (existing[0] && Number(existing[0].parent_company_id) !== parentId) throw fail('The child company already belongs to another active franchise hierarchy.', 409);
    const duplicate = await query('SELECT id FROM franchise_relationships WHERE parent_company_id = ? AND child_company_id = ? LIMIT 1', [parentId, childId]);
    if (duplicate[0]) throw fail('A relationship already exists for these companies.', 409);
    const cycle = await query(`WITH RECURSIVE descendants(id) AS (
      SELECT child_company_id FROM franchise_relationships WHERE parent_company_id = ? AND status <> 'terminated'
      UNION ALL
      SELECT r.child_company_id FROM franchise_relationships r JOIN descendants d ON r.parent_company_id = d.id WHERE r.status <> 'terminated'
    ) SELECT id FROM descendants WHERE id = ? LIMIT 1`, [childId, parentId]);
    if (cycle[0]) throw fail('The relationship would create a franchise hierarchy cycle.');
  }

  async function setCompanyRelationshipMetadata(parentId, childId, relationshipType) {
    await update("UPDATE companies SET tenant_type = CASE WHEN tenant_type = 'independent' THEN 'parent' ELSE tenant_type END WHERE id = ?", [parentId]);
    await update('UPDATE companies SET tenant_type = ?, parent_company_id = ? WHERE id = ?', [relationshipType === 'branch' ? 'branch' : 'franchise', parentId, childId]);
  }

  async function audit(req, action, entityType, entityId, previous, next, companyId) {
    if (typeof writeAudit !== 'function') return;
    await writeAudit({ ...req, companyId: companyId || req.companyId || null }, action, entityType, entityId, previous, next);
  }

  function normalizeScopes(values) {
    const list = Array.isArray(values) ? values : [];
    return [...new Set(list.map((value) => String(value || '').trim().toLowerCase()).filter((value) => SCOPES.has(value)))];
  }

  async function assignmentRows(relationId) {
    return query(`SELECT a.*, u.name AS user_name, u.username, u.email, u.role AS user_role, u.company_id,
      (SELECT json_group_array(json_object('scope', g.scope, 'canRead', g.can_read, 'canWrite', g.can_write)) FROM franchise_scope_grants g WHERE g.relationship_id = a.relationship_id AND g.user_id = a.user_id) AS scopes_json
      FROM franchise_user_assignments a JOIN users u ON u.id = a.user_id WHERE a.relationship_id = ? ORDER BY a.active DESC, a.assignment_type, u.name`, [relationId]);
  }

  async function reportPermissionRows(relationId) {
    return query(`SELECT p.*, u.name AS user_name, u.username, u.company_id FROM franchise_report_permissions p
      JOIN users u ON u.id = p.user_id WHERE p.relationship_id = ? ORDER BY p.user_name, p.report_key`, [relationId]);
  }

  async function reportPermissionRowsForRequest(req, relation) {
    if (await canManageRelationship(req, relation)) return reportPermissionRows(relation.id);
    return query(`SELECT p.*, u.name AS user_name, u.username, u.company_id FROM franchise_report_permissions p
      JOIN users u ON u.id = p.user_id WHERE p.relationship_id = ? AND p.user_id = ? ORDER BY p.report_key`, [relation.id, req.user.id]);
  }

  async function relationDetail(req, relation) {
    const [canManage, canReadFinancial, canReadReports] = await Promise.all([
      canManageRelationship(req, relation),
      canViewRelationship(req, relation, 'financial'),
      canViewRelationship(req, relation, 'reports')
    ]);
    const [agreements, fees, revenueShares, assignments, scopes, reportPermissions] = await Promise.all([
      canManage || canReadFinancial ? query('SELECT * FROM franchise_agreements WHERE relationship_id = ? ORDER BY effective_on DESC, id DESC', [relation.id]) : [],
      canManage || canReadFinancial ? query('SELECT * FROM franchise_fees WHERE relationship_id = ? ORDER BY due_date DESC, id DESC', [relation.id]) : [],
      canManage || canReadFinancial ? query('SELECT * FROM franchise_revenue_shares WHERE relationship_id = ? ORDER BY period_end DESC, id DESC', [relation.id]) : [],
      canManage ? assignmentRows(relation.id) : [],
      canManage ? query('SELECT * FROM franchise_scope_grants WHERE relationship_id = ? ORDER BY user_id, scope', [relation.id]) : [],
      canManage ? reportPermissionRows(relation.id) : (canReadReports ? query('SELECT p.*, u.name AS user_name, u.username, u.company_id FROM franchise_report_permissions p JOIN users u ON u.id = p.user_id WHERE p.relationship_id = ? AND p.user_id = ? ORDER BY p.report_key', [relation.id, req.user.id]) : [])
    ]);
    return { ...relation, agreements, fees, revenueShares, assignments, scopes, reportPermissions };
  }

  async function createRelationship(req, payload, forcedParentId = null, forcedType = null, authorizationRelation = null) {
    const parentId = integerId(forcedParentId || payload.parentCompanyId || payload.parentId || req.companyId);
    const childId = integerId(payload.childCompanyId || payload.franchiseCompanyId || payload.branchCompanyId || payload.companyId);
    const relationshipType = String(forcedType || payload.relationshipType || payload.type || 'franchise').trim().toLowerCase();
    const status = String(payload.status || 'pending').trim().toLowerCase();
    if (!RELATIONSHIP_TYPES.has(relationshipType)) throw fail('relationshipType must be franchise or branch.');
    if (!RELATIONSHIP_STATUSES.has(status)) throw fail('Invalid franchise relationship status.');
    const canCreateForParent = isSuperAdmin(req) || actorCompanyId(req) === parentId || (authorizationRelation && await canManageRelationship(req, authorizationRelation));
    if (!parentId || !canCreateForParent) throw fail('Only the parent company administrator can create this relationship.', 403);
    await validateCompanies(parentId, childId);
    const startDate = validDate(payload.startDate || payload.effectiveOn, 'startDate');
    const endDate = validDate(payload.endDate || payload.expiresOn, 'endDate');
    if (startDate && endDate && startDate > endDate) throw fail('startDate must be on or before endDate.');
    const result = await insert(`INSERT INTO franchise_relationships
      (parent_company_id, child_company_id, relationship_type, status, start_date, end_date, agreement_number, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [parentId, childId, relationshipType, status, startDate, endDate, text(payload.agreementNumber, 120), text(payload.notes, 2000), req.user.id]);
    await setCompanyRelationshipMetadata(parentId, childId, relationshipType);
    const relation = await getRelationship(result.id);
    if (payload.agreement && typeof payload.agreement === 'object') await createAgreement(req, result.id, payload.agreement, relation);
    await audit(req, 'create', 'franchise_relationship', result.id, null, relation, parentId);
    return getRelationship(result.id);
  }

  async function createAgreement(req, relationshipId, payload, relationOverride = null) {
    const relation = relationOverride || await relationForRequest(req, relationshipId, { scope: 'management', write: true });
    const agreementNumber = text(payload.agreementNumber || payload.number, 120);
    if (!agreementNumber) throw fail('agreementNumber is required.');
    const status = String(payload.status || 'draft').trim().toLowerCase();
    if (!AGREEMENT_STATUSES.has(status)) throw fail('Invalid agreement status.');
    const signedOn = validDate(payload.signedOn, 'signedOn');
    const effectiveOn = validDate(payload.effectiveOn, 'effectiveOn');
    const expiresOn = validDate(payload.expiresOn, 'expiresOn');
    if (effectiveOn && expiresOn && effectiveOn > expiresOn) throw fail('effectiveOn must be on or before expiresOn.');
    const currency = text(payload.currency || 'PKR', 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw fail('currency must be a three-letter ISO code.');
    const result = await insert(`INSERT INTO franchise_agreements
      (relationship_id, agreement_number, status, signed_on, effective_on, expires_on, document_url, terms, joining_fee, recurring_fee, currency, revenue_share_percent, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [relationshipId, agreementNumber, status, signedOn, effectiveOn, expiresOn, text(payload.documentUrl, 500), text(payload.terms, 10000), nonNegative(payload.joiningFee ?? 0, 'joiningFee'), nonNegative(payload.recurringFee ?? 0, 'recurringFee'), currency, percent(payload.revenueSharePercent ?? 0, 'revenueSharePercent'), req.user.id]);
    const row = (await query('SELECT * FROM franchise_agreements WHERE id = ?', [result.id]))[0];
    await audit(req, 'create', 'franchise_agreement', result.id, null, row, relation.parent_company_id);
    return row;
  }

  async function createFee(req, relationshipId, payload) {
    const relation = await relationForRequest(req, relationshipId, { scope: 'financial', write: true });
    const feeType = String(payload.feeType || payload.type || 'other').trim().toLowerCase();
    const frequency = String(payload.frequency || 'one_time').trim().toLowerCase();
    const status = String(payload.status || 'pending').trim().toLowerCase();
    if (!FEE_TYPES.has(feeType) || !FEE_FREQUENCIES.has(frequency) || !FEE_STATUSES.has(status)) throw fail('Invalid fee type, frequency, or status.');
    const dueDate = validDate(payload.dueDate, 'dueDate');
    const currency = text(payload.currency || 'PKR', 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw fail('currency must be a three-letter ISO code.');
    const result = await insert(`INSERT INTO franchise_fees
      (relationship_id, fee_type, description, amount, currency, frequency, due_date, status, paid_at, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [relationshipId, feeType, text(payload.description, 500), nonNegative(payload.amount, 'amount'), currency, frequency, dueDate, status, payload.paidAt ? validDate(payload.paidAt, 'paidAt') : null, text(payload.notes, 2000), req.user.id]);
    const row = (await query('SELECT * FROM franchise_fees WHERE id = ?', [result.id]))[0];
    await audit(req, 'create', 'franchise_fee', result.id, null, row, relation.parent_company_id);
    return row;
  }

  async function createRevenueShare(req, relationshipId, payload) {
    const relation = await relationForRequest(req, relationshipId, { scope: 'financial', write: true });
    const periodStart = validDate(payload.periodStart, 'periodStart', true);
    const periodEnd = validDate(payload.periodEnd, 'periodEnd', true);
    if (periodStart > periodEnd) throw fail('periodStart must be on or before periodEnd.');
    const grossRevenue = nonNegative(payload.grossRevenue ?? 0, 'grossRevenue');
    const deductions = nonNegative(payload.deductions ?? 0, 'deductions');
    if (deductions > grossRevenue) throw fail('deductions cannot exceed grossRevenue.');
    const basisAmount = payload.basisAmount == null ? Math.round((grossRevenue - deductions) * 100) / 100 : nonNegative(payload.basisAmount, 'basisAmount');
    const sharePercent = percent(payload.sharePercent ?? payload.revenueSharePercent ?? 0, 'sharePercent');
    const parentAmount = payload.parentAmount == null ? Math.round(basisAmount * sharePercent / 100 * 100) / 100 : nonNegative(payload.parentAmount, 'parentAmount');
    const childAmount = payload.childAmount == null ? Math.round((basisAmount - parentAmount) * 100) / 100 : nonNegative(payload.childAmount, 'childAmount');
    if (parentAmount > basisAmount || childAmount > basisAmount || parentAmount + childAmount > basisAmount) throw fail('Revenue share amounts cannot exceed the net revenue basis.');
    const status = String(payload.status || 'draft').trim().toLowerCase();
    if (!REVENUE_STATUSES.has(status)) throw fail('Invalid revenue share status.');
    const result = await insert(`INSERT INTO franchise_revenue_shares
      (relationship_id, period_start, period_end, gross_revenue, deductions, basis_amount, share_percent, parent_amount, child_amount, status, settled_at, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [relationshipId, periodStart, periodEnd, grossRevenue, deductions, basisAmount, sharePercent, parentAmount, childAmount, status, payload.settledAt ? validDate(payload.settledAt, 'settledAt') : null, text(payload.notes, 2000), req.user.id]);
    const row = (await query('SELECT * FROM franchise_revenue_shares WHERE id = ?', [result.id]))[0];
    await audit(req, 'create', 'franchise_revenue_share', result.id, null, row, relation.parent_company_id);
    return row;
  }

  async function ensureTargetUser(relation, userId) {
    const user = (await query('SELECT id, company_id, name, username, role, active FROM users WHERE id = ? AND active = 1', [userId]))[0];
    if (!user) throw fail('User not found.', 404);
    if (![Number(relation.parent_company_id), Number(relation.child_company_id)].includes(Number(user.company_id))) throw fail('The user must belong to the parent or child company.');
    return user;
  }

  async function assignUser(req, relationshipId, payload) {
    const relation = await relationForRequest(req, relationshipId, { write: true });
    const userId = integerId(payload.userId);
    if (!userId) throw fail('userId is required.');
    const user = await ensureTargetUser(relation, userId);
    const assignmentType = String(payload.assignmentType || payload.type || 'employee').trim().toLowerCase();
    if (!ASSIGNMENT_TYPES.has(assignmentType)) throw fail('assignmentType must be manager or employee.');
    const scopes = normalizeScopes(payload.scopes || payload.scope);
    const defaultScopes = assignmentType === 'manager' ? DEFAULT_MANAGER_SCOPES : DEFAULT_EMPLOYEE_SCOPES;
    const selectedScopes = scopes.length ? scopes : defaultScopes;
    const existing = (await query('SELECT * FROM franchise_user_assignments WHERE relationship_id = ? AND user_id = ?', [relationshipId, userId]))[0];
    let assignmentId;
    if (existing) {
      await update('UPDATE franchise_user_assignments SET assignment_type = ?, active = ?, notes = ?, assigned_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [assignmentType, bool(payload.active, true), text(payload.notes, 2000), req.user.id, existing.id]);
      assignmentId = existing.id;
    } else {
      assignmentId = (await insert(`INSERT INTO franchise_user_assignments (relationship_id, user_id, assignment_type, active, notes, assigned_by) VALUES (?, ?, ?, ?, ?, ?)`, [relationshipId, userId, assignmentType, bool(payload.active, true), text(payload.notes, 2000), req.user.id])).id;
    }
    for (const scope of selectedScopes) {
      const canWrite = payload.permissions && typeof payload.permissions === 'object' && payload.permissions[scope] && payload.permissions[scope].canWrite !== undefined ? bool(payload.permissions[scope].canWrite) : (assignmentType === 'manager' && scope !== 'consolidated_reports' ? 1 : 0);
      const canRead = payload.permissions && typeof payload.permissions === 'object' && payload.permissions[scope] && payload.permissions[scope].canRead !== undefined ? bool(payload.permissions[scope].canRead, true) : 1;
      await insert(`INSERT INTO franchise_scope_grants (relationship_id, user_id, scope, can_read, can_write, granted_by)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(relationship_id, user_id, scope) DO UPDATE SET can_read = excluded.can_read, can_write = excluded.can_write, granted_by = excluded.granted_by, updated_at = CURRENT_TIMESTAMP`, [relationshipId, userId, scope, canRead, canWrite, req.user.id]);
    }
    const row = (await query('SELECT * FROM franchise_user_assignments WHERE id = ?', [assignmentId]))[0];
    await audit(req, 'assign', 'franchise_user_assignment', assignmentId, existing || null, { ...row, user: user, scopes: selectedScopes }, relation.parent_company_id);
    return { ...row, user, scopes: await query('SELECT * FROM franchise_scope_grants WHERE relationship_id = ? AND user_id = ? ORDER BY scope', [relationshipId, userId]) };
  }

  async function grantScope(req, relationshipId, payload) {
    const relation = await relationForRequest(req, relationshipId, { write: true });
    if (!(await canGrantScopes(req, relation))) throw fail('Only an authorized franchise manager can grant scopes.', 403);
    const userId = integerId(payload.userId);
    const scope = String(payload.scope || '').trim().toLowerCase();
    if (!userId || !SCOPES.has(scope)) throw fail('userId and a valid scope are required.');
    await ensureTargetUser(relation, userId);
    const existingAssignment = (await query('SELECT id FROM franchise_user_assignments WHERE relationship_id = ? AND user_id = ? AND active = 1', [relationshipId, userId]))[0];
    if (!existingAssignment) throw fail('Assign the user to the franchise before granting a scope.');
    const result = await insert(`INSERT INTO franchise_scope_grants (relationship_id, user_id, scope, can_read, can_write, granted_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(relationship_id, user_id, scope) DO UPDATE SET can_read = excluded.can_read, can_write = excluded.can_write, granted_by = excluded.granted_by, updated_at = CURRENT_TIMESTAMP`, [relationshipId, userId, scope, bool(payload.canRead, true), bool(payload.canWrite), req.user.id]);
    const row = (await query('SELECT * FROM franchise_scope_grants WHERE relationship_id = ? AND user_id = ? AND scope = ?', [relationshipId, userId, scope]))[0];
    await audit(req, 'grant', 'franchise_scope', row.id, null, row, relation.parent_company_id);
    return row;
  }

  async function grantReportPermission(req, relationshipId, payload) {
    const relation = await relationForRequest(req, relationshipId, { write: true });
    if (!(await canGrantScopes(req, relation))) throw fail('Only an authorized franchise manager can grant report permissions.', 403);
    const userId = integerId(payload.userId);
    const reportKey = String(payload.reportKey || 'consolidated_reports').trim().toLowerCase();
    if (!userId || !REPORT_KEYS.has(reportKey)) throw fail('userId and a supported reportKey are required.');
    await ensureTargetUser(relation, userId);
    if (!(await query('SELECT id FROM franchise_user_assignments WHERE relationship_id = ? AND user_id = ? AND active = 1', [relationshipId, userId]))[0]) throw fail('Assign the user to the franchise before granting report access.');
    const consolidated = bool(payload.consolidated, reportKey.startsWith('consolidated_'));
    const result = await insert(`INSERT INTO franchise_report_permissions (relationship_id, user_id, report_key, can_view, can_export, consolidated, granted_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(relationship_id, user_id, report_key) DO UPDATE SET can_view = excluded.can_view, can_export = excluded.can_export, consolidated = excluded.consolidated, granted_by = excluded.granted_by, updated_at = CURRENT_TIMESTAMP`, [relationshipId, userId, reportKey, bool(payload.canView, true), bool(payload.canExport), consolidated, req.user.id]);
    const row = (await query('SELECT * FROM franchise_report_permissions WHERE id = (SELECT id FROM franchise_report_permissions WHERE relationship_id = ? AND user_id = ? AND report_key = ?)', [relationshipId, userId, reportKey]))[0];
    await audit(req, 'grant', 'franchise_report_permission', row.id, null, row, relation.parent_company_id);
    return row;
  }

  async function permittedCompanyIds(req, parentCompanyId, scope, reportKey = null) {
    const parentId = integerId(parentCompanyId);
    if (!parentId) throw fail('A valid parent company is required.');
    const parent = (await query('SELECT id, active FROM companies WHERE id = ?', [parentId]))[0];
    if (!parent || Number(parent.active) !== 1) throw fail('Parent company not found.', 404);
    if (isSuperAdmin(req) || (req.user?.role === 'company_admin' && actorCompanyId(req) === parentId)) {
      const rows = await query(`WITH RECURSIVE descendants(id) AS (
        SELECT child_company_id FROM franchise_relationships WHERE parent_company_id = ? AND status IN ('pending','active','suspended')
        UNION ALL
        SELECT r.child_company_id FROM franchise_relationships r JOIN descendants d ON r.parent_company_id = d.id WHERE r.status IN ('pending','active','suspended')
      ) SELECT id FROM descendants`, [parentId]);
      return { ids: [parentId, ...rows.map((row) => Number(row.id))], relationIds: [] };
    }
    const companyId = actorCompanyId(req);
    const direct = await query(`SELECT r.id, r.child_company_id FROM franchise_relationships r
      WHERE r.parent_company_id = ? AND r.status IN ('pending','active','suspended') AND EXISTS (
        SELECT 1 FROM franchise_user_assignments a JOIN franchise_scope_grants g ON g.relationship_id = a.relationship_id AND g.user_id = a.user_id
        WHERE a.relationship_id = r.id AND a.user_id = ? AND a.active = 1 AND g.scope = ? AND g.can_read = 1
      )`, [parentId, req.user?.id, scope]);
    const own = req.user?.role === 'company_admin' ? await query(`SELECT r.id, r.child_company_id FROM franchise_relationships r WHERE r.parent_company_id = ? AND r.child_company_id = ? AND r.status IN ('pending','active','suspended')`, [parentId, companyId]) : [];
    const relationRows = [...direct, ...own].filter((row, index, rows) => rows.findIndex((other) => Number(other.id) === Number(row.id)) === index);
    if (!relationRows.length) throw fail('You do not have the requested franchise scope.', 403);
    const rootIds = relationRows.map((row) => Number(row.child_company_id));
    if (reportKey) {
      const allowed = await query(`SELECT r.id FROM franchise_relationships r JOIN franchise_report_permissions p ON p.relationship_id = r.id
        WHERE r.id IN (${relationRows.map(() => '?').join(',') || 'NULL'}) AND p.user_id = ? AND p.report_key IN (?, 'consolidated_reports') AND p.can_view = 1 AND p.consolidated = 1`, [...relationRows.map((row) => row.id), req.user?.id, reportKey]);
      if (!allowed.length && companyId !== parentId) throw fail('You are not authorized for this consolidated report.', 403);
    }
    if (companyId === parentId && !relationRows.length) return { ids: [parentId], relationIds: [] };
    if (!rootIds.length) return { ids: [companyId], relationIds: relationRows.map((row) => Number(row.id)) };
    const descendants = await query(`WITH RECURSIVE descendants(id) AS (
      SELECT child_company_id FROM franchise_relationships WHERE parent_company_id IN (${rootIds.map(() => '?').join(',')}) AND status IN ('pending','active','suspended')
      UNION ALL
      SELECT r.child_company_id FROM franchise_relationships r JOIN descendants d ON r.parent_company_id = d.id WHERE r.status IN ('pending','active','suspended')
    ) SELECT id FROM descendants`, rootIds);
    return { ids: [companyId === parentId ? parentId : companyId, ...rootIds, ...descendants.map((row) => Number(row.id))].filter((value, index, values) => values.indexOf(value) === index), relationIds: relationRows.map((row) => Number(row.id)) };
  }

  function dateRange(queryParams) {
    const start = queryParams.startDate ? validDate(queryParams.startDate, 'startDate') : null;
    const end = queryParams.endDate ? validDate(queryParams.endDate, 'endDate') : null;
    if (start && end && start > end) throw fail('startDate must be on or before endDate.');
    return { start, end };
  }

  async function consolidatedReport(req, parentCompanyId, queryParams, scope = 'reports') {
    const { start, end } = dateRange(queryParams);
    const reportKey = String(queryParams.reportKey || 'consolidated_reports').trim().toLowerCase();
    if (!REPORT_KEYS.has(reportKey)) throw fail('Unsupported reportKey.');
    const allowed = await permittedCompanyIds(req, parentCompanyId, scope, reportKey);
    const ids = allowed.ids;
    const placeholders = ids.map(() => '?').join(',');
    const dateSales = start ? ` AND s.created_at >= ?` : '';
    const dateSalesEnd = end ? ` AND s.created_at < date(?, '+1 day')` : '';
    const dateOrders = start ? ` AND o.created_at >= ?` : '';
    const dateOrdersEnd = end ? ` AND o.created_at < date(?, '+1 day')` : '';
    const salesParams = [...ids, ...(start ? [start] : []), ...(end ? [end] : [])];
    const orderParams = [...ids, ...(start ? [start] : []), ...(end ? [end] : [])];
    const [companies, sales, orders, customers, products] = await Promise.all([
      query(`SELECT id, name, tenant_type, parent_company_id FROM companies WHERE id IN (${placeholders}) ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, name`, [...ids, Number(parentCompanyId)]),
      query(`SELECT s.company_id, c.name AS company_name, COUNT(s.id) AS transaction_count, COALESCE(SUM(s.total_amount), 0) AS revenue FROM sales s JOIN companies c ON c.id = s.company_id WHERE s.company_id IN (${placeholders})${dateSales}${dateSalesEnd} GROUP BY s.company_id ORDER BY c.name`, salesParams),
      query(`SELECT o.company_id, c.name AS company_name, COUNT(o.id) AS order_count, COALESCE(SUM(o.total_amount), 0) AS order_value FROM orders o JOIN companies c ON c.id = o.company_id WHERE o.company_id IN (${placeholders})${dateOrders}${dateOrdersEnd} GROUP BY o.company_id ORDER BY c.name`, orderParams),
      query(`SELECT company_id, COUNT(*) AS customer_count FROM customers WHERE company_id IN (${placeholders}) GROUP BY company_id`, ids),
      query(`SELECT company_id, COUNT(*) AS product_count, COALESCE(SUM(stock), 0) AS stock_units FROM products WHERE company_id IN (${placeholders}) GROUP BY company_id`, ids)
    ]);
    const byCompany = new Map(companies.map((company) => [Number(company.id), { ...company, revenue: 0, transaction_count: 0, order_count: 0, order_value: 0, customer_count: 0, product_count: 0, stock_units: 0 }]));
    sales.forEach((row) => Object.assign(byCompany.get(Number(row.company_id)), { revenue: Number(row.revenue || 0), transaction_count: Number(row.transaction_count || 0) }));
    orders.forEach((row) => Object.assign(byCompany.get(Number(row.company_id)), { order_count: Number(row.order_count || 0), order_value: Number(row.order_value || 0) }));
    customers.forEach((row) => { if (byCompany.has(Number(row.company_id))) byCompany.get(Number(row.company_id)).customer_count = Number(row.customer_count || 0); });
    products.forEach((row) => { if (byCompany.has(Number(row.company_id))) Object.assign(byCompany.get(Number(row.company_id)), { product_count: Number(row.product_count || 0), stock_units: Number(row.stock_units || 0) }); });
    const allMetrics = ['revenue', 'transaction_count', 'order_count', 'order_value', 'customer_count', 'product_count', 'stock_units'];
    const metricsByReport = {
      consolidated_reports: allMetrics,
      consolidated_sales: ['revenue', 'transaction_count'],
      consolidated_inventory: ['product_count', 'stock_units'],
      consolidated_customers: ['customer_count'],
      consolidated_financial: ['revenue', 'transaction_count', 'order_count', 'order_value']
    };
    const metrics = metricsByReport[reportKey];
    const totalNames = { revenue: 'revenue', transaction_count: 'transactionCount', order_count: 'orderCount', order_value: 'orderValue', customer_count: 'customerCount', product_count: 'productCount', stock_units: 'stockUnits' };
    const rows = [...byCompany.values()].map((row) => {
      const exposed = { id: Number(row.id), company_name: row.name };
      metrics.forEach((metric) => { exposed[metric] = row[metric]; });
      return exposed;
    });
    const totals = {};
    metrics.forEach((metric) => { totals[totalNames[metric]] = rows.reduce((sum, row) => sum + Number(row[metric] || 0), 0); });
    return {
      parentCompanyId: Number(parentCompanyId),
      reportKey,
      companyIds: ids,
      period: { start, end },
      totals,
      rows
    };
  }

  async function scopedData(req, parentCompanyId, scope) {
    const normalizedScope = String(scope || '').trim().toLowerCase();
    if (!SCOPES.has(normalizedScope) || normalizedScope === 'management') throw fail('A data scope of employees, customers, inventory, financial, consolidated_reports, or reports is required.');
    if (normalizedScope === 'financial') return consolidatedReport(req, parentCompanyId, { reportKey: 'consolidated_financial' }, 'financial');
    if (normalizedScope === 'consolidated_reports') return consolidatedReport(req, parentCompanyId, { reportKey: 'consolidated_reports' }, 'consolidated_reports');
    const allowed = await permittedCompanyIds(req, parentCompanyId, normalizedScope);
    const ids = allowed.ids;
    const placeholders = ids.map(() => '?').join(',');
    if (normalizedScope === 'employees') return { scope: normalizedScope, companyIds: ids, rows: await query(`SELECT id, company_id, name, role, active, created_at FROM users WHERE company_id IN (${placeholders}) AND active = 1 ORDER BY company_id, name`, ids) };
    if (normalizedScope === 'customers') return { scope: normalizedScope, companyIds: ids, rows: await query(`SELECT * FROM customers WHERE company_id IN (${placeholders}) ORDER BY company_id, name`, ids) };
    if (normalizedScope === 'inventory') return { scope: normalizedScope, companyIds: ids, rows: await query(`SELECT * FROM products WHERE company_id IN (${placeholders}) ORDER BY company_id, name`, ids) };
    return consolidatedReport(req, parentCompanyId, { reportKey: 'consolidated_reports' }, 'reports');
  }

  function registerRoutes(app) {
    app.use(['/api/franchises', '/api/franchise-scope'], waitForSchema);
    app.get('/api/franchises', async (req, res) => { try { res.json(await visibleRelationships(req)); } catch (error) { errorResponse(res, error); } });

    app.post('/api/franchises', async (req, res) => { try { const row = await createRelationship(req, req.body || {}); res.status(201).json(row); } catch (error) { errorResponse(res, error); } });

    app.get('/api/franchises/:id', async (req, res) => { try { const relation = await relationForRequest(req, integerId(req.params.id), { scope: 'any' }); res.json(await relationDetail(req, relation)); } catch (error) { errorResponse(res, error); } });

    app.patch('/api/franchises/:id', async (req, res) => {
      try {
        const relation = await relationForRequest(req, integerId(req.params.id), { write: true });
        if (!(await canManageRelationship(req, relation))) throw fail('Only the parent company administrator can update the relationship.', 403);
        const status = req.body?.status == null ? relation.status : String(req.body.status).trim().toLowerCase();
        if (!RELATIONSHIP_STATUSES.has(status)) throw fail('Invalid franchise relationship status.');
        const startDate = req.body?.startDate === undefined ? relation.start_date : validDate(req.body.startDate, 'startDate');
        const endDate = req.body?.endDate === undefined ? relation.end_date : validDate(req.body.endDate, 'endDate');
        if (startDate && endDate && startDate > endDate) throw fail('startDate must be on or before endDate.');
        await update(`UPDATE franchise_relationships SET status = ?, start_date = ?, end_date = ?, agreement_number = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, startDate, endDate, req.body?.agreementNumber === undefined ? relation.agreement_number : text(req.body.agreementNumber, 120), req.body?.notes === undefined ? relation.notes : text(req.body.notes, 2000), relation.id]);
        if (status === 'terminated') await update('UPDATE franchise_user_assignments SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE relationship_id = ?', [relation.id]);
        const next = await getRelationship(relation.id);
        await audit(req, 'update', 'franchise_relationship', relation.id, relation, next, relation.parent_company_id);
        res.json(next);
      } catch (error) { errorResponse(res, error); }
    });

    app.delete('/api/franchises/:id', async (req, res) => {
      try {
        const relation = await relationForRequest(req, integerId(req.params.id), { write: true });
        if (!(await canManageRelationship(req, relation))) throw fail('Only the parent company administrator can terminate the relationship.', 403);
        await update("UPDATE franchise_relationships SET status = 'terminated', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [relation.id]);
        await update('UPDATE franchise_user_assignments SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE relationship_id = ?', [relation.id]);
        const next = await getRelationship(relation.id);
        await audit(req, 'terminate', 'franchise_relationship', relation.id, relation, next, relation.parent_company_id);
        res.json(next);
      } catch (error) { errorResponse(res, error); }
    });

    app.get('/api/franchises/:id/branches', async (req, res) => {
      try {
        const relationId = integerId(req.params.id);
        const relation = await getRelationship(relationId);
        const parentId = relation ? Number(relation.child_company_id) : relationId;
        if (relation) await relationForRequest(req, relation.id);
        else if (!(isSuperAdmin(req) || actorCompanyId(req) === parentId)) throw fail('You do not have access to these branches.', 403);
        const rows = await query(`SELECT r.*, p.name AS parent_company_name, c.name AS child_company_name FROM franchise_relationships r JOIN companies p ON p.id = r.parent_company_id JOIN companies c ON c.id = r.child_company_id WHERE r.parent_company_id = ? AND r.relationship_type = 'branch' ORDER BY c.name`, [parentId]);
        res.json(rows);
      } catch (error) { errorResponse(res, error); }
    });

    app.post('/api/franchises/:id/branches', async (req, res) => {
      try {
        const relation = await relationForRequest(req, integerId(req.params.id), { write: true });
        if (!(await canManageRelationship(req, relation))) throw fail('Only the parent company administrator can add a branch.', 403);
        const row = await createRelationship(req, { ...(req.body || {}), parentCompanyId: relation.child_company_id, relationshipType: 'branch' }, relation.child_company_id, 'branch', relation);
        res.status(201).json(row);
      } catch (error) { errorResponse(res, error); }
    });

    app.get('/api/franchises/:id/agreements', async (req, res) => { try { const relation = await relationForRequest(req, integerId(req.params.id), { scope: 'financial' }); res.json(await query('SELECT * FROM franchise_agreements WHERE relationship_id = ? ORDER BY effective_on DESC, id DESC', [relation.id])); } catch (error) { errorResponse(res, error); } });
    app.post('/api/franchises/:id/agreements', async (req, res) => { try { res.status(201).json(await createAgreement(req, integerId(req.params.id), req.body || {})); } catch (error) { errorResponse(res, error); } });

    app.get('/api/franchises/:id/fees', async (req, res) => { try { const relation = await relationForRequest(req, integerId(req.params.id), { scope: 'financial' }); res.json(await query('SELECT * FROM franchise_fees WHERE relationship_id = ? ORDER BY due_date DESC, id DESC', [relation.id])); } catch (error) { errorResponse(res, error); } });
    app.post('/api/franchises/:id/fees', async (req, res) => { try { res.status(201).json(await createFee(req, integerId(req.params.id), req.body || {})); } catch (error) { errorResponse(res, error); } });

    app.get('/api/franchises/:id/revenue-shares', async (req, res) => { try { const relation = await relationForRequest(req, integerId(req.params.id), { scope: 'financial' }); res.json(await query('SELECT * FROM franchise_revenue_shares WHERE relationship_id = ? ORDER BY period_end DESC, id DESC', [relation.id])); } catch (error) { errorResponse(res, error); } });
    app.post('/api/franchises/:id/revenue-shares', async (req, res) => { try { res.status(201).json(await createRevenueShare(req, integerId(req.params.id), req.body || {})); } catch (error) { errorResponse(res, error); } });

    app.get('/api/franchises/:id/assignments', async (req, res) => { try { const relation = await relationForRequest(req, integerId(req.params.id)); res.json(await assignmentRows(relation.id)); } catch (error) { errorResponse(res, error); } });
    app.post('/api/franchises/:id/assignments', async (req, res) => { try { res.status(201).json(await assignUser(req, integerId(req.params.id), req.body || {})); } catch (error) { errorResponse(res, error); } });

    app.get('/api/franchises/:id/scopes', async (req, res) => { try { const relation = await relationForRequest(req, integerId(req.params.id)); res.json(await query('SELECT g.*, u.name AS user_name, u.username FROM franchise_scope_grants g JOIN users u ON u.id = g.user_id WHERE g.relationship_id = ? ORDER BY u.name, g.scope', [relation.id])); } catch (error) { errorResponse(res, error); } });
    app.post('/api/franchises/:id/scopes', async (req, res) => { try { res.status(201).json(await grantScope(req, integerId(req.params.id), req.body || {})); } catch (error) { errorResponse(res, error); } });

    app.get('/api/franchises/:id/report-permissions', async (req, res) => { try { const relation = await relationForRequest(req, integerId(req.params.id), { scope: 'reports' }); res.json(await reportPermissionRowsForRequest(req, relation)); } catch (error) { errorResponse(res, error); } });
    app.post('/api/franchises/:id/report-permissions', async (req, res) => { try { res.status(201).json(await grantReportPermission(req, integerId(req.params.id), req.body || {})); } catch (error) { errorResponse(res, error); } });

    app.get('/api/franchises/:parentCompanyId/scope/:scope', async (req, res) => { try { res.json(await scopedData(req, integerId(req.params.parentCompanyId), req.params.scope)); } catch (error) { errorResponse(res, error); } });
    app.get('/api/franchises/:parentCompanyId/consolidated-reports', async (req, res) => { try { res.json(await consolidatedReport(req, integerId(req.params.parentCompanyId), req.query || {})); } catch (error) { errorResponse(res, error); } });
    app.get('/api/franchises/:parentCompanyId/reports/consolidated', async (req, res) => { try { res.json(await consolidatedReport(req, integerId(req.params.parentCompanyId), req.query || {})); } catch (error) { errorResponse(res, error); } });

    app.get('/api/franchise-scope', async (req, res) => {
      try {
        const relationships = await visibleRelationships(req);
        const scopes = await query('SELECT g.relationship_id, g.scope, g.can_read, g.can_write FROM franchise_scope_grants g WHERE g.user_id = ? AND g.can_read = 1 ORDER BY g.relationship_id, g.scope', [req.user.id]);
        res.json({ companyId: actorCompanyId(req), relationships, scopes });
      } catch (error) { errorResponse(res, error); }
    });
  }

  return { initialize, registerRoutes, ready: () => initializationPromise || Promise.resolve(), get schemaReady() { return schemaReady; } };
}

module.exports = { createService };

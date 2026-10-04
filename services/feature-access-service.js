const NORMAL_FEATURES = [
  'dashboard', 'customers', 'suppliers', 'sales', 'invoices',
  'purchases', 'inventory', 'expenses', 'basic_reports'
];

const ENTERPRISE_FEATURES = [
  ...NORMAL_FEATURES, 'hr', 'employees', 'attendance', 'payroll', 'crm',
  'loyalty', 'qr_code', 'barcode', 'audit_logs', 'advanced_reports',
  'multi_branch', 'multi_warehouse', 'approval_system', 'api_access'
];

function createFeatureAccessService({ query }) {
  async function getFeatureMap(companyId, subscription) {
    const features = await query('SELECT feature_key FROM features WHERE is_active = 1 ORDER BY id');
    const featureKeys = features.map((row) => row.feature_key);
    const overrides = await query(
      `SELECT f.feature_key, cf.is_enabled
       FROM company_features cf
       JOIN features f ON f.id = cf.feature_id
       WHERE cf.company_id = ? AND f.is_active = 1`,
      [companyId]
    );
    const overrideMap = new Map(overrides.map((row) => [row.feature_key, Number(row.is_enabled) === 1]));
    let planFeatureRows = [];
    if (subscription?.plan_id) {
      planFeatureRows = await query(
        `SELECT f.feature_key, pf.is_enabled
         FROM plan_features pf
         JOIN features f ON f.id = pf.feature_id
         WHERE pf.plan_id = ? AND f.is_active = 1`,
        [subscription.plan_id]
      );
    }
    const planMap = new Map(planFeatureRows.map((row) => [row.feature_key, Number(row.is_enabled) === 1]));
    const result = {};
    for (const featureKey of featureKeys) {
      result[featureKey] = overrideMap.has(featureKey)
        ? overrideMap.get(featureKey)
        : Boolean(planMap.get(featureKey));
    }
    return result;
  }

  async function hasFeatureAccess(companyId, featureKey, subscription) {
    const key = String(featureKey || '').trim().toLowerCase();
    const features = await query('SELECT id FROM features WHERE feature_key = ? AND is_active = 1', [key]);
    if (!features[0]) return { allowed: false, feature: key, plan: subscription?.plan_slug || null };
    const map = await getFeatureMap(companyId, subscription);
    return { allowed: map[key] === true, feature: key, plan: subscription?.plan_slug || null };
  }

  function requireFeature(featureKey) {
    return async (req, res, next) => {
      if (req.user?.role === 'super_admin' || !req.companyId) return next();
      try {
        const access = await hasFeatureAccess(req.companyId, featureKey, req.subscription);
        if (access.allowed) return next();
        return res.status(403).json({
          success: false,
          code: 'FEATURE_NOT_AVAILABLE',
          feature: access.feature,
          plan: access.plan,
          message: 'This feature is not included in your current subscription plan.'
        });
      } catch (error) {
        return next(error);
      }
    };
  }

  return { getFeatureMap, hasFeatureAccess, requireFeature };
}

module.exports = { NORMAL_FEATURES, ENTERPRISE_FEATURES, createFeatureAccessService };

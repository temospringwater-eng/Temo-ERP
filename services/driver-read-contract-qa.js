'use strict';

// Central Express/SQLite driver-read contract adapter: ISOLATED QA ONLY.
// Main ERP server registers this only on an explicitly opted-in disposable qa.db,
// never when NODE_ENV=production or on the normal hayrila.db.
// This module deliberately provides no payment, stock, delivery, or OTP mutations.
const DRIVER_PERMISSION_KEYS = Object.freeze([
  'create_customer', 'create_order', 'view_balance', 'change_qty',
  'change_price', 'edit_notes', 'manage_customer_schedule',
  'gps_delivery_override', 'refund_security_deposit',
  'sale_quotation', 'stock_negative_override', 'view_customer_ledger',
  'collect_recovery', 'view_zone', 'view_van_stock'
]);
const SIX_FIELD_KEYS = new Set([
  'create_customer', 'create_order', 'view_customer_ledger',
  'collect_recovery', 'view_zone', 'view_van_stock'
]);

function createDriverReadContractQa({ app, query, qaEnabled = false }) {
  if (!qaEnabled) return false;
  if (!app || typeof app.get !== 'function' || typeof query !== 'function')
    throw new TypeError('QA driver read requires an Express app and scoped database query');

  const response = (res, status, data) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(status).json(data);
  };
  const auth = (req, res, next) => {
    const actor = req.user;
    if (!actor) return response(res, 401, { error: 'Authentication required' });
    const userId = Number(actor.id);
    const companyId = Number(req.companyId);
    if (!['driver', 'delivery_driver'].includes(actor.role) ||
        !Number.isSafeInteger(userId) || userId < 1 ||
        !Number.isSafeInteger(companyId) || companyId < 1 ||
        Number(actor.company_id) !== companyId)
      return response(res, 403, { error: 'Driver access required' });
    req.qaDriverActor = { userId, companyId };
    next();
  };
  const handle = fn => async (req, res) => {
    try { return await fn(req, res); }
    catch (error) {
      // Never disclose SQL, DB paths, table definitions or user info.
      return response(res, 503, { error: 'QA driver read service unavailable' });
    }
  };

  app.get('/api/driver/permissions', auth, handle(async (req, res) => {
    const { companyId, userId } = req.qaDriverActor;
    const values = Object.fromEntries(DRIVER_PERMISSION_KEYS.map(key => [key, false]));
    let records;
    try {
      records = await query(
        'SELECT permission,enabled FROM driver_field_permissions WHERE company_id=? AND driver_id=?',
        [companyId, userId]
      );
    } catch (error) {
      if (!/no such table:\s*driver_field_permissions\b/i.test(String(error?.message || ''))) throw error;
      // No approved QA migration => all driver options stay disabled.
      records = [];
    }
    for (const row of records) {
      if (SIX_FIELD_KEYS.has(row.permission) && row.enabled === 1) {
        values[row.permission] = true;
      }
    }
    return response(res, 200, { driverId: userId, permissions: values });
  }));

  app.get('/api/driver/bottle-types', auth, handle(async (req, res) => {
    const { companyId } = req.qaDriverActor;
    const records = await query(
      'SELECT id,name,category,stock FROM products WHERE company_id=? ORDER BY name LIMIT 100',
      [companyId]
    );
    const items = records.map(row => ({
      id: Number(row.id), name: String(row.name), category: String(row.category || ''),
      stock: Number(row.stock || 0)
    }));
    return response(res, 200, { items });
  }));

  app.get('/api/driver/delivery-policy', auth, (req, res) =>
    response(res, 200, { otpRequired: true, source: 'qa-fail-closed' })
  );
  return true;
}

module.exports = { createDriverReadContractQa, DRIVER_PERMISSION_KEYS };

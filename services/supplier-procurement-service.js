'use strict';

function createService({ query, insert, update, writeAudit }) {
  const readRoles = ['super_admin', 'company_admin', 'manager', 'accountant', 'inventory_staff', 'sales_staff', 'staff', 'quality_manager', 'production_manager'];
  const writeRoles = ['super_admin', 'company_admin', 'manager', 'accountant', 'inventory_staff'];
  const approvalRoles = ['super_admin', 'company_admin', 'manager', 'accountant'];

  const fail = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  };
  const text = (value, max = 500) => String(value == null ? '' : value).trim().slice(0, max);
  const idOf = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const dateValue = (value, allowEmpty = true) => {
    if ((value == null || value === '') && allowEmpty) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
  };
  const money = (value, allowZero = true) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= (allowZero ? 0 : Number.EPSILON) ? Math.round(number * 100) / 100 : null;
  };
  const percentage = (value, fallback = 0) => {
    const number = value == null || value === '' ? fallback : Number(value);
    return Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number * 100) / 100 : null;
  };
  const sendError = (res, error, fallback = 500) => {
    const status = Number(error?.statusCode) || (String(error?.message || '').includes('UNIQUE') ? 409 : fallback);
    res.status(status).json({ message: status >= 500 ? 'Unable to complete the procurement request.' : error.message });
  };
  const roleMiddleware = (requireRole, roles) => requireRole(...roles);

  async function supplierForCompany(companyId, supplierId) {
    const id = idOf(supplierId);
    if (!id) return null;
    return (await query('SELECT * FROM suppliers WHERE id = ? AND company_id = ?', [id, companyId]))[0] || null;
  }

  async function categoryIdsForCompany(companyId, body) {
    const values = [];
    if (body.categoryId != null && body.categoryId !== '') values.push(body.categoryId);
    if (Array.isArray(body.categoryIds)) values.push(...body.categoryIds);
    const ids = [...new Set(values.map(idOf).filter(Boolean))].slice(0, 20);
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = await query(`SELECT id FROM supplier_categories WHERE company_id = ? AND active = 1 AND id IN (${placeholders})`, [companyId, ...ids]);
    if (rows.length !== ids.length) throw fail('Every supplier category must belong to this company.');
    return ids;
  }

  async function replaceSupplierCategories(companyId, supplierId, categoryIds, userId) {
    await update('DELETE FROM supplier_category_assignments WHERE company_id = ? AND supplier_id = ?', [companyId, supplierId]);
    for (const categoryId of categoryIds) {
      await insert('INSERT INTO supplier_category_assignments (company_id, supplier_id, category_id, assigned_by) VALUES (?, ?, ?, ?)', [companyId, supplierId, categoryId, userId]);
    }
  }

  async function supplierList(companyId, supplierId = null) {
    const params = [companyId];
    let where = 's.company_id = ?';
    if (supplierId != null) {
      where += ' AND s.id = ?';
      params.push(Number(supplierId));
    }
    return query(`
      SELECT s.*,
        COALESCE((SELECT GROUP_CONCAT(sc.name, ', ') FROM supplier_category_assignments sca JOIN supplier_categories sc ON sc.id = sca.category_id AND sc.company_id = sca.company_id WHERE sca.company_id = s.company_id AND sca.supplier_id = s.id), '') AS category_names,
        COALESCE((SELECT AVG(sr.rating) FROM supplier_ratings sr WHERE sr.company_id = s.company_id AND sr.supplier_id = s.id), 0) AS average_rating,
        (SELECT COUNT(*) FROM supplier_contacts sct WHERE sct.company_id = s.company_id AND sct.supplier_id = s.id) AS contact_count,
        COALESCE((SELECT SUM(si.balance) FROM supplier_invoices si WHERE si.company_id = s.company_id AND si.supplier_id = s.id AND si.status <> 'cancelled'), 0) AS outstanding_balance
      FROM suppliers s WHERE ${where} ORDER BY s.name COLLATE NOCASE, s.id DESC`, params);
  }

  async function normalizeLineItems(companyId, supplierId, rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 500) throw fail('At least one line item is required.');
    const items = [];
    for (const raw of rawItems) {
      const productId = raw?.productId == null || raw.productId === '' ? null : idOf(raw.productId);
      const suppliedProductId = raw?.suppliedProductId == null || raw.suppliedProductId === '' ? null : idOf(raw.suppliedProductId);
      if ((raw?.productId != null && raw.productId !== '' && !productId) || (raw?.suppliedProductId != null && raw.suppliedProductId !== '' && !suppliedProductId)) throw fail('Line item product references must be valid.');
      let product = null;
      let suppliedProduct = null;
      if (productId) {
        product = (await query('SELECT id, name, unit FROM products WHERE id = ? AND company_id = ?', [productId, companyId]))[0];
        if (!product) throw fail(`Product ${productId} was not found in this company.`, 404);
      }
      if (suppliedProductId) {
        suppliedProduct = (await query('SELECT * FROM supplier_products WHERE id = ? AND company_id = ? AND supplier_id = ?', [suppliedProductId, companyId, supplierId]))[0];
        if (!suppliedProduct) throw fail(`Supplied product ${suppliedProductId} was not found for this supplier.`, 404);
      }
      const quantity = money(raw?.quantity, false);
      const defaultPrice = suppliedProduct ? suppliedProduct.unit_price : null;
      const unitPrice = money(raw?.unitPrice == null || raw.unitPrice === '' ? defaultPrice : raw.unitPrice);
      const taxRate = percentage(raw?.taxRate, 0);
      const description = text(raw?.description || suppliedProduct?.product_name || product?.name, 240);
      if (!quantity || !unitPrice && unitPrice !== 0 || taxRate == null || !description) throw fail('Each line item needs a description, positive quantity, non-negative price, and valid tax rate.');
      const lineSubtotal = Math.round(quantity * unitPrice * 100) / 100;
      const taxAmount = Math.round(lineSubtotal * taxRate / 100 * 100) / 100;
      items.push({ productId: product?.id || null, suppliedProductId: suppliedProduct?.id || null, description, quantity, unitPrice, taxRate, taxAmount, totalPrice: Math.round((lineSubtotal + taxAmount) * 100) / 100 });
    }
    return items;
  }

  function totalsFor(items) {
    const subtotal = Math.round(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) * 100) / 100;
    const tax = Math.round(items.reduce((sum, item) => sum + item.taxAmount, 0) * 100) / 100;
    return { subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100 };
  }

  async function quotationDetail(companyId, quotationId) {
    const quotation = (await query(`SELECT q.*, s.name AS supplier_name FROM supplier_quotations q JOIN suppliers s ON s.id = q.supplier_id AND s.company_id = q.company_id WHERE q.id = ? AND q.company_id = ?`, [quotationId, companyId]))[0];
    if (!quotation) return null;
    quotation.items = await query('SELECT * FROM supplier_quotation_items WHERE quotation_id = ? AND company_id = ? ORDER BY id', [quotationId, companyId]);
    return quotation;
  }

  async function purchaseOrderDetail(companyId, orderId) {
    const order = (await query(`SELECT po.*, s.name AS supplier_name, q.quotation_number FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id AND s.company_id = po.company_id LEFT JOIN supplier_quotations q ON q.id = po.quotation_id AND q.company_id = po.company_id WHERE po.id = ? AND po.company_id = ?`, [orderId, companyId]))[0];
    if (!order) return null;
    order.items = await query('SELECT * FROM purchase_order_items WHERE purchase_order_id = ? AND company_id = ? ORDER BY id', [orderId, companyId]);
    return order;
  }

  async function invoiceDetail(companyId, invoiceId) {
    const invoice = (await query(`SELECT i.*, s.name AS supplier_name, po.po_number FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id AND s.company_id = i.company_id LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id AND po.company_id = i.company_id WHERE i.id = ? AND i.company_id = ?`, [invoiceId, companyId]))[0];
    if (!invoice) return null;
    invoice.items = await query('SELECT * FROM supplier_invoice_items WHERE supplier_invoice_id = ? AND company_id = ? ORDER BY id', [invoiceId, companyId]);
    return invoice;
  }

  function registerRoutes(app, requireRole) {
    const read = roleMiddleware(requireRole, readRoles);
    const write = roleMiddleware(requireRole, writeRoles);
    const approve = roleMiddleware(requireRole, approvalRoles);

    app.get('/api/procurement/summary', read, async (req, res) => {
      try {
        const [suppliers, quotations, orders, invoices, outstanding, contracts] = await Promise.all([
          query('SELECT COUNT(*) AS count FROM suppliers WHERE company_id = ?', [req.companyId]),
          query("SELECT COUNT(*) AS count FROM supplier_quotations WHERE company_id = ? AND status NOT IN ('cancelled','rejected')", [req.companyId]),
          query("SELECT COUNT(*) AS count FROM purchase_orders WHERE company_id = ? AND status NOT IN ('cancelled','received')", [req.companyId]),
          query("SELECT COUNT(*) AS count FROM supplier_invoices WHERE company_id = ? AND status <> 'cancelled'", [req.companyId]),
          query("SELECT COALESCE(SUM(balance), 0) AS amount FROM supplier_invoices WHERE company_id = ? AND status <> 'cancelled'", [req.companyId]),
          query("SELECT COUNT(*) AS count FROM supplier_contracts WHERE company_id = ? AND expires_on IS NOT NULL AND expires_on <= date('now', '+90 day') AND status NOT IN ('cancelled','expired')", [req.companyId])
        ]);
        res.json({ suppliers: Number(suppliers[0].count), quotations: Number(quotations[0].count), openPurchaseOrders: Number(orders[0].count), invoices: Number(invoices[0].count), outstandingBalance: Number(outstanding[0].amount || 0), contractsExpiring: Number(contracts[0].count) });
      } catch (error) { sendError(res, error); }
    });

    app.get('/api/suppliers', read, async (req, res) => {
      try { res.json(await supplierList(req.companyId)); } catch (error) { sendError(res, error); }
    });

    app.get('/api/suppliers/:id/account', read, async (req, res) => {
      try {
        const supplier = (await supplierList(req.companyId, req.params.id))[0];
        if (!supplier) return res.status(404).json({ message: 'Supplier not found.' });
        const [invoices, payments, purchaseOrders, ratings, contracts] = await Promise.all([
          query('SELECT * FROM supplier_invoices WHERE company_id = ? AND supplier_id = ? ORDER BY due_date IS NULL, due_date, id DESC', [req.companyId, supplier.id]),
          query('SELECT sp.*, i.invoice_number FROM supplier_payments sp LEFT JOIN supplier_invoices i ON i.id = sp.invoice_id AND i.company_id = sp.company_id WHERE sp.company_id = ? AND sp.supplier_id = ? ORDER BY sp.payment_date DESC, sp.id DESC', [req.companyId, supplier.id]),
          query('SELECT * FROM purchase_orders WHERE company_id = ? AND supplier_id = ? ORDER BY order_date DESC, id DESC', [req.companyId, supplier.id]),
          query('SELECT sr.*, u.name AS created_by_name FROM supplier_ratings sr LEFT JOIN users u ON u.id = sr.created_by WHERE sr.company_id = ? AND sr.supplier_id = ? ORDER BY sr.created_at DESC, sr.id DESC', [req.companyId, supplier.id]),
          query('SELECT * FROM supplier_contracts WHERE company_id = ? AND supplier_id = ? ORDER BY expires_on IS NULL, expires_on, id DESC', [req.companyId, supplier.id])
        ]);
        res.json({ supplier, invoices, payments, purchaseOrders, ratings, contracts, balance: Number(supplier.outstanding_balance || 0) });
      } catch (error) { sendError(res, error); }
    });

    app.get('/api/suppliers/:id/documents', read, async (req, res) => {
      try {
        if (!await supplierForCompany(req.companyId, req.params.id)) return res.status(404).json({ message: 'Supplier not found.' });
        res.json(await query("SELECT d.*, v.version_number, v.original_filename, v.mime_type, v.upload_status FROM document_records d LEFT JOIN document_versions v ON v.id = d.current_version_id WHERE d.company_id = ? AND ((d.entity_type = 'supplier' AND d.entity_id = ?) OR (d.entity_type = 'supplier_contract' AND d.entity_id IN (SELECT id FROM supplier_contracts WHERE company_id = ? AND supplier_id = ?))) ORDER BY COALESCE(d.expires_on, '9999-12-31'), d.id DESC", [req.companyId, Number(req.params.id), req.companyId, Number(req.params.id)]));
      } catch (error) { sendError(res, error); }
    });

    app.get('/api/suppliers/:id', read, async (req, res) => {
      try { const supplier = (await supplierList(req.companyId, req.params.id))[0]; if (!supplier) return res.status(404).json({ message: 'Supplier not found.' }); res.json(supplier); } catch (error) { sendError(res, error); }
    });

    app.post('/api/suppliers', write, async (req, res) => {
      try {
        const body = req.body || {};
        const name = text(body.name, 160);
        const paymentTermsDays = body.paymentTermsDays == null || body.paymentTermsDays === '' ? 0 : Number(body.paymentTermsDays);
        const categoryIds = await categoryIdsForCompany(req.companyId, body);
        if (!name || !Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 3650) throw fail('Supplier name and valid payment terms are required.');
        const result = await insert('INSERT INTO suppliers (company_id, name, phone, address, email, website, tax_id, payment_terms_days, currency, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, name, text(body.phone, 60), text(body.address, 240), text(body.email, 160), text(body.website, 240), text(body.taxId, 100), paymentTermsDays, text(body.currency || 'PKR', 3).toUpperCase(), ['active', 'inactive', 'blocked'].includes(body.status) ? body.status : 'active', text(body.notes, 2000)]);
        await replaceSupplierCategories(req.companyId, result.id, categoryIds, req.user.id);
        const supplier = (await supplierList(req.companyId, result.id))[0];
        await writeAudit(req, 'create', 'supplier', result.id, null, supplier);
        res.status(201).json(supplier);
      } catch (error) { sendError(res, error, 400); }
    });

    app.patch('/api/suppliers/:id', write, async (req, res) => {
      try {
        const id = idOf(req.params.id); const existing = await supplierForCompany(req.companyId, id);
        if (!existing) return res.status(404).json({ message: 'Supplier not found.' });
        const body = req.body || {};
        const name = body.name === undefined ? existing.name : text(body.name, 160);
        const terms = body.paymentTermsDays === undefined ? Number(existing.payment_terms_days || 0) : Number(body.paymentTermsDays);
        if (!name || !Number.isInteger(terms) || terms < 0 || terms > 3650) throw fail('Supplier name and valid payment terms are required.');
        await update('UPDATE suppliers SET name = ?, phone = ?, address = ?, email = ?, website = ?, tax_id = ?, payment_terms_days = ?, currency = ?, status = ?, notes = ? WHERE id = ? AND company_id = ?', [name, body.phone === undefined ? existing.phone : text(body.phone, 60), body.address === undefined ? existing.address : text(body.address, 240), body.email === undefined ? existing.email : text(body.email, 160), body.website === undefined ? existing.website : text(body.website, 240), body.taxId === undefined ? existing.tax_id : text(body.taxId, 100), terms, body.currency === undefined ? existing.currency : text(body.currency, 3).toUpperCase(), body.status === undefined ? existing.status : (['active', 'inactive', 'blocked'].includes(body.status) ? body.status : existing.status), body.notes === undefined ? existing.notes : text(body.notes, 2000), id, req.companyId]);
        if (body.categoryId !== undefined || body.categoryIds !== undefined) await replaceSupplierCategories(req.companyId, id, await categoryIdsForCompany(req.companyId, body), req.user.id);
        const supplier = (await supplierList(req.companyId, id))[0];
        await writeAudit(req, 'update', 'supplier', id, existing, supplier);
        res.json(supplier);
      } catch (error) { sendError(res, error, 400); }
    });

    app.put('/api/suppliers/:id/categories', write, async (req, res) => {
      try {
        const id = idOf(req.params.id); const existing = await supplierForCompany(req.companyId, id);
        if (!existing || !Array.isArray(req.body?.categoryIds)) return res.status(400).json({ message: 'Supplier and categoryIds are required.' });
        const categoryIds = await categoryIdsForCompany(req.companyId, { categoryIds: req.body.categoryIds });
        await replaceSupplierCategories(req.companyId, id, categoryIds, req.user.id);
        const supplier = (await supplierList(req.companyId, id))[0];
        await writeAudit(req, 'categories_update', 'supplier', id, existing, supplier);
        res.json(supplier);
      } catch (error) { sendError(res, error, 400); }
    });

    app.get('/api/supplier-categories', read, async (req, res) => {
      try { res.json(await query('SELECT c.*, COUNT(a.supplier_id) AS supplier_count FROM supplier_categories c LEFT JOIN supplier_category_assignments a ON a.category_id = c.id AND a.company_id = c.company_id WHERE c.company_id = ? GROUP BY c.id ORDER BY c.name COLLATE NOCASE', [req.companyId])); } catch (error) { sendError(res, error); }
    });

    app.post('/api/supplier-categories', write, async (req, res) => {
      try {
        const name = text(req.body?.name, 120); if (!name) throw fail('Category name is required.');
        const result = await insert('INSERT INTO supplier_categories (company_id, name, description, created_by) VALUES (?, ?, ?, ?)', [req.companyId, name, text(req.body?.description, 500), req.user.id]);
        const row = (await query('SELECT * FROM supplier_categories WHERE id = ? AND company_id = ?', [result.id, req.companyId]))[0]; await writeAudit(req, 'create', 'supplier_category', result.id, null, row); res.status(201).json(row);
      } catch (error) { sendError(res, error, 400); }
    });

    app.patch('/api/supplier-categories/:id', write, async (req, res) => {
      try {
        const id = idOf(req.params.id); const existing = (await query('SELECT * FROM supplier_categories WHERE id = ? AND company_id = ?', [id, req.companyId]))[0]; if (!existing) return res.status(404).json({ message: 'Supplier category not found.' });
        const name = req.body?.name === undefined ? existing.name : text(req.body.name, 120); if (!name) throw fail('Category name is required.');
        await update('UPDATE supplier_categories SET name = ?, description = ?, active = ? WHERE id = ? AND company_id = ?', [name, req.body?.description === undefined ? existing.description : text(req.body.description, 500), req.body?.active === undefined ? existing.active : Number(Boolean(req.body.active)), id, req.companyId]);
        const row = (await query('SELECT * FROM supplier_categories WHERE id = ? AND company_id = ?', [id, req.companyId]))[0]; await writeAudit(req, 'update', 'supplier_category', id, existing, row); res.json(row);
      } catch (error) { sendError(res, error, 400); }
    });

    app.get(['/api/supplier-products', '/api/supplied-products'], read, async (req, res) => {
      try {
        const params = [req.companyId]; let sql = `SELECT sp.*, s.name AS supplier_name, p.name AS product_name, p.unit AS product_unit FROM supplier_products sp JOIN suppliers s ON s.id = sp.supplier_id AND s.company_id = sp.company_id LEFT JOIN products p ON p.id = sp.product_id AND p.company_id = sp.company_id WHERE sp.company_id = ?`;
        if (req.query.supplierId) { sql += ' AND sp.supplier_id = ?'; params.push(Number(req.query.supplierId)); }
        if (req.query.active !== undefined) { sql += ' AND sp.active = ?'; params.push(Number(req.query.active) ? 1 : 0); }
        sql += ' ORDER BY s.name COLLATE NOCASE, sp.product_name COLLATE NOCASE, sp.id DESC'; res.json(await query(sql, params));
      } catch (error) { sendError(res, error); }
    });

    app.post(['/api/supplier-products', '/api/supplied-products', '/api/suppliers/:id/products'], write, async (req, res) => {
      try {
        const body = req.body || {}; const supplierId = idOf(req.params.id || body.supplierId); const supplier = await supplierForCompany(req.companyId, supplierId); if (!supplier) return res.status(404).json({ message: 'Supplier not found.' });
        const productId = body.productId == null || body.productId === '' ? null : idOf(body.productId); const product = productId ? (await query('SELECT id, name, unit FROM products WHERE id = ? AND company_id = ?', [productId, req.companyId]))[0] : null; if (productId && !product) throw fail('Product not found in this company.', 404);
        const productName = text(body.productName || product?.name, 180); const unitPrice = money(body.unitPrice); const minOrderQuantity = money(body.minOrderQuantity == null || body.minOrderQuantity === '' ? 1 : body.minOrderQuantity, false); const leadTimeDays = Number(body.leadTimeDays == null || body.leadTimeDays === '' ? 0 : body.leadTimeDays);
        if (!productName || unitPrice == null || !minOrderQuantity || !Number.isInteger(leadTimeDays) || leadTimeDays < 0 || leadTimeDays > 3650) throw fail('Supplier product name, price, positive minimum quantity, and valid lead time are required.');
        const result = await insert('INSERT INTO supplier_products (company_id, supplier_id, product_id, supplier_sku, product_name, description, unit, unit_price, currency, min_order_quantity, lead_time_days, active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, supplierId, productId, text(body.supplierSku, 100), productName, text(body.description, 1000), text(body.unit || product?.unit || 'unit', 40), unitPrice, text(body.currency || supplier.currency || 'PKR', 3).toUpperCase(), minOrderQuantity, leadTimeDays, body.active === undefined ? 1 : Number(Boolean(body.active)), req.user.id]);
        const row = (await query('SELECT * FROM supplier_products WHERE id = ? AND company_id = ?', [result.id, req.companyId]))[0]; await writeAudit(req, 'create', 'supplier_product', result.id, null, row); res.status(201).json(row);
      } catch (error) { sendError(res, error, 400); }
    });

    app.patch(['/api/supplier-products/:id', '/api/supplied-products/:id'], write, async (req, res) => {
      try {
        const id = idOf(req.params.id); const existing = (await query('SELECT * FROM supplier_products WHERE id = ? AND company_id = ?', [id, req.companyId]))[0]; if (!existing) return res.status(404).json({ message: 'Supplier product not found.' });
        const body = req.body || {}; const productName = body.productName === undefined ? existing.product_name : text(body.productName, 180); const unitPrice = body.unitPrice === undefined ? Number(existing.unit_price) : money(body.unitPrice); const minQuantity = body.minOrderQuantity === undefined ? Number(existing.min_order_quantity) : money(body.minOrderQuantity, false); const leadTime = body.leadTimeDays === undefined ? Number(existing.lead_time_days) : Number(body.leadTimeDays); if (!productName || unitPrice == null || !minQuantity || !Number.isInteger(leadTime) || leadTime < 0) throw fail('Supplier product fields are invalid.');
        await update('UPDATE supplier_products SET supplier_sku = ?, product_name = ?, description = ?, unit = ?, unit_price = ?, currency = ?, min_order_quantity = ?, lead_time_days = ?, active = ? WHERE id = ? AND company_id = ?', [body.supplierSku === undefined ? existing.supplier_sku : text(body.supplierSku, 100), productName, body.description === undefined ? existing.description : text(body.description, 1000), body.unit === undefined ? existing.unit : text(body.unit, 40), unitPrice, body.currency === undefined ? existing.currency : text(body.currency, 3).toUpperCase(), minQuantity, leadTime, body.active === undefined ? existing.active : Number(Boolean(body.active)), id, req.companyId]);
        const row = (await query('SELECT * FROM supplier_products WHERE id = ? AND company_id = ?', [id, req.companyId]))[0]; await writeAudit(req, 'update', 'supplier_product', id, existing, row); res.json(row);
      } catch (error) { sendError(res, error, 400); }
    });

    const listQuotations = async (req, res) => {
      try { const params = [req.companyId]; let sql = `SELECT q.*, s.name AS supplier_name, COUNT(qi.id) AS item_count FROM supplier_quotations q JOIN suppliers s ON s.id = q.supplier_id AND s.company_id = q.company_id LEFT JOIN supplier_quotation_items qi ON qi.quotation_id = q.id AND qi.company_id = q.company_id WHERE q.company_id = ?`; if (req.query.supplierId) { sql += ' AND q.supplier_id = ?'; params.push(Number(req.query.supplierId)); } if (req.query.status) { sql += ' AND q.status = ?'; params.push(text(req.query.status, 30)); } sql += ' GROUP BY q.id ORDER BY q.quote_date DESC, q.id DESC'; res.json(await query(sql, params)); } catch (error) { sendError(res, error); }
    };
    const createQuotation = async (req, res) => {
      try {
        const body = req.body || {}; const supplierId = idOf(body.supplierId); if (!await supplierForCompany(req.companyId, supplierId)) return res.status(404).json({ message: 'Supplier not found.' });
        const items = await normalizeLineItems(req.companyId, supplierId, body.items); const totals = totalsFor(items); const quoteDate = dateValue(body.quoteDate) || new Date().toISOString().slice(0, 10); const validUntil = dateValue(body.validUntil); if (!validUntil && body.validUntil) throw fail('Quotation validity date must use YYYY-MM-DD.'); if (validUntil && validUntil < quoteDate) throw fail('Quotation validity cannot be before the quote date.');
        const quotationNumber = text(body.quotationNumber || `Q-${quoteDate.replace(/-/g, '')}-${Date.now()}`, 80); const result = await insert('INSERT INTO supplier_quotations (company_id, supplier_id, quotation_number, quote_date, valid_until, currency, status, notes, subtotal, tax, total, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, supplierId, quotationNumber, quoteDate, validUntil, text(body.currency || 'PKR', 3).toUpperCase(), ['draft', 'submitted'].includes(body.status) ? body.status : 'draft', text(body.notes, 2000), totals.subtotal, totals.tax, totals.total, req.user.id]);
        for (const item of items) await insert('INSERT INTO supplier_quotation_items (company_id, quotation_id, product_id, supplied_product_id, description, quantity, unit_price, tax_rate, tax_amount, total_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, result.id, item.productId, item.suppliedProductId, item.description, item.quantity, item.unitPrice, item.taxRate, item.taxAmount, item.totalPrice]);
        const quotation = await quotationDetail(req.companyId, result.id); await writeAudit(req, 'create', 'supplier_quotation', result.id, null, quotation); res.status(201).json(quotation);
      } catch (error) { sendError(res, error, 400); }
    };
    app.get(['/api/quotations', '/api/supplier-quotations'], read, listQuotations);
    app.post(['/api/quotations', '/api/supplier-quotations'], write, createQuotation);
    app.get(['/api/quotations/compare'], read, async (req, res) => {
      try { const ids = String(req.query.ids || req.query.quotationIds || '').split(',').map(idOf).filter(Boolean).slice(0, 20); if (ids.length < 2) throw fail('At least two quotation IDs are required.'); const placeholders = ids.map(() => '?').join(','); const rows = await query(`SELECT q.id, q.supplier_id, s.name AS supplier_name, q.quotation_number, q.currency, q.subtotal, q.tax, q.total, q.status, qi.id AS item_id, qi.product_id, qi.supplied_product_id, qi.description, qi.quantity, qi.unit_price, qi.tax_rate, qi.total_price FROM supplier_quotations q JOIN suppliers s ON s.id = q.supplier_id AND s.company_id = q.company_id JOIN supplier_quotation_items qi ON qi.quotation_id = q.id AND qi.company_id = q.company_id WHERE q.company_id = ? AND q.id IN (${placeholders}) ORDER BY qi.description COLLATE NOCASE, q.id`, [req.companyId, ...ids]); if (!rows.length) return res.status(404).json({ message: 'Quotations not found.' }); res.json({ quotationIds: ids, rows }); } catch (error) { sendError(res, error, 400); }
    });
    app.get(['/api/quotations/:id', '/api/supplier-quotations/:id'], read, async (req, res) => {
      try { const row = await quotationDetail(req.companyId, idOf(req.params.id)); if (!row) return res.status(404).json({ message: 'Quotation not found.' }); res.json(row); } catch (error) { sendError(res, error); }
    });
    app.patch(['/api/quotations/:id/status', '/api/supplier-quotations/:id/status'], write, async (req, res) => {
      try { const id = idOf(req.params.id); const existing = await quotationDetail(req.companyId, id); const status = text(req.body?.status, 30); if (!existing) return res.status(404).json({ message: 'Quotation not found.' }); if (!['draft', 'submitted', 'accepted', 'rejected', 'expired', 'cancelled'].includes(status)) throw fail('Invalid quotation status.'); await update('UPDATE supplier_quotations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [status, id, req.companyId]); const row = await quotationDetail(req.companyId, id); await writeAudit(req, 'status_change', 'supplier_quotation', id, existing, row); res.json(row); } catch (error) { sendError(res, error, 400); }
    });

    app.get('/api/quotation-comparisons', read, async (req, res) => {
      try { res.json(await query('SELECT c.*, u.name AS created_by_name, COUNT(ci.id) AS quotation_count FROM quotation_comparisons c LEFT JOIN users u ON u.id = c.created_by LEFT JOIN quotation_comparison_items ci ON ci.comparison_id = c.id AND ci.company_id = c.company_id WHERE c.company_id = ? GROUP BY c.id ORDER BY c.created_at DESC, c.id DESC', [req.companyId])); } catch (error) { sendError(res, error); }
    });
    app.post('/api/quotation-comparisons', write, async (req, res) => {
      try { const ids = [...new Set((Array.isArray(req.body?.quotationIds) ? req.body.quotationIds : []).map(idOf).filter(Boolean))].slice(0, 20); if (ids.length < 2) throw fail('At least two quotation IDs are required.'); const placeholders = ids.map(() => '?').join(','); const rows = await query(`SELECT id FROM supplier_quotations WHERE company_id = ? AND id IN (${placeholders})`, [req.companyId, ...ids]); if (rows.length !== ids.length) throw fail('All quotations must belong to this company.'); const name = text(req.body?.name || `Quotation comparison ${new Date().toISOString().slice(0, 10)}`, 160); const result = await insert('INSERT INTO quotation_comparisons (company_id, name, criteria, created_by) VALUES (?, ?, ?, ?)', [req.companyId, name, text(req.body?.criteria, 1000), req.user.id]); for (const quotationId of ids) await insert('INSERT INTO quotation_comparison_items (company_id, comparison_id, quotation_id) VALUES (?, ?, ?)', [req.companyId, result.id, quotationId]); const comparison = (await query('SELECT * FROM quotation_comparisons WHERE id = ? AND company_id = ?', [result.id, req.companyId]))[0]; comparison.quotations = await query('SELECT q.*, s.name AS supplier_name FROM quotation_comparison_items ci JOIN supplier_quotations q ON q.id = ci.quotation_id AND q.company_id = ci.company_id JOIN suppliers s ON s.id = q.supplier_id AND s.company_id = q.company_id WHERE ci.comparison_id = ? AND ci.company_id = ?', [result.id, req.companyId]); await writeAudit(req, 'create', 'quotation_comparison', result.id, null, comparison); res.status(201).json(comparison); } catch (error) { sendError(res, error, 400); }
    });
    app.get('/api/quotation-comparisons/:id', read, async (req, res) => {
      try { const id = idOf(req.params.id); const comparison = (await query('SELECT * FROM quotation_comparisons WHERE id = ? AND company_id = ?', [id, req.companyId]))[0]; if (!comparison) return res.status(404).json({ message: 'Quotation comparison not found.' }); comparison.quotations = await query('SELECT q.*, s.name AS supplier_name FROM quotation_comparison_items ci JOIN supplier_quotations q ON q.id = ci.quotation_id AND q.company_id = ci.company_id JOIN suppliers s ON s.id = q.supplier_id AND s.company_id = q.company_id WHERE ci.comparison_id = ? AND ci.company_id = ?', [id, req.companyId]); res.json(comparison); } catch (error) { sendError(res, error); }
    });

    const listOrders = async (req, res) => {
      try { const params = [req.companyId]; let sql = `SELECT po.*, s.name AS supplier_name, q.quotation_number, COUNT(pi.id) AS item_count FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id AND s.company_id = po.company_id LEFT JOIN supplier_quotations q ON q.id = po.quotation_id AND q.company_id = po.company_id LEFT JOIN purchase_order_items pi ON pi.purchase_order_id = po.id AND pi.company_id = po.company_id WHERE po.company_id = ?`; if (req.query.supplierId) { sql += ' AND po.supplier_id = ?'; params.push(Number(req.query.supplierId)); } if (req.query.status) { sql += ' AND po.status = ?'; params.push(text(req.query.status, 30)); } sql += ' GROUP BY po.id ORDER BY po.order_date DESC, po.id DESC'; res.json(await query(sql, params)); } catch (error) { sendError(res, error); }
    };
    const createOrder = async (req, res) => {
      try {
        const body = req.body || {}; const supplierId = idOf(body.supplierId); if (!await supplierForCompany(req.companyId, supplierId)) return res.status(404).json({ message: 'Supplier not found.' });
        let rawItems = body.items; let quotationId = body.quotationId == null || body.quotationId === '' ? null : idOf(body.quotationId); let quotation = null;
        if (quotationId) { quotation = await quotationDetail(req.companyId, quotationId); if (!quotation || quotation.supplier_id !== supplierId) throw fail('Quotation must belong to the selected supplier.'); if (!rawItems?.length) rawItems = quotation.items; }
        const items = await normalizeLineItems(req.companyId, supplierId, rawItems); const totals = totalsFor(items); const orderDate = dateValue(body.orderDate) || new Date().toISOString().slice(0, 10); const expectedDate = dateValue(body.expectedDate); if (!expectedDate && body.expectedDate) throw fail('Expected date must use YYYY-MM-DD.');
        const poNumber = text(body.poNumber || `PO-${orderDate.replace(/-/g, '')}-${Date.now()}`, 80); const result = await insert('INSERT INTO purchase_orders (company_id, supplier_id, quotation_id, po_number, order_date, expected_date, currency, status, notes, subtotal, tax, total, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, supplierId, quotationId, poNumber, orderDate, expectedDate, text(body.currency || quotation?.currency || 'PKR', 3).toUpperCase(), ['draft', 'submitted'].includes(body.status) ? body.status : 'draft', text(body.notes, 2000), totals.subtotal, totals.tax, totals.total, req.user.id]);
        for (const item of items) await insert('INSERT INTO purchase_order_items (company_id, purchase_order_id, product_id, supplied_product_id, description, quantity, unit_price, tax_rate, tax_amount, total_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, result.id, item.productId, item.suppliedProductId, item.description, item.quantity, item.unitPrice, item.taxRate, item.taxAmount, item.totalPrice]);
        const order = await purchaseOrderDetail(req.companyId, result.id); await writeAudit(req, 'create', 'purchase_order', result.id, null, order); res.status(201).json(order);
      } catch (error) { sendError(res, error, 400); }
    };
    app.get('/api/purchase-orders', read, listOrders);
    app.post('/api/purchase-orders', write, createOrder);
    app.get('/api/purchase-orders/:id', read, async (req, res) => { try { const order = await purchaseOrderDetail(req.companyId, idOf(req.params.id)); if (!order) return res.status(404).json({ message: 'Purchase order not found.' }); res.json(order); } catch (error) { sendError(res, error); } });
    app.patch('/api/purchase-orders/:id/status', approve, async (req, res) => { try { const id = idOf(req.params.id); const existing = await purchaseOrderDetail(req.companyId, id); const status = text(req.body?.status, 30); if (!existing) return res.status(404).json({ message: 'Purchase order not found.' }); if (!['draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled'].includes(status)) throw fail('Invalid purchase order status.'); const approvedBy = status === 'approved' ? req.user.id : existing.approved_by; await update('UPDATE purchase_orders SET status = ?, approved_by = ?, approved_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [status, approvedBy, status === 'approved' ? new Date().toISOString() : existing.approved_at, id, req.companyId]); const row = await purchaseOrderDetail(req.companyId, id); await writeAudit(req, 'status_change', 'purchase_order', id, existing, row); res.json(row); } catch (error) { sendError(res, error, 400); } });
    app.post('/api/purchase-orders/:id/approve', approve, async (req, res) => { req.body = { ...(req.body || {}), status: 'approved' }; const id = idOf(req.params.id); const existing = await purchaseOrderDetail(req.companyId, id); if (!existing) return res.status(404).json({ message: 'Purchase order not found.' }); try { await update('UPDATE purchase_orders SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', ['approved', req.user.id, id, req.companyId]); const row = await purchaseOrderDetail(req.companyId, id); await writeAudit(req, 'approve', 'purchase_order', id, existing, row); res.json(row); } catch (error) { sendError(res, error); } });

    app.get('/api/supplier-invoices', read, async (req, res) => {
      try { const params = [req.companyId]; let sql = `SELECT i.*, s.name AS supplier_name, po.po_number, ROUND(i.total - i.paid_amount, 2) AS calculated_balance FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id AND s.company_id = i.company_id LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id AND po.company_id = i.company_id WHERE i.company_id = ?`; if (req.query.supplierId) { sql += ' AND i.supplier_id = ?'; params.push(Number(req.query.supplierId)); } if (req.query.outstanding === '1' || req.query.outstanding === 'true') sql += " AND i.balance > 0 AND i.status <> 'cancelled'"; if (req.query.status) { sql += ' AND i.status = ?'; params.push(text(req.query.status, 30)); } sql += ' ORDER BY i.due_date IS NULL, i.due_date, i.id DESC'; res.json(await query(sql, params)); } catch (error) { sendError(res, error); }
    });
    app.get(['/api/supplier-invoices/:id'], read, async (req, res) => { try { const invoice = await invoiceDetail(req.companyId, idOf(req.params.id)); if (!invoice) return res.status(404).json({ message: 'Supplier invoice not found.' }); res.json(invoice); } catch (error) { sendError(res, error); } });
    app.post('/api/supplier-invoices', write, async (req, res) => {
      try {
        const body = req.body || {}; const supplierId = idOf(body.supplierId); if (!await supplierForCompany(req.companyId, supplierId)) return res.status(404).json({ message: 'Supplier not found.' });
        const purchaseOrderId = body.purchaseOrderId == null || body.purchaseOrderId === '' ? null : idOf(body.purchaseOrderId); if (purchaseOrderId && !(await query('SELECT id FROM purchase_orders WHERE id = ? AND company_id = ? AND supplier_id = ?', [purchaseOrderId, req.companyId, supplierId]))[0]) throw fail('Purchase order must belong to the selected supplier.');
        const invoiceNumber = text(body.invoiceNumber, 80); const invoiceDate = dateValue(body.invoiceDate) || new Date().toISOString().slice(0, 10); const dueDate = dateValue(body.dueDate); if (!invoiceNumber || (!dueDate && body.dueDate)) throw fail('Invoice number and valid invoice dates are required.');
        let subtotal = money(body.subtotal); let tax = money(body.tax); let items = Array.isArray(body.items) && body.items.length ? body.items : null;
        if (items) { items = await normalizeLineItems(req.companyId, supplierId, items); const computed = totalsFor(items); subtotal = computed.subtotal; tax = computed.tax; }
        const total = money(body.totalAmount == null || body.totalAmount === '' ? Number(subtotal || 0) + Number(tax || 0) : body.totalAmount, false); if (total == null || total <= 0) throw fail('Invoice total must be greater than zero.'); subtotal = subtotal == null ? total : subtotal; tax = tax == null ? Math.max(0, total - subtotal) : tax;
        const result = await insert('INSERT INTO supplier_invoices (company_id, supplier_id, purchase_order_id, invoice_number, invoice_date, due_date, currency, status, subtotal, tax, total, paid_amount, balance, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)', [req.companyId, supplierId, purchaseOrderId, invoiceNumber, invoiceDate, dueDate, text(body.currency || 'PKR', 3).toUpperCase(), ['draft', 'received', 'approved'].includes(body.status) ? body.status : 'received', subtotal, tax, total, total, text(body.notes, 2000), req.user.id]);
        if (items) for (const item of items) await insert('INSERT INTO supplier_invoice_items (company_id, supplier_invoice_id, product_id, supplied_product_id, description, quantity, unit_price, tax_rate, tax_amount, total_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, result.id, item.productId, item.suppliedProductId, item.description, item.quantity, item.unitPrice, item.taxRate, item.taxAmount, item.totalPrice]);
        const invoice = await invoiceDetail(req.companyId, result.id); await writeAudit(req, 'create', 'supplier_invoice', result.id, null, invoice); res.status(201).json(invoice);
      } catch (error) { sendError(res, error, 400); }
    });
    app.patch('/api/supplier-invoices/:id/status', write, async (req, res) => { try { const id = idOf(req.params.id); const existing = await invoiceDetail(req.companyId, id); const status = text(req.body?.status, 30); if (!existing) return res.status(404).json({ message: 'Supplier invoice not found.' }); if (!['draft', 'received', 'approved', 'partially_paid', 'paid', 'overdue', 'cancelled'].includes(status)) throw fail('Invalid supplier invoice status.'); await update('UPDATE supplier_invoices SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [status, id, req.companyId]); const invoice = await invoiceDetail(req.companyId, id); await writeAudit(req, 'status_change', 'supplier_invoice', id, existing, invoice); res.json(invoice); } catch (error) { sendError(res, error, 400); } });

    app.get(['/api/supplier-payments', '/api/supplier-payments'], read, async (req, res) => {
      try { const params = [req.companyId]; let sql = `SELECT sp.*, s.name AS supplier_name, i.invoice_number FROM supplier_payments sp JOIN suppliers s ON s.id = sp.supplier_id AND s.company_id = sp.company_id LEFT JOIN supplier_invoices i ON i.id = sp.invoice_id AND i.company_id = sp.company_id WHERE sp.company_id = ?`; if (req.query.supplierId) { sql += ' AND sp.supplier_id = ?'; params.push(Number(req.query.supplierId)); } if (req.query.invoiceId) { sql += ' AND sp.invoice_id = ?'; params.push(Number(req.query.invoiceId)); } sql += ' ORDER BY sp.payment_date DESC, sp.id DESC'; res.json(await query(sql, params)); } catch (error) { sendError(res, error); }
    });
    app.post(['/api/supplier-payments', '/api/suppliers/:id/payments'], write, async (req, res) => {
      try {
        const body = req.body || {}; const supplierId = idOf(req.params.id || body.supplierId); const supplier = await supplierForCompany(req.companyId, supplierId); if (!supplier) return res.status(404).json({ message: 'Supplier not found.' });
        const invoiceId = body.invoiceId == null || body.invoiceId === '' ? null : idOf(body.invoiceId); const invoice = invoiceId ? (await query("SELECT * FROM supplier_invoices WHERE id = ? AND company_id = ? AND supplier_id = ? AND status <> 'cancelled'", [invoiceId, req.companyId, supplierId]))[0] : null; if (invoiceId && !invoice) throw fail('Supplier invoice not found.', 404);
        const amount = money(body.amount, false); const paymentDate = dateValue(body.paymentDate) || new Date().toISOString().slice(0, 10); if (amount == null || amount <= 0 || (!paymentDate && body.paymentDate)) throw fail('A positive payment amount and valid payment date are required.'); if (invoice && amount > Number(invoice.balance) + 0.005) throw fail('Payment cannot exceed the invoice outstanding balance.');
        const payment = await insert('INSERT INTO payments (company_id, customer_id, customer_name, supplier_name, supplier_id, amount, method, note, direction, party_type, reference, due_date, created_by) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, \'payment\', \'supplier\', ?, NULL, ?)', [req.companyId, '', supplier.name, supplierId, amount, text(body.method || 'Bank Transfer', 60), text(body.note, 1000), text(body.reference, 120), req.user.id]);
        const result = await insert('INSERT INTO supplier_payments (company_id, supplier_id, invoice_id, payment_id, amount, method, reference, payment_date, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, supplierId, invoiceId, payment.id, amount, text(body.method || 'Bank Transfer', 60), text(body.reference, 120), paymentDate, text(body.note, 1000), req.user.id]);
        if (invoice) { const paid = Math.round((Number(invoice.paid_amount || 0) + amount) * 100) / 100; const balance = Math.max(0, Math.round((Number(invoice.total) - paid) * 100) / 100); const status = balance <= 0 ? 'paid' : 'partially_paid'; await update('UPDATE supplier_invoices SET paid_amount = ?, balance = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [paid, balance, status, invoice.id, req.companyId]); }
        const row = (await query('SELECT sp.*, s.name AS supplier_name, i.invoice_number FROM supplier_payments sp JOIN suppliers s ON s.id = sp.supplier_id AND s.company_id = sp.company_id LEFT JOIN supplier_invoices i ON i.id = sp.invoice_id AND i.company_id = sp.company_id WHERE sp.id = ? AND sp.company_id = ?', [result.id, req.companyId]))[0]; await writeAudit(req, 'create', 'supplier_payment', result.id, null, row); res.status(201).json(row);
      } catch (error) { sendError(res, error, 400); }
    });

    app.get(['/api/supplier-balances', '/api/suppliers/outstanding'], read, async (req, res) => {
      try { res.json(await query("SELECT s.id AS supplier_id, s.name AS supplier_name, COUNT(i.id) AS invoice_count, ROUND(COALESCE(SUM(i.total), 0), 2) AS invoiced_amount, ROUND(COALESCE(SUM(i.paid_amount), 0), 2) AS paid_amount, ROUND(COALESCE(SUM(i.balance), 0), 2) AS outstanding_balance FROM suppliers s LEFT JOIN supplier_invoices i ON i.supplier_id = s.id AND i.company_id = s.company_id AND i.status <> 'cancelled' WHERE s.company_id = ? GROUP BY s.id HAVING outstanding_balance > 0 ORDER BY outstanding_balance DESC, s.name COLLATE NOCASE", [req.companyId])); } catch (error) { sendError(res, error); }
    });

    app.get('/api/supplier-ratings', read, async (req, res) => {
      try { const params = [req.companyId]; let sql = `SELECT sr.*, s.name AS supplier_name, u.name AS created_by_name FROM supplier_ratings sr JOIN suppliers s ON s.id = sr.supplier_id AND s.company_id = sr.company_id LEFT JOIN users u ON u.id = sr.created_by WHERE sr.company_id = ?`; if (req.query.supplierId) { sql += ' AND sr.supplier_id = ?'; params.push(Number(req.query.supplierId)); } sql += ' ORDER BY sr.created_at DESC, sr.id DESC'; res.json(await query(sql, params)); } catch (error) { sendError(res, error); }
    });
    app.post('/api/supplier-ratings', write, async (req, res) => {
      try { const body = req.body || {}; const supplierId = idOf(body.supplierId); if (!await supplierForCompany(req.companyId, supplierId)) return res.status(404).json({ message: 'Supplier not found.' }); const rating = Number(body.rating ?? body.overallRating); const quality = Number(body.qualityRating ?? rating); const delivery = Number(body.deliveryRating ?? rating); const price = Number(body.priceRating ?? rating); const service = Number(body.serviceRating ?? rating); if (![rating, quality, delivery, price, service].every((value) => Number.isInteger(value) && value >= 1 && value <= 5)) throw fail('Supplier ratings must be whole numbers from 1 to 5.'); const purchaseOrderId = body.purchaseOrderId == null || body.purchaseOrderId === '' ? null : idOf(body.purchaseOrderId); if (purchaseOrderId && !(await query('SELECT id FROM purchase_orders WHERE id = ? AND company_id = ? AND supplier_id = ?', [purchaseOrderId, req.companyId, supplierId]))[0]) throw fail('Purchase order must belong to the selected supplier.'); const result = await insert('INSERT INTO supplier_ratings (company_id, supplier_id, purchase_order_id, rating, quality_rating, delivery_rating, price_rating, service_rating, comment, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, supplierId, purchaseOrderId, rating, quality, delivery, price, service, text(body.comment, 2000), req.user.id]); const row = (await query('SELECT * FROM supplier_ratings WHERE id = ? AND company_id = ?', [result.id, req.companyId]))[0]; await writeAudit(req, 'create', 'supplier_rating', result.id, null, row); res.status(201).json(row); } catch (error) { sendError(res, error, 400); }
    });

    app.get('/api/supplier-contracts', read, async (req, res) => {
      try { const params = [req.companyId]; let sql = `SELECT c.*, s.name AS supplier_name, d.title AS document_title, CASE WHEN c.expires_on IS NOT NULL AND c.expires_on < date('now') THEN 1 ELSE 0 END AS is_expired FROM supplier_contracts c JOIN suppliers s ON s.id = c.supplier_id AND s.company_id = c.company_id LEFT JOIN document_records d ON d.id = c.document_id AND d.company_id = c.company_id WHERE c.company_id = ?`; if (req.query.supplierId) { sql += ' AND c.supplier_id = ?'; params.push(Number(req.query.supplierId)); } if (req.query.expiring === '1' || req.query.expiring === 'true') { const days = Math.min(3650, Math.max(0, Number(req.query.days || 90))); const expiry = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10); sql += " AND c.expires_on IS NOT NULL AND c.expires_on <= ? AND c.status NOT IN ('cancelled','expired')"; params.push(expiry); } sql += ' ORDER BY c.expires_on IS NULL, c.expires_on, c.id DESC'; res.json(await query(sql, params)); } catch (error) { sendError(res, error); }
    });
    app.post('/api/supplier-contracts', write, async (req, res) => {
      try { const body = req.body || {}; const supplierId = idOf(body.supplierId); if (!await supplierForCompany(req.companyId, supplierId)) return res.status(404).json({ message: 'Supplier not found.' }); const title = text(body.title, 180); const startsOn = dateValue(body.startsOn); const expiresOn = dateValue(body.expiresOn); if (!title || (!startsOn && body.startsOn) || (!expiresOn && body.expiresOn) || (startsOn && expiresOn && expiresOn < startsOn)) throw fail('Contract title and valid date range are required.'); const value = body.value == null || body.value === '' ? 0 : money(body.value); if (value == null) throw fail('Contract value must be non-negative.'); const result = await insert('INSERT INTO supplier_contracts (company_id, supplier_id, contract_number, contract_type, title, starts_on, expires_on, status, value, currency, document_id, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, supplierId, text(body.contractNumber, 80), text(body.contractType || 'supplier', 80), title, startsOn, expiresOn, ['active', 'renewed', 'expired', 'cancelled'].includes(body.status) ? body.status : 'active', value, text(body.currency || 'PKR', 3).toUpperCase(), null, text(body.notes, 2000), req.user.id]); if (body.documentId) { const documentId = idOf(body.documentId); if (!(await query('SELECT id FROM document_records WHERE id = ? AND company_id = ?', [documentId, req.companyId]))[0]) throw fail('Document not found in this company.', 404); await update("UPDATE supplier_contracts SET document_id = ? WHERE id = ? AND company_id = ?", [documentId, result.id, req.companyId]); await update("UPDATE document_records SET entity_type = 'supplier_contract', entity_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?", [result.id, documentId, req.companyId]); } const row = (await query('SELECT * FROM supplier_contracts WHERE id = ? AND company_id = ?', [result.id, req.companyId]))[0]; await writeAudit(req, 'create', 'supplier_contract', result.id, null, row); res.status(201).json(row); } catch (error) { sendError(res, error, 400); }
    });
    app.patch('/api/supplier-contracts/:id/status', write, async (req, res) => { try { const id = idOf(req.params.id); const existing = (await query('SELECT * FROM supplier_contracts WHERE id = ? AND company_id = ?', [id, req.companyId]))[0]; const status = text(req.body?.status, 30); if (!existing) return res.status(404).json({ message: 'Supplier contract not found.' }); if (!['active', 'renewed', 'expired', 'cancelled'].includes(status)) throw fail('Invalid contract status.'); await update('UPDATE supplier_contracts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [status, id, req.companyId]); const row = (await query('SELECT * FROM supplier_contracts WHERE id = ? AND company_id = ?', [id, req.companyId]))[0]; await writeAudit(req, 'status_change', 'supplier_contract', id, existing, row); res.json(row); } catch (error) { sendError(res, error, 400); } });

    app.get('/api/supplier-contacts', read, async (req, res) => {
      try { const params = [req.companyId]; let sql = `SELECT sc.*, s.name AS supplier_name FROM supplier_contacts sc JOIN suppliers s ON s.id = sc.supplier_id AND s.company_id = sc.company_id WHERE sc.company_id = ?`; if (req.query.supplierId) { sql += ' AND sc.supplier_id = ?'; params.push(Number(req.query.supplierId)); } sql += ' ORDER BY sc.is_primary DESC, sc.name COLLATE NOCASE, sc.id DESC'; res.json(await query(sql, params)); } catch (error) { sendError(res, error); }
    });
    app.post(['/api/supplier-contacts', '/api/suppliers/:id/contacts'], write, async (req, res) => {
      try { const body = req.body || {}; const supplierId = idOf(req.params.id || body.supplierId); if (!await supplierForCompany(req.companyId, supplierId)) return res.status(404).json({ message: 'Supplier not found.' }); const name = text(body.name, 160); const email = text(body.email, 160); if (!name || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw fail('Contact name and valid email are required.'); const result = await insert('INSERT INTO supplier_contacts (company_id, supplier_id, name, email, phone, job_title, is_primary, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.companyId, supplierId, name, email, text(body.phone, 60), text(body.jobTitle, 120), Number(Boolean(body.isPrimary)), text(body.notes, 1000), req.user.id]); const row = (await query('SELECT * FROM supplier_contacts WHERE id = ? AND company_id = ?', [result.id, req.companyId]))[0]; await writeAudit(req, 'create', 'supplier_contact', result.id, null, row); res.status(201).json(row); } catch (error) { sendError(res, error, 400); }
    });
    app.patch('/api/supplier-contacts/:id', write, async (req, res) => { try { const id = idOf(req.params.id); const existing = (await query('SELECT * FROM supplier_contacts WHERE id = ? AND company_id = ?', [id, req.companyId]))[0]; if (!existing) return res.status(404).json({ message: 'Supplier contact not found.' }); const body = req.body || {}; const name = body.name === undefined ? existing.name : text(body.name, 160); const email = body.email === undefined ? existing.email : text(body.email, 160); if (!name || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw fail('Contact name and valid email are required.'); await update('UPDATE supplier_contacts SET name = ?, email = ?, phone = ?, job_title = ?, is_primary = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [name, email, body.phone === undefined ? existing.phone : text(body.phone, 60), body.jobTitle === undefined ? existing.job_title : text(body.jobTitle, 120), body.isPrimary === undefined ? existing.is_primary : Number(Boolean(body.isPrimary)), body.notes === undefined ? existing.notes : text(body.notes, 1000), id, req.companyId]); const row = (await query('SELECT * FROM supplier_contacts WHERE id = ? AND company_id = ?', [id, req.companyId]))[0]; await writeAudit(req, 'update', 'supplier_contact', id, existing, row); res.json(row); } catch (error) { sendError(res, error, 400); } });
    app.delete('/api/supplier-contacts/:id', write, async (req, res) => { try { const id = idOf(req.params.id); const existing = (await query('SELECT * FROM supplier_contacts WHERE id = ? AND company_id = ?', [id, req.companyId]))[0]; if (!existing) return res.status(404).json({ message: 'Supplier contact not found.' }); await update('DELETE FROM supplier_contacts WHERE id = ? AND company_id = ?', [id, req.companyId]); await writeAudit(req, 'delete', 'supplier_contact', id, existing, null); res.json({ success: true }); } catch (error) { sendError(res, error); } });
  }

  return { registerRoutes };
}

module.exports = { createService };

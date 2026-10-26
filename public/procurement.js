(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = (value) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'PKR', maximumFractionDigits: 2 }).format(Number(value) || 0);
  const date = (value) => {
    if (!value) return '—';
    const format = localStorage.getItem('temo_aquaflow_date_format') || 'YYYY-MM-DD';
    const dateValue = new Date(`${value}T00:00:00`);
    if (Number.isNaN(dateValue.getTime())) return String(value);
    const day = String(dateValue.getDate()).padStart(2, '0');
    const month = String(dateValue.getMonth() + 1).padStart(2, '0');
    const year = dateValue.getFullYear();
    if (format === 'DD-MM-YYYY') return `${day}-${month}-${year}`;
    if (format === 'MM-DD-YYYY') return `${month}-${day}-${year}`;
    return `${year}-${month}-${day}`;
  };
  let suppliers = [];
  let quotations = [];
  let invoices = [];

  async function jsonRequest(url, options = {}) {
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Procurement request failed.');
    return data;
  }

  function setSupplierOptions() {
    ['procurementQuotationSupplier', 'procurementInvoiceSupplier'].forEach((id) => {
      const select = $(id); if (!select) return;
      select.innerHTML = '<option value="">Select supplier</option>' + suppliers.map((supplier) => `<option value="${supplier.id}">${esc(supplier.name)}</option>`).join('');
    });
  }

  function renderSuppliers() {
    const body = $('procurementSupplierBody');
    if (body) body.innerHTML = suppliers.map((supplier) => `<tr><td><strong>${esc(supplier.name)}</strong><br><small>${esc(supplier.email || supplier.phone || 'No contact')}</small></td><td>${esc(supplier.phone || '—')}<br>${esc(supplier.address || '—')}</td><td>${esc(supplier.category_names || 'Uncategorised')}</td><td>${Number(supplier.average_rating || 0).toFixed(1)} / 5</td><td>${money(supplier.outstanding_balance)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted-label">No suppliers have been added to this tenant.</td></tr>';
    setSupplierOptions();
  }

  function renderQuotations() {
    const body = $('procurementQuotationBody');
    if (body) body.innerHTML = quotations.map((quotation) => `<tr><td><input class="procurement-quotation-check" type="checkbox" value="${quotation.id}" aria-label="Select quotation ${esc(quotation.quotation_number)}" /></td><td>${esc(quotation.quotation_number)}</td><td>${esc(quotation.supplier_name)}</td><td>${esc(quotation.status)}</td><td>${money(quotation.total)}</td><td>${date(quotation.valid_until)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted-label">No quotations have been recorded.</td></tr>';
  }

  function renderInvoices() {
    const select = $('procurementPaymentInvoice');
    if (select) select.innerHTML = '<option value="">Select outstanding invoice</option>' + invoices.filter((invoice) => Number(invoice.balance) > 0 && invoice.status !== 'cancelled').map((invoice) => `<option value="${invoice.id}">${esc(invoice.invoice_number)} · ${esc(invoice.supplier_name)} · ${money(invoice.balance)}</option>`).join('');
  }

  function renderOrders(rows) {
    const body = $('procurementOrderBody');
    if (body) body.innerHTML = rows.map((order) => `<tr><td>${esc(order.po_number)}</td><td>${esc(order.supplier_name)}</td><td>${esc(order.status)}</td><td>${money(order.total)}</td><td>${date(order.expected_date)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted-label">No purchase orders have been recorded.</td></tr>';
  }

  function renderContracts(rows) {
    const body = $('procurementContractBody');
    if (body) body.innerHTML = rows.map((contract) => `<tr><td>${esc(contract.title)}</td><td>${esc(contract.supplier_name)}</td><td>${date(contract.expires_on)}</td><td>${Number(contract.is_expired) ? 'Expired' : esc(contract.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted-label">No supplier contracts have been recorded.</td></tr>';
  }

  async function refreshProcurement() {
    if (!$('procurement')) return;
    try {
      const [summary, supplierRows, quoteRows, invoiceRows, orderRows, contractRows] = await Promise.all([
        jsonRequest('/api/procurement/summary'),
        jsonRequest('/api/suppliers'),
        jsonRequest('/api/quotations'),
        jsonRequest('/api/supplier-invoices'),
        jsonRequest('/api/purchase-orders'),
        jsonRequest('/api/supplier-contracts?expiring=1&days=90')
      ]);
      suppliers = supplierRows;
      quotations = quoteRows;
      invoices = invoiceRows;
      if ($('procurementSupplierCount')) $('procurementSupplierCount').textContent = summary.suppliers;
      if ($('procurementOpenOrderCount')) $('procurementOpenOrderCount').textContent = summary.openPurchaseOrders;
      if ($('procurementOutstanding')) $('procurementOutstanding').textContent = money(summary.outstandingBalance);
      if ($('procurementExpiringContracts')) $('procurementExpiringContracts').textContent = summary.contractsExpiring;
      renderSuppliers(); renderQuotations(); renderInvoices(); renderOrders(orderRows); renderContracts(contractRows);
    } catch (error) {
      const result = $('procurementComparisonResult'); if (result) result.textContent = error.message;
    }
  }

  const field = (data, id) => data.get(id) || $(id)?.value || '';
  function bindForm(id, handler) {
    const form = $(id); if (!form) return;
    form.addEventListener('submit', async (event) => { event.preventDefault(); try { await handler(new FormData(form)); form.reset(); await refreshProcurement(); } catch (error) { alert(error.message); } });
  }

  function bind() {
    $('procurementRefresh')?.addEventListener('click', refreshProcurement);
    document.querySelector('[data-tab="procurement"]')?.addEventListener('click', refreshProcurement);
    bindForm('procurementSupplierForm', async (data) => jsonRequest('/api/suppliers', { method: 'POST', body: JSON.stringify({ name: field(data, 'procurementSupplierName'), email: field(data, 'procurementSupplierEmail'), phone: field(data, 'procurementSupplierPhone'), address: field(data, 'procurementSupplierAddress'), taxId: field(data, 'procurementSupplierTaxId'), paymentTermsDays: field(data, 'procurementSupplierTerms'), notes: field(data, 'procurementSupplierNotes') }) }));
    bindForm('procurementQuotationForm', async (data) => jsonRequest('/api/quotations', { method: 'POST', body: JSON.stringify({ supplierId: field(data, 'procurementQuotationSupplier'), quotationNumber: field(data, 'procurementQuotationNumber'), validUntil: field(data, 'procurementQuotationValidUntil'), items: [{ description: field(data, 'procurementQuotationDescription'), quantity: field(data, 'procurementQuotationQuantity'), unitPrice: field(data, 'procurementQuotationUnitPrice') }] }) }));
    bindForm('procurementInvoiceForm', async (data) => jsonRequest('/api/supplier-invoices', { method: 'POST', body: JSON.stringify({ supplierId: field(data, 'procurementInvoiceSupplier'), invoiceNumber: field(data, 'procurementInvoiceNumber'), totalAmount: field(data, 'procurementInvoiceTotal'), dueDate: field(data, 'procurementInvoiceDueDate') }) }));
    bindForm('procurementPaymentForm', async (data) => jsonRequest('/api/supplier-payments', { method: 'POST', body: JSON.stringify({ invoiceId: field(data, 'procurementPaymentInvoice'), amount: field(data, 'procurementPaymentAmount'), method: data.get('procurementPaymentMethod'), reference: data.get('procurementPaymentReference') }) }));
    $('procurementCompare')?.addEventListener('click', async () => {
      const ids = [...document.querySelectorAll('.procurement-quotation-check:checked')].map((input) => input.value);
      if (ids.length < 2) return alert('Select at least two quotations to compare.');
      try { const result = await jsonRequest(`/api/quotations/compare?ids=${encodeURIComponent(ids.join(','))}`); const totals = [...new Set(result.rows.map((row) => `${row.supplier_name}: ${money(row.total)}`))]; $('procurementComparisonResult').textContent = `Comparison: ${totals.join(' · ')}`; } catch (error) { alert(error.message); }
    });
  }

  document.addEventListener('DOMContentLoaded', () => { bind(); if (localStorage.getItem('temo_aquaflow_token')) refreshProcurement(); });
  window.refreshProcurement = refreshProcurement;
})();

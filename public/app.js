const SUPPORTED_LANGUAGES = ['en', 'ur', 'ar'];
const LANGUAGE_KEY = 'temo_aquaflow_language';
const translations = {
  en: {
    language: 'Language', waterBusinessManagement: 'WATER BUSINESS MANAGEMENT', springWater: 'TEMO AQUAFLOW',
    loginSubtext: 'Customers, deliveries, billing, inventory and reporting in one intelligent workspace.',
    customerManagement: 'Customer Management', smartBilling: 'Smart Billing', inventoryControl: 'Inventory Control', powerfulReports: 'Powerful Reports',
    welcomeBack: 'WELCOME BACK', signInTitle: 'Sign in to your account', signInHelper: 'Enter your credentials to access your workspace.',
    username: 'Username', password: 'Password', login: 'Login', forgotPassword: 'Forgot Password?', noAccount: 'Don’t have an account yet?', signup: 'Signup',
    dashboard: 'Dashboard', products: 'Products', bottles: 'Bottles', sales: 'Sales', ordersDelivery: 'Orders & Delivery', fleet: 'Fleet', employees: 'Employees',
    attendance: 'Attendance', payroll: 'Payroll', driverMode: 'Driver mode', recurringDeliveries: 'Recurring Deliveries', customers: 'Customers', complaintsSupport: 'Complaints & Support',
    suppliers: 'Suppliers', purchases: 'Purchases', expenses: 'Expenses', payments: 'Payments', reports: 'Reports', companiesUsers: 'Companies & Users', franchiseManagement: 'Franchise Management', logout: 'Logout',
    companyDefaultLanguage: 'Company default language', saveCompanySettings: 'Save Company Settings'
  },
  ur: {
    language: 'زبان', waterBusinessManagement: 'واٹر بزنس مینجمنٹ', springWater: 'TEMO AQUAFLOW',
    loginSubtext: 'صارفین، ڈیلیوری، بلنگ، انوینٹری اور رپورٹس ایک ہی ورک اسپیس میں۔',
    customerManagement: 'صارفین کا انتظام', smartBilling: 'اسمارٹ بلنگ', inventoryControl: 'انوینٹری کنٹرول', powerfulReports: 'جامع رپورٹس',
    welcomeBack: 'خوش آمدید', signInTitle: 'اپنے اکاؤنٹ میں سائن اِن کریں', signInHelper: 'اپنے ورک اسپیس تک رسائی کے لیے معلومات درج کریں۔',
    username: 'صارف نام', password: 'پاس ورڈ', login: 'لاگ اِن', forgotPassword: 'پاس ورڈ بھول گئے؟', noAccount: 'ابھی اکاؤنٹ نہیں ہے؟', signup: 'سائن اپ',
    dashboard: 'ڈیش بورڈ', products: 'مصنوعات', bottles: 'بوتلیں', sales: 'فروخت', ordersDelivery: 'آرڈرز اور ڈیلیوری', fleet: 'فلیٹ', employees: 'ملازمین',
    attendance: 'حاضری', payroll: 'پے رول', driverMode: 'ڈرائیور موڈ', recurringDeliveries: 'بار بار ڈیلیوری', customers: 'صارفین', complaintsSupport: 'شکایات اور معاونت',
    suppliers: 'سپلائرز', purchases: 'خریداری', expenses: 'اخراجات', payments: 'ادائیگیاں', reports: 'رپورٹس', companiesUsers: 'کمپنیاں اور صارفین', franchiseManagement: 'فرنچائز مینجمنٹ', logout: 'لاگ آؤٹ',
    companyDefaultLanguage: 'کمپنی کی ڈیفالٹ زبان', saveCompanySettings: 'کمپنی کی ترتیبات محفوظ کریں'
  },
  ar: {
    language: 'اللغة', waterBusinessManagement: 'إدارة أعمال المياه', springWater: 'TEMO AQUAFLOW',
    loginSubtext: 'العملاء والتوصيل والفوترة والمخزون والتقارير في مساحة عمل واحدة.',
    customerManagement: 'إدارة العملاء', smartBilling: 'الفوترة الذكية', inventoryControl: 'إدارة المخزون', powerfulReports: 'تقارير متقدمة',
    welcomeBack: 'مرحباً بعودتك', signInTitle: 'تسجيل الدخول إلى حسابك', signInHelper: 'أدخل بياناتك للوصول إلى مساحة العمل.',
    username: 'اسم المستخدم', password: 'كلمة المرور', login: 'تسجيل الدخول', forgotPassword: 'هل نسيت كلمة المرور؟', noAccount: 'ليس لديك حساب بعد؟', signup: 'إنشاء حساب',
    dashboard: 'لوحة التحكم', products: 'المنتجات', bottles: 'العبوات', sales: 'المبيعات', ordersDelivery: 'الطلبات والتوصيل', fleet: 'الأسطول', employees: 'الموظفون',
    attendance: 'الحضور', payroll: 'الرواتب', driverMode: 'وضع السائق', recurringDeliveries: 'التوصيلات المتكررة', customers: 'العملاء', complaintsSupport: 'الشكاوى والدعم',
    suppliers: 'الموردون', purchases: 'المشتريات', expenses: 'المصروفات', payments: 'المدفوعات', reports: 'التقارير', companiesUsers: 'الشركات والمستخدمون', franchiseManagement: 'إدارة الامتياز', logout: 'تسجيل الخروج',
    companyDefaultLanguage: 'اللغة الافتراضية للشركة', saveCompanySettings: 'حفظ إعدادات الشركة'
  }
};

function applyLanguage(language) {
  const selected = SUPPORTED_LANGUAGES.includes(language) ? language : 'en';
  const dictionary = translations[selected];
  document.documentElement.lang = selected;
  document.documentElement.dir = selected === 'en' ? 'ltr' : 'rtl';
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const value = dictionary[element.dataset.i18n];
    if (value) element.textContent = value;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    const value = dictionary[element.dataset.i18nPlaceholder];
    if (value) element.placeholder = value;
  });
  document.querySelectorAll('.language-select').forEach((select) => { select.value = selected; });
  localStorage.setItem(LANGUAGE_KEY, selected);
  return selected;
}

async function setLanguage(language, persist = true) {
  const selected = applyLanguage(language);
  if (!persist || !state.currentUser) return;
  const response = await fetch('/api/me/language', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: selected })
  });
  if (!response.ok) return;
  state.currentUser.language = selected;
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(state.currentUser));
}

let displayCurrency = 'PKR';
let displayDateFormat = localStorage.getItem('temo_aquaflow_date_format') || 'YYYY-MM-DD';
function normalizeDateValue(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00`);
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
function normalizeDateForStorage(value, selectedFormat = displayDateFormat) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(date.getTime()) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return raw;
  }
  const parts = raw.split(/[\-\/]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 3) return null;
  const format = String(selectedFormat || 'YYYY-MM-DD').toUpperCase();
  let day;
  let month;
  let year;
  if (format === 'DD-MM-YYYY') [day, month, year] = parts;
  else if (format === 'MM-DD-YYYY') [month, day, year] = parts;
  else [year, month, day] = parts;
  if (!day || !month || !year || !/^\d+$/.test(day) || !/^\d+$/.test(month) || !/^\d+$/.test(year)) return null;
  const dayNumber = Number(day);
  const monthNumber = Number(month);
  const yearNumber = Number(year);
  if (!Number.isInteger(dayNumber) || !Number.isInteger(monthNumber) || !Number.isInteger(yearNumber)) return null;
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return null;
  const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() !== yearNumber || date.getUTCMonth() !== monthNumber - 1 || date.getUTCDate() !== dayNumber) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
function formatDate(value) {
  const date = normalizeDateValue(value);
  if (!date) return String(value || '');
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  if (displayDateFormat === 'DD-MM-YYYY') return `${day}-${month}-${year}`;
  if (displayDateFormat === 'MM-DD-YYYY') return `${month}-${day}-${year}`;
  return `${year}-${month}-${day}`;
}
function formatDateTime(value) {
  const date = normalizeDateValue(value);
  if (!date) return String(value || '');
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${formatDate(date)} ${time}`;
}
function applyDateFormat(format) {
  if (!['DD-MM-YYYY', 'MM-DD-YYYY', 'YYYY-MM-DD'].includes(format)) return;
  displayDateFormat = format;
  localStorage.setItem('temo_aquaflow_date_format', format);
  document.querySelectorAll('[data-date]').forEach((element) => { element.textContent = formatDate(element.dataset.date); });
}
const formatCurrency = (value) => new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: displayCurrency,
  maximumFractionDigits: 2
}).format(Number(value) || 0);
async function loadCurrencySettings() {
  try { const response = await fetch('/api/settings/currency'); if (response.ok) { const settings = await response.json(); if (/^[A-Z]{3}$/.test(settings.display_currency)) displayCurrency = settings.display_currency; } } catch (_) { /* preserve base display */ }
}

const LOGIN_TOKEN_KEY = 'temo_aquaflow_token';
const CURRENT_USER_KEY = 'temo_aquaflow_user';
const ACTIVE_COMPANY_KEY = 'temo_aquaflow_active_company';

const nativeFetch = window.fetch.bind(window);
window.fetch = async (url, options = {}) => {
  if (url === '/api/login' || url === '/api/signup' || url === '/api/forgot-password' || url === '/api/reset-password') return nativeFetch(url, options);
  const token = localStorage.getItem(LOGIN_TOKEN_KEY);
  const response = await nativeFetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: ['Bearer', token].join(' ') } : {}),
      ...(localStorage.getItem(ACTIVE_COMPANY_KEY) ? { 'X-Company-Id': localStorage.getItem(ACTIVE_COMPANY_KEY) } : {})
    }
  });
  if (response.status === 402) {
    const data = await response.clone().json().catch(() => ({}));
    localStorage.removeItem(LOGIN_TOKEN_KEY);
    localStorage.removeItem(CURRENT_USER_KEY);
    localStorage.removeItem(ACTIVE_COMPANY_KEY);
    if (typeof showLoginScreen === 'function') showLoginScreen();
    alert(data.message || 'Your subscription is inactive.');
  }
  return response;
};

const state = {
  products: [],
  production: { lines: [], batches: [], tests: [], parameters: [], certificates: [] },
  documents: [], certificates: [], documentReminders: [],
  bottles: [],
  bottleMovements: [],
  bottleBalances: [],
  bottleReconciliation: [],
  customers: [],
  complaints: [],
  complaintAssignees: [],
  vehicles: [],
  employees: [],
  suppliers: [],
  sales: [],
  orders: [],
  deliverySubscriptions: [],
  drivers: [],
  driverDeliveries: [],
  driverHistory: [],
  routeCandidates: [],
  routes: [],
  territories: [],
  territoryAssignments: { customers: [], drivers: [] },
  selectedRoute: null,
  purchases: [],
  expenses: [],
  payments: [],
  lowStock: [],
  profitability: { summary: {}, costBreakdown: {}, customers: [], routes: [], filter: {} },
  reports: {
    salesReport: [],
    expensesReport: [],
    purchasesReport: [],
    customerReport: [],
    inventoryReport: [],
    monthlyReport: [],
    supplierReport: [],
    paymentReport: [],
    totals: {}
  },
  forecast: null,
  audit: { logs: [], page: 1, pageSize: 50, total: 0, totalPages: 1 },
  currentUser: JSON.parse(localStorage.getItem(CURRENT_USER_KEY) || 'null'),
  features: {},
  franchise: {
    accessLoaded: false,
    authorized: false,
    loading: false,
    relationshipsLoaded: false,
    relationships: [],
    scopes: [],
    selectedId: null,
    detail: null,
    branches: [],
    users: [],
    employeeScope: { loading: false, rows: [], error: '' },
    status: 'idle',
    message: '',
    detailError: '',
    report: null,
    reportError: '',
    reportDeniedForId: null
  },
  companies: [],
  users: [],
  invoice: null,
  qrRecords: [],
  qrHistory: [],
  crm: { loyalty: [], referrals: [], salesmen: [] }
};

applyLanguage((isLoggedIn() && state.currentUser?.language) || localStorage.getItem(LANGUAGE_KEY) || 'en');
if (window.OfflineDriver) {
  OfflineDriver.subscribe(updateOfflineIndicators);
  OfflineDriver.count().then((pending) => updateOfflineIndicators({ pending }));
} else {
  updateOfflineIndicators();
}
document.getElementById('loginLanguage')?.addEventListener('change', (event) => setLanguage(event.target.value, Boolean(state.currentUser && isLoggedIn())));
document.getElementById('appLanguage')?.addEventListener('change', (event) => setLanguage(event.target.value));

function hasFeature(featureKey) {
  return state.currentUser?.role === 'super_admin' || state.features?.[featureKey] === true;
}

async function loadFeaturePermissions() {
  try {
    const response = await fetch('/api/subscription/features');
    if (!response.ok) {
      state.features = {};
      document.querySelectorAll('.nav-btn[data-feature]').forEach((button) => button.classList.add('hidden'));
      return;
    }
    const data = await response.json();
    state.features = data.features || {};
    document.querySelectorAll('.nav-btn[data-feature]').forEach((button) => {
      button.classList.toggle('hidden', !hasFeature(button.dataset.feature));
    });
  } catch (_) {
    state.features = {};
    document.querySelectorAll('.nav-btn[data-feature]').forEach((button) => button.classList.add('hidden'));
  }
}

function setActiveTab(tabName) {
  if (tabName === 'billing' && state.currentUser?.role === 'super_admin') return;
  if (tabName === 'franchiseManagement' && (!state.franchise?.authorized || !hasFeature('multi_branch'))) return;
  const tabButton = document.querySelector(`.nav-btn[data-tab="${tabName}"]`);
  if (tabButton?.dataset.feature && !hasFeature(tabButton.dataset.feature)) return;
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    if (btn.dataset.tab) {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    }

  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.id === tabName);
  });
}

function focusDeliveryTarget(targetId) {
  const target = document.getElementById(targetId);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleDeliveryAction(action) {
  const role = state.currentUser?.role;
  switch (action) {
    case 'plan-routes':
      setActiveTab('orders');
      await fetchRoutes();
      focusDeliveryTarget('route-planner-panel');
      break;
    case 'customer-alerts':
      setActiveTab('orders');
      await fetchOrders();
      focusDeliveryTarget('ordersTableBody');
      break;
    case 'proof-of-delivery':
      setActiveTab(['driver', 'delivery_driver'].includes(role) ? 'driverMode' : 'orders');
      if (['driver', 'delivery_driver'].includes(role)) await fetchDriverMode();
      focusDeliveryTarget(['driver', 'delivery_driver'].includes(role) ? 'driverDeliveryList' : 'ordersTableBody');
      break;
    case 'staff-roles':
      setActiveTab('employees');
      await fetchEmployees();
      focusDeliveryTarget('employees');
      break;
    case 'sleeping-customers':
      setActiveTab('customers');
      await fetchCustomers();
      focusDeliveryTarget('customers');
      break;
    case 'route-report':
      setActiveTab('reports');
      await fetchReports();
      focusDeliveryTarget('reports');
      break;
    default:
      break;
  }
}

function showLoginScreen() {
  document.getElementById('loginOverlay').classList.remove('hidden');
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('signupOverlay').classList.add('hidden');
  document.getElementById('resetOverlay').classList.add('hidden');
  document.getElementById('passwordChangeOverlay').classList.add('hidden');
  document.getElementById('franchiseNav')?.classList.add('hidden');
}

function resetFranchiseState() {
  if (!state.franchise) return;
  Object.assign(state.franchise, {
    accessLoaded: false,
    authorized: false,
    loading: false,
    relationshipsLoaded: false,
    relationships: [],
    scopes: [],
    selectedId: null,
    detail: null,
    branches: [],
    users: [],
    employeeScope: { loading: false, rows: [], error: '' },
    status: 'idle',
    message: '',
    detailError: '',
    report: null,
    reportError: '',
    reportDeniedForId: null
  });
}

function showMainApp() {
  resetFranchiseState();
  document.getElementById('loginOverlay').classList.add('hidden');
  document.getElementById('signupOverlay').classList.add('hidden');
  document.getElementById('resetOverlay').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  window.refreshNotificationCenter?.();
}

function showPasswordChangeScreen() {
  document.getElementById('loginOverlay').classList.add('hidden');
  document.getElementById('signupOverlay').classList.add('hidden');
  document.getElementById('resetOverlay').classList.add('hidden');
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('passwordChangeOverlay').classList.remove('hidden');
}

function isLoggedIn() {
  return Boolean(localStorage.getItem(LOGIN_TOKEN_KEY));
}

function isAdminUser() {
  return ['super_admin', 'company_admin'].includes(state.currentUser?.role);
}

function configureAdminControls() {
  const companyNav = document.getElementById('companyNav');
  const franchiseNav = document.getElementById('franchiseNav');
  const billingNav = document.getElementById('billingNav');
  const switcher = document.getElementById('companySwitcher');
  const isSuperAdmin = state.currentUser?.role === 'super_admin';
  companyNav.classList.toggle('hidden', !isAdminUser());
  if (billingNav) billingNav.classList.toggle('hidden', isSuperAdmin);
  if (franchiseNav) franchiseNav.classList.toggle('hidden', !state.franchise?.authorized || !hasFeature('multi_branch') || !isLoggedIn());
  const auditNav = document.getElementById('auditNav');
  if (auditNav) auditNav.classList.toggle('hidden', !['super_admin', 'company_admin', 'manager', 'accountant'].includes(state.currentUser?.role));
  const operationsNav = document.getElementById('operationsNav');
  if (operationsNav) operationsNav.classList.toggle('hidden', !['super_admin', 'company_admin', 'manager'].includes(state.currentUser?.role));
  switcher.classList.toggle('hidden', !isSuperAdmin);
  document.querySelectorAll('.admin-only-super').forEach((panel) => panel.classList.toggle('hidden', !isSuperAdmin));
  document.getElementById('companySettingsPanel').classList.toggle('hidden', !isAdminUser());
  document.querySelectorAll('.export-btn').forEach((button) => button.classList.toggle('hidden', !['super_admin', 'company_admin', 'manager', 'accountant'].includes(state.currentUser?.role)));
  const backupButton = document.getElementById('downloadBackupBtn');
  if (backupButton) backupButton.classList.toggle('hidden', state.currentUser?.role !== 'super_admin');
  const fleetFormPanel = document.getElementById('fleetFormPanel');
  if (fleetFormPanel) fleetFormPanel.classList.toggle('hidden', !['super_admin', 'company_admin', 'manager'].includes(state.currentUser?.role));
  const driverNav = document.getElementById('driverNav');
  if (driverNav) driverNav.classList.toggle('hidden', !['driver', 'delivery_driver'].includes(state.currentUser?.role));
  const employeeFormPanel = document.getElementById('employeeFormPanel');
  if (employeeFormPanel) employeeFormPanel.classList.toggle('hidden', !['super_admin', 'company_admin', 'manager'].includes(state.currentUser?.role));
  const territoryManagerRoles = ['super_admin', 'company_admin', 'manager'];
  const territoryFormPanel = document.getElementById('territoryFormPanel');
  if (territoryFormPanel) territoryFormPanel.classList.toggle('hidden', !territoryManagerRoles.includes(state.currentUser?.role));
  document.querySelectorAll('#territories .field-row button').forEach((button) => button.classList.toggle('hidden', !territoryManagerRoles.includes(state.currentUser?.role)));
  const payrollRoles = ['super_admin', 'company_admin', 'manager', 'accountant'];
  const payrollFormPanel = document.getElementById('payrollFormPanel');
  if (payrollFormPanel) payrollFormPanel.classList.toggle('hidden', !payrollRoles.includes(state.currentUser?.role));
  const payrollNav = document.getElementById('payrollNav');
  if (payrollNav) payrollNav.classList.toggle('hidden', !payrollRoles.includes(state.currentUser?.role) || !hasFeature('payroll'));
  document.getElementById('userManagementTitle').textContent = isSuperAdmin ? 'Users for selected company' : 'Company Users';
  const companyAdminRole = document.querySelector('#userRole option[value="company_admin"]');
  if (companyAdminRole) companyAdminRole.hidden = !isSuperAdmin;
  if (typeof renderFranchiseManagement === 'function') renderFranchiseManagement();
}

function renderCompanies() {
  const body = document.getElementById('companyTableBody');
  const switcher = document.getElementById('companySwitcher');
  if (!body || !switcher) return;
  body.innerHTML = '';
  switcher.innerHTML = '<option value="">Select company data</option>';
  state.companies.forEach((company) => {
    const option = document.createElement('option');
    option.value = company.id;
    option.textContent = company.name;
    switcher.appendChild(option);

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${company.name}</td>
      <td>${company.company_code || '-'}</td>
      <td>${company.email || company.phone || '-'}</td>
      <td>${company.plan_name || '-'}</td>
      <td>${company.end_date || '-'}</td>
      <td>${company.user_count}</td>
      <td>${company.subscription_status || (company.active ? 'Active' : 'Inactive')}</td>
      <td>
        <button class="table-action select-company-btn" data-company-id="${company.id}" type="button">Manage</button>
        <button class="table-action company-status-btn" data-company-id="${company.id}" data-status="${company.status || (company.active ? 'active' : 'inactive')}" type="button">${company.status === 'archived' ? 'Restore' : company.status === 'suspended' ? 'Restore' : company.status === 'active' ? 'Deactivate' : 'Activate'}</button>
        <button class="table-action suspend-company-btn" data-company-id="${company.id}" type="button">Suspend</button>
        <button class="table-action archive-company-btn" data-company-id="${company.id}" type="button">Archive</button>
      </td>
    `;
    body.appendChild(row);
  });
  const selected = localStorage.getItem(ACTIVE_COMPANY_KEY) || '';
  switcher.value = selected;
  document.querySelectorAll('.select-company-btn').forEach((button) => {
    button.addEventListener('click', () => selectCompany(button.dataset.companyId));
  });
  document.querySelectorAll('.company-status-btn, .suspend-company-btn, .archive-company-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const company = state.companies.find((item) => item.id === Number(button.dataset.companyId));
      if (!company) return;
      const current = company.status || (company.active ? 'active' : 'inactive');
      const status = button.classList.contains('suspend-company-btn') ? 'suspended'
        : button.classList.contains('archive-company-btn') ? 'archived'
          : (current === 'active' ? 'inactive' : 'active');
      if (status === 'archived' && !confirm('Archive this company? Historical data will be retained.')) return;
      const response = await fetch(`/api/admin/companies/${company.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!response.ok) return alert('Could not update company status.');
      await fetchCompanies();
    });
  });
}

function renderUsers() {
  const body = document.getElementById('userTableBody');
  if (!body) return;
  body.innerHTML = '';
  state.users.forEach((user) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${user.name}</td>
      <td>${user.username}</td>
      <td>${user.role}</td>
      <td>${user.status || (user.active ? 'active' : 'inactive')}</td>
      <td>${user.company_id}</td>
      <td><button class="table-action edit-user-btn" data-user-id="${user.id}" type="button">Edit</button> <button class="table-action toggle-user-btn" data-user-id="${user.id}" data-status="${user.status || (user.active ? 'active' : 'inactive')}" type="button">${user.status === 'active' ? 'Deactivate' : 'Activate'}</button> <button class="table-action reset-user-btn" data-user-id="${user.id}" type="button">Reset password</button></td>
    `;
    body.appendChild(row);
  });
  document.querySelectorAll('.toggle-user-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const nextStatus = button.dataset.status === 'active' ? 'inactive' : 'active';
      const response = await fetch(`/api/users/${button.dataset.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      if (!response.ok) return alert('Could not update user status.');
      const companyId = state.currentUser?.role === 'super_admin' ? localStorage.getItem(ACTIVE_COMPANY_KEY) : state.currentUser?.companyId;
      await fetchUsers(companyId);
    });
  });
  document.querySelectorAll('.edit-user-btn').forEach((button) => button.addEventListener('click', async () => {
    const user = state.users.find((item) => item.id === Number(button.dataset.userId));
    if (!user) return;
    const name = prompt('Name', user.name);
    if (name === null) return;
    const email = prompt('Email', user.email || '');
    if (email === null) return;
    const role = prompt('Role (staff, manager, accountant, sales_staff, inventory_staff)', user.role);
    if (role === null) return;
    const response = await fetch(`/api/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, role }) });
    if (!response.ok) return alert((await response.json().catch(() => ({}))).message || 'Could not edit user.');
    await fetchUsers(user.company_id);
  }));
  document.querySelectorAll('.reset-user-btn').forEach((button) => button.addEventListener('click', async () => {
    const password = prompt('New temporary password (minimum 8 characters)');
    if (!password) return;
    const response = await fetch(`/api/users/${button.dataset.userId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, mustChangePassword: true }) });
    if (!response.ok) return alert((await response.json().catch(() => ({}))).message || 'Could not reset password.');
    alert('Password reset and change required at next login.');
  }));
}

async function fetchUsers(companyId) {
  if (!companyId) {
    state.users = [];
    renderUsers();
    return;
  }
  const params = new URLSearchParams();
  const search = document.getElementById('userSearch')?.value.trim();
  const status = document.getElementById('userStatusFilter')?.value;
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (state.currentUser?.role === 'super_admin' && companyId) params.set('companyId', companyId);
  const response = await fetch(`${state.currentUser?.role === 'super_admin' ? '/api/admin/users' : `/api/companies/${companyId}/users`}?${params}`);
  if (!response.ok) return;
  state.users = await response.json();
  renderUsers();
}

async function fetchCompanies() {
  if (state.currentUser?.role === 'super_admin') {
    const search = document.getElementById('adminCompanySearch')?.value || '';
    const companyStatus = document.getElementById('adminCompanyStatusFilter')?.value || '';
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (companyStatus) params.set('companyStatus', companyStatus);
    const response = await fetch(`/api/admin/companies?${params}`);
    if (response.ok) {
      state.companies = await response.json();
      renderCompanies();
      await fetchSaasOverview();
      await fetchPlans();
      await fetchAdminRenewalRequests();
      await fetchAdminPaymentProofs();
    }
    await fetchUsers(localStorage.getItem(ACTIVE_COMPANY_KEY));
  } else if (['company_admin', 'manager'].includes(state.currentUser?.role)) {
    await fetchUsers(state.currentUser.companyId);
  }
  await fetchCompanySettings();
  configureAdminControls();
}

async function fetchSaasOverview() {
  if (state.currentUser?.role !== 'super_admin') return;
  const response = await fetch('/api/saas/dashboard');
  if (!response.ok) return;
  const data = await response.json();
  const status = (name) => Number(data.statuses.find((item) => item.status === name)?.count || 0);
  document.getElementById('saasTotalCompanies').textContent = data.companies?.total || 0;
  document.getElementById('saasActiveCompanies').textContent = data.companies?.active || 0;
  document.getElementById('saasTrialCompanies').textContent = status('trial');
  document.getElementById('saasExpiredCompanies').textContent = status('expired');
  document.getElementById('saasRevenue').textContent = formatCurrency(data.revenue);
  document.getElementById('saasExpiring7').textContent = Number(data.expiring?.within_7_days || 0);
  document.getElementById('saasPendingPayments').textContent = Number(data.billing?.pending_payments || 0);
}

async function fetchAdminRenewalRequests() {
  if (state.currentUser?.role !== 'super_admin') return;
  const response = await fetch('/api/admin/subscription/renewal-requests');
  if (!response.ok) return;
  const rows = await response.json();
  const body = document.getElementById('adminRenewalRequestsBody');
  if (!body) return;
  body.innerHTML = rows.map((row) => `<tr><td>${String(row.company_name || '').replace(/[<>&"']/g, '')}</td><td>${String(row.plan_name || '').replace(/[<>&"']/g, '')}</td><td>${row.requested_period}</td><td>${row.created_at || ''}</td><td>${row.status}</td><td>${String(row.notes || '').replace(/[<>&"']/g, '')}</td><td>${row.status === 'pending' ? `<button class="table-action" data-renewal-action="approved" data-renewal-id="${row.id}">Approve</button><button class="table-action" data-renewal-action="rejected" data-renewal-id="${row.id}">Reject</button>` : row.status === 'approved' ? `<button class="table-action" data-renewal-action="process" data-renewal-id="${row.id}">Process Renewal</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7">No renewal requests.</td></tr>';
  body.querySelectorAll('[data-renewal-action]').forEach((button) => button.addEventListener('click', async () => {
    const process = button.dataset.renewalAction === 'process';
    const response = await fetch(`/api/admin/subscription/renewal-requests/${button.dataset.renewalId}${process ? '/process' : ''}`, { method: process ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(process ? {} : { status: button.dataset.renewalAction }) });
    if (response.ok) fetchAdminRenewalRequests();
  }));
}

async function fetchAdminPaymentProofs() {
  if (state.currentUser?.role !== 'super_admin') return;
  const response = await fetch('/api/admin/subscription/payment-proofs');
  if (!response.ok) return;
  const rows = await response.json();
  const body = document.getElementById('adminPaymentProofsBody');
  if (!body) return;
  body.innerHTML = rows.map((row) => `<tr><td>${String(row.company_name || '').replace(/[<>&"']/g, '')}</td><td>${String(row.original_name || '').replace(/[<>&"']/g, '')}</td><td>${row.status}</td><td>${row.created_at || ''}</td><td>${String(row.review_note || '').replace(/[<>&"']/g, '')}</td><td>${row.status !== 'approved' && row.status !== 'rejected' ? `<button class="table-action" data-proof-action="approved" data-proof-id="${row.id}">Approve</button><button class="table-action" data-proof-action="rejected" data-proof-id="${row.id}">Reject</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6">No payment proofs.</td></tr>';
  body.querySelectorAll('[data-proof-action]').forEach((button) => button.addEventListener('click', async () => {
    const note = prompt('Review note (optional):') || '';
    const response = await fetch(`/api/admin/subscription/payment-proofs/${button.dataset.proofId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: button.dataset.proofAction, reviewNote: note }) });
    if (response.ok) fetchAdminPaymentProofs();
  }));
}

async function fetchPlans() {
  if (state.currentUser?.role !== 'super_admin') return;
  const response = await fetch('/api/plans');
  if (!response.ok) return;
  const plans = await response.json();
  const select = document.getElementById('subscriptionPlan');
  select.innerHTML = '<option value="">Select plan</option>';
  plans.forEach((plan) => {
    const option = document.createElement('option');
    option.value = plan.id;
    option.textContent = `${plan.name} - ${formatCurrency(plan.price)} / ${plan.duration_months} month(s)`;
    select.appendChild(option);
  });
}

async function fetchSelectedSubscription(companyId) {
  if (state.currentUser?.role !== 'super_admin' || !companyId) return;
  const response = await fetch(`/api/companies/${companyId}/subscription`);
  if (!response.ok) return;
  const data = await response.json();
  const subscription = data.subscription;
  if (!subscription) return;
  document.getElementById('subscriptionPlan').value = subscription.plan_id;
  document.getElementById('subscriptionStatus').value = subscription.status;
  document.getElementById('subscriptionStart').value = subscription.start_date || '';
  document.getElementById('subscriptionEnd').value = subscription.end_date || '';
  document.getElementById('subscriptionPrice').value = subscription.price || 0;
}

async function fetchCustomFeatures(companyId) {
  const list = document.getElementById('customFeatureList');
  if (!list || state.currentUser?.role !== 'super_admin' || !companyId) return;
  const response = await fetch(`/api/admin/companies/${companyId}/features`);
  if (!response.ok) { list.innerHTML = '<span class="muted-label">Could not load feature settings.</span>'; return; }
  const data = await response.json();
  list.innerHTML = Object.entries(data.features || {}).map(([key, enabled]) => `
    <label><input type="checkbox" data-feature-key="${key}" ${enabled ? 'checked' : ''}> ${key.replaceAll('_', ' ')}</label>
  `).join('');
}

async function fetchCompanySettings() {
  if (!isAdminUser()) return;
  const response = await fetch('/api/company');
  if (!response.ok) return;
  const company = await response.json();
  document.getElementById('settingsCompanyName').value = company.name || '';
  document.getElementById('settingsCompanyLogo').value = company.logo || '';
  document.getElementById('settingsCompanyPhone').value = company.phone || '';
  document.getElementById('settingsCompanyEmail').value = company.email || '';
  document.getElementById('settingsCompanyAddress').value = company.address || '';
  document.getElementById('settingsCompanyDomain').value = company.custom_domain || '';
  document.getElementById('settingsCompanySubdomain').value = company.subdomain || '';
  document.getElementById('settingsCompanySupportEmail').value = company.support_email || '';
  document.getElementById('settingsCompanyFavicon').value = company.favicon_url || '';
  const theme = (() => { try { return JSON.parse(company.theme_json || '{}'); } catch (_) { return {}; } })();
  if (/^#[0-9a-f]{6}$/i.test(theme.primary || '')) document.documentElement.style.setProperty('--primary', theme.primary);
  if (/^#[0-9a-f]{6}$/i.test(theme.accent || '')) document.documentElement.style.setProperty('--accent', theme.accent);
  if (/^#[0-9a-f]{6}$/i.test(theme.background || '')) document.documentElement.style.setProperty('--bg', theme.background);
  ['primary', 'accent', 'background'].forEach((key) => { const input = document.getElementById(`settingsTheme${key[0].toUpperCase()}${key.slice(1)}`); if (input && /^#[0-9a-f]{6}$/i.test(theme[key] || '')) input.value = theme[key]; });
  document.getElementById('settingsCompanyLanguage').value = company.default_language || 'en';
  const dateFormat = company.date_format || 'YYYY-MM-DD';
  document.getElementById('settingsDateFormat').value = dateFormat;
  applyDateFormat(dateFormat);
  await fetchTenantUsage();
}

async function fetchTenantUsage() {
  const response = await fetch('/api/company/usage');
  if (!response.ok) return;
  const data = await response.json();
  const grid = document.getElementById('tenantUsageGrid'); if (!grid) return;
  grid.innerHTML = Object.entries(data.limits || {}).map(([metric, limit]) => `<div class="report-kpi"><span>${metric.replaceAll('_', ' ')}</span><strong>${data.usage?.[metric]?.used || 0} / ${limit}</strong><small>${data.plan?.name || 'No plan'} · ${data.plan?.status || 'unknown'}</small></div>`).join('');
}

async function selectCompany(companyId) {
  localStorage.setItem(ACTIVE_COMPANY_KEY, companyId);
  await fetchUsers(companyId);
  await fetchSelectedSubscription(companyId);
  await fetchCustomFeatures(companyId);
  await initializeApp();
  setActiveTab('companies');
}

document.getElementById('saveCustomFeatures')?.addEventListener('click', async () => {
  const companyId = localStorage.getItem(ACTIVE_COMPANY_KEY);
  if (!companyId) return alert('Select a company first.');
  const features = Object.fromEntries([...document.querySelectorAll('#customFeatureList [data-feature-key]')]
    .map((input) => [input.dataset.featureKey, input.checked]));
  const response = await fetch(`/api/admin/companies/${companyId}/features`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ features })
  });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not save feature settings.');
  alert('Feature settings saved.');
});

document.getElementById('adminCompanySearch')?.addEventListener('input', () => fetchCompanies());
document.getElementById('adminCompanyStatusFilter')?.addEventListener('change', () => fetchCompanies());

async function fetchDashboard() {
  const response = await fetch('/api/dashboard');
  const data = await response.json();

  document.getElementById('revenueValue').textContent = formatCurrency(data.revenue);
  document.getElementById('purchaseValue').textContent = formatCurrency(data.purchases);
  document.getElementById('expenseValue').textContent = formatCurrency(data.expenses);
  document.getElementById('profitValue').textContent = formatCurrency(data.profit);
  document.getElementById('productsValue').textContent = data.totalProducts;
  document.getElementById('stockValue').textContent = data.totalStock;
  document.getElementById('customersValue').textContent = data.customersCount;
  document.getElementById('suppliersValue').textContent = data.suppliersCount;
  document.getElementById('customersValueSecondary').textContent = data.customersCount;

  state.lowStock = data.lowStock || [];
  renderLowStock();

  state.recentSales = data.recentSales || [];
  renderRecentSales();
}

async function fetchBillingWorkspace() {
  const billingEscape = (value) => String(value ?? '').replace(/[&<>\"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[char]));
  const response = await fetch('/api/subscription/billing');
  if (!response.ok) return;
  const data = await response.json();
  const subscription = data.subscription || {};
  const status = data.status || {};
  const days = status.daysRemaining ?? Math.ceil((new Date(`${subscription.end_date}T00:00:00Z`) - new Date()) / 86400000);
  const summary = document.getElementById('billingSummary');
  if (summary) summary.innerHTML = `<div><strong>Plan</strong><span>${billingEscape(subscription.plan_name || subscription.plan_slug || '—')}</span></div><div><strong>Status</strong><span>${billingEscape(subscription.status || '—')}</span></div><div><strong>Billing cycle</strong><span>${billingEscape(subscription.billing_cycle || '—')}</span></div><div><strong>Start</strong><span>${billingEscape(subscription.start_date || '—')}</span></div><div><strong>Expiry</strong><span>${billingEscape(subscription.end_date || '—')}</span></div><div><strong>Days remaining</strong><span>${Number.isFinite(Number(days)) ? days : '—'}</span></div><div><strong>Payment status</strong><span>${billingEscape(subscription.payment_status || '—')}</span></div><div><strong>Outstanding</strong><span>${formatCurrency(subscription.price || 0)}</span></div>`;
  const paymentsBody = document.getElementById('billingPaymentsBody');
  if (paymentsBody) paymentsBody.innerHTML = (data.payments || []).map((payment) => `<tr><td>${billingEscape(payment.invoice_number || '—')}</td><td>${formatCurrency(payment.amount || payment.amount_due || 0)}</td><td>${billingEscape(payment.payment_status || '—')}</td><td>${billingEscape(payment.payment_date || payment.created_at || '')}</td></tr>`).join('') || '<tr><td colspan="4">No payments recorded.</td></tr>';
  const proofsBody = document.getElementById('paymentProofsBody');
  if (proofsBody) proofsBody.innerHTML = (data.paymentProofs || []).map((proof) => `<tr><td>${billingEscape(proof.original_name)}</td><td>${billingEscape(proof.status)}</td><td>${billingEscape(proof.review_note || '')}</td><td>${billingEscape(proof.created_at || '')}</td></tr>`).join('') || '<tr><td colspan="4">No payment proofs submitted.</td></tr>';
  const requestsBody = document.getElementById('renewalRequestsBody');
  if (requestsBody) requestsBody.innerHTML = (data.renewalRequests || []).map((request) => `<tr><td>${billingEscape(request.requested_period === 'custom' ? `Custom (${request.requested_days || '?'} days)` : request.requested_period)}</td><td>${billingEscape(request.status)}</td><td>${billingEscape(request.notes || '')}</td><td>${billingEscape(request.created_at || '')}</td></tr>`).join('') || '<tr><td colspan="4">No renewal requests.</td></tr>';
  const banner = document.getElementById('subscriptionBanner');
  if (banner) {
    banner.classList.remove('hidden');
    const isExpired = String(status.status || subscription.status).toLowerCase() === 'expired' || Number(days) < 0;
    banner.className = `panel subscription-banner ${isExpired ? 'danger' : Number(days) <= 7 ? 'warning' : 'success'}`;
    banner.textContent = isExpired ? 'Your subscription has expired. Please renew to continue.' : `${subscription.status === 'trial' ? 'Trial' : 'Subscription'} active — ${Math.max(0, Number(days) || 0)} days remaining.`;
  }
}

function analyticsParams() {
  const type = document.getElementById('analyticsType')?.value || '';
  const params = new URLSearchParams();
  if (!type) return params;
  params.set('type', type);
  if (type === 'daily') params.set('date', document.getElementById('analyticsDate').value);
  if (type === 'monthly') params.set('month', document.getElementById('analyticsMonth').value);
  if (type === 'annual') params.set('year', document.getElementById('analyticsYear').value);
  if (type === 'custom') {
    params.set('startDate', document.getElementById('analyticsStart').value);
    params.set('endDate', document.getElementById('analyticsEnd').value);
  }
  return params;
}

function renderAnalyticsBars(containerId, rows, colorClass = '') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const values = rows || [];
  const max = Math.max(...values.map((row) => Number(row.total || 0)), 1);
  if (!values.length) {
    container.innerHTML = '<span class="analytics-empty">No data for this period</span>';
    return;
  }
  values.slice(-12).forEach((row) => {
    const item = document.createElement('div');
    item.className = 'analytics-bar-item';
    item.innerHTML = `<div class="analytics-bar-track"><span class="analytics-bar ${colorClass}" style="height: ${Math.max(8, Number(row.total || 0) / max * 100)}%"></span></div><small>${row.label}</small><strong>${formatCurrency(row.total)}</strong>`;
    container.appendChild(item);
  });
}

function updateAnalyticsFields() {
  const type = document.getElementById('analyticsType').value;
  document.getElementById('analyticsDate').classList.toggle('hidden', type !== 'daily');
  document.getElementById('analyticsMonth').classList.toggle('hidden', type !== 'monthly');
  document.getElementById('analyticsYear').classList.toggle('hidden', type !== 'annual');
  document.getElementById('analyticsStart').classList.toggle('hidden', type !== 'custom');
  document.getElementById('analyticsEnd').classList.toggle('hidden', type !== 'custom');
}

async function fetchAnalytics() {
  const params = analyticsParams();
  const requiredValues = Array.from(params.values()).slice(1);
  if (params.get('type') && requiredValues.some((value) => !value)) return;
  const response = await fetch(`/api/dashboard/analytics${params.toString() ? `?${params.toString()}` : ''}`);
  if (!response.ok) return;
  const data = await response.json();
  const kpis = data.kpis || {};
  document.getElementById('analyticsSales').textContent = formatCurrency(kpis.sales);
  document.getElementById('analyticsSalesCount').textContent = `${data.pending?.sales?.count || 0} pending / invoices`; 
  document.getElementById('analyticsGrossProfit').textContent = formatCurrency(kpis.grossProfit);
  document.getElementById('analyticsNetProfit').textContent = formatCurrency(kpis.netProfit);
  document.getElementById('analyticsCashBalance').textContent = formatCurrency(kpis.cashBalance);
  document.getElementById('analyticsBankBalance').textContent = formatCurrency(kpis.bankBalance);
  document.getElementById('analyticsReceivables').textContent = formatCurrency(kpis.receivables);
  document.getElementById('analyticsPayables').textContent = formatCurrency(kpis.payables);
  document.getElementById('analyticsInventory').textContent = formatCurrency(kpis.inventoryValue);
  document.getElementById('analyticsInventoryUnits').textContent = `${data.inventory?.units || 0} units`;
  document.getElementById('dashboardReceivables').textContent = formatCurrency(kpis.receivables);
  document.getElementById('dashboardPayables').textContent = formatCurrency(kpis.payables);
  document.getElementById('dashboardInventoryUnits').textContent = data.inventory?.units || 0;
  document.getElementById('analyticsLowStock').textContent = kpis.lowStockItems || 0;
  document.getElementById('analyticsPending').textContent = kpis.pendingInvoices || 0;
  document.getElementById('cashReceived').textContent = formatCurrency(data.cashFlow?.cashReceived);
  document.getElementById('cashPaid').textContent = formatCurrency(data.cashFlow?.cashPaid);
  document.getElementById('netCashFlow').textContent = formatCurrency(data.cashFlow?.netCashFlow);
  document.getElementById('closingBalance').textContent = formatCurrency(data.cashFlow?.closingBalance);
  document.getElementById('cashFlowPeriod').textContent = data.period?.start ? `${data.period.start} to ${data.period.end}` : 'All time';
  document.getElementById('dashboardPeriodStatus').textContent = data.period?.start ? `${data.period.start} to ${data.period.end}` : 'Live analytics';
  renderAnalyticsBars('salesTrendBars', data.trends?.sales || []);
  const chartValues = (data.trends?.sales || []).slice(-7);
  const chartMax = Math.max(...chartValues.map((row) => Number(row.total || 0)), 1);
  document.querySelectorAll('.bar-chart span').forEach((bar, index) => {
    const entry = chartValues[index];
    bar.style.height = entry ? `${Math.max(8, Number(entry.total || 0) / chartMax * 100)}%` : '8%';
  });
  document.querySelectorAll('.chart-labels span').forEach((label, index) => {
    label.textContent = chartValues[index]?.label || '-';
  });
  renderAnalyticsBars('cashFlowBars', [
    { label: 'Cash in', total: data.cashFlow?.cashReceived },
    { label: 'Bank in', total: data.cashFlow?.bankReceived },
    { label: 'Cash out', total: data.cashFlow?.cashPaid },
    { label: 'Bank out', total: data.cashFlow?.bankPaid }
  ], 'cash-bar');

  const paymentList = document.getElementById('paymentMethodList');
  paymentList.innerHTML = '';
  (data.paymentMethods || []).forEach((payment) => {
    const item = document.createElement('li');
    item.textContent = `${payment.method || 'Other'} (${payment.direction === 'payment' ? 'paid' : 'received'}): ${formatCurrency(payment.total)}`;
    paymentList.appendChild(item);
  });
  if (!paymentList.children.length) paymentList.innerHTML = '<li>No payment data for this period.</li>';

  const stockBody = document.getElementById('customerStockBody');
  stockBody.innerHTML = '';
  (data.customerStock || []).forEach((stock) => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${stock.customer}</td><td>${stock.product}</td><td>${stock.quantity}</td>`;
    stockBody.appendChild(row);
  });
  if (!stockBody.children.length) stockBody.innerHTML = '<tr><td colspan="3">No customer-held stock yet.</td></tr>';
}

async function fetchProducts() {
  const response = await fetch('/api/products');
  state.products = await response.json();
  renderProducts();
  populateSaleProductSelect();
  populatePurchaseProductSelect();
}

async function fetchProduction() {
  const responses = await Promise.all([fetch('/api/production/lines'), fetch('/api/production/batches'), fetch('/api/lab/parameters'), fetch('/api/lab/tests'), fetch('/api/quality/certificates')]);
  if (responses.some((response) => !response.ok)) return;
  [state.production.lines, state.production.batches, state.production.parameters, state.production.tests, state.production.certificates] = await Promise.all(responses.map((response) => response.json()));
  const productSelect = document.getElementById('productionProduct');
  if (productSelect) productSelect.innerHTML = state.products.map((product) => `<option value="${product.id}">${product.name} (${product.unit || 'unit'})</option>`).join('');
  const lineSelect = document.getElementById('productionLine');
  if (lineSelect) lineSelect.innerHTML = '<option value="">No line</option>' + state.production.lines.filter((line) => line.status !== 'inactive').map((line) => `<option value="${line.id}">${line.name}${line.code ? ` (${line.code})` : ''}</option>`).join('');
  const testBatchSelect = document.getElementById('labTestBatch');
  if (testBatchSelect) testBatchSelect.innerHTML = '<option value="">Completed batch</option>' + state.production.batches.filter((batch) => ['completed','released'].includes(batch.status)).map((batch) => `<option value="${batch.id}">${batch.batch_number} · ${batch.product_name}</option>`).join('');
  const inputBatchSelect = document.getElementById('productionInputBatch');
  if (inputBatchSelect) inputBatchSelect.innerHTML = '<option value="">Draft batch</option>' + state.production.batches.filter((batch) => ['draft','in_progress'].includes(batch.status)).map((batch) => `<option value="${batch.id}">${batch.batch_number} · ${batch.product_name}</option>`).join('');
  const inputProductSelect = document.getElementById('productionInputProduct');
  if (inputProductSelect) inputProductSelect.innerHTML = '<option value="">Existing inventory product</option>' + state.products.map((product) => `<option value="${product.id}">${product.name} · stock ${product.stock || 0}</option>`).join('');
  const batchBody = document.getElementById('productionBatchesBody');
  if (batchBody) batchBody.innerHTML = state.production.batches.map((batch) => `<tr><td>${batch.batch_number}</td><td>${batch.product_name}</td><td>${batch.planned_quantity} ${batch.unit}</td><td>${batch.actual_quantity || 0}</td><td><span class="tag">${batch.status}</span></td><td>${batch.lab_test_count || 0} tests / ${batch.certificate_count || 0} certificates</td><td>${batch.status === 'draft' ? `<button type="button" class="table-action start-batch" data-id="${batch.id}">Start</button>` : ''}${batch.status === 'in_progress' ? `<button type="button" class="table-action complete-batch" data-id="${batch.id}">Complete</button>` : ''}${batch.status === 'completed' ? `<button type="button" class="table-action release-batch" data-id="${batch.id}">Release</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7">No production batches recorded.</td></tr>';
  batchBody?.querySelectorAll('.start-batch').forEach((button) => button.addEventListener('click', () => updateProductionBatch(button.dataset.id, 'start')));
  batchBody?.querySelectorAll('.complete-batch').forEach((button) => button.addEventListener('click', () => { const quantity = prompt('Actual quantity produced:'); if (quantity) updateProductionBatch(button.dataset.id, 'complete', { actualQuantity: Number(quantity) }); }));
  batchBody?.querySelectorAll('.release-batch').forEach((button) => button.addEventListener('click', () => updateProductionBatch(button.dataset.id, 'release')));
  const testBody = document.getElementById('labTestsBody');
  if (testBody) testBody.innerHTML = state.production.tests.map((test) => `<tr><td>${test.test_number}</td><td>${test.batch_number}</td><td><span class="tag">${test.status}</span></td><td>${test.tester_name || '-'}</td><td>${test.status === 'in_progress' ? `<button type="button" class="table-action review-test" data-id="${test.id}">Review</button>` : ''}${test.status === 'passed' ? `<button type="button" class="table-action certificate-test" data-id="${test.id}">Certificate</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5">No lab tests recorded.</td></tr>';
  testBody?.querySelectorAll('.review-test').forEach((button) => button.addEventListener('click', async () => { const response = await fetch(`/api/lab/tests/${button.dataset.id}/review`, { method: 'POST' }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not review test.'); await fetchProduction(); }));
  testBody?.querySelectorAll('.certificate-test').forEach((button) => button.addEventListener('click', async () => { const number = prompt('Certificate number (optional):') || undefined; const response = await fetch(`/api/lab/tests/${button.dataset.id}/certificate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ certificateNumber: number }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not issue certificate.'); await fetchProduction(); }));
  const certificateBody = document.getElementById('qualityCertificatesBody');
  if (certificateBody) certificateBody.innerHTML = state.production.certificates.map((certificate) => `<tr><td>${certificate.certificate_number}</td><td>${certificate.batch_number}</td><td>${certificate.product_name}</td><td>${certificate.traceability_code}</td><td>${formatDateTime(certificate.issued_at)}</td></tr>`).join('') || '<tr><td colspan="5">No certificates issued.</td></tr>';
}

async function updateProductionBatch(id, action, body = {}) { const response = await fetch(`/api/production/batches/${id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) return alert(data.message || `Could not ${action} batch.`); await fetchProduction(); }

async function fetchDocuments() {
  const responses = await Promise.all([fetch('/api/documents'), fetch('/api/certificates'), fetch('/api/documents/reminders')]);
  if (responses.some((response) => !response.ok)) return;
  [state.documents, state.certificates, state.documentReminders] = await Promise.all(responses.map((response) => response.json()));
  const documentSelect = document.getElementById('documentVersionId');
  if (documentSelect) documentSelect.innerHTML = '<option value="">Select document</option>' + state.documents.map((row) => `<option value="${row.id}">${row.title} · ${row.document_type}</option>`).join('');
  const body = document.getElementById('documentsBody');
  if (body) body.innerHTML = state.documents.map((row) => `<tr><td>${row.title}</td><td>${row.entity_type}${row.entity_id ? ` #${row.entity_id}` : ''}</td><td>${row.document_type}</td><td>${row.version_number || '—'}</td><td>${row.expires_on || '—'}</td><td>${row.status}</td><td>${row.current_version_id ? `<button type="button" class="table-action document-preview" data-id="${row.id}">Preview metadata</button>` : 'No version'}</td></tr>`).join('') || '<tr><td colspan="7">No document records yet.</td></tr>';
  body?.querySelectorAll('.document-preview').forEach((button) => button.addEventListener('click', async () => { const response = await fetch(`/api/documents/${button.dataset.id}/preview`); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not load document metadata.'); alert(`${data.filename || 'Document'}\\n${data.mimeType || ''}\\nSHA-256: ${data.checksumSha256 || 'pending'}\\nStorage: ${data.storage?.provider || 'external'}`); }));
  const certificateBody = document.getElementById('certificatesBody');
  if (certificateBody) certificateBody.innerHTML = state.certificates.map((row) => `<tr><td>${row.certificate_number}</td><td>${row.certificate_type}</td><td>${row.entity_type}${row.entity_id ? ` #${row.entity_id}` : ''}</td><td>${row.issued_on}</td><td>${row.expires_on || '—'}</td><td>${row.status}</td></tr>`).join('') || '<tr><td colspan="6">No certificates registered.</td></tr>';
  const reminderBody = document.getElementById('documentRemindersBody');
  if (reminderBody) reminderBody.innerHTML = state.documentReminders.map((row) => `<tr><td>${row.title}</td><td>${row.entity_type}${row.entity_id ? ` #${row.entity_id}` : ''}</td><td>${row.expires_on}</td><td><span class="tag ${row.reminder_status === 'expired' ? 'danger' : row.reminder_status === 'due' ? 'warning' : 'success'}">${row.reminder_status}</span></td></tr>`).join('') || '<tr><td colspan="4">No expiry reminders configured.</td></tr>';
}

async function fetchBottles() {
  const [bottlesResponse, balancesResponse, movementsResponse, reconciliationResponse] = await Promise.all([
    fetch('/api/bottles'), fetch('/api/bottle-balances'), fetch('/api/bottle-movements'), fetch('/api/bottle-reconciliation')
  ]);
  state.bottles = await bottlesResponse.json();
  state.bottleBalances = await balancesResponse.json();
  state.bottleMovements = await movementsResponse.json();
  const reconciliation = await reconciliationResponse.json();
  state.bottleReconciliation = reconciliation.balances || [];
  renderBottles();
}

function populateBottleSelects() {
  const bottleSelect = document.getElementById('bottleMovementBottle');
  const customerSelect = document.getElementById('bottleMovementCustomer');
  if (!bottleSelect || !customerSelect) return;
  bottleSelect.innerHTML = state.bottles.filter((bottle) => bottle.active).map((bottle) => `<option value="${bottle.id}">${bottle.name} (${bottle.code})</option>`).join('');
  customerSelect.innerHTML = '<option value="">No customer</option>' + state.customers.map((customer) => `<option value="${customer.id}">${customer.name}</option>`).join('');
  const driverSelect = document.getElementById('bottleMovementDriver');
  if (driverSelect) driverSelect.innerHTML = '<option value="">No driver</option>' + state.drivers.map((driver) => `<option value="${driver.id}">${driver.name}</option>`).join('');
}

function renderBottles() {
  const balanceBody = document.getElementById('bottleBalanceTableBody');
  const movementBody = document.getElementById('bottleMovementTableBody');
  if (!balanceBody || !movementBody) return;
  balanceBody.innerHTML = state.bottleBalances.map((bottle) => `<tr><td>${bottle.name}</td><td>${bottle.code}</td><td>${bottle.capacity_litres} L</td><td>${bottle.available_balance}</td><td>${bottle.customer_held}</td></tr>`).join('') || '<tr><td colspan="5">No bottle types configured.</td></tr>';
  movementBody.innerHTML = state.bottleMovements.map((movement) => `<tr><td>${movement.bottle_name} (${movement.bottle_code})</td><td>${movement.movement_type.replaceAll('_', ' ')}</td><td>${movement.quantity}</td><td>${movement.customer || movement.driver_name || '-'}</td><td>${formatDate(movement.created_at)}</td></tr>`).join('') || '<tr><td colspan="5">No bottle movements yet.</td></tr>';
  const reconciliationBody = document.getElementById('bottleReconciliationTableBody');
  if (reconciliationBody) reconciliationBody.innerHTML = state.bottleReconciliation.map((item) => `<tr><td>${item.name} (${item.code})</td><td>${item.bottle_identifier || item.barcode || item.qr_code || '-'}</td><td>${item.warehouse_available}</td><td>${item.customer_held}</td><td>${item.driver_held}</td><td>${item.damaged}</td><td>${item.lost}</td><td>${item.delivery_returned} / ${item.delivery_empty}</td></tr>`).join('') || '<tr><td colspan="8">No bottle balances available.</td></tr>';
  populateBottleSelects();
}

async function fetchCustomers() {
  const response = await fetch('/api/customers');
  if (!response.ok) return;
  state.customers = await response.json();
  renderCustomers();
}

function reorderValue(value, suffix = '') { return value === null || value === undefined ? '—' : `${value}${suffix}`; }

async function openCustomerReorder(customerId) {
  const response = await fetch(`/api/customers/${customerId}/reorder-insights`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return alert(data.message || 'Could not load reorder insights.');
  document.getElementById('customerReorderPanel').classList.remove('hidden');
  document.getElementById('customerReorderTitle').textContent = `Reorder insights · ${data.customer.name}`;
  document.getElementById('customerReorderStatus').textContent = data.insights.length ? 'Metrics use this company customer and non-cancelled order history.' : 'No product order history is available for this customer.';
  const body = document.getElementById('customerReorderBody');
  body.innerHTML = data.insights.map((item) => `<tr><td>${item.productName}</td><td>${item.orderCount} / ${item.minimumOrders} required</td><td>${reorderValue(item.averageConsumption, ' units/order')}</td><td>${reorderValue(item.lastOrder)}</td><td>${reorderValue(item.averageIntervalDays, ' days')}</td><td>${reorderValue(item.expectedNextOrder)}</td><td>${reorderValue(item.suggestedQuantity)}</td><td>${item.reliable ? `<button class="reorder-now" data-customer-id="${data.customer.id}" data-product-id="${item.productId}" type="button">Reorder</button><button class="reminder-now action-btn" data-customer-id="${data.customer.id}" data-product-id="${item.productId}" type="button">Reminder</button>` : '<span class="tag neutral">Insufficient history</span>'}</td></tr>`).join('') || '<tr><td colspan="8">No history available.</td></tr>';
  body.querySelectorAll('.reorder-now').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Create a real order using the suggested quantity?')) return;
    const result = await fetch(`/api/customers/${button.dataset.customerId}/reorder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: Number(button.dataset.productId) }) });
    const created = await result.json();
    if (!result.ok) return alert(created.message || 'Could not create reorder.');
    alert(`Order #${created.id} created.`); await fetchOrders(); await fetchReorderReport();
  }));
  body.querySelectorAll('.reminder-now').forEach((button) => button.addEventListener('click', async () => {
    const result = await fetch(`/api/customers/${button.dataset.customerId}/reorder-reminder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: Number(button.dataset.productId) }) });
    const reminder = await result.json(); alert(reminder.message || 'Reminder action completed.');
  }));
}

async function fetchReorderReport() {
  const response = await fetch('/api/analytics/reorder');
  if (!response.ok) return;
  const data = await response.json();
  const body = document.getElementById('reorderReportBody');
  if (body) body.innerHTML = (data.insights || []).map((item) => `<tr><td>${item.customerName}</td><td>${item.productName}</td><td>${item.reliable ? `${item.orderCount} orders` : `<span class="tag neutral">Insufficient history (${item.orderCount}/${item.minimumOrders})</span>`}</td><td>${reorderValue(item.lastOrder)}</td><td>${reorderValue(item.averageIntervalDays, ' days')}</td><td>${reorderValue(item.expectedNextOrder)}</td><td>${reorderValue(item.suggestedQuantity)}</td><td>${item.reliable && item.reminderEligible ? '<span class="tag warning">Eligible</span>' : '<span class="tag neutral">Not eligible</span>'}</td></tr>`).join('') || '<tr><td colspan="8">No customer product history found.</td></tr>';
  const rule = data.rule || {};
  const lead = document.getElementById('reorderReminderLeadDays'); const buffer = document.getElementById('reorderQuantityBuffer');
  if (lead && document.activeElement !== lead) lead.value = rule.reminder_lead_days ?? 0;
  if (buffer && document.activeElement !== buffer) buffer.value = rule.quantity_buffer_percent ?? 0;
}

async function saveReorderRules() {
  const response = await fetch('/api/reorder-rules', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minimumOrders: 2, reminderLeadDays: Number(document.getElementById('reorderReminderLeadDays').value), quantityBufferPercent: Number(document.getElementById('reorderQuantityBuffer').value), enabled: true }) });
  const data = await response.json();
  document.getElementById('reorderRuleStatus').textContent = response.ok ? 'Reminder rules saved.' : (data.message || 'Could not save rules.');
  if (response.ok) await fetchReorderReport();
}

function complaintStatusLabel(status) { return String(status || '').replaceAll('_', ' '); }

function renderComplaints() {
  const list = document.getElementById('complaintsList');
  const customerSelect = document.getElementById('complaintCustomer');
  if (!list || !customerSelect) return;
  customerSelect.innerHTML = '<option value="">Select customer (optional)</option>' + state.customers.map((customer) => `<option value="${customer.id}">${customer.name}</option>`).join('');
  const isManager = ['super_admin', 'company_admin', 'manager'].includes(state.currentUser?.role);
  list.innerHTML = state.complaints.map((complaint) => {
    const assigneeOptions = '<option value="">Unassigned</option>' + state.complaintAssignees.map((user) => `<option value="${user.id}" ${user.id === complaint.assigned_to ? 'selected' : ''}>${user.name} (${user.role})</option>`).join('');
    const statusOptions = ['open','assigned','in_progress','resolved','closed'].map((status) => `<option value="${status}" ${status === complaint.status ? 'selected' : ''}>${complaintStatusLabel(status)}</option>`).join('');
    return `<article class="complaint-card"><div class="complaint-card-header"><div><span class="tag neutral">#${complaint.id} · ${complaintStatusLabel(complaint.status)} · ${complaint.priority}</span><h3>${complaint.title}</h3><p>${complaint.customer_name || 'No customer linked'} · Created by ${complaint.created_by_name || '-'}</p></div><strong>${complaint.assignee_name || 'Unassigned'}</strong></div><p>${complaint.description}</p>${complaint.resolution ? `<p><strong>Resolution:</strong> ${complaint.resolution}</p>` : ''}${complaint.notes ? `<p><strong>Notes:</strong> ${complaint.notes}</p>` : ''}<div class="complaint-actions"><select class="complaint-assignee" data-id="${complaint.id}" ${isManager ? '' : 'disabled'}>${assigneeOptions}</select><select class="complaint-status" data-id="${complaint.id}" ${isManager ? '' : 'disabled'}>${statusOptions}</select><input class="complaint-resolution" data-id="${complaint.id}" maxlength="5000" placeholder="Resolution (required to resolve)" value="${complaint.resolution || ''}" ${isManager ? '' : 'disabled'} /><textarea class="complaint-note" data-id="${complaint.id}" maxlength="5000" rows="2" placeholder="Add a note"></textarea><button class="complaint-save" data-id="${complaint.id}" type="button">Save changes</button></div></article>`;
  }).join('') || '<p>No complaints found.</p>';
  list.querySelectorAll('.complaint-save').forEach((button) => button.addEventListener('click', async () => {
    const id = button.dataset.id;
    const status = list.querySelector(`.complaint-status[data-id="${id}"]`).value;
    const assignedTo = list.querySelector(`.complaint-assignee[data-id="${id}"]`).value || null;
    const resolution = list.querySelector(`.complaint-resolution[data-id="${id}"]`).value;
    const note = list.querySelector(`.complaint-note[data-id="${id}"]`).value.trim();
    if (status === 'resolved' && !resolution.trim()) return alert('Enter a resolution before resolving a complaint.');
    if (isManager) {
      const response = await fetch(`/api/complaints/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: assignedTo && status === 'open' ? 'assigned' : status, assignedTo, resolution }) });
      const data = await response.json();
      if (!response.ok) return alert(data.message || 'Could not update complaint.');
    }
    if (note) { const noteResponse = await fetch(`/api/complaints/${id}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: note }) }); const noteData = await noteResponse.json(); if (!noteResponse.ok) return alert(noteData.message || 'Could not save note.'); }
    await fetchComplaints();
  }));
}

async function fetchComplaints() {
  const filter = document.getElementById('complaintStatusFilter')?.value || '';
  const queryString = filter ? `?status=${encodeURIComponent(filter)}` : '';
  const [response, assigneeResponse] = await Promise.all([fetch(`/api/complaints${queryString}`), fetch('/api/complaint-assignees')]);
  if (!response.ok) return;
  state.complaints = await response.json();
  state.complaintAssignees = assigneeResponse.ok ? await assigneeResponse.json() : [];
  renderComplaints();
}

function renderVehicles() {
  const body = document.getElementById('vehiclesTableBody');
  const driverSelect = document.getElementById('vehicleDriver');
  if (!body || !driverSelect) return;
  driverSelect.innerHTML = '<option value="">Unassigned driver</option>' + state.drivers.map((driver) => `<option value="${driver.id}">${driver.name} (${driver.role})</option>`).join('');
  body.innerHTML = state.vehicles.map((vehicle) => {
    const compliance = [vehicle.insurance_expiry ? `Insurance: ${vehicle.insurance_expiry}` : '', vehicle.registration_expiry ? `Registration: ${vehicle.registration_expiry}` : '', vehicle.maintenance_date ? `Service: ${vehicle.maintenance_date}` : ''].filter(Boolean).join('<br>') || '-';
    const nextStatus = vehicle.status === 'active' ? 'maintenance' : 'active';
    return `<tr><td><strong>${vehicle.vehicle_number}</strong></td><td>${vehicle.vehicle_type}</td><td>${vehicle.capacity}</td><td>${vehicle.fuel_type}</td><td>${vehicle.mileage}</td><td>${vehicle.driver_name || 'Unassigned'}</td><td>${compliance}</td><td><span class="tag ${vehicle.status === 'active' ? 'success' : 'neutral'}">${vehicle.status}</span></td><td><button class="table-action vehicle-status-btn" data-id="${vehicle.id}" data-status="${nextStatus}" type="button">${vehicle.status === 'active' ? 'Maintenance' : 'Activate'}</button></td></tr>`;
  }).join('') || '<tr><td colspan="9">No vehicles configured.</td></tr>';
  body.querySelectorAll('.vehicle-status-btn').forEach((button) => button.addEventListener('click', async () => {
    const response = await fetch(`/api/vehicles/${button.dataset.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: button.dataset.status }) });
    const data = await response.json();
    if (!response.ok) return alert(data.message || 'Could not update vehicle status.');
    await fetchVehicles();
  }));
}

async function fetchVehicles() {
  const filter = document.getElementById('vehicleStatusFilter')?.value || '';
  const response = await fetch(`/api/vehicles${filter ? `?status=${encodeURIComponent(filter)}` : ''}`);
  if (!response.ok) return;
  state.vehicles = await response.json();
  renderVehicles();
  await fetchFleetExpansion();
}

function renderFleetExpansion(records) {
  const vehicleOptions = state.vehicles.map(v => `<option value="${v.id}">${v.vehicle_number}</option>`).join('');
  ['fleetServiceVehicle','fleetFuelVehicle'].forEach(id => { const select=document.getElementById(id); if(select) select.innerHTML='<option value="">Vehicle</option>'+vehicleOptions; });
  const equipmentBody=document.getElementById('equipmentTableBody');
  if(equipmentBody) equipmentBody.innerHTML=(records.equipment||[]).map(a=>`<tr><td>${a.asset_tag}</td><td>${a.name}</td><td>${a.location||'-'}</td><td>${formatCurrency(a.current_value)}</td><td><span class="tag ${a.status==='active'?'success':'neutral'}">${a.status}</span></td></tr>`).join('')||'<tr><td colspan="5">No equipment assets configured.</td></tr>';
  const serviceBody=document.getElementById('fleetServiceTableBody'); if(serviceBody) serviceBody.innerHTML=(records.services||[]).map(r=>`<tr><td>${r.service_date}</td><td>${r.vehicle_number}</td><td>${r.service_type}</td><td>${r.provider||'-'}</td><td>${formatCurrency(r.cost)}</td></tr>`).join('')||'<tr><td colspan="5">No service records.</td></tr>';
  const fuelBody=document.getElementById('fleetFuelTableBody'); if(fuelBody) fuelBody.innerHTML=(records.fuel||[]).map(r=>`<tr><td>${r.fuel_date}</td><td>${r.vehicle_number}</td><td>${r.quantity}</td><td>${formatCurrency(r.unit_cost)}</td><td>${formatCurrency(r.total_cost)}</td></tr>`).join('')||'<tr><td colspan="5">No fuel logs.</td></tr>';
}
async function fetchFleetExpansion() {
  if (!state.currentUser) return;
  const [equipment, services, fuel, alerts] = await Promise.all([fetch('/api/equipment'), fetch('/api/fleet/service-records'), fetch('/api/fleet/fuel-logs'), fetch('/api/fleet/alerts')]);
  if (!equipment.ok || !services.ok || !fuel.ok) return;
  renderFleetExpansion({ equipment: await equipment.json(), services: await services.json(), fuel: await fuel.json() });
  if (alerts.ok) { const data=await alerts.json(); const items=[...(data.documents||[]).map(d=>`<div class="alert-item"><strong>${d.entity_name}</strong> — ${d.document_type} expires ${d.expires_on}</div>`), ...(data.services||[]).map(s=>`<div class="alert-item"><strong>${s.vehicle_number}</strong> — ${s.service_type} due ${s.next_due_date}</div>`)].join(''); const target=document.getElementById('fleetAlerts'); if(target) target.innerHTML=items||'No upcoming expiries.'; }
}

function renderAttendance() {
  const body=document.getElementById('attendanceTableBody'), select=document.getElementById('attendanceEmployee'); if(!body||!select)return;
  select.innerHTML='<option value="">My linked employee</option>'+state.employees.filter(e=>e.status==='active').map(e=>'<option value="'+e.id+'">'+e.full_name+' ('+e.employee_id+')</option>').join('');
  body.innerHTML=state.attendance.map(a=>'<tr><td>'+a.attendance_date+'</td><td><strong>'+a.full_name+'</strong><br><small>'+a.employee_code+'</small></td><td><span class="tag '+(a.status==='present'?'success':'neutral')+'">'+a.status.replace('_',' ')+'</span></td><td>'+((a.check_in||'').replace('T',' ').slice(0,16)||'-')+'</td><td>'+((a.check_out||'').replace('T',' ').slice(0,16)||'-')+'</td></tr>').join('')||'<tr><td colspan="5">No attendance records found.</td></tr>';
}
async function fetchAttendance(){const start=document.getElementById('attendanceStart')?.value||'',end=document.getElementById('attendanceEnd')?.value||'';const query=new URLSearchParams();if(start)query.set('startDate',start);if(end)query.set('endDate',end);const r=await fetch('/api/attendance?'+query);if(!r.ok)return;state.attendance=await r.json();renderAttendance();}
async function attendanceAction(action){const r=await fetch('/api/attendance/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employeeId:document.getElementById('attendanceEmployee').value||null,date:document.getElementById('attendanceDate').value,status:document.getElementById('attendanceStatus').value})});const d=await r.json();if(!r.ok)return alert(d.message||'Could not record attendance.');await fetchAttendance();}
function renderPayroll(){const body=document.getElementById('payrollTableBody');if(!body)return;body.innerHTML=state.payrollRuns.map(r=>'<tr><td>'+r.period_start+' to '+r.period_end+'</td><td><span class="tag success">'+r.status+'</span></td><td>'+r.payslip_count+'</td><td>'+formatCurrency(r.total_net)+'</td><td>'+((r.created_at||'').replace('T',' ').slice(0,16))+'</td><td><button type="button" class="table-action payslip-btn" data-id="'+r.id+'">View payslips</button></td></tr>').join('')||'<tr><td colspan="6">No payroll runs found.</td></tr>';body.querySelectorAll('.payslip-btn').forEach(b=>b.addEventListener('click',()=>fetchPayslips(b.dataset.id)));}
async function fetchPayroll(){const r=await fetch('/api/payroll/runs');if(!r.ok)return;state.payrollRuns=await r.json();renderPayroll();}
async function fetchPayslips(id){const r=await fetch('/api/payroll/runs/'+id+'/payslips');const d=await r.json();if(!r.ok)return alert(d.message||'Could not load payslips.');document.getElementById('payslipsPanel').classList.remove('hidden');document.getElementById('payslipsTableBody').innerHTML=d.map(p=>'<tr><td>'+p.full_name+'<br><small>'+p.employee_code+'</small></td><td>'+formatCurrency(p.gross_amount)+'</td><td>'+formatCurrency(p.deductions)+'</td><td>'+formatCurrency(p.net_amount)+'</td><td>'+p.payment_status+'</td></tr>').join('');}

function renderEmployees() {
  const body = document.getElementById('employeesTableBody');
  const userSelect = document.getElementById('employeeUser');
  if (!body || !userSelect) return;
  const users = state.users || [];
  userSelect.innerHTML = '<option value="">No login account</option>' + users.map((user) => `<option value="${user.id}">${user.name} (${user.username})</option>`).join('');
  body.innerHTML = state.employees.map((employee) => {
    const nextStatus = employee.status === 'active' ? 'inactive' : 'active';
    const attendance = `${employee.present_days || 0}/${employee.attendance_days || 0} present${employee.leave_days ? ` · ${employee.leave_days} leave` : ''}`;
    return `<tr><td><strong>${employee.employee_id}</strong></td><td>${employee.full_name}</td><td>${employee.department || '-'}<br><small>${employee.role || '-'}</small></td><td>${employee.phone || '-'}<br><small>${employee.email || ''}</small></td><td>${formatCurrency(employee.salary)}</td><td>${attendance}</td><td>${employee.leave_balance || 0}</td><td>${employee.linked_username || 'None'}${employee.is_driver ? ' · Driver' : ''}</td><td><span class="tag ${employee.status === 'active' ? 'success' : 'neutral'}">${employee.status.replace('_', ' ')}</span></td><td><button class="table-action employee-edit-btn" data-id="${employee.id}" type="button">Edit</button> <button class="table-action employee-status-btn" data-id="${employee.id}" data-status="${nextStatus}" type="button">${employee.status === 'active' ? 'Deactivate' : 'Activate'}</button></td></tr>`;
  }).join('') || '<tr><td colspan="10">No employees found.</td></tr>';
  body.querySelectorAll('.employee-status-btn').forEach((button) => button.addEventListener('click', async () => {
    const response = await fetch(`/api/employees/${button.dataset.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: button.dataset.status }) });
    const data = await response.json();
    if (!response.ok) return alert(data.message || 'Could not update employee status.');
    await fetchEmployees();
  }));
  body.querySelectorAll('.employee-edit-btn').forEach((button) => button.addEventListener('click', () => {
    const employee = state.employees.find((item) => item.id === Number(button.dataset.id));
    if (!employee) return;
    document.getElementById('editingEmployeeId').value = employee.id;
    document.getElementById('employeeIdInput').value = employee.employee_id || '';
    document.getElementById('employeeFullName').value = employee.full_name || '';
    document.getElementById('employeeDepartment').value = employee.department || '';
    document.getElementById('employeeRole').value = employee.role || '';
    document.getElementById('employeeSalary').value = employee.salary || 0;
    document.getElementById('employeeUser').value = employee.user_id || '';
    document.getElementById('employeePhone').value = employee.phone || '';
    document.getElementById('employeeEmail').value = employee.email || '';
    document.getElementById('employeeHireDate').value = employee.hire_date || '';
    document.getElementById('employeeAttendanceDays').value = employee.attendance_days || 0;
    document.getElementById('employeePresentDays').value = employee.present_days || 0;
    document.getElementById('employeeLeaveBalance').value = employee.leave_balance || 0;
    document.getElementById('employeeNotes').value = employee.notes || '';
    document.getElementById('employeeStatus').value = employee.status || 'active';
    document.getElementById('employeeSubmitButton').textContent = 'Update employee';
    document.getElementById('cancelEmployeeEdit').classList.remove('hidden');
    document.getElementById('employeeFormPanel').scrollIntoView({ behavior: 'smooth' });
  }));
}

async function fetchEmployees() {
  const filter = document.getElementById('employeeStatusFilter')?.value || '';
  const response = await fetch(`/api/employees${filter ? `?status=${encodeURIComponent(filter)}` : ''}`);
  if (!response.ok) return;
  state.employees = await response.json();
  renderEmployees();
}

async function fetchSuppliers() {
  const response = await fetch('/api/suppliers');
  state.suppliers = await response.json();
  renderSuppliers();
}

async function fetchSales() {
  const response = await fetch('/api/sales');
  state.sales = await response.json();
  renderAllSales();
  renderRecentSales();
}

async function loadInvoice(saleId, print = false) {
  const action = print ? 'print' : 'view';
  const response = await fetch(`/api/sales/${encodeURIComponent(saleId)}/invoice?action=${action}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    alert(data.message || 'Could not load invoice.');
    return;
  }
  state.invoice = data.invoice;
  renderInvoicePreview();
  setActiveTab('sales');
  if (print) printInvoice(state.invoice);
}

function driverStatusLabel(status) {
  return String(status || '').replaceAll('_', ' ');
}

function updateOfflineIndicators(details = {}) {
  const connectivity = document.getElementById('connectivityIndicator');
  const queue = document.getElementById('offlineQueueIndicator');
  const online = details.online === undefined ? navigator.onLine : details.online;
  if (connectivity) {
    connectivity.textContent = online ? 'Online' : 'Offline · queued locally';
    connectivity.classList.toggle('offline', !online);
  }
  if (queue) {
    const pending = Number(details.pending || 0);
    queue.textContent = `${pending} pending`;
    queue.classList.toggle('hidden', pending === 0 && online);
  }
}

function driverActionPayload(data, action) {
  const metadata = (prefix) => data[`${prefix}StorageKey`] ? { storageKey: data[`${prefix}StorageKey`], contentType: data[`${prefix}ContentType`], byteSize: Number(data[`${prefix}ByteSize`]), sha256: data[`${prefix}Sha256`], width: data[`${prefix}Width`] ? Number(data[`${prefix}Width`]) : undefined, height: data[`${prefix}Height`] ? Number(data[`${prefix}Height`]) : undefined } : null;
  return { action, otpChallengeId: data.otpChallengeId || null, otpCode: data.otpCode || '', signature: metadata('signature'), photo: metadata('photo'), bottleId: data.bottleId || null, bottleReturnCount: Number(data.bottleReturnCount || 0), emptyCount: Number(data.emptyCount || 0), notes: String(data.notes || '').trim(), rescheduledFor: data.rescheduledFor || null, payment: { amount: Number(data.amount || 0), method: data.method || '', reference: '' } };
}

function offlineIdempotencyKey() {
  return window.crypto?.randomUUID ? window.crypto.randomUUID() : `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function renderDriverDeliveries() {
  const body = document.getElementById('driverDeliveryList');
  const historyBody = document.getElementById('driverHistoryList');
  if (!body || !historyBody) return;
  const bottleOptions = state.bottles.filter((bottle) => bottle.active).map((bottle) => `<option value="${bottle.id}">${bottle.name}</option>`).join('');
  body.innerHTML = state.driverDeliveries.map((delivery) => {
    const address = delivery.delivery_address || delivery.customer_address || '';
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    return `<article class="driver-card">
      <div class="driver-card-header"><div><span class="tag neutral">#${delivery.id} · ${driverStatusLabel(delivery.status)}</span><h3>${delivery.customer_name}</h3><p>${address || 'No delivery address'}</p></div><strong>${formatCurrency(delivery.total_amount)}</strong></div>
      <div class="driver-contact"><a href="tel:${delivery.customer_phone || ''}" ${delivery.customer_phone ? '' : 'aria-disabled="true"'}>Call ${delivery.customer_phone || 'customer'}</a><a href="${mapUrl}" target="_blank" rel="noopener">Open map</a></div>
      <form class="driver-action-form" data-delivery-id="${delivery.id}">
        <div class="field-row three-col"><input name="amount" type="number" min="0" step="0.01" placeholder="Collected amount" /><select name="method"><option value="">Payment method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select><select name="bottleId"><option value="">Bottle type</option>${bottleOptions}</select></div>
        <div class="field-row three-col"><input name="bottleReturnCount" type="number" min="0" step="1" value="0" placeholder="Returned bottles" /><input name="emptyCount" type="number" min="0" step="1" value="0" placeholder="Empty count" /><input name="rescheduledFor" type="date" /></div>
        <div class="field-row three-col"><input name="otpChallengeId" placeholder="OTP challenge ID" /><input name="otpCode" inputmode="numeric" pattern="\\d{6}" placeholder="Customer OTP (deliver)" /><button type="button" class="action-btn request-otp-btn">Request OTP</button></div>
        <div class="field-row three-col"><input name="signatureStorageKey" placeholder="Signature storage key" /><input name="signatureContentType" value="image/png" placeholder="Signature MIME" /><input name="signatureByteSize" type="number" min="1" placeholder="Signature bytes" /></div>
        <div class="field-row two-col"><input name="signatureSha256" pattern="[a-fA-F0-9]{64}" placeholder="Signature SHA-256" /><input name="photoStorageKey" placeholder="Photo storage key (optional)" /></div>
        <div class="field-row three-col"><input name="photoContentType" value="image/jpeg" placeholder="Photo MIME" /><input name="photoByteSize" type="number" min="1" placeholder="Photo bytes" /><input name="photoSha256" pattern="[a-fA-F0-9]{64}" placeholder="Photo SHA-256" /></div>
        <input name="notes" placeholder="Notes or failure/reschedule reason" />
        <div class="driver-action-buttons"><button type="submit" data-action="start" ${delivery.status === 'out_for_delivery' ? 'disabled' : ''}>Start</button><button type="submit" data-action="deliver">Deliver</button><button type="submit" data-action="fail" class="btn-secondary">Fail</button><button type="submit" data-action="reschedule" class="action-btn">Reschedule</button></div>
      </form>
    </article>`;
  }).join('') || '<div class="panel"><p>No deliveries assigned for this date.</p></div>';
  historyBody.innerHTML = state.driverHistory.map((delivery) => `<div class="history-row"><span>#${delivery.id} ${delivery.customer_name}</span><span>${driverStatusLabel(delivery.status)}</span><span>${delivery.delivered_at || delivery.updated_at || '-'}</span><span>${formatCurrency(delivery.collected_amount)}</span></div>`).join('') || '<p>No completed delivery history.</p>';
  body.querySelectorAll('.driver-action-form').forEach((form) => {
    form.addEventListener('submit', handleDriverAction);
    form.querySelector('.request-otp-btn')?.addEventListener('click', async () => {
      const response = await fetch(`/api/driver/deliveries/${form.dataset.deliveryId}/otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return alert(result.message || 'Could not request OTP.');
      form.elements.otpChallengeId.value = result.challengeId;
      alert(`OTP requested for the customer. Challenge ${result.challengeId} expires in ${Math.round(result.expiresInSeconds / 60)} minutes.`);
    });
  });
}

async function handleDriverAction(event) {
  event.preventDefault();
  const button = event.submitter;
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const action = button?.dataset.action;
  if (action === 'reschedule' && !data.rescheduledFor) return alert('Choose a rescheduled date.');
  if (action === 'fail' && !data.notes.trim()) return alert('Add a failure reason.');
  const payload = driverActionPayload(data, action);
  const delivery = state.driverDeliveries.find((item) => String(item.id) === String(form.dataset.deliveryId));
  if (!delivery) return alert('Delivery is no longer available. Refresh and try again.');
  if (!navigator.onLine) {
    await OfflineDriver.queueAction({ idempotencyKey: offlineIdempotencyKey(), operationType: action, deliveryId: Number(form.dataset.deliveryId), payload, baseUpdatedAt: delivery.updated_at });
    updateOfflineIndicators({ online: false, pending: await OfflineDriver.count() });
    alert('Offline: update saved on this device and will sync automatically.');
    return;
  }
  let response;
  try { response = await fetch(`/api/driver/deliveries/${form.dataset.deliveryId}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
  catch (_) { response = null; }
  if (!response) {
    await OfflineDriver.queueAction({ idempotencyKey: offlineIdempotencyKey(), operationType: action, deliveryId: Number(form.dataset.deliveryId), payload, baseUpdatedAt: delivery.updated_at });
    updateOfflineIndicators({ online: false, pending: await OfflineDriver.count() });
    alert('Connection lost: update saved on this device and will retry.');
    return;
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return alert(result.message || 'Could not update delivery.');
  await fetchDriverMode();
}

async function fetchDriverMode() {
  if (!['driver', 'delivery_driver'].includes(state.currentUser?.role)) return;
  const dateInput = document.getElementById('driverDate');
  const date = dateInput?.value || new Date().toISOString().slice(0, 10);
  if (dateInput && !dateInput.value) dateInput.value = date;
  if (!navigator.onLine) {
    const cached = await OfflineDriver.getCachedDeliveries(date);
    if (cached) { state.driverDeliveries = cached.deliveries || []; state.driverHistory = cached.history || []; renderDriverDeliveries(); }
    updateOfflineIndicators({ online: false, pending: await OfflineDriver.count() });
    return;
  }
  let todayResponse;
  let historyResponse;
  try { [todayResponse, historyResponse] = await Promise.all([fetch(`/api/driver/deliveries?date=${encodeURIComponent(date)}`), fetch('/api/driver/deliveries?history=true')]); } catch (_) { todayResponse = null; historyResponse = null; }
  if (!todayResponse?.ok || !historyResponse?.ok) {
    const cached = await OfflineDriver.getCachedDeliveries(date);
    if (cached) { state.driverDeliveries = cached.deliveries || []; state.driverHistory = cached.history || []; renderDriverDeliveries(); }
    updateOfflineIndicators({ online: false, pending: await OfflineDriver.count() });
    return;
  }
  state.driverDeliveries = await todayResponse.json();
  state.driverHistory = await historyResponse.json();
  await OfflineDriver.cacheDeliveries(date, state.driverDeliveries, state.driverHistory);
  renderDriverDeliveries();
  updateOfflineIndicators({ online: true, pending: await OfflineDriver.count() });
  await fetchRoutes();
}

async function fetchOrders() {
  const [ordersResponse, driversResponse] = await Promise.all([fetch('/api/orders'), fetch('/api/drivers')]);
  state.orders = await ordersResponse.json();
  state.drivers = await driversResponse.json();
  renderOrders();
  populateRouteDrivers();
  await fetchRoutes();
}

function populateRouteDrivers() {
  const select = document.getElementById('routeDriver');
  if (!select) return;
  select.innerHTML = '<option value="">Unassigned</option>' + state.drivers.map((driver) => `<option value="${driver.id}">${driver.name}</option>`).join('');
}

function renderRouteCandidates() {
  const container = document.getElementById('routeCandidateList');
  if (!container) return;
  container.innerHTML = state.routeCandidates.map((delivery) => `<label class="route-candidate"><input type="checkbox" value="${delivery.id}" class="route-delivery-check" /><span><strong>#${delivery.id} · ${delivery.customer_name}</strong><small>${delivery.area || delivery.delivery_address || 'Insufficient location data'}</small></span></label>`).join('') || '<p class="muted-label">No pending deliveries available for routing.</p>';
}

function renderRouteDetail(route, targetId = 'routeDetail') {
  const container = document.getElementById(targetId);
  if (!container || !route) return;
  container.innerHTML = `<div class="route-detail-header"><strong>${route.name}</strong><span>${route.status} · ${route.stop_count || route.stops?.length || 0} stops · ${Number(route.estimated_distance_km || 0).toFixed(1)} km · ${route.estimated_duration_minutes || 0} min</span></div><p class="login-helper">${route.optimization_message || ''}</p><ol class="route-stop-list">${(route.stops || []).map((stop) => `<li data-delivery-id="${stop.delivery_id}"><span><strong>${stop.sequence}. ${stop.customer_name}</strong><small>${stop.area || stop.delivery_address || 'Insufficient location data'} · ${stop.status}</small></span><span>${stop.navigation_url ? `<a href="${stop.navigation_url}" target="_blank" rel="noopener">Navigate</a>` : '<em>No coordinates</em>'}${route.status !== 'completed' ? `<button type="button" class="table-action route-stop-status" data-route-id="${route.id}" data-stop-id="${stop.id}" data-status="${stop.status === 'completed' ? 'pending' : 'completed'}">${stop.status === 'completed' ? 'Undo' : 'Done'}</button>` : ''}</span></li>`).join('')}</ol><button type="button" class="action-btn route-start-btn" data-route-id="${route.id}">Start route</button><button type="button" class="action-btn route-save-order" data-route-id="${route.id}">Save stop order</button>`;
  container.querySelectorAll('.route-stop-status').forEach((button) => button.addEventListener('click', async () => { const response = await fetch(`/api/routes/${button.dataset.routeId}/stops/${button.dataset.stopId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: button.dataset.status }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not update stop.'); renderRouteDetail(data); await fetchRoutes(); }));
  container.querySelectorAll('.route-start-btn').forEach((button) => button.addEventListener('click', async () => { const response = await fetch(`/api/routes/${button.dataset.routeId}/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start' }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not start route.'); renderRouteDetail(data); await fetchRoutes(); }));
  container.querySelectorAll('.route-save-order').forEach((button) => button.addEventListener('click', async () => { const deliveryIds = [...container.querySelectorAll('.route-stop-list li')].map((item) => Number(item.dataset.deliveryId)); const response = await fetch(`/api/routes/${button.dataset.routeId}/reorder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deliveryIds }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not save order.'); renderRouteDetail(data, targetId); await fetchRoutes(); }));
}


function renderRoutes() {
  const container = document.getElementById('routeList');
  if (!container) return;
  container.innerHTML = state.routes.map((route) => `<article class="route-card"><div><strong>${route.name}</strong><p>${route.area || 'Unspecified'} · ${route.status} · ${route.stop_count || 0} stops</p></div><button type="button" class="table-action view-route-btn" data-id="${route.id}">View stops</button></article>`).join('') || '<p class="muted-label">No routes created yet.</p>';
  container.querySelectorAll('.view-route-btn').forEach((button) => button.addEventListener('click', async () => { const response = await fetch(`/api/routes/${button.dataset.id}`); const route = await response.json(); if (response.ok) { state.selectedRoute = route; renderRouteDetail(route); } }));
}

async function fetchRoutes() {
  const date = document.getElementById('routeDate')?.value || '';
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  const [candidateResponse, routeResponse] = await Promise.all([fetch(`/api/routes/candidates${query}`), fetch(`/api/routes${query}`)]);
  if (candidateResponse.ok) { state.routeCandidates = await candidateResponse.json(); renderRouteCandidates(); }
  if (routeResponse.ok) { state.routes = await routeResponse.json(); renderRoutes(); }
  if (['driver', 'delivery_driver'].includes(state.currentUser?.role)) renderDriverRoutes();
}

async function createOptimizedRoute() {
  const deliveryIds = [...document.querySelectorAll('.route-delivery-check:checked')].map((input) => Number(input.value));
  if (!deliveryIds.length) return alert('Select at least one pending delivery.');
  const response = await fetch('/api/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deliveryIds, routeDate: document.getElementById('routeDate').value || null, driverId: document.getElementById('routeDriver').value || null, name: document.getElementById('routeArea').value ? `Route - ${document.getElementById('routeArea').value}` : undefined }) });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not create route.');
  alert(data.optimization_message || 'Route created with deterministic ordering.');
  await fetchRoutes();
}

function renderDriverRoutes() {
  const container = document.getElementById('driverRouteList');
  if (!container) return;
  const mine = state.routes.filter((route) => route.driver_id === state.currentUser?.id);
  container.innerHTML = mine.map((route) => `<article class="route-card"><div><strong>${route.name}</strong><p>${route.route_date || 'No date'} · ${route.status} · ${route.stop_count || 0} stops · ${Number(route.estimated_distance_km || 0).toFixed(1)} km</p></div><button type="button" class="table-action driver-view-route" data-id="${route.id}">View route</button></article>`).join('') || '<p class="muted-label">No assigned optimized routes.</p>';
  container.querySelectorAll('.driver-view-route').forEach((button) => button.addEventListener('click', async () => { const response = await fetch(`/api/routes/${button.dataset.id}`); const route = await response.json(); if (response.ok) renderRouteDetail(route, 'driverRouteList'); }));
}

function renderDeliverySubscriptions() {
  const body = document.getElementById('subscriptionsTableBody');
  if (!body) return;
  body.innerHTML = state.deliverySubscriptions.map((subscription) => `<tr><td>${subscription.customer_name}</td><td>${subscription.product_name} × ${subscription.quantity}</td><td>${subscription.frequency === 'custom' ? `Every ${subscription.custom_interval} ${subscription.custom_unit}` : subscription.frequency.replaceAll('_', ' ')}</td><td>${subscription.next_due_date}</td><td><span class="tag ${subscription.status === 'active' ? 'success' : 'neutral'}">${subscription.status}</span></td><td><button class="table-action subscription-status-btn" data-id="${subscription.id}" data-action="${subscription.status === 'active' ? 'pause' : 'resume'}">${subscription.status === 'active' ? 'Pause' : 'Resume'}</button>${subscription.status === 'active' ? `<button class="table-action subscription-skip-btn" data-id="${subscription.id}">Skip next</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6">No recurring subscriptions yet.</td></tr>';
  body.querySelectorAll('.subscription-status-btn').forEach((button) => button.addEventListener('click', async () => { const response = await fetch(`/api/delivery-subscriptions/${button.dataset.id}/${button.dataset.action}`, { method: 'POST' }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not update subscription.'); await fetchDeliverySubscriptions(); }));
  body.querySelectorAll('.subscription-skip-btn').forEach((button) => button.addEventListener('click', async () => { if (!confirm('Skip the next scheduled delivery?')) return; const response = await fetch(`/api/delivery-subscriptions/${button.dataset.id}/skip`, { method: 'POST' }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not skip delivery.'); await fetchDeliverySubscriptions(); }));
}

async function fetchDeliverySubscriptions() {
  const response = await fetch('/api/delivery-subscriptions');
  if (!response.ok) return;
  state.deliverySubscriptions = await response.json();
  populateSubscriptionSelects();
  const startDate = document.getElementById('subscriptionStartDate');
  if (startDate && !startDate.value) startDate.value = new Date().toISOString().slice(0, 10);
  renderDeliverySubscriptions();
}

function populateSubscriptionSelects() {
  const customerSelect = document.getElementById('subscriptionCustomer');
  const productSelect = document.getElementById('subscriptionProduct');
  if (!customerSelect || !productSelect) return;
  customerSelect.innerHTML = '<option value="">Select customer</option>' + state.customers.map((customer) => `<option value="${customer.id}">${customer.name}</option>`).join('');
  productSelect.innerHTML = '<option value="">Select product</option>' + state.products.map((product) => `<option value="${product.id}" data-price="${product.sale_price}">${product.name} — ${formatCurrency(product.sale_price)}</option>`).join('');
}

function populateOrderSelects() {
  const customerSelect = document.getElementById('orderCustomer');
  const productSelect = document.getElementById('orderProduct');
  const deliveryOrder = document.getElementById('deliveryOrder');
  const driverSelect = document.getElementById('deliveryDriver');
  if (!customerSelect || !productSelect || !deliveryOrder || !driverSelect) return;
  customerSelect.innerHTML = '<option value="">Select customer</option>' + state.customers.map((customer) => `<option value="${customer.id}">${customer.name} (${customer.phone || 'no phone'})</option>`).join('');
  productSelect.innerHTML = state.products.map((product) => `<option value="${product.id}">${product.name} — ${formatCurrency(product.sale_price)}</option>`).join('');
  deliveryOrder.innerHTML = '<option value="">Select order</option>' + state.orders.filter((order) => !['delivered', 'cancelled', 'failed'].includes(order.status)).map((order) => `<option value="${order.id}">#${order.id} ${order.customer_name} — ${formatCurrency(order.total_amount)}</option>`).join('');
  driverSelect.innerHTML = '<option value="">Select driver</option>' + state.drivers.map((driver) => `<option value="${driver.id}">${driver.name} (${driver.role})</option>`).join('');
}

function renderOrders() {
  const body = document.getElementById('ordersTableBody');
  if (!body) return;
  body.innerHTML = state.orders.map((order) => `<tr>
    <td>${order.customer_name}<small>${order.delivery_address || ''}</small></td>
    <td>${order.item_quantity || 0}</td>
    <td>${formatCurrency(order.total_amount)}</td>
    <td><span class="tag neutral">${String(order.status).replaceAll('_', ' ')}</span></td>
    <td>${order.driver_name || '-'}</td>
    <td><select class="order-status-select" data-order-id="${order.id}" aria-label="Update order ${order.id} status">${['pending','confirmed','assigned','out_for_delivery','delivered','partially_delivered','cancelled','failed'].map((status) => `<option value="${status}" ${status === order.status ? 'selected' : ''}>${status.replaceAll('_', ' ')}</option>`).join('')}</select></td>
  </tr>`).join('') || '<tr><td colspan="6">No orders yet.</td></tr>';
  populateOrderSelects();
  document.querySelectorAll('.order-status-select').forEach((select) => select.addEventListener('change', async (event) => {
    const response = await fetch(`/api/orders/${event.target.dataset.orderId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: event.target.value }) });
    const data = await response.json();
    if (!response.ok) return alert(data.message || 'Could not update order status.');
    await fetchOrders();
  }));
}

async function fetchPurchases() {
  const response = await fetch('/api/purchases');
  state.purchases = await response.json();
  renderPurchases();
}

async function fetchExpenses() {
  const response = await fetch('/api/expenses');
  state.expenses = await response.json();
  renderExpenses();
}

async function fetchPayments() {
  const response = await fetch('/api/payments');
  state.payments = await response.json();
  renderPayments();
}

function auditFilterParams(includePaging = true) {
  const params = new URLSearchParams();
  const from = document.getElementById('auditFrom')?.value || '';
  const to = document.getElementById('auditTo')?.value || '';
  const action = document.getElementById('auditAction')?.value.trim() || '';
  const entityType = document.getElementById('auditEntityType')?.value.trim() || '';
  const user = document.getElementById('auditUser')?.value.trim() || '';
  const userId = document.getElementById('auditUserId')?.value || '';
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (action) params.set('action', action);
  if (entityType) params.set('entityType', entityType);
  if (user) params.set('user', user);
  if (userId) params.set('userId', userId);
  if (includePaging) {
    params.set('page', String(state.audit.page));
    params.set('pageSize', String(state.audit.pageSize));
  }
  return params;
}

function redactAuditValue(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactAuditValue);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => /password|token|secret|hash/i.test(key) ? [key, '[redacted]'] : [key, redactAuditValue(item)]));
}

function auditDetails(value) {
  if (!value) return '-';
  try { return JSON.stringify(redactAuditValue(JSON.parse(value))); } catch (_) { return String(value).slice(0, 500); }
}

function renderAuditLogs() {
  const body = document.getElementById('auditLogTableBody');
  if (!body) return;
  body.textContent = '';
  state.audit.logs.forEach((log) => {
    const row = document.createElement('tr');
    [formatDateTime(log.created_at), log.action, log.entity_type, log.entity_id || '-', log.user_name || log.user_username || (log.user_id ? `User #${log.user_id}` : 'System'), auditDetails(log.new_value || log.previous_value)].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
  if (!state.audit.logs.length) body.innerHTML = '<tr><td colspan="6">No audit records match these filters.</td></tr>';
  document.getElementById('auditSummary').textContent = `${state.audit.total} record(s)`;
  document.getElementById('auditPageLabel').textContent = `Page ${state.audit.page} of ${state.audit.totalPages}`;
  document.getElementById('auditPreviousPage').disabled = state.audit.page <= 1;
  document.getElementById('auditNextPage').disabled = state.audit.page >= state.audit.totalPages;
}

async function fetchAuditLogs(page = state.audit.page) {
  if (!state.currentUser || !['super_admin', 'company_admin', 'manager', 'accountant'].includes(state.currentUser.role)) return;
  if (state.currentUser.role === 'super_admin' && !localStorage.getItem(ACTIVE_COMPANY_KEY)) {
    state.audit = { ...state.audit, logs: [], total: 0, page: 1, totalPages: 1 };
    renderAuditLogs();
    return;
  }
  state.audit.page = Math.max(1, page);
  const params = auditFilterParams(true);
  const response = await fetch(`/api/audit-logs?${params.toString()}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return alert(data.message || 'Could not load audit logs.');
  state.audit = { ...state.audit, ...data };
  renderAuditLogs();
}

function profitabilityParams() {
  const type = document.getElementById('reportType')?.value || '';
  const params = new URLSearchParams();
  if (type === 'daily' && document.getElementById('reportDate')?.value) { params.set('type', type); params.set('date', document.getElementById('reportDate').value); }
  if (type === 'monthly' && document.getElementById('reportMonth')?.value) { params.set('type', type); params.set('month', document.getElementById('reportMonth').value); }
  if (type === 'annual' && document.getElementById('reportYear')?.value) { params.set('type', type); params.set('year', document.getElementById('reportYear').value); }
  return params;
}

async function fetchProfitability() {
  const query = profitabilityParams().toString();
  const [summaryResponse, customerResponse, routeResponse] = await Promise.all([
    fetch(`/api/analytics/profitability${query ? `?${query}` : ''}`),
    fetch(`/api/analytics/customer-profitability${query ? `?${query}` : ''}`),
    fetch(`/api/analytics/route-profitability${query ? `?${query}` : ''}`)
  ]);
  const summary = await summaryResponse.json().catch(() => ({}));
  const customers = await customerResponse.json().catch(() => ({}));
  const routes = await routeResponse.json().catch(() => ({}));
  if (!summaryResponse.ok) return alert(summary.message || 'Could not load profitability analytics.');
  state.profitability = { ...summary, customers: customers.rows || [], routes: routes.rows || [], methodology: [summary.summary?.methodology, customers.methodology, routes.methodology].filter(Boolean).join(' ') };
  renderProfitability();
}

function renderProfitability() {
  const summary = state.profitability.summary || {};
  const setText = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
  setText('profitabilityGrossProfit', formatCurrency(summary.grossProfit));
  setText('profitabilityNetProfit', formatCurrency(summary.netProfit));
  setText('profitabilityCogs', formatCurrency(summary.cogs));
  setText('profitabilityExpenses', formatCurrency(summary.operatingExpenses));
  setText('profitabilityGrossMargin', `${Number(summary.grossMarginPercent || 0).toFixed(2)}% margin`);
  setText('profitabilityNetMargin', `${Number(summary.netMarginPercent || 0).toFixed(2)}% margin`);
  setText('profitabilityMethodology', state.profitability.methodology || 'No profitability data available for this period.');
  const fill = (id, rows, columns, empty) => { const body = document.getElementById(id); if (!body) return; body.textContent = ''; if (!rows.length) { const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = columns.length; cell.textContent = empty; row.appendChild(cell); body.appendChild(row); return; } rows.forEach((entry) => { const row = document.createElement('tr'); columns.forEach((column) => { const cell = document.createElement('td'); cell.textContent = String(column(entry)); row.appendChild(cell); }); body.appendChild(row); }); };
  fill('customerProfitabilityBody', state.profitability.customers || [], [r => r.customer, r => formatCurrency(r.revenue), r => formatCurrency(r.cogs), r => formatCurrency(r.gross_profit), r => `${r.gross_margin_percent}%`], 'No customer profitability data.');
  fill('routeProfitabilityBody', state.profitability.routes || [], [r => r.name || `Route #${r.route_id}`, r => r.deliveries, r => formatCurrency(r.revenue), r => formatCurrency(r.cogs), r => formatCurrency(r.gross_profit)], 'No route profitability data.');
}

async function fetchSystemHealth() {
  try {
    const [healthResponse, readinessResponse] = await Promise.all([nativeFetch('/api/health'), nativeFetch('/api/readiness')]);
    const health = await healthResponse.json().catch(() => ({})); const readiness = await readinessResponse.json().catch(() => ({}));
    document.getElementById('healthStatus')?.replaceChildren(document.createTextNode(health.status || 'unavailable'));
    document.getElementById('healthUptime')?.replaceChildren(document.createTextNode(`${health.uptimeSeconds || 0}s uptime`));
    document.getElementById('readinessStatus')?.replaceChildren(document.createTextNode(readiness.ready ? 'ready' : 'not ready'));
  } catch (_) { document.getElementById('healthStatus')?.replaceChildren(document.createTextNode('unavailable')); }
}
async function fetchReportDefinitions() {
  const response = await fetch('/api/report-definitions'); const rows = await response.json().catch(() => []); const body = document.getElementById('reportDefinitionsBody'); if (!body) return;
  body.replaceChildren(); if (!response.ok || !rows.length) { const row = document.createElement('tr'); row.innerHTML = '<td colspan="4">No saved reports.</td>'; body.appendChild(row); return; }
  rows.forEach((definition) => { const row = document.createElement('tr'); [definition.name, definition.source, formatDateTime(definition.updated_at)].forEach((value) => { const cell = document.createElement('td'); cell.textContent = String(value || ''); row.appendChild(cell); }); const actions = document.createElement('td'); const run = document.createElement('button'); run.className = 'action-btn run-report-definition'; run.dataset.reportId = definition.id; run.type = 'button'; run.textContent = 'Run'; const csv = document.createElement('a'); csv.className = 'action-btn'; csv.href = `/api/report-definitions/${encodeURIComponent(definition.id)}/export`; csv.target = '_blank'; csv.rel = 'noreferrer'; csv.textContent = 'CSV'; actions.append(run, document.createTextNode(' '), csv); row.appendChild(actions); body.appendChild(row); });
}
async function saveReportDefinition() {
  const name = document.getElementById('reportDefinitionName')?.value.trim(); const source = document.getElementById('reportDefinitionSource')?.value; const filterField = document.getElementById('reportDefinitionFilterField')?.value; const filterValue = document.getElementById('reportDefinitionFilterValue')?.value.trim(); const groupBy = document.getElementById('reportDefinitionGroupBy')?.value; const status = document.getElementById('reportDefinitionStatus');
  const filters = filterField && filterValue ? [{ field: filterField, operator: 'contains', value: filterValue }] : [];
  const response = await fetch('/api/report-definitions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, source, filters, groupBy: groupBy || null, fields: [] }) }); const data = await response.json().catch(() => ({})); if (status) status.textContent = response.ok ? 'Saved.' : (data.message || 'Unable to save.'); if (response.ok) { document.getElementById('reportDefinitionName').value = ''; await fetchReportDefinitions(); }
}
async function fetchReports() {
  const params = profitabilityParams();
  const response = await fetch(`/api/reports${params.toString() ? `?${params.toString()}` : ''}`);
  const data = await response.json();
  state.reports = data;
  renderReports();
  if (state.currentUser && ['super_admin', 'company_admin', 'manager', 'accountant'].includes(state.currentUser.role)) await fetchProfitability();
}

const forecastRoles = ['super_admin', 'company_admin', 'manager', 'accountant'];

function populateForecastProducts() {
  const select = document.getElementById('forecastProduct');
  if (!select) return;
  const selected = select.value;
  select.innerHTML = '<option value="">All products</option>';
  state.products.forEach((product) => {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = product.name;
    select.appendChild(option);
  });
  select.value = selected;
}

function renderForecast(data) {
  const panel = document.getElementById('forecastingPanel');
  if (!panel) return;
  panel.classList.toggle('hidden', !state.currentUser || !forecastRoles.includes(state.currentUser.role));
  if (!data) return;
  const status = document.getElementById('forecastStatus');
  const body = document.getElementById('forecastTableBody');
  status.textContent = data.reliable ? 'Forecast generated from recorded history.' : (data.message || 'Not enough historical data for reliable forecasting.');
  status.classList.toggle('forecast-warning', !data.reliable);
  document.getElementById('forecastValue').textContent = data.reliable ? `${Number(data.forecast?.[0]?.value || 0).toLocaleString()} ${data.metric}` : '—';
  document.getElementById('forecastConfidence').textContent = data.reliable ? `${data.confidence}%` : '—';
  document.getElementById('forecastWindow').textContent = data.dataWindow?.from && data.dataWindow?.to ? `${data.dataWindow.from} to ${data.dataWindow.to}` : '—';
  const sources = data.sourceCounts || {};
  document.getElementById('forecastSources').textContent = `${sources.sales || 0} sales · ${sources.orders || 0} orders · ${sources.subscriptions || 0} subscriptions`;
  document.getElementById('forecastExplanation').textContent = data.reliable ? `${data.explanation} Data periods: ${data.periods.length}.` : '';
  body.replaceChildren();
  if (!data.reliable || !data.forecast?.length) {
    const row = document.createElement('tr');
    row.innerHTML = `<td colspan="3">${data.message || 'No forecast available.'}</td>`;
    body.appendChild(row);
    return;
  }
  data.forecast.forEach((entry) => {
    const row = document.createElement('tr');
    [entry.period, `${Number(entry.value).toLocaleString()} ${data.metric}`, data.method].forEach((value) => {
      const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
    });
    body.appendChild(row);
  });
}

async function fetchForecast() {
  const panel = document.getElementById('forecastingPanel');
  if (!panel || !state.currentUser || !forecastRoles.includes(state.currentUser.role)) return;
  const params = new URLSearchParams({ metric: document.getElementById('forecastMetric').value, horizon: document.getElementById('forecastHorizon').value });
  const productId = document.getElementById('forecastProduct').value;
  if (productId) params.set('productId', productId);
  const response = await fetch(`/api/analytics/forecast?${params.toString()}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return alert(data.message || 'Could not generate forecast.');
  state.forecast = data;
  renderForecast(data);
}

function renderLowStock() {
  const list = document.getElementById('lowStockList');
  list.innerHTML = '';

  if (!state.lowStock.length) {
    list.innerHTML = '<li>No low stock items.</li>';
    return;
  }

  state.lowStock.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = `${item.name} (${item.stock} left)`;
    list.appendChild(li);
  });
}

function renderProducts() {
  populateForecastProducts();
  const tbody = document.getElementById('productTableBody');
  tbody.innerHTML = '';

  state.products.forEach((product) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${product.name}</td>
      <td>${product.category || 'General'}</td>
      <td>${formatCurrency(product.purchase_price)}</td>
      <td>${formatCurrency(product.sale_price)}</td>
      <td>${product.stock}</td>
      <td><button class="table-action edit-product-btn" type="button" data-product-id="${product.id}">Edit</button></td>
    `;
    tbody.appendChild(row);
  });

  document.querySelectorAll('.edit-product-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const product = state.products.find((item) => item.id === Number(button.dataset.productId));
      if (!product) return;

      document.getElementById('editingProductId').value = product.id;
      document.getElementById('productName').value = product.name;
      document.getElementById('productCategory').value = product.category || '';
      document.getElementById('purchasePrice').value = product.purchase_price;
      document.getElementById('salePrice').value = product.sale_price;
      document.getElementById('productStock').value = product.stock;
      document.getElementById('productFormTitle').textContent = 'Edit Product';
      document.getElementById('productSubmitButton').textContent = 'Update Product';
      document.getElementById('cancelProductEdit').classList.remove('hidden');
      document.getElementById('productName').focus();
    });
  });
}

function resetProductForm() {
  document.getElementById('productForm').reset();
  document.getElementById('editingProductId').value = '';
  document.getElementById('productFormTitle').textContent = 'Add Product';
  document.getElementById('productSubmitButton').textContent = 'Save Product';
  document.getElementById('cancelProductEdit').classList.add('hidden');
}

function appendSaleRow(tbody, sale, withAction = false) {
  const row = document.createElement('tr');
  [sale.customer_name, formatCurrency(sale.total_amount), formatDate(sale.created_at)].forEach((value) => {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.appendChild(cell);
  });
  if (withAction) {
    const actionCell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'table-action invoice-action-btn';
    button.textContent = 'View / Print';
    button.addEventListener('click', () => loadInvoice(sale.id));
    actionCell.appendChild(button);
    row.appendChild(actionCell);
  }
  tbody.appendChild(row);
}

function renderRecentSales() {
  const tbody = document.getElementById('salesTableBody');
  if (!tbody) return;
  tbody.replaceChildren();

  const sales = state.recentSales || state.sales.slice(0, 5);
  sales.forEach((sale) => appendSaleRow(tbody, sale));
}

function renderAllSales() {
  const tbody = document.getElementById('allSalesTableBody');
  if (!tbody) return;
  tbody.replaceChildren();

  state.sales.forEach((sale) => appendSaleRow(tbody, sale, true));
}

const qrEntityLabels = { customer: 'Customer', bottle: 'Bottle', product: 'Product', order: 'Order', delivery: 'Delivery' };

function qrEntitiesForType(type) {
  const source = { customer: state.customers, bottle: state.bottles, product: state.products, order: state.orders, delivery: state.orders.flatMap((order) => order.delivery_id ? [{ id: order.delivery_id, customer_name: order.customer_name }] : []) }[type] || [];
  return source.map((item) => ({ id: item.id, label: item.name || item.customer_name || `#${item.id}` }));
}

function populateQrEntitySelect() {
  const type = document.getElementById('qrEntityType')?.value;
  const select = document.getElementById('qrEntityId');
  if (!select) return;
  select.innerHTML = '<option value="">Select record</option>' + qrEntitiesForType(type).map((item) => `<option value="${item.id}">${item.label} (#${item.id})</option>`).join('');
}

function printQrRecord(record) {
  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (!popup) return alert('Allow pop-ups to print a QR label.');
  popup.document.write(`<html><head><title>QR ${record.entity_type} #${record.entity_id}</title><style>body{font-family:Arial;text-align:center;padding:30px}img{width:280px;height:280px}small{display:block;margin:12px}</style></head><body><h2>${qrEntityLabels[record.entity_type]} #${record.entity_id}</h2><img src="${record.image_data_url}" alt="QR code"><small>${record.payload}</small><script>window.onload=()=>window.print()<\/script></body></html>`);
  popup.document.close();
}

function renderQrRecords() {
  const body = document.getElementById('qrRecordTableBody');
  if (!body) return;
  document.getElementById('qrRecordSummary').textContent = `${state.qrRecords.length} records`;
  body.innerHTML = state.qrRecords.map((record) => `<tr><td>${qrEntityLabels[record.entity_type] || record.entity_type}</td><td>${record.entity?.name || record.entity?.customer_name || `#${record.entity_id}`}</td><td><span class="tag ${record.status === 'active' ? 'success' : 'neutral'}">${record.status}</span></td><td>${record.created_at}</td><td><button type="button" class="table-action qr-print" data-id="${record.id}">Print</button><button type="button" class="table-action qr-lookup" data-key="${record.qr_key}">Lookup</button></td></tr>`).join('') || '<tr><td colspan="5">No QR records generated yet.</td></tr>';
  body.querySelectorAll('.qr-print').forEach((button) => button.addEventListener('click', () => printQrRecord(state.qrRecords.find((record) => record.id === Number(button.dataset.id)))));
  body.querySelectorAll('.qr-lookup').forEach((button) => button.addEventListener('click', async () => { const response = await fetch(`/api/qr-lookup/${encodeURIComponent(button.dataset.key)}`); const data = await response.json(); if (!response.ok) return alert(data.message || 'Lookup failed.'); alert(`Authorized lookup: ${qrEntityLabels[data.entity_type]} #${data.entity_id}`); await fetchQrHistory(); }));
}

async function fetchQrRecords() {
  const response = await fetch('/api/qr-records');
  if (!response.ok) return;
  state.qrRecords = await response.json();
  renderQrRecords();
  populateQrEntitySelect();
}

async function fetchQrHistory() {
  const response = await fetch('/api/qr-lookup-history?pageSize=50');
  if (!response.ok) return;
  const data = await response.json();
  state.qrHistory = data.rows || [];
  const body = document.getElementById('qrHistoryTableBody');
  if (body) body.innerHTML = state.qrHistory.map((row) => `<tr><td>${row.created_at}</td><td>${qrEntityLabels[row.entity_type] || row.entity_type}</td><td>#${row.entity_id}</td><td>${row.user_name || '-'}</td><td>${row.result}</td></tr>`).join('') || '<tr><td colspan="5">No authorized lookups yet.</td></tr>';
}

function renderCustomers() {
  const tbody = document.getElementById('customerTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  state.customers.forEach((customer) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${customer.name}</td>
      <td>${customer.phone || '-'}</td>
      <td>${customer.address || '-'}</td>
      <td><button class="customer-reorder" data-customer-id="${customer.id}" type="button">View insights</button></td>
    `;
    tbody.appendChild(row);
  });
  tbody.querySelectorAll('.customer-reorder').forEach((button) => button.addEventListener('click', () => openCustomerReorder(button.dataset.customerId)));
  populateBottleSelects();
}

function renderSuppliers() {
  const tbody = document.getElementById('supplierTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  state.suppliers.forEach((supplier) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${supplier.name}</td>
      <td>${supplier.phone || '-'}</td>
      <td>${supplier.address || '-'}</td>
    `;
    tbody.appendChild(row);
  });
}

function renderPurchases() {
  const tbody = document.getElementById('purchaseTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  state.purchases.forEach((purchase) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${purchase.supplier_name}</td>
      <td>${formatCurrency(purchase.total_amount)}</td>
      <td>${formatDate(purchase.created_at)}</td>
    `;
    tbody.appendChild(row);
  });
}

function renderExpenses() {
  const tbody = document.getElementById('expenseTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  state.expenses.forEach((expense) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${expense.title}</td>
      <td>${expense.category || 'Other'}</td>
      <td>${formatCurrency(expense.amount)}</td>
      <td>${formatDate(expense.created_at)}</td>
    `;
    tbody.appendChild(row);
  });
}

function renderPayments() {
  const tbody = document.getElementById('paymentTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  state.payments.forEach((payment) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${payment.customer_name}</td>
      <td>${payment.method || 'Cash'}</td>
      <td>${formatCurrency(payment.amount)}</td>
      <td>${formatDate(payment.created_at)}</td>
    `;
    tbody.appendChild(row);
  });
}

function populateSaleProductSelect() {
  const select = document.getElementById('saleProduct');
  if (!select) return;
  select.innerHTML = '';

  state.products.forEach((product) => {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = `${product.name} (${product.stock})`;
    select.appendChild(option);
  });
}

function populatePurchaseProductSelect() {
  const select = document.getElementById('purchaseProduct');
  if (!select) return;
  select.innerHTML = '';

  state.products.forEach((product) => {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = `${product.name}`;
    select.appendChild(option);
  });
}

function renderReports() {
  const salesList = document.getElementById('salesReportList');
  const expenseList = document.getElementById('expenseReportList');
  const paymentList = document.getElementById('paymentReportList');
  if (!salesList || !expenseList || !paymentList) return;

  const totals = state.reports.totals || {};
  const selectedPeriod = state.reports.filter?.startDate || state.reports.filter?.endDate;
  const hasPeriodData = !selectedPeriod || [
    state.reports.salesReport,
    state.reports.purchasesReport,
    state.reports.expensesReport,
    state.reports.customerReport,
    state.reports.monthlyReport,
    state.reports.supplierReport,
    state.reports.paymentReport
  ].some((report) => report && report.length);
  const noDataMessage = document.getElementById('reportNoData');
  noDataMessage.classList.toggle('hidden', hasPeriodData);

  document.getElementById('reportRevenue').textContent = formatCurrency(totals.revenue);
  document.getElementById('reportProfit').textContent = formatCurrency(Number(totals.revenue || 0) - Number(totals.purchases || 0) - Number(totals.expenses || 0));
  document.getElementById('reportInventoryCost').textContent = formatCurrency(totals.inventoryCost);
  document.getElementById('reportInventoryRetail').textContent = formatCurrency(totals.inventoryRetail);
  document.getElementById('reportPayments').textContent = formatCurrency(totals.payments);

  const fillTable = (id, rows, columns, emptyText) => {
    const body = document.getElementById(id);
    body.innerHTML = '';
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${columns.length}">${emptyText}</td></tr>`;
      return;
    }
    rows.forEach((entry) => {
      const row = document.createElement('tr');
      row.innerHTML = columns.map((column) => `<td>${column(entry)}</td>`).join('');
      body.appendChild(row);
    });
  };

  fillTable('monthlyReportBody', state.reports.monthlyReport || [], [
    (entry) => entry.month,
    (entry) => formatCurrency(entry.sales),
    (entry) => formatCurrency(Number(entry.purchases || 0) + Number(entry.expenses || 0)),
    (entry) => formatCurrency(Number(entry.sales || 0) - Number(entry.purchases || 0) - Number(entry.expenses || 0))
  ], 'No monthly data yet.');
  fillTable('customerReportBody', state.reports.customerReport || [], [
    (entry) => entry.customer,
    (entry) => entry.orders,
    (entry) => formatCurrency(entry.total)
  ], 'No customer sales yet.');
  const inventoryRows = selectedPeriod
    ? (state.reports.inventoryReport || []).filter((entry) => Number(entry.purchased_units || 0) > 0 || Number(entry.sold_units || 0) > 0)
    : (state.reports.inventoryReport || []);
  fillTable('inventoryReportBody', inventoryRows, [
    (entry) => entry.name,
    (entry) => entry.stock,
    (entry) => formatCurrency(entry.cost_value),
    (entry) => formatCurrency(entry.retail_value)
  ], 'No inventory data yet.');
  fillTable('supplierReportBody', state.reports.supplierReport || [], [
    (entry) => entry.supplier,
    (entry) => entry.orders,
    (entry) => formatCurrency(entry.total)
  ], 'No supplier purchases yet.');

  salesList.innerHTML = '';
  if (state.reports.salesReport && state.reports.salesReport.length) {
    state.reports.salesReport.forEach((entry) => {
      const li = document.createElement('li');
      li.textContent = `${entry.date}: ${formatCurrency(entry.total)}`;
      salesList.appendChild(li);
    });
  } else {
    salesList.innerHTML = '<li>No sales data yet.</li>';
  }

  expenseList.innerHTML = '';
  if (state.reports.expensesReport && state.reports.expensesReport.length) {
    state.reports.expensesReport.forEach((entry) => {
      const li = document.createElement('li');
      li.textContent = `${entry.category}: ${formatCurrency(entry.total)}`;
      expenseList.appendChild(li);
    });
  } else {
    expenseList.innerHTML = '<li>No expense data yet.</li>';
  }

  paymentList.innerHTML = '';
  if (state.reports.paymentReport && state.reports.paymentReport.length) {
    state.reports.paymentReport.forEach((entry) => {
      const li = document.createElement('li');
      li.textContent = `${entry.method || 'Cash'} (${entry.transactions}): ${formatCurrency(entry.total)}`;
      paymentList.appendChild(li);
    });
  } else {
    paymentList.innerHTML = '<li>No payment data yet.</li>';
  }
}

function renderInvoicePreview() {
  const emptyBox = document.getElementById('invoicePreviewEmpty');
  const previewBox = document.getElementById('invoicePreview');
  const rows = document.getElementById('invoiceDetailBody');

  if (!rows || !emptyBox || !previewBox) return;

  if (!state.invoice) {
    emptyBox.classList.remove('hidden');
    previewBox.classList.add('hidden');
    return;
  }

  const invoice = state.invoice;
  emptyBox.classList.add('hidden');
  previewBox.classList.remove('hidden');
  document.getElementById('invoiceCompanyName').textContent = invoice.company_name || 'Company';
  document.getElementById('invoiceCompanyContact').textContent = [invoice.company_phone, invoice.company_email].filter(Boolean).join(' · ');
  document.getElementById('invoiceNumber').textContent = invoice.invoice_number;
  document.getElementById('invoiceDate').textContent = formatDate(invoice.created_at);
  document.getElementById('invoiceCustomer').textContent = invoice.customer_name;
  document.getElementById('invoiceCustomerContact').textContent = [invoice.customer_phone, invoice.customer_address].filter(Boolean).join(' · ');
  document.getElementById('invoiceTotal').textContent = formatCurrency(invoice.total_amount);

  rows.replaceChildren();
  invoice.items.forEach((item) => {
    const row = document.createElement('tr');
    [item.product_name, item.quantity, formatCurrency(item.unit_price), formatCurrency(item.total_price)].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    });
    rows.appendChild(row);
  });
}

function escapeInvoiceHtml(value) {
  return String(value ?? '').replace(/[&<>\"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[character]));
}

function printInvoice(invoice) {
  if (!invoice) return;
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow pop-ups to print or save this invoice as PDF.');
    return;
  }
  const rows = invoice.items.map((item) => `<tr><td>${escapeInvoiceHtml(item.product_name)}</td><td>${escapeInvoiceHtml(item.quantity)}</td><td>${escapeInvoiceHtml(formatCurrency(item.unit_price))}</td><td>${escapeInvoiceHtml(formatCurrency(item.total_price))}</td></tr>`).join('');
  printWindow.document.write(`<!doctype html><html><head><title>${escapeInvoiceHtml(invoice.invoice_number)}</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:0;padding:32px}main{max-width:820px;margin:auto}.head{display:flex;justify-content:space-between;border-bottom:2px solid #177e89;padding-bottom:20px}.muted{color:#637083}table{width:100%;border-collapse:collapse;margin-top:28px}th,td{text-align:left;padding:10px;border-bottom:1px solid #dce3ea}th{background:#f1f6f8}.total{text-align:right;font-size:20px;font-weight:700;margin-top:20px}@media print{body{padding:0}}</style></head><body><main><div class="head"><div><h1>${escapeInvoiceHtml(invoice.company_name || 'Company')}</h1><p class="muted">${escapeInvoiceHtml([invoice.company_phone, invoice.company_email, invoice.company_address].filter(Boolean).join(' · '))}</p><h2>Invoice</h2></div><div><p><strong>Invoice #:</strong> ${escapeInvoiceHtml(invoice.invoice_number)}</p><p><strong>Date:</strong> ${escapeInvoiceHtml(formatDate(invoice.created_at))}</p></div></div><p><strong>Bill to:</strong> ${escapeInvoiceHtml(invoice.customer_name)}<br><span class="muted">${escapeInvoiceHtml([invoice.customer_phone, invoice.customer_address].filter(Boolean).join(' · '))}</span></p><table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><p class="total">Total: ${escapeInvoiceHtml(formatCurrency(invoice.total_amount))}</p></main></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
}

document.getElementById('printInvoiceBtn').addEventListener('click', async () => {
  if (!state.invoice) return;
  const response = await fetch(`/api/sales/${encodeURIComponent(state.invoice.id)}/invoice?action=print`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return alert(data.message || 'Could not prepare invoice for printing.');
  printInvoice(data.invoice);
});

document.querySelectorAll('.nav-btn').forEach((button) => {
  if (button.dataset.tab) {
    button.addEventListener('click', async () => {
      if (button.dataset.tab === 'franchiseManagement') {
        if (!state.franchise?.authorized) return;
        setActiveTab(button.dataset.tab);
        await ensureFranchiseManagementLoaded();
        return;
      }
      setActiveTab(button.dataset.tab);
    });
  }
});

document.getElementById('topbarExportBtn')?.addEventListener('click', () => {
  setActiveTab('reports');
  document.getElementById('exportControls')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelectorAll('[data-delivery-action]').forEach((button) => {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await handleDeliveryAction(button.dataset.deliveryAction);
    } catch (error) {
      console.error('Delivery action failed:', error);
      alert('Unable to open this delivery tool right now.');
    } finally {
      button.disabled = false;
    }
  });
});

const trackboardDate = document.getElementById('trackboardDate');
if (trackboardDate) {
  trackboardDate.textContent = `Today, ${new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date())}`;
}

document.querySelectorAll('.report-tab').forEach((button) => {
  button.addEventListener('click', () => {
    const view = button.dataset.reportView;
    document.querySelectorAll('.report-tab').forEach((tab) => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.report-view-panel').forEach((panel) => {
      panel.classList.toggle('hidden', view !== 'all' && panel.dataset.reportViewPanel !== view);
    });
  });
});

function updateReportFilterFields() {
  const type = document.getElementById('reportType').value;
  document.getElementById('dailyFilter').classList.toggle('hidden', type !== 'daily');
  document.getElementById('monthlyFilter').classList.toggle('hidden', type !== 'monthly');
  document.getElementById('annualFilter').classList.toggle('hidden', type !== 'annual');
}

document.getElementById('reportType').addEventListener('change', updateReportFilterFields);
document.getElementById('applyReportFilter').addEventListener('click', async () => {
  const type = document.getElementById('reportType').value;
  const selectedValue = type === 'daily'
    ? document.getElementById('reportDate').value
    : type === 'monthly'
      ? document.getElementById('reportMonth').value
      : document.getElementById('reportYear').value;

  if (!selectedValue) {
    alert(`Please select a period for the ${type} report first.`);
    return;
  }
  await fetchReports();
});
document.getElementById('clearReportFilter').addEventListener('click', async () => {
  document.getElementById('reportDate').value = '';
  document.getElementById('reportMonth').value = '';
  document.getElementById('reportYear').value = '';
  await fetchReports();
});
document.getElementById('refreshProfitability')?.addEventListener('click', fetchProfitability);
document.getElementById('exportProfitability')?.addEventListener('click', async () => {
  const query = profitabilityParams(); query.set('report', 'summary');
  const response = await fetch(`/api/analytics/profitability/export?${query.toString()}`);
  if (!response.ok) { const data = await response.json().catch(() => ({})); return alert(data.message || 'Could not export profitability.'); }
  const blob = await response.blob(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'profitability-summary.csv'; link.click(); URL.revokeObjectURL(link.href);
});
document.getElementById('refreshSystemHealth')?.addEventListener('click', fetchSystemHealth);
document.getElementById('refreshReportDefinitions')?.addEventListener('click', fetchReportDefinitions);
document.getElementById('saveReportDefinition')?.addEventListener('click', saveReportDefinition);
document.getElementById('reportDefinitionsBody')?.addEventListener('click', async (event) => { const button = event.target.closest('.run-report-definition'); if (!button) return; const response = await fetch(`/api/report-definitions/${encodeURIComponent(button.dataset.reportId)}/run`, { method: 'POST' }); const data = await response.json().catch(() => ({})); if (!response.ok) return alert(data.message || 'Unable to run report.'); alert(`Report returned ${data.rows?.length || 0} rows.`); });
if (isLoggedIn()) { fetchSystemHealth(); fetchReportDefinitions(); }

updateReportFilterFields();
populateForecastProducts();
document.getElementById('generateForecast')?.addEventListener('click', fetchForecast);
document.getElementById('refreshReorderAnalytics')?.addEventListener('click', fetchReorderReport);
document.getElementById('refreshReorderReport')?.addEventListener('click', fetchReorderReport);
document.getElementById('saveReorderRules')?.addEventListener('click', saveReorderRules);
document.getElementById('closeCustomerReorder')?.addEventListener('click', () => document.getElementById('customerReorderPanel').classList.add('hidden'));

if (state.currentUser && forecastRoles.includes(state.currentUser.role)) renderForecast({ reliable: false, message: 'Select Generate forecast to use recorded history.' });

document.getElementById('applyAuditFilters')?.addEventListener('click', () => fetchAuditLogs(1));
document.getElementById('clearAuditFilters')?.addEventListener('click', () => {
  ['auditFrom', 'auditTo', 'auditAction', 'auditEntityType', 'auditUser', 'auditUserId'].forEach((id) => { document.getElementById(id).value = ''; });
  fetchAuditLogs(1);
});
document.getElementById('auditPreviousPage')?.addEventListener('click', () => fetchAuditLogs(state.audit.page - 1));
document.getElementById('auditNextPage')?.addEventListener('click', () => fetchAuditLogs(state.audit.page + 1));
document.getElementById('exportAuditCsv')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try { await downloadFile(`/api/audit-logs/export?${auditFilterParams(false).toString()}`, 'audit-logs-export.csv'); }
  catch (error) { alert(error.message); }
  finally { button.disabled = false; }
});

async function downloadFile(url, fallbackName) {
  const response = await fetch(url);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'Download failed.');
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/i);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = match ? match[1] : fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

document.querySelectorAll('.export-btn').forEach((button) => button.addEventListener('click', async () => {
  const params = new URLSearchParams();
  const from = document.getElementById('exportFrom').value;
  const to = document.getElementById('exportTo').value;
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  button.disabled = true;
  try { await downloadFile(`/api/exports/${button.dataset.exportResource}?${params.toString()}`, `${button.dataset.exportResource}-export.csv`); }
  catch (error) { alert(error.message); }
  finally { button.disabled = false; }
}));

document.getElementById('downloadBackupBtn')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (!confirm('Create and download a current SQLite backup?')) return;
  button.disabled = true;
  try { await downloadFile('/api/backup', 'aquaflow-backup.db'); }
  catch (error) { alert(error.message); }
  finally { button.disabled = false; }
});

document.getElementById('analyticsType').addEventListener('change', updateAnalyticsFields);
document.getElementById('applyAnalyticsFilter').addEventListener('click', fetchAnalytics);
updateAnalyticsFields();

document.getElementById('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(data.code === 'subscription_inactive' ? `${data.message}\nPlease contact your administrator for renewal.` : (data.message || 'Login failed'));
      return;
    }
    localStorage.setItem(LOGIN_TOKEN_KEY, data.token);
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(data.user));
    if (data.user.role !== 'super_admin') localStorage.setItem(ACTIVE_COMPANY_KEY, String(data.user.companyId));
    state.currentUser = data.user;
    localStorage.setItem(LANGUAGE_KEY, data.user.language || 'en');
    applyLanguage(data.user.language || 'en');
    if (data.user.mustChangePassword) {
      showPasswordChangeScreen();
      return;
    }
    showMainApp();
    await initializeApp();
  } catch (error) {
    console.error('Login request failed:', error);
    alert('Login server is unavailable. Please start the ERP server and try again.');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('passwordChangeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/me/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentPassword: document.getElementById('currentPassword').value,
      newPassword: document.getElementById('newPassword').value,
      confirmPassword: document.getElementById('confirmNewPassword').value
    })
  });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not change password.');
  state.currentUser.mustChangePassword = false;
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(state.currentUser));
  document.getElementById('passwordChangeForm').reset();
  showMainApp();
  await initializeApp();
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  fetch('/api/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem(LOGIN_TOKEN_KEY);
  localStorage.removeItem(CURRENT_USER_KEY);
  localStorage.removeItem(ACTIVE_COMPANY_KEY);
  state.currentUser = null;
  showLoginScreen();
});

document.getElementById('signupLink').addEventListener('click', (event) => {
  event.preventDefault();
  document.getElementById('loginOverlay').classList.add('hidden');
  document.getElementById('signupOverlay').classList.remove('hidden');
});

document.getElementById('backToLoginFromSignup').addEventListener('click', () => showLoginScreen());
document.getElementById('forgotPasswordLink').addEventListener('click', (event) => {
  event.preventDefault();
  document.getElementById('loginOverlay').classList.add('hidden');
  document.getElementById('resetOverlay').classList.remove('hidden');
});
document.getElementById('backToLoginFromReset').addEventListener('click', () => showLoginScreen());

document.getElementById('signupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyName: document.getElementById('signupCompanyName').value,
      ownerName: document.getElementById('signupOwnerName').value,
      email: document.getElementById('signupEmail').value,
      phone: document.getElementById('signupPhone').value,
      username: document.getElementById('signupUsername').value,
      country: document.getElementById('signupCountry').value,
      address: document.getElementById('signupAddress').value,
      password: document.getElementById('signupPassword').value,
      confirmPassword: document.getElementById('signupConfirmPassword').value,
      language: localStorage.getItem(LANGUAGE_KEY) || 'en'
    })
  });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not create account.');
  localStorage.setItem(LOGIN_TOKEN_KEY, data.token);
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(data.user));
  localStorage.setItem(ACTIVE_COMPANY_KEY, String(data.user.companyId));
  state.currentUser = data.user;
  localStorage.setItem(LANGUAGE_KEY, data.user.language || 'en');
  applyLanguage(data.user.language || 'en');
  showMainApp();
  await initializeApp();
});

document.getElementById('forgotForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: document.getElementById('forgotIdentifier').value })
  });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not create reset token.');
  if (data.resetToken) {
    document.getElementById('resetToken').value = data.resetToken;
    document.getElementById('forgotForm').classList.add('hidden');
    document.getElementById('resetForm').classList.remove('hidden');
    document.getElementById('resetHelper').textContent = 'A reset token was created for this account.';
  } else alert(data.message);
});

document.getElementById('resetForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: document.getElementById('resetToken').value, password: document.getElementById('resetPassword').value, confirmPassword: document.getElementById('resetConfirmPassword').value })
  });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not reset password.');
  alert(data.message);
  showLoginScreen();
});

document.getElementById('companySwitcher').addEventListener('change', async (event) => {
  if (!event.target.value) {
    localStorage.removeItem(ACTIVE_COMPANY_KEY);
  } else {
    localStorage.setItem(ACTIVE_COMPANY_KEY, event.target.value);
  }
  await initializeApp();
});

document.getElementById('companyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/admin/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: document.getElementById('companyName').value,
      companyCode: document.getElementById('companyCode').value,
      logo: document.getElementById('companyLogo').value,
      country: document.getElementById('companyCountry').value,
      phone: document.getElementById('companyPhone').value,
      email: document.getElementById('companyEmail').value,
      address: document.getElementById('companyAddress').value,
      plan: document.getElementById('companyPlan').value,
      status: document.getElementById('companySubscriptionStatus').value,
      startDate: document.getElementById('companyStartDate').value,
      expiryDate: document.getElementById('companyExpiryDate').value,
      adminName: document.getElementById('companyAdminName').value,
      adminUsername: document.getElementById('companyAdminUsername').value,
      adminPassword: document.getElementById('companyAdminPassword').value
    })
  });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not create company.');
  document.getElementById('companyForm').reset();
  await fetchCompanies();
});

document.getElementById('userForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const companyId = state.currentUser?.role === 'super_admin'
    ? localStorage.getItem(ACTIVE_COMPANY_KEY)
    : state.currentUser?.companyId;
  if (!companyId) return alert('Select a company before creating a user.');
  const response = await fetch(`/api/companies/${companyId}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: document.getElementById('userName').value,
      username: document.getElementById('userUsername').value,
      password: document.getElementById('userPassword').value,
      role: document.getElementById('userRole').value
    })
  });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not create user.');
  document.getElementById('userForm').reset();
  await fetchUsers(companyId);
});

document.getElementById('companySettingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/company', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: document.getElementById('settingsCompanyName').value,
      logo: document.getElementById('settingsCompanyLogo').value,
      phone: document.getElementById('settingsCompanyPhone').value,
      email: document.getElementById('settingsCompanyEmail').value,
      address: document.getElementById('settingsCompanyAddress').value,
      customDomain: document.getElementById('settingsCompanyDomain').value,
      subdomain: document.getElementById('settingsCompanySubdomain').value,
      supportEmail: document.getElementById('settingsCompanySupportEmail').value,
      faviconUrl: document.getElementById('settingsCompanyFavicon').value,
      theme: {
        primary: document.getElementById('settingsThemePrimary').value,
        accent: document.getElementById('settingsThemeAccent').value,
        background: document.getElementById('settingsThemeBackground').value
      },
      defaultLanguage: document.getElementById('settingsCompanyLanguage').value,
      dateFormat: document.getElementById('settingsDateFormat').value
    })
  });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not save company settings.');
  state.currentUser.companyName = data.name;
  applyDateFormat(data.date_format || document.getElementById('settingsDateFormat').value);
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(state.currentUser));
  alert('Company settings saved.');
});

document.getElementById('refreshTenantUsage')?.addEventListener('click', fetchTenantUsage);
document.getElementById('refreshRenewalRequests')?.addEventListener('click', fetchAdminRenewalRequests);
document.getElementById('refreshPaymentProofs')?.addEventListener('click', fetchAdminPaymentProofs);

document.getElementById('subscriptionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const companyId = localStorage.getItem(ACTIVE_COMPANY_KEY);
  if (!companyId) return alert('Select a company first.');
  const response = await fetch(`/api/companies/${companyId}/subscription`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      planId: document.getElementById('subscriptionPlan').value,
      status: document.getElementById('subscriptionStatus').value,
      startDate: document.getElementById('subscriptionStart').value,
      endDate: document.getElementById('subscriptionEnd').value,
      price: document.getElementById('subscriptionPrice').value
    })
  });

  document.getElementById('renewSubscriptionBtn')?.addEventListener('click', async () => {
    const companyId = localStorage.getItem(ACTIVE_COMPANY_KEY);
    if (!companyId) return alert('Select a company first.');
    const response = await fetch(`/api/companies/${companyId}/subscription/renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        billingCycle: document.getElementById('subscriptionBillingCycle').value,
        price: document.getElementById('subscriptionPrice').value,
        recordPayment: Number(document.getElementById('subscriptionPaymentAmount').value || 0) > 0,
        amountPaid: document.getElementById('subscriptionPaymentAmount').value,
        paymentMethod: document.getElementById('subscriptionPaymentMethod').value,
        paymentReference: document.getElementById('subscriptionPaymentReference').value,
        paymentStatus: 'paid'
      })
    });
    const data = await response.json();
    if (!response.ok) return alert(data.message || 'Could not renew subscription.');
    await fetchCompanies();
    await fetchSelectedSubscription(companyId);
    alert('Subscription renewed.');
  });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not update subscription.');
  await fetchCompanies();
  await fetchSelectedSubscription(companyId);
  alert('Subscription updated.');
});

document.getElementById('downloadSubscriptionInvoice')?.addEventListener('click', async () => {
  const response = await fetch('/api/subscription/invoice.pdf');
  if (!response.ok) return alert('Could not download the subscription invoice.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'subscription-invoice.pdf';
  link.click();
  URL.revokeObjectURL(url);
});

document.getElementById('renewalRequestForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const period = document.getElementById('renewalRequestPeriod').value;
  const response = await fetch('/api/subscription/renewal-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestedPeriod: period, requestedDays: period === 'custom' ? Number(document.getElementById('renewalRequestDays').value) : undefined, notes: document.getElementById('renewalRequestNote').value }) });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not submit renewal request.');
  document.getElementById('renewalRequestNote').value = '';
  await fetchBillingWorkspace();
  alert('Renewal request submitted.');
});

document.getElementById('renewalRequestPeriod')?.addEventListener('change', (event) => {
  document.getElementById('renewalRequestDays')?.classList.toggle('hidden', event.target.value !== 'custom');
});

document.getElementById('paymentProofForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = document.getElementById('paymentProofFile').files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) return alert('Payment proof must be 10 MB or smaller.');
  const dataBase64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',').pop()); reader.onerror = reject; reader.readAsDataURL(file); });
  const response = await fetch('/api/subscription/payment-proofs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, contentType: file.type, dataBase64 }) });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not upload payment proof.');
  document.getElementById('paymentProofFile').value = '';
  await fetchBillingWorkspace();
  alert('Payment proof submitted for review.');
});

document.getElementById('productForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    name: document.getElementById('productName').value,
    category: document.getElementById('productCategory').value,
    purchasePrice: document.getElementById('purchasePrice').value,
    salePrice: document.getElementById('salePrice').value,
    stock: document.getElementById('productStock').value
  };

  const productId = document.getElementById('editingProductId').value;
  const response = await fetch(productId ? `/api/products/${productId}` : '/api/products', {
    method: productId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    alert(data.message || 'Could not add product');
    return;
  }

  resetProductForm();
  await fetchProducts();
  await fetchDashboard();
});

document.getElementById('cancelProductEdit').addEventListener('click', resetProductForm);

document.getElementById('saleForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const selectedProductId = Number(document.getElementById('saleProduct').value);
  const selectedProduct = state.products.find((product) => product.id === selectedProductId);
  const quantity = Number(document.getElementById('saleQty').value);

  const payload = {
    customerName: document.getElementById('customerName').value,
    items: [{
      productId: selectedProductId,
      quantity
    }]
  };

  const response = await fetch('/api/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    alert(data.message || 'Could not create sale');
    return;
  }

  await loadInvoice(data.id);

  document.getElementById('saleForm').reset();
  document.getElementById('saleQty').value = 1;
  await fetchProducts();
  await fetchSales();
  await fetchDashboard();
  await fetchReports();
});

document.getElementById('customerForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    name: document.getElementById('customerNameInput').value,
    phone: document.getElementById('customerPhone').value,
    address: document.getElementById('customerAddress').value,
    area: document.getElementById('customerArea').value,
    latitude: document.getElementById('customerLatitude').value,
    longitude: document.getElementById('customerLongitude').value
  };

  const response = await fetch('/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    alert(data.message || 'Could not add customer');
    return;
  }

  document.getElementById('customerForm').reset();
  await fetchCustomers();
  await fetchDashboard();
});

document.getElementById('complaintForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/complaints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: document.getElementById('complaintTitle').value, description: document.getElementById('complaintDescription').value, priority: document.getElementById('complaintPriority').value, customerId: document.getElementById('complaintCustomer').value || null }) });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not create complaint.');
  event.target.reset();
  await fetchComplaints();
});

document.getElementById('refreshComplaints').addEventListener('click', fetchComplaints);
document.getElementById('complaintStatusFilter').addEventListener('change', fetchComplaints);

document.getElementById('vehicleForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/vehicles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    vehicleNumber: document.getElementById('vehicleNumber').value,
    registration: document.getElementById('vehicleRegistration').value,
    vehicleType: document.getElementById('vehicleType').value,
    capacity: document.getElementById('vehicleCapacity').value,
    fuelType: document.getElementById('vehicleFuelType').value,
    mileage: document.getElementById('vehicleMileage').value,
    maintenanceDate: document.getElementById('vehicleMaintenanceDate').value || null,
    insuranceExpiry: document.getElementById('vehicleInsuranceExpiry').value || null,
    registrationExpiry: document.getElementById('vehicleRegistrationExpiry').value || null,
    serviceHistory: document.getElementById('vehicleServiceHistory').value,
    status: document.getElementById('vehicleStatus').value,
    driverId: document.getElementById('vehicleDriver').value || null
  }) });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not add vehicle.');
  event.target.reset();
  document.getElementById('vehicleMileage').value = '0';
  await fetchVehicles();
});

document.getElementById('refreshVehicles').addEventListener('click', fetchVehicles);
document.getElementById('vehicleStatusFilter').addEventListener('change', fetchVehicles);
document.getElementById('refreshFleetExpansion')?.addEventListener('click', fetchFleetExpansion);
document.getElementById('refreshFleetAlerts')?.addEventListener('click', fetchFleetExpansion);
document.getElementById('fleetServiceForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/fleet/service-records', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ vehicleId:document.getElementById('fleetServiceVehicle').value, serviceDate:document.getElementById('fleetServiceDate').value, serviceType:document.getElementById('fleetServiceType').value, odometer:document.getElementById('fleetServiceOdometer').value, cost:document.getElementById('fleetServiceCost').value, provider:document.getElementById('fleetServiceProvider').value }) });
  const data=await response.json(); if(!response.ok)return alert(data.message||'Could not record service.'); event.target.reset(); await fetchVehicles();
});
document.getElementById('fleetFuelForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/fleet/fuel-logs', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ vehicleId:document.getElementById('fleetFuelVehicle').value, fuelDate:document.getElementById('fleetFuelDate').value, quantity:document.getElementById('fleetFuelQuantity').value, unitCost:document.getElementById('fleetFuelUnitCost').value, odometer:document.getElementById('fleetFuelOdometer').value, station:document.getElementById('fleetFuelStation').value }) });
  const data=await response.json(); if(!response.ok)return alert(data.message||'Could not record fuel.'); event.target.reset(); await fetchVehicles();
});
document.getElementById('equipmentForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/equipment', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ assetTag:document.getElementById('equipmentTag').value, name:document.getElementById('equipmentName').value, assetType:document.getElementById('equipmentType').value, serialNumber:document.getElementById('equipmentSerial').value, location:document.getElementById('equipmentLocation').value, purchaseDate:document.getElementById('equipmentPurchaseDate').value||null, purchaseCost:document.getElementById('equipmentCost').value||0, currentValue:document.getElementById('equipmentValue').value||document.getElementById('equipmentCost').value||0, status:document.getElementById('equipmentStatus').value }) });
  const data=await response.json(); if(!response.ok)return alert(data.message||'Could not add equipment.'); event.target.reset(); await fetchFleetExpansion();
});

function resetEmployeeForm() {
  document.getElementById('employeeForm').reset();
  document.getElementById('editingEmployeeId').value = '';
  document.getElementById('employeeSalary').value = '0';
  document.getElementById('employeeAttendanceDays').value = '0';
  document.getElementById('employeePresentDays').value = '0';
  document.getElementById('employeeLeaveBalance').value = '0';
  document.getElementById('employeeSubmitButton').textContent = 'Save employee';
  document.getElementById('cancelEmployeeEdit').classList.add('hidden');
}

document.getElementById('employeeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const employeeId = document.getElementById('editingEmployeeId').value;
  const selectedDateFormat = document.getElementById('settingsDateFormat')?.value || displayDateFormat || 'YYYY-MM-DD';
  const response = await fetch(employeeId ? `/api/employees/${employeeId}` : '/api/employees', { method: employeeId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    employeeId: document.getElementById('employeeIdInput').value,
    fullName: document.getElementById('employeeFullName').value,
    department: document.getElementById('employeeDepartment').value,
    role: document.getElementById('employeeRole').value,
    salary: document.getElementById('employeeSalary').value,
    userId: document.getElementById('employeeUser').value || null,
    phone: document.getElementById('employeePhone').value,
    email: document.getElementById('employeeEmail').value,
    hireDate: normalizeDateForStorage(document.getElementById('employeeHireDate').value || null, selectedDateFormat),
    attendanceDays: document.getElementById('employeeAttendanceDays').value,
    presentDays: document.getElementById('employeePresentDays').value,
    leaveBalance: document.getElementById('employeeLeaveBalance').value,
    notes: document.getElementById('employeeNotes').value,
    status: document.getElementById('employeeStatus').value
  }) });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not save employee.');
  resetEmployeeForm();
  await fetchEmployees();
});

document.getElementById('cancelEmployeeEdit').addEventListener('click', resetEmployeeForm);
document.getElementById('refreshEmployees').addEventListener('click', fetchEmployees);
document.getElementById('employeeStatusFilter').addEventListener('change', fetchEmployees);

document.getElementById('supplierForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    name: document.getElementById('supplierNameInput').value,
    phone: document.getElementById('supplierPhone').value,
    address: document.getElementById('supplierAddress').value
  };

  const response = await fetch('/api/suppliers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    alert(data.message || 'Could not add supplier');
    return;
  }

  document.getElementById('supplierForm').reset();
  await fetchSuppliers();
  await fetchDashboard();
});

document.getElementById('purchaseForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    supplierName: document.getElementById('supplierName').value,
    items: [{
      productId: Number(document.getElementById('purchaseProduct').value),
      quantity: Number(document.getElementById('purchaseQty').value),
      unitPrice: Number(document.getElementById('purchaseUnitPrice').value)
    }]
  };

  const response = await fetch('/api/purchases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    alert(data.message || 'Could not create purchase');
    return;
  }

  document.getElementById('purchaseForm').reset();
  document.getElementById('purchaseQty').value = 1;
  await fetchProducts();
  await fetchPurchases();
  await fetchDashboard();
});

document.getElementById('expenseForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    title: document.getElementById('expenseTitle').value,
    category: document.getElementById('expenseCategory').value,
    amount: document.getElementById('expenseAmount').value
  };

  const response = await fetch('/api/expenses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    alert(data.message || 'Could not add expense');
    return;
  }

  document.getElementById('expenseForm').reset();
  await fetchExpenses();
  await fetchDashboard();
  await fetchReports();
});

document.getElementById('paymentForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    customerName: document.getElementById('paymentCustomer').value,
    supplierName: document.getElementById('paymentSupplier').value,
    method: document.getElementById('paymentMethod').value,
    amount: document.getElementById('paymentAmount').value,
    note: document.getElementById('paymentNote').value,
    direction: document.getElementById('paymentDirection').value,
    partyType: document.getElementById('paymentPartyType').value,
    reference: document.getElementById('paymentReference').value,
    dueDate: document.getElementById('paymentDueDate').value
  };

  const response = await fetch('/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    alert(data.message || 'Could not save payment');
    return;
  }

  document.getElementById('paymentForm').reset();
  await fetchPayments();
});

document.getElementById('subscriptionProduct').addEventListener('change', (event) => {
  const selected = event.target.selectedOptions[0];
  const price = document.getElementById('subscriptionPrice');
  if (selected?.dataset.price && !price.value) price.value = selected.dataset.price;
});
document.getElementById('subscriptionFrequency').addEventListener('change', (event) => document.getElementById('customFrequencyFields').classList.toggle('hidden', event.target.value !== 'custom'));
document.getElementById('deliverySubscriptionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const frequency = document.getElementById('subscriptionFrequency').value;
  const response = await fetch('/api/delivery-subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    customerId: Number(document.getElementById('subscriptionCustomer').value), productId: Number(document.getElementById('subscriptionProduct').value), quantity: Number(document.getElementById('subscriptionQuantity').value), unitPrice: document.getElementById('subscriptionPrice').value || undefined, frequency, customInterval: Number(document.getElementById('subscriptionCustomInterval').value), customUnit: document.getElementById('subscriptionCustomUnit').value, startDate: document.getElementById('subscriptionStartDate').value, endDate: document.getElementById('subscriptionEndDate').value || null, deliveryAddress: document.getElementById('subscriptionAddress').value, notes: document.getElementById('subscriptionNotes').value
  }) });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not create subscription.');
  event.target.reset();
  document.getElementById('subscriptionFrequency').value = 'weekly';
  document.getElementById('customFrequencyFields').classList.add('hidden');
  await fetchDeliverySubscriptions();
});
document.getElementById('refreshSubscriptions').addEventListener('click', fetchDeliverySubscriptions);
document.getElementById('generateSubscriptionOrders').addEventListener('click', async () => {
  const response = await fetch('/api/delivery-subscriptions/generate-due', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not generate due orders.');
  alert(`${data.count} due order(s) generated.`);
  await Promise.all([fetchDeliverySubscriptions(), fetchOrders()]);
});

document.getElementById('orderForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId: Number(document.getElementById('orderCustomer').value),
      customerName: document.getElementById('orderCustomer').selectedOptions[0]?.textContent || '',
      deliveryAddress: document.getElementById('orderAddress').value,
      notes: document.getElementById('orderNotes').value,
      items: [{ productId: Number(document.getElementById('orderProduct').value), quantity: Number(document.getElementById('orderQuantity').value) }]
    })
  });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not create order.');
  event.target.reset();
  document.getElementById('orderQuantity').value = 1;
  await fetchOrders();
});

document.getElementById('deliveryForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const orderId = document.getElementById('deliveryOrder').value;
  const response = await fetch(`/api/orders/${orderId}/delivery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId: Number(document.getElementById('deliveryDriver').value), notes: document.getElementById('deliveryNotes').value })
  });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not assign delivery.');
  event.target.reset();
  await fetchOrders();
});

document.getElementById('refreshOrders').addEventListener('click', fetchOrders);
document.getElementById('qrEntityType')?.addEventListener('change', populateQrEntitySelect);
document.getElementById('refreshQrRecords')?.addEventListener('click', fetchQrRecords);
document.getElementById('refreshQrHistory')?.addEventListener('click', fetchQrHistory);
document.getElementById('qrGenerateForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/qr-records/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entityType: document.getElementById('qrEntityType').value, entityId: document.getElementById('qrEntityId').value }) });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not generate QR.');
  await fetchQrRecords();
  printQrRecord(data);
});
async function fetchDeliveryHeatmap() {
  const response = await fetch('/api/analytics/delivery-heatmap');
  const data = await response.json().catch(() => ({}));
  const status = document.getElementById('heatmapStatus');
  const container = document.getElementById('deliveryHeatmap');
  if (!response.ok || !data.available) {
    if (status) status.textContent = data.message || 'Delivery heatmap unavailable.';
    if (container) container.innerHTML = '<p class="muted">No recorded coordinates are available. Map data is not invented.</p>';
    return;
  }
  if (status) status.textContent = `${data.geocodedDeliveries} of ${data.totalDeliveries} deliveries use recorded coordinates.`;
  if (container) container.innerHTML = data.points.map((point) => `<article class="heatmap-point"><strong>${point.intensity} delivery${point.intensity === 1 ? '' : 'ies'}</strong><span>${Number(point.latitude).toFixed(4)}, ${Number(point.longitude).toFixed(4)}</span><small>${point.deliveries.map((delivery) => `#${delivery.id} · ${escapeInvoiceHtml(delivery.customerName || '')}`).join('<br>')}</small></article>`).join('') || '<p class="muted">No mapped deliveries.</p>';
}

async function fetchWhatsAppWorkspace() {
  const [configResponse, conversationsResponse] = await Promise.all([fetch('/api/whatsapp/config'), fetch('/api/whatsapp/conversations')]);
  const config = await configResponse.json().catch(() => ({}));
  const conversations = await conversationsResponse.json().catch(() => []);
  const status = document.getElementById('whatsappProviderStatus');
  if (status) status.textContent = config.status === 'configured' ? `Provider configured: ${config.provider}` : 'Provider not configured. Inbound/outbound WhatsApp transport is unavailable until a company adapter is configured.';
  const container = document.getElementById('whatsappConversations');
  if (container && conversationsResponse.ok) container.innerHTML = conversations.map((row) => `<div class="assistant-action"><span><strong>${escapeInvoiceHtml(row.customer_name)}</strong> · ${escapeInvoiceHtml(row.status)}</span><small class="muted">${row.message_count} message(s) · ${escapeInvoiceHtml(row.last_intent || 'unknown')}</small></div>`).join('') || '<p class="muted">No WhatsApp conversations recorded.</p>';
}

document.getElementById('refreshRoutes')?.addEventListener('click', fetchRoutes);
document.getElementById('refreshHeatmap')?.addEventListener('click', fetchDeliveryHeatmap);
document.getElementById('refreshWhatsApp')?.addEventListener('click', fetchWhatsAppWorkspace);
document.getElementById('routeDate')?.addEventListener('change', fetchRoutes);
document.getElementById('createRoute')?.addEventListener('click', createOptimizedRoute);
document.getElementById('refreshDriverMode')?.addEventListener('click', fetchDriverMode);
document.getElementById('refreshDriverHistory')?.addEventListener('click', fetchDriverMode);
document.getElementById('driverDate')?.addEventListener('change', fetchDriverMode);

document.getElementById('bottleForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/bottles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: document.getElementById('bottleName').value,
      code: document.getElementById('bottleCode').value,
      capacityLitres: document.getElementById('bottleCapacity').value,
      bottleType: document.getElementById('bottleType').value,
      bottleIdentifier: document.getElementById('bottleIdentifier').value,
      barcode: document.getElementById('bottleBarcode').value,
      qrCode: document.getElementById('bottleQrCode').value
    })
  });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not save bottle type.');
  event.target.reset();
  await fetchBottles();
});

document.getElementById('bottleMovementForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/bottle-movements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bottleId: document.getElementById('bottleMovementBottle').value,
      movementType: document.getElementById('bottleMovementType').value,
      customerId: document.getElementById('bottleMovementCustomer').value || null,
      driverId: document.getElementById('bottleMovementDriver').value || null,
      quantity: document.getElementById('bottleMovementQuantity').value,
      reference: document.getElementById('bottleMovementReference').value
    })
  });
  const data = await response.json();
  if (!response.ok) return alert(data.message || 'Could not save bottle movement.');
  event.target.reset();
  await fetchBottles();
});

document.getElementById('bottleMovementType').addEventListener('change', (event) => {
  const customer = document.getElementById('bottleMovementCustomer');
  const driver = document.getElementById('bottleMovementDriver');
  customer.required = ['dispatched', 'returned'].includes(event.target.value);
  driver.required = ['driver_dispatched', 'driver_returned'].includes(event.target.value);
  if (customer.required) driver.value = '';
  if (driver.required) customer.value = '';
});


document.getElementById('checkInButton')?.addEventListener('click',()=>attendanceAction('check-in'));
document.getElementById('checkOutButton')?.addEventListener('click',()=>attendanceAction('check-out'));
document.getElementById('refreshAttendance')?.addEventListener('click',fetchAttendance);
document.getElementById('attendanceStart')?.addEventListener('change',fetchAttendance);document.getElementById('attendanceEnd')?.addEventListener('change',fetchAttendance);
document.getElementById('payrollForm')?.addEventListener('submit',async e=>{e.preventDefault();const r=await fetch('/api/payroll/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({periodStart:document.getElementById('payrollStart').value,periodEnd:document.getElementById('payrollEnd').value,notes:document.getElementById('payrollNotes').value})});const d=await r.json();if(!r.ok)return alert(d.message||'Could not run payroll.');e.target.reset();await fetchPayroll();});
document.getElementById('refreshPayroll')?.addEventListener('click',fetchPayroll);document.getElementById('closePayslips')?.addEventListener('click',()=>document.getElementById('payslipsPanel').classList.add('hidden'));

function territoryOptions(level, includeBlank = true) {
  const rows = state.territories.filter((item) => item.active && (!level || item.level === level));
  return (includeBlank ? '<option value="">Select territory</option>' : '') + rows.map((item) => `<option value="${item.id}">${item.name} (${item.level})</option>`).join('');
}

function renderTerritories() {
  const body = document.getElementById('territoryTableBody'); if (!body) return;
  const filter = String(document.getElementById('territoryFilter')?.value || '').toLowerCase();
  const rows = state.territories.filter((item) => !filter || `${item.name} ${item.level} ${item.parent_name || ''}`.toLowerCase().includes(filter));
  body.innerHTML = rows.map((item) => `<tr><td>${item.level}</td><td><strong>${item.name}</strong><br><small>${item.code || ''}</small></td><td>${item.parent_name || '-'}</td><td>${item.customer_count || 0}</td><td>${item.driver_count || 0}</td><td>${item.active ? 'Active' : 'Inactive'}</td><td><button type="button" class="table-action territory-toggle" data-id="${item.id}" data-active="${item.active ? 0 : 1}">${item.active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('') || '<tr><td colspan="7">No territory records.</td></tr>';
  body.querySelectorAll('.territory-toggle').forEach((button) => button.addEventListener('click', async () => { const response = await fetch(`/api/territories/${button.dataset.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: Number(button.dataset.active) }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not update territory.'); await fetchTerritories(); }));
  ['Countries', 'Cities', 'Areas', 'Zones'].forEach((label) => { const element = document.getElementById(`territory${label}`); if (element) element.textContent = state.territories.filter((item) => item.active && (label === 'Zones' ? ['zone','sector','route'].includes(item.level) : item.level === label.slice(0, -1).toLowerCase())).length; });
  const parentSelect = document.getElementById('territoryParent'); const level = document.getElementById('territoryLevel')?.value; const parentLevel = { city: 'country', area: 'city', zone: 'area', sector: 'zone', route: 'sector' }[level]; if (parentSelect) parentSelect.innerHTML = territoryOptions(parentLevel, true);
  const customerArea = document.getElementById('territoryCustomerArea'); const driverArea = document.getElementById('territoryDriverArea'); if (customerArea) customerArea.innerHTML = territoryOptions(null, true); if (driverArea) driverArea.innerHTML = territoryOptions(null, true);
}

async function fetchTerritories() {
  const [territoryResponse, assignmentResponse, summaryResponse] = await Promise.all([fetch('/api/territories'), fetch('/api/territories/assignments'), fetch('/api/dashboard/territories')]);
  if (territoryResponse.ok) state.territories = await territoryResponse.json();
  if (assignmentResponse.ok) state.territoryAssignments = await assignmentResponse.json();
  if (summaryResponse.ok) { const data = await summaryResponse.json(); const body = document.getElementById('territorySummaryBody'); if (body) body.innerHTML = (data.summary || []).map((item) => `<tr><td>${item.name}</td><td>${item.level}</td><td>${item.customers || 0}</td><td>${item.drivers || 0}</td><td>${item.orders || 0}</td><td>${formatCurrency(item.order_value)}</td></tr>`).join('') || '<tr><td colspan="6">No area activity yet.</td></tr>'; }
  const customer = document.getElementById('territoryCustomer'); const driver = document.getElementById('territoryDriver'); if (customer) customer.innerHTML = '<option value="">Customer</option>' + (state.territoryAssignments.customers || []).map((item) => `<option value="${item.id}">${item.name}</option>`).join(''); if (driver) driver.innerHTML = '<option value="">Driver</option>' + (state.territoryAssignments.drivers || []).filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index).map((item) => `<option value="${item.id}">${item.name} (${item.role})</option>`).join(''); renderTerritories();
}

document.getElementById('territoryLevel')?.addEventListener('change', renderTerritories);
document.getElementById('territoryFilter')?.addEventListener('input', renderTerritories);
document.getElementById('refreshTerritories')?.addEventListener('click', fetchTerritories);
document.getElementById('territoryForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/territories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: document.getElementById('territoryLevel').value, parentId: document.getElementById('territoryParent').value || null, name: document.getElementById('territoryName').value, code: document.getElementById('territoryCode').value }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not create territory.'); event.target.reset(); await fetchTerritories(); });
document.getElementById('assignTerritoryCustomer')?.addEventListener('click', async () => { const customerId = document.getElementById('territoryCustomer').value; const serviceAreaId = document.getElementById('territoryCustomerArea').value; if (!customerId || !serviceAreaId) return alert('Select a customer and territory.'); const response = await fetch(`/api/territories/customers/${customerId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serviceAreaId }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not assign customer.'); await fetchTerritories(); });
document.getElementById('assignTerritoryDriver')?.addEventListener('click', async () => { const driverId = document.getElementById('territoryDriver').value; const serviceAreaId = document.getElementById('territoryDriverArea').value; if (!driverId || !serviceAreaId) return alert('Select a driver and territory.'); const response = await fetch(`/api/territories/drivers/${driverId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serviceAreaId }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not assign driver.'); await fetchTerritories(); });

async function fetchCrm() {
  const [loyaltyResponse, referralResponse, salesmenResponse] = await Promise.all([fetch('/api/loyalty'), fetch('/api/referrals'), fetch('/api/salesmen')]);
  if (loyaltyResponse.ok) state.crm.loyalty = await loyaltyResponse.json();
  if (referralResponse.ok) state.crm.referrals = await referralResponse.json();
  if (salesmenResponse.ok) state.crm.salesmen = await salesmenResponse.json();
  const customers = state.crm.loyalty.customers || state.customers;
  const loyaltyBody = document.getElementById('loyaltyTableBody');
  if (loyaltyBody) loyaltyBody.innerHTML = customers.map((c) => `<tr><td>${c.name}</td><td>${c.tier_name || 'Bronze'}</td><td>${c.points_balance || 0}</td><td>${c.lifetime_points || 0}</td><td>${formatCurrency(c.total_spend)}</td></tr>`).join('') || '<tr><td colspan="5">No customers recorded.</td></tr>';
  const customerOptions = '<option value="">Select customer</option>' + state.customers.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  ['referralCustomer','referredCustomer','assignmentCustomer','activityCustomer'].forEach((id) => { const el = document.getElementById(id); if (el) el.innerHTML = customerOptions; });
  const salesmanSelect = document.getElementById('assignmentSalesman');
  if (salesmanSelect) salesmanSelect.innerHTML = '<option value="">Select salesman</option>' + (state.crm.salesmen.salesmen || []).map((s) => `<option value="${s.id}">${s.name} (${s.role})</option>`).join('');
  const performanceBody = document.getElementById('salesmanPerformanceBody');
  if (performanceBody) performanceBody.innerHTML = (state.crm.salesmen.performance || []).map((s) => `<tr><td>${s.name}</td><td>${s.assigned_customers || 0}</td><td>${s.activity_count || 0}</td><td>${formatCurrency(s.sales_value)}</td></tr>`).join('') || '<tr><td colspan="4">No salesman activity yet.</td></tr>';
  const code = (state.crm.referrals.codes || []).find((item) => item.status === 'active');
  const codeResult = document.getElementById('referralCodeResult'); if (codeResult && code) codeResult.textContent = `Active code: ${code.code} · ${code.reward_points} points`;
}

document.getElementById('refreshCrm')?.addEventListener('click', fetchCrm);
document.getElementById('referralCodeForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/referrals/codes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: Number(document.getElementById('referralCustomer').value), rewardPoints: Number(document.getElementById('referralReward').value) }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not create referral code.'); document.getElementById('referralCodeResult').textContent = `Active code: ${data.code} · ${data.reward_points} points`; await fetchCrm(); });
document.getElementById('referralRedeemForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/referrals/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: document.getElementById('referralCode').value, referredCustomerId: Number(document.getElementById('referredCustomer').value) }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not redeem referral.'); event.target.reset(); await fetchCrm(); });
document.getElementById('salesmanAssignmentForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch(`/api/salesmen/assignments/${document.getElementById('assignmentCustomer').value}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ salesmanId: Number(document.getElementById('assignmentSalesman').value) }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not assign salesman.'); await fetchCrm(); });
document.getElementById('salesmanActivityForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/salesmen/activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: document.getElementById('activityCustomer').value ? Number(document.getElementById('activityCustomer').value) : null, activityType: document.getElementById('activityType').value, notes: document.getElementById('activityNotes').value }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not save activity.'); event.target.reset(); await fetchCrm(); });

async function fetchCreditPricing() {
  const [overviewResponse, listsResponse] = await Promise.all([fetch('/api/credit/overview'), fetch('/api/price-lists')]);
  if (overviewResponse.ok) {
    const rows = await overviewResponse.json();
    const body = document.getElementById('creditOverviewBody');
    if (body) body.innerHTML = rows.map((row) => `<tr><td>${row.name}</td><td>${formatCurrency(row.credit_limit)}</td><td>${formatCurrency(row.outstanding)}</td><td class="${Number(row.overdue) > 0 ? 'danger-text' : ''}">${formatCurrency(row.overdue)}</td><td>${formatCurrency(Math.max(0, Number(row.credit_limit || 0) - Number(row.outstanding || 0)))}</td><td>${row.status || 'active'}</td></tr>`).join('') || '<tr><td colspan="6">No credit records.</td></tr>';
  }
  if (listsResponse.ok) {
    const rows = await listsResponse.json();
    const body = document.getElementById('priceListsBody');
    if (body) body.innerHTML = rows.map((row) => `<tr><td>${row.name}</td><td>${row.currency}</td><td>${row.item_count || 0}</td><td>${row.active ? 'Active' : 'Inactive'}</td></tr>`).join('') || '<tr><td colspan="4">No price lists configured.</td></tr>';
  }
}

async function fetchCommissions() {
  const response = await fetch('/api/commissions/statements');
  if (!response.ok) return;
  const rows = await response.json();
  const body = document.getElementById('commissionStatementsBody');
  if (body) body.innerHTML = rows.map((row) => `<tr><td>${row.beneficiary_name}</td><td>${row.period_start} to ${row.period_end}</td><td>${formatCurrency(row.net_amount)}</td><td>${row.status}</td><td>${row.settled_at || '-'}</td><td>${row.status === 'settled' ? 'Settled' : `<button type="button" class="table-action settle-commission" data-id="${row.id}">Settle</button>`}</td></tr>`).join('') || '<tr><td colspan="6">No commission statements yet.</td></tr>';
  body?.querySelectorAll('.settle-commission').forEach((button) => button.addEventListener('click', async () => { const result = await fetch(`/api/commissions/${button.dataset.id}/settle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); const data = await result.json(); if (!result.ok) return alert(data.message || 'Could not settle statement.'); await fetchCommissions(); }));
}

document.getElementById('refreshCreditPricing')?.addEventListener('click', fetchCreditPricing);
document.getElementById('refreshCommissions')?.addEventListener('click', fetchCommissions);
document.getElementById('commissionRuleForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/commission-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('commissionRuleName').value, role: document.getElementById('commissionRuleRole').value, basis: document.getElementById('commissionRuleBasis').value, ratePercent: Number(document.getElementById('commissionRuleRate').value) }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not save commission rule.'); event.target.reset(); await fetchCommissions(); });
document.getElementById('priceListFormToggle')?.addEventListener('click', () => document.getElementById('priceListForm')?.classList.toggle('hidden'));
document.getElementById('creditPolicyForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/credit/policy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ defaultLimit: Number(document.getElementById('creditDefaultLimit').value || 0), defaultTermsDays: Number(document.getElementById('creditTermsDays').value || 0), requireApprovalAbove: Number(document.getElementById('creditApprovalAbove').value || 0), blockOnOverdue: document.getElementById('creditBlockOverdue').checked }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not save credit policy.'); await fetchCreditPricing(); });
document.getElementById('priceListForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/price-lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('priceListName').value, currency: document.getElementById('priceListCurrency').value }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not create price list.'); event.target.reset(); await fetchCreditPricing(); });

document.getElementById('refreshDocuments')?.addEventListener('click', fetchDocuments);
document.getElementById('documentForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: document.getElementById('documentTitle').value, documentType: document.getElementById('documentType').value, entityType: document.getElementById('documentEntityType').value, entityId: document.getElementById('documentEntityId').value || null, expiresOn: document.getElementById('documentExpiresOn').value || null, visibility: document.getElementById('documentVisibility').value, description: document.getElementById('documentDescription').value }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not create document record.'); event.target.reset(); await fetchDocuments(); });
document.getElementById('documentVersionForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch(`/api/documents/${document.getElementById('documentVersionId').value}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ originalFilename: document.getElementById('documentFilename').value, mimeType: document.getElementById('documentMimeType').value, byteSize: Number(document.getElementById('documentByteSize').value), checksumSha256: document.getElementById('documentChecksum').value, uploadStatus: document.getElementById('documentUploadStatus').value }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not register document version.'); alert(`Version ${data.version.version_number} registered. External upload descriptor is ready.`); event.target.reset(); await fetchDocuments(); });
document.getElementById('refreshProduction')?.addEventListener('click', fetchProduction);
document.getElementById('refreshLab')?.addEventListener('click', fetchProduction);
document.getElementById('productionInputForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const batchId = Number(document.getElementById('productionInputBatch').value); const response = await fetch(`/api/production/batches/${batchId}/inputs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: Number(document.getElementById('productionInputProduct').value), plannedQuantity: Number(document.getElementById('productionInputQuantity').value) }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not allocate raw material.'); event.target.reset(); await fetchProduction(); });
document.getElementById('productionLineForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/production/lines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('productionLineName').value, code: document.getElementById('productionLineCode').value, location: document.getElementById('productionLineLocation').value }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not add line.'); event.target.reset(); await fetchProduction(); });
document.getElementById('productionBatchForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/production/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchNumber: document.getElementById('productionBatchNumber').value, productId: Number(document.getElementById('productionProduct').value), plannedQuantity: Number(document.getElementById('productionPlannedQuantity').value), lineId: document.getElementById('productionLine').value ? Number(document.getElementById('productionLine').value) : null, notes: document.getElementById('productionNotes').value }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not create batch.'); event.target.reset(); await fetchProduction(); });
document.getElementById('labParameterForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/lab/parameters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('labParameterName').value, unit: document.getElementById('labParameterUnit').value, minValue: document.getElementById('labParameterMin').value, maxValue: document.getElementById('labParameterMax').value, allowedText: document.getElementById('labParameterAllowed').value }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not add parameter.'); event.target.reset(); await fetchProduction(); });
document.getElementById('labTestForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/lab/tests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchId: Number(document.getElementById('labTestBatch').value), testNumber: document.getElementById('labTestNumber').value, sampledAt: document.getElementById('labTestSampledAt').value || null }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Could not create lab test.'); event.target.reset(); await fetchProduction(); });

async function fetchAssistantWorkspace() {
  const responses = await Promise.all([fetch('/api/assistant/insights'), fetch('/api/assistant/actions'), fetch('/api/automations/executions'), fetch('/api/notifications/deliveries')]);
  const [insightsResponse, actionsResponse, executionsResponse, deliveriesResponse] = responses;
  if (insightsResponse.ok) { const data = await insightsResponse.json(); const status = document.getElementById('assistantProviderStatus'); if (status) { status.textContent = data.provider === 'configured' ? 'Provider configured' : 'Deterministic fallback · provider not configured'; status.className = `tag ${data.provider === 'configured' ? 'success' : 'neutral'}`; } const container = document.getElementById('assistantInsights'); if (container) container.innerHTML = (data.insights || []).map((item) => `<article class="assistant-insight"><strong>${escapeInvoiceHtml(item.title)}</strong><span>${escapeInvoiceHtml(item.detail)}</span><small class="muted">${escapeInvoiceHtml(item.severity)} · source: database</small></article>`).join(''); }
  if (actionsResponse.ok) { const actions = await actionsResponse.json(); const container = document.getElementById('assistantActions'); if (container) { container.innerHTML = actions.filter((item) => item.status === 'pending').map((item) => `<article class="assistant-action"><div><strong>${escapeInvoiceHtml(item.action_type)}</strong><small class="muted">Pending human approval · #${item.id}</small></div><button type="button" class="table-action assistant-approve" data-id="${item.id}">Approve</button></article>`).join('') || '<p class="muted">No pending actions.</p>'; container.querySelectorAll('.assistant-approve').forEach((button) => button.addEventListener('click', async () => { const response = await fetch(`/api/assistant/actions/${button.dataset.id}/approve`, { method: 'POST' }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Approval failed.'); await fetchAssistantWorkspace(); })); } }
  if (executionsResponse.ok) { const rows = await executionsResponse.json(); const body = document.getElementById('automationLogBody'); if (body) body.innerHTML = rows.map((row) => `<tr><td>#${row.rule_id}</td><td><span class="tag neutral">${escapeInvoiceHtml(row.status)}</span></td><td>${escapeInvoiceHtml(row.idempotency_key)}</td><td>${escapeInvoiceHtml(row.started_at || '')}</td></tr>`).join('') || '<tr><td colspan="4">No executions recorded.</td></tr>'; }
  if (deliveriesResponse.ok) { const rows = await deliveriesResponse.json(); const box = document.getElementById('notificationLog'); if (box) box.innerHTML = rows.slice(0, 10).map((row) => `<div class="assistant-action"><span>${escapeInvoiceHtml(row.channel)} · ${escapeInvoiceHtml(row.status)}</span><small class="muted">${escapeInvoiceHtml(row.error || 'Recorded')}</small></div>`).join('') || '<p class="muted">No delivery logs recorded.</p>'; }
}
document.getElementById('assistantForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/assistant/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: document.getElementById('assistantMessage').value }) }); const data = await response.json(); if (!response.ok) return alert(data.message || 'Assistant unavailable.'); document.getElementById('assistantMessage').value = ''; await fetchAssistantWorkspace(); alert(`${data.response}\n\nSource: recorded database data\nProvider: ${data.provider}`); });
document.getElementById('refreshAssistant')?.addEventListener('click', fetchAssistantWorkspace);
document.getElementById('refreshAutomationLog')?.addEventListener('click', fetchAssistantWorkspace);

const FRANCHISE_SCOPE_OPTIONS = ['management', 'employees', 'customers', 'inventory', 'reports', 'financial', 'consolidated_reports'];
const FRANCHISE_REPORT_OPTIONS = ['consolidated_reports', 'consolidated_sales', 'consolidated_inventory', 'consolidated_customers', 'consolidated_financial'];

function escapeFranchiseHtml(value) {
  return String(value ?? '').replace(/[&<>\"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[character]));
}

function franchiseDate(value) {
  if (!value) return '—';
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? String(value) : formatDate(parsed);
}

function franchiseStatusClass(value) {
  const status = String(value || '').toLowerCase();
  return ['active', 'pending', 'suspended', 'terminated', 'draft', 'expired', 'paid', 'settled'].includes(status) ? status : 'neutral';
}

function franchiseMessageForStatus(status, fallback = 'The franchise request could not be completed.') {
  if (status === 401) return 'Your session has expired. Sign in again to view franchise management.';
  if (status === 403) return 'You do not have permission to view or manage this franchise data.';
  if (status === 404) return 'The requested franchise record was not found.';
  return fallback;
}

function updateFranchiseNav() {
  const nav = document.getElementById('franchiseNav');
  if (nav) nav.classList.toggle('hidden', !isLoggedIn() || !state.franchise.authorized);
}

function recordFranchiseAccessError(status, message) {
  state.franchise.status = status === 403 ? 'forbidden' : status === 401 ? 'unauthenticated' : 'error';
  state.franchise.message = message || franchiseMessageForStatus(status);
  if (status === 401) {
    state.franchise.authorized = false;
    state.franchise.relationships = [];
    state.franchise.selectedId = null;
    state.franchise.detail = null;
    localStorage.removeItem(LOGIN_TOKEN_KEY);
    localStorage.removeItem(CURRENT_USER_KEY);
    localStorage.removeItem(ACTIVE_COMPANY_KEY);
    showLoginScreen();
  }
  updateFranchiseNav();
  renderFranchiseManagement();
}

async function franchiseRequest(url, options = {}, silent = false) {
  try {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.message || franchiseMessageForStatus(response.status);
      if (!silent) recordFranchiseAccessError(response.status, message);
      return { ok: false, status: response.status, data, message };
    }
    return { ok: true, status: response.status, data };
  } catch (error) {
    const message = 'Unable to reach franchise management right now.';
    if (!silent) recordFranchiseAccessError(0, message);
    return { ok: false, status: 0, data: {}, message: error.message || message };
  }
}

function renderFranchiseAccessState() {
  const stateBox = document.getElementById('franchiseAccessState');
  const label = document.getElementById('franchiseAccessLabel');
  if (!stateBox || !label) return;
  let message = state.franchise.message || '';
  let labelText = 'Authorized';
  let className = 'franchise-state';
  if (state.franchise.loading) {
    message = 'Checking franchise access…';
    labelText = 'Checking access…';
  } else if (!state.franchise.authorized) {
    message = message || (state.franchise.accessLoaded ? 'No franchise relationships or grants are available for this account.' : 'Franchise access is not available.');
    labelText = state.franchise.status === 'forbidden' ? 'Access denied' : 'Not available';
    className += ' error';
  } else if (['error', 'forbidden'].includes(state.franchise.status)) {
    message = message || 'Franchise data could not be loaded.';
    labelText = state.franchise.status === 'forbidden' ? 'Access denied' : 'Unavailable';
    className += ' error';
  } else if (state.franchise.relationshipsLoaded && !state.franchise.relationships.length) {
    message = isAdminUser() ? 'No franchise relationships exist yet. Create one when the parent and child companies are ready.' : 'No franchise relationships are available for this account.';
    labelText = 'No relationships';
    className += ' empty';
  } else {
    message = message || 'Authorized franchise relationships are shown below.';
  }
  stateBox.className = className;
  stateBox.textContent = message;
  label.textContent = labelText;
  label.className = `tag ${state.franchise.authorized ? 'success' : 'neutral'}`;
}

function renderFranchiseCreateOptions() {
  const select = document.getElementById('franchiseParentCompanyId');
  const selectWrap = document.getElementById('franchiseParentSelectWrap');
  const fixed = document.getElementById('franchiseParentCompanyFixed');
  if (!select || !selectWrap || !fixed) return;
  const isSuperAdmin = state.currentUser?.role === 'super_admin';
  selectWrap.classList.toggle('hidden', !isSuperAdmin);
  fixed.classList.toggle('hidden', isSuperAdmin);
  if (isSuperAdmin) {
    const current = select.value;
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.companies.length ? 'Select parent company' : 'No company list available';
    select.appendChild(placeholder);
    state.companies.filter((company) => Number(company.active) !== 0).forEach((company) => {
      const option = document.createElement('option');
      option.value = company.id;
      option.textContent = `${company.name} (#${company.id})`;
      select.appendChild(option);
    });
    if (current && [...select.options].some((option) => option.value === current)) select.value = current;
    if (!select.value && state.companies.length === 1) select.value = String(state.companies[0].id);
    fixed.textContent = '';
  } else {
    fixed.textContent = state.currentUser?.companyName ? `${state.currentUser.companyName} (#${state.currentUser.companyId})` : `Company #${state.currentUser?.companyId || '—'}`;
  }
}

function franchiseRelationshipCanManage(relation = state.franchise.detail) {
  if (!relation || !state.currentUser) return false;
  if (state.currentUser.role === 'super_admin') return true;
  if (state.currentUser.role === 'company_admin' && Number(state.currentUser.companyId) === Number(relation.parent_company_id)) return true;
  return state.franchise.scopes.some((scope) => Number(scope.relationship_id) === Number(relation.id) && scope.scope === 'management' && Number(scope.can_write) === 1);
}

function franchiseCanViewConsolidatedReport(relation = state.franchise.detail) {
  if (!relation || !state.currentUser) return false;
  if (state.currentUser.role === 'super_admin') return true;
  if (state.currentUser.role === 'company_admin' && Number(state.currentUser.companyId) === Number(relation.parent_company_id)) return true;
  return (relation.reportPermissions || []).some((permission) => Number(permission.user_id) === Number(state.currentUser.id) && Number(permission.can_view) === 1 && Number(permission.consolidated) === 1);
}

function franchiseCanReadScope(scope, relation = state.franchise.detail) {
  if (!relation || !state.currentUser) return false;
  if (state.currentUser.role === 'super_admin') return true;
  if (state.currentUser.role === 'company_admin' && Number(state.currentUser.companyId) === Number(relation.parent_company_id)) return true;
  return state.franchise.scopes.some((grant) => Number(grant.relationship_id) === Number(relation.id) && grant.scope === scope && Number(grant.can_read) === 1);
}

function renderFranchiseEmployeeScope() {
  const panel = document.getElementById('franchiseEmployeeScopePanel');
  const stateBox = document.getElementById('franchiseEmployeeScopeState');
  const count = document.getElementById('franchiseEmployeeScopeCount');
  if (!panel || !stateBox || !count) return;
  const detail = state.franchise.detail;
  if (!detail || !franchiseCanReadScope('employees', detail)) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  count.textContent = state.franchise.employeeScope.loading ? '…' : String(state.franchise.employeeScope.rows.length);
  if (state.franchise.employeeScope.loading) {
    stateBox.className = 'franchise-state';
    stateBox.textContent = 'Loading authorized employee scope…';
    stateBox.classList.remove('hidden');
  } else if (state.franchise.employeeScope.error) {
    stateBox.className = 'franchise-state error';
    stateBox.textContent = state.franchise.employeeScope.error;
    stateBox.classList.remove('hidden');
  } else {
    stateBox.className = 'franchise-state hidden';
    stateBox.textContent = '';
  }
  renderFranchiseRows('franchiseEmployeeScopeBody', state.franchise.employeeScope.rows, 4, 'No authorized employees returned.', (row) => `<tr><td>${escapeFranchiseHtml(row.name || row.username || `User #${row.id}`)}</td><td>${escapeFranchiseHtml(row.company_name || `Company #${row.company_id}`)}</td><td>${escapeFranchiseHtml(row.role || '—')}</td><td>${Number(row.active) === 1 ? 'Active' : 'Inactive'}</td></tr>`);
}

function renderFranchiseRelationshipList() {
  const list = document.getElementById('franchiseRelationshipList');
  const count = document.getElementById('franchiseRelationshipCount');
  if (!list || !count) return;
  const relationships = state.franchise.relationships || [];
  count.textContent = String(relationships.length);
  if (!relationships.length) {
    list.innerHTML = '<div class="empty-state">No authorized relationships found.</div>';
    return;
  }
  list.innerHTML = relationships.map((relation) => {
    const active = Number(relation.id) === Number(state.franchise.selectedId);
    const dates = [relation.start_date, relation.end_date].filter(Boolean).map(franchiseDate).join(' – ') || 'No dates';
    return `<button type="button" class="franchise-relationship-card ${active ? 'active' : ''}" data-franchise-id="${escapeFranchiseHtml(relation.id)}">
      <span class="franchise-card-heading"><strong>${escapeFranchiseHtml(relation.parent_company_name || `Company #${relation.parent_company_id}`)} → ${escapeFranchiseHtml(relation.child_company_name || `Company #${relation.child_company_id}`)}</strong><span class="status-pill ${franchiseStatusClass(relation.status)}">${escapeFranchiseHtml(relation.status || 'pending')}</span></span>
      <span class="franchise-card-meta">${escapeFranchiseHtml(relation.relationship_type || 'franchise')} · Agreement ${escapeFranchiseHtml(relation.agreement_number || '—')}</span>
      <span class="franchise-card-meta">${escapeFranchiseHtml(dates)} · ${escapeFranchiseHtml(relation.assignment_count || 0)} active assignment(s)</span>
    </button>`;
  }).join('');
  list.querySelectorAll('[data-franchise-id]').forEach((button) => button.addEventListener('click', () => selectFranchiseRelationship(button.dataset.franchiseId)));
}

function renderFranchiseRows(bodyId, rows, colspan, emptyText, rowRenderer) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  body.innerHTML = rows.length ? rows.map(rowRenderer).join('') : `<tr><td colspan="${colspan}" class="muted-label">${escapeFranchiseHtml(emptyText)}</td></tr>`;
}

function parseAssignmentScopes(assignment) {
  if (Array.isArray(assignment.scopes)) return assignment.scopes;
  try { return JSON.parse(assignment.scopes_json || '[]'); } catch (_) { return []; }
}

function renderFranchiseUserOptions() {
  const assignments = state.franchise.detail?.assignments || [];
  const users = new Map();
  [...state.franchise.users, ...assignments.map((assignment) => ({ id: assignment.user_id, name: assignment.user_name, username: assignment.username, role: assignment.user_role, company_id: assignment.company_id, active: assignment.active }))].forEach((user) => {
    if (user?.id && !users.has(Number(user.id))) users.set(Number(user.id), user);
  });
  ['franchiseAssignmentUserSelect', 'franchiseGrantUserSelect', 'franchiseReportUserSelect'].forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    const current = select.value;
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = users.size ? 'Select loaded user (optional)' : 'No user list available';
    select.appendChild(placeholder);
    [...users.values()].sort((left, right) => String(left.name || left.username || '').localeCompare(String(right.name || right.username || ''))).forEach((user) => {
      const option = document.createElement('option');
      option.value = user.id;
      option.textContent = `${user.name || user.username || `User #${user.id}`} (#${user.id})${user.role ? ` · ${user.role}` : ''}`;
      select.appendChild(option);
    });
    if (current && [...select.options].some((option) => option.value === current)) select.value = current;
  });
}

function renderFranchiseReportOptions() {
  const detail = state.franchise.detail;
  const reportPanel = document.getElementById('franchiseConsolidatedReportPanel');
  const reportSelect = document.getElementById('franchiseConsolidatedReportKey');
  if (!reportPanel || !reportSelect || !detail) return;
  const hasAccess = franchiseCanViewConsolidatedReport(detail);
  const denied = Number(state.franchise.reportDeniedForId) === Number(detail.id);
  const canView = hasAccess && !denied;
  reportPanel.classList.toggle('hidden', !canView && !denied && !state.franchise.reportError);
  const reportForm = document.getElementById('franchiseConsolidatedReportForm');
  if (reportForm) reportForm.classList.toggle('hidden', !canView);
  if (!canView) {
    const accessLabel = document.getElementById('franchiseReportAccessLabel');
    if (accessLabel) accessLabel.textContent = denied ? 'Access denied' : 'No access';
    return;
  }
  const isParentAdmin = state.currentUser?.role === 'super_admin' || (state.currentUser?.role === 'company_admin' && Number(state.currentUser.companyId) === Number(detail.parent_company_id));
  const keys = isParentAdmin ? FRANCHISE_REPORT_OPTIONS : (detail.reportPermissions || []).filter((permission) => Number(permission.user_id) === Number(state.currentUser?.id) && Number(permission.can_view) === 1 && Number(permission.consolidated) === 1).map((permission) => permission.report_key).filter((key, index, values) => FRANCHISE_REPORT_OPTIONS.includes(key) && values.indexOf(key) === index);
  const current = reportSelect.value;
  reportSelect.replaceChildren();
  keys.forEach((key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key === 'consolidated_reports' ? 'All consolidated' : key.replace(/^consolidated_/, 'Consolidated ').replace(/_/g, ' ');
    reportSelect.appendChild(option);
  });
  if (current && keys.includes(current)) reportSelect.value = current;
  document.getElementById('franchiseReportAccessLabel').textContent = `${keys.length} report option${keys.length === 1 ? '' : 's'}`;
}

function renderFranchiseConsolidatedReport() {
  const stateBox = document.getElementById('franchiseConsolidatedState');
  const kpis = document.getElementById('franchiseConsolidatedKpis');
  if (!stateBox || !kpis) return;
  const report = state.franchise.report;
  if (state.franchise.reportError) {
    stateBox.className = 'franchise-state error';
    stateBox.textContent = state.franchise.reportError;
    stateBox.classList.remove('hidden');
  } else if (!report) {
    stateBox.className = 'franchise-state hidden';
    stateBox.textContent = '';
  } else {
    stateBox.className = 'franchise-state';
    stateBox.textContent = report.rows?.length ? 'Authorized report data loaded.' : 'No report data exists for the selected period.';
    stateBox.classList.remove('hidden');
  }
  if (!report) {
    kpis.innerHTML = '';
    renderFranchiseRows('franchiseConsolidatedBody', [], 7, 'Load an authorized report to see company totals.', () => '');
    return;
  }
  const totals = report.totals || {};
  kpis.innerHTML = [
    ['Revenue', formatCurrency(totals.revenue)],
    ['Transactions', totals.transactionCount || 0],
    ['Orders', totals.orderCount || 0],
    ['Customers', totals.customerCount || 0],
    ['Products', totals.productCount || 0]
  ].map(([label, value]) => `<div class="report-kpi"><span>${escapeFranchiseHtml(label)}</span><strong>${escapeFranchiseHtml(value)}</strong><small>Authorized company scope</small></div>`).join('');
  renderFranchiseRows('franchiseConsolidatedBody', report.rows || [], 7, 'No company totals returned.', (row) => `<tr><td>${escapeFranchiseHtml(row.company_name || row.name || `Company #${row.id}`)}</td><td>${escapeFranchiseHtml(formatCurrency(row.revenue))}</td><td>${escapeFranchiseHtml(row.transaction_count || 0)}</td><td>${escapeFranchiseHtml(row.order_count || 0)}</td><td>${escapeFranchiseHtml(row.customer_count || 0)}</td><td>${escapeFranchiseHtml(row.product_count || 0)}</td><td>${escapeFranchiseHtml(row.stock_units || 0)}</td></tr>`);
}

function renderFranchiseDetail() {
  const empty = document.getElementById('franchiseDetailEmpty');
  const loading = document.getElementById('franchiseDetailLoading');
  const error = document.getElementById('franchiseDetailError');
  const panel = document.getElementById('franchiseDetailPanel');
  if (!empty || !loading || !error || !panel) return;
  const detail = state.franchise.detail;
  renderFranchiseEmployeeScope();
  empty.classList.toggle('hidden', Boolean(detail) || state.franchise.loading);
  loading.classList.toggle('hidden', !state.franchise.loading || !state.franchise.selectedId);
  error.classList.toggle('hidden', !state.franchise.detailError);
  error.textContent = state.franchise.detailError || '';
  panel.classList.toggle('hidden', !detail || Boolean(state.franchise.detailError) || state.franchise.loading);
  if (!detail || state.franchise.detailError || state.franchise.loading) return;

  const canManage = franchiseRelationshipCanManage(detail);
  document.getElementById('franchiseDetailTitle').textContent = `${detail.parent_company_name || `Company #${detail.parent_company_id}`} → ${detail.child_company_name || `Company #${detail.child_company_id}`}`;
  const status = document.getElementById('franchiseDetailStatus');
  status.textContent = detail.status || 'pending';
  status.className = `status-pill ${franchiseStatusClass(detail.status)}`;
  document.getElementById('franchiseDetailMeta').innerHTML = [
    ['Type', detail.relationship_type || 'franchise'],
    ['Parent company', `${detail.parent_company_name || '—'} (#${detail.parent_company_id})`],
    ['Child company', `${detail.child_company_name || '—'} (#${detail.child_company_id})`],
    ['Dates', [detail.start_date, detail.end_date].filter(Boolean).map(franchiseDate).join(' – ') || 'No dates'],
    ['Agreement', detail.agreement_number || '—'],
    ['Assignments', detail.assignment_count || 0]
  ].map(([label, value]) => `<div class="franchise-meta-item"><span>${escapeFranchiseHtml(label)}</span><strong>${escapeFranchiseHtml(value)}</strong></div>`).join('');

  const setValue = (id, value) => { const element = document.getElementById(id); if (element && document.activeElement !== element) element.value = value ?? ''; };
  setValue('franchiseRelationshipStatus', detail.status || 'pending');
  setValue('franchiseRelationshipStartDate', detail.start_date || '');
  setValue('franchiseRelationshipEndDate', detail.end_date || '');
  setValue('franchiseRelationshipAgreementNumber', detail.agreement_number || '');
  setValue('franchiseRelationshipNotes', detail.notes || '');

  document.querySelectorAll('.franchise-write-control').forEach((control) => control.classList.toggle('hidden', !canManage));
  document.getElementById('franchiseCreatePanel')?.classList.toggle('hidden', !isAdminUser());
  renderFranchiseRows('franchiseBranchesBody', state.franchise.branches || [], 5, 'No branches found.', (row) => `<tr><td>${escapeFranchiseHtml(row.child_company_name || `Company #${row.child_company_id}`)}</td><td>${escapeFranchiseHtml(row.relationship_type || 'branch')}</td><td><span class="status-pill ${franchiseStatusClass(row.status)}">${escapeFranchiseHtml(row.status || 'pending')}</span></td><td>${escapeFranchiseHtml([row.start_date, row.end_date].filter(Boolean).map(franchiseDate).join(' – ') || '—')}</td><td>${escapeFranchiseHtml(row.agreement_number || '—')}</td></tr>`);
  renderFranchiseRows('franchiseAgreementsBody', detail.agreements || [], 6, 'No agreements found.', (row) => `<tr><td>${escapeFranchiseHtml(row.agreement_number)}</td><td>${escapeFranchiseHtml(row.status)}</td><td>${escapeFranchiseHtml(franchiseDate(row.effective_on))}</td><td>${escapeFranchiseHtml(franchiseDate(row.expires_on))}</td><td>${escapeFranchiseHtml(`${formatCurrency(row.joining_fee)} + ${formatCurrency(row.recurring_fee)}`)}</td><td>${escapeFranchiseHtml(`${row.revenue_share_percent || 0}%`)}</td></tr>`);
  renderFranchiseRows('franchiseAssignmentsBody', detail.assignments || [], 6, 'No managers or employees assigned.', (row) => `<tr><td>${escapeFranchiseHtml(row.user_name || row.username || `User #${row.user_id}`)}<small class="franchise-table-subtext">#${escapeFranchiseHtml(row.user_id)}</small></td><td>${escapeFranchiseHtml(row.assignment_type)}</td><td>${escapeFranchiseHtml(row.company_id || '—')}</td><td>${Number(row.active) === 1 ? 'Active' : 'Inactive'}</td><td>${escapeFranchiseHtml(parseAssignmentScopes(row).map((scope) => `${scope.scope}${Number(scope.canWrite) || Number(scope.can_write) ? ' (write)' : ''}`).join(', ') || '—')}</td><td>${escapeFranchiseHtml(row.notes || '—')}</td></tr>`);
  renderFranchiseRows('franchiseScopesBody', detail.scopes || [], 4, 'No scope grants found.', (row) => `<tr><td>${escapeFranchiseHtml(row.user_name || row.username || `User #${row.user_id}`)}</td><td>${escapeFranchiseHtml(row.scope)}</td><td>${Number(row.can_read) === 1 ? 'Yes' : 'No'}</td><td>${Number(row.can_write) === 1 ? 'Yes' : 'No'}</td></tr>`);
  renderFranchiseRows('franchiseReportPermissionsBody', detail.reportPermissions || [], 5, 'No report grants found.', (row) => `<tr><td>${escapeFranchiseHtml(row.user_name || row.username || `User #${row.user_id}`)}</td><td>${escapeFranchiseHtml(row.report_key)}</td><td>${Number(row.can_view) === 1 ? 'Yes' : 'No'}</td><td>${Number(row.can_export) === 1 ? 'Yes' : 'No'}</td><td>${Number(row.consolidated) === 1 ? 'Yes' : 'No'}</td></tr>`);
  renderFranchiseRows('franchiseFeesBody', detail.fees || [], 6, 'No fees recorded.', (row) => `<tr><td>${escapeFranchiseHtml(row.fee_type)}</td><td>${escapeFranchiseHtml(row.description || '—')}</td><td>${escapeFranchiseHtml(formatCurrency(row.amount))} ${escapeFranchiseHtml(row.currency || '')}</td><td>${escapeFranchiseHtml(row.frequency)}</td><td>${escapeFranchiseHtml(franchiseDate(row.due_date))}</td><td>${escapeFranchiseHtml(row.status)}</td></tr>`);
  renderFranchiseRows('franchiseRevenueSharesBody', detail.revenueShares || [], 7, 'No revenue shares recorded.', (row) => `<tr><td>${escapeFranchiseHtml(`${franchiseDate(row.period_start)} – ${franchiseDate(row.period_end)}`)}</td><td>${escapeFranchiseHtml(formatCurrency(row.gross_revenue))}</td><td>${escapeFranchiseHtml(formatCurrency(row.deductions))}</td><td>${escapeFranchiseHtml(`${row.share_percent || 0}%`)}</td><td>${escapeFranchiseHtml(formatCurrency(row.parent_amount))}</td><td>${escapeFranchiseHtml(formatCurrency(row.child_amount))}</td><td>${escapeFranchiseHtml(row.status)}</td></tr>`);
  renderFranchiseUserOptions();
  renderFranchiseReportOptions();
  renderFranchiseConsolidatedReport();
}

function renderFranchiseManagement() {
  renderFranchiseAccessState();
  renderFranchiseCreateOptions();
  updateFranchiseNav();
  const workspace = document.getElementById('franchiseWorkspace');
  const createPanel = document.getElementById('franchiseCreatePanel');
  if (!workspace) return;
  workspace.classList.toggle('hidden', !state.franchise.authorized);
  if (createPanel) createPanel.classList.toggle('hidden', !state.franchise.authorized || !isAdminUser());
  renderFranchiseRelationshipList();
  renderFranchiseDetail();
}

async function fetchFranchiseAccess() {
  resetFranchiseState();
  state.franchise.loading = true;
  state.franchise.status = 'loading';
  renderFranchiseManagement();
  const result = await franchiseRequest('/api/franchise-scope');
  state.franchise.loading = false;
  state.franchise.accessLoaded = true;
  if (!result.ok) {
    state.franchise.authorized = false;
    state.franchise.relationshipsLoaded = true;
    renderFranchiseManagement();
    return false;
  }
  const data = result.data || {};
  state.franchise.scopes = Array.isArray(data.scopes) ? data.scopes : [];
  state.franchise.authorized = isAdminUser() || (Array.isArray(data.relationships) && data.relationships.length > 0) || state.franchise.scopes.length > 0;
  state.franchise.status = state.franchise.authorized ? 'ready' : 'empty';
  state.franchise.message = '';
  state.franchise.relationships = Array.isArray(data.relationships) ? data.relationships : [];
  state.franchise.relationshipsLoaded = false;
  updateFranchiseNav();
  if (state.franchise.authorized) await fetchFranchiseRelationships();
  else {
    state.franchise.relationshipsLoaded = true;
    renderFranchiseManagement();
  }
  return state.franchise.authorized;
}

async function fetchFranchiseRelationships() {
  if (!state.franchise.authorized) return false;
  state.franchise.loading = true;
  state.franchise.detailError = '';
  renderFranchiseManagement();
  const result = await franchiseRequest('/api/franchises');
  state.franchise.loading = false;
  state.franchise.relationshipsLoaded = true;
  if (!result.ok) {
    state.franchise.authorized = false;
    state.franchise.relationships = [];
    state.franchise.selectedId = null;
    state.franchise.detail = null;
    state.franchise.status = result.status === 403 ? 'forbidden' : 'error';
    state.franchise.message = result.message;
    renderFranchiseManagement();
    return false;
  }
  state.franchise.status = 'ready';
  state.franchise.message = '';
  state.franchise.relationships = Array.isArray(result.data) ? result.data : [];
  if (!state.franchise.relationships.some((relation) => Number(relation.id) === Number(state.franchise.selectedId))) state.franchise.selectedId = state.franchise.relationships[0]?.id || null;
  if (!state.franchise.selectedId) {
    state.franchise.detail = null;
    state.franchise.branches = [];
    state.franchise.report = null;
    state.franchise.employeeScope = { loading: false, rows: [], error: '' };
    renderFranchiseManagement();
    return true;
  }
  await fetchFranchiseDetail(state.franchise.selectedId);
  return true;
}

async function fetchFranchiseUsers(relation) {
  state.franchise.users = [];
  const companyIds = [relation.parent_company_id, relation.child_company_id].map(Number).filter((id, index, values) => id && values.indexOf(id) === index);
  for (const companyId of companyIds) {
    const isOwnCompany = Number(state.currentUser?.companyId) === companyId;
    if (state.currentUser?.role !== 'super_admin' && !isOwnCompany) continue;
    const result = await franchiseRequest(`/api/companies/${companyId}/users`, {}, true);
    if (result.ok && Array.isArray(result.data)) state.franchise.users.push(...result.data);
  }
  state.franchise.users = state.franchise.users.filter((user, index, values) => values.findIndex((item) => Number(item.id) === Number(user.id)) === index);
  renderFranchiseUserOptions();
}

async function fetchFranchiseScopedEmployees(relation) {
  state.franchise.employeeScope = { loading: false, rows: [], error: '' };
  if (!franchiseCanReadScope('employees', relation)) return;
  state.franchise.employeeScope.loading = true;
  renderFranchiseEmployeeScope();
  const result = await franchiseRequest(`/api/franchises/${relation.parent_company_id}/scope/employees`, {}, true);
  if (Number(state.franchise.selectedId) !== Number(relation.id)) return;
  if (!result.ok) {
    state.franchise.employeeScope.loading = false;
    state.franchise.employeeScope.error = result.status === 403 ? 'You do not have permission to view employee scope data.' : result.message;
    renderFranchiseEmployeeScope();
    return;
  }
  state.franchise.employeeScope.loading = false;
  state.franchise.employeeScope.rows = Array.isArray(result.data?.rows) ? result.data.rows : [];
  renderFranchiseEmployeeScope();
}

async function fetchFranchiseDetail(id) {
  const selectedId = Number(id);
  if (!selectedId || !state.franchise.authorized) return false;
  state.franchise.selectedId = selectedId;
  state.franchise.detail = null;
  state.franchise.branches = [];
  state.franchise.report = null;
  state.franchise.reportError = '';
  state.franchise.reportDeniedForId = false;
  state.franchise.employeeScope = { loading: false, rows: [], error: '' };
  state.franchise.detailError = '';
  state.franchise.loading = true;
  renderFranchiseManagement();
  const detailResult = await franchiseRequest(`/api/franchises/${selectedId}`);
  if (!detailResult.ok) {
    state.franchise.loading = false;
    state.franchise.detailError = detailResult.message;
    renderFranchiseManagement();
    return false;
  }
  const branchResult = await franchiseRequest(`/api/franchises/${selectedId}/branches`, {}, true);
  if (Number(state.franchise.selectedId) !== selectedId) return false;
  state.franchise.detail = detailResult.data || null;
  state.franchise.branches = branchResult.ok && Array.isArray(branchResult.data) ? branchResult.data : [];
  state.franchise.status = 'ready';
  state.franchise.message = '';
  state.franchise.loading = false;
  if (state.franchise.detail && franchiseRelationshipCanManage(state.franchise.detail)) await fetchFranchiseUsers(state.franchise.detail);
  if (state.franchise.detail) await fetchFranchiseScopedEmployees(state.franchise.detail);
  renderFranchiseManagement();
  return true;
}

async function selectFranchiseRelationship(id) {
  if (!state.franchise.authorized) return;
  await fetchFranchiseDetail(id);
}

async function ensureFranchiseManagementLoaded() {
  if (!state.franchise.accessLoaded) await fetchFranchiseAccess();
  if (!state.franchise.authorized) return false;
  if (!state.franchise.relationshipsLoaded) await fetchFranchiseRelationships();
  if (!state.franchise.selectedId && state.franchise.relationships[0]) await fetchFranchiseDetail(state.franchise.relationships[0].id);
  return true;
}

function franchiseSelectedId() {
  return Number(state.franchise.selectedId || state.franchise.detail?.id || 0);
}

function franchiseUserId(selectId, inputId) {
  const selected = Number(document.getElementById(selectId)?.value || 0);
  const entered = Number(document.getElementById(inputId)?.value || 0);
  return selected || entered || 0;
}

async function refreshSelectedFranchise() {
  await fetchFranchiseRelationships();
}

document.getElementById('franchiseRefreshBtn')?.addEventListener('click', async () => {
  await fetchFranchiseAccess();
});

document.getElementById('franchiseCreateForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!isAdminUser()) return;
  const parentCompanyId = state.currentUser?.role === 'super_admin' ? Number(document.getElementById('franchiseParentCompanyId').value) : Number(state.currentUser?.companyId);
  const childCompanyId = Number(document.getElementById('franchiseChildCompanyId').value);
  if (!parentCompanyId || !childCompanyId || parentCompanyId === childCompanyId) return alert('Select a valid parent and a different child company.');
  const result = await franchiseRequest('/api/franchises', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parentCompanyId,
      childCompanyId,
      relationshipType: document.getElementById('franchiseCreateType').value,
      status: document.getElementById('franchiseCreateStatus').value,
      startDate: document.getElementById('franchiseCreateStartDate').value || null,
      endDate: document.getElementById('franchiseCreateEndDate').value || null,
      agreementNumber: document.getElementById('franchiseCreateAgreementNumber').value,
      notes: document.getElementById('franchiseCreateNotes').value
    })
  });
  if (!result.ok) return alert(result.message);
  event.target.reset();
  await refreshSelectedFranchise();
  if (result.data?.id) await fetchFranchiseDetail(result.data.id);
});

document.getElementById('franchiseRelationshipForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const detail = state.franchise.detail;
  if (!detail || !franchiseRelationshipCanManage(detail)) return alert('You do not have permission to update this relationship.');
  const result = await franchiseRequest(`/api/franchises/${detail.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: document.getElementById('franchiseRelationshipStatus').value,
      startDate: document.getElementById('franchiseRelationshipStartDate').value || null,
      endDate: document.getElementById('franchiseRelationshipEndDate').value || null,
      agreementNumber: document.getElementById('franchiseRelationshipAgreementNumber').value,
      notes: document.getElementById('franchiseRelationshipNotes').value
    })
  });
  if (!result.ok) return alert(result.message);
  await refreshSelectedFranchise();
});

document.getElementById('franchiseTerminateBtn')?.addEventListener('click', async () => {
  const detail = state.franchise.detail;
  if (!detail || !franchiseRelationshipCanManage(detail)) return alert('You do not have permission to terminate this relationship.');
  if (!confirm('Terminate this franchise relationship? Assignments will be deactivated.')) return;
  const result = await franchiseRequest(`/api/franchises/${detail.id}`, { method: 'DELETE' });
  if (!result.ok) return alert(result.message);
  await refreshSelectedFranchise();
});

document.getElementById('franchiseBranchForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const detail = state.franchise.detail;
  if (!detail || !franchiseRelationshipCanManage(detail)) return alert('You do not have permission to add a branch.');
  const childCompanyId = Number(document.getElementById('franchiseBranchCompanyId').value);
  if (!childCompanyId) return alert('Enter an existing branch company ID.');
  const result = await franchiseRequest(`/api/franchises/${detail.id}/branches`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ childCompanyId, status: document.getElementById('franchiseBranchStatus').value }) });
  if (!result.ok) return alert(result.message);
  event.target.reset();
  await fetchFranchiseDetail(detail.id);
});

document.getElementById('franchiseAgreementForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const detail = state.franchise.detail;
  if (!detail || !franchiseRelationshipCanManage(detail)) return alert('You do not have permission to add an agreement.');
  const result = await franchiseRequest(`/api/franchises/${detail.id}/agreements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agreementNumber: document.getElementById('franchiseAgreementNumber').value, status: document.getElementById('franchiseAgreementStatus').value, signedOn: document.getElementById('franchiseAgreementSignedOn').value || null, effectiveOn: document.getElementById('franchiseAgreementEffectiveOn').value || null, expiresOn: document.getElementById('franchiseAgreementExpiresOn').value || null, documentUrl: document.getElementById('franchiseAgreementDocumentUrl').value, terms: document.getElementById('franchiseAgreementTerms').value, joiningFee: Number(document.getElementById('franchiseAgreementJoiningFee').value || 0), recurringFee: Number(document.getElementById('franchiseAgreementRecurringFee').value || 0), currency: document.getElementById('franchiseAgreementCurrency').value || 'PKR', revenueSharePercent: Number(document.getElementById('franchiseAgreementRevenueShare').value || 0) }) });
  if (!result.ok) return alert(result.message);
  event.target.reset();
  document.getElementById('franchiseAgreementCurrency').value = 'PKR';
  await fetchFranchiseDetail(detail.id);
});

document.getElementById('franchiseAssignmentForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const detail = state.franchise.detail;
  if (!detail || !franchiseRelationshipCanManage(detail)) return alert('You do not have permission to assign users.');
  const userId = franchiseUserId('franchiseAssignmentUserSelect', 'franchiseAssignmentUserId');
  if (!userId) return alert('Select or enter an existing parent/child company user.');
  const scopes = [...document.querySelectorAll('#franchiseAssignmentScopeGrid input:checked')].map((input) => input.value);
  const canWrite = document.getElementById('franchiseAssignmentCanWrite').checked;
  const permissions = {};
  scopes.forEach((scope) => { permissions[scope] = { canRead: true, canWrite }; });
  const result = await franchiseRequest(`/api/franchises/${detail.id}/assignments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, assignmentType: document.getElementById('franchiseAssignmentType').value, active: true, notes: document.getElementById('franchiseAssignmentNotes').value, scopes, permissions }) });
  if (!result.ok) return alert(result.message);
  event.target.reset();
  document.querySelectorAll('#franchiseAssignmentScopeGrid input').forEach((input) => { input.checked = ['management', 'employees', 'customers', 'inventory', 'reports'].includes(input.value); });
  await fetchFranchiseDetail(detail.id);
});

document.getElementById('franchiseScopeForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const detail = state.franchise.detail;
  if (!detail || !franchiseRelationshipCanManage(detail)) return alert('You do not have permission to grant scopes.');
  const userId = franchiseUserId('franchiseGrantUserSelect', 'franchiseGrantUserId');
  if (!userId) return alert('Select or enter a user ID.');
  const result = await franchiseRequest(`/api/franchises/${detail.id}/scopes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, scope: document.getElementById('franchiseGrantScope').value, canRead: document.getElementById('franchiseGrantCanRead').checked, canWrite: document.getElementById('franchiseGrantCanWrite').checked }) });
  if (!result.ok) return alert(result.message);
  await fetchFranchiseDetail(detail.id);
});

document.getElementById('franchiseReportPermissionForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const detail = state.franchise.detail;
  if (!detail || !franchiseRelationshipCanManage(detail)) return alert('You do not have permission to grant report access.');
  const userId = franchiseUserId('franchiseReportUserSelect', 'franchiseReportUserId');
  if (!userId) return alert('Select or enter a user ID.');
  const result = await franchiseRequest(`/api/franchises/${detail.id}/report-permissions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, reportKey: document.getElementById('franchiseReportKey').value, canView: document.getElementById('franchiseReportCanView').checked, canExport: document.getElementById('franchiseReportCanExport').checked, consolidated: document.getElementById('franchiseReportConsolidated').checked }) });
  if (!result.ok) return alert(result.message);
  await fetchFranchiseDetail(detail.id);
});

document.getElementById('franchiseFeeForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const detail = state.franchise.detail;
  if (!detail || !franchiseRelationshipCanManage(detail)) return alert('You do not have permission to add fees.');
  const amount = Number(document.getElementById('franchiseFeeAmount').value);
  if (!Number.isFinite(amount) || amount < 0) return alert('Enter a valid non-negative fee amount.');
  const result = await franchiseRequest(`/api/franchises/${detail.id}/fees`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feeType: document.getElementById('franchiseFeeType').value, description: document.getElementById('franchiseFeeDescription').value, amount, currency: document.getElementById('franchiseFeeCurrency').value || 'PKR', frequency: document.getElementById('franchiseFeeFrequency').value, dueDate: document.getElementById('franchiseFeeDueDate').value || null, status: document.getElementById('franchiseFeeStatus').value, notes: document.getElementById('franchiseFeeNotes').value }) });
  if (!result.ok) return alert(result.message);
  event.target.reset();
  document.getElementById('franchiseFeeCurrency').value = 'PKR';
  await fetchFranchiseDetail(detail.id);
});

document.getElementById('franchiseRevenueShareForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const detail = state.franchise.detail;
  if (!detail || !franchiseRelationshipCanManage(detail)) return alert('You do not have permission to add revenue shares.');
  const result = await franchiseRequest(`/api/franchises/${detail.id}/revenue-shares`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ periodStart: document.getElementById('franchiseRevenueStart').value, periodEnd: document.getElementById('franchiseRevenueEnd').value, grossRevenue: Number(document.getElementById('franchiseRevenueGross').value || 0), deductions: Number(document.getElementById('franchiseRevenueDeductions').value || 0), sharePercent: Number(document.getElementById('franchiseRevenueSharePercent').value || 0), status: document.getElementById('franchiseRevenueStatus').value, notes: document.getElementById('franchiseRevenueNotes').value }) });
  if (!result.ok) return alert(result.message);
  event.target.reset();
  await fetchFranchiseDetail(detail.id);
});

document.getElementById('franchiseConsolidatedReportForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const detail = state.franchise.detail;
  if (!detail || !franchiseCanViewConsolidatedReport(detail) || state.franchise.reportDeniedForId) return alert('You do not have permission to view this consolidated report.');
  const params = new URLSearchParams({ reportKey: document.getElementById('franchiseConsolidatedReportKey').value });
  const start = document.getElementById('franchiseConsolidatedStart').value;
  const end = document.getElementById('franchiseConsolidatedEnd').value;
  if (start) params.set('startDate', start);
  if (end) params.set('endDate', end);
  state.franchise.report = null;
  state.franchise.reportError = '';
  renderFranchiseConsolidatedReport();
  const result = await franchiseRequest(`/api/franchises/${detail.parent_company_id}/consolidated-reports?${params.toString()}`, {}, true);
  if (!result.ok) {
    state.franchise.reportError = result.status === 403 ? 'This consolidated report grant is no longer active.' : result.message;
    if (result.status === 403) state.franchise.reportDeniedForId = Number(detail.id);
    renderFranchiseReportOptions();
    renderFranchiseConsolidatedReport();
    return;
  }
  state.franchise.report = result.data || null;
  renderFranchiseConsolidatedReport();
});

document.getElementById('franchiseAssignmentType')?.addEventListener('change', (event) => {
  const write = document.getElementById('franchiseAssignmentCanWrite');
  if (write && event.target.value === 'employee') write.checked = false;
});

async function initializeApp() {
  await loadFeaturePermissions();
  await loadCurrencySettings();
  configureAdminControls();
  setActiveTab('dashboard');
  await fetchCompanies();
  await fetchFranchiseAccess();
  if (hasFeature('audit_logs')) await fetchAuditLogs(1);
  await fetchProducts();
  await fetchProduction();
  await fetchDocuments();
  await fetchCustomers();
  await fetchCrm();
  await fetchCreditPricing();
  await fetchCommissions();
  await fetchTerritories();
  await fetchQrRecords();
  await fetchQrHistory();
  await fetchComplaints();
  await fetchBottles();
  await fetchSuppliers();
  await fetchSales();
  await fetchOrders();
  await fetchVehicles();
  await fetchEmployees();
  await fetchDriverMode();
  await fetchDeliverySubscriptions();
  await fetchPurchases();
  await fetchExpenses();
  await fetchPayments();
  await fetchDashboard();
  await fetchAnalytics();
  await fetchReports();
  await fetchForecast();
  await fetchReorderReport();
  await fetchAssistantWorkspace();
  await fetchWhatsAppWorkspace();
  await fetchDeliveryHeatmap();
  await fetchBillingWorkspace();
}

(async () => {
  if (isLoggedIn()) {
    const response = await fetch('/api/me');
    if (!response.ok) {
      localStorage.removeItem(LOGIN_TOKEN_KEY);
      localStorage.removeItem(CURRENT_USER_KEY);
      localStorage.removeItem(ACTIVE_COMPANY_KEY);
      showLoginScreen();
      return;
    }
    const data = await response.json();
    state.currentUser = data.user;
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(data.user));
    applyLanguage(data.user.language || localStorage.getItem(LANGUAGE_KEY) || 'en');
    showMainApp();
    await initializeApp();
  } else {
    showLoginScreen();
  }
})();

// Global search and notification center stay provider-neutral and use authorized server results.
(() => {
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>\"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[char]));
  const search = document.getElementById('globalSearch');
  const results = document.getElementById('globalSearchResults');
  const button = document.getElementById('notificationCenterBtn');
  const center = document.getElementById('notificationCenter');
  const badge = document.getElementById('notificationUnreadBadge');
  if (!search || !results || !button || !center) return;
  let timer;
  const renderSearch = (data) => { results.innerHTML = (data.items || []).map((item) => `<button class="global-search-result" type="button"><strong>${escapeHtml(item.title || '')}</strong><small>${escapeHtml(item.entity_type || '')} � ${escapeHtml(item.subtitle || '')}</small></button>`).join('') || '<div class="empty-state">No authorized matches.</div>'; results.classList.remove('hidden'); };
  search.addEventListener('input', () => { clearTimeout(timer); const value = search.value.trim(); if (value.length < 2) { results.classList.add('hidden'); return; } timer = setTimeout(async () => { const response = await fetch(`/api/search?q=${encodeURIComponent(value)}&pageSize=12`); if (response.ok) renderSearch(await response.json()); }, 250); });
  document.addEventListener('click', (event) => { if (!event.target.closest('.global-search-wrap')) results.classList.add('hidden'); if (!event.target.closest('.notification-center-btn') && !event.target.closest('.notification-center')) center.classList.add('hidden'); });
  let notificationPage = 1;
  let notificationHasNext = false;
  let notificationItems = [];
  const renderNotifications = () => {
    center.innerHTML = `<div class="panel-header"><strong>Notification history</strong><button class="action-btn" type="button" id="markAllNotifications">Mark all read</button></div>` + (notificationItems.map((item) => `<button class="notification-item ${item.read_at ? '' : 'unread'}" data-notification-id="${item.id}" type="button"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.message)} � ${escapeHtml(item.created_at || '')}</small></button>`).join('') || '<div class="empty-state">No notifications.</div>') + (notificationHasNext ? '<button class="action-btn notification-load-more" type="button" id="loadMoreNotifications">Load older notifications</button>' : '');
  };
  const loadNotifications = async (page = 1) => {
    const response = await fetch(`/api/notifications?page=${page}&pageSize=25`);
    if (!response.ok) {
      if (response.status === 401) {
        badge.textContent = '0';
        center.innerHTML = '<div class="empty-state">Sign in to view notifications.</div>';
      } else {
        center.innerHTML = '<div class="empty-state">Notifications could not be loaded.</div>';
      }
      return;
    }
    const data = await response.json();
    notificationPage = data.page || page;
    notificationHasNext = Boolean(data.hasNext);
    notificationItems = page === 1 ? (data.items || []) : notificationItems.concat(data.items || []);
    badge.textContent = data.unread || 0;
    renderNotifications();
  };
  center.addEventListener('click', async (event) => {
    const markAll = event.target.closest('#markAllNotifications');
    if (markAll) {
      const markResponse = await fetch('/api/notifications/read-all', { method: 'POST' });
      if (markResponse.ok) await loadNotifications(1);
      return;
    }
    const loadMore = event.target.closest('#loadMoreNotifications');
    if (loadMore) {
      loadMore.disabled = true;
      await loadNotifications(notificationPage + 1);
      return;
    }
    const item = event.target.closest('[data-notification-id]');
    if (item) {
      const readResponse = await fetch(`/api/notifications/${item.dataset.notificationId}/read`, { method: 'PATCH' });
      if (readResponse.ok) await loadNotifications(1);
    }
  });
  window.refreshNotificationCenter = loadNotifications;
  button.addEventListener('click', () => {
    const open = center.classList.contains('hidden');
    center.classList.toggle('hidden', !open);
    button.setAttribute('aria-expanded', String(open));
    if (open) loadNotifications();
  });
  loadNotifications(); setInterval(loadNotifications, 60000);
})();

const ACTIVE_STATUSES = new Set(['active', 'trial']);

function parseDate(value, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const date = new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getSubscriptionStatus(subscription, company = {}) {
  const now = new Date();
  const expiryDate = parseDate(subscription?.end_date, true);
  const startDate = parseDate(subscription?.start_date);
  const dateExpired = !expiryDate || expiryDate < now;
  const subscriptionStatus = dateExpired && ACTIVE_STATUSES.has(subscription?.status)
    ? 'expired'
    : String(subscription?.status || 'missing').toLowerCase();
  const status = company?.active === 0 ? 'company_inactive' : subscriptionStatus;
  const usable = Boolean(company?.active !== 0 && subscription && ACTIVE_STATUSES.has(subscriptionStatus) && !dateExpired);
  const daysRemaining = expiryDate
    ? Math.max(0, Math.ceil((expiryDate.getTime() - now.getTime()) / 86400000))
    : 0;

  return {
    companyId: company?.id == null ? null : Number(company.id),
    company: company?.name || null,
    plan: subscription?.plan_slug || subscription?.plan_name || null,
    status,
    companyActive: company?.active === 0 ? false : true,
    startDate: subscription?.start_date || null,
    expiryDate: subscription?.end_date || null,
    daysRemaining,
    usable
  };
}

function accessError(status) {
  if (status.status === 'expired') {
    return { code: 'SUBSCRIPTION_EXPIRED', message: 'Your subscription has expired. Please renew your subscription.' };
  }
  if (status.status === 'suspended') {
    return { code: 'SUBSCRIPTION_SUSPENDED', message: 'Your subscription is suspended. Please contact your administrator.' };
  }
  if (status.status === 'company_inactive') {
    return { code: 'COMPANY_INACTIVE', message: 'This company is inactive. Please contact your administrator.' };
  }
  return { code: 'SUBSCRIPTION_MISSING', message: 'Your subscription is not configured. Please contact your administrator.' };
}

module.exports = { getSubscriptionStatus, accessError };

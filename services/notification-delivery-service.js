const nodemailer = require('nodemailer');

const MAX_RETRIES = 3;

function createNotificationDeliveryService({ query, insert, update }) {
  const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_FROM);
  const whatsappConfigured = () => Boolean(process.env.WHATSAPP_API_URL && process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

  function renderTemplate(type, variables = {}) {
    const company = variables.companyName || 'your company';
    const expiry = variables.expiryDate || 'your subscription expiry date';
    const templates = {
      welcome: [`Welcome to TEMO AQUAFLOW, ${company}`, `Your company workspace is ready. Sign in to manage your ERP subscription and operations.`],
      subscription_expiring: [`Subscription expiring soon`, `Your subscription for ${company} expires on ${expiry}. Please contact your administrator to renew it.`],
      subscription_expired: [`Subscription expired`, `Your subscription for ${company} has expired. Please renew it to restore protected ERP access.`],
      payment_due: [`Payment due`, `A subscription payment for ${company} is due. Please review your billing page.`],
      payment_received: [`Payment received`, `A subscription payment for ${company} was recorded successfully.`],
      subscription_renewed: [`Subscription renewed`, `Your subscription for ${company} was renewed successfully.`],
      trial_expiring: [`Trial expiring soon`, `Your trial for ${company} expires on ${expiry}. Please contact your administrator.`],
      plan_changed: [`Subscription plan changed`, `The subscription plan for ${company} has changed to ${variables.planName || 'the selected plan'}.`]
    };
    return templates[type] || [`TEMO AQUAFLOW notification`, String(variables.message || '')];
  }

  async function sendEmail({ recipient, type, variables, subject, message }) {
    if (!smtpConfigured()) return { status: 'skipped', provider: 'smtp', errorMessage: 'SMTP is not configured.' };
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || '' } : undefined
      });
      const [templateSubject, templateMessage] = renderTemplate(type, { ...variables, message });
      await transporter.sendMail({ from: process.env.SMTP_FROM, to: recipient, subject: subject || templateSubject, text: message || templateMessage });
      return { status: 'sent', provider: 'smtp' };
    } catch (error) {
      return { status: 'failed', provider: 'smtp', errorMessage: error.message };
    }
  }

  async function sendWhatsAppNotification({ phone, type, variables }) {
    if (!whatsappConfigured()) return { status: 'skipped', provider: 'whatsapp_cloud', errorMessage: 'WhatsApp provider is not configured.' };
    try {
      const response = await fetch(process.env.WHATSAPP_API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'template', template: { name: variables.templateName || type, language: { code: variables.language || 'en_US' }, components: variables.components || [] } })
      });
      if (!response.ok) return { status: 'failed', provider: 'whatsapp_cloud', errorMessage: `Provider returned HTTP ${response.status}.` };
      return { status: 'sent', provider: 'whatsapp_cloud' };
    } catch (error) {
      return { status: 'failed', provider: 'whatsapp_cloud', errorMessage: error.message };
    }
  }

  async function recordDelivery({ companyId, notificationId, channel, recipient, result }) {
    const row = await insert(`INSERT INTO notification_deliveries
      (company_id, notification_id, channel, provider, recipient, status, provider_state, attempts, error_message, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
      [companyId, notificationId, channel, result.provider || channel, recipient || '', result.status, result.status === 'sent' ? 'accepted' : result.status === 'skipped' ? 'unavailable' : 'failed', result.errorMessage || null, result.status]);
    return { ...result, id: row.id, recipient };
  }

  async function retryFailedDelivery(deliveryId) {
    const delivery = (await query('SELECT d.*, n.type, n.message FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id WHERE d.id = ?', [deliveryId]))[0];
    if (!delivery || delivery.status === 'sent' || delivery.status === 'delivered') return { skipped: true, reason: 'already_delivered_or_missing' };
    if (Number(delivery.attempts || 0) >= MAX_RETRIES) return { skipped: true, reason: 'retry_limit_reached' };
    const result = delivery.channel === 'email'
      ? await sendEmail({ recipient: delivery.recipient, type: delivery.type, variables: {}, message: delivery.message })
      : await sendWhatsAppNotification({ phone: delivery.recipient, type: delivery.type, variables: {} });
    await update("UPDATE notification_deliveries SET attempts = attempts + 1, status = ?, provider_state = ?, error_message = ?, sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END WHERE id = ?", [result.status, result.status === 'sent' ? 'accepted' : result.status === 'skipped' ? 'unavailable' : 'failed', result.errorMessage || null, result.status, deliveryId]);
    return { ...result, retryLimit: MAX_RETRIES };
  }

  return { sendEmail, sendWhatsAppNotification, recordDelivery, retryFailedDelivery, renderTemplate, MAX_RETRIES };
}

module.exports = { createNotificationDeliveryService };

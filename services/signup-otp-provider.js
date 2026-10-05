// Preparation adapter only; public signup stays disabled until tenant-bound
// registration, rate limiting and live delivery acceptance are completed.
function createSignupOtpProvider(env = process.env, request = fetch) {
  const service = env.TWILIO_VERIFY_SERVICE_SID || '';
  const account = env.TWILIO_ACCOUNT_SID || '';
  const secret = env.TWILIO_AUTH_TOKEN || '';
  const configured = env.SIGNUP_OTP_PROVIDER === 'twilio_verify' &&
    /^VA[0-9a-fA-F]{32}$/.test(service) && /^AC[0-9a-fA-F]{32}$/.test(account) && !!secret;
  const failure = (code, status) => Object.assign(new Error(code), { code, status });
  async function call(action, fields) {
    if (!configured) throw failure('OTP_NOT_CONFIGURED', 503);
    let response;
    try {
      response = await request(`https://verify.twilio.com/v2/Services/${service}/${action}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Basic ${Buffer.from(account + ':' + secret).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      });
    } catch { throw failure('OTP_PROVIDER_UNAVAILABLE', 503); }
    if (!response.ok) throw failure(response.status === 429 ? 'OTP_RATE_LIMITED' : 'OTP_PROVIDER_REJECTED', response.status === 429 ? 429 : 503);
    try { return await response.json(); } catch { throw failure('OTP_PROVIDER_INVALID_RESPONSE', 503); }
  }
  function validatePhone(value) {
    if (typeof value !== 'string' || !/^\+[1-9]\d{7,14}$/.test(value)) throw failure('OTP_PHONE_INVALID', 400);
  }
  return {
    configured,
    async start(phone) {
      validatePhone(phone);
      const result = await call('Verifications', { To: phone, Channel: 'sms' });
      if (result.status !== 'pending' || !/^VE[0-9a-fA-F]{32}$/.test(result.sid || '')) throw failure('OTP_PROVIDER_INVALID_RESPONSE', 503);
      return { verificationId: result.sid, status: 'pending' };
    },
    async check(verificationId, code) {
      if (!/^VE[0-9a-fA-F]{32}$/.test(verificationId || '') || typeof code !== 'string' || !/^\d{4,10}$/.test(code)) throw failure('OTP_INPUT_INVALID', 400);
      const result = await call('VerificationCheck', { VerificationSid: verificationId, Code: code });
      return { approved: result.status === 'approved' && result.valid === true && result.sid === verificationId };
    },
  };
}
module.exports = { createSignupOtpProvider };

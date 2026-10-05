const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSignupOtpProvider } = require('../services/signup-otp-provider');
const sid = 'VE' + '1'.repeat(32);
const env = { SIGNUP_OTP_PROVIDER:'twilio_verify', TWILIO_VERIFY_SERVICE_SID:'VA'+'1'.repeat(32), TWILIO_ACCOUNT_SID:'AC'+'2'.repeat(32), TWILIO_AUTH_TOKEN:'fixture-secret' };
test('unconfigured OTP never calls network or accepts a code', async () => {
  const provider = createSignupOtpProvider({}, () => { throw Error('must not call'); });
  assert.equal(provider.configured,false);
  await assert.rejects(provider.start('+923001234567'),{code:'OTP_NOT_CONFIGURED'});
  await assert.rejects(provider.check(sid,'123456'),{code:'OTP_NOT_CONFIGURED'});
});
test('OTP accepts only matching approved verification, never provider errors', async () => {
  let result = { sid,status:'pending',valid:false };
  const provider=createSignupOtpProvider(env,async (url,options)=>{
    assert.ok(url.startsWith('https://verify.twilio.com/v2/Services/VA'));
    assert.equal(options.redirect,'error');
    return { ok:true,json:async()=>result };
  });
  assert.equal((await provider.start('+923001234567')).verificationId,sid);
  assert.equal((await provider.check(sid,'123456')).approved,false);
  result={sid,status:'approved',valid:true};
  assert.equal((await provider.check(sid,'123456')).approved,true);
  result={sid:'VE'+'3'.repeat(32),status:'approved',valid:true};
  assert.equal((await provider.check(sid,'123456')).approved,false);
  await assert.rejects(provider.start('03001234567'),{code:'OTP_PHONE_INVALID'});
  const failed=createSignupOtpProvider(env,async()=>({ok:false,status:429}));
  await assert.rejects(failed.check(sid,'123456'),{code:'OTP_RATE_LIMITED'});
});

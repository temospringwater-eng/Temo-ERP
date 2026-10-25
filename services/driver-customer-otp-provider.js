'use strict';
// Fail-closed customer-email OTP delivery. No OTP is returned via any API,
// shown to driver, written to logs or sent to staff. SMTP must report "sent".
const crypto = require('node:crypto');
const validId = n => Number.isSafeInteger(Number(n)) && Number(n) > 0;
const issueError = (status, message) => Object.assign(new Error(message), {status});
const maskEmail = value => {
  const [local,domain] = String(value).split('@');
  return local.slice(0,1) + '***@' + domain;
};
function createDriverCustomerOtpProvider({query,insert,sendEmail,writeAudit,randomCode}){
  if(![query,insert,sendEmail,writeAudit].every(f=>typeof f==='function'))
    throw Error('OTP provider dependencies missing');
  const generate = randomCode || (()=>String(crypto.randomInt(100000,1000000)));
  return async function issue({companyId,deliveryId,actorId,driverId=null,customerId=null,req}={}){
    if(![companyId,deliveryId,actorId].every(validId) ||
       (validId(driverId)===validId(customerId))) throw issueError(403,'OTP request denied');
    const driverScoped=validId(driverId);
    const rows=await query(`
      SELECT d.id, d.status, o.customer_id, c.email
      FROM deliveries d
      JOIN orders o ON o.id=d.order_id AND o.company_id=d.company_id
      JOIN customers c ON c.id=o.customer_id AND c.company_id=d.company_id
      WHERE d.id=? AND d.company_id=?
        AND ${driverScoped ? 'd.driver_id=?' : 'o.customer_id=?'}
    `,[Number(deliveryId),Number(companyId),Number(driverScoped?driverId:customerId)]);
    const delivery=rows[0];
    if(!delivery)throw issueError(404,'Assigned delivery not found');
    if(['delivered','partially_delivered','failed'].includes(delivery.status))
      throw issueError(409,'Delivery already closed');
    const email=String(delivery.email||'').trim();
    if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw issueError(503,'Customer email OTP delivery unavailable');
    const rate=(await query(`SELECT COUNT(*) AS n FROM delivery_otp_challenges
      WHERE company_id=? AND delivery_id=? AND created_at>=datetime('now','-1 hour')`,
      [Number(companyId),Number(deliveryId)]))[0];
    if(Number(rate?.n||0)>=3)throw issueError(429,'Too many OTP requests. Try later.');
    const otp=generate();
    if(!/^\d{6}$/.test(otp))throw issueError(503,'OTP provider unavailable');
    const sent=await sendEmail({
      recipient:email,type:'driver_delivery_otp',
      subject:'TEMO Delivery Verification Code',
      message:'Your TEMO delivery verification code is '+otp+
        '. It expires in 10 minutes. Do not share it with anyone except at delivery.'
    });
    if(sent?.status!=='sent')throw issueError(503,'Customer OTP delivery provider unavailable');
    const digest=crypto.createHash('sha256').update(otp).digest('hex');
    // Hash only; never persist OTP plaintext, email or provider secret in audit.
    const created=await insert(`INSERT INTO delivery_otp_challenges
      (company_id,delivery_id,customer_id,code_hash,expires_at,created_by)
      VALUES(?,?,?,?,datetime('now','+10 minutes'),?)`,
      [Number(companyId),Number(deliveryId),Number(delivery.customer_id),digest,Number(actorId)]);
    await writeAudit(req,'otp_requested','delivery',Number(deliveryId),null,{challengeId:created.id,delivery:'email'});
    return {challengeId:created.id,expiresInSeconds:600,maskedDestination:maskEmail(email)};
  };
}
module.exports={createDriverCustomerOtpProvider};

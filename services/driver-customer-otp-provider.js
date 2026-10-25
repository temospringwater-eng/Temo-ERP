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
function createDriverCustomerOtpProvider({query,insert,update,sendEmail,writeAudit,randomCode}){
  if(![query,insert,update,sendEmail,writeAudit].every(f=>typeof f==='function'))
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
    const otp=generate();
    if(!/^\\d{6}$/.test(otp))throw issueError(503,'OTP provider unavailable');
    const digest=crypto.createHash('sha256').update(otp).digest('hex');
    // Reserve one of three hourly delivery slots INSIDE ONE SQLite statement.
    // COUNT then INSERT in separate awaits previously allowed parallel OTP spam.
    const slots=await query(`INSERT INTO delivery_otp_challenges
      (company_id,delivery_id,customer_id,code_hash,expires_at,created_by)
      SELECT ?,?,?,?,datetime('now','+10 minutes'),?
      WHERE (SELECT COUNT(*) FROM delivery_otp_challenges
        WHERE company_id=? AND delivery_id=?
          AND created_at>=datetime('now','-1 hour')) < 3
      RETURNING id`,
      [Number(companyId),Number(deliveryId),Number(delivery.customer_id),digest,Number(actorId),
       Number(companyId),Number(deliveryId)]);
    if(slots.length!==1)throw issueError(429,'Too many OTP requests. Try later.');
    const challengeId=Number(slots[0].id);
    if(!validId(challengeId))throw issueError(503,'OTP provider unavailable');
    try{
      // Audit must be durable BEFORE provider delivery.
      await writeAudit(req,'otp_requested','delivery',Number(deliveryId),null,
        {challengeId,delivery:'email'});
      const sent=await sendEmail({
        recipient:email,type:'driver_delivery_otp',
        subject:'TEMO Delivery Verification Code',
        message:'Your TEMO delivery verification code is '+otp+
          '. It expires in 10 minutes. Do not share it with anyone except at delivery.'
      });
      if(sent?.status!=='sent')throw issueError(503,'Customer OTP delivery provider unavailable');
    }catch(_error){
      // Never leave a redeemable OTP when audit or SMTP delivery failed.
      // Preserve the reservation for anti-spam accounting even on provider failure.
      try{
        await update(`UPDATE delivery_otp_challenges
          SET expires_at=datetime('now','-1 second'),attempts=5
          WHERE id=? AND company_id=?`,[challengeId,Number(companyId)]);
      }catch(_ignored){ /* Provider stays unavailable: no success response. */ }
      throw issueError(503,'Customer OTP delivery provider unavailable');
    }
    return {challengeId,expiresInSeconds:600,maskedDestination:maskEmail(email)};
  };
}
module.exports={createDriverCustomerOtpProvider};

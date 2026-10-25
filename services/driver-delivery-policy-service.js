'use strict';
// Production policy remains conservative OTP ON. QA-only Company Admin setting
// requires authenticated same-tenant account; NEVER trust driver/client flags.
const safeDeliveryPolicy=()=>({otpRequired:true,signatureRequired:true});
const validId=id=>Number.isSafeInteger(Number(id))&&Number(id)>0&&String(id??'').trim()!=='';
async function readQaOtpRequired(query,companyId,qaEnabled=false) {
 if(!qaEnabled)return true;
 if(!validId(companyId))throw Error('Verified company identity required');
 const rows=await query('SELECT otp_required FROM driver_qa_company_verification_policy WHERE company_id=?',[Number(companyId)]);
 if(rows.length===0)return true;
 if(rows.length!==1||![0,1].includes(rows[0].otp_required))throw Error('Invalid company OTP policy');
 return rows[0].otp_required===1;
}
function createDriverDeliveryPolicyRoutes({app,query,update,qaEnabled=false}){
 if(!app||typeof app.get!=='function'||typeof query!=='function')
   throw new TypeError('Authenticated driver policy routes require ERP query and app');
 app.get('/api/driver/delivery-policy',async(req,res)=>{
   if(!req.user)return res.status(401).json({message:'Authentication required'});
   if(!['driver','delivery_driver'].includes(req.user.role)||
      !validId(req.user.id)||!validId(req.companyId))
     return res.status(403).json({message:'Driver access denied'});
   try {
     const rows=await query(`SELECT u.id FROM users u
       JOIN companies c ON c.id=u.company_id
       WHERE u.id=? AND u.company_id=? AND u.role=?
         AND u.active=1 AND c.active=1
         AND u.status='active' AND c.status='active'`,
       [Number(req.user.id),Number(req.companyId),req.user.role]);
     if(!rows.length)return res.status(403).json({message:'Driver or company inactive'});
     return res.json({otpRequired:await readQaOtpRequired(query,req.companyId,qaEnabled),
       signatureRequired:true});
   }catch(_error){return res.status(503).json({message:'Delivery policy unavailable'});}
 });
 if(qaEnabled){
   if(typeof app.put!=='function'||typeof update!=='function')
     throw Error('QA policy writes require update adapter and app');
   app.put('/api/admin/driver-delivery-policy',async(req,res)=>{
     if(!req.user||!validId(req.user.id)||!validId(req.companyId)||
       req.user.role!=='company_admin')
       return res.status(403).json({message:'Company Admin required'});
     if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||
       Object.keys(req.body).length!==1||typeof req.body.otpRequired!=='boolean')
       return res.status(400).json({message:'Explicit Boolean otpRequired required'});
     try{
       const active=await query(`SELECT u.id FROM users u JOIN companies c
         ON c.id=u.company_id WHERE u.id=? AND u.company_id=?
         AND u.role='company_admin' AND u.active=1 AND c.active=1`,
         [Number(req.user.id),Number(req.companyId)]);
       if(active.length!==1)return res.status(403).json({message:'Company Admin inactive'});
       await update(`INSERT INTO driver_qa_company_verification_policy(company_id,otp_required,updated_by)
         VALUES(?,?,?) ON CONFLICT(company_id) DO UPDATE SET
         otp_required=excluded.otp_required,updated_by=excluded.updated_by`,
         [Number(req.companyId),req.body.otpRequired?1:0,Number(req.user.id)]);
       return res.json({otpRequired:await readQaOtpRequired(query,req.companyId,true),
         signatureRequired:true});
     }catch(_error){return res.status(503).json({message:'Company OTP policy update unavailable'});}
   });
 }
}
module.exports={safeDeliveryPolicy,readQaOtpRequired,createDriverDeliveryPolicyRoutes};

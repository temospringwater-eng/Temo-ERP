'use strict';
// Conservative QA policy bridge until Company Admin OTP toggle and proof/ledger
// write transactions are verified against a disposable Express/SQLite ERP.
// DO NOT accept flags from the mobile client to disable verification.
const safeDeliveryPolicy=()=>({otpRequired:true,signatureRequired:true});
const validId=id=>Number.isSafeInteger(Number(id))&&Number(id)>0&&String(id??'').trim()!=='';

function createDriverDeliveryPolicyRoutes({app,query}){
 if(!app||typeof app.get!=='function'||typeof query!=='function')
   throw new TypeError('Authenticated driver policy routes require ERP query and app');
 app.get('/api/driver/delivery-policy',async(req,res)=>{
   if(!req.user) return res.status(401).json({message:'Authentication required'});
   if(!['driver','delivery_driver'].includes(req.user.role)||
      !validId(req.user.id)||!validId(req.companyId))
     return res.status(403).json({message:'Driver access denied'});
   try{
     const rows=await query(`
       SELECT u.id FROM users u
       JOIN companies c ON c.id=u.company_id
       WHERE u.id=? AND u.company_id=? AND u.role=?
         AND u.active=1 AND c.active=1
         AND u.status='active' AND c.status='active'
     `,[Number(req.user.id),Number(req.companyId),req.user.role]);
     if(!rows.length)return res.status(403).json({message:'Driver or company inactive'});
     return res.json(safeDeliveryPolicy());
   }catch(_error){
     return res.status(503).json({message:'Delivery verification policy unavailable'});
   }
 });
}
module.exports={safeDeliveryPolicy,createDriverDeliveryPolicyRoutes};

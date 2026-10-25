'use strict';
// QA-only demonstration adapter. Deliberately NOT attached to deployed Cloudflare Worker.
// An upstream server-verified JWT/session resolver MUST be injected; NEVER trust
// a company/driver ID from HTTP input, QA test headers, or body.
import {inspectD1ReadOnly} from './d1-erp-readiness-qa.mjs';
const validId=id=>Number.isSafeInteger(id)&&id>0;
const json=(value,status)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export function createD1DriverReadOnlyHandler({resolveActor}={}){
 if(typeof resolveActor!=='function')throw new Error('A trusted identity resolver is required');
 return async function readOnlyDriverQa(request,env){
  if(request?.method!=='GET')return json({message:'Read-only QA endpoint'},405);
  let url;try{url=new URL(request.url)}catch(_err){return json({message:'Invalid URL'},400);}
  const match=/^\/api\/driver\/deliveries\/([1-9]\d*)$/.exec(url.pathname);
  if(!match)return json({message:'Route not found'},404);
  const deliveryId=Number(match[1]);
  if(!validId(deliveryId))return json({message:'Invalid delivery ID'},400);
  let actor;
  try{actor=await resolveActor(request,env);}catch(_err){return json({message:'Authentication required'},401);}
  if(!actor||!validId(actor.id)||!validId(actor.companyId)||!['driver','delivery_driver'].includes(actor.role))
   return json({message:'Authentication required'},401);
  if(!env?.DB?.prepare)return json({message:'ERP QA database unavailable'},503);
  try{
   const structure=await inspectD1ReadOnly(env.DB,['deliveries','users']);
   const required={
    deliveries:['id','company_id','order_id','driver_id','status'],
    users:['id','company_id','role','active']
   };
   if(Object.entries(required).some(([table,cols])=>cols.some(col=>!structure.columns[table]?.includes(col))))
     return json({message:'ERP QA schema incomplete'},503);
   const statement=env.DB.prepare(
    "SELECT id,company_id,order_id,driver_id,status FROM deliveries "+
    "WHERE id=? AND company_id=? AND driver_id=? "+
    "AND EXISTS (SELECT 1 FROM users WHERE id=? AND company_id=? "+
    "AND active=1 AND role IN ('driver','delivery_driver')) LIMIT 1");
   const row=await statement.bind(deliveryId,actor.companyId,actor.id,actor.id,actor.companyId).first();
   if(!row)return json({message:'Assigned delivery not found'},404);
   return json({id:row.id,company_id:row.company_id,order_id:row.order_id,driver_id:row.driver_id,status:row.status},200);
  }catch(_error){return json({message:'ERP QA query unavailable'},503);}
 };
}

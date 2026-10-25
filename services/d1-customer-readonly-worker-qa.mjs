'use strict';
// TEST ONLY. Customer identity must be established by the existing verified
// portal auth middleware. Never use this as a standalone public Worker route.
import {inspectD1ReadOnly} from './d1-erp-readiness-qa.mjs';
const validId=n=>Number.isSafeInteger(n)&&n>0;
const json=(body,status)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
});
export function createD1CustomerReadOnlyHandler({resolveActor}={}){
 if(typeof resolveActor!=='function')throw Error('Trusted customer identity resolver required');
 return async function customerOrdersQA(request,env){
  if(request?.method!=='GET')return json({message:'Read-only QA endpoint'},405);
  let parsed;
  try{parsed=new URL(request.url);}catch(_error){return json({message:'Invalid URL'},400);}
  const match=/^\/api\/customer\/orders\/([1-9]\d*)$/.exec(parsed.pathname);
  if(!match)return json({message:'Route not found'},404);
  const orderId=Number(match[1]);
  if(!validId(orderId))return json({message:'Invalid order ID'},400);
  let actor;
  try{actor=await resolveActor(request,env);}catch(_error){return json({message:'Authentication required'},401);}
  if(!actor||actor.role!=='customer'||!validId(actor.companyId)||!validId(actor.customerId))
   return json({message:'Authentication required'},401);
  if(!env?.DB?.prepare)return json({message:'ERP QA database unavailable'},503);
  try{
   const inventory=await inspectD1ReadOnly(env.DB,['orders']);
   for(const column of ['id','company_id','customer_id','status'])
    if(!inventory.columns.orders?.includes(column))return json({message:'ERP QA schema incomplete'},503);
   const order=await env.DB.prepare('SELECT id,company_id,customer_id,status FROM orders WHERE id=? AND company_id=? AND customer_id=? LIMIT 1')
    .bind(orderId,actor.companyId,actor.customerId).first();
   if(!order)return json({message:'Order not found'},404);
   return json({id:order.id,company_id:order.company_id,customer_id:order.customer_id,status:order.status},200);
  }catch(_error){return json({message:'ERP QA query unavailable'},503);}
 };
}

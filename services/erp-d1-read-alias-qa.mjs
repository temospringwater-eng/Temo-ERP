// ERP Cloudflare D1 isolated QA read alias adapter.
// Allows *verified* company admin to read three documented column aliases
// from existing D1 schema, without duplicating user/payment records or writing data.
// Never derives missing collected_amount or product.stock, never enables finance sync.
const STOP=message=>{throw Error('STOP: isolated ERP D1 alias '+message)};
const pos=x=>Number.isSafeInteger(x)&&x>0;
const money=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&
  Number.isSafeInteger(Math.round(x*100))&&Math.round(x*100)/100===x;
const methods=new Set(['cash','card','transfer','bank_transfer','other']);
const statuses=new Set(['completed','pending','failed','cancelled']);
export async function readErpD1QaCoreAliases({env,token,verifyJwt,paymentId,deliveryId}={}){
 if(env?.TEMO_ERP_D1_ENV!=='isolated-qa'||env?.TEMO_ERP_D1_QA_READONLY!=='1'||
    !env.DB||typeof env.DB.prepare!=='function')
  STOP('disabled or missing QA-only Worker D1 binding');
 if(typeof verifyJwt!=='function'||typeof token!=='string'||token.length<8||
    !pos(paymentId)||!pos(deliveryId))
  STOP('verified admin identity and scoped payment IDs required');
 let claims;
 try{claims=await verifyJwt(token)}catch{STOP('unverified actor')}
 const actorId=claims?.userId??claims?.sub;
 if(!pos(actorId))STOP('unverified actor');
 let user,company,payment;
 try{
  user=await env.DB.prepare('SELECT id,company_id,role,is_active FROM users WHERE id=?')
   .bind(actorId).first();
  if(!user||user.id!==actorId||user.role!=='company_admin'||
    user.is_active!==1||!pos(user.company_id))STOP('inactive or unauthorized company admin');
  company=await env.DB.prepare('SELECT id,is_active FROM companies WHERE id=?')
   .bind(user.company_id).first();
  if(!company||company.id!==user.company_id||company.is_active!==1)
   STOP('inactive or unverified tenant');
  payment=await env.DB.prepare(
   'SELECT id,company_id,delivery_id,amount,payment_method,status FROM payments WHERE id=? AND company_id=? AND delivery_id=?'
  ).bind(paymentId,user.company_id,deliveryId).first();
 }catch(error){
  if(error?.message?.startsWith('STOP:'))throw error;
  STOP('company-scoped read or D1 schema not verified');
 }
 if(payment){
  if(payment.id!==paymentId||payment.company_id!==user.company_id||
     payment.delivery_id!==deliveryId||!money(payment.amount)||
     !methods.has(payment.payment_method)||!statuses.has(payment.status))
   STOP('payment alias invalid: no inferred financial balance');
 }
 return Object.freeze({qaOnly:true,readOnly:true,readyForFinancePosting:false,
  company:Object.freeze({id:company.id,active:company.is_active}),
  user:Object.freeze({id:user.id,companyId:user.company_id,role:user.role,active:user.is_active}),
  payment:payment?Object.freeze({id:payment.id,companyId:payment.company_id,
   deliveryId:payment.delivery_id,amount:payment.amount,method:payment.payment_method,
   status:payment.status}):null});
}

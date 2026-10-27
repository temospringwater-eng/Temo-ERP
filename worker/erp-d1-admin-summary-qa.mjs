// Dedicated, unmounted Cloudflare Workers + D1 ERP read-only QA slice.
// Does not deploy or expose route until isolated QA Worker configuration is approved.
const PATH='/api/erp/qa/summary';
const headers={'Cache-Control':'no-store','Content-Type':'application/json'};
const error=(status,message)=>new Response(JSON.stringify({error:message}),{status,headers});
const int=x=>typeof x==='number'?Number.isSafeInteger(x)&&x>0:
 typeof x==='string'&&/^[1-9]\d*$/.test(x)&&Number.isSafeInteger(Number(x));
export async function handleErpQaAdminSummary(request,env,verifyJwt){
 const url=new URL(request.url);
 if(url.pathname!==PATH)return null;
 if(env?.TEMO_ERP_D1_QA_READONLY!=='1'||
    env?.TEMO_ERP_D1_ENV!=='isolated-qa'||
    !env?.DB||typeof env.DB.prepare!=='function')return error(404,'QA D1 route disabled');
 if(request.method!=='GET')return error(405,'Method not allowed');
 if(url.search||url.hash)return error(400,'Query filtering is not permitted');
 const bearer=/^Bearer ([A-Za-z0-9._~+\/=-]+)$/.exec(request.headers.get('Authorization')||'');
 if(!bearer||typeof verifyJwt!=='function')return error(401,'Authentication required');
 let claims;
 try{claims=await verifyJwt(bearer[1]);}catch{return error(401,'Invalid session');}
 const userId=claims?.userId??claims?.sub;
 if(!int(userId))return error(401,'Invalid session');
 try{
  const user=await env.DB.prepare(
   'SELECT id,company_id,role,is_active FROM users WHERE id=?'
  ).bind(Number(userId)).first();
  if(!user||user.role!=='company_admin'||user.is_active!==1||!int(user.company_id))
   return error(403,'Forbidden');
  const company=await env.DB.prepare(
   'SELECT id,is_active FROM companies WHERE id=?'
  ).bind(user.company_id).first();
  if(!company||company.is_active!==1)return error(403,'Forbidden');
  const scoped=user.company_id;
  // Server-side authority always comes from DB membership; ignore user-supplied
  // company_id/role or any query parameter. All SQL is constant SELECT only.
  const [customers,pending,deliveries]=await Promise.all([
   env.DB.prepare('SELECT COUNT(*) AS total FROM customers WHERE company_id=?').bind(scoped).first(),
   env.DB.prepare("SELECT COUNT(*) AS total FROM orders WHERE company_id=? AND status IN ('pending','assigned')").bind(scoped).first(),
   env.DB.prepare('SELECT COUNT(*) AS total FROM deliveries WHERE company_id=?').bind(scoped).first()
  ]);
  if([customers?.total,pending?.total,deliveries?.total].some(x=>!Number.isSafeInteger(x)||x<0))
   return error(503,'QA D1 read unavailable');
  return new Response(JSON.stringify({companyId:scoped,customers:customers.total,
   pendingOrders:pending.total,deliveries:deliveries.total}),{status:200,headers});
 }catch{return error(503,'QA D1 read unavailable');}
}

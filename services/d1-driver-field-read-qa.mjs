// QA ONLY: native D1 read contracts for TEMO DRIVER. Not a login provider, not deployed.
// Caller MUST inject a server-verified identity resolver. Never accept actor headers.
const permissions = Object.freeze([
  'create_customer','create_order','view_customer_ledger',
  'collect_recovery','view_zone','view_van_stock'
]);
const positiveId = n => Number.isSafeInteger(n) && n > 0;
const json = (body,status=200) => new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'}
});
const error = (status,code) => json({error:code},status);
const knownPaths = new Set([
  '/api/driver/permissions','/api/driver/bottle-types',
  '/api/driver/field/customers','/api/driver/field/products',
  '/api/driver/field/zones','/api/driver/field/van-stock'
]);
function getRoute(path){
  if(knownPaths.has(path))return {path};
  const match=/^\/api\/driver\/field\/customers\/([1-9]\d*)\/ledger$/.exec(path);
  if(!match)return null;
  const customerId=Number(match[1]);
  return positiveId(customerId)?{path:'ledger',customerId}:null;
}
function run(db,statement,...args){
  // All statements are static and read-only. D1 does not use sqlite3 callbacks.
  return db.prepare(statement).bind(...args);
}
async function rows(db,statement,...args){
  const result=await run(db,statement,...args).all();
  if(!result||result.success===false||!Array.isArray(result.results))throw Error('D1 read unavailable');
  return result.results;
}
async function one(db,statement,...args){
  const result=await run(db,statement,...args).first();
  return result||null;
}
const customerScope=`(
 EXISTS(SELECT 1 FROM driver_field_customer_assignments a
  WHERE a.company_id=c.company_id AND a.customer_id=c.id AND a.driver_id=?)
 OR EXISTS(SELECT 1 FROM orders o JOIN deliveries d
  ON d.order_id=o.id AND d.company_id=o.company_id
  WHERE o.company_id=c.company_id AND o.customer_id=c.id AND d.driver_id=?)
 OR EXISTS(SELECT 1 FROM customer_service_areas cs JOIN service_area_drivers sd
  ON sd.company_id=cs.company_id AND sd.service_area_id=cs.service_area_id
  WHERE cs.company_id=c.company_id AND cs.customer_id=c.id AND sd.driver_id=?)
)`;
async function scopedCustomer(db,actor,id){
  return one(db,`SELECT c.id FROM customers c WHERE c.id=? AND c.company_id=? AND ${customerScope}`,
    id,actor.companyId,actor.id,actor.id,actor.id);
}
export function createD1DriverFieldReadQaHandler({resolveActor}={}){
  return async function handle(request,env){
    if(!request||!env||env.TEMO_ERP_D1_FIELD_QA_MODE!=='1')return error(404,'not_found');
    let url;
    try{url=new URL(request.url);}catch{return error(404,'not_found');}
    const route=getRoute(url.pathname);
    if(!route||url.search)return error(404,'not_found');
    if(request.method!=='GET')return error(405,'method_not_allowed');
    if(typeof resolveActor!=='function')return error(503,'auth_unavailable');
    let actor;
    try{actor=await resolveActor(request,env);}catch{return error(401,'unauthorized');}
    // trusted === true is only a caller contract; a real Worker must validate
    // signed session/JWT first. The resolver is never sourced from HTTP headers.
    if(actor?.trusted!==true||!positiveId(actor.id)||!positiveId(actor.companyId)||
      !['driver','delivery_driver','company_admin'].includes(actor.role))
      return error(401,'unauthorized');
    const db=env.DB;
    if(typeof db?.prepare!=='function')return error(503,'qa_d1_unavailable');
    try{
      const current=await one(db,`SELECT u.id FROM users u JOIN companies c ON c.id=u.company_id
       WHERE u.id=? AND u.company_id=? AND u.role=? AND u.active=1 AND c.active=1`,
       actor.id,actor.companyId,actor.role);
      if(!current)return error(403,'account_inactive');
      const enabled=await rows(db,`SELECT permission,enabled FROM driver_field_permissions
        WHERE company_id=? AND driver_id=?`,actor.companyId,actor.id);
      const grants=Object.fromEntries(permissions.map(p=>[p,false]));
      for(const p of enabled){if(Object.hasOwn(grants,p.permission))grants[p.permission]=p.enabled===1;}
      const requirePerm=(key)=>actor.role==='company_admin'||grants[key]===true;
      if(route.path==='/api/driver/permissions')return json({driverId:actor.id,companyId:actor.companyId,permissions:grants});
      if(route.path==='/api/driver/bottle-types'){
        const items=await rows(db,'SELECT id,name FROM products WHERE company_id=? ORDER BY id LIMIT 200',actor.companyId);
        return json({companyId:actor.companyId,items});
      }
      if(route.path==='/api/driver/field/customers'){
        const items=await rows(db,`SELECT c.id,c.name,c.phone,c.address,c.latitude,c.longitude
          FROM customers c WHERE c.company_id=? AND ${customerScope} ORDER BY c.id DESC LIMIT 500`,
          actor.companyId,actor.id,actor.id,actor.id);
        return json({companyId:actor.companyId,items});
      }
      if(route.path==='/api/driver/field/products'){
        if(!requirePerm('create_order'))return error(403,'permission_denied');
        const items=await rows(db,'SELECT id,name,sale_price,stock FROM products WHERE company_id=? ORDER BY name LIMIT 200',actor.companyId);
        return json({companyId:actor.companyId,items});
      }
      if(route.path==='ledger'){
        if(!requirePerm('view_customer_ledger'))return error(403,'permission_denied');
        if(!await scopedCustomer(db,actor,route.customerId))return error(404,'assigned_customer_not_found');
        const total=await one(db,`SELECT COALESCE(SUM(CASE WHEN entry_type IN ('invoice','debit')
          THEN amount ELSE -amount END),0) AS balance FROM credit_ledger WHERE company_id=? AND customer_id=?`,
          actor.companyId,route.customerId);
        const balance=Number(total?.balance);
        if(!Number.isFinite(balance))throw Error('invalid balance');
        const items=await rows(db,`SELECT id,entry_type,amount,note,due_date,created_at FROM credit_ledger
          WHERE company_id=? AND customer_id=? ORDER BY id DESC LIMIT 100`,actor.companyId,route.customerId);
        return json({companyId:actor.companyId,customerId:route.customerId,balance:Math.round(balance*100)/100,items});
      }
      if(route.path==='/api/driver/field/zones'){
        if(!requirePerm('view_zone'))return error(403,'permission_denied');
        const zones=await rows(db,`SELECT sa.id,sa.name,sa.level FROM service_areas sa JOIN service_area_drivers sd
          ON sd.company_id=sa.company_id AND sd.service_area_id=sa.id
          WHERE sa.company_id=? AND sd.driver_id=? AND sa.active=1 ORDER BY sa.name LIMIT 100`,actor.companyId,actor.id);
        const routes=await rows(db,`SELECT r.id,r.name,r.route_date,rs.sequence,rs.delivery_id,rs.status AS stop_status
          FROM delivery_routes r LEFT JOIN delivery_route_stops rs ON rs.route_id=r.id AND rs.company_id=r.company_id
          WHERE r.company_id=? AND r.driver_id=? ORDER BY r.route_date DESC,rs.sequence LIMIT 200`,actor.companyId,actor.id);
        return json({companyId:actor.companyId,zones,routes});
      }
      if(route.path==='/api/driver/field/van-stock'){
        if(!requirePerm('view_van_stock'))return error(403,'permission_denied');
        const items=await rows(db,`SELECT v.product_id,p.name,SUM(v.quantity) AS quantity FROM driver_field_van_movements v
          JOIN products p ON p.id=v.product_id AND p.company_id=v.company_id
          WHERE v.company_id=? AND v.driver_id=? GROUP BY v.product_id,p.name ORDER BY p.name`,actor.companyId,actor.id);
        return json({companyId:actor.companyId,items});
      }
      return error(404,'not_found');
    }catch{return error(503,'qa_d1_query_unavailable');}
  };
}

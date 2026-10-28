// QA-only delivery preflight: validates proof and ownership; no financial or stock writes.
const validId=n=>Number.isSafeInteger(n)&&n>0;
const validProof=p=>p&&typeof p.signatureRef==='string'&&p.signatureRef.length>=8&&
 typeof p.photoRef==='string'&&p.photoRef.length>=8&&
 Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&
 Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180;
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export function createD1DeliveryPreflightQaHandler({db,authenticate}){
 if(!db?.prepare||typeof authenticate!=='function')throw Error('Verified D1 auth required');
 return async request=>{
  const path=new URL(request.url).pathname;
  const match=/^\/api\/driver\/deliveries\/(\d+)\/preflight$/.exec(path);
  if(!match||request.method!=='POST')return json(404,{error:'not_found'});
  const actor=await authenticate(request);
  if(!actor||actor.role!=='driver'||!validId(actor.companyId)||!validId(actor.driverId))
   return json(403,{error:'forbidden'});
  let body;try{body=await request.json()}catch{return json(400,{error:'invalid_json'})}
  if(!validProof(body)||!validId(Number(match[1])))return json(400,{error:'signature_photo_gps_required'});
  try{
   const delivery=await db.prepare(
    "SELECT id,status FROM deliveries WHERE id=? AND company_id=? AND driver_id=? AND status IN ('assigned','out_for_delivery')"
   ).bind(Number(match[1]),actor.companyId,actor.driverId).first();
   if(!delivery)return json(404,{error:'assigned_delivery_not_found'});
   return json(200,{eligible:true,deliveryId:delivery.id,postingEnabled:false,proofMode:'signature_photo_gps'});
  }catch{return json(503,{error:'delivery_preflight_unavailable'})}
 };
}

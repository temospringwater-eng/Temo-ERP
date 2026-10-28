// QA-only D1 driver inventory reads. No deployment, delivery completion or finance writes.
const valid = n => Number.isSafeInteger(n) && n > 0;
export function createD1DriverInventoryQaHandler({db,authenticate}) {
 if (!db?.prepare || typeof authenticate !== 'function') throw Error('D1 and verified driver auth required');
 return async request => {
  const url=new URL(request.url);
  if(request.method!=='GET'||url.pathname!=='/api/driver/van-stock')
   return new Response(JSON.stringify({error:'not_found'}),{status:404});
  const actor=await authenticate(request);
  if(!actor||!valid(actor.companyId)||!valid(actor.driverId)||actor.role!=='driver')
   return new Response(JSON.stringify({error:'forbidden'}),{status:403});
  try {
   const result=await db.prepare(
    'SELECT b.product_id AS productId,p.name AS productName,b.quantity FROM van_stock_balances b JOIN products p ON p.id=b.product_id AND p.company_id=b.company_id WHERE b.company_id=? AND b.driver_id=? ORDER BY b.product_id LIMIT 200'
   ).bind(actor.companyId,actor.driverId).all();
   if(result?.success===false||!Array.isArray(result?.results))throw Error('D1 unavailable');
   return new Response(JSON.stringify({items:result.results}),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
  }catch{return new Response(JSON.stringify({error:'inventory_unavailable'}),{status:503});}
 };
}

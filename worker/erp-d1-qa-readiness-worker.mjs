// Isolated QA-only Worker entrypoint, never deployed to active Cloudflare.
// Exact internal readiness route only. No admin finance or customer API mounted.
// D1 is read-only introspected with private diagnostic secret; no schema writes.
import {createErpD1QaReadinessHandler} from '../services/erp-d1-worker-readiness-qa.mjs';
const handler=createErpD1QaReadinessHandler();
const notFound=()=>new Response(JSON.stringify({error:'not_found'}),{
 status:404,headers:{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'}
});
export default {
 async fetch(request,env){
  let path;
  try{path=new URL(request.url).pathname}catch{return notFound()}
  if(path!=='/internal/qa/erp-d1-readiness')return notFound();
  return handler(request,env);
 }
};

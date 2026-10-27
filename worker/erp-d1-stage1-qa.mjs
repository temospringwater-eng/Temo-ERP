// QA ONLY — actual Cloudflare Worker entrypoint for isolated native Wrangler D1 tests.
// NOT configured as a deployed/active ERP API, finance posting or customer route.
// Requires the D1 DB binding, isolated QA mode and a private 32+ byte token.
import {createErpD1QaReadinessHandler} from '../services/erp-d1-worker-readiness-qa.mjs';
const handle=createErpD1QaReadinessHandler();
export default {
 async fetch(request,env){
  // Route/method/auth/QA mode checks remain centralized in the fail-closed handler.
  // Unknown paths and missing permissions return 404; no customer financial writes.
  return handle(request,env);
 }
};

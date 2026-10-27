# Workers/D1 ERP API migration — first Company Admin read slice (QA only)

The canonical ERP target is Cloudflare Workers + D1, not a separate Node/Express host.

## Migrated in this PR
- `worker/erp-d1-admin-summary-qa.mjs` is a **standalone, not-yet-mounted** Worker-compatible request handler.
- With the exact `TEMO_ERP_D1_QA_READONLY=1`, `TEMO_ERP_D1_ENV=isolated-qa` flags and `env.DB` D1 binding, `GET /api/erp/qa/summary` returns only aggregate customers, pending/assigned orders and deliveries, scoped to the **server-authoritative company ID from the active `users` and `companies` D1 rows**.
- It requires an externally provided verified JWT callback; invalid/missing bearer, inactive users/companies, Driver accounts, spoofed company/role claims, query filters and invalid D1 mappings fail closed. All queries are parameter-bound SELECT statements; there are no finance, stock, deposit or customer-row writes.
- `tests/erp-d1-admin-summary.integration.test.cjs` uses disposable SQLite to exercise this Worker route, role/tenant isolation and expected SQL with mandatory CI. These tests do not prove that the active Cloudflare Worker has this route. **No Worker deployment, live API registration, D1 binding updates or migrations are made**.

## Next steps before live QA
1. Verify exact Cloudflare D1 binding/schema and active Worker version (Driver read-only schema audit CI).
2. Implement a Workers-compatible JWT verifier and restricted isolated QA Worker router; validate token expiry and existing ERP semantics with TDD before mounting.
3. Add broader ERP read APIs and then migration of atomic ledger mutation within canonical ERP D1. Test exact currency precision and idempotency, negative stock, bottle/credit balance and rollback.
4. Back up QA D1 with Time Travel/export, check mapping and execute isolated full cycle on synthetic data. Only then perform reviewed deployment with explicit approval.

Status: **first backend migration slice implemented in repository; real Cloudflare ERP migration and financial sync NOT complete**.

# Phase 2C — Private D1 → Central ERP Finance Sync (QA)
Status: **server transport built and tested with disposable SQLite**. NOT live ERP financial sync.

> **Transition-only QA adapter (27 October 2026):** The target is **Cloudflare Workers + one canonical ERP D1 per environment**, not an independently hosted Node ERP service. This HTTP-to-local-SQLite finance bridge is retained as tested QA migration/reconciliation code only while separate databases may exist. Never claim its successful SQLite tests mean live D1 finance synchronization. See [Cloudflare D1 architecture](CLOUDFLARE-WORKERS-D1-ARCHITECTURE.md).

## Contract
D1 source builds `{event,signature}` directly from company/driver-owned completed delivery, evidence, successful offline sync and payment records. Source HMAC key is *separate* from service-to-service transport HMAC key.

D1 sends UTF-8 JSON over explicitly allowlisted HTTPS POST `/internal/qa/d1-driver-finance`, with `x-temo-qa-timestamp` and `x-temo-qa-auth`. MAC is HMAC-SHA256(transport key, decimal 13-digit timestamp + LF + SHA256(raw body)). Server accepts only 5-minute-old or fresher signed requests, JSON body up to 32 KB, isolated QA database, explicit QA mode, and correctly signed source receipt. Raw-body parsing is **route-local**, not Express global. Authenticated success returns `{ok:true,receipt}`, plus `x-temo-qa-ack-time` and `x-temo-qa-ack` signing the actual response bytes with the same independent transport key.

ERP posts delivery, payment, invoice debit, customer credit, bottle, stock and GPS evidence **inside BEGIN IMMEDIATE** with idempotency. If the response is lost, D1 sends identical source JSON; central ERP rechecks the original ledgers before ACK. D1 only marks queue 'acknowledged' after verifying the response MAC, response IDs and status. No untrusted Android endpoint supplies the source HMAC.

## Pre-deployment gates
1. Provision actual **isolated central ERP QA host**, firewall or private tunnel, TLS and service-only authorization. No transport route is registered on `server.js` by this PR. NEVER expose the adapter on production ERP.
2. Provide two independent 32+ byte keys via encrypted runtime secrets: `TEMO_D1_ERP_BRIDGE_SECRET` for proof receipts, separate `TEMO_D1_ERP_TRANSPORT_SECRET` for HTTP authorization/ACK. Do not commit or log them.
3. Run backup/restore drill for both QA D1 and disposable central ERP QA SQLite. Install additive queue migration with reviewed script, not auto-migrate active D1.
4. Operator review of company, driver, order, delivery, customer and bottle crosswalk IDs **before any financial write**. The default mapping policies are `blocked`; enable warehouse-on-delivery and new-order-invoice only when no earlier stock deduction/invoice exists.
5. Stage authorized synthetic delivery and verify source receipt → private POST → ERP ledger posting → ACK → D1 queue. Simulate network outage after ERP commit, retry exactly once, verify no duplicate stock, bottle, cash or credit entries. Simulate malicious replay, wrong company, insufficient stock, missing proof, failed restore.
6. Activate customer data only after manual reconciliation sign-off, backup verification, real Android offline proof tests and audit requirements. Until then, **0 live customer finance records synchronized**.

## Files and tests
- `services/driver-finance-http-qa.js`: isolated POST/ACK layer, deliberately **not mounted** in production.
- `services/driver-financial-bridge-qa.js`: existing atomic ledger posting, reconciliation and replay.
- `tests/driver-finance-http-qa.integration.test.cjs`: signed transport, stale requests, forged ACK, disabled prod, HTTP→real disposable SQLite finance posting & retry.
- D1 repository: `qa-backend/driver-finance-outbox-qa.mjs`, `migrations/qa-driver-finance-outbox.sql`.

**Do not claim live D1↔ERP database synchronization from passing synthetic QA tests.**

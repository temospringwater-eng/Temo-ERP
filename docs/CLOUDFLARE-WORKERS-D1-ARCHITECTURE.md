# TEMO Architecture Decision — Cloudflare Workers + D1

**Decision 27 October 2026:** Cloudflare Workers + D1 is the approved platform for ERP, Driver API, and future Customer API. No separately hosted Node/Express ERP server is part of the target rollout. This supersedes the earlier private persistent-disk QA host proposal. Do **not** publish a new Worker or mutate live D1 as part of this decision.

## Source-of-truth design

- **One canonical ERP D1 database per environment** (separate QA D1 and, only after release gates, production D1). Its company-scoped ERP schema owns customers, orders, deliveries, invoices, payments, credit, bottle deposits/returns, van/warehouse stock and audit logs. A matching Worker binding (e.g. `env.DB`) is required for the relevant isolated ERP Worker. The exact binding/database identity must be verified; do not infer it from an account or app name.
- ERP web UI can be hosted as Cloudflare static assets/Pages; ERP API moves to a Workers-compatible route/service layer. Driver Android app calls tenant/role-restricted Worker routes; customer portal/app follows the same central ERP authority.
- **Prefer having ERP and Driver Workers use the same canonical D1 per environment** once tenant mapping and compatibility have been proven. This eliminates duplicated independent customer financial ledgers. The existing Driver QA D1 is **not yet proved to be the canonical ERP D1**. Existing D1 data and its Worker routes must be backed up, audited and migrated safely before a binding is changed.
- Where Driver QA D1 and ERP QA D1 remain **separate during transition**, there is **no distributed transaction** covering both databases. Use existing signed receipts, idempotent outbox/replay, tenant crosswalks, and read-back reconciliation as a *temporary isolated QA migration bridge*. Do not imply single-database atomicity across distinct D1 instances. When unified, make each full delivery/finance write atomic **within its owning D1** using supported D1 prepared statements and `env.DB.batch()` where appropriate.
- **Never treat Cloudflare D1 as a file-hosting server.** D1 is the SQL datastore; Cloudflare Workers is the API runtime. Main ERP's current `server.js` uses Node Express, `sqlite3`, `DB_PATH`, and `app.listen()`, which are **not directly portable** to a D1 Worker. Its current local SQLite tests and backup scripts remain useful for development but are not evidence of actual D1 deployment.

## Required implementation and rollout steps

1. **Audit (read only):** inventory current Worker versions, bindings, D1 database IDs and schema; compare to ERP local SQL schema and all Driver QA migrations. Map every company, driver, user, customer, order, delivery, product, bottle type and warehouse ID. No source secrets, customer rows or unapproved writes.
2. **Isolated Cloudflare QA:** create/verify a **separate QA D1** and Worker preview, with explicit `env.DB` binding, company isolation and synthetic fixture data. Any database creation, deployment or binding change requires review of target identity; never overwrite current production resources.
3. **Migrate ERP backend incrementally:** extract pure domain/accounting services out of Express and replace synchronous/callback `sqlite3` query adapters with Workers-compatible asynchronous D1 prepared queries. Keep auth sessions, tenancy, strong passwords, billable plans, permissions, files and identity semantics intact. TDD+unit+integration required for each adapted module.
4. **Migrate schema/data safely:** review SQL differences, indexes, foreign keys, row size/limits, and import/export compatibility. Raw `hayrila.db` is **not** directly uploaded to D1; use reviewed SQL export/migration. First use synthetic fixtures; before any real import, independently verify backup/export, migration rollback, counts, FK integrity and identical balances.
5. **Atomic finance QA:** complete assigned delivery → required signature/photo/GPS → payment full/partial/credit → bottle ledger/stock → central ERP D1 posting → read-back into Android. Use primary-backed or session-consistent reads as needed. Prevent duplicates on retries and reject negative stock, cross-company writes and unauthorized overrides. Reconcile all movements and cash closing.
6. **Cloudflare rollout:** fix active QA Worker policy 404 using reviewed preview/deployment version, smoke authenticated routes, retain a tested rollback, and do real Android offline reboot/retry field QA. No customer notifications by default.
7. **Production:** explicit operator approval, separate production D1, verified D1 Time Travel bookmark and export, recovery drill in non-production, app/API compatibility and monitored limited pilot. No customer finance posting without sign-off.

## D1-specific backup and cost gates

- D1's **Time Travel** provides point-in-time restore, not the local file snapshot process. Current Cloudflare documentation lists a 7-day recovery window on Workers Free and 30-day on Workers Paid; check the actual account plan and D1 version before relying on this. A Time Travel **restore overwrites the target database** and must never be used against live D1 as a test.
- Create safe exports for long-term recovery where needed; store encrypted/off-site, restrict access, and verify restore only against disposable QA resources. Retain exact D1 database IDs and version evidence in private operator records.
- Verify storage, query, number-of-database and other account quotas before adding tenants or production data. No automatic paid-plan upgrades or Cloudflare billing changes.
- Previously merged `scripts/qa-sqlite-online-backup.py` and local TLS staging scripts are **legacy local-QA/test utilities only**. They do not back up Cloudflare D1 and no longer constitute target hosting Phase 1 sign-off.

## Non-negotiable gate

**Current status: migration not started in deployed Cloudflare ERP; zero live customer financial receipts synchronized.** The original Node ERP continues locally and Driver Worker QA exists separately. Tests, TDD, D1 migration parity, cloud version and real staged delivery reconciliation must pass before production changes. No external Node-hosting service, no live import, no destructive changes.

Official references:
- Cloudflare D1 Workers binding: https://developers.cloudflare.com/d1/worker-api/d1-database/
- D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
- D1 import/export: https://developers.cloudflare.com/d1/best-practices/import-export-data/
- D1 Time Travel: https://developers.cloudflare.com/d1/reference/time-travel/

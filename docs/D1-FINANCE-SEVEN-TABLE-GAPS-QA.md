# TEMO Phase 1→2 D1 Finance Schema Blocker Register
Verified: 27 October 2026. [Master Plan](TEMO-ERP-DRIVER-MASTER-PLAN.md)

## Current live **QA D1** facts (read only)
- Driver Cloudflare QA Worker `temo-erp-qa-api` has a verified named D1 binding `DB` to `temo_erp_qa_db`, and JWT secret metadata is present. The database contains **19 tables**.
- Current QA D1 has the core preexisting driver operations schema but is **not yet the complete canonical ERP D1**.
- Four essential central ERP finance tables are **absent**: `credit_ledger`, `stock_movements`, `bottle_movements`, `driver_finance_outbox`.
- Their parent schema prerequisites `sales`, `warehouses`, `bottles` are also **absent**, for **7 missing tables total**. These gaps were verified by metadata-only live Cloudflare SQL, not guessed.
- Evidence: [Live Worker D1 19-table finance-gap audit](https://github.com/babar200/TEMO-Driver-Android-QA/actions/runs/40461246861) and [Live D1 finance parent dependencies audit](https://github.com/babar200/TEMO-Driver-Android-QA/actions/runs/40462632770).

## Safe implementation completed in source
- [Driver PR #67](https://github.com/babar200/TEMO-Driver-Android-QA/pull/67): isolated D1 SQLite additive **four finance ledgers**, idempotency key, FK, schema compatibility and no-destructive-DDL tests; **not applied to live D1**.
- [Driver PR #71](https://github.com/babar200/TEMO-Driver-Android-QA/pull/71): synthetic **three parent tables** plus complete seven-table migration order and rollback protection. Merge status and Android CI must be confirmed independently before marking done.
- [ERP PR #41](https://github.com/temospringwater-eng/Temo-ERP/pull/41): first Workers-compatible `env.DB` schema-readiness adapter (private QA, metadata-only, not mounted or deployed). Existing Express/sqlite3 ERP remains locally runnable but **not automatically Workers-compatible**.

## Do not directly migrate active D1 yet
A migration must **not** be attempted on the current `temo_erp_qa_db` until an isolated data export, D1 Time Travel bookmark and disaster recovery drill are verified. Live D1 may contain genuine customer data; never use these synthetic SQL examples as permission to mutate it. Verify schema constraints/indexes against actual existing parent tables, exact database binding UUID, tenant IDs, product IDs, invoice and stock movement semantics. No cash, invoice, bottle or delivery entries should be posted until all seven tables, proof validation, idempotency and rollback checks pass on a separate synthetic QA clone.

## Next ordered gates
1. Run updated QA Worker **read-only active version and API** probe; resolve active-vs-uploaded proof-v2 mismatch only through reviewed preview and rollback, no unapproved deployment.
2. On separately isolated **synthetic D1**, after backup/recovery and explicit operator approval, apply versioned additive migration **parent 3 → ledger 4**. Read back schema and `PRAGMA foreign_key_check` with tenant isolation tests.
3. Port central ERP domain/route adapters incrementally from Node/Express `sqlite3` to Cloudflare Workers `env.DB`, with mandatory TDD unit/integration on every module; do not upload raw `hayrila.db`.
4. Reconcile full order→driver signature/photo/GPS→cash/credit→bottle/stock→central ledger→Android status using one canonical ERP D1. During any temporary dual D1 stage, HMAC/outbox ACK is migration-only, never a distributed transaction.
5. Test Android physical device and offline replay, no duplicate stock/payment, role/tenant isolation, admin cash verification; **explicitly approve** production migrations and writes only once reconciliation is signed off.

**Status:** Migration scripts and synthetic checks are code-level QA only. Cloudflare QA D1 7-table gap, active Worker deployment, full Worker ERP migration, and live finance sync remain BLOCKED. Avoid false "complete" or invented progress percentages.

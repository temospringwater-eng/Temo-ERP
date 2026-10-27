# D1 QA migration 0001 — plan (NOT applied; awaiting owner approval)

Files: `migrations/d1-qa/0001_erp_sales_finance_stock_sync_additive.sql` (8 tables: sales, sale_items, warehouses, stock_movements, bottles, bottle_movements, credit_ledger, offline_sync_operations + indexes; `IF NOT EXISTS` only, no ALTER/DROP/DML) and `0001_rollback_DISPOSABLE_ONLY.sql`.
Test: `node --test tests/d1-qa-migration-0001.test.mjs` (idempotent re-run, ERP column coverage, data preserved, per-company idempotency key, rollback).

## Verified locally
Migration test passes on a disposable SQLite DB built from the pinned 114-table ERP schema.

## NOT verified (blockers)
- No Cloudflare credentials/D1 binding in this sandbox: remote authorization, backup/export, Time Travel bookmark, and the 114-table remote column/FK/index diff were NOT performed. Paid invoice does not prove API access.
- Remote diff of existing 11 overlapping tables (and `driver_finance_outbox`, absent per docs) is still required; the 7-table list is not assumed complete.
- Existing `sales`-dependent `company_id` backfill and FK targets (companies, customers, users, products, payments) must be checked remotely.
- Android compatibility (babar200/TEMO-Driver-Android-QA) and Driver Deliveries/Bottle Types/Offline Sync Status API checks need that repo + live Worker access; not done.
- Pre-existing failing local test: tests/bootstrap-security.test.js (server start timeout/port).

## Remote plan (after approval)
1. Operator runs `wrangler whoami` and confirms DB binding UUID for `temo_erp_qa_db`.
2. `wrangler d1 export temo_erp_qa_db --remote --output backup.sql`; record `wrangler d1 time-travel info`; verify checksum and restore drill on a disposable D1.
3. Read-only schema diff (`PRAGMA table_xinfo/foreign_key_list/index_list`) vs the 114-table manifests.
4. Apply on a disposable D1 clone; run tests; then `wrangler d1 execute temo_erp_qa_db --remote --file=migrations/d1-qa/0001_...sql` only with explicit approval.
5. Read back schema, `PRAGMA foreign_key_check`; live financial posting stays disabled.

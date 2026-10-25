# ERP -> Cloudflare D1 schema parity (QA-only, 25 October 2026)

## Evidence and scope
- The pictured D1 QA database has 11 application tables; the ERP server source has 116 CREATE TABLE declarations. Eight names overlap; names alone prove no column compatibility.
- 115 ERP base tables are defined in isolated literal db.run CREATE TABLE statements. One, document_records_v4, is part of a destructive document copy/rebuild; never run that migration on D1 without a dedicated data migration.
- Additional columns, ALTERs, indexes, triggers and imported service DDL require separate migration ordering. The 115 baseline table definitions are NOT a complete runnable replacement for ERP runtime initialization.
- The live D1 database has not been accessed in this PR. No migrations, deployments, credentials, records, or Worker bindings were changed.

## Code
- services/d1-schema-parity-qa.mjs extracts the pinned literal baseline DDL from server.js, reads D1 schema metadata ONLY, compares table columns/types/defaults/PK, FKs, unique index declarations, and returns a blocked-by-default disposable migration proposal.
- tests/d1-schema-parity-qa.test.mjs exercises the exact source DDL in a disposable in-memory SQLite database, compares against a synthetic 11-table D1, preserves a synthetic customer row, rejects mismatched/extra tables, and checks no schema audit executes writes.
- It never inserts into production, blindly runs 108 CREATE TABLE statements on the existing 11-table D1, merges accounting ledgers, or weakens authentication.

## Live read-only preflight (authorized owner only)
Before any staging write, obtain a schema-only export from the actual Cloudflare database; do not commit or paste a full data export, JWTs, credentials or private records:

    npx wrangler d1 export temu_erp_qa_db --remote --output=./d1-schema-only.sql --no-data

Or open the D1 SQL console and run read-only schema queries:

    SELECT name, type, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' ORDER BY type,name;
    PRAGMA table_xinfo('companies');
    PRAGMA table_xinfo('users');
    PRAGMA table_xinfo('deliveries');
    PRAGMA table_xinfo('orders');
    PRAGMA foreign_key_list('deliveries');
    PRAGMA index_list('deliveries');

Schema-only export still includes internal DDL; keep it private. Exports can temporarily block concurrent D1 traffic, so use an approved quiet window.

## Gate before changing D1
1. Read-only introspection of actual D1 columns, indexes, FKs and triggers, and of the current runtime ERP schema after all its upgrades; reconcile those before deriving migration SQL.
2. Export full backup to a protected location or obtain a restorable point-in-time bookmark; confirm restoration path and data ownership. Do not put customer rows on GitHub.
3. Build a new separate disposable D1 database, apply reviewed ordered baseline/ALTER/index migrations and data mapping; run PRAGMA foreign_key_check, tenant isolation and ledger parity.
4. Reconcile overlapping 8 tables by column and row ID, resolve three D1-only structures (bottle_returns, inventory, sync_queue), and map the remaining ERP tables without overwriting live rows.
5. Confirm Company Admin, Driver, Customer use one authoritative transactional datastore. Verify OTP, signature proof, order/payment/stock/bottle posting, retries/idempotency, schema rollback and physical Android E2E.
6. Only after successful synthetic and staging QA, approval and backup verification can a D1 production migration be proposed.

No automatic production cutover: Node/Express/SQLite and D1 are different live stores. A table-count match is not equivalent to an integrated ERP.

References:
https://developers.cloudflare.com/d1/best-practices/import-export-data/
https://developers.cloudflare.com/d1/reference/time-travel/

# Cloudflare canonical ERP D1 — verified QA gap register (27 October 2026)

**State: BLOCKED for live ERP finance.** No production D1 import or financial writes approved. Cloudflare Workers+D1 (not external Node hosting) remains the target.

## Read-only live evidence
The QA D1 was identified by the active Driver Worker `DB` binding and validated by exact database identity. Queries inspected **only** `sqlite_master` table names and `PRAGMA table_info`, never customer or money rows:
- Existing QA D1 physical tables: **19**.
- Main ERP `server.js` table DDL inventory: **115** distinct tables, pinned by blob SHA `9c50af888076342f9a794ac5193832c7887341e0`.
- Central ERP tables already present in QA D1: **8**.
- Central ERP tables missing from QA D1: **107**.
- Existing Driver QA-specific tables are not automatically ERP schema equivalents; two databases are not proven unified as canonical ERP finance.

**Critical finance table gaps** observed: `warehouses`, `stock_movements`, `credit_ledger`, `delivery_bottle_counts`, `bottle_movements`, `sales`, `sale_items`. `bottle_returns` is present for Driver QA operations but is a **D1-specific** source concept rather than one of the central ERP 115 DDL tables; do not treat it as a replacement for stock/bottle accounting.

Evidence:
- [Live D1 115-table parity audit — PASS, reported readiness BLOCKED](https://github.com/babar200/TEMO-Driver-Android-QA/actions/runs/40462301601)
- [First Workers D1 admin summary integration PR #40](https://github.com/temospringwater-eng/Temo-ERP/pull/40)
- [Additive four-table finance schema blueprint PR #67](https://github.com/babar200/TEMO-Driver-Android-QA/pull/67)

## Required migration order — do not skip gates

1. **QA D1 recovery & source integrity:** identify exact database UUID/binding, Time Travel bookmark, D1 SQL export and restore to disposable *separate* QA D1 only. Test FK integrity, original row counts, zero writes to currently active D1. Snapshot/export must be securely stored and access restricted.
2. **Parent/schema compatibility:** compare SQLite column types and FK behaviors for `companies`, `customers`, `users`, `products`, `orders`, `deliveries`, `payments`. Prepare additive QA SQL for missing `warehouses`, `bottles`, `sales`, `sale_items` with versioned migrations, indexes and explicit company scopes. No blind primary key reuse.
3. **Financial dependent tables:** only after those parent objects exist and match ERP semantics, stage `stock_movements`, `credit_ledger`, `delivery_bottle_counts` and `bottle_movements` with audit, tenant constraints, negative stock blocking, money precision, bottle deposits and idempotency. Existing four-table blueprint is a **test-only proposal**, not a live migration.
4. **Workers migration:** gradually replace Express/`sqlite3` route/query adapters with `env.DB` async prepared statements; preserve verified JWT, role/company isolation, password semantics and Company Admin controls. The new unmounted admin summary endpoint is the first isolated read-only slice, **not** a production ERP API.
5. **Full delivery reconciliation:** synthetic ERP order → assigned driver → signature/photo/fresh GPS → delivered/partial/credit → stock/bottles/cash closing → single canonical ERP D1 atomic posting → Android read-back. Test retry, dual-delivery conflict, rollback and cross-company tampering.
6. **Review go-live:** promote reviewed QA Worker version only after active-preview provenance, signed deployment, 404 API smoke tests, backup/restore and complete financial read-back. Production D1 remains unchanged until explicit release approval.

## Safety status

- No public external Node host or Render service is part of the plan.
- No actual D1 migration, binding switch, customer data edit or live finance synchronization was performed by this audit.
- Do not conflate passing unit/integration tests with verified production availability.
- Maintain standing **TDD + unit tests + integration tests** for every change.

**Next engineering task:** prerequisite ERP `warehouses` / `sales` / `bottles` / `sale_items` QA migration review and dependency/FK tests; do not apply to active Worker D1 yet.

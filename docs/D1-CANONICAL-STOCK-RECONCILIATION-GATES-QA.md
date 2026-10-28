# D1 canonical finance and stock reconciliation gates (QA)

Status: implementation checklist only; no remote D1 mutation or live finance sync authorized.

## Invariants
1. Each environment has exactly one canonical Cloudflare D1 finance ledger. Legacy SQLite HTTP bridge is transition-only QA evidence; never activate as a second finance authority.
2. `products.stock` represents **central warehouse** on-hand only. Driver van stock must have a separate company-scoped van ledger and balance, never be inferred from warehouse stock.
3. Warehouse-to-van loading: one atomic D1 operation decreases warehouse and increases van by equal quantity. Driver delivery decreases van stock only. Van return reverses the transfer. Damaged bottles require a distinct reasoned movement. No negative balance without a separately authorized, audited exception.
4. Every movement is scoped by company, driver/van, product and stable source operation ID. Retry of identical operation returns the original receipt without reposting. Same ID with different payload is a conflict.
5. Cash, customer credit, bottle balances, warehouse stock and van stock post atomically with a completed delivery and required proof references (signature, photo, GPS or audited GPS exception). Never acknowledge offline sync before durable commit.
6. Ledger-derived balance must equal materialized balance for every company/product/location. No cross-tenant IDs, no duplicate invoice or stock deductions.

## Mandatory TDD sequence
- RED: add tests for warehouse-to-van conservation, delivery van-only debit, insufficient van stock, duplicate retry, conflicting replay, tenant isolation, bottle over/under-return, offline retry after lost ACK, and transaction rollback.
- GREEN: implement D1 transactional handlers and migrations against a disposable local D1/SQLite-compatible fixture only.
- REFACTOR: run unit, integration, migration idempotency and API contract tests; attach command output and commit SHA to PR.
- Remote QA: require verified D1 binding, backup/export + restore drill, read-only 114-table schema diff and explicit owner approval before any additive remote migration. Verify deployed Driver Deliveries, Bottle Types, Offline Sync Status endpoints separately.
- Production: blocked until Android physical-device E2E, cash/bottle/stock reconciliation and CI are green.

## Do not do
No remote migration, live customer finance posting, production deployment, secret disclosure or auto-merge based solely on this document.

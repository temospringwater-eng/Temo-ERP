# TEMO AQUAFLOW / D1 central SQL readiness — QA audit, 2026-10-25

## Exact evidence vs unknowns

User Cloudflare screenshots on October 25 show D1 database temu_erp_qa_db with 11 **application** tables:
bottle_returns, companies, customers, deliveries, inventory, order_items, orders, payments, products, sync_queue, users.
A twelfth table, sqlite_sequence, is internal and not an ERP application table. Screenshots show 81.92 KB current storage and 0 writes in the observed last 24-hour period; they are not an authenticated live API snapshot.

The current GitHub ERP Express server (source branch before this QA PR) contains **116 distinct CREATE TABLE** definitions, based on a pinned, generated inventory in tests/fixtures/erp-schema-table-names.json. Exactly 8 names overlap with the screenshot. Three D1 names (bottle_returns, inventory, sync_queue) are NOT part of those 116 Express table definitions; the remaining 108 ERP names are absent from the screenshot's table-name list. Similar names do not imply identical schemas, data, primary keys or permissions.

**Action**: STOP migrations and production cutover until read-only column inspection confirms actual table layout and legacy schema is mapped into one authoritative central store. No need to buy another database before this audit.

## Read-only Cloudflare D1 queries (for a verified owner session only)

From the D1 console, select the correct database and use ONLY these SELECT/PRAGMA statements:

1. SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;
2. PRAGMA table_info('companies');
3. PRAGMA table_info('users');
4. PRAGMA table_info('orders');
5. PRAGMA table_info('deliveries');
6. PRAGMA table_info('payments');
7. PRAGMA table_info('customers');
8. PRAGMA foreign_key_list('deliveries');

Do NOT run INSERT, UPDATE, DELETE, DROP, REPLACE, ALTER or CREATE on existing D1 data before signed-off migrations/backups. Query no customer rows or password hashes. The code in services/d1-erp-readiness-qa.mjs can run only when injected with a permitted D1 binding and returns schema names/columns, not application records; it is not attached to a production Worker and has no API route.

## Reused backend without duplicating the accounting store

- Existing full ERP: Node/Express + local native sqlite3 file; 116 table definitions and many business modules.
- Existing Cloudflare QA D1: small database with overlapping 8 names, NOT a complete migration of Express ERP.
- New services/d1-driver-readonly-worker-qa.mjs: deliberately **unmounted** read-only QA handler for GET /api/driver/deliveries/:id, requires an injected externally verified driver resolver and checks company_id, driver_id, active user role. Never trusts company/driver IDs provided by request parameters.
- New services/d1-customer-readonly-worker-qa.mjs: likewise unmounted read-only QA handler GET /api/customer/orders/:id, requires a verified customer portal resolver and company/customer isolation.
- These are compatibility examples, NOT substitutes for the real auth layer or complete delivery/payment/OTP/stock atomic integration. The current Express schema must be reconciled, then **ONE** database and API should be the source of truth for ERP Admin, Driver Android and Customer App.

## ERP website

- QA website preview: public/erp-landing-qa.html. Fully responsive standalone HTML/CSS with English blue/white TEMO AQUAFLOW branding, core product workflows, visible progress and functional anchor/login links.
- Real login path remains /index.html (existing ERP frontend); no imaginary registration endpoints or price quotes are shown.
- Security fix in same QA branch removes prefilled legacy admin/admin123 inputs from public/index.html, while leaving the back-end bootstrap credential protections intact.
- Production domain erp.temospringwater.com has NOT been routed or published by this QA change. Creating a file in GitHub is NOT a deployed website.

## Acceptance gates — before production approval

1. Inspect actual D1 table columns, indexes, foreign keys, triggers, migration history and backups on an authorized account.
2. Pin exact source schema migration, test it with synthetic data in a separate disposable D1 database, with reversible/multi-company isolation and two-way reconciliation reports. Never auto-apply 108 missing CREATE TABLE statements to QA.
3. Prove shared auth across Company Admin, verified Driver JWT and Customer Portal sessions; test revoked identities and inter-company access.
4. Prove OTP success/failure, signature proof storage, single atomic delivery/order/payment/bottle writes and retries/offline sync using Cloudflare's supported D1 atomic transaction mechanisms. Do not fork the payment ledger into two databases.
5. Run native APK → live QA Worker → D1 E2E on a physical Android; verify TLS, offline restart/retry, duplicate protection and role permissions.
6. Secure durable signature/photo storage, secret management, D1 backup/restore, audit retention, monitoring and domain mapping.
7. Independently approve production deployment and cutover. No DNS, customer data, billing or credentials changed through this work.

## Testing

- ERP TDD test: tests/d1-erp-readiness-website.test.mjs checks photographed names against the exact pinned schema inventory; synthetic D1 read-only schema queries and company/driver/customer read isolation; website accessibility/responsiveness and no hardcoded login values.
- Cross-repo test runner: babar200/TEMO-Driver-Android-QA Draft PR #26 (isolated, temporary QA-only test snapshots). Original ERP Actions minute budget is exhausted.
- Previous exact ERP OTP + atomic ledger + synthetic HTTP harness passed 31/31 tests under GitHub Actions run 40195368836; those tests do NOT validate live Cloudflare D1 migration or full Express startup.

Official Cloudflare API references:
https://developers.cloudflare.com/d1/worker-api/
https://developers.cloudflare.com/d1/worker-api/d1-database/
https://developers.cloudflare.com/d1/sql-api/foreign-keys/
https://developers.cloudflare.com/d1/reference/migrations/

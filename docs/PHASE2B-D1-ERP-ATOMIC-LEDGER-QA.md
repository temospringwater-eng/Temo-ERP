# Phase 2B — Central ERP ↔ Cloudflare D1 Driver Financial Bridge (QA)
Status 2026-10-26: **unit + disposable SQLite QA integration; no production route or live cross-system posting**.

## Safety architecture
- **Central ERP is the financial source of truth.** Cloudflare D1 delivery completion is a separate database transaction.
- Do **not** assume the D1 company/user/order/delivery primary keys match central ERP. `driver_finance_bridge_map` requires independent operator-reviewed mappings.
- Cloudflare worker QA module `qa-backend/driver-erp-finance-receipt.mjs` builds a canonical JSON envelope **from authoritative D1 records**, verifying completed delivery, correct company/driver, applied idempotency operation, SHA-256 proof assets and GPS, and payment consistency. It HMAC-SHA256 signs the exact JSON bytes with a **dedicated secret** shared through secure runtime settings, never a client or repo secret.
- Central ERP QA importer validates HMAC, proof metadata, GPS bounds, mapped identities, order status, invoice and inventory policy, stock availability and conflicting existing postings.
- A **single `BEGIN IMMEDIATE` ERP SQLite transaction** updates delivery and order, creates exactly one new-order debit and collected-payment credit in `credit_ledger`, inserts `payments`, deducts ERP product stock, records `stock_movements`, `delivery_bottle_counts` and `bottle_movements`, and stores signature/photo evidence, GPS and the immutable bridge receipt. SQL error triggers full rollback.
- `UNIQUE(d1_company_id,d1_delivery_id)` and `UNIQUE(company_id,source_key)` stop duplicate posting; identical signed replays return the original receipt. Changed payload for an already applied D1 delivery fails.
- `inventory_policy='warehouse_on_delivery'` and `invoice_policy='new_order_invoice'` are **manual QA mapping decisions**. They must NEVER be auto-approved: van stock already debited or an existing invoice would cause double booking.
- The source HMAC signing module is **not exposed to the public Android app** and cannot be called with Android-provided proof claims. Deploying Worker signing requires separate authenticated service authorization and isolated QA secret provisioning.

## How QA import works
On a disposable `*qa*.db` with manually installed schema and reviewed mapping, supply a private trusted D1-signed `{event,signature}` JSON envelope. The operator-gated CLI `scripts/qa-driver-financial-bridge-import.cjs` requires:
`NODE_ENV=test`, `TEMO_FINANCE_BRIDGE_QA=1`, `DB_PATH=/path/to/disposable-qa.db`, `TEMO_BRIDGE_RECEIPT_FILE=/private/receipt.json`, `TEMO_D1_ERP_BRIDGE_SECRET=<private HMAC key>`.
Do not commit actual secrets or real customer data. No schema is installed, no mapping generated and no DB path outside QA accepted automatically.

## Still required before real deliveries
1. Independently approve a secure D1-to-ERP outbox/ack transport with a 32+ byte server-only HMAC secret, key rotation, and service-to-service authentication. Neither the live Worker nor central ERP has this transport enabled.
2. Verify Company Admin mapping ownership, existing sales/invoice posting semantics, van-stock policy and bottle reference data for each tenant using anonymized/authorized test data.
3. Full staging E2E (D1 signed source → ERP QA import → receipt/financial inventory reconciliation → outbox ack), including network loss after posting, retries, conflict resolution and backups.
4. Physical Android GPS/photo/signature and offline sync QA, operator access, production backup/restore and deployment sign-off.
**Do not turn on customer financial posting until all gates pass.**

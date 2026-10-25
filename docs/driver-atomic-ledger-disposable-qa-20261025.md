# TEMO Driver – Disposable SQLite atomic ledger QA

**Status: QA implementation only. Not an active ERP endpoint and not a production migration.**

Files: `services/driver-atomic-ledger-qa.js` and `tests/driver-atomic-ledger.test.cjs`.

### Reproduce independently
```bash
node --experimental-sqlite --test tests/driver-atomic-ledger.test.cjs
```

The suite uses a new `:memory:` SQLite database per test with synthetic companies, drivers,
customers, bottles, orders, deliveries and OTP challenges. No secrets, real customers,
production database connections, Cloudflare Worker, real proof uploads or network calls.

**Verified in a disposable local Node 22 environment on 2026-10-25: 8/8 tests passed.**
GitHub CI result must be evaluated independently; a job that failed before its steps ran
cannot be called green.

### Scenarios included
1. Valid OTP and pre-registered server signature bind one delivery, order, cash receipt,
   bottle movement, proof, audit and idempotency record in one transaction.
2. Same key and same request can retry without duplicate financial postings.
3. Reused key with altered payload and second key on a completed delivery fail closed.
4. An injected payment INSERT failure rolls back every related write, including OTP verification.
5. Cross-company, wrong role and wrong driver assignment reject financial writes.
6. Invalid/expired OTP cannot write ledgers; invalid attempts are tracked.
7. Unknown signature proof ID, foreign bottle, negative cash/counts are rejected.
8. Stale order/delivery baseline cannot complete or consume an OTP.

### Remaining integration blockers
- This is a synchronous `node:sqlite` **test adapter**, NOT connected to the existing
  asynchronous `sqlite3` runtime in `server.js`.
- Before connecting this service, implement a transaction-safe production adapter on
  a **separate connection** with `BEGIN IMMEDIATE`, transaction-scoped query methods,
  safe locking and rollback; test with the actual SQLite schema in an isolated DB.
- Native proof upload must register immutable bytes, company/driver/delivery ownership,
  SHA-256 and storage key in a durable trusted table. Synthetic QA inserts here
  do NOT establish that real proof uploads are verified.
- Configure and test a real approved customer OTP sender. The current ERP OTP
  creation route is not evidence of third-party delivery.
- Admin-configurable OTP-OFF policy must remain unavailable until backend atomicity,
  signature verification and server-side permission checks are validated.
- Implement online and offline idempotent API adapter and verify the exact
  delivery ID, order ID, company ID and `completed` receipt.
- Central ERP production/main, D1, customer data and active Workers remain unchanged.
  No merge/deploy without owner approval and evidence-based E2E QA.

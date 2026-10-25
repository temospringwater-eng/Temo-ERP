# TEMO Driver / ERP — No-card Cloudflare feasibility (2026-10-25)

**Decision:** Cloudflare Workers + D1 is a technically feasible **future driver API backend**, but it is **not** a drop-in hosting target for the current full Express/SQLite ERP. No deployment or paid services are authorized by this review.

## Verified baseline

- The central ERP repository uses Express 4, Node `sqlite3` (native), a local persistent `hayrila.db` file, server-managed private proof uploads, sessions and per-company ledgers.
- Stacked, unmerged QA PRs #6–#9 provide OTP provider, verified signature registry and dedicated SQLite transactional posting, guarded for `NODE_ENV=test` and a separately supplied disposable DB path.
- GitHub account `temospringwater-eng` hit its 2,000/2,000 included Actions minutes on 2026-10-23. Alternative account `babar200` can run the **exact pinned isolated tests** in draft Android QA PR #25.
- Verified alternate runner: https://github.com/babar200/TEMO-Driver-Android-QA/actions/runs/40195368836; **31/31** passing (12 OTP, 10 atomic ledger, 6 file-backed adapter, 3 synthetic HTTP lifecycle tests). This is an isolated harness, NOT full ERP Express boot or physical APK E2E.

## Cloudflare platform constraints (official sources)

- Workers Free: 100,000 requests/day, 10 ms CPU time per request, 128 MB memory; check subrequest limits for integrations.
  https://developers.cloudflare.com/workers/platform/limits/
- D1 Free: 10 databases, 500 MB maximum per DB, 5 GB total storage, 5 million rows read/day and 100,000 rows written/day.
  https://developers.cloudflare.com/d1/platform/limits/
  https://developers.cloudflare.com/d1/platform/pricing/
- D1 is accessed via a Worker binding, not by opening the current local `sqlite3.Database('hayrila.db')` file.
  https://developers.cloudflare.com/d1/
- Workers' virtual `node:fs` filesystem is **ephemeral** across requests; existing private proof PNG/JPEG files will need durable object storage or another compatible durable service.
  https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/
- D1 provides SQLite SQL semantics but transaction and prepared statement APIs differ from the legacy `sqlite3` adapter. Do not treat the existing multi-call `BEGIN IMMEDIATE` implementation as an automatically portable D1 transaction.

## Safe implementation sequence — no production data

1. Keep central ERP as the sole financial source of truth until a complete replacement is independently tested. Do **not** post the same driver delivery to two independent stores.
2. Extract only a **QA driver API** contract to a new, private Worker/D1 environment, with a separate test-only tenant and no actual customer, payment or credential data.
3. Port authentication, per-company role checks, OTP challenge state, trusted uploaded signatures, delivery transition, payment and bottle movement accounting, and idempotent receipt as one coherent database lifecycle. Validate atomicity with D1-supported methods, constraints and intentional failure injection.
4. Select and verify a durable private binary proof store; use signed, tenant-scoped access, size caps, hashes and retention. Do not store files in ephemeral `/tmp` or publicly accessible static assets.
5. Run positive, concurrent retry, tenant crossover, revoked-driver, failed OTP/provider, stale delivery, false-receipt, and rollback tests against a **disposable remote D1** database. Confirm actual Android APK → new Worker endpoint integration on phone.
6. Prepare verified database backup, migration/rollback plan, and complete session + route parity before planning any production cutover. Require explicit owner approval for provisioning that can create charges, deployment, DNS change or live ERP data movement.

## Not verified / not approved

- No actual Worker/D1 database provisioned or deployed by this plan.
- No real OTP SMS or email delivery performed; provider credentials are absent from this repo.
- No full Express application transplanted; existing Node native dependencies, file system, session persistence and storage must be redesigned where needed.
- No Render payment/billing retry; no live company data mutation.
- Workers Free and D1 quotas may be insufficient for an entire ERP deployment; estimate real traffic and run synthetic load tests before promising persistent service.

**Near-term recommendation:** maintain private native driver QA and GitHub Actions synthetic tests on the accessible runner; prefer the existing read-only QA Worker for smoke testing. Only pursue a *separate QA Worker/D1 driver backend* after an explicit test-only design, rather than porting the full ERP prematurely.

# TEMO ERP + Driver Android + D1 Sync — Unified Master Delivery Plan

**Baseline:** 27 October 2026. **Owner:** TEMO Spring Water. **Primary repository:** `temospringwater-eng/Temo-ERP`. **Driver repository:** `babar200/TEMO-Driver-Android-QA`.

**Target platform: Cloudflare Workers + D1 for ERP, Driver API and future Customer API.** No external Node-server hosting. D1 is the database and Workers run the APIs; `server.js` (Express / `sqlite3`) still needs migration and cannot be deployed unchanged. See [Cloudflare architecture decision](CLOUDFLARE-WORKERS-D1-ARCHITECTURE.md).

**One source of truth for the remaining roadmap.** This document merges the original 8-stage ERP concept, subsequent commercial SaaS scope, Tarsil-inspired native Driver App requirements, and Cloudflare D1 ↔ central ERP financial integration. Keep current core functionality; no rewrite or premature production posting.

## A. What is already built versus what is proven

| Area | Code baseline | Production verification |
| --- | --- | --- |
| Original ERP steps 1–7: Node/Express/SQLite, multi-tenant SaaS, users/roles, dashboard, core sales, customer, supplier, inventory, delivery, purchase, billing and reports | Implemented; existing CI and QA tests | Production go-live still outstanding |
| Extended ERP: bottle/credit ledger, pricing, recurring routes, customer portal/PWA, payroll, fleet, complaints, analytics, production/quality, franchise, reports | Modules present in source | Full field/UAT of all workflows outstanding |
| Driver Android: native isolated driver UI, role permissions, offline operations, GPS/photo/signature, delivery/recovery/bottle functions | Substantial QA implementation; Android tests green for tested revisions | Physical Android device and complete live ERP integration unverified |
| Delivery OTP | Code and version-preview QA retired delivery OTP; signature+photo+GPS proof required | Active QA Worker delivery policy was observed 404; do not say activated |
| D1 ↔ ERP signed finance bridge | ERP PR #28, Driver PR #62 merged; signed transport, idempotent ledger writes, outbox/ACK/replay unit + disposable SQLite integration green | Central ERP private QA endpoint unhosted/unmounted; D1 outbox migration and end-to-end live service connection not verified; **zero real customer finance sync verified** |

**Evidence (at baseline):** ERP PR #28 https://github.com/temospringwater-eng/Temo-ERP/pull/28 and CI https://github.com/temospringwater-eng/Temo-ERP/actions/runs/40451819519; Driver PR #62 https://github.com/babar200/TEMO-Driver-Android-QA/pull/62 and CI https://github.com/babar200/TEMO-Driver-Android-QA/actions/runs/40451956994; Cloudflare version mismatch QA https://github.com/babar200/TEMO-Driver-Android-QA/actions/runs/40431963323; OTP-free version-preview E2E https://github.com/babar200/TEMO-Driver-Android-QA/actions/runs/40432335985.

## B. Original 8 steps preserved

1. Project structure and repository — core implemented.
2. ERP database schema — core implemented; integration alignment and migration pending.
3. Login and authentication — implemented; final security audit pending.
4. Users, admin roles and permissions — implemented; cross-application enforcement/UAT pending.
5. Multi-company SaaS isolation — implemented; explicit D1↔ERP tenant mapping must be proven.
6. Dashboard — implemented; accurate real integrated metrics must be proven.
7. Business modules (sales, purchases, customers, stock, bottles, finance, billing, reports, HR and optional extended modules) — implemented in code; final integration/UAT pending.
8. System validation, bugs and go-live — **open**. The expanded phases below define its release gates.

## C. Final execution order — mandatory gates

### Phase 0 — Stable baseline and freeze
**Priority: P0; status: completed — mandatory ERP/Driver merged-main CI green; known Cloudflare 404 explicitly deferred to Phase 4.**
- Freeze new nonessential feature requests until real delivery, inventory and finance sync are stable.
- Inventory open ERP/Driver PRs, current main SHA, QA failing checks, migrations, cloud runtime versions and expected API contracts.
- Repair blocking CI/runner/source mismatch errors. Compare Cloudflare *active deployment ID* with most recent uploaded preview; do not infer that upload equals deployment.
- Establish traceable issue/PR/checklist for every open blocker, and backup the known-good source.
**Done only when:** mandatory ERP and Driver unit + integration and Android QA checks green on current baseline, no unexplained 404 or undisclosed merge blocker; report actual active deployment.

### Phase 1 — Cloudflare Workers + D1 isolated QA foundation
**Priority: P0; status: active — existing Driver QA D1/Worker available; central ERP Workers/D1 not migrated. Depends on Phase 0.**
- Cloudflare Workers is the API hosting target and **D1** the persistence layer; Cloudflare Pages/static assets may host ERP web UI.
- Verify actual existing Driver QA Worker bindings and D1 identifiers read-only; provision/reuse a distinctly isolated **QA D1**, separate from production. No inferred database IDs or automatic live Worker deployment.
- Audit `server.js` direct `sqlite3`, `DB_PATH`, `app.listen()` and Express routes. Define Workers-compatible route/query adapters using `env.DB`; do not pretend existing Node ERP can run unmodified on Cloudflare.
- Verify D1 Time Travel eligibility, export/import, schema-only migration, quota and recovery on disposable QA. Local SQLite backup/HTTPS test work stays as **legacy compatibility tests**, not target hosting.
**Done only when:** Worker QA routes, authoritative QA D1 binding, read-only schema inventory, CI + isolated migration rollback and safe D1 recovery demonstrated with no customer writes.

### Phase 2 — Central ERP D1 schema migration and tenant/financial mapping
**Priority: P0. Depends on Phase 1.**
- Migrate existing ERP Node/Express/`sqlite3` business services incrementally to Workers-compatible, async D1 logic; keep original interface, security and company isolation.
- Review and apply versioned, reversible **QA-only** D1 SQL migrations; compare ERP SQLite schema, Driver D1 schema, foreign keys, indices and QA migration history. Never upload a raw SQLite .db as the D1 target.
- Map every D1 company/driver/user/customer/order/delivery/product/bottle/warehouse ID explicitly; preserve existing accounting identity.
- Determine invoice/stock deduction timing, van/warehouse, full/partial/credit recovery, deposits and bottle return rules; refuse duplicate finance or negative stock.
**Done only when:** protected Workers ERP QA API operates on mapped QA D1 with compatible SQL, role/tenant tests, migration/export rollback and synthetic ledger reconciliation.

### Phase 3 — Single canonical ERP D1 and driver finance sync
**Priority: P0. Depends on Phase 2.**
- **Prefer one canonical ERP D1 per environment** shared by authorized ERP and Driver Workers to remove dual independent customer financial ledgers. Verify existing Driver QA D1 separately before changing bindings.
- In transition with two isolated QA D1 databases, use the existing signed-receipt, HMAC transport, idempotent outbox and acknowledgment as a temporary bridge; **no distributed transaction across distinct D1**.
- Within the canonical ERP D1, make delivery payment, invoice/credit, bottle and stock mutations atomic using Worker D1 prepared statements and suitable `env.DB.batch()` patterns; required proof signature/photo/GPS remains mandatory.
- Run lost-ACK, retry, tenant isolation, conflict, stock and cash-closing tests, with read-after-write and administrative reconciliation.
**Done only when:** synthetic D1 delivery→ERP ledgers→driver read-back is complete, uniquely idempotent, fully reconciled, and proven through real QA Worker bindings.

### Phase 4 — Active Cloudflare QA API + native Driver App
**Priority: P0. Depends on Phases 2–3 for financial completion.**
- Promote **reviewed QA Worker version** with backup, exact binding/source audit, authenticated smoke, one-click rollback and correct active-version check.
- Resolve policy 404 and all Driver core endpoints; login never opens central ERP admin screens; driver-only tenant-scoped permissions.
- Enforce **no delivery OTP**. Mandatory signature PNG, photo JPEG and accurate/fresh GPS; admin GPS override only with reason/audit under separately approved policy. Login/password recovery remain independent.
- Verify orders, add customer, recovery, customer ledger, zone/schedule, route, van stock, partial delivery, full/partial/credit payments, bottle returns, security deposits and optional admin permissions.
- Test native APK on a physical phone: cold start, offline delivery, reboot, recovered network, replay, route/GPS during duty only and digital receipt. Do not claim installer verified until a real installation succeeds.
**Done only when:** all required driver screens function without ERP web UI; active QA API and mobile field E2E green; no missing permissions/404; ledger reflects real synthetic test delivery correctly.

### Phase 5 — Reconciliation, security, load and UAT
**Priority: P0. Depends on Phase 4.**
- Test full cycle: ERP order → D1 driver assignment → Android route/load → offline delivery with signed photo/GPS → full/partial/credit recovery → bottle empty return → outbox sync → central ERP ledgers → read-back into Driver App.
- Compare order/invoice, customer credit, cash closing (admin verified), security deposit, bottle balances and stock across systems.
- Negative tests: duplicate/lost ACK, stale GPS, missing photo, role/tenant crossing, disabled users, negative stock, expired JWT, concurrent replay, aborted transaction, missing data, downtime/restore.
- Preserve audit logs for override, cash reconciliation and manual financial intervention.
- Product-owner UAT for office admin, driver and customer views; record pass/fail evidence for each feature.
**Done only when:** no unexplained reconciliation differences, zero duplicate financial postings, full required UAT signed off and backups/restore proved.

### Phase 6 — Cloudflare Workers + D1 controlled production release
**Priority: P0. Depends on Phase 5; explicit approval required.**
- Secure QA-to-production promotion of vetted Cloudflare Workers APIs and separately approved production D1 migrations. No third-party Node hosting or automatic billing changes.
- Confirm production D1 Time Travel bookmark/export, cross-environment restore evidence, exact Worker version, access control, least-privilege D1 bindings, analytics and rollback.
- Pilot ERP + native Driver App + customer view in order: customer/order → driver proof → atomic invoice/cash/credit/stock/bottle D1 ledger → read-back. No real customer finance writes until explicit authorization.
**Done only when:** independent production D1/Worker resources are identified, recovery verified, pilot ledgers reconcile, and release approval recorded.

### Phase 7 — Commercial SaaS completion and Phase 2 product roadmap
**Priority: P1; after stable go-live.**
- Validate commercial tenant onboarding, free trial, subscription plans, invoices, renewal/payment-proof approvals and notifications.
- Test multitenant isolation under real onboarding, full reports, user training/help/support, billing and compliance.
- **Separate Customer Order Android App** after main ERP ↔ Driver sync stable; customer portal/PWA is existing foundation. Customer app → central ERP → driver → delivery/financial ledger → customer status.
- Agreements/e-signature, external mapping/optimization, AI/provider integrations and other nonessential enhancements follow their own scoped approval.
**Done only when:** commercial pilot customer onboarding/billing/support tested; post-go-live backlog prioritized rather than assumed launched.

## D. Delivery system rules (must not regress)

- **Canonical ERP D1 is the financial source of truth**. Existing Driver D1 is an isolated operational QA store until safe unification; never keep two independently mutable customer finance ledgers.
- No legacy delivery OTP fallback. Signature + photo + GPS required for normal delivery; separate login recovery OTP need not be removed.
- Every development change uses **TDD → unit tests → integration tests → code review → CI → isolated QA → verified read-back**. For Android or Worker changes also test relevant device/Cloudflare environment.
- Driver accesses only their tenant/assigned records; Admin-only permissions enforced in API as well as UI; all overrides audited.
- Offline queue and idempotency must tolerate retry/restart without double-charging, double stock deduction or lost payments; fail closed when mappings, proof or balance are uncertain.
- No production Worker deploy, D1 migration/binding change, bulk import, destructive change or billable Cloudflare upgrade without explicit user approval and backup evidence.
- Preserve existing features and data. Do not silently mark completed if only source code or a preview version exists.

## E. Single status update format

For each phase report: `Phase | Done/Active/Blocked | exact PR/CI evidence | root blocker | next safe action | gate criteria`. Never use invented percent-complete for real sync. Advance to the next phase only when the prior exit gate is verified. If a phase fails, fix and retest there rather than adding features.

### Phase 0 verified completion checkpoint (27 October 2026)
- ERP main regression and restore gate **passed**: https://github.com/temospringwater-eng/Temo-ERP/actions/runs/40453783105
- Driver merged-main native Android JUnit + SQLite + emulator QA **passed**: https://github.com/babar200/TEMO-Driver-Android-QA/actions/runs/40454178075
- Phase 0 main-CI fixes merged in ERP PR #30 and Driver PR #63; full blocker register in [Phase 0 evidence report](TEMO-PHASE0-VERIFIED-BASELINE.md).
- The active Cloudflare delivery-policy HTTP 404 is **explained** by active-vs-uploaded version mismatch, not fixed or released; promotion belongs to Phase 4 after isolated finance sync testing and rollback. Open legacy OTP PRs remain frozen.

### Verified Cloudflare D1 migration blocker (27 October 2026)
- Exact read-only Worker-bound QA D1 audit: **19 physical D1 tables**, only **8/115 ERP source tables matched**; **107 ERP tables missing**, including warehouse, stock, sales, credit and bottle finance ledgers. Core 8-table Driver contract passes but **is not full ERP compatibility**.
- [Prioritized D1 schema parity and migration dependency register](CLOUDFLARE-D1-115-TABLE-READINESS.md) records the verified parent-table-first approach.
- [Cloudflare actual parity audit](https://github.com/babar200/TEMO-Driver-Android-QA/actions/runs/40462301601) passed; results explicitly classify live financial sync as BLOCKED.
- Do not deploy or import all 115 tables into the current D1. First verify QA recovery, parent schema/tenant FKs, then dependent invoice/stock/credit/bottle ledgers using disposable QA tests.

### Current checkpoint — Phase 1 (active)
- Secure hosted QA startup guard (strong bootstrap credentials, loopback-only, QA-specific DB path) merged: ERP PR #32.
- Hosted QA SQLite restart, strong credentials and non-duplicate privileged account integration tests **passed** and were merged in ERP PR #33; merged-main full regression passed: https://github.com/temospringwater-eng/Temo-ERP/actions/runs/40455314624 . Actual persistent cloud QA host is still unprovisioned.
- Phase 1 private WAL-safe SQLite QA backup + restore automation **merged** in ERP PR #36; main CI: https://github.com/temospringwater-eng/Temo-ERP/actions/runs/40456366640. This is operator-local, private and **does not perform cloud backups**.
- Phase 1 localhost HTTPS staging with trusted synthetic TLS cert, strong admin login and protected API **merged** in ERP PR #37; PR CI: https://github.com/temospringwater-eng/Temo-ERP/actions/runs/40456614420. The test's TLS endpoint is ephemeral and **not a persistent or publicly reachable hosted QA deployment**.
- **Architecture decision updated:** Cloudflare Workers + D1 is the hosting/data platform. No external Node server. The earlier private disk/localhost TLS tests remain local QA verification only.
- **Next safe task:** read-only current Cloudflare Driver D1 binding/schema inventory, Workers-compatible ERP API design, isolated QA D1 migration rehearsal and D1 Time Travel/export backup verification. Do not directly mount legacy `hayrila.db` into Workers.
- `Step 8: Production Go-Live` remains pending; **zero live customer financial receipts synchronized**. Central ERP Worker/D1 migration is NOT completed yet.

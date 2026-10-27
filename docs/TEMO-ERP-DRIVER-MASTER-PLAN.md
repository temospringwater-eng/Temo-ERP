# TEMO ERP + Driver Android + D1 Sync — Unified Master Delivery Plan

**Baseline:** 27 October 2026. **Owner:** TEMO Spring Water. **Primary repository:** `temospringwater-eng/Temo-ERP`. **Driver repository:** `babar200/TEMO-Driver-Android-QA`.

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
**Priority: P0; status: start here.**
- Freeze new nonessential feature requests until real delivery, inventory and finance sync are stable.
- Inventory open ERP/Driver PRs, current main SHA, QA failing checks, migrations, cloud runtime versions and expected API contracts.
- Repair blocking CI/runner/source mismatch errors. Compare Cloudflare *active deployment ID* with most recent uploaded preview; do not infer that upload equals deployment.
- Establish traceable issue/PR/checklist for every open blocker, and backup the known-good source.
**Done only when:** mandatory ERP and Driver unit + integration and Android QA checks green on current baseline, no unexplained 404 or undisclosed merge blocker; report actual active deployment.

### Phase 1 — Isolated central ERP QA hosting + disaster recovery
**Priority: P0. Depends on Phase 0.**
- Provision private HTTPS **QA** ERP host and isolated SQLite database with durable disk, login/secret management, restricted service endpoint and no public access to finance bridge.
- Run ERP schema check, test data seed, backup, restore and rollback drills; document environment, SSL and health evidence.
- Create separate production backup/restore plan; do not migrate normal `hayrila.db` or post real finance in this phase.
**Done only when:** authenticated staging ERP reachable, persistent QA DB proven across restart, backups restored successfully, secrets not in repo/logs.

### Phase 2 — Schema agreement, tenant mapping, invoice and stock policy
**Priority: P0. Depends on Phase 1.**
- Back up D1; review and safely apply **QA-only** additive migrations for proof evidence and `driver_finance_outbox`.
- Map each D1 company/driver/customer/order/delivery/product/bottle/warehouse ID to authoritative ERP IDs, independently and explicitly; never assume integer IDs correspond.
- Decide warehouse-vs-van stock movement semantics, current/previous invoice status, credit/partial recovery, bottle deposits and bottle return accounting; default deny unapproved mapping.
- Check no already-posted ERP payment, credit or stock entry can be charged again.
**Done only when:** signed-off, tenant-scoped mapping and policy matrix for synthetic QA data, migration + rollback proof and source/target reconciliation baseline.

### Phase 3 — Secure D1 → ERP finance transport
**Priority: P0. Depends on Phase 2.**
- Mount the existing **QA-only** signed ERP adapter on the isolated QA service, not production `server.js`.
- Provision two distinct 32+ byte private keys: proof receipt HMAC and transport/ACK HMAC; secure rotation and access controls.
- Use validated D1 source receipt built from authoritative completed delivery, proof assets and payment; HTTPS allowlist + service auth.
- Activate bounded D1 outbox replay **only for designated synthetic QA deliveries**. ACK only after independently verified ERP signed response; block unsigned, stale, wrong-company and changed receipts.
- Reconcile payment, invoice debit/credit, products, van/warehouse stock, bottles and source/ERP proof GPS in a **single atomic ERP transaction**.
**Done only when:** D1 → private ERP QA → signed ERP ACK → durable D1 acknowledgment works E2E, plus replay/lost-ACK/conflict tests show one posting, not two.

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

### Phase 6 — Controlled production release (original go-live step)
**Priority: P0. Depends on Phase 5; explicit approval required.**
- Choose hosting plan, production domain/HTTPS, encrypted secrets, durable database, monitoring, backups, operator ownership and documented rollback.
- Stage production migration with verified backup and maintenance process. Release ERP + Android + Worker in a controlled order; smoke real endpoints with a strictly authorized limited pilot.
- Switch live finance posting **only after** written evidence and explicit owner authorization. Do not use broad customer writes as initial testing.
- Verify first pilot ledger, cash, invoice, stock, bottle and offline retries; restore/rollback if mismatch.
**Done only when:** pilot successful, production incident/recovery procedure available and both ERP/Driver user journeys accepted.

### Phase 7 — Commercial SaaS completion and Phase 2 product roadmap
**Priority: P1; after stable go-live.**
- Validate commercial tenant onboarding, free trial, subscription plans, invoices, renewal/payment-proof approvals and notifications.
- Test multitenant isolation under real onboarding, full reports, user training/help/support, billing and compliance.
- **Separate Customer Order Android App** after main ERP ↔ Driver sync stable; customer portal/PWA is existing foundation. Customer app → central ERP → driver → delivery/financial ledger → customer status.
- Agreements/e-signature, external mapping/optimization, AI/provider integrations and other nonessential enhancements follow their own scoped approval.
**Done only when:** commercial pilot customer onboarding/billing/support tested; post-go-live backlog prioritized rather than assumed launched.

## D. Delivery system rules (must not regress)

- ERP is the financial source of truth. D1 is driver operational/offline storage and **never a second independent customer ledger authority**.
- No legacy delivery OTP fallback. Signature + photo + GPS required for normal delivery; separate login recovery OTP need not be removed.
- Every development change uses **TDD → unit tests → integration tests → code review → CI → isolated QA → verified read-back**. For Android or Worker changes also test relevant device/Cloudflare environment.
- Driver accesses only their tenant/assigned records; Admin-only permissions enforced in API as well as UI; all overrides audited.
- Offline queue and idempotency must tolerate retry/restart without double-charging, double stock deduction or lost payments; fail closed when mappings, proof or balance are uncertain.
- No production deploy, ledger migration, bulk import, destructive change or billable hosting purchase without explicit user approval and backup evidence.
- Preserve existing features and data. Do not silently mark completed if only source code or a preview version exists.

## E. Single status update format

For each phase report: `Phase | Done/Active/Blocked | exact PR/CI evidence | root blocker | next safe action | gate criteria`. Never use invented percent-complete for real sync. Advance to the next phase only when the prior exit gate is verified. If a phase fails, fix and retest there rather than adding features.

### Starting checkpoint
**Next task:** Phase 0 — verify current ERP/Driver main CI, Cloudflare *active* version and endpoint matrix, resolve blocker list. Then Phase 1 isolated ERP QA hosting. `Step 8: Production Go-Live` remains pending, and live customer finance synchronization remains disabled.

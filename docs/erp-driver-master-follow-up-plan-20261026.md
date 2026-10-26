# TEMO ERP + Native Driver — Master Follow-Up / Release Gates
Date: 2026-10-26 | Owner: TEMO Spring Water
Status: QA only; production NOT AUTHORIZED.

This checklist is the canonical next-step plan. Mark boxes only after links to
verified evidence. All changes require **TDD, unit and integration tests**.
No production data mutation, migrations, or financial posting without independent
approval and proof.

## Phase 1 — Recover central ERP source and establish full CI baseline
- [x] Restore missing imported services and public ERP/customer frontend in PR #17.
- [x] Independently match exact Git blobs for 56/56 source-only files on private alternate CI branch (baseline `bf3b836ec`).
- [x] Prove Node 24 locked dependency install, ERP syntax, import and frontend integrity via GitHub Actions run #40270451435 (these steps passed; full job still needs final result).
- [x] Replace legacy in-repo native-Android-file test with central ERP driver-only authorization and disposable QA gate regressions (commit `d6bfbf70`). Native Android itself is tested in its separate repository.
- [x] Independent CI: 4/4 driver RBAC/QA gate tests, 3/3 live local HTTP boot/tenant tests, 23/23 SQLite field ops; 30/30 green: https://github.com/babar200/TEMO-Driver-Android-QA/actions/runs/40271072579
- [ ] Entire pre-existing `npm test` suite green, diagnose/repair any hang or failure. Full/serial QA runs #40270914549, #40271162602 must finish with reviewed results.
- [ ] Verify no live customer data stored in tracked `hayrila.db`, `step7-debug.db`, `hayrila-franchise-check.db`; backup before any deliberate removal/rotation. NEVER copy databases into alternate QA.
- [ ] Review final PR diff; obtain full owner repo CI green + explicit safe merge approval.
PR: https://github.com/temospringwater-eng/Temo-ERP/pull/17

## Phase 2 — Main ERP account runner / CI quota
- [x] Identify Actions account block: Oct 23 included 2,000/2,000 GitHub Actions minutes; storage alert also at 100%.
- [x] Re-run attempted; direct ERP hosted runner fails before steps with runner_id=0. Last direct recovery CI: https://github.com/temospringwater-eng/Temo-ERP/actions/runs/40271348885
- [ ] User resolves billing/budget or the expected allowance reset on 2026-11-01 occurs; verify actual runner assignment.
- [ ] Run main ERP tests including real boot, role/tenant, unit, integration and full regression with tracked artifacts. Do not accept mirrored QA as direct branch required status check.

## Phase 3 — Express/SQLite ↔ Cloudflare Worker/D1 contract
- [x] Isolated scoped 15-permission parity and driver read APIs verified on disposable QA (25/25): https://github.com/babar200/TEMO-Driver-Android-QA/actions/runs/40263503431
- [ ] Establish which datastore is financial source of truth and map all driver/customer/order/ledger/stock IDs.
- [ ] Review QA D1 migrations, credential scopes, OTP policy/verified provider, JWT multi-tenant and restricted writes; back up staging and establish rollback.
- [ ] Real read-only QA integration; then explicitly approved disposable write-path QA. Worker D1 and central Express SQLite are NOT automatically synced.
- [ ] Strict receipt idempotency and two-company tenant isolation regression.

## Phase 4 — Native Android phone QA
- [x] Native secure Android build and emulator startup/offline restart green: https://github.com/babar200/TEMO-Driver-Android-QA/actions/runs/40263503773
- [ ] Physical phone APK install/login, security/permissions, cold restart, offline queue rehydration and reconnect.
- [ ] Verify New Order, Add Customer, Recovery, Ledger, Zones and Van Stock with disposable ERP data.
- [ ] Record installed APK SHA/build identity and phone QA evidence; no release signing before QA gate.

## Phase 5 — Real ERP financial posting (START ONLY WHEN PHASES 1–4 CLEAR)
- [ ] Signed delivery + OTP policy + optional photo; proof bytes tied to assigned delivery.
- [ ] Atomic delivery/order status, customer credit/cash/payment, bottle custody and van stock mutation; rollback on one failed line.
- [ ] Independent recovery posting; customer ledger and receipts.
- [ ] Offline replay, duplicates, conflicts, changed OTP/permissions, network loss, multi-tenant cross-post denial.
- [ ] Independently reconcile QA Worker rows to central ERP before any real posting.

## Phase 6 — Go-live
- [ ] Full TDD/unit/integration/E2E security tests and 2-tenant financial reconciliation.
- [ ] Production migration backup, rollback drill, owner approval, release-signed Driver APK.
- [ ] Deployment smoke, Google/Cloudflare routing, monitor and incidents.

**Freeze:** ERP PR #17 and Android PR #43 remain draft pending above gates.
No production or live customer database mutation authorized by this plan.

# Phase 3 — Central ERP ↔ Cloudflare D1 driver contract (QA only)
Date: 26 October 2026. Source: `temospringwater-eng/Temo-ERP` recovery PR #17 and `babar200/TEMO-Driver-Android-QA` main.

## Independent systems
- Central ERP: Node.js/Express + SQLite `hayrila.db`.
- Android QA API: Cloudflare Worker + D1, different schema and JWT identity.
- No evidence of automatic database replication, common financial source of truth, or shared immutable ledger IDs. Treat every unproven sync as **not available**.

## Code-confirmed contract gaps
| Driver contract | Central ERP recovery baseline | New Phase 3 QA read adapter |
| --- | --- | --- |
| GET /api/driver/permissions | Missing | 15 explicit false-by-default flags; only 6 QA-field flags backed by disposable SQLite permission rows |
| GET /api/driver/bottle-types | Missing | Tenant-scoped product list with items shape; QA only |
| GET /api/driver/delivery-policy | Missing | Always OTP required; admin OTP-OFF feature NOT enabled here |
| POST /api/driver/deliveries/:id/proof-upload | Missing | Still missing; never accept proof metadata as proof bytes |
| Driver completion status | Express uses `delivered`, D1 operations use `completed` | No write behavior changed; require exact receipt mappings before replay |
| Delivery/payments/bottles atomicity | Legacy Express handlers perform separate updates/inserts | NOT resolved; QA field transaction tests do not prove production completion atomicity |
| Customer/account/stock IDs | Two unrelated database IDs | Mapping not established; **never match by integer ID alone** |

## Security boundary
The new Express three-route adapter is only registered under the existing `fieldQaDbReady` check:
1. `NODE_ENV !== production`
2. database path ending in `*qa*.db`
3. `TEMO_DRIVER_FIELD_OPS_QA=1`

These are not live Cloudflare routes. Existing Express bearer session middleware must still authorize active driver + company. Only caller-derived tenant/driver IDs go into parameterized SQL; incoming `companyId` is ignored. All permissions default deny except verified allowed QA rows. No mutation route is introduced. Missing OTP policy is fail-closed OTP ON.

## Remaining approval and rollout gates
- PR #17 still draft; source recovery needs tracked DB file safety review and owner merge approval before promoting.
- Full Main ERP CI green for recovery PR #17 does **not** verify Cloudflare worker production.
- Confirm authoritative financial store, tenant/customer/order/delivery identity crosswalk, versioned DTOs, and ledger reconciliation ownership.
- Compare deployed QA Worker routes with repo source (public URL is insufficient to establish live D1 schema); require secured access and read-only verification.
- Add two-company disposable D1/ERP read parity, then separate owner-approved D1 migration/backups and write QA.
- OTP sender, proof bytes, single-transaction ledger write, idempotent offline reconciliation, phone APK and production release remain blocked until individually tested.
- No live data writes, deployment, billing modification, or branch protection bypass authorized.

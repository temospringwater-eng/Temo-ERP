# Water Club integration checkpoint — 5 October 2026

This extends the existing multi-company ERP. Website source is on `design/premium-homepage-v1`; ERP source is on `integration/water-club-api`. Neither main branch is changed or deployed by this work.

## Implemented

- Member enrollment for existing authenticated ERP customers: Home, Family, Office, Business. Business rewards start disabled until admin enables them.
- Company-scoped catalog mapping to existing products. 19L refill / 1.5L carton / 500ml carton default to 5 points per qualifying unit. Individual small bottles can use 6 or 12 units per reward. Deposits, fees and cargo must remain unmapped. Product prices always come from ERP.
- Orders, recurring schedules, pause/resume/skip/cancel. Recurring generation uses existing delivery_subscription_occurrences and ERP orders/items, atomic transactions, date uniqueness and month-end anchoring. A one-minute runtime scheduler generates due club orders for usable tenant subscriptions; missed schedules are caught up after restart. Manual generation remains available.
- Rewards require full net recorded payment and delivered order status. First qualifying paid delivery adds 5 bonus; referral adds 20 after referred member first qualifying paid delivery. Self/same-normalized-phone and cross-company referrals are rejected. Existing users are provisioned by ERP admins; phone OTP signup is still unavailable.
- Water Club uses existing loyalty accounts/transactions, referral codes/referrals, payments, audit logs and stock movements. Water Club ledger keys keep pilot balances separate from legacy CRM spend-based points. Legacy order loyalty is skipped for club orders, and legacy sale referral awards are skipped for club members.
- Unused earned points expire after 12 months, with per-award lots and FIFO redemption. Refund/cancel reverses issued earnings and referral rewards; points already spent produce a visible debt covered by future earnings. Redemption creates a zero-price ERP order. Cancelled unfulfilled reward orders restore eligible points with their original expiry. Delivered reward orders do not automatically return spent points. Physical returns remain existing ERP operations; cancellation/refund does not automatically restock goods.
- Delivered club order stock is posted exactly once during reconciliation. Main admin order confirmation is atomic with stock/rewards. Existing driver delivery paths call reconciliation after trusted delivery updates. Reward reads and admin order reads also reconcile relevant state; rewards are not an independently writable customer balance.
- Customer dashboard provides real catalog/orders/schedules, rewards/history, redemption, referrals, delivery status, existing bottle balance, profile editing and support requests. Worker holds ERP sessions in HttpOnly cookies and proxies only customer endpoints. ERP admin page `/water-club-admin.html` provides catalog/rules, member reward access, verified payment/refund records, audited manual point adjustments and order confirmation.
- Idempotency keys protect order, schedule, schedule actions, redemption, payment and manual-adjustment retries. A dedicated SQLite connection and serialized `BEGIN IMMEDIATE` transactions prevent duplicate generation/redemption under concurrency. Transactions roll back on errors.

## Validation

`npm test` in ERP: 27/27 reported by Node (includes nested/parent tests). Tests use disposable SQLite and no business data. The suite covers previous auth checks plus company/role boundaries, server prices, full payment plus delivery gating, first bonus, referral once-only award/reversal, concurrent redemption/generation, stock once-only posting, debt, expiry, carton units, audited adjustments and schedule retry/month-end dates.

`npm test` in website/backend: 10/10 reported by Node (9 individual checks plus parent). Covers origin/JSON boundaries, malformed/missing cookies, actual body byte limits, exact customer-route forwarding, secure cookie/token privacy, upstream forbidden vs expired-session handling, HTTPS requirement and disabled OTP.

Cross-repository local test: set `WC_WORKER_PATH` to the absolute website `backend/src/index.js` path before running ERP tests. The same 27 checks then use the actual Worker against the local ERP for member flows. Without the variable, ERP tests remain self-contained and call ERP APIs directly. Cross-repository test passed. JavaScript syntax and member/admin DOM targets checked. Browser localhost preview was blocked by the browser environment; visual/browser interaction tests are NOT complete. GitHub CI result has not been claimed.

## Launch gates

1. Salary/billing: deploy persistent ERP hosting, configure HTTPS Worker ERP_API_BASE_URL and allowed origin. Paid hosting remains paused.
2. Admin reviews actual catalog mappings, refill/carton prices, stock, delivery terms, deposit rules and B2B eligibility. Seed examples are not live stock approvals.
3. Provision pilot customer credentials through existing ERP portal access; approved OTP/provider delivery remains pending. No fake OTP or self-registration was implemented.
4. Verify real browser/mobile flows, HTTPS cookies, SMTP/OTP/payment provider delivery, online driver/proof/offline flows and persistence across restart/redeploy. Payments here are manually verified ERP records, not automatic bank settlement/webhooks.
5. Test full SQLite backup/restore plus uploads. Existing generic driver routes update delivery state before reconciliation; failure during reconciliation requires admin review/retry. Driver OTP/signature requirements remain in existing driver action routes and were not replaced or fully retested here.
6. Owner approval before production merge or go-live.

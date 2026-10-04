# Water Club local API checkpoint — 4 October 2026

Source reviewed: `integration/water-club-api`, base commit `9fce7cc8dc7d8f26a3e605139b34569bf8a4b02e`.

## Validation

`npm ci --omit=dev` completed. Server syntax validation passed. The new `npm test` suite uses a disposable fresh SQLite database, two separate company accounts and customers; it does not copy or change the business database.

Before fixes, 3 of 12 individual checks failed: valid customer portal email provisioning, inactive customer login rejection, and inactive company customer-login rejection. After fixes, all 12 individual checks and their parent integration test pass (13/13 as reported by Node).

Checks cover database health, anonymous API rejection, wrong credentials, company-header spoofing, portal provisioning, customer/admin access separation, customer identity isolation, inactive accounts/companies, password change, session expiry, and logout revocation.

The password-change route is now registered once at startup, after authentication middleware, rather than repeatedly inside request metrics middleware. The GitHub staging smoke workflow runs this integration suite before the startup health check.

## Limits and launch blockers

- This branch is an API staging runtime. `public/index.html` is a placeholder, not the full ERP/customer interface. The original front-end files must be restored from the existing ERP source before UI validation; do not rebuild a duplicate system.
- AI automation, franchise, WhatsApp assistant and supplier procurement service files contain staging fallbacks; these tests do not validate those modules.
- Existing bootstrap accounts use a known default password. Secure production bootstrap and account provisioning must be resolved before exposing this runtime online.
- The existing forgot-password endpoint returns a reset token to the requester. Production password recovery must deliver tokens through a verified channel and never return them in the API response.
- Payment-proof and backup storage paths must be checked against the persistent mount. Setting only DB_PATH does not persist every upload or backup directory.
- The current health route checks SQL connectivity. It does not establish that every migration, route or module is ready.
- OTP-provider delivery, Cloudflare Worker integration, HTTPS browser flows, cross-origin behavior, real deployment and restart/redeploy persistence remain untested.
- The historic 31-test ERP suite is not present in this branch and was not rerun.

## Deferred until salary / billing

Render paid service deployment is paused. The prepared cost was $7/month compute plus $0.25/month for 1 GB persistent disk (tax/extra usage separate). Billing card entry is pending. No service has been deployed by this review.

Next: address the launch blockers above; complete billing when authorized, deploy the staging branch with fresh test data, verify persistence across restart/redeploy, connect the website Worker, and run online end-to-end tests. Production go-live requires the owner's final approval.

## Follow-up security and source restoration — 4 October 2026

Restored the existing public frontend and AI, franchise, WhatsApp and supplier-procurement service sources from the owner's TEMO-AQUAFLOW.zip. No new ERP was created. JavaScript syntax and the local integration suite were checked after restoration; broad UI/module validation remains pending.

Known default credentials no longer seed automatically; explicit strong bootstrap secrets are required and first-login password change is mandatory. Existing database users are unchanged and need credential review before going online. Superadmin password change now handles NULL company IDs. Malformed password hashes fail authentication safely.

Recovery emails use the existing SMTP service and a configured HTTPS reset page. Responses never return tokens or disclose whether an account exists. Tokens are hashed in SQLite, expire after 30 minutes, and are consumed atomically so concurrent replay cannot succeed. Recovery invalidates sessions and outstanding tokens after reset. Actual SMTP delivery is not verified; configuration is pending. The restored frontend reads the emailed token, removes it from the URL and no longer displays default credentials.

Database-adjacent storage is used for payment proofs and backups, with an explicit STORAGE_ROOT override. Tenant JSON exports omit global tables without company_id; JSON exports remain redacted data exports rather than complete restore images. Hosting restart/redeploy and full SQLite restore drill remain pending.

The expanded suite covers customer order creation with server-side prices and isolation, explicit bootstrap, superadmin password change, recovery response privacy, concurrent reset replay/session revocation, and persistent-path backup checksum/isolation, in addition to the previous auth checks. See test output for counts. Production hosting/billing and online verification are still paused until salary. Launch business settings require owner confirmation; STAGING-DEPLOYMENT.md records the checklist.

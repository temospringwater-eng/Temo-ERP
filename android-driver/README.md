# TEMO Driver Native Android App — QA source

This project is **a native Android application**, **not** the TEMO ERP website, a WebView, or an ERP admin panel. The separate package is `com.temo.aquaflow.driver.nativeapp` and label is **TEMO Driver Native**.

The app has Android-native Login, My Deliveries, Delivery Detail, Start, Complete, Failed Delivery, customer call/map, finger signature, optional photo, cash, bottle counts, and app-private pending operations. Driver network calls go only to the driver-scoped JSON API on the central ERP. It refuses `super_admin`, `company_admin`, and every non-driver role, even when the username/password are valid. The ERP admin continues using the separately authorized website.

## Testing workflow
- Android workflow: `.github/workflows/android-driver-build.yml`
- Native APK output: `TEMO-Driver-Native-QA.apk` (debug-signed, separate package)
- Driver must already have an assigned delivery created by company admin in the **ERP Admin**.
- Enter a trusted HTTPS server origin and optional temporary QA access code, then driver username/password.
- A temporary test gate is unlocked through native HTTPS requests; no Cloudflare login page is displayed.
- "Complete" requires a real customer 6-digit OTP and signature, as the ERP backend demands.
- Proof photos/signatures are uploaded over authenticated HTTPS to the ERP's server-private `TEMO_PROOF_STORAGE_DIR` location. Production needs a durable private volume and a retention policy.
- When offline, assigned deliveries last fetched can be viewed, and `start` / `fail` operations are stored locally with idempotency keys; manually sync on reconnection. Do not assume offline completion is possible without the server-issued OTP and uploaded proof.

## Limitations that must be resolved before Go-Live
- Native background sync and push notifications are **not implemented**; sync is manually triggered.
- A customer OTP delivery channel (customer portal/SMS integration) must be connected and tested; a driver OTP request does not itself send an SMS in the current backend.
- Driver GPS tracking, custom per-driver admin permissions, offline customer creation, and production-signed release need separate implementation and testing.
- Native device runtime integration test and full backend API validation **must be green**; do not release purely from source checks.
- App is for fictitious testing data only, not real cash collection/customer records until backend hosting/HTTPS/backup/role security passes.

Old WebView wrapper binaries named `TEMO-Driver-QA.apk` are obsolete; do not use them as native-app test evidence.

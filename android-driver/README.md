# TEMO Driver Native Android App — QA source

This project is **a native Android application**, **not** the TEMO ERP website, a WebView, or an ERP admin panel. The separate package is `com.temo.aquaflow.driver.nativeapp` and label is **TEMO Driver Native**.

The app has Android-native Login, My Deliveries, Delivery Detail, Start, Complete, Failed Delivery, customer call/map, finger signature, optional photo, cash, bottle counts, and app-private pending operations. Driver network calls go only to the driver-scoped JSON API on the central ERP. It refuses `super_admin`, `company_admin`, and every non-driver role, even when the username/password are valid. The ERP admin continues using the separately authorized website.

## Free Windows laptop build (no GitHub Actions minutes)

On a Windows laptop, install [Android Studio](https://developer.android.com/studio). Use SDK Manager to install **Android SDK Platform 35**, **Build-Tools 35.0.0**, and **Android SDK Command-line Tools**. Keep JDK 17+ available (the Android Studio bundled JBR is supported).

1. Download the **entire** `recovery/complete-source-2026-10-23` branch of the private `temospringwater-eng/Temo-ERP` repo as a ZIP and extract it, or use Git to check out the branch.
2. Open PowerShell in the extracted repository root. Run:
   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-driver-qa-windows.ps1
   ```
3. The script checks the Android SDK, downloads **official Gradle 8.9** with a pinned SHA-256 check, builds the Android debug APK, verifies native package identity / app label / Android debug signature (and rejects tiny wrapper artifacts), then writes **`driver-qa-output/TEMO-Driver-Native-QA.apk`** plus its checksum.
4. Transfer the APK to an authorized test Android phone, install, and confirm native Driver-only login. Do not distribute or enter real cash/customer records before end-to-end QA.

This free alternative uses the laptop's internet to download dependencies and requires enough free disk space for the SDK and Gradle. It **does not** use GitHub-hosted Actions minutes, modify account billing, or deploy the live ERP. It is an *unverified local build path* until executed on a Windows machine.

## Manual GitHub QA workflow (when Actions minutes are available)

The GitHub workflow **TEMO Driver Native QA APK** is manual-only (`workflow_dispatch`) to preserve the private account's limited Actions minutes. It builds the APK and performs a disposable Android 35 emulator launch plus offline cold restart using `android-driver/scripts/qa-emulator-smoke.sh` **before** it uploads or publishes any QA APK. A smoke-test failure must block publication.

These smoke tests **do not** validate driver login against a real HTTPS server, assigned deliveries, OTP delivery, cash/bottle ledger, or offline authenticated re-login. Do not call the APK production-ready without separate end-to-end QA.

## Testing workflow
- Android workflow: `.github/workflows/android-driver-build.yml`
- Native APK output: `TEMO-Driver-Native-QA.apk` (debug-signed, separate package)
- Driver must already have an assigned delivery created by company admin in the **ERP Admin**.
- Enter a trusted HTTPS server origin and optional temporary QA access code, then driver username/password.
- A temporary test gate is unlocked through native HTTPS requests; no Cloudflare login page is displayed.
- "Complete" requires a real customer 6-digit OTP and signature, as the ERP backend demands.
- Proof photos/signatures are uploaded over authenticated HTTPS to the ERP's server-private `TEMO_PROOF_STORAGE_DIR` location. Production needs a durable private volume and a retention policy.
- When offline, assigned deliveries last fetched can be viewed, and `start` / `fail` operations are stored locally with idempotency keys. While the app process is running, reconnection automatically retries pending updates; manual Sync remains available. Conflicted/failed operations are retained for review. Do not assume offline completion is possible without the server-issued OTP and uploaded proof.
- **Review Saved Updates** displays pending, rejected and conflicting driver actions with readable details. A local update is only acknowledged after the device confirms a durable save; failed/conflicted operations remain visible for manager review.

## Limitations that must be resolved before Go-Live
- Android background-service sync and push notifications are **not implemented**. Auto-sync is limited to network reconnection while the app process is active, or returning to the running app; manual sync remains available.
- A customer OTP delivery channel (customer portal/SMS integration) must be connected and tested; a driver OTP request does not itself send an SMS in the current backend.
- Driver GPS tracking, custom per-driver admin permissions, offline customer creation, and production-signed release need separate implementation and testing.
- Native device runtime integration test and full backend API validation **must be green**; do not release purely from source checks.
- App is for fictitious testing data only, not real cash collection/customer records until backend hosting/HTTPS/backup/role security passes.

Old WebView wrapper binaries named `TEMO-Driver-QA.apk` are obsolete; do not use them as native-app test evidence.

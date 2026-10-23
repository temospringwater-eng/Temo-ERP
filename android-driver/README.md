# TEMO Driver Android QA build

This is a minimal **Android WebView wrapper** around the existing TEMO AQUAFLOW ERP driver interface. It is an early QA APK, **not** a fully native driver app.

## Build
The pull-request workflow `.github/workflows/android-driver-build.yml` compiles an **Android debug APK** using Java 17, Gradle 8.9 and Android SDK 35. A successful run uploads the APK as `temo-driver-qa-apk` (retention: 1 day). An Android APK is *not* a signed production release.

## First launch
Enter a private **HTTPS** ERP server origin (for example `https://erp.example.com`) and sign in using a user with a `driver` role. The URL is device-local; it is not hard-coded or bundled with credentials. Public unencrypted HTTP is blocked. The server must already be online and have a trusted TLS certificate.

## Included
- Existing driver route/status screens from `public/index.html`, controlled server-side by driver permissions
- WebView DOM storage/cookies for the existing ERP session
- Android photo picker for proof attachments; GPS prompt requires Android runtime permission
- External navigation/map links go to available installed apps
- Offline service-worker and IndexedDB behavior depends on the existing web app and requires real-device testing

## Not yet verified
- Android APK installation and real-device behavior
- Native background sync or push notifications (not implemented)
- Offline GPS, camera capture, signature hardware integration beyond the web UI
- Hosted HTTPS ERP staging service with valid trial accounts
- Actual end-to-end delivery on a mobile network
- Signing and publishing a production APK / Play Store distribution

Do **not** use real customer information for QA until security/staging sign-off. Never disable device security or Android Play Protect to install a failed/unknown build.

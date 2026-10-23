# TEMO Driver — private-access HTTPS testing setup (mobile friendly)

This page is for **authorized QA only**. It is not a live production deployment.

**[Deploy the free QA service on Render](https://render.com/deploy?repo=https://github.com/temospringwater-eng/Temo-ERP/tree/recovery/complete-source-2026-10-23)**

1. Open the link in a phone browser signed into the Render account. If asked, connect Render's GitHub App to the **private** TEMO ERP repository and select the recovery branch.
2. Review the `render.yaml` Blueprint carefully: **web**, free instance, Frankfurt region, manual deployments (`autoDeployTrigger: off`), and an **ephemeral**, throwaway SQLite database under `/tmp`.
3. The Blueprint requests **two secrets** (`sync: false`) without storing them in GitHub:
   - `TEMO_STAGING_GATE_SECRET`: 24+ characters, gives entry to the testing site
   - `TEMO_BOOTSTRAP_COMPANY_ADMIN_PASSWORD`: 16+ characters, creates test `admin`
   - Render automatically generates a strong `TEMO_BOOTSTRAP_SUPERADMIN_PASSWORD`; do not change it unless necessary.
4. Confirm the Blueprint on Render, ensuring the pricing plan is **Free**; do not select a paid service.
5. Once deployment status is **Live**, copy the actual `https://...onrender.com` address from Render. Enter the HTTPS origin (without trailing path) into the installed TEMO Driver APK.
6. The APK should show **TEMO ERP — Private Test**. Enter the `TEMO_STAGING_GATE_SECRET` access code, then sign in with the test-only `admin` credentials. Create a `driver` test account through the ERP permissions/UI before driver-role delivery QA.

## Security and limitations

The web service is **internet reachable but protected by a separate staging gate**. It is not a Render private networking service. Render-hosted TLS is used for HTTPS.

- The server fails closed if `TEMO_REQUIRE_STAGING_GATE=true` but its secret is missing. The Blueprint sets this requirement.
- Don't upload actual customer names, phone numbers, photos, GPS locations, money, or private production records.
- Free instance disk is ephemeral; data may disappear after redeploy/sleep/restart. **Never store production data here.**
- This test uses *only* disposable test accounts; no live production database or secrets are shared with Render.
- Android physical-device tests of GPS fix, proof photo, live delivery and offline sync still need verification.
- Reconfirm account cost and data-handling before approving any deployment.

In a browser, this staging unlock code is stored in a 12-hour, HttpOnly/Secure/SameSite=Strict cookie after successful entry. App login continues to require the existing ERP account username/password.

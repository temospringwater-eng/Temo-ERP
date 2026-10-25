# TEMO Driver OTP + Express ERP integration — QA only (2026-10-25)

## Implemented

- Android-compatible Express delivery action uses the existing sqlite3 database schema, but **only on disposable QA**.
- A dedicated SQLite connection and `BEGIN IMMEDIATE` transaction commit delivery, order, payment, bottle returns/movements, OTP consumption, verified signature proof and audit together. Failed cash/audit writes roll back the full transaction.
- Proofs are first uploaded to server-controlled private file storage and then registered in a company-, driver-, delivery- and SHA256-scoped QA table. Arbitrary unregistered metadata cannot post payments.
- Duplicate requests with the same stored signature return an idempotent scoped receipt, not a second collection. The expected native receipt has exact delivery/order/company IDs and status `completed`.
- The original OTP code-return feature on the customer-portal route is replaced with a customer-email delivery provider; OTP is no longer returned to either driver or customer HTTP API.
- The SMTP provider is the existing ERP `notificationDeliveryService.sendEmail`; it requires secure environment configuration and returns failure/503 without issuing a challenge if delivery is skipped/failed.
- OTP: six-digit cryptographically random code, hashed in SQLite, 10-minute expiry, max three requests per delivery per hour, five wrong-verification attempts via existing checker.

## Hard deployment boundary

This QA bridge is off unless ALL of these are true:

```text
NODE_ENV=test
TEMO_DRIVER_ATOMIC_QA_ENABLED=true
DB_PATH=<explicit, separately created, disposable QA SQLite file>
```

The bridge also rejects the default project `hayrila.db` path. Never supply a production file as `DB_PATH` or set test variables on production.

SMTP settings are consumed from the existing ERP notification module:

```text
SMTP_HOST=<securely configured SMTP host>
SMTP_PORT=<provider SMTP port>
SMTP_FROM=<verified sender>
SMTP_USER=<if provider requires auth>
SMTP_PASSWORD=<secret, configured in hosting secret store>
SMTP_SECURE=<true or false based on transport>
```

Do not enter credentials into the repository or ChatGPT messages. An email-only OTP channel is implemented; SMS/WhatsApp OTP and final external provider delivery proof are **not verified**.

## Evidence and remaining QA gates

**Locally executed, disposable-only:** 10 original `node:sqlite` atomic tests + 3 file-backed adapter/route tests + 3 OTP provider smoke tests = **16/16 PASS**. Synthetic data only; no real emails sent. The two new repository integration files contain additional cases; they still need a working GitHub runner or authorized local execution.

**GitHub Actions:** workflow run 40186028117 failed before any job steps (0); not a code-test failure and not a passing full repository suite. Account quota or runner provisioning requires independent investigation.

**Still required before real customers:** complete repo test suite, native APK→actual Express staging E2E, actual SMTP deliverability, customer contact confirmation, OTP sender identity policy review, secure immutable proof retention, offline replay verification, signed company approval and explicit production deployment authorization. Existing permissions staging Worker is read-only and remains untouched.

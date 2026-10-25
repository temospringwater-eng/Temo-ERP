# TEMO D1 — Recovery checkpoint / backup gate (QA only)

Verification date: 2026-10-25 (dashboard; UTC bookmark timestamp NOT shown).
Database name: `temo_erp_qa_db`.
Database UUID: `30f7fa07-1053-4fe3-8a3f-8089b146a271`.
Cloudflare D1 Time Travel dashboard: **Enabled**, UI showed a **30-day** recovery period.

## Verified current-state bookmark

```text
0000003a-00000000-0000510f-bfd97eab7a60bfceb978731f25a919b6
```

Retrieved by choosing **Get current Bookmark ID** in the D1 Time Travel tab, after the user authorized the read-only Cloudflare check. The dashboard did not display an exact timestamp for this bookmark. A bookmark is a *temporary recovery point*, NOT a standalone backup file. Validity is limited by retention, and may change with account plan/storage conditions. Do not confuse bookmarking with copy/export.

Cloudflare account was accessible through the owner's saved browser profile. Database showed 11 app tables, approx 81.92 KB storage (dashboard observation, not a full data export).

**No data/schema/Worker writes, no full export, no restore/rollback performed** during this verification.

## Steps to finish Step 1 — durable restorable copy

1. Select an authorized, protected local backup destination; set file access restrictions and ensure `.gitignore` excludes all `*.sql`, `*.db`, `*.sqlite` and `*.zip` backup files. Do not upload secrets, customer rows, password hashes or backups into GitHub issues/PRs, ChatGPT, public files or unencrypted Actions artifacts.
2. Using an authorized local Wrangler login/token with **D1 Read**, export the full database at an approved low-traffic window:

   ```bash
   umask 077
   npx wrangler d1 export temo_erp_qa_db --remote --output=./temo_erp_qa_db-backup-20261025.sql
   sha256sum ./temo_erp_qa_db-backup-20261025.sql
   ```

   This operation **reads confidential company and user records**, must happen only in the owner's secure environment and can block other D1 requests. No such export was performed in the browser check.
3. Verify nonzero export size, `CREATE TABLE` statements for all 11 application tables, and full file digest. Store encrypted copy **outside repository**; retain SHA256, secured storage path, date and authorized operator. Do not paste backup bytes or any tokens in a ticket/chat.
4. Verify the backup is actually restorable in a **new disposable D1 database**, not by restoring over `temo_erp_qa_db`. Apply documented import rules and run schema/row count/FK integrity checks on the disposable copy, avoiding real user exposure. Record success/failure, without logging row data.
5. Only after successful backup and restoration test, create separate *disposable* ERP schema migration rehearsal. Do NOT execute DDL against original D1 before approval.

## Emergency rollback

Cloudflare Time Travel UI permits restoring a database by bookmark/date. **Do not click Restore as a test on the existing D1 database**; it overwrites its current state. Recovery is subject to window expiry and should be owner-approved after stopping writes and recording a fresh pre-restore point. Cloudflare docs note Time Travel is not a database cloning mechanism.

Docs:
- https://developers.cloudflare.com/d1/reference/time-travel/
- https://developers.cloudflare.com/d1/best-practices/import-export-data/
- https://developers.cloudflare.com/d1/wrangler-commands/

## Step 1 acceptance (as of 2026-10-25)

- [x] Connected to owner's database and verified name/UUID.
- [x] Time Travel enabled/recovery window observed.
- [x] Current-state bookmark retrieved and privately documented.
- [ ] Full durable SQL export created in secure backup destination.
- [ ] Encrypted copy and SHA256 retention confirmed.
- [ ] New disposable D1 restore/import drill and integrity checks verified.

**Status: PARTIAL. No production changes; do not proceed to applying ERP migration.**

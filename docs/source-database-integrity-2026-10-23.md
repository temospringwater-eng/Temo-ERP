# Isolated source database integrity findings — 23 October 2026

Source: user-supplied `TEMO-AQUAFLOW.zip`, member `TEMO-AQUAFLOW/hayrila.db`. Inspected **only in a temporary private workspace**. The live database and GitHub repository data were not modified.

## Backup/restore drill
- SQLite `PRAGMA integrity_check` returned `ok` for source and isolated restored copy.
- Table/record counts match: **136 tables**, **1,244 rows**.
- Source database bytes were unchanged after backup/restore.
- Both source and restored copy contain **10 foreign-key violations**. These are pre-existing source-data inconsistencies, not introduced by the restore.

## Foreign-key violations (counts only)
- `audit_logs -> companies`: 2
- `audit_logs -> users`: 2
- `company_currency_settings -> companies`: 3
- `password_reset_tokens -> users`: 1
- `sessions -> users`: 2

No customer names, record IDs or secret values are included in this report.

## Safe reconciliation prerequisites
1. Make a **separate encrypted full copy** of the actual production database (and relevant WAL files) with a verified backup tool. Do not assume this ZIP reflects live production.
2. On a disposable clone, identify which missing company/user records should be recovered versus which orphan records can be expired or archived.
3. Preserve audit trail history; **never delete audit records automatically**. Get owner review before currency-setting reassignment, orphan clean-up or writes to the real database.
4. Run `PRAGMA foreign_key_check` and `PRAGMA integrity_check` again after approved data repair, compare totals and verify normal user login, orders and financial records.
5. Confirm off-site backup and recovery on the actual staging deployment before Go-Live.

A successful SQLite restore of corrupted relational data is **not** proof of referential integrity. Keep release blocked until reviewed.

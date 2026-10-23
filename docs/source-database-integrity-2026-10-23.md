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

## Safe repair performed on the user-supplied database COPY

Using a separate, isolated QA database file (not the original uploaded file or production database):
- All **10** known FK violations were reconciled; subsequent `PRAGMA foreign_key_check` returned **0**.
- All **617 existing audit-log rows** were retained. Four missing user/company references were set NULL while their original missing-parent IDs were retained in `integrity_reconciliation`.
- Three orphan company-currency settings rows were moved to the reconciliation archive with their original values; they were removed only from the active table in the QA copy.
- Two orphan sessions and one orphan password-reset token were revoked in the QA copy; only token SHA-256 digests, not raw bearer tokens, were retained for the reconciliation record.
- Original uploaded SQLite bytes were unchanged, and repaired copy passed `PRAGMA integrity_check`.
- The protected script is `scripts/reconcile-fk-qa.py`, covered by `tests/test_fk_reconciliation.py` in GitHub CI.

**Important:** This clears the FK red cross on the **repaired QA COPY only**. A live production DB was neither accessed nor changed, and it must not be overwritten automatically. Owner-approved production data reconciliation and the retention policy for audit references are still a Go-Live gate.

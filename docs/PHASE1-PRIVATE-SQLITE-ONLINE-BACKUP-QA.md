# Phase 1 — Isolated ERP QA SQLite snapshot and restoration

**Status:** Local/disposable QA snapshot automation. Hosting is **not provisioned** and no live D1/ERP finance sync is active.

## Purpose
The existing `scripts/sqlite-restore-drill.py` tests restoration into a temporary copy and deletes it. New `scripts/qa-sqlite-online-backup.py` produces a durable operator-controlled online QA SQLite snapshot even while the QA database is in WAL mode. It uses SQLite's online backup API, consistent committed state, `PRAGMA integrity_check` and `foreign_key_check`. Snapshot creation is atomic and exclusive, with mode `0600` inside a private owner-only `0700` directory. Source database remains unchanged; failed backups remove temporary files. The script never uploads or deploys anything.

## QA-only operator runbook
Perform **only on a dedicated isolated QA host** after private persistent volume and secrets have been provisioned:
```sh
# Illustrative paths. Never point these commands to hayrila.db or a production volume.
mkdir -p /srv/temo-qa-data /srv/temo-qa-snapshots
chmod 700 /srv/temo-qa-data /srv/temo-qa-snapshots
# Existing isolated QA ERP DB must be on persistent storage:
# DB_PATH=/srv/temo-qa-data/temo-erp-qa.db
python3 scripts/qa-sqlite-online-backup.py \
  --source /srv/temo-qa-data/temo-erp-qa.db \
  --backup-dir /srv/temo-qa-snapshots
```
The output includes a private `backup_path` and SHA-256 hash. Store output privately; **do not publish the backup path, database, secrets or customer rows in GitHub logs/artifacts**. Validate the new snapshot with:
```sh
python3 scripts/sqlite-restore-drill.py \
  --source /srv/temo-qa-snapshots/<exact-snapshot-name>.db
```
Replace the placeholder with the actual path returned on the host. Inspect manifest/integrity; do not restore over a running application. The restore drill creates and removes a temporary copy. The durable snapshot remains on the operator volume until manually retired.

For real customer data, back up using an approved encrypted at-rest/off-site storage policy and tested access controls; these QA-only utilities are not permission to handle production customer databases. Separate source and backup volumes and disaster-recovery plans must be independently verified before production approval.

## Mandatory QA proof
`tests/qa-sqlite-online-backup.integration.test.cjs` checks: nonmutating source, private exact file permission, two independent snapshots, symlink/corrupt/production-path rejection, and an active WAL writer. The generated snapshots run through the existing independent restore drill; CI does not access real tenant data.

## Hosting readiness gate (still BLOCKED)
- Private HTTPS tunnel or reverse proxy with **service authentication** that cannot route straight to localhost for unauthenticated clients.
- Dedicated long-lived SQLite QA volume and private snapshot destination (both owned by runtime user) with restart proof.
- Secret manager holds strong bootstrap/admin passwords, distinct receipt HMAC and transport HMAC; no committed values.
- Backups restored on a separate isolated host after power-cycle/restart test, with checksum/integrity, storage monitoring and operator rollback.
- Do not expose ERP finance bridge to the public network or apply D1 migration before the mapping/reconciliation phases.
- No hosting charges or public promotion without explicit user approval.

**Exit condition:** live isolated host + durable QA volume + externally authenticated private HTTPS + offline restore proof. Passing CI alone does not complete Phase 1.

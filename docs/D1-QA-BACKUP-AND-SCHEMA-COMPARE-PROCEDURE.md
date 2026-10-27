# D1 QA backup/export and read-only schema comparison (owner-run; nothing here modifies data)

Prereq: `CLOUDFLARE_API_TOKEN` (D1:Edit not needed for read; D1 Read + account read) and `CLOUDFLARE_ACCOUNT_ID` set in your shell; never commit them.

```
npx wrangler whoami
npx wrangler d1 list                      # confirm temo_erp_qa_db and its UUID matches the Worker binding DB
npx wrangler d1 time-travel info temo_erp_qa_db        # record bookmark BEFORE anything
npx wrangler d1 export temo_erp_qa_db --remote --output backup/temo_erp_qa_db-$(date -u +%Y%m%dT%H%M%SZ).sql
sha256sum backup/*.sql > backup/SHA256SUMS
```
`backup/` is git-ignored. Restore drill: `npx wrangler d1 create temo_erp_restore_drill` then `npx wrangler d1 execute temo_erp_restore_drill --remote --file=<backup.sql>` and compare table row counts. (Export blocks writes briefly on the DB.)

## Read-only schema comparison (SELECT/PRAGMA only)
```
npx wrangler d1 execute temo_erp_qa_db --remote --json --command "SELECT name,sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name" > remote-schema.json
for t in $(list of 114 tables in services/d1-erp-base-table-manifest-qa.mjs):
  npx wrangler d1 execute temo_erp_qa_db --remote --json --command "SELECT * FROM pragma_table_xinfo('$t')"
  npx wrangler d1 execute temo_erp_qa_db --remote --json --command "SELECT * FROM pragma_foreign_key_list('$t')"
  npx wrangler d1 execute temo_erp_qa_db --remote --json --command "SELECT * FROM pragma_index_list('$t')"
npx wrangler d1 execute temo_erp_qa_db --remote --json --command "SELECT COUNT(*) FROM pragma_foreign_key_check"
```
Compare outputs with `services/d1-erp-base-{column,fk,unique}-manifest-qa.mjs`. Expected before migration: 19 tables, 8 of the 114 absent (the ones in migration 0001), plus drift report for the 11 overlapping tables. Share `remote-schema.json` (schema only, no rows) for review.

## Apply (only after explicit approval)
`npx wrangler d1 execute temo_erp_qa_db --remote --file=migrations/d1-qa/0001_erp_sales_finance_stock_sync_additive.sql`, then repeat comparison. Rollback: D1 Time Travel restore to the recorded bookmark.

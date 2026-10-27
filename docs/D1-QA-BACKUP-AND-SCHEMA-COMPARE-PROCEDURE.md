# D1 QA backup/export and read-only schema comparison (owner-run; nothing here modifies data)

Prereq: `CLOUDFLARE_API_TOKEN` (D1:Edit not needed for read; D1 Read + account read) and `CLOUDFLARE_ACCOUNT_ID` set in your shell; never commit them.

```
npx wrangler whoami
npx wrangler d1 list                      # confirm temo_erp_qa_db and its UUID matches the Worker binding DB
npx wrangler d1 time-travel info temo_erp_qa_db        # record bookmark BEFORE anything
mkdir -p backups
npx wrangler d1 export temo_erp_qa_db --remote --output backups/temo_erp_qa_db-$(date -u +%Y%m%dT%H%M%SZ).sql
sha256sum backups/*.sql > backups/SHA256SUMS
```
`backups/` is git-ignored; keep exports there and do not stage them. Restore drill: `npx wrangler d1 create temo_erp_restore_drill` then `npx wrangler d1 execute temo_erp_restore_drill --remote --file=<backups/exported-file.sql>` and compare table row counts. (Export blocks writes briefly on the DB.)

## Read-only schema comparison (SELECT/PRAGMA only)
```
mkdir -p backups
npx wrangler d1 execute temo_erp_qa_db --remote --json --command "SELECT name,sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name" > backups/remote-schema.json
for t in $(node --input-type=module -e "import {ERP_D1_BASE_TABLES} from './services/d1-erp-base-table-manifest-qa.mjs'; if(ERP_D1_BASE_TABLES.length!==114) process.exit(1); console.log(ERP_D1_BASE_TABLES.join(' '))"); do
  npx wrangler d1 execute temo_erp_qa_db --remote --json --command "SELECT * FROM pragma_table_xinfo('$t')"
  npx wrangler d1 execute temo_erp_qa_db --remote --json --command "SELECT * FROM pragma_foreign_key_list('$t')"
  npx wrangler d1 execute temo_erp_qa_db --remote --json --command "SELECT * FROM pragma_index_list('$t')"
done
npx wrangler d1 execute temo_erp_qa_db --remote --json --command "SELECT COUNT(*) FROM pragma_foreign_key_check"
```
Compare outputs with `services/d1-erp-base-{column,fk,unique}-manifest-qa.mjs`. Migration 0001 is a partial proposal for eight tables, not a claim that it closes the schema gap. The comparison must establish the actual missing-table and overlap sets and report all column, FK, and index drift before any apply. Keep and share `backups/remote-schema.json` (schema only, no rows) from a protected location for review.

## Apply (only after explicit approval)
`npx wrangler d1 execute temo_erp_qa_db --remote --file=migrations/d1-qa/0001_erp_sales_finance_stock_sync_additive.sql`, then repeat comparison. Rollback: D1 Time Travel restore to the recorded bookmark.

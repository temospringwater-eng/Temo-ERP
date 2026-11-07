# QA Worker deployment safety

The existing ERP server uses Express and SQLite and is not directly compatible with Cloudflare Workers D1.

The existing worker/erp-d1-stage1-qa.mjs is a diagnostic endpoint, not a complete ERP backend. Do not deploy it over temo-erp-qa-api.

Before deploying any API, verify an isolated D1 database ID, explicit Worker entrypoint, authentication, CI unit and integration tests, and an independently tested rollback.

No production or remote database changes are authorized by this document.

# TEMO ERP HTTPS Staging Deployment

Branch: `integration/water-club-api`

This is the existing TEMO ERP prepared for a staging deployment. It is **not** a second ERP/backend.

## Required runtime

- Node.js 20+
- HTTPS public URL supplied by the hosting platform
- Persistent volume mounted at `/data`
- `DB_PATH=/data/hayrila.db`
- `PORT` supplied by the host (defaults to 3000)

## Source required before deployment

The branch must contain the current runtime source:
- `server.js`
- `services/`
- `public/`
- `package.json`
- `package-lock.json`

Do not deploy local `.env`, `node_modules`, production/debug SQLite databases, payment-proof uploads, logs or backups.

## Staging database

Use a fresh staging SQLite database on the persistent volume. Do not upload the production/local database merely to make staging work.

After startup, create/provision one staging company/customer portal account for Step 4B integration tests only.

## Health check

Use:

`GET /api/health`

Expected success:

```json
{"ok":true,"service":"temo-aquaflow","database":"reachable"}
```

## Water Club connection

After the staging URL is available, set the website Worker environment variable:

`ERP_API_BASE_URL=https://<staging-erp-host>`

Then run login, logout, session-expiry and tenant-isolation tests.

## Go-live rule

This staging configuration does not authorize production deployment or merge to `main`. Final owner approval is required.

# Secure administrator bootstrap

New TEMO ERP installations no longer create accounts using a public, known password.

## First deployment (private/staging/production)

1. Configure two **different**, randomly generated bootstrap secrets using secret manager environment variables (not code, ZIPs, repository files, issue comments, or screenshots):
   - `TEMO_BOOTSTRAP_SUPERADMIN_PASSWORD` — required for a new database's platform super admin
   - `TEMO_BOOTSTRAP_COMPANY_ADMIN_PASSWORD` — optional for the sample company's admin
2. Set `NODE_ENV=production`. Both secrets must have at least 16 characters.
3. Start the Node service. If the platform super admin cannot be provisioned, the process fails closed.
4. A legacy `superadmin` or `admin` account with the known old seeded password must have a replacement configured: the password is securely re-hashed, old sessions are revoked, and company admins are flagged for password change.
5. Never run a public deployment with `NODE_ENV=test`. That mode is reserved for disposable isolated CI databases.

## Existing installations

Existing accounts that already have a different, non-default password are not overwritten. Record and securely distribute the configured secrets before rebooting a database containing legacy admin accounts; missing replacements prevent startup. Take a private database backup before the migration and verify that privileged user login works afterward.

Do not commit `.env`, `*.db`, backups, payment proofs, service credentials or customer information. Note: `.gitignore` does not remove previously committed database files from Git history; assess historical repository exposure separately before sharing or deploying.

## Verification

`npm ci`, `npm test`, staging privileged login, production health/readiness, and a disaster-recovery restore test are all required before merging and Go-Live. Passing unit/integration tests alone is not a security audit or deployment authorization.

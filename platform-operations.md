# Platform operations

## Backup and disaster recovery

- `POST /api/backups` creates a tenant backup for the authenticated tenant.
- `scope: "full"` is restricted to `super_admin` and includes a redacted metadata snapshot of every table.
- Local backups use the `LocalBackupProvider`; the off-site provider fails closed until a real provider is configured.
- Backups include SHA-256 checksums and can be checked with `POST /api/backups/:id/validate`.
- Validation is metadata-only. Automatic destructive restore is intentionally disabled.
- `POST /api/backup-jobs` stores hourly, daily, or weekly schedules and retention days. The scheduler runs due jobs without crossing tenant boundaries.

## Security and integrations

- Security diagnostics cover active sessions, API keys, audit logging, and automatic-restore state.
- Session listings expose only token prefixes. API keys are shown once at creation and stored hashed.
- `/api/v1/metadata` publishes versioned API metadata.
- Integration adapters are configuration-only until explicitly enabled and implemented. Delivery requests are recorded with idempotency keys; no external request is fabricated or sent.

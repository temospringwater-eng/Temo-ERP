# TEMO ERP source recovery audit (23 October 2026)

## Findings
- Main branch contains `server.js` requiring modules in `services/`, but service modules are not in the inspected GitHub commit.
- Main also lacks `public/index.html` and `tests/` in the inspected source listing.
- User-provided local ZIP was inspected and a clean 41-file source archive prepared separately.
- Local verification environment Node.js v22.16.0, npm v10.9.2.
- `npm ci --ignore-scripts` did not complete; `express`, `dotenv`, and `sqlite3` remain unavailable.
- `npm test` yielded 8 passes, 19 failures, most associated with missing runtime dependencies and servers failing to start. These are **not** verified application-logic failures.

## Recovery gate
1. Restore full source from the clean archive to this branch only, comparing existing files before replacement.
2. Exclude .env, SQLite databases, node_modules, secrets and customer data.
3. Run `npm ci` on a supported host with Node LTS (allow required native SQLite install scripts).
4. Run `npm test` and `npm start`, then exercise auth, tenant isolation and order-delivery-payment workflow.
5. Merge only after review and passing checks.

No production deployment, live database migration, or main-branch modification is authorized by this document.

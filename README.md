# TEMO-AQUAFLOW

TEMO-AQUAFLOW is a water-business management application built with Node.js, Express, and SQLite.

## Implemented features

- Account creation, login, logout, and password reset
- Company settings and role-based user management
- Dashboard KPIs, recent sales, and low-stock alerts
- Product and inventory management
- Customer and supplier records
- Sales, invoice preview, purchases, expenses, and payments
- Orders and delivery management with company-scoped driver assignment and status tracking
- Driver mode for assigned/today routes, contact/map links, start/deliver/fail/reschedule actions, payment collection, bottle returns, notes, and history
- Bottle deposit reconciliation built on existing bottle movements and delivery bottle counts: company-scoped customer/driver/warehouse/damaged/lost balances, QR/barcode/bottle identifiers, guarded custody transfers, transaction history, CSV reporting, permissions, tenant isolation, and audit records
- Customer QR system for company-scoped customers, locations, bottles, products, orders, and deliveries with generation, printing, authorized lookup, revocation, history, and audit records
- Recurring delivery subscriptions with daily, alternate-day, weekly, monthly, and custom schedules
- Stock movements and warehouse tracking
- Reports and analytics
- Company-scoped sales and demand forecasting with a deterministic recent-average/trend baseline, data-window/confidence explanation, insufficient-data guard, and future provider abstraction; no external AI calls
- Production management and water quality/lab management: company-scoped production lines and batches, existing-product inventory consumption/output movements, validated batch status workflow, lab parameters/results, pass/fail review, release gating, certificates of analysis, traceability, role permissions, audit logging, reports, and responsive UI
- Secure metadata-first document and certificate management for company assets, vehicles, employees, production batches, lab results, and customers: version/checksum/MIME validation, tenant-scoped access rules, external storage adapter descriptors (no raw file handling), preview/download metadata, expiry reminders, lifecycle statuses, and audit logging
- Company-scoped, read-only audit-log administration with date/action/entity/user filters, bounded pagination, and CSV export
- Company-scoped customer complaints/support with assignment, status workflow, notes, resolutions, and audit history
- Company-scoped fleet management with vehicle compliance, service history, driver assignment, lifecycle status, and audit history
- Company-scoped employee management with employee IDs, department/role, salary/contact details, attendance and leave summaries, optional links to existing users (including drivers), role protection, and audit history
- Attendance check-in/check-out with date filtering, linked-employee validation, tenant isolation, and audit history
- Payroll runs and generated payslips from active employee salary records, duplicate-period validation, role protection, tenant isolation, and audit history
- Franchise management built on the existing company tenant model: parent/franchise/branch hierarchies, status and agreement metadata, fees, revenue shares, manager/employee assignments, customer/inventory/employee/financial/report scopes, explicit consolidated-report permissions, recursive authorized reporting, tenant isolation, validation, audit logging, and responsive UI
- Authenticated company-scoped CSV exports for customers, orders, inventory, and finances, plus role-protected SQLite backups
- Company-scoped invoice detail and print-ready invoice export; users can print or choose **Save as PDF** in the browser print dialog
- Localization foundation for English, Urdu, and Arabic: primary navigation/auth labels, persistent per-user language preference, company default language, and RTL layout for Urdu/Arabic
- Delivery route optimization foundation: company-scoped route/stop tables and APIs, pending-delivery selection, area grouping, deterministic coordinate/address ordering, estimates, manual reorder, driver assignment/progress, navigation links, permissions, and audit logging. This is not AI and does not call external map APIs.

### Customer self-service portal and PWA

Customers use `/customer.html` as an installable, responsive PWA. Company managers provision access with `POST /api/customers/:id/portal-access` (email plus an 8-character minimum password), and customers sign in through `POST /api/customer/login`. Customer sessions are linked to one tenant and customer record; portal APIs under `/api/customer/*` never accept caller-supplied company or customer IDs. The portal provides scoped orders, invoices, payments, recurring deliveries, complaint creation/status, bottle balances, profile updates, and validated order placement. `customer-manifest.webmanifest` and `customer-sw.js` cache only the authenticated shell; API data is never cached. Customer actions are audit logged and customer accounts cannot access company-management APIs.

### Localization foundation

The language selector is available on the login screen and in the authenticated top bar. English remains the default and existing untranslated screens intentionally remain in English; this is a foundation rather than a full translation. Authenticated users can persist their own language with `PATCH /api/me/language` (`en`, `ur`, or `ar`). Company administrators can set the company default language from **Companies & Users > Company Settings**. Language updates are authenticated and company settings remain tenant-scoped.

## Run locally

1. Install Node.js LTS from https://nodejs.org.
2. Open a terminal in this folder.
3. Run:

```bash
npm install
npm start
```

4. Open http://localhost:3000.

The SQLite database is stored in `hayrila.db` and is created or updated when the server starts.

### SaaS billing notifications

Step 7 adds tenant-scoped subscription billing, renewal requests, payment-proof review, in-app notifications, and subscription invoice downloads. Optional outbound delivery uses these environment variables:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and optional `SMTP_SECURE=true`
- `WHATSAPP_API_URL`, `WHATSAPP_ACCESS_TOKEN`, and `WHATSAPP_PHONE_NUMBER_ID` for an official WhatsApp Business provider

When these values are absent, email and WhatsApp deliveries are recorded as `skipped`; in-app notifications continue to work. Payment proofs are stored below `storage/subscription-payment-proofs` with tenant-scoped metadata and review status. The reminder scheduler runs in each application process every six hours and uses a database uniqueness key to prevent duplicate reminders within one process/database. Deployments with multiple application instances should use one scheduler instance or a shared database with appropriate SQLite write coordination.

### Customer complaints/support

Complaints are isolated by company and available from **Complaints & Support**. Authorized company users can create complaints and add notes; managers and company administrators can assign users, change status (`open`, `assigned`, `in_progress`, `resolved`, `closed`), and record resolutions. APIs are `GET/POST /api/complaints`, `PATCH /api/complaints/:id`, `POST /api/complaints/:id/notes`, and `POST /api/complaints/:id/resolve`; changes are audit logged.

### Production and water quality

Production is intentionally transactional: the application never seeds batches, lab tests, results, or certificates. Managers create batches from existing company products, allocate existing inventory as inputs, start batches to consume stock movements, complete batches to receive finished-goods stock, and release only after a passed lab test. APIs include `/api/production/lines`, `/api/production/batches`, `/api/production/batches/:id/inputs`, batch start/complete/release actions, `/api/lab/parameters`, `/api/lab/tests`, result/review/certificate actions, `/api/quality/certificates`, and `/api/production/reports`. All records enforce tenant scope, validation, role checks, and audit entries.

### Delivery route planning

Managers and authorized staff can create company-scoped routes from pending deliveries in **Orders & Delivery**. `GET /api/routes/candidates`, `GET /api/routes`, `POST /api/routes`, `PATCH /api/routes/:id`, `POST /api/routes/:id/reorder`, and `POST /api/routes/:id/progress` support selection, area grouping, deterministic ordering, estimates, manual ordering, assignment, and progress. Customer `area`, `latitude`, and `longitude` values are used when available; otherwise the service returns a clear insufficient-location message and sorts by area/address/ID. Navigation links are generated locally and no external map or AI provider is called. Route changes are tenant-scoped, role-protected, validated, and audit logged.

### Franchise management

Franchise relationships reuse the existing `companies` and `users` tenant model; no parallel tenant store is created. Authorized parent company administrators can create and manage `franchise` and `branch` relationships, maintain status, dates, agreement numbers, agreements, fees, currencies, and revenue-share records, and assign existing users as franchise managers or employees. Assignments receive explicit read/write scopes for management, employees, customers, inventory, financial data, reports, and consolidated reports.

The authenticated APIs are `GET/POST /api/franchises`, `GET/PATCH/DELETE /api/franchises/:id`, child branches under `/api/franchises/:id/branches`, agreement/fee/revenue-share/assignment/scope/report-permission endpoints under the same relationship, `GET /api/franchise-scope`, scoped data at `/api/franchises/:parentCompanyId/scope/:scope`, and authorized consolidated reports at `/api/franchises/:parentCompanyId/consolidated-reports` (also available under `/reports/consolidated`). Hierarchy cycles, duplicate/conflicting parents, invalid dates, amounts, currencies, percentages, statuses, and unauthorized tenant access are rejected. Consolidated results recursively include only authorized descendants and expose metrics appropriate to the requested report key. Mutations write company-scoped audit records, and the responsive **Franchise Management** UI hides controls and reports unless the current user is authorized.

### WhatsApp customer assistant and delivery heatmap

WhatsApp integration is provider-agnostic and fails closed until a company manager configures an adapter with `PUT /api/whatsapp/config`. Inbound webhooks use `POST /api/whatsapp/webhook/:companyId`, require an HMAC `X-WhatsApp-Signature`, and identify customers only by a unique company-scoped phone match. Conversation history, intents, confirmations, human escalation, bottle-pickup requests, complaints, and audit records are stored per tenant. Supported intents are place/repeat order, status, balance, invoice/payment, bottle pickup, subscription pause/resume, complaint/support, and human escalation. No provider generates message text; an unconfigured provider returns `provider_not_configured`.

Delivery heatmap analytics are available at `GET /api/analytics/delivery-heatmap` and in **Orders & Delivery**. Only recorded `customers.latitude` and `customers.longitude` values are used. If no valid coordinates exist for the selected company/period, the API and UI report the heatmap as unavailable rather than inventing locations.

### Driver delivery workflow

Users with the `driver` or `delivery_driver` role see **Driver mode**. It loads their company-scoped deliveries for a selected date (today by default) and completed history. Each assigned card provides phone/map links and real actions for start, deliver, fail, or reschedule. Delivery completion can record a payment method/amount, bottle type and returned/empty counts, and notes. The API is protected under `GET /api/driver/deliveries` and `POST /api/driver/deliveries/:id/action`; all actions and collections are audit logged.

### Recurring delivery subscriptions

Authenticated company users can manage subscriptions from **Recurring Deliveries**. The API is company-scoped under `/api/delivery-subscriptions` and supports create/list/update, pause, resume, skip, and `POST /api/delivery-subscriptions/generate-due`. Due-order generation records unique schedule occurrences, so repeating the request does not create duplicate orders.

### Attendance and payroll

Attendance is available from **Attendance**. `GET /api/attendance` supports `date`, `startDate`, `endDate`, and `employeeId`; `POST /api/attendance/check-in` and `/api/attendance/check-out` accept a linked `employeeId` for managers or default to the signed-in user's linked employee. Payroll managers/accountants use `POST /api/payroll/runs` with `periodStart` and `periodEnd`, then `GET /api/payroll/runs` and `GET /api/payroll/runs/:id/payslips`. All records are company-scoped, validated, role-protected, and audit logged.

### Sales and demand forecasting

Authorized managers, company administrators, super admins, and accountants can use **Reports > Sales & demand forecast**. `GET /api/analytics/forecast` accepts `metric=units|revenue`, `horizon=1..12`, and an optional company-owned `productId`. It uses only company-scoped historical sales, non-cancelled orders, and delivery subscription records. The deterministic provider calculates a recent-period average plus observed trend, and returns the exact `Not enough historical data for reliable forecasting.` message when fewer than three observed periods are available. Responses include the data window, source counts, confidence, explanation, and forecast periods. Forecast reads are audit logged; no external AI API is called. The service is provider-agnostic so a future AI provider can be introduced without changing the API contract.

### Smart reorder and reminders

Customers and Reports include company-scoped smart reorder insights calculated only from non-cancelled order history. `GET /api/analytics/reorder` and `GET /api/customers/:id/reorder-insights` return average consumption, last order, average interval, expected next order, suggested quantity, and an explicit `insufficient_history` status when the configured minimum order count is not met. Managers/company administrators can configure `GET/PATCH /api/reorder-rules` (minimum orders, reminder lead days, quantity buffer). Authorized staff can use `POST /api/customers/:id/reorder` to create a real order; the action is tenant-isolated, role-protected, validated, and audited. `POST /api/customers/:id/reorder-reminder` records a provider-neutral action and returns `not_configured`; no WhatsApp or message provider is called.

### Audit logs

Super admins, company administrators, managers, and accountants can open **Audit logs** for the active company. Results are read-only and tenant-isolated, with validated date, action, entity type, and user name/username or ID filters, a maximum page size of 100, and deterministic pagination. CSV export is bounded to 5,000 matching records and records the export itself; audit records cannot be edited or deleted. The APIs are `GET /api/audit-logs` and `GET /api/audit-logs/export`.

### Data export and backups

Managers, company administrators, and accountants can download company-scoped CSV files from **Reports**: `GET /api/exports/customers`, `/orders`, `/inventory`, and `/finances`. Optional `from` and `to` query parameters use `YYYY-MM-DD` and are validated. Only super admins can download the full point-in-time SQLite backup from **Company Settings** via `GET /api/backup`; company administrators cannot access it because a full SQLite file contains all tenants. Export and backup actions are recorded in audit logs; responses contain only business data and never password hashes, session tokens, or other secrets.

### Invoice printing and PDF-ready export

Sales invoices are available from the **Sales List** using **View / Print**, or from the latest invoice preview. `GET /api/sales/:id/invoice?action=view|print` requires authentication, enforces the active company scope, validates sale ownership, and records an audit event. The print-friendly view uses escaped values and the browser's print dialog; choose **Save as PDF** there. No server-side PDF dependency is required.

### Fleet management

Managers and company administrators can manage Fleet records. The company-scoped APIs are `GET/POST /api/vehicles`, `PATCH /api/vehicles/:id`, and `PATCH /api/vehicles/:id/status`; vehicle numbers, drivers, compliance dates, service history, and lifecycle changes are validated and audit logged.

### Employee management

Managers and company administrators can manage Employees. The company-scoped APIs are `GET/POST /api/employees`, `PATCH /api/employees/:id`, and `PATCH /api/employees/:id/status`. Employee IDs are unique per company, records include contact, salary, department/role, attendance and leave summaries, and `userId` links an existing company user instead of creating a duplicate account. Linked driver users remain compatible with delivery and fleet assignment; changes are audit logged.

### Advanced credit, pricing, discounts, and commissions

The **Credit & Pricing** and **Commissions** sections use tenant-scoped records and existing customers, products, sales, payments, drivers, and salesmen. Credit policies and customer accounts expose limits, terms, overdue balances, holds, and release actions through `/api/credit/*`; posted customer sales/payments update the credit ledger and enforce blocks/limits. Price lists and customer assignments are managed with `/api/price-lists` and `/api/customers/:customerId/price-list`; sale pricing resolves the assigned list before the product default. Discount requests and manager decisions use `/api/discount-approvals`. Commission rules, sale-derived statements, settlement status, and CSV export use `/api/commission-rules` and `/api/commissions/*`. All writes validate role access, company ownership, and audit changes; no transactions are seeded by this feature.

## Project structure

- `server.js` — Express server, SQLite schema, authentication, and API endpoints
- `public/index.html` — application markup
- `public/styles.css` — application styling
- `public/app.js` — client-side state and API integration
- `docs/requirements.md` — current requirements and implementation status

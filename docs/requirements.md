# Business Software Requirements

## Core modules and status

| Module | Status |
|---|---|
| Dashboard | Implemented |
| Product inventory | Implemented |
| Sales management | Implemented |
| Purchase management | Implemented |
| Customer records | Implemented |
| Supplier records | Implemented |
| Expense tracking | Implemented |
| Reports and analytics | Implemented: company-scoped profitability engine, gross/net margin, COGS and expense breakdown, customer profitability, route profitability, validated role-protected APIs, audit logging, responsive Reports UI, and CSV summary export using recorded sales, orders, products, expenses, deliveries, and routes only |
| User roles | Implemented |
| Company settings | Implemented |
| Payments | Implemented |
| Stock movements and warehouses | Implemented |
| Bottle/container tracking | Implemented: company-scoped bottle types and movements, QR/barcode/bottle identifiers, customer/driver custody, warehouse/available, damaged and lost reconciliation, delivery-count linkage, negative-balance validation, transaction history, CSV report export, permissions, tenant isolation, and automatic audit records |
| Customer QR system | Implemented: company-scoped QR generation for customers, locations, bottles, products, orders, and deliveries; batch generation, print-ready PNG output, authorized lookup, revocation/reactivation, lookup history, validation, permissions, tenant isolation, and audit records |
| Audit logs | Implemented: immutable company-scoped records with validated date/action/entity/user filters, bounded pagination, role protection, read-only UI, and bounded CSV export |
| Orders and delivery management | Implemented: company-scoped orders, normalized items/deliveries, driver assignment, and lifecycle statuses |
| Recurring delivery subscriptions | Implemented: normalized schedules/occurrences, pause/resume/skip controls, and idempotent due-order generation |
| Driver mobile workflow | Implemented: driver-only assigned/today route, contact/map links, lifecycle actions, rescheduling, collection, bottle counts, notes, history, validation, and audit logging |
| Subscription administration | Implemented for super admins |
| Franchise management | Implemented: existing-company parent/franchise/branch relationships, statuses, dates, agreements, fees, currencies, revenue shares, manager/employee assignments, explicit employee/customer/inventory/financial/report scopes, consolidated-report permissions, recursive authorized reporting, hierarchy validation, tenant isolation, audit logging, authenticated APIs, and responsive UI |
| Customer complaints/support | Implemented: company-scoped complaints, role-protected assignment/status workflow, notes/resolutions APIs, validation, responsive UI, and audit logging |
| Vehicle/fleet management | Implemented: company-scoped vehicles, driver assignment, service schedules/history, maintenance costs, fuel logs, equipment/assets, assignments, document expiry alerts, validation, role-protected APIs, audit logging, fleet reports, and responsive Fleet UI |
| Employee management | Implemented: company-scoped employee records linked to existing users, employee IDs, department/role, salary/contact data, attendance/leave summaries, driver compatibility, validation, role-protected create/list/update/status APIs, audit logging, and responsive Employees UI |
| Attendance | Implemented: company-scoped daily attendance records, linked-employee check-in/check-out, date/employee filtering, validation, role protection, tenant isolation, audit logging, and responsive UI |
| Payroll and payslips | Implemented: company-scoped payroll runs and employee-linked payslips, active-employee salary generation, duplicate-period and deduction validation, role protection, tenant isolation, audit logging, and responsive UI |
| Backup and data export | Implemented: authenticated role-protected company-scoped CSV exports for customers, orders, inventory, and finances; validated date filters; audited downloads; and full SQLite backups restricted to super admins to prevent cross-tenant disclosure |
| Invoice printing and PDF-ready export | Implemented: authenticated company-scoped invoice detail endpoint with ownership validation and audit logging; escaped print-friendly browser view supports printing or Save as PDF without a server-side PDF dependency |
| AI route optimization foundation | Implemented: company-scoped pending-delivery candidates, area grouping, deterministic provider-agnostic coordinate/address ordering, distance/time estimates, manual reorder, driver assignment/progress, navigation links, permissions, validation, audit logs, and responsive Orders/Driver UI. No real AI or external map API calls are made; insufficient location data is reported clearly. |
| Advanced area / zone management | Implemented: company-scoped country, city, area, zone, sector, and route hierarchy; parent and duplicate validation; customer and driver assignments; role-protected APIs; immutable audit events; real order/customer area summaries; and responsive management UI. |
| AI sales and demand forecasting foundation | Implemented: company-scoped analytics forecast API and responsive Reports UI using only historical sales, non-cancelled orders, and subscription records; deterministic recent-average/trend provider, explanation, confidence, data window, exact insufficient-data message, permissions, validation, tenant isolation, and audit logging. No external AI API calls. |
| Smart reorder and reminders | Implemented: company-scoped customer analytics from real non-cancelled order history, explicit insufficient-history status, configurable reminder rules, role protection, tenant isolation, validation, audit logging, real one-click reorder orders, Customers/Reports UI, and provider-neutral not-configured reminder action. No WhatsApp integration. |
| Multi-currency | Implemented: company-scoped base/display currencies, supported ISO-4217 currency validation, explicit exchange-rate records with provider-safe states and effective dates, conversion API that never mutates stored amounts, audit logging, tenant isolation, and dynamic UI currency formatting. Missing rates fail safely; no rates are fabricated. |
| Global search | Implemented: paginated authorized search across customers, orders, products, invoices/sales, bottles, vehicles, documents, and users with company-scoped SQL boundaries and role protection. |
| Advanced notifications | Implemented: paginated read/unread notification center, mark-read/read-all APIs, per-user channel preferences, company templates, delivery/provider-safe status records, validated message creation, audit logging, tenant isolation, and responsive UI. External delivery providers are not invoked when unavailable. |

## MVP scope

- Account creation and admin login
- Add and edit products
- Sales entry and invoice preview
- Automatic stock updates and low-stock warnings
- Daily sales summary and reporting

## Remaining roadmap

- Restore workflows and scheduled/off-site backups
- External API integrations

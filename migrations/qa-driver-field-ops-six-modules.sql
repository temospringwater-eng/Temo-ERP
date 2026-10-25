-- QA only: apply manually to an isolated disposable copy of hayrila.db.
-- Not automatically applied in ERP startup or Cloudflare D1.
CREATE TABLE IF NOT EXISTS driver_field_permissions(
 company_id INTEGER NOT NULL,driver_id INTEGER NOT NULL,
 permission TEXT NOT NULL CHECK(permission IN
 ('create_customer','create_order','view_customer_ledger','collect_recovery','view_zone','view_van_stock')),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 granted_by INTEGER, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,driver_id,permission));
CREATE TABLE IF NOT EXISTS driver_field_receipts(
 company_id INTEGER NOT NULL,driver_id INTEGER NOT NULL,
 idempotency_key TEXT NOT NULL,action TEXT NOT NULL,request_hash TEXT NOT NULL,
 result_json TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,driver_id,idempotency_key));
CREATE TABLE IF NOT EXISTS driver_field_customer_assignments(
 company_id INTEGER NOT NULL,driver_id INTEGER NOT NULL,customer_id INTEGER NOT NULL,
 source TEXT NOT NULL DEFAULT 'created',created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,driver_id,customer_id));
CREATE TABLE IF NOT EXISTS driver_field_van_movements(
 id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL,
 driver_id INTEGER NOT NULL,product_id INTEGER NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity<>0),
 movement_type TEXT NOT NULL CHECK(movement_type IN ('load','return','adjust')),
 idempotency_key TEXT NOT NULL,created_by INTEGER NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(company_id,driver_id,idempotency_key,product_id));
CREATE INDEX IF NOT EXISTS idx_driver_van_company_driver
 ON driver_field_van_movements(company_id,driver_id,product_id);
CREATE INDEX IF NOT EXISTS idx_driver_field_customer
 ON driver_field_customer_assignments(company_id,driver_id,customer_id);

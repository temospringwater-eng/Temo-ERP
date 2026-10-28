-- QA ONLY. Additive van ledger; never execute against remote D1 without backup and approval.
CREATE TABLE IF NOT EXISTS van_stock_balances (
 company_id INTEGER NOT NULL, driver_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
 quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
 PRIMARY KEY(company_id,driver_id,product_id)
);
CREATE TABLE IF NOT EXISTS van_stock_movements (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER NOT NULL, driver_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
 idempotency_key TEXT NOT NULL, movement_type TEXT NOT NULL
 CHECK(movement_type IN ('load','deliver','return')),
 quantity INTEGER NOT NULL CHECK(quantity > 0),
 request_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(company_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_van_stock_driver_product ON van_stock_movements(company_id,driver_id,product_id);

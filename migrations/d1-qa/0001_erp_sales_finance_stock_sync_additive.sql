-- TEMO ERP D1 QA migration 0001: additive, idempotent. NOT APPLIED to any remote database.
-- Creates only missing tables; never alters/drops/inserts. Requires owner approval + verified backup.
CREATE TABLE IF NOT EXISTS sales (
 id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, total_amount REAL NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, company_id INTEGER, customer_id INTEGER, salesman_id INTEGER,
 created_by INTEGER, invoice_number TEXT DEFAULT '', status TEXT DEFAULT 'pending',
 discount REAL DEFAULT 0, tax REAL DEFAULT 0, due_date TEXT);
CREATE TABLE IF NOT EXISTS sale_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
 quantity INTEGER NOT NULL, unit_price REAL NOT NULL, total_price REAL NOT NULL, company_id INTEGER,
 FOREIGN KEY (sale_id) REFERENCES sales(id), FOREIGN KEY (product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS warehouses (
 id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL,
 address TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (company_id) REFERENCES companies(id));
CREATE TABLE IF NOT EXISTS stock_movements (
 id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, warehouse_id INTEGER,
 product_id INTEGER NOT NULL, customer_id INTEGER, movement_type TEXT NOT NULL,
 quantity INTEGER NOT NULL DEFAULT 0, reference TEXT DEFAULT '', notes TEXT DEFAULT '',
 created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (company_id) REFERENCES companies(id), FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
 FOREIGN KEY (product_id) REFERENCES products(id), FOREIGN KEY (customer_id) REFERENCES customers(id));
CREATE TABLE IF NOT EXISTS bottles (
 id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL,
 capacity_litres REAL NOT NULL, bottle_type TEXT NOT NULL DEFAULT 'returnable', active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, qr_code TEXT DEFAULT '', barcode TEXT DEFAULT '',
 bottle_identifier TEXT DEFAULT '', UNIQUE(company_id, code), FOREIGN KEY (company_id) REFERENCES companies(id));
CREATE TABLE IF NOT EXISTS bottle_movements (
 id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, bottle_id INTEGER NOT NULL,
 customer_id INTEGER, movement_type TEXT NOT NULL, quantity INTEGER NOT NULL, reference TEXT DEFAULT '',
 notes TEXT DEFAULT '', created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 driver_id INTEGER, warehouse_id INTEGER,
 FOREIGN KEY (company_id) REFERENCES companies(id), FOREIGN KEY (bottle_id) REFERENCES bottles(id),
 FOREIGN KEY (customer_id) REFERENCES customers(id), CHECK (quantity > 0));
CREATE TABLE IF NOT EXISTS credit_ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, sale_id INTEGER, payment_id INTEGER,
 entry_type TEXT NOT NULL CHECK(entry_type IN ('invoice','payment','credit','debit','writeoff')), amount REAL NOT NULL, due_date TEXT, note TEXT DEFAULT '', created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(company_id) REFERENCES companies(id), FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(sale_id) REFERENCES sales(id), FOREIGN KEY(payment_id) REFERENCES payments(id));
CREATE TABLE IF NOT EXISTS offline_sync_operations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, driver_id INTEGER NOT NULL,
 idempotency_key TEXT NOT NULL, operation_type TEXT NOT NULL, entity_type TEXT NOT NULL DEFAULT 'delivery',
 entity_id INTEGER, request_hash TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','conflict','failed')),
 result TEXT, conflict_code TEXT, conflict_message TEXT, client_timestamp TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, processed_at TEXT,
 UNIQUE(company_id, driver_id, idempotency_key),
 FOREIGN KEY (company_id) REFERENCES companies(id), FOREIGN KEY (driver_id) REFERENCES users(id));
CREATE INDEX IF NOT EXISTS idx_sales_company_created ON sales(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bottles_company ON bottles(company_id);
CREATE INDEX IF NOT EXISTS idx_bottles_identifiers ON bottles(company_id, barcode, qr_code, bottle_identifier);
CREATE INDEX IF NOT EXISTS idx_bottle_movements_company ON bottle_movements(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bottle_movements_driver ON bottle_movements(company_id, driver_id, created_at);
CREATE INDEX IF NOT EXISTS idx_offline_sync_company_driver_created ON offline_sync_operations(company_id, driver_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_offline_sync_company_status ON offline_sync_operations(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_company_customer ON credit_ledger(company_id, customer_id, created_at);

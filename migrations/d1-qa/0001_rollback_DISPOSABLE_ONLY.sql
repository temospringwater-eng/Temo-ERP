-- Rollback for 0001. Use ONLY on disposable DBs, or on QA when all 8 tables are verified empty. Prefer D1 Time Travel restore.
DROP TABLE IF EXISTS offline_sync_operations;
DROP TABLE IF EXISTS credit_ledger;
DROP TABLE IF EXISTS bottle_movements;
DROP TABLE IF EXISTS bottles;
DROP TABLE IF EXISTS stock_movements;
DROP TABLE IF EXISTS warehouses;
DROP TABLE IF EXISTS sale_items;
DROP TABLE IF EXISTS sales;

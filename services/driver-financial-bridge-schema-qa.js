'use strict';
// Created ONLY on a disposable QA DB, after an explicit source-to-ERP identity review.
const bridgeSchema=[
 "CREATE TABLE IF NOT EXISTS driver_finance_bridge_map(d1_company_id INTEGER NOT NULL,d1_driver_id INTEGER NOT NULL,d1_order_id INTEGER NOT NULL,d1_delivery_id INTEGER NOT NULL,erp_company_id INTEGER NOT NULL,erp_driver_id INTEGER NOT NULL,erp_order_id INTEGER NOT NULL,erp_delivery_id INTEGER NOT NULL,erp_customer_id INTEGER NOT NULL,erp_bottle_id INTEGER,inventory_policy TEXT NOT NULL DEFAULT 'blocked',invoice_policy TEXT NOT NULL DEFAULT 'blocked',PRIMARY KEY(d1_company_id,d1_delivery_id),UNIQUE(erp_company_id,erp_delivery_id))",
 "CREATE TABLE IF NOT EXISTS driver_finance_bridge_receipts(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,d1_company_id INTEGER NOT NULL,d1_delivery_id INTEGER NOT NULL,erp_delivery_id INTEGER NOT NULL,source_key TEXT NOT NULL,event_sha256 TEXT NOT NULL,payment_id INTEGER,result_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(d1_company_id,d1_delivery_id),UNIQUE(company_id,erp_delivery_id),UNIQUE(company_id,source_key))",
 "CREATE TABLE IF NOT EXISTS driver_finance_bridge_proof_gps(erp_delivery_id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL,latitude REAL NOT NULL,longitude REAL NOT NULL,accuracy_m REAL NOT NULL,captured_at TEXT NOT NULL,signature_sha256 TEXT NOT NULL,photo_sha256 TEXT NOT NULL,source_delivery_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
];
module.exports={bridgeSchema};

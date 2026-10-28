-- QA ONLY. Do not apply to remote D1.
-- Each delivery posting must have one stable receipt; a single D1 batch includes
-- van debit, bottle ledger, payment and customer credit movement.
CREATE TABLE IF NOT EXISTS driver_delivery_posting_receipts (
 company_id INTEGER NOT NULL,
 driver_id INTEGER NOT NULL,
 delivery_id INTEGER NOT NULL,
 idempotency_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
 credit_cents INTEGER NOT NULL CHECK(credit_cents>=0),
 bottles_out INTEGER NOT NULL CHECK(bottles_out>=0),
 bottles_returned INTEGER NOT NULL CHECK(bottles_returned>=0),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(company_id,idempotency_key),
 UNIQUE(company_id,delivery_id)
);
CREATE TABLE IF NOT EXISTS driver_delivery_bottle_ledger (
 company_id INTEGER NOT NULL,
 delivery_id INTEGER NOT NULL,
 driver_id INTEGER NOT NULL,
 product_id INTEGER NOT NULL,
 bottles_out INTEGER NOT NULL CHECK(bottles_out>=0),
 bottles_returned INTEGER NOT NULL CHECK(bottles_returned>=0),
 PRIMARY KEY(company_id,delivery_id,product_id)
);

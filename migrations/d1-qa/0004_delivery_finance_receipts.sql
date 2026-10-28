-- QA ONLY. Do not apply to remote D1.
-- Each delivery posting must have one stable receipt; a single D1 batch includes
-- van debit, bottle ledger, payment and customer credit movement.
CREATE TABLE IF NOT EXISTS driver_delivery_posting_receipts (
 company_id INTEGER NOT NULL,
 driver_id INTEGER NOT NULL,
 delivery_id INTEGER NOT NULL,
 idempotency_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 product_id INTEGER NOT NULL,
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

-- QA-only posting journals, not a replacement for canonical ERP payments/credit_ledger.
CREATE TABLE IF NOT EXISTS driver_delivery_cash_journal (
 company_id INTEGER NOT NULL, delivery_id INTEGER NOT NULL, driver_id INTEGER NOT NULL,
 cash_cents INTEGER NOT NULL CHECK(cash_cents>=0),
 PRIMARY KEY(company_id,delivery_id)
);
CREATE TABLE IF NOT EXISTS driver_delivery_credit_journal (
 company_id INTEGER NOT NULL, delivery_id INTEGER NOT NULL, driver_id INTEGER NOT NULL,
 credit_cents INTEGER NOT NULL CHECK(credit_cents>=0),
 PRIMARY KEY(company_id,delivery_id)
);
CREATE TABLE IF NOT EXISTS driver_delivery_proofs (
 company_id INTEGER NOT NULL, delivery_id INTEGER NOT NULL, driver_id INTEGER NOT NULL,
 signature_ref TEXT NOT NULL, photo_ref TEXT NOT NULL,
 latitude REAL NOT NULL, longitude REAL NOT NULL,
 PRIMARY KEY(company_id,delivery_id)
);
-- The receipt insert must abort the batch if the delivery is not open or does not
-- contain exactly one order line matching the posted product and quantity.
CREATE TRIGGER IF NOT EXISTS trg_delivery_receipt_ownership
BEFORE INSERT ON driver_delivery_posting_receipts
BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM deliveries d JOIN orders o
   ON o.id=d.order_id AND o.company_id=d.company_id
  WHERE d.id=NEW.delivery_id AND d.company_id=NEW.company_id
   AND d.driver_id=NEW.driver_id AND d.status IN ('assigned','out_for_delivery')
   AND CAST(ROUND(o.total_amount*100) AS INTEGER)=NEW.amount_cents+NEW.credit_cents
   AND (SELECT COUNT(*) FROM order_items oi
    WHERE oi.company_id=d.company_id AND oi.order_id=o.id)=1
   AND EXISTS (SELECT 1 FROM order_items oi
    WHERE oi.company_id=d.company_id AND oi.order_id=o.id
     AND oi.product_id=NEW.product_id AND oi.quantity=NEW.bottles_out)
 ) THEN RAISE(ABORT,'delivery ownership or amount mismatch') END;
END;

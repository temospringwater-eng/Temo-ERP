-- QA ONLY: delivery stock ledger guard. No remote D1 execution.
-- One completed delivery line per idempotency key; driver van stock cannot go negative.
CREATE TRIGGER IF NOT EXISTS trg_van_delivery_requires_stock
BEFORE INSERT ON van_stock_movements
WHEN NEW.movement_type='deliver'
BEGIN
 SELECT CASE WHEN COALESCE((
  SELECT quantity FROM van_stock_balances
  WHERE company_id=NEW.company_id AND driver_id=NEW.driver_id AND product_id=NEW.product_id
 ),0)<NEW.quantity THEN RAISE(ABORT,'insufficient van stock') END;
END;

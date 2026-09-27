ALTER TABLE orders ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz;
UPDATE orders SET reservation_expires_at=created_at+interval '30 minutes' WHERE status='awaiting_payment' AND reservation_expires_at IS NULL;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('awaiting_payment','paid','in_progress','delivered','cancelled','expired'));
ALTER TABLE orders ADD CONSTRAINT awaiting_payment_has_expiry CHECK (status<>'awaiting_payment' OR reservation_expires_at IS NOT NULL);
ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS deliveries_status_check;
ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check CHECK (status IN ('pending','assigned','picked_up','in_transit','delivered','cancelled'));
CREATE INDEX IF NOT EXISTS orders_expiry_idx ON orders(reservation_expires_at) WHERE status='awaiting_payment';

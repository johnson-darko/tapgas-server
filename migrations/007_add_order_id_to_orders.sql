-- Add order_id column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_id VARCHAR(32);
-- Optional: add an index for faster lookup
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
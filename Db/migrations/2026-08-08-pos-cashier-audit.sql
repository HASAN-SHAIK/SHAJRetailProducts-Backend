ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS source_created_by_user_id TEXT,
    ADD COLUMN IF NOT EXISTS source_completed_by_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_source_created_by_user
    ON orders(source_channel, source_created_by_user_id)
    WHERE source_created_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_source_completed_by_user
    ON orders(source_channel, source_completed_by_user_id)
    WHERE source_completed_by_user_id IS NOT NULL;

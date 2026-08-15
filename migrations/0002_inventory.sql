-- Adds general stock tracking (separate from contract contributions).
-- Safe to run against the existing database — additive only.

CREATE TABLE IF NOT EXISTS inventory (
    item_id         INT PRIMARY KEY REFERENCES items(id),
    quantity        NUMERIC NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_items_name_trgm ON items USING gin (name gin_trgm_ops);

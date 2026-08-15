-- Replaces the single running-total `inventory` table with a per-
-- contributor lot ledger, so a sale can credit the right people back
-- for stock they contributed. Existing balances carry forward as
-- unattributed opening lots, since the old table never recorded who
-- contributed what.

CREATE TABLE IF NOT EXISTS inventory_lots (
    id                  SERIAL PRIMARY KEY,
    item_id             INT NOT NULL REFERENCES items(id),
    member_id           BIGINT REFERENCES members(id),
    quantity            NUMERIC NOT NULL,
    original_quantity   NUMERIC NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_lots_item ON inventory_lots(item_id);

INSERT INTO inventory_lots (item_id, member_id, quantity, original_quantity, created_at)
SELECT item_id, NULL, quantity, quantity, updated_at
FROM inventory
WHERE quantity != 0;

DROP TABLE inventory;

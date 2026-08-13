-- ============================================================
-- Keizaal Online — Inventory Contribution & Payout Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE members (
    id              BIGINT PRIMARY KEY,      -- Discord user ID
    display_name    TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE items (
    id              SERIAL PRIMARY KEY,
    name            TEXT UNIQUE NOT NULL,
    unit_value      NUMERIC(10,2) NOT NULL DEFAULT 1
);

CREATE TABLE contracts (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    destination     TEXT,
    target_item_id  INT REFERENCES items(id),
    target_quantity NUMERIC,
    payout_gold     NUMERIC,
    status          TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','closed','cancelled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at       TIMESTAMPTZ
);

CREATE TABLE contributions (
    id              SERIAL PRIMARY KEY,
    contract_id     INT NOT NULL REFERENCES contracts(id),
    item_id         INT NOT NULL REFERENCES items(id),
    quantity        NUMERIC NOT NULL CHECK (quantity > 0),
    author_id       BIGINT NOT NULL REFERENCES members(id),
    credit_id       BIGINT NOT NULL REFERENCES members(id),
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
    id              SERIAL PRIMARY KEY,
    contract_id     INT NOT NULL REFERENCES contracts(id),
    member_id       BIGINT NOT NULL REFERENCES members(id),
    input_value     NUMERIC NOT NULL,
    share_pct       NUMERIC NOT NULL,
    gold_awarded    NUMERIC NOT NULL,
    paid            BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contributions_contract ON contributions(contract_id);
CREATE INDEX idx_contracts_status ON contracts(status);
CREATE INDEX idx_contracts_name_trgm ON contracts USING gin (name gin_trgm_ops);

-- Seed a few obvious items so autocomplete isn't empty on first run.
-- Adjust unit_value later once you settle relative pricing (see README).
INSERT INTO items (name, unit_value) VALUES
    ('Charcoal', 1),
    ('Coke', 1),
    ('Firewood', 1),
    ('Cabbage', 1),
    ('Wheat', 1),
    ('Gourd', 1),
    ('Potato', 1)
ON CONFLICT (name) DO NOTHING;

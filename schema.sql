-- ============================================================
-- Keizaal Online — Inventory Contribution & Payout Schema
-- Multi-guild: every guild-scoped table carries guild_id so one
-- bot process/database can safely serve more than one Discord guild.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Per-guild configuration, set via /settings once the bot is invited to a
-- server. Rows are created on demand (see ensureGuild in src/db.js) so a
-- brand-new guild always has something for the FKs below to reference.
CREATE TABLE guild_settings (
    guild_id              BIGINT PRIMARY KEY,
    inventory_channel_id  BIGINT,
    gold_channel_id       BIGINT,                 -- NULL = same channel as inventory_channel_id
    currency_words        TEXT[] NOT NULL DEFAULT ARRAY['gold','septim','septims'],
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A Discord user ID is global, but membership/display name is per-guild, so
-- this is keyed on the pair. Every other table's member reference is a
-- composite FK to (id, guild_id) — that's what stops a guild A contribution
-- from ever being attributed to a guild B member row.
CREATE TABLE members (
    id              BIGINT NOT NULL,
    guild_id        BIGINT NOT NULL REFERENCES guild_settings(guild_id),
    display_name    TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, guild_id)
);

CREATE TABLE items (
    id              SERIAL PRIMARY KEY,
    guild_id        BIGINT NOT NULL REFERENCES guild_settings(guild_id),
    name            TEXT NOT NULL,
    unit_value      NUMERIC(12,4) NOT NULL DEFAULT 1,
    UNIQUE (guild_id, name)
);

CREATE TABLE contracts (
    id              SERIAL PRIMARY KEY,
    guild_id        BIGINT NOT NULL REFERENCES guild_settings(guild_id),
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
    guild_id        BIGINT NOT NULL REFERENCES guild_settings(guild_id),
    contract_id     INT NOT NULL REFERENCES contracts(id),
    item_id         INT NOT NULL REFERENCES items(id),
    quantity        NUMERIC NOT NULL CHECK (quantity > 0),
    author_id       BIGINT NOT NULL,
    credit_id       BIGINT NOT NULL,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (author_id, guild_id) REFERENCES members(id, guild_id),
    FOREIGN KEY (credit_id, guild_id) REFERENCES members(id, guild_id)
);

CREATE TABLE payouts (
    id              SERIAL PRIMARY KEY,
    guild_id        BIGINT NOT NULL REFERENCES guild_settings(guild_id),
    contract_id     INT NOT NULL REFERENCES contracts(id),
    member_id       BIGINT NOT NULL,
    input_value     NUMERIC NOT NULL,
    share_pct       NUMERIC NOT NULL,
    gold_awarded    NUMERIC NOT NULL,
    paid            BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (member_id, guild_id) REFERENCES members(id, guild_id)
);

-- Per-contribution stock ledger, adjusted by +/- lines posted in the
-- configured inventory channel (see src/inventory.js) and by
-- /contract sell. Each addition is its own lot so a later sale can
-- credit contributors proportionally instead of tracking a single
-- anonymous running total. member_id is NULL for an unattributed
-- deficit lot, created when a removal exceeds available stock.
CREATE TABLE inventory_lots (
    id                  SERIAL PRIMARY KEY,
    guild_id            BIGINT NOT NULL REFERENCES guild_settings(guild_id),
    item_id             INT NOT NULL REFERENCES items(id),
    member_id           BIGINT,
    -- Fixed 6-decimal scale so proportional-consumption math (see
    -- planConsumption in src/math.js) can't leave unbounded floating-point
    -- dust behind after repeated partial draws — Postgres rounds to the
    -- column's scale on write, on top of the JS-side rounding already done.
    quantity            NUMERIC(14,6) NOT NULL,
    original_quantity   NUMERIC(14,6) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (member_id, guild_id) REFERENCES members(id, guild_id)
);

-- Guild treasury (the shared gold chest). Every gold movement is one signed
-- row here instead of a running total, mirroring inventory_lots: purchases
-- (/contract buy) and contributor payouts (/contract close, /contract sell)
-- debit it, sales credit it, and +/- gold-channel messages post 'manual'
-- entries directly. Current balance is SUM(delta_gold) for the guild.
CREATE TABLE treasury_ledger (
    id              SERIAL PRIMARY KEY,
    guild_id        BIGINT NOT NULL REFERENCES guild_settings(guild_id),
    contract_id     INT REFERENCES contracts(id),
    member_id       BIGINT,
    delta_gold      NUMERIC(14,4) NOT NULL,
    reason          TEXT NOT NULL CHECK (reason IN ('sale','purchase','payout','manual')),
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (member_id, guild_id) REFERENCES members(id, guild_id)
);

CREATE INDEX idx_members_guild ON members(guild_id);
CREATE INDEX idx_items_guild ON items(guild_id);
CREATE INDEX idx_items_name_trgm ON items USING gin (name gin_trgm_ops);
CREATE INDEX idx_contracts_guild_status ON contracts(guild_id, status);
CREATE INDEX idx_contracts_name_trgm ON contracts USING gin (name gin_trgm_ops);
CREATE INDEX idx_contributions_contract ON contributions(contract_id);
CREATE INDEX idx_contributions_guild ON contributions(guild_id);
CREATE INDEX idx_payouts_guild ON payouts(guild_id);
CREATE INDEX idx_inventory_lots_guild_item ON inventory_lots(guild_id, item_id);
CREATE INDEX idx_treasury_ledger_guild ON treasury_ledger(guild_id);
CREATE INDEX idx_treasury_ledger_contract ON treasury_ledger(contract_id);

-- No seed data: item catalogs are now per-guild and build organically as
-- members post inventory lines or log contributions (see resolveOrCreateItem
-- in src/inventory.js), since a fresh install has no guild to seed yet.

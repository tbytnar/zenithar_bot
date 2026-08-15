-- Backfills the existing single-guild database into the multi-guild schema
-- (guild_settings, guild_id on every guild-scoped table, composite member
-- FKs, and the new treasury_ledger). Every existing row is attributed to
-- the one guild this database has ever served.
--
-- EDIT THE LINE BELOW to your server's Discord guild ID before running —
-- the same value that used to be DISCORD_GUILD_ID in .env.
\set target_guild_id 000000000000000000

BEGIN;

CREATE TABLE guild_settings (
    guild_id              BIGINT PRIMARY KEY,
    inventory_channel_id  BIGINT,
    gold_channel_id       BIGINT,
    currency_words        TEXT[] NOT NULL DEFAULT ARRAY['gold','septim','septims'],
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Carries over the old INVENTORY_CHANNEL_ID env var as this guild's
-- inventory channel; the gold channel defaults to the same channel until
-- you run /settings channels to point it elsewhere.
INSERT INTO guild_settings (guild_id) VALUES (:target_guild_id);

-- members: add guild_id, move the primary key to (id, guild_id)
ALTER TABLE members ADD COLUMN guild_id BIGINT;
UPDATE members SET guild_id = :target_guild_id;
ALTER TABLE members ALTER COLUMN guild_id SET NOT NULL;
ALTER TABLE members DROP CONSTRAINT members_pkey;
ALTER TABLE members ADD PRIMARY KEY (id, guild_id);
ALTER TABLE members ADD FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id);

-- items: add guild_id, move uniqueness to (guild_id, name), widen unit_value
ALTER TABLE items ADD COLUMN guild_id BIGINT;
UPDATE items SET guild_id = :target_guild_id;
ALTER TABLE items ALTER COLUMN guild_id SET NOT NULL;
ALTER TABLE items ADD FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id);
ALTER TABLE items DROP CONSTRAINT items_name_key;
ALTER TABLE items ADD CONSTRAINT items_guild_name_key UNIQUE (guild_id, name);
ALTER TABLE items ALTER COLUMN unit_value TYPE NUMERIC(12,4);

-- contracts
ALTER TABLE contracts ADD COLUMN guild_id BIGINT;
UPDATE contracts SET guild_id = :target_guild_id;
ALTER TABLE contracts ALTER COLUMN guild_id SET NOT NULL;
ALTER TABLE contracts ADD FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id);

-- contributions
ALTER TABLE contributions ADD COLUMN guild_id BIGINT;
UPDATE contributions SET guild_id = :target_guild_id;
ALTER TABLE contributions ALTER COLUMN guild_id SET NOT NULL;
ALTER TABLE contributions ADD FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id);
ALTER TABLE contributions DROP CONSTRAINT contributions_author_id_fkey;
ALTER TABLE contributions DROP CONSTRAINT contributions_credit_id_fkey;
ALTER TABLE contributions ADD FOREIGN KEY (author_id, guild_id) REFERENCES members(id, guild_id);
ALTER TABLE contributions ADD FOREIGN KEY (credit_id, guild_id) REFERENCES members(id, guild_id);

-- payouts
ALTER TABLE payouts ADD COLUMN guild_id BIGINT;
UPDATE payouts SET guild_id = :target_guild_id;
ALTER TABLE payouts ALTER COLUMN guild_id SET NOT NULL;
ALTER TABLE payouts ADD FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id);
ALTER TABLE payouts DROP CONSTRAINT payouts_member_id_fkey;
ALTER TABLE payouts ADD FOREIGN KEY (member_id, guild_id) REFERENCES members(id, guild_id);

-- inventory_lots
ALTER TABLE inventory_lots ADD COLUMN guild_id BIGINT;
UPDATE inventory_lots SET guild_id = :target_guild_id;
ALTER TABLE inventory_lots ALTER COLUMN guild_id SET NOT NULL;
ALTER TABLE inventory_lots ADD FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id);
ALTER TABLE inventory_lots DROP CONSTRAINT inventory_lots_member_id_fkey;
ALTER TABLE inventory_lots ADD FOREIGN KEY (member_id, guild_id) REFERENCES members(id, guild_id);

-- new: guild treasury ledger
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
CREATE INDEX idx_contracts_guild_status ON contracts(guild_id, status);
CREATE INDEX idx_contributions_guild ON contributions(guild_id);
CREATE INDEX idx_payouts_guild ON payouts(guild_id);
CREATE INDEX idx_inventory_lots_guild_item ON inventory_lots(guild_id, item_id);
CREATE INDEX idx_treasury_ledger_guild ON treasury_ledger(guild_id);
CREATE INDEX idx_treasury_ledger_contract ON treasury_ledger(contract_id);

-- The old single-guild status index is superseded by idx_contracts_guild_status.
DROP INDEX IF EXISTS idx_contracts_status;

COMMIT;

-- After this runs: set INVENTORY_CHANNEL_ID's old value via
-- `/settings channels inventory:#your-channel` (and gold: if you want a
-- separate gold channel) — it's no longer read from .env.

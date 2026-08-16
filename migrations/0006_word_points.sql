-- Adds the (unannounced) word-points/leveling mechanic. Inactive by
-- default: trigger_word and blessing_channel_id start NULL, and nothing
-- in the application sets them via a slash command — see word_points.js
-- and the setup SQL you were given separately for turning it on.

BEGIN;

ALTER TABLE guild_settings ADD COLUMN trigger_word TEXT;
ALTER TABLE guild_settings ADD COLUMN blessing_channel_id BIGINT;

CREATE TABLE word_points (
    guild_id        BIGINT NOT NULL REFERENCES guild_settings(guild_id),
    member_id       BIGINT NOT NULL,
    points          INT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, member_id),
    FOREIGN KEY (member_id, guild_id) REFERENCES members(id, guild_id)
);

CREATE TABLE level_tiers (
    id              SERIAL PRIMARY KEY,
    guild_id        BIGINT NOT NULL REFERENCES guild_settings(guild_id),
    level_number    INT NOT NULL,
    threshold       INT NOT NULL,
    title           TEXT NOT NULL,
    blessing        TEXT NOT NULL,
    UNIQUE (guild_id, level_number)
);

CREATE INDEX idx_level_tiers_guild ON level_tiers(guild_id);

COMMIT;

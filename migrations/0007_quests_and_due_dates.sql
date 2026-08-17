-- Adds:
--  - guild_settings.quests_channel_id: where /contract create auto-posts
--    new contracts (NULL = doesn't, same inactive-by-default pattern as
--    the other optional channels).
--  - contracts.due_at: optional due date, settable via /contract create.

BEGIN;

ALTER TABLE guild_settings ADD COLUMN quests_channel_id BIGINT;
ALTER TABLE contracts ADD COLUMN due_at TIMESTAMPTZ;

COMMIT;

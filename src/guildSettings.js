import { query, ensureGuild } from './db.js';

export const DEFAULT_CURRENCY_WORDS = ['gold', 'septim', 'septims'];

export async function getGuildSettings(guildId) {
  await ensureGuild(guildId);
  const result = await query(`SELECT * FROM guild_settings WHERE guild_id = $1`, [guildId]);
  return result.rows[0];
}

// Only overwrites fields that are explicitly provided; omitted ones keep
// their current value. Column list is fixed (no dynamic SQL) on purpose.
export async function updateGuildSettings(
  guildId,
  { inventoryChannelId, goldChannelId, questsChannelId, currencyWords } = {}
) {
  await ensureGuild(guildId);
  await query(
    `UPDATE guild_settings SET
       inventory_channel_id = COALESCE($2, inventory_channel_id),
       gold_channel_id = COALESCE($3, gold_channel_id),
       quests_channel_id = COALESCE($4, quests_channel_id),
       currency_words = COALESCE($5, currency_words),
       updated_at = now()
     WHERE guild_id = $1`,
    [guildId, inventoryChannelId ?? null, goldChannelId ?? null, questsChannelId ?? null, currencyWords ?? null]
  );
  return getGuildSettings(guildId);
}

export function resolveGoldChannelId(settings) {
  return settings.gold_channel_id ?? settings.inventory_channel_id;
}

export function currencyWords(settings) {
  return settings.currency_words?.length ? settings.currency_words : DEFAULT_CURRENCY_WORDS;
}

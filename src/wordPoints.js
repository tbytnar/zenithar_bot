import { EmbedBuilder } from 'discord.js';
import { query, upsertMember } from './db.js';

const BLESSING_COLOR = 0xf5c542;

// Both trigger_word and blessing_channel_id are set directly in the
// database, not via any slash command — this mechanic is deliberately
// unannounced. A guild with either left NULL is simply inactive.
async function getTrigger(guildId) {
  const result = await query(
    `SELECT trigger_word, blessing_channel_id FROM guild_settings WHERE guild_id = $1`,
    [guildId]
  );
  return result.rows[0];
}

// The highest level whose threshold has been met, or null if points
// haven't reached the first configured tier yet (or none are configured).
async function tierFor(guildId, points) {
  const result = await query(
    `SELECT level_number, title, blessing FROM level_tiers
     WHERE guild_id = $1 AND threshold <= $2
     ORDER BY level_number DESC
     LIMIT 1`,
    [guildId, points]
  );
  return result.rows[0] ?? null;
}

export async function handleWordPointsMessage(message) {
  if (message.author.bot) return;
  if (!message.guildId) return;

  const settings = await getTrigger(message.guildId);
  if (!settings?.trigger_word || !settings.blessing_channel_id) return;

  if (!message.content.toLowerCase().includes(settings.trigger_word.toLowerCase())) return;

  await upsertMember(message.guildId, message.author);

  const before = await query(
    `SELECT points FROM word_points WHERE guild_id = $1 AND member_id = $2`,
    [message.guildId, message.author.id]
  );
  const oldPoints = before.rows[0]?.points ?? 0;
  const newPoints = oldPoints + 1;

  await query(
    `INSERT INTO word_points (guild_id, member_id, points)
     VALUES ($1, $2, 1)
     ON CONFLICT (guild_id, member_id) DO UPDATE SET points = word_points.points + 1, updated_at = now()`,
    [message.guildId, message.author.id]
  );

  const oldTier = await tierFor(message.guildId, oldPoints);
  const newTier = await tierFor(message.guildId, newPoints);

  if (!newTier || newTier.level_number <= (oldTier?.level_number ?? 0)) return;

  const channel = await message.client.channels.fetch(settings.blessing_channel_id).catch(() => null);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(BLESSING_COLOR)
    .setTitle(newTier.title)
    .setDescription(`<@${message.author.id}>\n\n${newTier.blessing}`);

  await channel.send({ embeds: [embed] });
}

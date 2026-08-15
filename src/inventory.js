import { EmbedBuilder } from 'discord.js';
import { query } from './db.js';

const LINE_PATTERN = /^\s*([+-])\s*(\d+(?:\.\d+)?)\s+(.+?)\s*$/;
const COLOR_ADDED = 0x57f287; // Discord's "success" green
const COLOR_REMOVED = 0xed4245; // Discord's "danger" red
const EMBEDS_PER_MESSAGE = 10; // Discord's hard limit per message

// Matches existing items on exact name first, then a trigram-similarity
// fuzzy match (catches typos like "Cabage" -> "Cabbage"), and only creates
// a new item if neither finds anything close.
async function resolveOrCreateItem(name) {
  const exact = await query(`SELECT id, name FROM items WHERE lower(name) = lower($1)`, [name]);
  if (exact.rows.length > 0) return { ...exact.rows[0] };

  const fuzzy = await query(
    `SELECT id, name FROM items
     WHERE similarity(name, $1) > 0.4
     ORDER BY similarity(name, $1) DESC
     LIMIT 1`,
    [name]
  );
  if (fuzzy.rows.length > 0) return { ...fuzzy.rows[0], fuzzyMatched: true };

  const created = await query(`INSERT INTO items (name) VALUES ($1) RETURNING id, name`, [name]);
  return { ...created.rows[0], created: true };
}

async function applyDelta(itemId, amount) {
  await query(
    `INSERT INTO inventory (item_id, quantity, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (item_id) DO UPDATE SET quantity = inventory.quantity + $2, updated_at = now()`,
    [itemId, amount]
  );
}

export async function handleInventoryMessage(message) {
  if (message.author.bot) return;
  if (!process.env.INVENTORY_CHANNEL_ID) return;
  if (message.channelId !== process.env.INVENTORY_CHANNEL_ID) return;

  const results = [];

  for (const line of message.content.split('\n')) {
    const match = line.match(LINE_PATTERN);
    if (!match) continue;

    const [, sign, amountStr, rawName] = match;
    const amount = Number(amountStr) * (sign === '-' ? -1 : 1);
    const item = await resolveOrCreateItem(rawName.trim());
    await applyDelta(item.id, amount);
    results.push({ item, amount });
  }

  if (results.length === 0) return;

  const embeds = results.map((r) => {
    const isAdded = r.amount >= 0;
    const flag = r.item.created
      ? ' — 🆕 new item'
      : r.item.fuzzyMatched
        ? ` — matched **${r.item.name}**`
        : '';
    return new EmbedBuilder()
      .setColor(isAdded ? COLOR_ADDED : COLOR_REMOVED)
      .setDescription(
        `**${Math.abs(r.amount)} ${r.item.name}** ${isAdded ? 'Added' : 'Removed'}${flag}`
      );
  });

  for (let i = 0; i < embeds.length; i += EMBEDS_PER_MESSAGE) {
    await message.reply({ embeds: embeds.slice(i, i + EMBEDS_PER_MESSAGE) });
  }
}

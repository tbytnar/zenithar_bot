import { query } from './db.js';

const LINE_PATTERN = /^\s*([+-])\s*(\d+(?:\.\d+)?)\s+(.+?)\s*$/;

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

  const lines = results.map((r) => {
    const sign = r.amount >= 0 ? '+' : '';
    const flag = r.item.created
      ? ' 🆕 new item'
      : r.item.fuzzyMatched
        ? ` (matched **${r.item.name}**)`
        : '';
    return `${sign}${r.amount} ${r.item.name}${flag}`;
  });

  await message.reply(lines.join('\n'));
}

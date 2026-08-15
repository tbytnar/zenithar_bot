import { EmbedBuilder } from 'discord.js';
import { query, upsertMember } from './db.js';

const LINE_PATTERN = /^\s*([+-])\s*(\d+(?:\.\d+)?)\s+(.+?)\s*$/;
const COLOR_ADDED = 0x57f287; // Discord's "success" green
const COLOR_REMOVED = 0xed4245; // Discord's "danger" red
const EMBEDS_PER_MESSAGE = 10; // Discord's hard limit per message

// Matches existing items on exact name first, then a trigram-similarity
// fuzzy match (catches typos like "Cabage" -> "Cabbage"), and only creates
// a new item if neither finds anything close.
export async function resolveOrCreateItem(name) {
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

export async function createLot(itemId, memberId, quantity) {
  await query(
    `INSERT INTO inventory_lots (item_id, member_id, quantity, original_quantity)
     VALUES ($1, $2, $3, $3)`,
    [itemId, memberId, quantity]
  );
}

// Consumes up to `requestedQty` units of an item, proportionally across
// every contributor currently holding stock of it - fungible goods don't
// have a single "owner" once mixed into one pool, so a sale that draws
// from it credits each contributor their fair share rather than picking
// one. If stock runs out, the remainder becomes an unattributed deficit
// lot (negative balance, nobody credited) instead of being rejected.
export async function consumeInventory(itemId, requestedQty) {
  const lots = await query(
    `SELECT id, member_id, quantity FROM inventory_lots
     WHERE item_id = $1 AND quantity > 0
     ORDER BY created_at ASC`,
    [itemId]
  );

  const totalAvailable = lots.rows.reduce((sum, l) => sum + Number(l.quantity), 0);
  const consumed = [];

  if (totalAvailable > 0) {
    const shareRatio = Math.min(requestedQty, totalAvailable) / totalAvailable;
    for (const lot of lots.rows) {
      const take = Number(lot.quantity) * shareRatio;
      if (take <= 0) continue;
      await query(`UPDATE inventory_lots SET quantity = quantity - $2 WHERE id = $1`, [lot.id, take]);
      if (lot.member_id) consumed.push({ memberId: lot.member_id, quantity: take });
    }
  }

  const deficit = requestedQty - totalAvailable;
  if (deficit > 0) {
    await query(
      `INSERT INTO inventory_lots (item_id, member_id, quantity, original_quantity)
       VALUES ($1, NULL, $2, $2)`,
      [itemId, -deficit]
    );
  }

  return consumed;
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
    const amount = Number(amountStr);
    const item = await resolveOrCreateItem(rawName.trim());

    if (sign === '+') {
      await upsertMember(message.author);
      await createLot(item.id, message.author.id, amount);
      results.push({ item, amount });
    } else {
      await consumeInventory(item.id, amount);
      results.push({ item, amount: -amount });
    }
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

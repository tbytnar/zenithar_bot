import { EmbedBuilder } from 'discord.js';
import { query, upsertMember } from './db.js';
import { getGuildSettings, resolveGoldChannelId, currencyWords } from './guildSettings.js';
import { recordLedgerEntry } from './treasury.js';
import { planConsumption } from './math.js';

const ITEM_LINE = /^\s*([+-])\s*(\d+(?:\.\d+)?)\s+(.+?)\s*$/;
const COLOR_ADDED = 0x57f287; // Discord's "success" green
const COLOR_REMOVED = 0xed4245; // Discord's "danger" red
const EMBEDS_PER_MESSAGE = 10; // Discord's hard limit per message

function escapeRegExp(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Builds a line pattern for this guild's configured currency words, e.g.
// "-100 gold (buying carrots)" or "+200 septims (sold a book)". The note is
// optional and, when present, becomes the ledger entry's note.
function matchCurrencyLine(line, words) {
  const alternation = words.map(escapeRegExp).join('|');
  const pattern = new RegExp(
    `^\\s*([+-])\\s*(\\d+(?:\\.\\d+)?)\\s+(?:${alternation})\\s*(?:\\(([^)]*)\\))?\\s*$`,
    'i'
  );
  return line.match(pattern);
}

// Matches existing items on exact name first, then a trigram-similarity
// fuzzy match (catches typos like "Cabage" -> "Cabbage"), and only creates
// a new item if neither finds anything close. Scoped to the guild's own
// item catalog throughout. Pass `runQuery` as `client.query.bind(client)`
// to run this as part of a larger transaction.
export async function resolveOrCreateItem(guildId, name, runQuery = query) {
  const exact = await runQuery(`SELECT id, name FROM items WHERE guild_id = $1 AND lower(name) = lower($2)`, [
    guildId,
    name,
  ]);
  if (exact.rows.length > 0) return { ...exact.rows[0] };

  const fuzzy = await runQuery(
    `SELECT id, name FROM items
     WHERE guild_id = $1 AND similarity(name, $2) > 0.4
     ORDER BY similarity(name, $2) DESC
     LIMIT 1`,
    [guildId, name]
  );
  if (fuzzy.rows.length > 0) return { ...fuzzy.rows[0], fuzzyMatched: true };

  const created = await runQuery(`INSERT INTO items (guild_id, name) VALUES ($1, $2) RETURNING id, name`, [
    guildId,
    name,
  ]);
  return { ...created.rows[0], created: true };
}

export async function createLot(guildId, itemId, memberId, quantity, runQuery = query) {
  await runQuery(
    `INSERT INTO inventory_lots (guild_id, item_id, member_id, quantity, original_quantity)
     VALUES ($1, $2, $3, $4, $4)`,
    [guildId, itemId, memberId, quantity]
  );
}

// Consumes up to `requestedQty` units of an item, proportionally across
// every contributor currently holding stock of it - fungible goods don't
// have a single "owner" once mixed into one pool, so a sale that draws
// from it credits each contributor their fair share rather than picking
// one. If stock runs out, the remainder becomes an unattributed deficit
// lot (negative balance, nobody credited) instead of being rejected.
// Pass `runQuery` as `client.query.bind(client)` to run this as part of a
// larger transaction (see /contract sell).
export async function consumeInventory(guildId, itemId, requestedQty, runQuery = query) {
  const lots = await runQuery(
    `SELECT id, member_id, quantity FROM inventory_lots
     WHERE guild_id = $1 AND item_id = $2 AND quantity > 0
     ORDER BY created_at ASC
     FOR UPDATE`,
    [guildId, itemId]
  );

  const { takes, deficit } = planConsumption(
    lots.rows.map((l) => ({ id: l.id, memberId: l.member_id, quantity: l.quantity })),
    requestedQty
  );

  const consumed = [];
  for (const take of takes) {
    await runQuery(`UPDATE inventory_lots SET quantity = quantity - $2 WHERE id = $1`, [take.id, take.quantity]);
    if (take.memberId) consumed.push({ memberId: take.memberId, quantity: take.quantity });
  }

  if (deficit > 0) {
    await runQuery(
      `INSERT INTO inventory_lots (guild_id, item_id, member_id, quantity, original_quantity)
       VALUES ($1, $2, NULL, $3, $3)`,
      [guildId, itemId, -deficit]
    );
  }

  return consumed;
}

export async function handleInventoryMessage(message) {
  if (message.author.bot) return;
  if (!message.guildId) return; // ignore DMs

  const settings = await getGuildSettings(message.guildId);
  const inventoryChannelId = settings.inventory_channel_id;
  const goldChannelId = resolveGoldChannelId(settings);
  const isInventoryChannel = Boolean(inventoryChannelId) && message.channelId === inventoryChannelId;
  const isGoldChannel = Boolean(goldChannelId) && message.channelId === goldChannelId;
  if (!isInventoryChannel && !isGoldChannel) return;

  const words = currencyWords(settings);
  const itemResults = [];
  const goldResults = [];

  for (const line of message.content.split('\n')) {
    const goldMatch = isGoldChannel && matchCurrencyLine(line, words);
    if (goldMatch) {
      const [, sign, amountStr, note] = goldMatch;
      const amount = Number(amountStr);
      const delta = sign === '+' ? amount : -amount;

      await upsertMember(message.guildId, message.author);
      await recordLedgerEntry({
        guildId: message.guildId,
        memberId: message.author.id,
        deltaGold: delta,
        reason: 'manual',
        note: note || null,
      });
      goldResults.push({ delta, note });
      continue;
    }

    if (!isInventoryChannel) continue;
    const match = line.match(ITEM_LINE);
    if (!match) continue;

    const [, sign, amountStr, rawName] = match;
    const amount = Number(amountStr);
    const item = await resolveOrCreateItem(message.guildId, rawName.trim());

    if (sign === '+') {
      await upsertMember(message.guildId, message.author);
      await createLot(message.guildId, item.id, message.author.id, amount);
      itemResults.push({ item, amount });
    } else {
      await consumeInventory(message.guildId, item.id, amount);
      itemResults.push({ item, amount: -amount });
    }
  }

  if (itemResults.length === 0 && goldResults.length === 0) return;

  const itemEmbeds = itemResults.map((r) => {
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

  const goldEmbeds = goldResults.map((r) => {
    const isAdded = r.delta >= 0;
    return new EmbedBuilder()
      .setColor(isAdded ? COLOR_ADDED : COLOR_REMOVED)
      .setDescription(
        `**${Math.abs(r.delta)}g** ${isAdded ? 'Added to' : 'Removed from'} treasury${r.note ? ` — ${r.note}` : ''}`
      );
  });

  const embeds = [...itemEmbeds, ...goldEmbeds];
  for (let i = 0; i < embeds.length; i += EMBEDS_PER_MESSAGE) {
    await message.reply({ embeds: embeds.slice(i, i + EMBEDS_PER_MESSAGE) });
  }
}

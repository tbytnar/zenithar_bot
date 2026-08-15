import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { query, upsertMember, withTransaction } from '../db.js';
import { itemChoices, contractChoices, isValidId } from '../autocomplete.js';
import { resolveOrCreateItem, consumeInventory, createLot } from '../inventory.js';
import { recordLedgerEntry } from '../treasury.js';
import { splitProportionally } from '../math.js';

const ITEM_LINE = /^\s*(\d+(?:\.\d+)?)\s+(.+?)\s*$/;

// Parses "<quantity> <item name>" lines, one per line, as used by both
// /contract sell and /contract buy.
function parseItemLines(text) {
  return text
    .split('\n')
    .map((line) => line.match(ITEM_LINE))
    .filter(Boolean)
    .map(([, qtyStr, rawName]) => ({ quantity: Number(qtyStr), name: rawName.trim() }));
}

export const data = new SlashCommandBuilder()
  .setName('contract')
  .setDescription('Manage contracts')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Open a new contract')
      .addStringOption((opt) =>
        opt.setName('name').setDescription('Contract name').setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName('destination').setDescription('Destination, e.g. Dawnstar')
      )
      .addStringOption((opt) =>
        opt
          .setName('target_item')
          .setDescription('Primary item this contract needs')
          .setAutocomplete(true)
      )
      .addNumberOption((opt) =>
        opt.setName('target_quantity').setDescription('How much is needed').setMinValue(0)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('close')
      .setDescription('Close a contract and split the payout')
      .addStringOption((opt) =>
        opt
          .setName('for')
          .setDescription('Which contract')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addNumberOption((opt) =>
        opt
          .setName('payout_gold')
          .setDescription('Total gold to split among contributors')
          .setRequired(true)
          .setMinValue(0)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('sell')
      .setDescription('Sell items from inventory, crediting contributors proportionally')
      .addStringOption((opt) =>
        opt.setName('name').setDescription('Sale name/label').setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('items')
          .setDescription('One "<quantity> <item name>" per line, e.g. "15 Cabbage"')
          .setRequired(true)
      )
      .addNumberOption((opt) =>
        opt
          .setName('payout_gold')
          .setDescription('Total gold from the sale to split among contributors')
          .setRequired(true)
          .setMinValue(0)
      )
      .addStringOption((opt) =>
        opt.setName('destination').setDescription('Buyer or destination')
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('buy')
      .setDescription('Buy items into inventory from a vendor (treasury purchase)')
      .addStringOption((opt) =>
        opt.setName('name').setDescription('Purchase name/label').setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('items')
          .setDescription('One "<quantity> <item name>" per line, e.g. "15 Cabbage"')
          .setRequired(true)
      )
      .addNumberOption((opt) =>
        opt
          .setName('cost_gold')
          .setDescription('Total gold spent on this purchase')
          .setRequired(true)
          .setMinValue(0)
      )
      .addStringOption((opt) =>
        opt.setName('source').setDescription('Vendor or where it was bought from')
      )
  );

export async function execute(interaction) {
  const guildId = interaction.guildId;
  await upsertMember(guildId, interaction.user);
  const sub = interaction.options.getSubcommand();

  if (sub === 'create') {
    const name = interaction.options.getString('name');
    const destination = interaction.options.getString('destination');
    const targetItemId = interaction.options.getString('target_item');
    const targetQty = interaction.options.getNumber('target_quantity');

    if (targetItemId && !isValidId(targetItemId)) {
      await interaction.reply({
        content: 'Pick the target item from the autocomplete suggestions rather than typing your own text.',
        ephemeral: true,
      });
      return;
    }

    const result = await query(
      `INSERT INTO contracts (guild_id, name, destination, target_item_id, target_quantity)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [guildId, name, destination, targetItemId, targetQty]
    );

    await interaction.reply(
      `Opened contract **${name}** (#${result.rows[0].id})${destination ? ` for ${destination}` : ''}.`
    );
    return;
  }

  if (sub === 'close') {
    const contractId = interaction.options.getString('for');
    const payoutGold = interaction.options.getNumber('payout_gold');

    if (!isValidId(contractId)) {
      await interaction.reply({
        content: 'Pick the contract from the autocomplete suggestions rather than typing your own text.',
        ephemeral: true,
      });
      return;
    }

    const contractRow = await query(`SELECT status FROM contracts WHERE id = $1 AND guild_id = $2`, [
      contractId,
      guildId,
    ]);
    if (contractRow.rows.length === 0) {
      await interaction.reply({ content: 'Contract not found.', ephemeral: true });
      return;
    }
    if (contractRow.rows[0].status !== 'open') {
      await interaction.reply({ content: 'This contract is already closed.', ephemeral: true });
      return;
    }

    const existing = await query(
      `SELECT 1 FROM contributions WHERE contract_id = $1 AND guild_id = $2 LIMIT 1`,
      [contractId, guildId]
    );
    if (existing.rows.length === 0) {
      await interaction.reply('No contributions logged for this contract — nothing to split.');
      return;
    }

    await interaction.deferReply();
    const lines = await withTransaction((client) =>
      computeAndRecordPayout(client.query.bind(client), guildId, contractId, payoutGold, {
        creditSaleToTreasury: false,
      })
    );
    await interaction.editReply(`**Contract closed — ${payoutGold}g split:**\n${lines.join('\n')}`);
    return;
  }

  if (sub === 'sell') {
    const name = interaction.options.getString('name');
    const destination = interaction.options.getString('destination');
    const itemsText = interaction.options.getString('items');
    const payoutGold = interaction.options.getNumber('payout_gold');

    const itemLines = parseItemLines(itemsText);
    if (itemLines.length === 0) {
      await interaction.reply({
        content: 'Could not parse any items — use one "<quantity> <item name>" per line.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const lines = await withTransaction(async (client) => {
      const run = client.query.bind(client);
      const contractResult = await run(
        `INSERT INTO contracts (guild_id, name, destination, status) VALUES ($1, $2, $3, 'open') RETURNING id`,
        [guildId, name, destination]
      );
      const contractId = contractResult.rows[0].id;

      for (const { quantity, name: itemName } of itemLines) {
        const item = await resolveOrCreateItem(guildId, itemName, run);
        const consumed = await consumeInventory(guildId, item.id, quantity, run);

        const byMember = new Map();
        for (const c of consumed) {
          byMember.set(c.memberId, (byMember.get(c.memberId) ?? 0) + c.quantity);
        }

        for (const [memberId, memberQty] of byMember) {
          await run(
            `INSERT INTO contributions (guild_id, contract_id, item_id, quantity, author_id, credit_id, note)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [guildId, contractId, item.id, memberQty, interaction.user.id, memberId, 'Sold from inventory']
          );
        }
      }

      return computeAndRecordPayout(run, guildId, contractId, payoutGold, { creditSaleToTreasury: true });
    });

    const label = `**${name}**${destination ? ` sold to ${destination}` : ' sold'}`;

    if (lines.length === 0) {
      await interaction.editReply(
        `${label} for **${payoutGold}g** — no eligible contributors to credit (stock was unattributed or oversold).`
      );
      return;
    }

    await interaction.editReply(`${label} — **${payoutGold}g** split:\n${lines.join('\n')}`);
    return;
  }

  if (sub === 'buy') {
    const name = interaction.options.getString('name');
    const source = interaction.options.getString('source');
    const itemsText = interaction.options.getString('items');
    const costGold = interaction.options.getNumber('cost_gold');

    const itemLines = parseItemLines(itemsText);
    if (itemLines.length === 0) {
      await interaction.reply({
        content: 'Could not parse any items — use one "<quantity> <item name>" per line.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const purchased = await withTransaction(async (client) => {
      const run = client.query.bind(client);
      const contractResult = await run(
        `INSERT INTO contracts (guild_id, name, destination, status, payout_gold, closed_at)
         VALUES ($1, $2, $3, 'closed', $4, now()) RETURNING id`,
        [guildId, name, source, costGold]
      );
      const contractId = contractResult.rows[0].id;

      const purchased = [];
      for (const { quantity, name: itemName } of itemLines) {
        const item = await resolveOrCreateItem(guildId, itemName, run);
        await createLot(guildId, item.id, null, quantity, run);
        purchased.push(`${quantity} ${item.name}`);
      }

      await recordLedgerEntry({ guildId, contractId, deltaGold: -costGold, reason: 'purchase' }, run);

      return purchased;
    });

    await interaction.editReply(
      `**${name}** — bought${source ? ` from ${source}` : ''} for **${costGold}g**: ${purchased.join(', ')}.`
    );
  }
}

// Shared by /contract close and /contract sell. `creditSaleToTreasury`
// credits the full payout amount into the treasury ledger first (a sale
// brought that gold in) before debiting each contributor's share back out;
// a plain close just debits contributors directly, since that gold is
// assumed to already be in the guild's hands (see the treasury design notes).
async function computeAndRecordPayout(runQuery, guildId, contractId, payoutGold, { creditSaleToTreasury }) {
  const totals = await runQuery(
    `SELECT c.credit_id, SUM(c.quantity * i.unit_value) AS weighted_input
     FROM contributions c
     JOIN items i ON i.id = c.item_id
     WHERE c.contract_id = $1 AND c.guild_id = $2
     GROUP BY c.credit_id`,
    [contractId, guildId]
  );

  if (creditSaleToTreasury) {
    await recordLedgerEntry({ guildId, contractId, deltaGold: payoutGold, reason: 'sale' }, runQuery);
  }

  const splits = splitProportionally(
    totals.rows.map((r) => ({ key: r.credit_id, weight: r.weighted_input })),
    payoutGold
  );

  const lines = [];
  for (const { key: memberId, weight: inputValue, sharePct, amount: goldAwarded } of splits) {
    await runQuery(
      `INSERT INTO payouts (guild_id, contract_id, member_id, input_value, share_pct, gold_awarded)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [guildId, contractId, memberId, inputValue, sharePct, goldAwarded]
    );

    await recordLedgerEntry(
      { guildId, contractId, memberId, deltaGold: -goldAwarded, reason: 'payout' },
      runQuery
    );

    lines.push(`<@${memberId}>: ${(sharePct * 100).toFixed(1)}% — ${goldAwarded.toFixed(0)}g`);
  }

  await runQuery(
    `UPDATE contracts SET status = 'closed', payout_gold = $2, closed_at = now() WHERE id = $1 AND guild_id = $3`,
    [contractId, payoutGold, guildId]
  );

  return lines;
}

export async function autocomplete(interaction) {
  const guildId = interaction.guildId;
  const focused = interaction.options.getFocused(true);

  if (focused.name === 'target_item') {
    await interaction.respond(await itemChoices(guildId, focused.value));
    return;
  }

  if (focused.name === 'for') {
    await interaction.respond(await contractChoices(guildId, focused.value, { openOnly: true }));
  }
}

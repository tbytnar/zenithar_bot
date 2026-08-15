import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { query, upsertMember } from '../db.js';
import { contractAutocompleteLabel } from '../format.js';
import { resolveOrCreateItem, consumeInventory } from '../inventory.js';

const SELL_ITEM_LINE = /^\s*(\d+(?:\.\d+)?)\s+(.+?)\s*$/;

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
        opt.setName('target_quantity').setDescription('How much is needed')
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
      )
      .addStringOption((opt) =>
        opt.setName('destination').setDescription('Buyer or destination')
      )
  );

export async function execute(interaction) {
  await upsertMember(interaction.user);
  const sub = interaction.options.getSubcommand();

  if (sub === 'create') {
    const name = interaction.options.getString('name');
    const destination = interaction.options.getString('destination');
    const targetItemId = interaction.options.getString('target_item');
    const targetQty = interaction.options.getNumber('target_quantity');

    const result = await query(
      `INSERT INTO contracts (name, destination, target_item_id, target_quantity)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, destination, targetItemId, targetQty]
    );

    await interaction.reply(
      `Opened contract **${name}** (#${result.rows[0].id})${destination ? ` for ${destination}` : ''}.`
    );
    return;
  }

  if (sub === 'close') {
    const contractId = interaction.options.getString('for');
    const payoutGold = interaction.options.getNumber('payout_gold');

    const existing = await query(`SELECT 1 FROM contributions WHERE contract_id = $1 LIMIT 1`, [
      contractId,
    ]);
    if (existing.rows.length === 0) {
      await interaction.reply('No contributions logged for this contract — nothing to split.');
      return;
    }

    const lines = await computeAndRecordPayout(contractId, payoutGold);
    await interaction.reply(`**Contract closed — ${payoutGold}g split:**\n${lines.join('\n')}`);
    return;
  }

  if (sub === 'sell') {
    const name = interaction.options.getString('name');
    const destination = interaction.options.getString('destination');
    const itemsText = interaction.options.getString('items');
    const payoutGold = interaction.options.getNumber('payout_gold');

    const itemLines = itemsText
      .split('\n')
      .map((line) => line.match(SELL_ITEM_LINE))
      .filter(Boolean);

    if (itemLines.length === 0) {
      await interaction.reply({
        content: 'Could not parse any items — use one "<quantity> <item name>" per line.',
        ephemeral: true,
      });
      return;
    }

    const contractResult = await query(
      `INSERT INTO contracts (name, destination, status) VALUES ($1, $2, 'open') RETURNING id`,
      [name, destination]
    );
    const contractId = contractResult.rows[0].id;

    for (const match of itemLines) {
      const [, qtyStr, rawName] = match;
      const quantity = Number(qtyStr);
      const item = await resolveOrCreateItem(rawName.trim());
      const consumed = await consumeInventory(item.id, quantity);

      const byMember = new Map();
      for (const c of consumed) {
        byMember.set(c.memberId, (byMember.get(c.memberId) ?? 0) + c.quantity);
      }

      for (const [memberId, memberQty] of byMember) {
        await query(
          `INSERT INTO contributions (contract_id, item_id, quantity, author_id, credit_id, note)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [contractId, item.id, memberQty, interaction.user.id, memberId, 'Sold from inventory']
        );
      }
    }

    const lines = await computeAndRecordPayout(contractId, payoutGold);
    const label = `**${name}**${destination ? ` sold to ${destination}` : ' sold'}`;

    if (lines.length === 0) {
      await interaction.reply(
        `${label} for **${payoutGold}g** — no eligible contributors to credit (stock was unattributed or oversold).`
      );
      return;
    }

    await interaction.reply(`${label} — **${payoutGold}g** split:\n${lines.join('\n')}`);
  }
}

// Shared by /contract close (after confirming contributions exist) and
// /contract sell (which always finalizes, even with nothing to credit -
// the sale still happened and consumed real inventory either way).
async function computeAndRecordPayout(contractId, payoutGold) {
  const totals = await query(
    `SELECT c.credit_id, SUM(c.quantity * i.unit_value) AS weighted_input
     FROM contributions c
     JOIN items i ON i.id = c.item_id
     WHERE c.contract_id = $1
     GROUP BY c.credit_id`,
    [contractId]
  );

  const lines = [];
  if (totals.rows.length > 0) {
    const grandTotal = totals.rows.reduce((sum, r) => sum + Number(r.weighted_input), 0);

    for (const row of totals.rows) {
      const sharePct = Number(row.weighted_input) / grandTotal;
      const goldAwarded = sharePct * payoutGold;

      await query(
        `INSERT INTO payouts (contract_id, member_id, input_value, share_pct, gold_awarded)
         VALUES ($1, $2, $3, $4, $5)`,
        [contractId, row.credit_id, row.weighted_input, sharePct, goldAwarded]
      );

      lines.push(`<@${row.credit_id}>: ${(sharePct * 100).toFixed(1)}% — ${goldAwarded.toFixed(0)}g`);
    }
  }

  await query(
    `UPDATE contracts SET status = 'closed', payout_gold = $2, closed_at = now() WHERE id = $1`,
    [contractId, payoutGold]
  );

  return lines;
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);

  if (focused.name === 'target_item') {
    const rows = await query(`SELECT id, name FROM items WHERE name ILIKE $1 LIMIT 25`, [
      `%${focused.value}%`,
    ]);
    await interaction.respond(rows.rows.map((r) => ({ name: r.name, value: String(r.id) })));
    return;
  }

  if (focused.name === 'for') {
    const rows = await query(
      `SELECT id, name, created_at FROM contracts WHERE status = 'open' AND name ILIKE $1
       ORDER BY created_at DESC LIMIT 25`,
      [`%${focused.value}%`]
    );
    await interaction.respond(
      rows.rows.map((r) => ({
        name: contractAutocompleteLabel(r.name, r.created_at),
        value: String(r.id),
      }))
    );
  }
}

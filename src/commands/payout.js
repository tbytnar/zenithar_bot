import { SlashCommandBuilder } from 'discord.js';
import { query } from '../db.js';
import { contractChoices } from '../autocomplete.js';

export const data = new SlashCommandBuilder()
  .setName('payout')
  .setDescription('Show payout breakdown for a contract')
  .addStringOption((opt) =>
    opt.setName('for').setDescription('Which contract').setRequired(true).setAutocomplete(true)
  );

export async function execute(interaction) {
  const guildId = interaction.guildId;
  const contractId = interaction.options.getString('for');

  const contract = await query(
    `SELECT name, status, payout_gold, destination FROM contracts WHERE id = $1 AND guild_id = $2`,
    [contractId, guildId]
  );
  if (contract.rows.length === 0) {
    await interaction.reply({ content: 'Contract not found.', ephemeral: true });
    return;
  }

  const { name, status, payout_gold: payoutGold, destination } = contract.rows[0];

  if (status === 'closed') {
    const payouts = await query(
      `SELECT member_id, share_pct, gold_awarded, paid FROM payouts WHERE contract_id = $1 AND guild_id = $2
       ORDER BY gold_awarded DESC`,
      [contractId, guildId]
    );

    if (payouts.rows.length === 0) {
      // A treasury purchase (/contract buy), or a sale where nothing was
      // eligible to credit - either way there's a gold amount but no split.
      const detail =
        payoutGold != null
          ? `${Number(payoutGold)}g recorded${destination ? ` (${destination})` : ''} — no contributors credited.`
          : 'No payout recorded for this contract.';
      await interaction.reply(`**${name} (closed)**\n${detail}`);
      return;
    }

    const lines = payouts.rows.map(
      (r) =>
        `<@${r.member_id}>: ${(r.share_pct * 100).toFixed(1)}% — ${Number(r.gold_awarded).toFixed(0)}g${r.paid ? ' ✅' : ''}`
    );
    await interaction.reply(`**${name} (closed)**\n${lines.join('\n')}`);
    return;
  }

  const totals = await query(
    `SELECT c.credit_id, SUM(c.quantity * i.unit_value) AS weighted_input
     FROM contributions c JOIN items i ON i.id = c.item_id
     WHERE c.contract_id = $1 AND c.guild_id = $2
     GROUP BY c.credit_id
     ORDER BY weighted_input DESC`,
    [contractId, guildId]
  );

  if (totals.rows.length === 0) {
    await interaction.reply(`**${name} (open)** — no contributions logged yet.`);
    return;
  }

  const grandTotal = totals.rows.reduce((sum, r) => sum + Number(r.weighted_input), 0);
  const lines = totals.rows.map((r) => {
    const pct = ((Number(r.weighted_input) / grandTotal) * 100).toFixed(1);
    return `<@${r.credit_id}>: ${r.weighted_input} (${pct}%)`;
  });

  await interaction.reply(`**${name} (open — running totals)**\n${lines.join('\n')}`);
}

export async function autocomplete(interaction) {
  const guildId = interaction.guildId;
  const focused = interaction.options.getFocused();
  await interaction.respond(await contractChoices(guildId, focused, { openOnly: false }));
}

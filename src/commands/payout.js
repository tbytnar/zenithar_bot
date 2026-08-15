import { SlashCommandBuilder } from 'discord.js';
import { query } from '../db.js';
import { contractAutocompleteLabel } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('payout')
  .setDescription('Show payout breakdown for a contract')
  .addStringOption((opt) =>
    opt.setName('for').setDescription('Which contract').setRequired(true).setAutocomplete(true)
  );

export async function execute(interaction) {
  const contractId = interaction.options.getString('for');

  const contract = await query(`SELECT name, status FROM contracts WHERE id = $1`, [contractId]);
  if (contract.rows.length === 0) {
    await interaction.reply({ content: 'Contract not found.', ephemeral: true });
    return;
  }

  const { name, status } = contract.rows[0];

  if (status === 'closed') {
    const payouts = await query(
      `SELECT member_id, share_pct, gold_awarded, paid FROM payouts WHERE contract_id = $1
       ORDER BY gold_awarded DESC`,
      [contractId]
    );
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
     WHERE c.contract_id = $1
     GROUP BY c.credit_id
     ORDER BY weighted_input DESC`,
    [contractId]
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
  const focused = interaction.options.getFocused();
  const rows = await query(
    `SELECT id, name, created_at FROM contracts WHERE name ILIKE $1 ORDER BY created_at DESC LIMIT 25`,
    [`%${focused}%`]
  );
  await interaction.respond(
    rows.rows.map((r) => ({
      name: contractAutocompleteLabel(r.name, r.created_at),
      value: String(r.id),
    }))
  );
}

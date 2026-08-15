import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { query } from '../db.js';
import { leaderboardChartConfig, treasuryChartConfig, stockChartConfig, renderChartPng } from '../charts.js';

const EMBED_COLOR = 0x2a78d6;

export const data = new SlashCommandBuilder()
  .setName('report')
  .setDescription('Charted reports over contract, treasury, and stock data')
  .addSubcommand((sub) => sub.setName('leaderboard').setDescription('Top contributors by gold earned'))
  .addSubcommand((sub) => sub.setName('treasury').setDescription('Treasury balance over time'))
  .addSubcommand((sub) => sub.setName('stock').setDescription('Current stock levels, charted'));

export async function execute(interaction) {
  const guildId = interaction.guildId;
  const sub = interaction.options.getSubcommand();

  // Rendering goes through an external API (QuickChart) on top of the DB
  // query, easily enough to miss Discord's 3s ack window.
  await interaction.deferReply();

  if (sub === 'leaderboard') {
    const rows = await query(
      `SELECT m.display_name, SUM(p.gold_awarded) AS gold
       FROM payouts p
       JOIN members m ON m.id = p.member_id AND m.guild_id = p.guild_id
       WHERE p.guild_id = $1
       GROUP BY m.display_name
       ORDER BY gold DESC
       LIMIT 10`,
      [guildId]
    );

    if (rows.rows.length === 0) {
      await interaction.editReply('No payouts recorded yet — nothing to chart.');
      return;
    }

    const chartRows = rows.rows.map((r) => ({ name: r.display_name, gold: Number(r.gold) }));
    await replyWithChart(interaction, leaderboardChartConfig(chartRows), 'Top Contributors');
    return;
  }

  if (sub === 'treasury') {
    const rows = await query(
      `SELECT delta_gold, created_at FROM treasury_ledger WHERE guild_id = $1 ORDER BY created_at ASC`,
      [guildId]
    );

    if (rows.rows.length === 0) {
      await interaction.editReply('No treasury activity recorded yet — nothing to chart.');
      return;
    }

    let running = 0;
    const points = rows.rows.map((r) => {
      running += Number(r.delta_gold);
      return {
        label: r.created_at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        balance: running,
      };
    });

    await replyWithChart(interaction, treasuryChartConfig(points), 'Treasury Balance');
    return;
  }

  if (sub === 'stock') {
    const rows = await query(
      `SELECT i.name, SUM(l.quantity) AS quantity
       FROM inventory_lots l
       JOIN items i ON i.id = l.item_id
       WHERE l.guild_id = $1
       GROUP BY i.name
       HAVING ROUND(SUM(l.quantity), 6) != 0
       ORDER BY quantity DESC
       LIMIT 15`,
      [guildId]
    );

    if (rows.rows.length === 0) {
      await interaction.editReply('No inventory tracked yet — nothing to chart.');
      return;
    }

    const chartRows = rows.rows.map((r) => ({ name: r.name, quantity: Number(r.quantity) }));
    await replyWithChart(interaction, stockChartConfig(chartRows), 'Current Stock');
    return;
  }
}

async function replyWithChart(interaction, chartConfig, title) {
  const png = await renderChartPng(chartConfig);
  const attachment = new AttachmentBuilder(png, { name: 'chart.png' });
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title).setImage('attachment://chart.png');
  await interaction.editReply({ embeds: [embed], files: [attachment] });
}

import { SlashCommandBuilder } from 'discord.js';
import { query } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('stock')
  .setDescription('Show current inventory levels');

export async function execute(interaction) {
  const guildId = interaction.guildId;
  const rows = await query(
    `SELECT i.name, SUM(l.quantity) AS quantity
     FROM inventory_lots l
     JOIN items i ON i.id = l.item_id
     WHERE l.guild_id = $1
     GROUP BY i.name
     HAVING SUM(l.quantity) != 0
     ORDER BY i.name`,
    [guildId]
  );

  if (rows.rows.length === 0) {
    await interaction.reply('No inventory tracked yet.');
    return;
  }

  const lines = rows.rows.map((r) => `${r.name}: ${r.quantity}`);
  await interaction.reply(`**Current stock**\n${lines.join('\n')}`);
}

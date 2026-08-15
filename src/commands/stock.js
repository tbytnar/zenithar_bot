import { SlashCommandBuilder } from 'discord.js';
import { query } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('stock')
  .setDescription('Show current inventory levels');

export async function execute(interaction) {
  const rows = await query(
    `SELECT i.name, inv.quantity FROM inventory inv
     JOIN items i ON i.id = inv.item_id
     WHERE inv.quantity != 0
     ORDER BY i.name`
  );

  if (rows.rows.length === 0) {
    await interaction.reply('No inventory tracked yet.');
    return;
  }

  const lines = rows.rows.map((r) => `${r.name}: ${r.quantity}`);
  await interaction.reply(`**Current stock**\n${lines.join('\n')}`);
}

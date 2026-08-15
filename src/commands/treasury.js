import { SlashCommandBuilder } from 'discord.js';
import { getBalance } from '../treasury.js';

export const data = new SlashCommandBuilder()
  .setName('treasury')
  .setDescription('Show the current guild treasury balance');

export async function execute(interaction) {
  const balance = await getBalance(interaction.guildId);
  await interaction.reply(`**Treasury balance:** ${balance}g`);
}

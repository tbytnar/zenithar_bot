import { Client, GatewayIntentBits, Collection } from 'discord.js';
import 'dotenv/config';

import * as contract from './commands/contract.js';
import * as contribute from './commands/contribute.js';
import * as payout from './commands/payout.js';
import * as stock from './commands/stock.js';
import * as item from './commands/item.js';
import * as settings from './commands/settings.js';
import * as treasury from './commands/treasury.js';
import * as report from './commands/report.js';
import { handleInventoryMessage } from './inventory.js';
import { handleWordPointsMessage } from './wordPoints.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();
for (const cmd of [contract, contribute, payout, stock, item, settings, treasury, report]) {
  client.commands.set(cmd.data.name, cmd);
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  try {
    await handleInventoryMessage(message);
  } catch (err) {
    console.error(err);
  }

  try {
    await handleWordPointsMessage(message);
  } catch (err) {
    console.error(err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand() || interaction.isAutocomplete()) {
    if (!interaction.guildId) {
      if (interaction.isChatInputCommand()) {
        await interaction.reply({ content: 'This bot only works inside a server.', ephemeral: true });
      }
      return;
    }
  }

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    if (interaction.isAutocomplete()) {
      if (command.autocomplete) await command.autocomplete(interaction);
      return;
    }

    if (interaction.isChatInputCommand()) {
      await command.execute(interaction);
    }
  } catch (err) {
    console.error(err);
    if (interaction.isChatInputCommand() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Something went wrong running that command.', ephemeral: true });
    } else if (interaction.isChatInputCommand() && interaction.deferred) {
      await interaction.editReply('Something went wrong running that command.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

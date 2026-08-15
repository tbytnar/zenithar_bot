import { Client, GatewayIntentBits, Collection } from 'discord.js';
import 'dotenv/config';

import * as contract from './commands/contract.js';
import * as contribute from './commands/contribute.js';
import * as payout from './commands/payout.js';
import * as stock from './commands/stock.js';
import * as item from './commands/item.js';
import { handleInventoryMessage } from './inventory.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();
for (const cmd of [contract, contribute, payout, stock, item]) {
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
});

client.on('interactionCreate', async (interaction) => {
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
    if (interaction.isChatInputCommand() && !interaction.replied) {
      await interaction.reply({ content: 'Something went wrong running that command.', ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

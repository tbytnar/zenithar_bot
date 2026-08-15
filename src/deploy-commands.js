import { REST, Routes } from 'discord.js';
import 'dotenv/config';

import * as contract from './commands/contract.js';
import * as contribute from './commands/contribute.js';
import * as payout from './commands/payout.js';
import * as stock from './commands/stock.js';
import * as item from './commands/item.js';

const commands = [contract, contribute, payout, stock, item].map((c) => c.data.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

// Guild-scoped registration updates instantly, good for active development.
// Switch to Routes.applicationCommands(clientId) for global (slower, ~1hr
// propagation) once things are stable.
try {
  console.log(`Registering ${commands.length} commands...`);
  await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
    { body: commands }
  );
  console.log('Done.');
} catch (err) {
  console.error(err);
}

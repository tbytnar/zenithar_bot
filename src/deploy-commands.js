import { REST, Routes } from 'discord.js';
import 'dotenv/config';

import * as contract from './commands/contract.js';
import * as contribute from './commands/contribute.js';
import * as payout from './commands/payout.js';
import * as stock from './commands/stock.js';
import * as item from './commands/item.js';
import * as settings from './commands/settings.js';
import * as treasury from './commands/treasury.js';

const commands = [contract, contribute, payout, stock, item, settings, treasury].map((c) => c.data.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

// Global registration so the bot works in any guild it's invited to, not
// just one hardcoded at deploy time. Propagates to all guilds in up to ~1hr
// (Discord caches global commands client-side), vs. instant for guild-scoped
// registration — that tradeoff is required for multi-guild support.
try {
  console.log(`Registering ${commands.length} global commands...`);
  await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
  console.log('Done.');
} catch (err) {
  console.error(err);
}

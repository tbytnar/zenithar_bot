# Keizaal Inventory Bot

Discord bot for tracking contract contributions and splitting payouts,
replacing the `+item` message-scrollback system.

## Setup

1. **Database**
   ```
   createdb keizaal_inventory
   psql keizaal_inventory -f db/schema.sql
   ```
   The schema seeds a handful of items (Charcoal, Coke, Firewood, and the
   farm crops) with `unit_value = 1`. Update those once you decide how
   different materials should weigh against each other in mixed-item
   contracts — see the open question below.

2. **Discord application**
   - Create an application at https://discord.com/developers/applications
   - Add a Bot user, copy the token → `DISCORD_TOKEN`
   - Copy the Application ID → `DISCORD_CLIENT_ID`
   - Get your server's ID (enable Developer Mode, right-click server icon,
     Copy Server ID) → `DISCORD_GUILD_ID`
   - Invite the bot with the `applications.commands` and `bot` scopes,
     with permission to send messages / use slash commands in your channel

3. **Install & configure**
   ```
   cp .env.example .env   # fill in the four values above and DATABASE_URL
   npm install
   npm run deploy-commands
   npm start
   ```

## Commands

- `/contract create name: destination: target_item: target_quantity:` — officers, opens a contract
- `/contribute add item: amount: for: credit: note:` — logs an input, replaces `+item` messages
- `/contribute undo` — removes your own most recent contribution
- `/contract close for: payout_gold:` — locks the contract, computes and posts the split
- `/payout for:` — running totals if open, final breakdown if closed

## Permissions

`/contract create` and `/contract close` default to requiring **Manage
Server** (`ManageGuild`). Server admins can loosen or tighten this per
role via Server Settings → Integrations → Zenithar Bot, without touching
code. Changing the default in code means editing
`setDefaultMemberPermissions(...)` in `src/commands/contract.js` and
re-running `npm run deploy-commands` (or the equivalent
`docker compose run --rm bot node src/deploy-commands.js` in production).

## Still to decide

- **Unit values**: single-material contracts (Dawnstar charcoal) work fine
  with the default `unit_value = 1`. For mixed contracts (the farm run:
  cabbage/wheat/gourd/potato) you'll want real relative values in the
  `items` table so the split reflects actual worth, not just item count.
- **Historical data**: this doesn't import the existing Discord scrollback —
  intentionally deferred per your earlier call. New contracts start clean.

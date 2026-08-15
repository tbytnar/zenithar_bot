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
   - Under **Bot**, enable the **Message Content Intent** (privileged
     intent toggle) — required for general inventory tracking, see below.
     Without this, `+15 Cabbage`-style messages won't be seen by the bot.
   - Invite the bot with the `applications.commands` and `bot` scopes,
     with permission to send messages / use slash commands in your channel

3. **Install & configure**
   ```
   cp .env.example .env   # fill in the values above, INVENTORY_CHANNEL_ID, and DATABASE_URL
   npm install
   npm run deploy-commands
   npm start
   ```

## Commands

- `/contract create name: destination: target_item: target_quantity:` — officers, opens a contract
- `/contribute add item: amount: for: credit: note:` — logs an input toward a contract
- `/contribute undo` — removes your own most recent contribution
- `/contract close for: payout_gold:` — locks the contract, computes and posts the split
- `/contract sell name: items: payout_gold: destination:` — officers, sells items straight out of general inventory and credits contributors back (see below)
- `/payout for:` — running totals if open, final breakdown if closed
- `/stock` — shows current general inventory levels
- `/item merge from: into:` — officers, folds a duplicate item (e.g. a typo) into another

## General inventory tracking

Separate from contracts: post a message in the channel set by
`INVENTORY_CHANNEL_ID` with one item per line —

```
+15 Cabbage
+10 Wheat
-8 Gourd
```

— and the bot adjusts stock per item (viewable via `/stock`), replying
with a colored embed per line (green/Added, red/Removed) showing what it
applied. Item names are matched case-insensitively; a close-but-not-exact
match (typo) resolves to the existing item via trigram similarity rather
than creating a duplicate, and the bot flags in its reply whenever it
fuzzy-matched or had to create a brand new item, so a genuine typo is
visible immediately. If one does slip through as a real duplicate,
`/item merge` folds it into the correct item (moving stock and any
contract history along with it) and removes the duplicate. Anyone can
post adjustments — this isn't restricted like `/contract create`/`close`.

Internally, every `+` addition is tracked as its own "lot" recording who
contributed it (not just a running total) — that's what makes
`/contract sell` possible: selling `15 Cabbage` looks at everyone
currently holding Cabbage stock and credits each of them their
proportional share of the payout, the same way a normal contract splits
gold across contributors, just auto-logged instead of typed by hand.
Selling more than is currently in stock is allowed — the shortfall is
tracked as an unattributed deficit (nobody gets credited for gold on
stock nobody actually contributed) rather than the sale being rejected.

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

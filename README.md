# Keizaal Inventory Bot

Discord bot for tracking contract contributions and splitting payouts,
replacing the `+item` message-scrollback system. Multi-guild: one bot/
database can serve any number of Discord servers, each fully isolated from
the others.

> Looking to **add this bot to your own server** rather than run a copy of
> it? See [GETTING_STARTED.md](GETTING_STARTED.md) instead — this file is
> for running/hosting the bot itself.

## Setup

1. **Database**
   ```
   createdb keizaal_inventory
   psql keizaal_inventory -f schema.sql
   ```

2. **Discord application**
   - Create an application at https://discord.com/developers/applications
   - Add a Bot user, copy the token → `DISCORD_TOKEN`
   - Copy the Application ID → `DISCORD_CLIENT_ID`
   - Under **Bot**, enable the **Message Content Intent** (privileged
     intent toggle) — required for general inventory/gold tracking, see
     below. Without this, `+15 Cabbage`-style messages won't be seen by
     the bot.
   - Under **OAuth2 → URL Generator**, check scopes **`bot`** and
     **`applications.commands`**, and under **Bot Permissions** check:
     - **View Channels**
     - **Send Messages**
     - **Embed Links** (the colored inventory/gold reply embeds need this)

     That's permission integer `19456`, so this invite link also works
     directly — swap in your own `DISCORD_CLIENT_ID`:
     ```
     https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=19456
     ```
   - Use that link to invite the bot to any server it should run in —
     there's no per-server allowlist or guild ID to configure ahead of
     time, any server admin can add it.

3. **Install & configure**
   ```
   cp .env.example .env   # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, DATABASE_URL
   npm install
   npm run deploy-commands
   npm start
   ```
   Slash commands are registered **globally** (any guild the bot is in),
   which can take up to ~1hr to propagate on first deploy or when a
   command changes — instant per-server registration isn't available once
   more than one server is in play.

4. **Per-server configuration**
   In each Discord server the bot joins, a server admin runs:
   ```
   /settings channels inventory:#your-channel gold:#your-gold-channel quests:#your-quests-channel
   ```
   (`gold:` and `quests:` are both optional — omit `gold:` to track gold in
   the same channel as items; omit `quests:` and new contracts just won't
   be auto-posted anywhere.) See **General inventory & gold tracking**
   below for what goes in those channels, and **Permissions** for who's
   allowed to run `/settings`.

## Commands

- `/contract create name: destination: target_item: target_quantity: due:` — officers, opens a contract (`due:` is optional, format `YYYY-MM-DD`)
- `/contribute add item: amount: for: credit: note:` — logs an input toward a contract
- `/contribute undo` — removes your own most recent contribution
- `/contract close for: payout_gold:` — locks the contract, computes and posts the split
- `/contract sell name: items: payout_gold: destination:` — officers, sells items straight out of general inventory and credits contributors back (see below)
- `/contract buy name: items: cost_gold: source:` — officers, buys items into inventory from a vendor (treasury purchase, no contributor credited)
- `/payout for:` — running totals if open, final breakdown if closed
- `/stock` — shows current general inventory levels
- `/treasury` — shows the current guild gold balance
- `/item create name: unit_value:` — officers, adds a new item to the catalog (materials, or a non-physical item like a service — see below)
- `/item edit item: name: unit_value:` — officers, renames an item and/or changes its relative value
- `/item delete item:` — officers, removes an item with no contract or inventory history
- `/item list` — officers, shows every item and its relative value
- `/item merge from: into:` — officers, folds a duplicate item (e.g. a typo) into another
- `/settings view` / `/settings channels` / `/settings currency` — officers, configure this server's channels and currency words
- `/report leaderboard` / `/report treasury` / `/report stock` — charted PNG reports (see below)

## Charted reports

`/report` renders a chart and posts it as an image alongside a normal embed:

- `/report leaderboard` — top 10 contributors by total gold earned across all payouts
- `/report treasury` — running treasury balance over time, from the full gold ledger
- `/report stock` — current stock levels, largest first (top 15)

Rendering happens via [QuickChart](https://quickchart.io)'s hosted API — the
bot builds a Chart.js config and POSTs it there, no local rendering
dependency (no `node-canvas`, no headless browser) and nothing to run
yourself. Their free tier is 1,000 renders/month with no API key, which is
comfortably enough for on-demand report commands in a single server; if that
ever stops being true, `src/charts.js` is the only file that would need to
change (e.g. to a self-hosted QuickChart instance or a local renderer).

## General inventory & gold tracking

Separate from contracts: post a message in the channel set by
`/settings channels inventory:` with one item per line —

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

The reverse direction is `/contract buy` — the guild spending gold to
acquire stock from an outside vendor. Unlike a sale, there's no existing
contributor to credit, so purchased stock enters inventory as an
unattributed lot (same as legacy/backorder stock), and the cost is
recorded both as a closed contract (visible via `/payout for:`) and as a
debit against the treasury.

**Gold** works the same way, in the channel set by `/settings channels
gold:` (or the inventory channel, if you didn't set one separately) —
post lines like:

```
-100 gold (buying carrots)
+200 septims (sold a book)
```

The parenthetical note is optional. `/settings currency` controls which
words the bot recognizes as currency (`gold septim septims` by default) —
useful if your game uses different terminology. Every gold movement,
whether posted manually like this or generated automatically by
`/contract buy`/`sell`/`close`, lands in the same guild treasury ledger;
`/treasury` shows the running balance.

## Quests channel & due dates

If `/settings channels quests:` is set, every `/contract create` posts an
embed there — name, destination, target item/quantity, and due date,
whichever of those were set — as a heads-up for anyone browsing for
something to contribute to. `/contract sell` and `/contract buy` don't
post here, since those represent something already done, not a call to
action.

`due:` on `/contract create` is optional and takes a plain `YYYY-MM-DD`
date. It shows up on the quests-channel post and on `/payout for:` while
the contract's still open, with a ⚠️ **Overdue** flag once the date's
passed and nobody's closed it yet. Nothing currently pings anyone when a
contract goes overdue — it's a passive flag on `/payout`, not a
notification.

## Permissions

`/contract create`, `/contract close`, `/contract sell`, `/contract buy`,
every `/item` subcommand (`create`/`edit`/`delete`/`list`/`merge`), and
`/settings` all default to requiring **Manage Server** (`ManageGuild`).
Discord applies `setDefaultMemberPermissions` to a whole command, not per
subcommand — so `/item list`, despite being read-only, currently requires
the same permission as `/item delete`. If that's not what you want (e.g.
letting anyone browse the catalog), it'd need to move to its own top-level
command rather than an `/item` subcommand.

Server admins can loosen or tighten any of this per role via Server
Settings → Integrations → Zenithar Bot, without touching code — configured
per-server, independently of every other server the bot is in. Changing
the *default* in code means editing `setDefaultMemberPermissions(...)` in
the relevant command file and re-running `npm run deploy-commands` (or the
equivalent `docker compose run --rm bot node src/deploy-commands.js` in
production) — note that as a global command update this can take up to
~1hr to propagate.

## Still to decide

- **Unit values**: single-material contracts (Dawnstar charcoal) work fine
  with the default `unit_value = 1`. For mixed contracts (the farm run:
  cabbage/wheat/gourd/potato) you'll want real relative values in the
  `items` table so the split reflects actual worth, not just item count —
  `unit_value` supports up to 4 decimal places for items worth less than 1
  gold.
- **Non-physical items**: `unit_value` doesn't require the item to be a
  material — `/item create` can add something like "Escort Shift" or "Guard
  Duty" with its own relative value, and members log it with
  `/contribute add` exactly like a material. It splits payouts the same
  way, so escorts/guards can earn a share (and show up on
  `/report leaderboard`) either on a standalone contract or mixed into the
  same contract as whoever/whatever they protected. Just create it via
  `/item create`, not by posting `+1` in the inventory channel — that would
  create a real stock lot and start showing up in `/stock`.
- **Historical data**: this doesn't import the existing Discord scrollback —
  intentionally deferred per your earlier call. New contracts start clean.

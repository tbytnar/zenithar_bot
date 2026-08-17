# Adding Zenithar Bot to your server

This page is for server admins who want to **use** the bot — if you're
looking to run your own separate copy of it instead, see
[README.md](README.md).

Zenithar Bot tracks who contributed what to a shared crafting/gathering
contract, splits the payout fairly when it's done, keeps a running tally of
general stock and gold, and can chart all of it back out on demand. One bot
serves any number of servers, and each server's data is completely separate
from every other's — nothing you track is visible to, or shared with, any
other server using the bot.

## 1. Invite it

<!-- OWNER: replace YOUR_CLIENT_ID with the bot's real application ID before sharing this page -->
```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=19456
```

Click it, pick your server, and authorize. That's the whole install — no
separate hosting, database, or account to set up on your end.

## 2. Tell it where to work

Once it's in, run this in your server (requires Manage Server permission):

```
/settings channels inventory:#your-channel gold:#your-gold-channel quests:#your-quests-channel
```

- `inventory:` — the channel where `+15 Cabbage` / `-8 Gourd` style messages
  get tracked as stock.
- `gold:` — the channel where `+100 gold` / `-50 septims` style messages get
  tracked as treasury gold. Optional — leave it out and gold gets tracked in
  the same channel as items.
- `quests:` — where new contracts get auto-posted when an officer runs
  `/contract create`. Optional — leave it out and new contracts just won't
  be announced anywhere automatically.

If your game calls its currency something other than "gold" or "septims",
run `/settings currency words:whatever your terms are` to teach it the
right words.

That's the setup. Everything else is normal slash commands from here.

## What everyone can do

- **`/contribute add`** — log something you put toward an open contract.
- **`/contribute undo`** — take back your own most recent contribution, if
  you mis-logged it.
- **`/payout for:`** — check the running split on an open contract, or the
  final breakdown on a closed one.
- **`/stock`** — see current inventory levels.
- **`/treasury`** — see the current gold balance.
- **`/report leaderboard` / `/report treasury` / `/report stock`** — the
  same data as charts.
- Post `+15 Cabbage` or `-100 gold (bought supplies)` directly in the
  channels from step 2 — no command needed, the bot just reads it.

## What officers can do

These default to requiring **Manage Server** — your server, your call on
who else gets it (Server Settings → Integrations → Zenithar Bot, no code or
redeploy involved):

- **`/contract create`** — open a new contract for people to contribute to.
  Add `due:YYYY-MM-DD` for a deadline — it shows up on the quests-channel
  post and flags as overdue on `/payout` once it passes.
- **`/contract close`** — lock a contract and split the payout among
  contributors.
- **`/contract sell`** — sell straight out of general inventory, crediting
  whoever's stock it came from.
- **`/contract buy`** — spend treasury gold to bring in stock from a vendor.
- **`/item create` / `/item edit` / `/item delete` / `/item list`** — manage
  the item catalog, including its relative values. Items don't have to be
  physical materials — this is also how you'd add something like "Escort
  Shift" so members providing a service instead of goods can log
  contributions and show up on the leaderboard too.
- **`/item merge`** — fold a duplicate item (usually a typo) into the
  correct one.
- **`/settings`** — everything from step 2, plus currency words.

## Questions

Full command reference and the mechanics behind fuzzy item matching,
proportional payout splits, and the treasury ledger are in
[README.md](README.md) if you want the details.

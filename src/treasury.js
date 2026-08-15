import { query } from './db.js';

// Records one signed movement in the guild's gold ledger. Pass `runQuery` as
// `client.query.bind(client)` when this needs to be part of a larger
// transaction (e.g. alongside the inventory/contribution writes in
// /contract sell); otherwise it defaults to a standalone statement.
export async function recordLedgerEntry(
  { guildId, contractId = null, memberId = null, deltaGold, reason, note = null },
  runQuery = query
) {
  await runQuery(
    `INSERT INTO treasury_ledger (guild_id, contract_id, member_id, delta_gold, reason, note)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [guildId, contractId, memberId, deltaGold, reason, note]
  );
}

export async function getBalance(guildId) {
  const result = await query(
    `SELECT COALESCE(SUM(delta_gold), 0) AS balance FROM treasury_ledger WHERE guild_id = $1`,
    [guildId]
  );
  return Number(result.rows[0].balance);
}

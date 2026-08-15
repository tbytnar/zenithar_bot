import { query } from './db.js';
import { contractAutocompleteLabel } from './format.js';

export async function itemChoices(guildId, search) {
  const rows = await query(
    `SELECT id, name FROM items WHERE guild_id = $1 AND name ILIKE $2 ORDER BY name LIMIT 25`,
    [guildId, `%${search}%`]
  );
  return rows.rows.map((r) => ({ name: r.name, value: String(r.id) }));
}

// openOnly: true for commands that only make sense against a still-open
// contract (contribute, close); false for /payout, which also looks up
// closed contracts to show their final breakdown.
export async function contractChoices(guildId, search, { openOnly = false } = {}) {
  const statusClause = openOnly ? `AND status = 'open'` : '';
  const rows = await query(
    `SELECT id, name, created_at FROM contracts
     WHERE guild_id = $1 ${statusClause} AND name ILIKE $2
     ORDER BY created_at DESC LIMIT 25`,
    [guildId, `%${search}%`]
  );
  return rows.rows.map((r) => ({
    name: contractAutocompleteLabel(r.name, r.created_at),
    value: String(r.id),
  }));
}

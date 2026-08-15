import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const REQUIRED_ENV_VARS = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DATABASE_URL'];
for (const name of REQUIRED_ENV_VARS) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function query(text, params) {
  return pool.query(text, params);
}

// Runs `fn` inside a single transaction on a dedicated client, committing on
// success and rolling back if `fn` throws. `fn` receives that client and
// must use it (not the shared `query` above) for every statement that needs
// to be part of the transaction. Use this for any operation that touches
// more than one row/table where a partial failure would leave a guild's
// gold or inventory in an inconsistent state.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Ensures a guild_settings row exists so guild-scoped FKs (members, items,
// contracts, ...) always have something to reference, even for a guild the
// bot just joined and nobody has configured yet. Safe to call unconditionally.
export async function ensureGuild(guildId) {
  await query(`INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT DO NOTHING`, [guildId]);
}

// Ensures a member row exists / display_name is current for this guild.
// Call this whenever a Discord user interacts with the bot.
export async function upsertMember(guildId, user) {
  await query(
    `INSERT INTO members (id, guild_id, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id, guild_id) DO UPDATE SET display_name = $3, updated_at = now()`,
    [user.id, guildId, user.username]
  );
}

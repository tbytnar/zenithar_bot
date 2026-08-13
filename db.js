import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function query(text, params) {
  return pool.query(text, params);
}

// Ensures a member row exists / display_name is current.
// Call this whenever a Discord user interacts with the bot.
export async function upsertMember(user) {
  await query(
    `INSERT INTO members (id, display_name)
     VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET display_name = $2, updated_at = now()`,
    [user.id, user.username]
  );
}

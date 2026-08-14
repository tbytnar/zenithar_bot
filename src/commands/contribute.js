import { SlashCommandBuilder } from 'discord.js';
import { query, upsertMember } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('contribute')
  .setDescription('Log a contribution to a contract')
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Log an input')
      .addStringOption((opt) =>
        opt.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true)
      )
      .addNumberOption((opt) =>
        opt.setName('amount').setDescription('Quantity').setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('for')
          .setDescription('Which contract')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addUserOption((opt) =>
        opt.setName('credit').setDescription('Credit someone other than yourself')
      )
      .addStringOption((opt) => opt.setName('note').setDescription('Optional note'))
  )
  .addSubcommand((sub) =>
    sub.setName('undo').setDescription('Remove your most recent contribution')
  );

export async function execute(interaction) {
  await upsertMember(interaction.user);
  const sub = interaction.options.getSubcommand();

  if (sub === 'add') {
    const itemId = interaction.options.getString('item');
    const contractId = interaction.options.getString('for');
    const amount = interaction.options.getNumber('amount');
    const creditUser = interaction.options.getUser('credit') ?? interaction.user;
    const note = interaction.options.getString('note');

    if (creditUser.id !== interaction.user.id) {
      await upsertMember(creditUser);
    }

    await query(
      `INSERT INTO contributions (contract_id, item_id, quantity, author_id, credit_id, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [contractId, itemId, amount, interaction.user.id, creditUser.id, note]
    );

    await interaction.reply(
      `Logged **${amount}** for <@${creditUser.id}>.${note ? ` (${note})` : ''}`
    );
    return;
  }

  if (sub === 'undo') {
    const last = await query(
      `SELECT id, item_id, quantity FROM contributions
       WHERE author_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [interaction.user.id]
    );

    if (last.rows.length === 0) {
      await interaction.reply({ content: 'No contribution found to undo.', ephemeral: true });
      return;
    }

    await query(`DELETE FROM contributions WHERE id = $1`, [last.rows[0].id]);
    await interaction.reply({ content: 'Removed your last logged contribution.', ephemeral: true });
  }
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);

  if (focused.name === 'item') {
    const rows = await query(`SELECT id, name FROM items WHERE name ILIKE $1 LIMIT 25`, [
      `%${focused.value}%`,
    ]);
    await interaction.respond(rows.rows.map((r) => ({ name: r.name, value: String(r.id) })));
    return;
  }

  if (focused.name === 'for') {
    const rows = await query(
      `SELECT id, name FROM contracts WHERE status = 'open' AND name ILIKE $1
       ORDER BY created_at DESC LIMIT 25`,
      [`%${focused.value}%`]
    );
    await interaction.respond(rows.rows.map((r) => ({ name: r.name, value: String(r.id) })));
  }
}

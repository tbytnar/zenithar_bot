import { SlashCommandBuilder } from 'discord.js';
import { query, upsertMember } from '../db.js';
import { itemChoices, contractChoices, isValidId } from '../autocomplete.js';

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
        opt.setName('amount').setDescription('Quantity').setRequired(true).setMinValue(0)
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
  const guildId = interaction.guildId;
  await upsertMember(guildId, interaction.user);
  const sub = interaction.options.getSubcommand();

  if (sub === 'add') {
    const itemId = interaction.options.getString('item');
    const contractId = interaction.options.getString('for');
    const amount = interaction.options.getNumber('amount');
    const creditUser = interaction.options.getUser('credit') ?? interaction.user;
    const note = interaction.options.getString('note');

    if (amount <= 0) {
      await interaction.reply({ content: 'Amount must be greater than zero.', ephemeral: true });
      return;
    }

    if (!isValidId(itemId) || !isValidId(contractId)) {
      await interaction.reply({
        content: 'Pick both the item and the contract from the autocomplete suggestions rather than typing your own text.',
        ephemeral: true,
      });
      return;
    }

    if (creditUser.id !== interaction.user.id) {
      await upsertMember(guildId, creditUser);
    }

    await query(
      `INSERT INTO contributions (guild_id, contract_id, item_id, quantity, author_id, credit_id, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [guildId, contractId, itemId, amount, interaction.user.id, creditUser.id, note]
    );

    await interaction.reply(
      `Logged **${amount}** for <@${creditUser.id}>.${note ? ` (${note})` : ''}`
    );
    return;
  }

  if (sub === 'undo') {
    const last = await query(
      `SELECT id, item_id, quantity FROM contributions
       WHERE author_id = $1 AND guild_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [interaction.user.id, guildId]
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
  const guildId = interaction.guildId;
  const focused = interaction.options.getFocused(true);

  if (focused.name === 'item') {
    await interaction.respond(await itemChoices(guildId, focused.value));
    return;
  }

  if (focused.name === 'for') {
    await interaction.respond(await contractChoices(guildId, focused.value, { openOnly: true }));
  }
}

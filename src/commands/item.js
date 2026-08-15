import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { query, withTransaction } from '../db.js';
import { itemChoices, isValidId } from '../autocomplete.js';

export const data = new SlashCommandBuilder()
  .setName('item')
  .setDescription('Manage the item catalog')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('merge')
      .setDescription('Merge a duplicate item into another (e.g. fixing a typo)')
      .addStringOption((opt) =>
        opt
          .setName('from')
          .setDescription('Duplicate item to merge and remove')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((opt) =>
        opt.setName('into').setDescription('Item to keep').setRequired(true).setAutocomplete(true)
      )
  );

export async function execute(interaction) {
  const guildId = interaction.guildId;
  const sub = interaction.options.getSubcommand();
  if (sub !== 'merge') return;

  const fromId = interaction.options.getString('from');
  const intoId = interaction.options.getString('into');

  if (!isValidId(fromId) || !isValidId(intoId)) {
    await interaction.reply({
      content: 'Pick both items from the autocomplete suggestions rather than typing your own text.',
      ephemeral: true,
    });
    return;
  }

  if (fromId === intoId) {
    await interaction.reply({ content: 'Pick two different items.', ephemeral: true });
    return;
  }

  const items = await query(`SELECT id, name FROM items WHERE id IN ($1, $2) AND guild_id = $3`, [
    fromId,
    intoId,
    guildId,
  ]);
  if (items.rows.length !== 2) {
    await interaction.reply({ content: 'Could not find both items.', ephemeral: true });
    return;
  }
  const fromItem = items.rows.find((r) => String(r.id) === fromId);
  const intoItem = items.rows.find((r) => String(r.id) === intoId);

  await withTransaction(async (client) => {
    const run = client.query.bind(client);
    await run(`UPDATE contributions SET item_id = $1 WHERE item_id = $2 AND guild_id = $3`, [
      intoId,
      fromId,
      guildId,
    ]);
    await run(`UPDATE contracts SET target_item_id = $1 WHERE target_item_id = $2 AND guild_id = $3`, [
      intoId,
      fromId,
      guildId,
    ]);
    await run(`UPDATE inventory_lots SET item_id = $1 WHERE item_id = $2 AND guild_id = $3`, [
      intoId,
      fromId,
      guildId,
    ]);
    await run(`DELETE FROM items WHERE id = $1 AND guild_id = $2`, [fromId, guildId]);
  });

  await interaction.reply(`Merged **${fromItem.name}** into **${intoItem.name}**.`);
}

export async function autocomplete(interaction) {
  const guildId = interaction.guildId;
  const focused = interaction.options.getFocused();
  await interaction.respond(await itemChoices(guildId, focused));
}

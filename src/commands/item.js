import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { query, withTransaction } from '../db.js';
import { itemChoices, isValidId } from '../autocomplete.js';

const UNIQUE_VIOLATION = '23505';

export const data = new SlashCommandBuilder()
  .setName('item')
  .setDescription('Manage the item catalog')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Add a new item to the catalog (materials, or non-physical things like a service)')
      .addStringOption((opt) => opt.setName('name').setDescription('Item name').setRequired(true))
      .addNumberOption((opt) =>
        opt.setName('unit_value').setDescription('Relative value used in mixed-item splits (default 1)').setMinValue(0)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('edit')
      .setDescription('Rename an item or change its relative value')
      .addStringOption((opt) =>
        opt.setName('item').setDescription('Item to edit').setRequired(true).setAutocomplete(true)
      )
      .addStringOption((opt) => opt.setName('name').setDescription('New name'))
      .addNumberOption((opt) => opt.setName('unit_value').setDescription('New relative value').setMinValue(0))
  )
  .addSubcommand((sub) =>
    sub
      .setName('delete')
      .setDescription('Remove an item with no contract or inventory history')
      .addStringOption((opt) =>
        opt.setName('item').setDescription('Item to delete').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('List every item and its relative value'))
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

  if (sub === 'create') {
    const name = interaction.options.getString('name').trim();
    const unitValue = interaction.options.getNumber('unit_value') ?? 1;

    if (!name) {
      await interaction.reply({ content: 'Item name cannot be empty.', ephemeral: true });
      return;
    }

    try {
      await query(`INSERT INTO items (guild_id, name, unit_value) VALUES ($1, $2, $3)`, [
        guildId,
        name,
        unitValue,
      ]);
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) {
        await interaction.reply({ content: `An item named **${name}** already exists.`, ephemeral: true });
        return;
      }
      throw err;
    }

    await interaction.reply(`Created **${name}** (unit value ${unitValue}).`);
    return;
  }

  if (sub === 'edit') {
    const itemId = interaction.options.getString('item');
    const newName = interaction.options.getString('name')?.trim();
    const newUnitValue = interaction.options.getNumber('unit_value');

    if (!isValidId(itemId)) {
      await interaction.reply({
        content: 'Pick the item from the autocomplete suggestions rather than typing your own text.',
        ephemeral: true,
      });
      return;
    }

    if (newName === '') {
      await interaction.reply({ content: 'Item name cannot be empty.', ephemeral: true });
      return;
    }

    if (newName == null && newUnitValue == null) {
      await interaction.reply({ content: 'Provide a new name and/or a new unit value to change.', ephemeral: true });
      return;
    }

    try {
      const result = await query(
        `UPDATE items SET name = COALESCE($3, name), unit_value = COALESCE($4, unit_value)
         WHERE id = $1 AND guild_id = $2
         RETURNING name, unit_value`,
        [itemId, guildId, newName ?? null, newUnitValue ?? null]
      );

      if (result.rows.length === 0) {
        await interaction.reply({ content: 'Item not found.', ephemeral: true });
        return;
      }

      const updated = result.rows[0];
      await interaction.reply(`Updated **${updated.name}** (unit value ${Number(updated.unit_value)}).`);
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) {
        await interaction.reply({ content: `An item named **${newName}** already exists.`, ephemeral: true });
        return;
      }
      throw err;
    }
    return;
  }

  if (sub === 'delete') {
    const itemId = interaction.options.getString('item');

    if (!isValidId(itemId)) {
      await interaction.reply({
        content: 'Pick the item from the autocomplete suggestions rather than typing your own text.',
        ephemeral: true,
      });
      return;
    }

    const item = await query(`SELECT name FROM items WHERE id = $1 AND guild_id = $2`, [itemId, guildId]);
    if (item.rows.length === 0) {
      await interaction.reply({ content: 'Item not found.', ephemeral: true });
      return;
    }

    const inUse = await query(
      `SELECT
         EXISTS(SELECT 1 FROM contributions WHERE item_id = $1 AND guild_id = $2) AS has_contributions,
         EXISTS(SELECT 1 FROM contracts WHERE target_item_id = $1 AND guild_id = $2) AS has_contracts,
         EXISTS(SELECT 1 FROM inventory_lots WHERE item_id = $1 AND guild_id = $2) AS has_lots`,
      [itemId, guildId]
    );
    const { has_contributions, has_contracts, has_lots } = inUse.rows[0];

    if (has_contributions || has_contracts || has_lots) {
      await interaction.reply({
        content: `**${item.rows[0].name}** has contract or inventory history and can't be deleted — use \`/item merge\` to fold it into another item instead.`,
        ephemeral: true,
      });
      return;
    }

    await query(`DELETE FROM items WHERE id = $1 AND guild_id = $2`, [itemId, guildId]);
    await interaction.reply(`Deleted **${item.rows[0].name}**.`);
    return;
  }

  if (sub === 'list') {
    const rows = await query(`SELECT name, unit_value FROM items WHERE guild_id = $1 ORDER BY name`, [guildId]);

    if (rows.rows.length === 0) {
      await interaction.reply('No items in the catalog yet.');
      return;
    }

    const lines = rows.rows.map((r) => `${r.name}: ${Number(r.unit_value)}`);
    await interaction.reply(`**Item catalog** (${rows.rows.length})\n${lines.join('\n')}`);
    return;
  }

  if (sub === 'merge') {
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
}

export async function autocomplete(interaction) {
  const guildId = interaction.guildId;
  const focused = interaction.options.getFocused();
  await interaction.respond(await itemChoices(guildId, focused));
}

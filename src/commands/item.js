import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { query } from '../db.js';

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
  const sub = interaction.options.getSubcommand();
  if (sub !== 'merge') return;

  const fromId = interaction.options.getString('from');
  const intoId = interaction.options.getString('into');

  if (fromId === intoId) {
    await interaction.reply({ content: 'Pick two different items.', ephemeral: true });
    return;
  }

  const items = await query(`SELECT id, name FROM items WHERE id IN ($1, $2)`, [fromId, intoId]);
  if (items.rows.length !== 2) {
    await interaction.reply({ content: 'Could not find both items.', ephemeral: true });
    return;
  }
  const fromItem = items.rows.find((r) => String(r.id) === fromId);
  const intoItem = items.rows.find((r) => String(r.id) === intoId);

  await query(`UPDATE contributions SET item_id = $1 WHERE item_id = $2`, [intoId, fromId]);
  await query(`UPDATE contracts SET target_item_id = $1 WHERE target_item_id = $2`, [intoId, fromId]);
  await query(`UPDATE inventory_lots SET item_id = $1 WHERE item_id = $2`, [intoId, fromId]);

  await query(`DELETE FROM items WHERE id = $1`, [fromId]);

  await interaction.reply(`Merged **${fromItem.name}** into **${intoItem.name}**.`);
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const rows = await query(`SELECT id, name FROM items WHERE name ILIKE $1 ORDER BY name LIMIT 25`, [
    `%${focused}%`,
  ]);
  await interaction.respond(rows.rows.map((r) => ({ name: r.name, value: String(r.id) })));
}

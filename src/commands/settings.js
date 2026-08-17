import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getGuildSettings, updateGuildSettings } from '../guildSettings.js';

export const data = new SlashCommandBuilder()
  .setName('settings')
  .setDescription("Configure this server's bot settings")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) => sub.setName('view').setDescription('Show current settings'))
  .addSubcommand((sub) =>
    sub
      .setName('channels')
      .setDescription('Set the inventory, gold, and/or quests channels')
      .addChannelOption((opt) =>
        opt
          .setName('inventory')
          .setDescription('Channel where +/- item messages are tracked')
          .addChannelTypes(ChannelType.GuildText)
      )
      .addChannelOption((opt) =>
        opt
          .setName('gold')
          .setDescription('Channel where +/- gold messages are tracked (defaults to the inventory channel)')
          .addChannelTypes(ChannelType.GuildText)
      )
      .addChannelOption((opt) =>
        opt
          .setName('quests')
          .setDescription('Channel where new contracts (/contract create) get auto-posted')
          .addChannelTypes(ChannelType.GuildText)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('currency')
      .setDescription('Set the words the bot recognizes as gold, e.g. "gold septims"')
      .addStringOption((opt) =>
        opt
          .setName('words')
          .setDescription('Space-separated list of currency words')
          .setRequired(true)
      )
  );

export async function execute(interaction) {
  const guildId = interaction.guildId;
  const sub = interaction.options.getSubcommand();

  if (sub === 'view') {
    const settings = await getGuildSettings(guildId);
    const lines = [
      `Inventory channel: ${settings.inventory_channel_id ? `<#${settings.inventory_channel_id}>` : 'not set'}`,
      `Gold channel: ${settings.gold_channel_id ? `<#${settings.gold_channel_id}>` : '(same as inventory channel)'}`,
      `Quests channel: ${settings.quests_channel_id ? `<#${settings.quests_channel_id}>` : 'not set (new contracts are not auto-posted)'}`,
      `Currency words: ${settings.currency_words.join(', ')}`,
    ];
    await interaction.reply({ content: lines.join('\n'), ephemeral: true });
    return;
  }

  if (sub === 'channels') {
    const inventory = interaction.options.getChannel('inventory');
    const gold = interaction.options.getChannel('gold');
    const quests = interaction.options.getChannel('quests');
    if (!inventory && !gold && !quests) {
      await interaction.reply({ content: 'Provide at least one channel to update.', ephemeral: true });
      return;
    }
    await updateGuildSettings(guildId, {
      inventoryChannelId: inventory?.id,
      goldChannelId: gold?.id,
      questsChannelId: quests?.id,
    });
    await interaction.reply({
      content: `Updated.${inventory ? ` Inventory channel: <#${inventory.id}>.` : ''}${gold ? ` Gold channel: <#${gold.id}>.` : ''}${quests ? ` Quests channel: <#${quests.id}>.` : ''}`,
      ephemeral: true,
    });
    return;
  }

  if (sub === 'currency') {
    const words = interaction.options
      .getString('words')
      .split(/\s+/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);

    if (words.length === 0) {
      await interaction.reply({ content: 'Provide at least one word.', ephemeral: true });
      return;
    }

    await updateGuildSettings(guildId, { currencyWords: words });
    await interaction.reply({ content: `Currency words set to: ${words.join(', ')}`, ephemeral: true });
  }
}

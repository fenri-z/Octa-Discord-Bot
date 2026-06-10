const {
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const ApplicationCommand = require('../../structure/ApplicationCommand');
const { getLang, getStrings } = require('../../utils/BotLang');

module.exports = new ApplicationCommand({
    command: {
        name: 'purge',
        description: 'Bulk delete messages in a channel',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageMessages),
        options: [
            {
                type: 1,
                name: 'all',
                description: 'Delete a number of recent messages in the channel',
                options: [
                    { type: 4, name: 'amount', description: 'Number of messages to delete (1–100)', required: true, min_value: 1, max_value: 100 },
                ],
            },
            {
                type: 1,
                name: 'user',
                description: 'Delete messages from a specific user',
                options: [
                    { type: 6, name: 'user',   description: 'User whose messages to delete', required: true },
                    { type: 4, name: 'amount', description: 'Number of messages to search (1–100)', required: true, min_value: 1, max_value: 100 },
                ],
            },
            {
                type: 1,
                name: 'bots',
                description: 'Delete messages from bots only',
                options: [
                    { type: 4, name: 'amount', description: 'Number of messages to search (1–100)', required: true, min_value: 1, max_value: 100 },
                ],
            },
        ],
    },

    run: async (client, interaction) => {
        const strings = getStrings(getLang(client.database, interaction.guild?.id));
        const s       = strings.purge;
        const c       = strings.common;
        const sub     = interaction.options.getSubcommand();
        const channel = interaction.channel;

        const botPerms = channel.permissionsFor(interaction.guild.members.me);
        if (!botPerms.has(PermissionFlagsBits.ManageMessages) || !botPerms.has(PermissionFlagsBits.ReadMessageHistory)) {
            return interaction.reply({ content: s.no_perm, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const amount = interaction.options.getInteger('amount');
            let messages = await channel.messages.fetch({ limit: 100 });

            // Filter messages not older than 14 days (Discord bulk delete limit)
            const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
            messages = messages.filter(m => m.createdTimestamp > twoWeeksAgo);

            let toDelete;

            if (sub === 'all') {
                toDelete = [...messages.values()].slice(0, amount);
            } else if (sub === 'user') {
                const target = interaction.options.getUser('user');
                toDelete = [...messages.values()]
                    .filter(m => m.author.id === target.id)
                    .slice(0, amount);
            } else if (sub === 'bots') {
                toDelete = [...messages.values()]
                    .filter(m => m.author.bot)
                    .slice(0, amount);
            }

            if (!toDelete || toDelete.length === 0) {
                return interaction.editReply({ content: s.no_messages });
            }

            const deleted = await channel.bulkDelete(toDelete, true);

            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle(s.log_title)
                .addFields(
                    { name: s.field_deleted,   value: s.deleted_val(deleted.size), inline: true },
                    { name: c.field_channel,   value: `${channel}`,                inline: true },
                    { name: c.field_moderator, value: `${interaction.user}`,        inline: true },
                )
                .setTimestamp();

            if (sub === 'user') {
                embed.addFields({ name: s.field_target, value: `${interaction.options.getUser('user')}`, inline: true });
            }

            // Log to mod log channel if configured
            const logChId = client.database.get(`modlog-channel-${interaction.guild.id}`);
            if (logChId) {
                const logChannel = interaction.guild.channels.cache.get(logChId);
                if (logChannel?.isTextBased()) {
                    await logChannel.send({ embeds: [embed] }).catch(() => null);
                }
            }

            const target = sub === 'user' ? interaction.options.getUser('user') : null;
            const desc = sub === 'user'
                ? s.deleted_user(deleted.size, target.tag)
                : sub === 'bots'
                    ? s.deleted_bots(deleted.size)
                    : s.deleted(deleted.size);

            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor('#57F287').setDescription(desc)],
            });

        } catch (err) {
            console.error('[purge]', err);
            await interaction.editReply({ content: s.failed });
        }
    },
}).toJSON();

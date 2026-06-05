const {
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const ApplicationCommand = require('../../structure/ApplicationCommand');

module.exports = new ApplicationCommand({
    command: {
        name: 'purge',
        description: 'Hapus pesan massal di channel',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageMessages),
        options: [
            {
                type: 1,
                name: 'all',
                description: 'Hapus sejumlah pesan terakhir di channel',
                options: [
                    { type: 4, name: 'jumlah', description: 'Jumlah pesan yang dihapus (1–100)', required: true, min_value: 1, max_value: 100 },
                ],
            },
            {
                type: 1,
                name: 'user',
                description: 'Hapus pesan dari user tertentu',
                options: [
                    { type: 6, name: 'user', description: 'User yang pesannya dihapus', required: true },
                    { type: 4, name: 'jumlah', description: 'Jumlah pesan yang dicari (1–100)', required: true, min_value: 1, max_value: 100 },
                ],
            },
            {
                type: 1,
                name: 'bots',
                description: 'Hapus pesan dari bot saja',
                options: [
                    { type: 4, name: 'jumlah', description: 'Jumlah pesan yang dicari (1–100)', required: true, min_value: 1, max_value: 100 },
                ],
            },
        ],
    },

    run: async (client, interaction) => {
        const sub     = interaction.options.getSubcommand();
        const channel = interaction.channel;

        const botPerms = channel.permissionsFor(interaction.guild.members.me);
        if (!botPerms.has(PermissionFlagsBits.ManageMessages) || !botPerms.has(PermissionFlagsBits.ReadMessageHistory)) {
            return interaction.reply({
                content: '❌ Bot tidak punya permission **Manage Messages** atau **Read Message History** di channel ini.',
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const jumlah = interaction.options.getInteger('jumlah');
            let messages = await channel.messages.fetch({ limit: 100 });

            // Filter hanya pesan yang belum lebih dari 14 hari (Discord limit bulk delete)
            const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
            messages = messages.filter(m => m.createdTimestamp > twoWeeksAgo);

            let toDelete;

            if (sub === 'all') {
                toDelete = [...messages.values()].slice(0, jumlah);
            } else if (sub === 'user') {
                const target = interaction.options.getUser('user');
                toDelete = [...messages.values()]
                    .filter(m => m.author.id === target.id)
                    .slice(0, jumlah);
            } else if (sub === 'bots') {
                toDelete = [...messages.values()]
                    .filter(m => m.author.bot)
                    .slice(0, jumlah);
            }

            if (!toDelete || toDelete.length === 0) {
                return interaction.editReply({ content: '❌ Tidak ada pesan yang bisa dihapus (pesan mungkin sudah lebih dari 14 hari).' });
            }

            const deleted = await channel.bulkDelete(toDelete, true);

            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('🗑️ Purge Berhasil')
                .addFields(
                    { name: '📦 Dihapus', value: `**${deleted.size}** pesan`, inline: true },
                    { name: '📌 Channel', value: `${channel}`, inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`, inline: true },
                )
                .setTimestamp();

            if (sub === 'user') {
                embed.addFields({ name: '👤 Target', value: `${interaction.options.getUser('user')}`, inline: true });
            }

            // Log ke mod log jika dikonfigurasi
            const logChId = client.database.get(`modlog-channel-${interaction.guild.id}`);
            if (logChId) {
                const logChannel = interaction.guild.channels.cache.get(logChId);
                if (logChannel?.isTextBased()) {
                    await logChannel.send({ embeds: [embed] }).catch(() => null);
                }
            }

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setDescription(`✅ Berhasil menghapus **${deleted.size}** pesan.`)],
            });

        } catch (err) {
            console.error('[purge]', err);
            await interaction.editReply({ content: '❌ Gagal menghapus pesan. Cek permission bot.' });
        }
    },
}).toJSON();

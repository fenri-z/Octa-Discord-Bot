const {
    ButtonInteraction, PermissionFlagsBits, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");

function isStaff(member, guildId, client) {
    if (member.id === member.guild.ownerId) return true;
    const raw = client.database.get(`ticket-staff-roles-${guildId}`);
    let roles = [];
    try { roles = raw ? JSON.parse(raw) : []; } catch {}
    return roles.some(id => member.roles.cache.has(id));
}

module.exports = new Component({
    customId: 'ticket-delete',
    type: 'button',

    /**
     * @param {DiscordBot} client
     * @param {ButtonInteraction} interaction
     */
    run: async (client, interaction) => {
        const { guild, member, channel } = interaction;
        const guildId = guild.id;

        if (!isStaff(member, guildId, client)) {
            return interaction.reply({ content: '❌ Hanya staff yang bisa menghapus channel tiket.', flags: MessageFlags.Ephemeral });
        }

        const confirmEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('⚠️ Konfirmasi Hapus Channel')
            .setDescription('Channel tiket ini akan **dihapus permanen** dalam 5 detik.\nKlik **Batal** untuk membatalkan.');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket-delete-confirm')
                .setLabel('🗑️ Ya, Hapus')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('ticket-delete-cancel')
                .setLabel('✕ Batal')
                .setStyle(ButtonStyle.Secondary),
        );

        await interaction.reply({ embeds: [confirmEmbed], components: [row], flags: MessageFlags.Ephemeral });

        // Auto-delete channel jika tidak ada respon dalam 30 detik
        const collector = channel.createMessageComponentCollector({
            filter: i => i.user.id === member.id && ['ticket-delete-confirm', 'ticket-delete-cancel'].includes(i.customId),
            max: 1, time: 30_000
        });

        collector.on('collect', async i => {
            if (i.customId === 'ticket-delete-cancel') {
                await i.reply({ content: '✅ Penghapusan dibatalkan.', flags: MessageFlags.Ephemeral });
                return;
            }

            // Hapus data dari database
            const raw = client.database.get(`ticket-info-${guildId}-${channel.id}`);
            if (raw) {
                try {
                    const info = JSON.parse(raw);
                    client.database.delete(`ticket-user-${guildId}-${info.userId}`);
                } catch {}
                client.database.delete(`ticket-info-${guildId}-${channel.id}`);
            }

            await i.reply({ content: '🗑️ Menghapus channel...', flags: MessageFlags.Ephemeral }).catch(() => null);

            // Delay 3 detik lalu hapus
            setTimeout(async () => {
                await channel.delete(`Tiket dihapus oleh ${member.user.tag}`).catch(() => null);
            }, 3000);
        });
    }
}).toJSON();

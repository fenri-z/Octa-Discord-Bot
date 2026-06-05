const {
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const ApplicationCommand = require('../../structure/ApplicationCommand');

const DEFAULT_EVENTS = { ban: true, unban: true, kick: true, timeout: true, warn: true };

function getEvents(client, guildId) {
    const raw = client.database.get(`modlog-events-${guildId}`);
    if (!raw) return { ...DEFAULT_EVENTS };
    try { return { ...DEFAULT_EVENTS, ...JSON.parse(raw) }; } catch { return { ...DEFAULT_EVENTS }; }
}

module.exports = new ApplicationCommand({
    command: {
        name: 'modlog',
        description: 'Konfigurasi channel log aksi moderasi',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            {
                type: 1,
                name: 'set',
                description: 'Atur channel untuk mod log',
                options: [
                    { type: 7, name: 'channel', description: 'Channel teks untuk log', required: true },
                ],
            },
            {
                type: 1,
                name: 'disable',
                description: 'Nonaktifkan mod log',
            },
            {
                type: 1,
                name: 'test',
                description: 'Kirim embed percobaan ke channel mod log',
            },
        ],
    },

    run: async (client, interaction) => {
        const sub     = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (sub === 'set') {
            const channel = interaction.options.getChannel('channel');
            if (channel.type !== 0)
                return interaction.reply({ content: '❌ Pilih channel teks (bukan voice/category).', flags: MessageFlags.Ephemeral });

            client.database.set(`modlog-channel-${guildId}`, channel.id);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle('✅ Mod Log Dikonfigurasi')
                    .setDescription(`Semua aksi moderasi akan dicatat di ${channel}.\nGunakan \`/modlog test\` untuk memverifikasi.`)
                    .setTimestamp()],
                flags: MessageFlags.Ephemeral,
            });
        }

        if (sub === 'disable') {
            client.database.delete(`modlog-channel-${guildId}`);
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('❌ Mod Log Dinonaktifkan')
                    .setDescription('Pencatatan aksi moderasi telah dimatikan.')
                    .setTimestamp()],
                flags: MessageFlags.Ephemeral,
            });
        }

        if (sub === 'test') {
            const logChId = client.database.get(`modlog-channel-${guildId}`);
            if (!logChId)
                return interaction.reply({ content: '❌ Mod log belum dikonfigurasi. Gunakan `/modlog set` terlebih dahulu.', flags: MessageFlags.Ephemeral });

            const logChannel = interaction.guild.channels.cache.get(logChId);
            if (!logChannel?.isTextBased())
                return interaction.reply({ content: '❌ Channel log tidak ditemukan atau sudah dihapus.', flags: MessageFlags.Ephemeral });

            const events = getEvents(client, guildId);
            const eventList = Object.entries(events)
                .map(([k, v]) => `${v ? '✅' : '❌'} ${k}`)
                .join('\n');

            await logChannel.send({
                embeds: [new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle('🔔 Mod Log — Test')
                    .setDescription(`Mod log berjalan dengan baik di channel ini.\n\n**Event aktif:**\n${eventList}`)
                    .setFooter({ text: `Dikonfigurasi oleh ${interaction.user.tag}` })
                    .setTimestamp()],
            });

            return interaction.reply({ content: `✅ Test embed dikirim ke ${logChannel}.`, flags: MessageFlags.Ephemeral });
        }
    },
}).toJSON();

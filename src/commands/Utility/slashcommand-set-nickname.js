const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");

module.exports = new ApplicationCommand({
    command: {
        name: 'set-nickname',
        description: 'Ganti atau reset nickname bot di server ini.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageNicknames),
        options: [
            {
                name: 'nama',
                description: 'Nickname baru untuk bot (kosongkan untuk reset ke nama asli)',
                type: 3,
                required: false,
                max_length: 32
            }
        ]
    },

    options: { botOwner: false },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const { guild } = interaction;
        const nicknameBaru = interaction.options.getString('nama')?.trim() || null;

        // Ambil member bot di guild ini
        const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        if (!botMember) {
            return interaction.reply({
                content: '❌ Gagal mengambil data bot dari server. Coba lagi.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Cek apakah bot punya permission ChangeNickname (untuk dirinya sendiri)
        if (!botMember.permissions.has(PermissionFlagsBits.ChangeNickname)) {
            return interaction.reply({
                content: '❌ Bot tidak memiliki izin **Change Nickname** di server ini.',
                flags: MessageFlags.Ephemeral
            });
        }

        const nicknameLama = botMember.nickname ?? botMember.user.username;

        try {
            await botMember.setNickname(
                nicknameBaru,
                `Diubah oleh ${interaction.user.tag} via /set-nickname`
            );
        } catch (err) {
            // Bot tidak bisa mengubah nickname jika role-nya lebih rendah dari owner/admin tertinggi
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('❌ Gagal Mengubah Nickname')
                        .setDescription(
                            'Bot tidak bisa mengubah nickname-nya sendiri di server ini.\n\n' +
                            '**Kemungkinan penyebab:**\n' +
                            '• Role bot berada di bawah role Administrator/Owner\n' +
                            '• Server owner tidak bisa di-nickname oleh bot\n\n' +
                            `**Detail error:** \`${err.message}\``
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Berhasil
        const isReset = nicknameBaru === null;
        const namaSekarang = nicknameBaru ?? botMember.user.username;

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(isReset ? '#5865F2' : '#57F287')
                    .setTitle(isReset ? '🔄 Nickname Bot Direset' : '✏️ Nickname Bot Diubah')
                    .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
                    .addFields(
                        {
                            name: '📛 Sebelum',
                            value: `\`${nicknameLama}\``,
                            inline: true
                        },
                        {
                            name: isReset ? '🔄 Setelah (Reset)' : '✅ Setelah',
                            value: `\`${namaSekarang}\``,
                            inline: true
                        },
                        {
                            name: '👤 Diubah oleh',
                            value: `${interaction.user}`,
                            inline: false
                        }
                    )
                    .setFooter({ text: isReset ? 'Nickname berhasil direset ke nama asli bot.' : 'Gunakan /set-nickname tanpa mengisi nama untuk mereset.' })
                    .setTimestamp()
            ],
            flags: MessageFlags.Ephemeral
        });
    }
}).toJSON();

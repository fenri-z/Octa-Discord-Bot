const {
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const ApplicationCommand = require('../../structure/ApplicationCommand');

async function sendModLog(client, guild, embed) {
    const logChId = client.database.get(`modlog-channel-${guild.id}`);
    if (!logChId) return;
    const logChannel = guild.channels.cache.get(logChId);
    if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] }).catch(() => null);
}

module.exports = new ApplicationCommand({
    command: {
        name: 'ban',
        description: 'Ban atau unban member dari server',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.BanMembers),
        options: [
            {
                type: 1,
                name: 'member',
                description: 'Ban member dari server',
                options: [
                    { type: 6, name: 'user',       description: 'Member yang di-ban',             required: true },
                    { type: 3, name: 'alasan',      description: 'Alasan ban',                     required: false },
                    { type: 4, name: 'hapus_pesan', description: 'Hapus pesan N hari terakhir (0–7)', required: false, min_value: 0, max_value: 7 },
                ],
            },
            {
                type: 1,
                name: 'unban',
                description: 'Cabut ban member dari server',
                options: [
                    { type: 6, name: 'user',   description: 'User yang di-unban (mention atau ID)', required: true },
                    { type: 3, name: 'alasan', description: 'Alasan unban',                         required: false },
                ],
            },
        ],
    },

    run: async (client, interaction) => {
        const sub   = interaction.options.getSubcommand();
        const guild = interaction.guild;

        // ── Ban ─────────────────────────────────────────────────────────────────
        if (sub === 'member') {
            const target    = interaction.options.getUser('user');
            const alasan    = interaction.options.getString('alasan') || 'Tidak ada alasan';
            const hapusPesan = interaction.options.getInteger('hapus_pesan') ?? 0;

            const member = guild.members.cache.get(target.id);

            // Cek: tidak bisa ban diri sendiri
            if (target.id === interaction.user.id)
                return interaction.reply({ content: '❌ Kamu tidak bisa ban diri sendiri.', flags: MessageFlags.Ephemeral });

            // Cek: tidak bisa ban bot ini
            if (target.id === client.user.id)
                return interaction.reply({ content: '❌ Tidak bisa ban bot ini.', flags: MessageFlags.Ephemeral });

            // Cek hierarki role (hanya jika target masih di server)
            if (member) {
                const botHighest  = guild.members.me?.roles.highest.position ?? 0;
                const userHighest = interaction.member.roles.highest.position ?? 0;
                if (member.roles.highest.position >= botHighest)
                    return interaction.reply({ content: '❌ Role target lebih tinggi atau sama dengan role bot.', flags: MessageFlags.Ephemeral });
                if (member.roles.highest.position >= userHighest)
                    return interaction.reply({ content: '❌ Kamu tidak bisa ban member dengan role lebih tinggi atau sama denganmu.', flags: MessageFlags.Ephemeral });
            }

            // Kirim DM notifikasi ke target sebelum di-ban
            if (member) {
                await target.send({
                    embeds: [new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle(`🔨 Kamu telah di-ban dari ${guild.name}`)
                        .addFields(
                            { name: '📝 Alasan',     value: alasan },
                            { name: '🛡️ Moderator', value: interaction.user.tag },
                        )
                        .setTimestamp()],
                }).catch(() => null);
            }

            try {
                await guild.members.ban(target.id, { reason: `${interaction.user.tag}: ${alasan}`, deleteMessageSeconds: hapusPesan * 86400 });
            } catch {
                return interaction.reply({ content: '❌ Gagal ban member. Cek permission bot.', flags: MessageFlags.Ephemeral });
            }

            const embed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('🔨 Member Di-Ban')
                .setThumbnail(target.displayAvatarURL({ size: 64 }))
                .addFields(
                    { name: '👤 Member',        value: `${target} (${target.tag})`, inline: true },
                    { name: '🛡️ Moderator',    value: `${interaction.user}`,       inline: true },
                    { name: '🗑️ Hapus Pesan',  value: hapusPesan ? `${hapusPesan} hari` : 'Tidak', inline: true },
                    { name: '📝 Alasan',        value: alasan },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(`✅ **${target.tag}** berhasil di-ban.\n📝 Alasan: ${alasan}`)],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Unban ───────────────────────────────────────────────────────────────
        if (sub === 'unban') {
            const target = interaction.options.getUser('user');
            const alasan = interaction.options.getString('alasan') || 'Tidak ada alasan';

            let banInfo;
            try {
                banInfo = await guild.bans.fetch(target.id);
            } catch {
                return interaction.reply({ content: `❌ **${target.tag}** tidak ada dalam daftar ban.`, flags: MessageFlags.Ephemeral });
            }

            try {
                await guild.members.unban(target.id, `${interaction.user.tag}: ${alasan}`);
            } catch {
                return interaction.reply({ content: '❌ Gagal unban. Cek permission bot.', flags: MessageFlags.Ephemeral });
            }
            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('✅ Member Di-Unban')
                .setThumbnail(target.displayAvatarURL({ size: 64 }))
                .addFields(
                    { name: '👤 Member',     value: `${target.tag} (${target.id})`, inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`,          inline: true },
                    { name: '📝 Alasan',     value: alasan },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setDescription(`✅ **${target.tag}** berhasil di-unban.\n📝 Alasan: ${alasan}`)],
                flags: MessageFlags.Ephemeral,
            });
        }
    },
}).toJSON();

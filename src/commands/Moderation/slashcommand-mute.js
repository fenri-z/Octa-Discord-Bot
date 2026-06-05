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

function parseDuration(str) {
    const match = str.trim().match(/^(\d+)(s|m|h|d)$/i);
    if (!match) return null;
    const n = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    const map = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return n * map[unit];
}

function formatDuration(ms) {
    if (ms < 60_000)        return `${ms / 1_000} detik`;
    if (ms < 3_600_000)     return `${ms / 60_000} menit`;
    if (ms < 86_400_000)    return `${ms / 3_600_000} jam`;
    return `${ms / 86_400_000} hari`;
}

const MAX_TIMEOUT_MS = 28 * 86_400_000; // 28 hari — batas Discord

module.exports = new ApplicationCommand({
    command: {
        name: 'mute',
        description: 'Timeout atau cabut timeout member',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
        options: [
            {
                type: 1,
                name: 'member',
                description: 'Beri timeout pada member',
                options: [
                    { type: 6, name: 'user',    description: 'Member yang di-mute',                      required: true },
                    { type: 3, name: 'durasi',  description: 'Durasi timeout, contoh: 10m, 1h, 2d (maks 28d)', required: true },
                    { type: 3, name: 'alasan',  description: 'Alasan mute',                              required: false },
                ],
            },
            {
                type: 1,
                name: 'unmute',
                description: 'Cabut timeout member',
                options: [
                    { type: 6, name: 'user',   description: 'Member yang di-unmute', required: true },
                    { type: 3, name: 'alasan', description: 'Alasan unmute',         required: false },
                ],
            },
        ],
    },

    run: async (client, interaction) => {
        const sub   = interaction.options.getSubcommand();
        const guild = interaction.guild;

        // ── Mute ────────────────────────────────────────────────────────────────
        if (sub === 'member') {
            const target  = interaction.options.getUser('user');
            const durStr  = interaction.options.getString('durasi');
            const alasan  = interaction.options.getString('alasan') || 'Tidak ada alasan';

            const durationMs = parseDuration(durStr);
            if (!durationMs)
                return interaction.reply({
                    content: '❌ Format durasi tidak valid. Contoh: `30s`, `10m`, `2h`, `1d`.',
                    flags: MessageFlags.Ephemeral,
                });

            if (durationMs > MAX_TIMEOUT_MS)
                return interaction.reply({ content: '❌ Durasi maksimal timeout adalah **28 hari**.', flags: MessageFlags.Ephemeral });

            if (target.id === interaction.user.id)
                return interaction.reply({ content: '❌ Kamu tidak bisa mute diri sendiri.', flags: MessageFlags.Ephemeral });

            if (target.id === client.user.id)
                return interaction.reply({ content: '❌ Tidak bisa mute bot ini.', flags: MessageFlags.Ephemeral });

            const member = guild.members.cache.get(target.id);
            if (!member)
                return interaction.reply({ content: '❌ Member tidak ditemukan di server ini.', flags: MessageFlags.Ephemeral });

            if (!member.moderatable)
                return interaction.reply({ content: '❌ Bot tidak bisa timeout member ini (role terlalu tinggi).', flags: MessageFlags.Ephemeral });

            const userHighest = interaction.member.roles.highest.position ?? 0;
            if (member.roles.highest.position >= userHighest)
                return interaction.reply({ content: '❌ Kamu tidak bisa mute member dengan role lebih tinggi atau sama denganmu.', flags: MessageFlags.Ephemeral });

            const until = new Date(Date.now() + durationMs);

            try {
                await member.timeout(durationMs, `${interaction.user.tag}: ${alasan}`);
            } catch {
                return interaction.reply({ content: '❌ Gagal mute member. Cek permission bot.', flags: MessageFlags.Ephemeral });
            }

            // DM notifikasi
            await target.send({
                embeds: [new EmbedBuilder()
                    .setColor('#EB459E')
                    .setTitle(`🔇 Kamu telah di-mute di ${guild.name}`)
                    .addFields(
                        { name: '⏱️ Durasi',     value: formatDuration(durationMs) },
                        { name: '📅 Berakhir',    value: `<t:${Math.floor(until.getTime() / 1000)}:R>` },
                        { name: '📝 Alasan',      value: alasan },
                        { name: '🛡️ Moderator',  value: interaction.user.tag },
                    )
                    .setTimestamp()],
            }).catch(() => null);

            const embed = new EmbedBuilder()
                .setColor('#EB459E')
                .setTitle('🔇 Member Di-Mute')
                .setThumbnail(target.displayAvatarURL({ size: 64 }))
                .addFields(
                    { name: '👤 Member',     value: `${target} (${target.tag})`,                         inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`,                               inline: true },
                    { name: '⏱️ Durasi',    value: formatDuration(durationMs),                          inline: true },
                    { name: '📅 Berakhir',  value: `<t:${Math.floor(until.getTime() / 1000)}:R>`,       inline: true },
                    { name: '📝 Alasan',    value: alasan },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#EB459E')
                    .setDescription(`✅ **${target.tag}** berhasil di-mute selama **${formatDuration(durationMs)}**.\n📝 Alasan: ${alasan}`)],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Unmute ──────────────────────────────────────────────────────────────
        if (sub === 'unmute') {
            const target = interaction.options.getUser('user');
            const alasan = interaction.options.getString('alasan') || 'Tidak ada alasan';

            const member = guild.members.cache.get(target.id);
            if (!member)
                return interaction.reply({ content: '❌ Member tidak ditemukan di server ini.', flags: MessageFlags.Ephemeral });

            if (!member.communicationDisabledUntil || member.communicationDisabledUntil < new Date())
                return interaction.reply({ content: `❌ **${target.tag}** tidak sedang dalam kondisi mute.`, flags: MessageFlags.Ephemeral });

            try {
                await member.timeout(null, `${interaction.user.tag}: ${alasan}`);
            } catch {
                return interaction.reply({ content: '❌ Gagal unmute member. Cek permission bot.', flags: MessageFlags.Ephemeral });
            }

            // DM notifikasi
            await target.send({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle(`🔊 Mute kamu di ${guild.name} telah dicabut`)
                    .addFields(
                        { name: '📝 Alasan',     value: alasan },
                        { name: '🛡️ Moderator', value: interaction.user.tag },
                    )
                    .setTimestamp()],
            }).catch(() => null);

            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('🔊 Mute Member Dicabut')
                .setThumbnail(target.displayAvatarURL({ size: 64 }))
                .addFields(
                    { name: '👤 Member',     value: `${target} (${target.tag})`, inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`,       inline: true },
                    { name: '📝 Alasan',     value: alasan },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setDescription(`✅ Mute **${target.tag}** berhasil dicabut.\n📝 Alasan: ${alasan}`)],
                flags: MessageFlags.Ephemeral,
            });
        }
    },
}).toJSON();

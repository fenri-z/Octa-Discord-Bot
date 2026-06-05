const {
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const ApplicationCommand = require('../../structure/ApplicationCommand');

const MAX_SLOWMODE = 21600; // 6 jam — batas Discord

function parseDuration(str) {
    const s = str.trim();
    // Angka murni = detik
    if (/^\d+$/.test(s)) return parseInt(s);
    const match = s.match(/^(\d+)(s|m|h)$/i);
    if (!match) return null;
    const n    = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    const map  = { s: 1, m: 60, h: 3600 };
    return n * map[unit];
}

function formatSlowmode(seconds) {
    if (seconds === 0)    return 'Nonaktif';
    if (seconds < 60)     return `${seconds} detik`;
    if (seconds < 3600)   return `${seconds / 60} menit`;
    return `${seconds / 3600} jam`;
}

async function sendModLog(client, guild, embed) {
    const logChId = client.database.get(`modlog-channel-${guild.id}`);
    if (!logChId) return;
    const logChannel = guild.channels.cache.get(logChId);
    if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] }).catch(() => null);
}

module.exports = new ApplicationCommand({
    command: {
        name: 'slowmode',
        description: 'Atur cooldown pengiriman pesan di channel',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageChannels),
        options: [
            {
                type: 1,
                name: 'set',
                description: 'Aktifkan slowmode di channel',
                options: [
                    { type: 3, name: 'durasi',  description: 'Durasi cooldown, contoh: 10s, 1m, 1h (maks 6h)', required: true },
                    { type: 7, name: 'channel', description: 'Channel target (default: channel ini)',            required: false },
                ],
            },
            {
                type: 1,
                name: 'off',
                description: 'Matikan slowmode di channel',
                options: [
                    { type: 7, name: 'channel', description: 'Channel target (default: channel ini)', required: false },
                ],
            },
            {
                type: 1,
                name: 'status',
                description: 'Lihat slowmode saat ini di channel',
                options: [
                    { type: 7, name: 'channel', description: 'Channel target (default: channel ini)', required: false },
                ],
            },
        ],
    },

    run: async (client, interaction) => {
        const sub    = interaction.options.getSubcommand();
        const target = interaction.options.getChannel('channel') ?? interaction.channel;
        const guild  = interaction.guild;

        if (target.type !== 0 && target.type !== 5)
            return interaction.reply({ content: '❌ Hanya bisa mengatur slowmode di channel teks.', flags: MessageFlags.Ephemeral });

        const botPerms = target.permissionsFor(guild.members.me);
        if (!botPerms.has(PermissionFlagsBits.ManageChannels))
            return interaction.reply({ content: `❌ Bot tidak punya permission **Manage Channels** di ${target}.`, flags: MessageFlags.Ephemeral });

        // ── Status ───────────────────────────────────────────────────────────────
        if (sub === 'status') {
            const current = target.rateLimitPerUser ?? 0;
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor(current > 0 ? '#FEE75C' : '#57F287')
                    .setTitle('⏱️ Status Slowmode')
                    .addFields(
                        { name: '📌 Channel',  value: `${target}`,                    inline: true },
                        { name: '⏱️ Cooldown', value: formatSlowmode(current),        inline: true },
                    )
                    .setTimestamp()],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Off ──────────────────────────────────────────────────────────────────
        if (sub === 'off') {
            if ((target.rateLimitPerUser ?? 0) === 0)
                return interaction.reply({ content: `❌ ${target} tidak sedang dalam mode slowmode.`, flags: MessageFlags.Ephemeral });

            await target.setRateLimitPerUser(0, `Slowmode dimatikan oleh ${interaction.user.tag}`);

            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('⏱️ Slowmode Dimatikan')
                .addFields(
                    { name: '📌 Channel',    value: `${target}`,           inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`, inline: true },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setDescription(`✅ Slowmode di ${target} berhasil **dimatikan**.`)],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Set ──────────────────────────────────────────────────────────────────
        if (sub === 'set') {
            const durStr  = interaction.options.getString('durasi');
            const seconds = parseDuration(durStr);

            if (seconds === null || seconds < 1)
                return interaction.reply({
                    content: '❌ Format durasi tidak valid. Contoh: `10s`, `1m`, `2h`.',
                    flags: MessageFlags.Ephemeral,
                });

            if (seconds > MAX_SLOWMODE)
                return interaction.reply({ content: '❌ Durasi maksimal slowmode adalah **6 jam** (21600 detik).', flags: MessageFlags.Ephemeral });

            await target.setRateLimitPerUser(seconds, `Slowmode diatur oleh ${interaction.user.tag}`);

            const embed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('⏱️ Slowmode Diaktifkan')
                .addFields(
                    { name: '📌 Channel',    value: `${target}`,              inline: true },
                    { name: '⏱️ Cooldown',  value: formatSlowmode(seconds),  inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`,    inline: true },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#FEE75C')
                    .setDescription(`✅ Slowmode di ${target} diatur ke **${formatSlowmode(seconds)}**.`)],
                flags: MessageFlags.Ephemeral,
            });
        }
    },
}).toJSON();

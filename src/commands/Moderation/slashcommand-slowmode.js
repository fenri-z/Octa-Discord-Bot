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
    if (seconds === 0)    return 'Disabled';
    if (seconds < 60)     return `${seconds} second(s)`;
    if (seconds < 3600)   return `${seconds / 60} minute(s)`;
    return `${seconds / 3600} hour(s)`;
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
        description: 'Set the message cooldown in a channel',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageChannels),
        options: [
            {
                type: 1,
                name: 'set',
                description: 'Enable slowmode in a channel',
                options: [
                    { type: 3, name: 'duration', description: 'Cooldown duration, e.g. 10s, 1m, 1h (max 6h)', required: true },
                    { type: 7, name: 'channel',  description: 'Target channel (default: current channel)',      required: false },
                ],
            },
            {
                type: 1,
                name: 'off',
                description: 'Disable slowmode in a channel',
                options: [
                    { type: 7, name: 'channel', description: 'Target channel (default: current channel)', required: false },
                ],
            },
            {
                type: 1,
                name: 'status',
                description: 'Check the current slowmode in a channel',
                options: [
                    { type: 7, name: 'channel', description: 'Target channel (default: current channel)', required: false },
                ],
            },
        ],
    },

    run: async (client, interaction) => {
        const sub    = interaction.options.getSubcommand();
        const target = interaction.options.getChannel('channel') ?? interaction.channel;
        const guild  = interaction.guild;

        if (target.type !== 0 && target.type !== 5)
            return interaction.reply({ content: '❌ Slowmode can only be set in text channels.', flags: MessageFlags.Ephemeral });

        const botPerms = target.permissionsFor(guild.members.me);
        if (!botPerms.has(PermissionFlagsBits.ManageChannels))
            return interaction.reply({ content: `❌ Bot does not have **Manage Channels** permission in ${target}.`, flags: MessageFlags.Ephemeral });

        // ── Status ───────────────────────────────────────────────────────────────
        if (sub === 'status') {
            const current = target.rateLimitPerUser ?? 0;
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor(current > 0 ? '#FEE75C' : '#57F287')
                    .setTitle('⏱️ Slowmode Status')
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
                return interaction.reply({ content: `❌ ${target} does not currently have slowmode enabled.`, flags: MessageFlags.Ephemeral });

            await target.setRateLimitPerUser(0, `Slowmode disabled by ${interaction.user.tag}`);

            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('⏱️ Slowmode Disabled')
                .addFields(
                    { name: '📌 Channel',    value: `${target}`,           inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`, inline: true },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setDescription(`✅ Slowmode in ${target} has been **disabled**.`)],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Set ──────────────────────────────────────────────────────────────────
        if (sub === 'set') {
            const durStr  = interaction.options.getString('duration');
            const seconds = parseDuration(durStr);

            if (seconds === null || seconds < 1)
                return interaction.reply({
                    content: '❌ Invalid duration format. Examples: `10s`, `1m`, `2h`.',
                    flags: MessageFlags.Ephemeral,
                });

            if (seconds > MAX_SLOWMODE)
                return interaction.reply({ content: '❌ Maximum slowmode duration is **6 hours** (21600 seconds).', flags: MessageFlags.Ephemeral });

            await target.setRateLimitPerUser(seconds, `Slowmode set by ${interaction.user.tag}`);

            const embed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('⏱️ Slowmode Enabled')
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
                    .setDescription(`✅ Slowmode in ${target} set to **${formatSlowmode(seconds)}**.`)],
                flags: MessageFlags.Ephemeral,
            });
        }
    },
}).toJSON();

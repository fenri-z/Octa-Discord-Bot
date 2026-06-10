const {
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const ApplicationCommand = require('../../structure/ApplicationCommand');
const { getLang, getStrings } = require('../../utils/BotLang');

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

function formatSlowmode(seconds, s) {
    if (seconds === 0)    return s.fmt_disabled;
    if (seconds < 60)     return s.fmt_second(seconds);
    if (seconds < 3600)   return s.fmt_minute(seconds / 60);
    return s.fmt_hour(seconds / 3600);
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
        const strings = getStrings(getLang(client.database, interaction.guild?.id));
        const s       = strings.slowmode;
        const c       = strings.common;
        const sub     = interaction.options.getSubcommand();
        const target  = interaction.options.getChannel('channel') ?? interaction.channel;
        const guild   = interaction.guild;

        if (target.type !== 0 && target.type !== 5)
            return interaction.reply({ content: s.text_only, flags: MessageFlags.Ephemeral });

        const botPerms = target.permissionsFor(guild.members.me);
        if (!botPerms.has(PermissionFlagsBits.ManageChannels))
            return interaction.reply({ content: s.no_bot_perm(target), flags: MessageFlags.Ephemeral });

        // ── Status ───────────────────────────────────────────────────────────────
        if (sub === 'status') {
            const current = target.rateLimitPerUser ?? 0;
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor(current > 0 ? '#FEE75C' : '#57F287')
                    .setTitle(s.status_title)
                    .addFields(
                        { name: c.field_channel,  value: `${target}`,                    inline: true },
                        { name: s.field_cooldown, value: formatSlowmode(current, s),     inline: true },
                    )
                    .setTimestamp()],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Off ──────────────────────────────────────────────────────────────────
        if (sub === 'off') {
            if ((target.rateLimitPerUser ?? 0) === 0)
                return interaction.reply({ content: s.no_active(target), flags: MessageFlags.Ephemeral });

            await target.setRateLimitPerUser(0, `Slowmode disabled by ${interaction.user.tag}`);

            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle(s.disabled_title)
                .addFields(
                    { name: c.field_channel,   value: `${target}`,           inline: true },
                    { name: c.field_moderator, value: `${interaction.user}`, inline: true },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder().setColor('#57F287').setDescription(s.removed(target))],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Set ──────────────────────────────────────────────────────────────────
        if (sub === 'set') {
            const durStr  = interaction.options.getString('duration');
            const seconds = parseDuration(durStr);

            if (seconds === null || seconds < 1)
                return interaction.reply({ content: s.invalid_format, flags: MessageFlags.Ephemeral });

            if (seconds > MAX_SLOWMODE)
                return interaction.reply({ content: s.invalid(MAX_SLOWMODE), flags: MessageFlags.Ephemeral });

            await target.setRateLimitPerUser(seconds, `Slowmode set by ${interaction.user.tag}`);

            const embed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle(s.enabled_title)
                .addFields(
                    { name: c.field_channel,   value: `${target}`,                 inline: true },
                    { name: s.field_cooldown,  value: formatSlowmode(seconds, s),  inline: true },
                    { name: c.field_moderator, value: `${interaction.user}`,        inline: true },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder().setColor('#FEE75C').setDescription(s.set(formatSlowmode(seconds, s), target))],
                flags: MessageFlags.Ephemeral,
            });
        }
    },
}).toJSON();

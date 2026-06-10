const {
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const ApplicationCommand = require('../../structure/ApplicationCommand');
const { getLang, getStrings } = require('../../utils/BotLang');

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

function formatDuration(ms, s) {
    if (ms < 60_000)        return s.dur_second(ms / 1_000);
    if (ms < 3_600_000)     return s.dur_minute(ms / 60_000);
    if (ms < 86_400_000)    return s.dur_hour(ms / 3_600_000);
    return s.dur_day(ms / 86_400_000);
}

const MAX_TIMEOUT_MS = 28 * 86_400_000; // 28 hari — batas Discord

module.exports = new ApplicationCommand({
    command: {
        name: 'mute',
        description: 'Timeout or remove timeout from a member',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
        options: [
            {
                type: 1,
                name: 'member',
                description: 'Apply a timeout to a member',
                options: [
                    { type: 6, name: 'user',     description: 'Member to mute',                              required: true },
                    { type: 3, name: 'duration', description: 'Timeout duration, e.g. 10m, 1h, 2d (max 28d)', required: true },
                    { type: 3, name: 'reason',   description: 'Reason for the mute',                         required: false },
                ],
            },
            {
                type: 1,
                name: 'unmute',
                description: 'Remove timeout from a member',
                options: [
                    { type: 6, name: 'user',   description: 'Member to unmute',         required: true },
                    { type: 3, name: 'reason', description: 'Reason for the unmute',    required: false },
                ],
            },
        ],
    },

    run: async (client, interaction) => {
        const strings = getStrings(getLang(client.database, interaction.guild?.id));
        const s       = strings.mute;
        const c       = strings.common;
        const sub     = interaction.options.getSubcommand();
        const guild   = interaction.guild;

        // ── Mute ────────────────────────────────────────────────────────────────
        if (sub === 'member') {
            const target  = interaction.options.getUser('user');
            const durStr  = interaction.options.getString('duration');
            const alasan  = interaction.options.getString('reason') || c.no_reason;

            const durationMs = parseDuration(durStr);
            if (!durationMs)
                return interaction.reply({ content: s.invalid_format, flags: MessageFlags.Ephemeral });

            if (durationMs > MAX_TIMEOUT_MS)
                return interaction.reply({ content: s.max_duration, flags: MessageFlags.Ephemeral });

            if (target.id === interaction.user.id)
                return interaction.reply({ content: s.cannot_self, flags: MessageFlags.Ephemeral });

            if (target.id === client.user.id)
                return interaction.reply({ content: s.cannot_bot, flags: MessageFlags.Ephemeral });

            const member = guild.members.cache.get(target.id);
            if (!member)
                return interaction.reply({ content: s.member_not_found, flags: MessageFlags.Ephemeral });

            if (!member.moderatable)
                return interaction.reply({ content: s.role_too_high_bot, flags: MessageFlags.Ephemeral });

            const userHighest = interaction.member.roles.highest.position ?? 0;
            if (member.roles.highest.position >= userHighest)
                return interaction.reply({ content: s.role_too_high_user, flags: MessageFlags.Ephemeral });

            const until = new Date(Date.now() + durationMs);

            try {
                await member.timeout(durationMs, `${interaction.user.tag}: ${alasan}`);
            } catch {
                return interaction.reply({ content: s.failed, flags: MessageFlags.Ephemeral });
            }

            // DM notification
            await target.send({
                embeds: [new EmbedBuilder()
                    .setColor('#EB459E')
                    .setTitle(s.dm_muted_title(guild.name))
                    .addFields(
                        { name: s.dm_field_duration, value: formatDuration(durationMs, s) },
                        { name: s.dm_field_expires,  value: `<t:${Math.floor(until.getTime() / 1000)}:R>` },
                        { name: s.dm_field_reason,   value: alasan },
                        { name: s.dm_field_mod,      value: interaction.user.tag },
                    )
                    .setTimestamp()],
            }).catch(() => null);

            const embed = new EmbedBuilder()
                .setColor('#EB459E')
                .setTitle(s.muted_title)
                .setThumbnail(target.displayAvatarURL({ size: 64 }))
                .addFields(
                    { name: c.field_member,     value: `${target} (${target.tag})`,                   inline: true },
                    { name: c.field_moderator,  value: `${interaction.user}`,                         inline: true },
                    { name: s.field_duration,   value: formatDuration(durationMs, s),                 inline: true },
                    { name: s.field_expires,    value: `<t:${Math.floor(until.getTime() / 1000)}:R>`, inline: true },
                    { name: s.field_reason,     value: alasan },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#EB459E')
                    .setDescription(`${s.muted_desc(target.tag)}\n${s.field_reason}: ${alasan}`)],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Unmute ──────────────────────────────────────────────────────────────
        if (sub === 'unmute') {
            const target = interaction.options.getUser('user');
            const alasan = interaction.options.getString('reason') || c.no_reason;

            const member = guild.members.cache.get(target.id);
            if (!member)
                return interaction.reply({ content: s.member_not_found, flags: MessageFlags.Ephemeral });

            if (!member.communicationDisabledUntil || member.communicationDisabledUntil < new Date())
                return interaction.reply({ content: s.not_muted, flags: MessageFlags.Ephemeral });

            try {
                await member.timeout(null, `${interaction.user.tag}: ${alasan}`);
            } catch {
                return interaction.reply({ content: s.unmute_failed, flags: MessageFlags.Ephemeral });
            }

            // DM notification
            await target.send({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle(s.dm_unmuted_title(guild.name))
                    .addFields(
                        { name: s.dm_field_reason, value: alasan },
                        { name: s.dm_field_mod,    value: interaction.user.tag },
                    )
                    .setTimestamp()],
            }).catch(() => null);

            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle(s.unmuted_title)
                .setThumbnail(target.displayAvatarURL({ size: 64 }))
                .addFields(
                    { name: c.field_member,    value: `${target} (${target.tag})`, inline: true },
                    { name: c.field_moderator, value: `${interaction.user}`,      inline: true },
                    { name: s.field_reason, value: alasan },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setDescription(`${s.unmuted_desc(target.tag)}\n${s.field_reason}: ${alasan}`)],
                flags: MessageFlags.Ephemeral,
            });
        }
    },
}).toJSON();

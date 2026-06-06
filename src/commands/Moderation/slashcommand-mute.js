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
    if (ms < 60_000)        return `${ms / 1_000} second(s)`;
    if (ms < 3_600_000)     return `${ms / 60_000} minute(s)`;
    if (ms < 86_400_000)    return `${ms / 3_600_000} hour(s)`;
    return `${ms / 86_400_000} day(s)`;
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
        const sub   = interaction.options.getSubcommand();
        const guild = interaction.guild;

        // ── Mute ────────────────────────────────────────────────────────────────
        if (sub === 'member') {
            const target  = interaction.options.getUser('user');
            const durStr  = interaction.options.getString('duration');
            const alasan  = interaction.options.getString('reason') || 'No reason provided';

            const durationMs = parseDuration(durStr);
            if (!durationMs)
                return interaction.reply({
                    content: '❌ Invalid duration format. Examples: `30s`, `10m`, `2h`, `1d`.',
                    flags: MessageFlags.Ephemeral,
                });

            if (durationMs > MAX_TIMEOUT_MS)
                return interaction.reply({ content: '❌ Maximum timeout duration is **28 days**.', flags: MessageFlags.Ephemeral });

            if (target.id === interaction.user.id)
                return interaction.reply({ content: '❌ You cannot mute yourself.', flags: MessageFlags.Ephemeral });

            if (target.id === client.user.id)
                return interaction.reply({ content: '❌ Cannot mute this bot.', flags: MessageFlags.Ephemeral });

            const member = guild.members.cache.get(target.id);
            if (!member)
                return interaction.reply({ content: '❌ Member not found in this server.', flags: MessageFlags.Ephemeral });

            if (!member.moderatable)
                return interaction.reply({ content: '❌ Bot cannot timeout this member (role too high).', flags: MessageFlags.Ephemeral });

            const userHighest = interaction.member.roles.highest.position ?? 0;
            if (member.roles.highest.position >= userHighest)
                return interaction.reply({ content: '❌ You cannot mute a member with a higher or equal role than yours.', flags: MessageFlags.Ephemeral });

            const until = new Date(Date.now() + durationMs);

            try {
                await member.timeout(durationMs, `${interaction.user.tag}: ${alasan}`);
            } catch {
                return interaction.reply({ content: '❌ Failed to mute member. Check bot permissions.', flags: MessageFlags.Ephemeral });
            }

            // DM notification
            await target.send({
                embeds: [new EmbedBuilder()
                    .setColor('#EB459E')
                    .setTitle(`🔇 You have been muted in ${guild.name}`)
                    .addFields(
                        { name: '⏱️ Duration',   value: formatDuration(durationMs) },
                        { name: '📅 Expires',    value: `<t:${Math.floor(until.getTime() / 1000)}:R>` },
                        { name: '📝 Reason',     value: alasan },
                        { name: '🛡️ Moderator', value: interaction.user.tag },
                    )
                    .setTimestamp()],
            }).catch(() => null);

            const embed = new EmbedBuilder()
                .setColor('#EB459E')
                .setTitle('🔇 Member Muted')
                .setThumbnail(target.displayAvatarURL({ size: 64 }))
                .addFields(
                    { name: '👤 Member',     value: `${target} (${target.tag})`,                         inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`,                               inline: true },
                    { name: '⏱️ Duration',  value: formatDuration(durationMs),                          inline: true },
                    { name: '📅 Expires',   value: `<t:${Math.floor(until.getTime() / 1000)}:R>`,       inline: true },
                    { name: '📝 Reason',    value: alasan },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#EB459E')
                    .setDescription(`✅ **${target.tag}** has been muted for **${formatDuration(durationMs)}**.\n📝 Reason: ${alasan}`)],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Unmute ──────────────────────────────────────────────────────────────
        if (sub === 'unmute') {
            const target = interaction.options.getUser('user');
            const alasan = interaction.options.getString('reason') || 'No reason provided';

            const member = guild.members.cache.get(target.id);
            if (!member)
                return interaction.reply({ content: '❌ Member not found in this server.', flags: MessageFlags.Ephemeral });

            if (!member.communicationDisabledUntil || member.communicationDisabledUntil < new Date())
                return interaction.reply({ content: `❌ **${target.tag}** is not currently muted.`, flags: MessageFlags.Ephemeral });

            try {
                await member.timeout(null, `${interaction.user.tag}: ${alasan}`);
            } catch {
                return interaction.reply({ content: '❌ Failed to unmute member. Check bot permissions.', flags: MessageFlags.Ephemeral });
            }

            // DM notification
            await target.send({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle(`🔊 Your mute in ${guild.name} has been removed`)
                    .addFields(
                        { name: '📝 Reason',     value: alasan },
                        { name: '🛡️ Moderator', value: interaction.user.tag },
                    )
                    .setTimestamp()],
            }).catch(() => null);

            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('🔊 Member Unmuted')
                .setThumbnail(target.displayAvatarURL({ size: 64 }))
                .addFields(
                    { name: '👤 Member',     value: `${target} (${target.tag})`, inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`,       inline: true },
                    { name: '📝 Reason',     value: alasan },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setDescription(`✅ **${target.tag}** has been unmuted.\n📝 Reason: ${alasan}`)],
                flags: MessageFlags.Ephemeral,
            });
        }
    },
}).toJSON();

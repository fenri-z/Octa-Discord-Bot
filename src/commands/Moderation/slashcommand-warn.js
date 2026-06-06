const {
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const ApplicationCommand = require('../../structure/ApplicationCommand');

function getWarns(client, guildId, userId) {
    const raw = client.database.get(`warn-${guildId}-${userId}`);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
}

function setWarns(client, guildId, userId, warns) {
    if (warns.length === 0) {
        client.database.delete(`warn-${guildId}-${userId}`);
    } else {
        client.database.set(`warn-${guildId}-${userId}`, JSON.stringify(warns));
    }
}

function getWarnConfig(client, guildId) {
    const raw = client.database.get(`warn-config-${guildId}`);
    if (!raw) return { thresholds: [] };
    try { return JSON.parse(raw); } catch { return { thresholds: [] }; }
}

function pushWarnLog(client, guildId, entry) {
    const raw = client.database.get(`warn-log-${guildId}`);
    const log = raw ? JSON.parse(raw) : [];
    log.unshift(entry);
    if (log.length > 50) log.length = 50;
    client.database.set(`warn-log-${guildId}`, JSON.stringify(log));
}

function formatDuration(ms) {
    if (ms >= 3_600_000) return `${ms / 3_600_000} hour(s)`;
    if (ms >= 60_000)    return `${ms / 60_000} minute(s)`;
    return `${ms / 1_000} second(s)`;
}

async function applyThresholdAction(guild, member, warnCount, config) {
    const matched = config.thresholds.find(t => t.count === warnCount);
    if (!matched || matched.action === 'none') return null;

    const botMember = guild.members.me;

    switch (matched.action) {
        case 'mute': {
            if (!botMember?.permissions.has(PermissionFlagsBits.ModerateMembers)) return null;
            const dur = matched.duration ?? 600_000;
            await member.timeout(dur, `Warn threshold: ${warnCount} warnings`).catch(() => null);
            await member.user.send({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('🔇 You have been Timed Out')
                    .setDescription(
                        `You were timed out in **${guild.name}** for **${formatDuration(dur)}**\n` +
                        `for reaching **${warnCount} warnings**.`
                    )
                    .setTimestamp()]
            }).catch(() => null);
            return `🔇 Timeout ${formatDuration(dur)}`;
        }
        case 'kick': {
            if (!botMember?.permissions.has(PermissionFlagsBits.KickMembers)) return null;
            await member.user.send({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('👢 You have been Kicked')
                    .setDescription(`You were kicked from **${guild.name}** for reaching **${warnCount} warnings**.`)
                    .setTimestamp()]
            }).catch(() => null);
            await member.kick(`Warn threshold: ${warnCount} warnings`).catch(() => null);
            return '👢 Kick';
        }
        case 'ban': {
            if (!botMember?.permissions.has(PermissionFlagsBits.BanMembers)) return null;
            await member.user.send({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('🔨 You have been Banned')
                    .setDescription(`You were banned from **${guild.name}** for reaching **${warnCount} warnings**.`)
                    .setTimestamp()]
            }).catch(() => null);
            await member.ban({ reason: `Warn threshold: ${warnCount} warnings` }).catch(() => null);
            return '🔨 Ban';
        }
    }
    return null;
}

module.exports = new ApplicationCommand({
    command: {
        name: 'warn',
        description: 'Member warning system',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
        options: [
            {
                type: 1,
                name: 'add',
                description: 'Add a warning to a member',
                options: [
                    { type: 6, name: 'member', description: 'Member to warn',            required: true },
                    { type: 3, name: 'reason', description: 'Reason for the warning',    required: false },
                ],
            },
            {
                type: 1,
                name: 'remove',
                description: 'Remove a single warning by ID',
                options: [
                    { type: 6, name: 'member', description: 'Target member',             required: true },
                    { type: 3, name: 'id',     description: 'Warning ID (see /warn list)', required: true },
                ],
            },
            {
                type: 1,
                name: 'clear',
                description: 'Clear all warnings from a member',
                options: [
                    { type: 6, name: 'member', description: 'Target member', required: true },
                ],
            },
            {
                type: 1,
                name: 'list',
                description: 'View the warning list of a member',
                options: [
                    { type: 6, name: 'member', description: 'Target member', required: true },
                ],
            },
        ],
    },

    run: async (client, interaction) => {
        const sub     = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        // ── /warn add ──────────────────────────────────────────────────────────
        if (sub === 'add') {
            const target = interaction.options.getMember('member');
            const alasan = interaction.options.getString('reason') || 'No reason provided';

            if (!target)
                return interaction.reply({ content: '❌ Member not found.', flags: MessageFlags.Ephemeral });
            if (target.id === interaction.user.id)
                return interaction.reply({ content: '❌ You cannot warn yourself.', flags: MessageFlags.Ephemeral });
            if (target.permissions.has(PermissionFlagsBits.Administrator))
                return interaction.reply({ content: '❌ Cannot warn an Administrator.', flags: MessageFlags.Ephemeral });

            const warns  = getWarns(client, guildId, target.id);
            const warnId = Date.now().toString(36).toUpperCase();
            const entry  = {
                id:           warnId,
                reason:       alasan,
                targetId:     target.id,
                targetTag:    target.user.tag,
                moderatorId:  interaction.user.id,
                moderatorTag: interaction.user.tag,
                timestamp:    Date.now(),
            };
            warns.push(entry);
            setWarns(client, guildId, target.id, warns);
            pushWarnLog(client, guildId, entry);

            // DM member
            await target.user.send({
                embeds: [new EmbedBuilder()
                    .setColor('#FEE75C')
                    .setTitle('⚠️ You Have Received a Warning')
                    .setDescription(
                        `You received a warning in **${interaction.guild.name}**.\n` +
                        `**Reason:** ${alasan}\n**Total warnings:** ${warns.length}`
                    )
                    .setTimestamp()]
            }).catch(() => null);

            // Check automatic threshold
            const config     = getWarnConfig(client, guildId);
            const actionDone = await applyThresholdAction(interaction.guild, target, warns.length, config);

            const embed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('⚠️ Warning Issued')
                .addFields(
                    { name: '👤 Member',     value: `${target} (${target.user.tag})`, inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`,            inline: true },
                    { name: '📊 Total',      value: `${warns.length} warning(s)`,     inline: true },
                    { name: '📝 Reason',     value: alasan },
                    { name: '🔖 Warn ID',    value: `\`${warnId}\`` },
                )
                .setTimestamp();

            if (actionDone) embed.addFields({ name: '⚡ Automatic Action', value: actionDone });

            // Kirim ke mod log channel jika dikonfigurasi
            const logChId = client.database.get(`modlog-channel-${guildId}`);
            if (logChId) {
                const logCh = interaction.guild.channels.cache.get(logChId);
                if (logCh?.isTextBased()) await logCh.send({ embeds: [embed] }).catch(() => null);
            }

            return interaction.reply({ embeds: [embed] });
        }

        // ── /warn remove ───────────────────────────────────────────────────────
        if (sub === 'remove') {
            const target = interaction.options.getMember('member');
            const warnId = interaction.options.getString('id').toUpperCase();

            if (!target)
                return interaction.reply({ content: '❌ Member not found.', flags: MessageFlags.Ephemeral });

            const warns = getWarns(client, guildId, target.id);
            const idx   = warns.findIndex(w => w.id === warnId);
            if (idx === -1)
                return interaction.reply({ content: `❌ Warning \`${warnId}\` not found.`, flags: MessageFlags.Ephemeral });

            warns.splice(idx, 1);
            setWarns(client, guildId, target.id, warns);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle('✅ Warning Removed')
                    .setDescription(`Warning \`${warnId}\` from ${target} has been removed.\nRemaining warnings: **${warns.length}**`)
                    .setTimestamp()]
            });
        }

        // ── /warn clear ────────────────────────────────────────────────────────
        if (sub === 'clear') {
            const target = interaction.options.getMember('member');
            if (!target)
                return interaction.reply({ content: '❌ Member not found.', flags: MessageFlags.Ephemeral });

            const warns = getWarns(client, guildId, target.id);
            if (warns.length === 0)
                return interaction.reply({ content: `${target} has no warnings.`, flags: MessageFlags.Ephemeral });

            client.database.delete(`warn-${guildId}-${target.id}`);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle('✅ All Warnings Cleared')
                    .setDescription(`All **${warns.length}** warning(s) from ${target} have been cleared.`)
                    .setTimestamp()]
            });
        }

        // ── /warn list ─────────────────────────────────────────────────────────
        if (sub === 'list') {
            const target = interaction.options.getMember('member');
            if (!target)
                return interaction.reply({ content: '❌ Member not found.', flags: MessageFlags.Ephemeral });

            const warns = getWarns(client, guildId, target.id);

            if (warns.length === 0) {
                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('📋 Warning List')
                        .setDescription(`${target} has no warnings. ✅`)
                        .setTimestamp()],
                    flags: MessageFlags.Ephemeral,
                });
            }

            const list = warns.slice(-10).reverse().map((w, i) => {
                const date = new Date(w.timestamp).toLocaleDateString('en-US', {
                    day: '2-digit', month: 'short', year: 'numeric',
                });
                return `**${i + 1}.** \`${w.id}\` — ${w.reason}\n↳ by <@${w.moderatorId}> • ${date}`;
            }).join('\n\n');

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#FEE75C')
                    .setTitle(`⚠️ Warnings — ${target.user.tag}`)
                    .setDescription(list)
                    .setFooter({ text: `Total: ${warns.length} warning(s)${warns.length > 10 ? ' (10 most recent)' : ''}` })
                    .setTimestamp()],
                flags: MessageFlags.Ephemeral,
            });
        }
    },
}).toJSON();

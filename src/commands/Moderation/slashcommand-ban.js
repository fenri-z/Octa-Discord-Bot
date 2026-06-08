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

module.exports = new ApplicationCommand({
    command: {
        name: 'ban',
        description: 'Ban or unban a member from the server',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.BanMembers),
        options: [
            {
                type: 1,
                name: 'member',
                description: 'Ban a member from the server',
                options: [
                    { type: 6, name: 'user',            description: 'Member to ban',                          required: true },
                    { type: 3, name: 'reason',          description: 'Reason for the ban',                      required: false },
                    { type: 4, name: 'delete_messages', description: 'Delete last N days of messages (0–7)',    required: false, min_value: 0, max_value: 7 },
                ],
            },
            {
                type: 1,
                name: 'unban',
                description: 'Unban a member from the server',
                options: [
                    { type: 6, name: 'user',   description: 'User to unban (mention or ID)', required: true },
                    { type: 3, name: 'reason', description: 'Reason for the unban',          required: false },
                ],
            },
        ],
    },

    run: async (client, interaction) => {
        const s     = getStrings(getLang(client.database, interaction.guild?.id)).ban;
        const sub   = interaction.options.getSubcommand();
        const guild = interaction.guild;

        if (!guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers))
            return interaction.reply({ content: s.no_permission, flags: MessageFlags.Ephemeral });

        // ── Ban ─────────────────────────────────────────────────────────────────
        if (sub === 'member') {
            const target    = interaction.options.getUser('user');
            const alasan    = interaction.options.getString('reason') || 'No reason provided';
            const hapusPesan = interaction.options.getInteger('delete_messages') ?? 0;

            const member = guild.members.cache.get(target.id);

            if (target.id === interaction.user.id)
                return interaction.reply({ content: s.cannot_self, flags: MessageFlags.Ephemeral });

            if (target.id === client.user.id)
                return interaction.reply({ content: s.cannot_bot, flags: MessageFlags.Ephemeral });

            if (member) {
                const botHighest  = guild.members.me?.roles.highest.position ?? 0;
                const userHighest = interaction.member.roles.highest.position ?? 0;
                if (member.roles.highest.position >= botHighest)
                    return interaction.reply({ content: s.role_too_high_bot, flags: MessageFlags.Ephemeral });
                if (member.roles.highest.position >= userHighest)
                    return interaction.reply({ content: s.role_too_high_user, flags: MessageFlags.Ephemeral });
            }

            if (member) {
                await target.send({
                    embeds: [new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle(s.dm_title(guild.name))
                        .addFields(
                            { name: s.dm_field_reason, value: alasan },
                            { name: s.dm_field_mod,    value: interaction.user.tag },
                        )
                        .setTimestamp()],
                }).catch(() => null);
            }

            try {
                await guild.members.ban(target.id, { reason: `${interaction.user.tag}: ${alasan}`, deleteMessageSeconds: hapusPesan * 86400 });
            } catch {
                return interaction.reply({ content: s.failed, flags: MessageFlags.Ephemeral });
            }

            const embed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle(s.banned_title)
                .setThumbnail(target.displayAvatarURL({ size: 64 }))
                .addFields(
                    { name: '👤 Member',           value: `${target} (${target.tag})`, inline: true },
                    { name: '🛡️ Moderator',       value: `${interaction.user}`,       inline: true },
                    { name: s.field_delete_msg,    value: hapusPesan ? `${hapusPesan} day(s)` : 'No', inline: true },
                    { name: s.field_reason,        value: alasan },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(`${s.banned_desc(target.tag)}\n${s.field_reason}: ${alasan}`)],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Unban ───────────────────────────────────────────────────────────────
        if (sub === 'unban') {
            const target = interaction.options.getUser('user');
            const alasan = interaction.options.getString('reason') || 'No reason provided';

            try {
                await guild.bans.fetch(target.id);
            } catch (err) {
                const msg = err?.code === 10026 ? s.not_banned(target.tag) : s.unban_failed;
                return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
            }

            try {
                await guild.members.unban(target.id, `${interaction.user.tag}: ${alasan}`);
            } catch {
                return interaction.reply({ content: s.unban_failed, flags: MessageFlags.Ephemeral });
            }
            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle(s.unbanned_title)
                .setThumbnail(target.displayAvatarURL({ size: 64 }))
                .addFields(
                    { name: '👤 Member',     value: `${target.tag} (${target.id})`, inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`,          inline: true },
                    { name: s.field_reason,  value: alasan },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setDescription(`${s.unbanned_desc(target.tag)}\n${s.field_reason}: ${alasan}`)],
                flags: MessageFlags.Ephemeral,
            });
        }
    },
}).toJSON();

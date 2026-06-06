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
        const sub   = interaction.options.getSubcommand();
        const guild = interaction.guild;

        // ── Ban ─────────────────────────────────────────────────────────────────
        if (sub === 'member') {
            const target    = interaction.options.getUser('user');
            const alasan    = interaction.options.getString('reason') || 'No reason provided';
            const hapusPesan = interaction.options.getInteger('delete_messages') ?? 0;

            const member = guild.members.cache.get(target.id);

            // Check: cannot ban yourself
            if (target.id === interaction.user.id)
                return interaction.reply({ content: '❌ You cannot ban yourself.', flags: MessageFlags.Ephemeral });

            // Check: cannot ban this bot
            if (target.id === client.user.id)
                return interaction.reply({ content: '❌ Cannot ban this bot.', flags: MessageFlags.Ephemeral });

            // Check role hierarchy (only if target is still in server)
            if (member) {
                const botHighest  = guild.members.me?.roles.highest.position ?? 0;
                const userHighest = interaction.member.roles.highest.position ?? 0;
                if (member.roles.highest.position >= botHighest)
                    return interaction.reply({ content: '❌ Target\'s role is higher than or equal to the bot\'s role.', flags: MessageFlags.Ephemeral });
                if (member.roles.highest.position >= userHighest)
                    return interaction.reply({ content: '❌ You cannot ban a member with a higher or equal role than yours.', flags: MessageFlags.Ephemeral });
            }

            // Send DM notification to target before banning
            if (member) {
                await target.send({
                    embeds: [new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle(`🔨 You have been banned from ${guild.name}`)
                        .addFields(
                            { name: '📝 Reason',     value: alasan },
                            { name: '🛡️ Moderator', value: interaction.user.tag },
                        )
                        .setTimestamp()],
                }).catch(() => null);
            }

            try {
                await guild.members.ban(target.id, { reason: `${interaction.user.tag}: ${alasan}`, deleteMessageSeconds: hapusPesan * 86400 });
            } catch {
                return interaction.reply({ content: '❌ Failed to ban member. Check bot permissions.', flags: MessageFlags.Ephemeral });
            }

            const embed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('🔨 Member Banned')
                .setThumbnail(target.displayAvatarURL({ size: 64 }))
                .addFields(
                    { name: '👤 Member',           value: `${target} (${target.tag})`, inline: true },
                    { name: '🛡️ Moderator',       value: `${interaction.user}`,       inline: true },
                    { name: '🗑️ Delete Messages', value: hapusPesan ? `${hapusPesan} day(s)` : 'No', inline: true },
                    { name: '📝 Reason',           value: alasan },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(`✅ **${target.tag}** has been banned.\n📝 Reason: ${alasan}`)],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Unban ───────────────────────────────────────────────────────────────
        if (sub === 'unban') {
            const target = interaction.options.getUser('user');
            const alasan = interaction.options.getString('reason') || 'No reason provided';

            let banInfo;
            try {
                banInfo = await guild.bans.fetch(target.id);
            } catch {
                return interaction.reply({ content: `❌ **${target.tag}** is not in the ban list.`, flags: MessageFlags.Ephemeral });
            }

            try {
                await guild.members.unban(target.id, `${interaction.user.tag}: ${alasan}`);
            } catch {
                return interaction.reply({ content: '❌ Failed to unban. Check bot permissions.', flags: MessageFlags.Ephemeral });
            }
            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('✅ Member Unbanned')
                .setThumbnail(target.displayAvatarURL({ size: 64 }))
                .addFields(
                    { name: '👤 Member',     value: `${target.tag} (${target.id})`, inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`,          inline: true },
                    { name: '📝 Reason',     value: alasan },
                )
                .setTimestamp();

            await sendModLog(client, guild, embed);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setDescription(`✅ **${target.tag}** has been unbanned.\n📝 Reason: ${alasan}`)],
                flags: MessageFlags.Ephemeral,
            });
        }
    },
}).toJSON();

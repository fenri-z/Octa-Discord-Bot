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
        name: 'kick',
        description: 'Kick a member from the server',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.KickMembers),
        options: [
            { type: 6, name: 'user',   description: 'Member to kick',         required: true },
            { type: 3, name: 'reason', description: 'Reason for the kick',    required: false },
        ],
    },

    run: async (client, interaction) => {
        const target = interaction.options.getUser('user');
        const alasan = interaction.options.getString('reason') || 'No reason provided';
        const guild  = interaction.guild;

        if (target.id === interaction.user.id)
            return interaction.reply({ content: '❌ You cannot kick yourself.', flags: MessageFlags.Ephemeral });

        if (target.id === client.user.id)
            return interaction.reply({ content: '❌ Cannot kick this bot.', flags: MessageFlags.Ephemeral });

        const member = guild.members.cache.get(target.id);
        if (!member)
            return interaction.reply({ content: '❌ Member not found in this server.', flags: MessageFlags.Ephemeral });

        if (!member.kickable)
            return interaction.reply({ content: '❌ Bot cannot kick this member (role too high).', flags: MessageFlags.Ephemeral });

        const userHighest = interaction.member.roles.highest.position ?? 0;
        if (member.roles.highest.position >= userHighest)
            return interaction.reply({ content: '❌ You cannot kick a member with a higher or equal role than yours.', flags: MessageFlags.Ephemeral });

        // Send DM notification before kicking
        await target.send({
            embeds: [new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle(`👢 You have been kicked from ${guild.name}`)
                .addFields(
                    { name: '📝 Reason',     value: alasan },
                    { name: '🛡️ Moderator', value: interaction.user.tag },
                )
                .setTimestamp()],
        }).catch(() => null);

        try {
            await member.kick(`${interaction.user.tag}: ${alasan}`);
        } catch {
            return interaction.reply({ content: '❌ Failed to kick member. Check bot permissions.', flags: MessageFlags.Ephemeral });
        }

        const embed = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle('👢 Member Kicked')
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
                .setColor('#FEE75C')
                .setDescription(`✅ **${target.tag}** has been kicked.\n📝 Reason: ${alasan}`)],
            flags: MessageFlags.Ephemeral,
        });
    },
}).toJSON();

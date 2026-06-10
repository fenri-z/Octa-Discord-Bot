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
        const strings = getStrings(getLang(client.database, interaction.guild?.id));
        const s       = strings.kick;
        const c       = strings.common;
        const target  = interaction.options.getUser('user');
        const alasan  = interaction.options.getString('reason') || c.no_reason;
        const guild   = interaction.guild;

        if (target.id === interaction.user.id)
            return interaction.reply({ content: s.cannot_self, flags: MessageFlags.Ephemeral });

        if (target.id === client.user.id)
            return interaction.reply({ content: s.cannot_bot, flags: MessageFlags.Ephemeral });

        const member = guild.members.cache.get(target.id);
        if (!member)
            return interaction.reply({ content: s.role_too_high_bot, flags: MessageFlags.Ephemeral });

        if (!member.kickable)
            return interaction.reply({ content: s.role_too_high_bot, flags: MessageFlags.Ephemeral });

        const userHighest = interaction.member.roles.highest.position ?? 0;
        if (member.roles.highest.position >= userHighest)
            return interaction.reply({ content: s.role_too_high_user, flags: MessageFlags.Ephemeral });

        await target.send({
            embeds: [new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle(s.dm_title(guild.name))
                .addFields(
                    { name: s.dm_field_reason, value: alasan },
                    { name: s.dm_field_mod,    value: interaction.user.tag },
                )
                .setTimestamp()],
        }).catch(() => null);

        try {
            await member.kick(`${interaction.user.tag}: ${alasan}`);
        } catch {
            return interaction.reply({ content: s.failed, flags: MessageFlags.Ephemeral });
        }

        const embed = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle(s.kicked_title)
            .setThumbnail(target.displayAvatarURL({ size: 64 }))
            .addFields(
                { name: c.field_member,    value: `${target} (${target.tag})`, inline: true },
                { name: c.field_moderator, value: `${interaction.user}`,       inline: true },
                { name: s.field_reason,  value: alasan },
            )
            .setTimestamp();

        await sendModLog(client, guild, embed);

        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#FEE75C')
                .setDescription(`${s.kicked_desc(target.tag)}\n${s.field_reason}: ${alasan}`)],
            flags: MessageFlags.Ephemeral,
        });
    },
}).toJSON();

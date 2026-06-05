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
        description: 'Kick member dari server',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.KickMembers),
        options: [
            { type: 6, name: 'user',   description: 'Member yang di-kick', required: true },
            { type: 3, name: 'alasan', description: 'Alasan kick',         required: false },
        ],
    },

    run: async (client, interaction) => {
        const target = interaction.options.getUser('user');
        const alasan = interaction.options.getString('alasan') || 'Tidak ada alasan';
        const guild  = interaction.guild;

        if (target.id === interaction.user.id)
            return interaction.reply({ content: '❌ Kamu tidak bisa kick diri sendiri.', flags: MessageFlags.Ephemeral });

        if (target.id === client.user.id)
            return interaction.reply({ content: '❌ Tidak bisa kick bot ini.', flags: MessageFlags.Ephemeral });

        const member = guild.members.cache.get(target.id);
        if (!member)
            return interaction.reply({ content: '❌ Member tidak ditemukan di server ini.', flags: MessageFlags.Ephemeral });

        if (!member.kickable)
            return interaction.reply({ content: '❌ Bot tidak bisa kick member ini (role terlalu tinggi).', flags: MessageFlags.Ephemeral });

        const userHighest = interaction.member.roles.highest.position ?? 0;
        if (member.roles.highest.position >= userHighest)
            return interaction.reply({ content: '❌ Kamu tidak bisa kick member dengan role lebih tinggi atau sama denganmu.', flags: MessageFlags.Ephemeral });

        // Kirim DM notifikasi sebelum di-kick
        await target.send({
            embeds: [new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle(`👢 Kamu telah di-kick dari ${guild.name}`)
                .addFields(
                    { name: '📝 Alasan',     value: alasan },
                    { name: '🛡️ Moderator', value: interaction.user.tag },
                )
                .setTimestamp()],
        }).catch(() => null);

        try {
            await member.kick(`${interaction.user.tag}: ${alasan}`);
        } catch {
            return interaction.reply({ content: '❌ Gagal kick member. Cek permission bot.', flags: MessageFlags.Ephemeral });
        }

        const embed = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle('👢 Member Di-Kick')
            .setThumbnail(target.displayAvatarURL({ size: 64 }))
            .addFields(
                { name: '👤 Member',     value: `${target} (${target.tag})`, inline: true },
                { name: '🛡️ Moderator', value: `${interaction.user}`,       inline: true },
                { name: '📝 Alasan',     value: alasan },
            )
            .setTimestamp();

        await sendModLog(client, guild, embed);

        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#FEE75C')
                .setDescription(`✅ **${target.tag}** berhasil di-kick.\n📝 Alasan: ${alasan}`)],
            flags: MessageFlags.Ephemeral,
        });
    },
}).toJSON();

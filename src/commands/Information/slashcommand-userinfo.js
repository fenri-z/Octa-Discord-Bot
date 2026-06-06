const {
    EmbedBuilder,
    MessageFlags,
} = require('discord.js');
const ApplicationCommand = require('../../structure/ApplicationCommand');

function timeAgo(date) {
    const diff = Date.now() - date.getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days < 1)   return 'Today';
    if (days < 30)  return `${days} days ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
}

module.exports = new ApplicationCommand({
    command: {
        name: 'userinfo',
        description: 'Display detailed information about a member',
        type: 1,
        options: [
            { type: 6, name: 'user', description: 'Member to look up (default: yourself)', required: false },
        ],
    },

    run: async (client, interaction) => {
        const targetUser = interaction.options.getUser('user') ?? interaction.user;
        const guild      = interaction.guild;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Fetch member dari guild (mungkin tidak ada di cache)
        let member = guild.members.cache.get(targetUser.id);
        if (!member) {
            member = await guild.members.fetch(targetUser.id).catch(() => null);
        }

        // Fetch user lengkap untuk mendapatkan banner
        const fullUser = await client.users.fetch(targetUser.id, { force: true }).catch(() => targetUser);

        // ── Warn count ────────────────────────────────────────────────────────
        const warnRaw   = client.database.get(`warn-${guild.id}-${targetUser.id}`);
        let warnCount   = 0;
        try { warnCount = warnRaw ? JSON.parse(warnRaw).length : 0; } catch {}

        // ── Timeout status ────────────────────────────────────────────────────
        const isMuted   = member?.communicationDisabledUntil
            ? member.communicationDisabledUntil > new Date()
            : false;

        // ── Roles (maks 10, exclude @everyone) ───────────────────────────────
        const roles = member
            ? [...member.roles.cache.values()]
                .filter(r => r.id !== guild.id)
                .sort((a, b) => b.position - a.position)
            : [];

        const roleStr = roles.length
            ? roles.slice(0, 10).map(r => `<@&${r.id}>`).join(' ') + (roles.length > 10 ? ` +${roles.length - 10} more` : '')
            : '—';

        // ── Badges / flags ────────────────────────────────────────────────────
        const flagMap = {
            Staff:                  '👨‍💼 Discord Staff',
            Partner:                '🤝 Discord Partner',
            Hypesquad:              '🏠 HypeSquad Events',
            BugHunterLevel1:        '🐛 Bug Hunter',
            HypeSquadOnlineHouse1:  '🏠 HypeSquad Bravery',
            HypeSquadOnlineHouse2:  '🏠 HypeSquad Brilliance',
            HypeSquadOnlineHouse3:  '🏠 HypeSquad Balance',
            PremiumEarlySupporter:  '🌟 Early Supporter',
            VerifiedBot:            '✅ Verified Bot',
            VerifiedDeveloper:      '🔧 Verified Developer',
            ActiveDeveloper:        '🛠️ Active Developer',
            BugHunterLevel2:        '🪲 Bug Hunter Gold',
        };
        const flags    = fullUser.flags?.toArray() ?? [];
        const badgeStr = flags.length
            ? flags.map(f => flagMap[f] ?? f).join('\n')
            : null;

        // ── Embed ─────────────────────────────────────────────────────────────
        const color = (member?.displayHexColor && member.displayHexColor !== '#000000')
            ? member.displayHexColor
            : '#5865F2';

        const embed = new EmbedBuilder()
            .setColor(color)
            .setAuthor({ name: member?.displayName ?? fullUser.username, iconURL: fullUser.displayAvatarURL({ size: 64 }) })
            .setThumbnail(fullUser.displayAvatarURL({ size: 256, dynamic: true }))
            .addFields(
                {
                    name:  '👤 Account Info',
                    value: [
                        `**Username:** ${fullUser.tag}`,
                        `**ID:** \`${fullUser.id}\``,
                        `**Bot:** ${fullUser.bot ? 'Yes' : 'No'}`,
                        `**Created:** <t:${Math.floor(fullUser.createdTimestamp / 1000)}:D> (${timeAgo(fullUser.createdAt)})`,
                    ].join('\n'),
                    inline: false,
                },
            );

        if (member) {
            embed.addFields(
                {
                    name:  '🏠 Server Info',
                    value: [
                        `**Joined:** <t:${Math.floor(member.joinedTimestamp / 1000)}:D> (${timeAgo(member.joinedAt)})`,
                        `**Nickname:** ${member.nickname ?? '—'}`,
                        `**Highest role:** ${roles[0] ?? '—'}`,
                        `**Timeout status:** ${isMuted ? `Yes — expires <t:${Math.floor(member.communicationDisabledUntil.getTime() / 1000)}:R>` : 'No'}`,
                    ].join('\n'),
                    inline: false,
                },
                {
                    name:   `🎭 Roles (${roles.length})`,
                    value:  roleStr,
                    inline: false,
                },
            );
        } else {
            embed.addFields({ name: '🏠 Server Status', value: '❌ Not in this server', inline: false });
        }

        embed.addFields({ name: '⚠️ Warnings', value: `${warnCount} warn`, inline: true });

        if (badgeStr) embed.addFields({ name: '🏅 Badges', value: badgeStr, inline: true });

        if (fullUser.bannerURL()) embed.setImage(fullUser.bannerURL({ size: 512 }));

        embed.setFooter({ text: `Requested by ${interaction.user.tag}` }).setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
}).toJSON();

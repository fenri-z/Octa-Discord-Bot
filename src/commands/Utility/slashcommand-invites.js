const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const DiscordBot       = require("../../client/DiscordBot");
const ApplicationCommand = require('../../structure/ApplicationCommand');
const { checkBotPermissions } = require('../../utils/checkBotPermissions');
const config           = require('../../config');

const PER_PAGE = 15;

function hasInvitePermission(interaction) {
    const { member, guild, user } = interaction;
    if (config.users.ownerId === user.id)             return true;
    if (config.users.developers.includes(user.id))    return true;
    if (guild?.ownerId === user.id)                    return true;
    const perms = member?.permissions;
    if (!perms) return false;
    return perms.has(PermissionFlagsBits.Administrator) ||
           perms.has(PermissionFlagsBits.ManageGuild)   ||
           perms.has(PermissionFlagsBits.ManageChannels);
}

module.exports = new ApplicationCommand({
    command: {
        name: 'invites',
        description: 'Show all server invite links, sorted by most used.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            {
                name: 'page',
                description: 'Page number of the invite list (default: 1)',
                type: 4,       // INTEGER
                required: false,
                min_value: 1
            }
        ]
    },
    options: { cooldown: 5000 },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        // ── Cek permission ──────────────────────────────────────────────
        if (!hasInvitePermission(interaction)) {
            return interaction.reply({
                content: [
                    '❌ You do not have permission to use this command.',
                    'Required one of:',
                    '• **Administrator** · **Manage Server** · **Manage Channels**',
                    '• Server Owner · Bot Owner · Bot Developer'
                ].join('\n'),
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply();

        // ── Cek permission bot ─────────────────────────────────────────
        const ok = await checkBotPermissions(interaction, [PermissionFlagsBits.ManageGuild]);
        if (!ok) return;

        const { guild } = interaction;
        const page = Math.max(1, interaction.options.getInteger('page') ?? 1);

        // ── Ambil semua invite ─────────────────────────────────────────
        let guildInvites;
        try {
            guildInvites = await guild.invites.fetch();
        } catch {
            return interaction.editReply({
                content: '❌ Bot cannot read invites. Make sure the bot has **Manage Guild** permission.'
            });
        }

        if (guildInvites.size === 0) {
            return interaction.editReply({ content: '📭 No active invite links in this server.' });
        }

        // ── Urutkan berdasarkan uses terbanyak ─────────────────────────
        const sorted     = [...guildInvites.values()].sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0));
        const totalPages = Math.ceil(sorted.length / PER_PAGE);
        const curPage    = Math.min(page, totalPages);
        const slice      = sorted.slice((curPage - 1) * PER_PAGE, curPage * PER_PAGE);

        // ── Statistik ringkas ──────────────────────────────────────────
        const totalUses      = sorted.reduce((s, inv) => s + (inv.uses ?? 0), 0);
        const uniqueInviters = new Set(sorted.map(inv => inv.inviter?.id).filter(Boolean)).size;

        // ── Baris daftar invite ────────────────────────────────────────
        const lines = slice.map((inv, i) => {
            const rank     = (curPage - 1) * PER_PAGE + i + 1;
            const uses     = inv.uses ?? 0;
            const maxUses  = inv.maxUses ? `/${inv.maxUses}` : '/∞';
            const inviter  = inv.inviter ? `@${inv.inviter.username}` : '*Unknown*';
            const ch       = inv.channel ? `#${inv.channel.name}` : '`-`';
            const expiry   = inv.expiresTimestamp
                ? `<t:${Math.floor(inv.expiresTimestamp / 1000)}:R>`
                : 'permanent';
            const temp     = inv.temporary ? ' · temporary' : '';
            return `\`#${rank}\` **[${inv.code}](https://discord.gg/${inv.code})** — ${inviter} — ${ch}\n` +
                   `   ​↳ **${uses}${maxUses}** uses · ${expiry}${temp}`;
        });

        // ── Embed ──────────────────────────────────────────────────────
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`📋 All Invites — ${guild.name}`)
            .setDescription(lines.join('\n\n'))
            .addFields(
                { name: '🔗 Total Invites',       value: `**${sorted.length}**`,       inline: true },
                { name: '📊 Total Uses',     value: `**${totalUses}**×`,          inline: true },
                { name: '👤 Unique Inviters',     value: `**${uniqueInviters}**`,      inline: true },
            )
            .setFooter({
                text: `Page ${curPage}/${totalPages}${totalPages > 1 ? ` · /invites page:${curPage + 1} for next` : ''} · ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL({ dynamic: true })
            })
            .setTimestamp();

        if (guild.iconURL()) embed.setThumbnail(guild.iconURL({ dynamic: true }));

        return interaction.editReply({ embeds: [embed] });
    }
}).toJSON();

const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const DiscordBot       = require("../../client/DiscordBot");
const ApplicationCommand = require('../../structure/ApplicationCommand');
const { getLang, getStrings } = require('../../utils/BotLang');
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
        const s = getStrings(getLang(client.database, interaction.guild?.id)).invites;
        // ── Cek permission ──────────────────────────────────────────────
        if (!hasInvitePermission(interaction)) {
            return interaction.reply({
                content: s.no_permission,
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
            return interaction.editReply({ content: s.bot_no_perm });
        }

        if (guildInvites.size === 0) {
            return interaction.editReply({ content: s.no_active });
        }

        // ── Urutkan berdasarkan uses terbanyak ─────────────────────────
        const sorted     = [...guildInvites.values()].sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0));
        const totalPages = Math.ceil(sorted.length / PER_PAGE);
        const curPage    = Math.min(page, totalPages);
        const slice      = sorted.slice((curPage - 1) * PER_PAGE, curPage * PER_PAGE);

        // ── Statistik ringkas ──────────────────────────────────────────
        const totalUses      = sorted.reduce((acc, inv) => acc + (inv.uses ?? 0), 0);
        const uniqueInviters = new Set(sorted.map(inv => inv.inviter?.id).filter(Boolean)).size;

        // ── Baris daftar invite ────────────────────────────────────────
        const lines = slice.map((inv, i) => {
            const rank    = (curPage - 1) * PER_PAGE + i + 1;
            const uses    = inv.uses ?? 0;
            const maxUses = inv.maxUses ? `/${inv.maxUses}` : '/∞';
            const inviter = inv.inviter ? `@${inv.inviter.username}` : `*${s.unknown_inviter}*`;
            const ch      = inv.channel ? `#${inv.channel.name}` : '`-`';
            const expiry  = inv.expiresTimestamp
                ? `<t:${Math.floor(inv.expiresTimestamp / 1000)}:R>`
                : s.permanent;
            const temp    = inv.temporary ? ` · ${s.temporary}` : '';
            return `\`#${rank}\` **[${inv.code}](https://discord.gg/${inv.code})** — ${inviter} — ${ch}\n` +
                   `   ​↳ **${uses}${maxUses}** uses · ${expiry}${temp}`;
        });

        // ── Embed ──────────────────────────────────────────────────────
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(s.title(guild.name))
            .setDescription(lines.join('\n\n'))
            .addFields(
                { name: s.field_total_invites,   value: `**${sorted.length}**`,  inline: true },
                { name: s.field_total_uses,      value: `**${totalUses}**×`, inline: true },
                { name: s.field_unique_inviters, value: `**${uniqueInviters}**`, inline: true },
            )
            .setFooter({
                text: s.footer(curPage, totalPages, curPage + 1, interaction.user.tag),
                iconURL: interaction.user.displayAvatarURL({ dynamic: true })
            })
            .setTimestamp();

        if (guild.iconURL()) embed.setThumbnail(guild.iconURL({ dynamic: true }));

        return interaction.editReply({ embeds: [embed] });
    }
}).toJSON();

const {
    ButtonInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
} = require('discord.js');
const DiscordBot  = require('../../client/DiscordBot');
const Component   = require('../../structure/Component');
const { getServerStatsConfig } = require('../../utils/serverStatsHelper');
const { warn } = require('../../utils/Console');
const { getLang, getStrings } = require('../../utils/BotLang');

// ── Delete channel directly via REST API (more reliable than .delete() on the object) ──
async function deleteChannelById(token, channelId, reason) {
    if (!channelId) return { ok: true, skipped: true };

    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bot ${token}`,
            'X-Audit-Log-Reason': encodeURIComponent(reason),
        },
        signal: AbortSignal.timeout(10_000),
    }).catch(err => ({ ok: false, _fetchError: err.message }));

    if (res._fetchError) return { ok: false, error: res._fetchError };
    // 200 = successfully deleted, 404 = already gone (treat as success)
    if (res.ok || res.status === 404) return { ok: true, status: res.status };

    const body = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, error: JSON.stringify(body) };
}

module.exports = new Component({
    customId: 'serverstats-reset-confirm',
    type: 'button',
    /**
     * @param {DiscordBot} client
     * @param {ButtonInteraction} interaction
     */
    run: async (client, interaction) => {
        await interaction.deferUpdate();

        const guild   = interaction.guild;
        const guildId = guild.id;
        const s = getStrings(getLang(client.database, guildId)).serverstats;

        // ── Check the permission of the user pressing the button ─────────
        const member = interaction.member ?? await guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.editReply({
                content: s.reset_no_perm,
                embeds: [],
                components: [],
            });
        }

        // ── Check bot permissions before attempting deletion ───────────────
        const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.editReply({
                content: s.reset_bot_no_perm,
                embeds: [],
                components: [],
            });
        }

        const cfg = getServerStatsConfig(client, guildId);
        const { categoryId, totalId, humanId, botId } = cfg;

        const token  = process.env.CLIENT_TOKEN;
        const reason = `Server stats reset by ${interaction.user.tag}`;
        const label  = `[serverstats-reset] guild:${guildId}`;

        // ── Send initial feedback to the user ──────────────────────────────
        const embedPending = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle(s.reset_pending_title)
            .setDescription(s.reset_pending_desc)
            .setFooter({ text: s.reset_footer(interaction.user.tag) })
            .setTimestamp();

        await interaction.editReply({ embeds: [embedPending], components: [] });

        // ── STEP 1: Delete Discord channels first (before deleting database) ──
        const failedChannels = [];

        for (const [name, id] of [['total', totalId], ['human', humanId], ['bot', botId]]) {
            if (!id) continue;

            // Check bot permission in this specific channel/category
            const discordChannel = guild.channels.cache.get(id);
            if (discordChannel) {
                const permsInChannel = botMember.permissionsIn(discordChannel);
                if (!permsInChannel.has(PermissionFlagsBits.ManageChannels)) {
                    warn(`${label} bot lacks ManageChannels in channel ${name} (${id}), skipping.`);
                    failedChannels.push(`\`${name}\` — bot lacks permission in this channel`);
                    continue;
                }
            }

            const result = await deleteChannelById(token, id, reason);
            if (!result.ok) {
                warn(`${label} failed to delete channel ${name} (${id}): ${result.error}`);
                failedChannels.push(`\`${name}\` — ${result.error}`);
            }
        }

        // Delete the category last after all voice channels are removed
        if (categoryId) {
            const result = await deleteChannelById(token, categoryId, reason);
            if (!result.ok) {
                warn(`${label} failed to delete category (${categoryId}): ${result.error}`);
                failedChannels.push(`\`category\` — ${result.error}`);
            }
        }

        // ── STEP 2: Delete database AFTER Discord channels are deleted ─────
        const keysToDelete = [
            `serverstats-enabled-${guildId}`,
            `serverstats-category-${guildId}`,
            `serverstats-total-channel-${guildId}`,
            `serverstats-human-channel-${guildId}`,
            `serverstats-bot-channel-${guildId}`,
            `serverstats-total-label-${guildId}`,
            `serverstats-human-label-${guildId}`,
            `serverstats-bot-label-${guildId}`,
            `serverstats-category-label-${guildId}`,
        ];
        for (const key of keysToDelete) client.database.delete(key);

        // ── STEP 3: Reply to interaction with the final result ─────────────
        if (failedChannels.length > 0) {
            // Some channels failed to be deleted
            const embedPartial = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle(s.reset_partial_title)
                .setDescription(s.reset_partial_desc(failedChannels.map(f => `> • ${f}`).join('\n')))
                .setFooter({ text: s.reset_footer(interaction.user.tag) })
                .setTimestamp();

            await interaction.editReply({ embeds: [embedPartial], components: [] });
        } else {
            // All succeeded
            const embedSuccess = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle(s.reset_done_title)
                .setDescription(s.reset_done_desc)
                .setFooter({ text: s.reset_footer(interaction.user.tag) })
                .setTimestamp();

            await interaction.editReply({ embeds: [embedSuccess], components: [] });
        }
    }
}).toJSON();

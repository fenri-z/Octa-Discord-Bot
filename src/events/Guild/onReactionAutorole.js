const { EmbedBuilder, MessageFlags } = require("discord.js");
const Event = require("../../structure/Event");
const { safeRun } = require('../../utils/logError');

// ── Helpers ────────────────────────────────────────────────────────────────

function getPanel(client, guildId, name) {
    const raw = client.database.get(`autoreact-${guildId}-${name}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

// Normalisasi emoji reaction Discord ke format penyimpanan (name:id atau unicode)
function emojiFromReaction(emoji) {
    if (emoji.id) return `${emoji.name}:${emoji.id}`;
    return emoji.name;
}

// ── Shared role handler ────────────────────────────────────────────────────

async function handleReaction(client, reaction, user, isAdd) {
    if (user.bot) return;
    if (!reaction.message.guild) return;

    // Fetch partial untuk memastikan data lengkap
    try {
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();
    } catch { return; }

    const guild     = reaction.message.guild;
    const messageId = reaction.message.id;
    const guildId   = guild.id;

    // Cek apakah pesan ini adalah panel autorole-reaction
    const panelName = client.database.get(`autoreact-msgmap-${guildId}-${messageId}`);
    if (!panelName) return;

    const panel = getPanel(client, guildId, panelName);
    if (!panel) return;

    const emojiKey = emojiFromReaction(reaction.emoji);

    // Cari entry reaction yang cocok
    const reactEntry = panel.reactions.find(r => r.emoji === emojiKey);
    if (!reactEntry) return;

    const role = guild.roles.cache.get(reactEntry.roleId);
    if (!role) return;

    // Cek permission bot
    const botMember = guild.members.me;
    if (!botMember?.permissions.has('ManageRoles')) return;
    if (botMember.roles.highest.comparePositionTo(role) <= 0) return;

    // Ambil member
    const member = guild.members.cache.get(user.id)
        ?? await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    const hasRole = member.roles.cache.has(reactEntry.roleId);

    // ════════════════════════════════════════════════════════════════════════
    // MODE: MULTI — setiap reaction toggle role masing-masing
    // ════════════════════════════════════════════════════════════════════════
    if (panel.mode !== 'single') {
        if (isAdd) {
            if (!hasRole) await member.roles.add(role, `Autorole Reaction (multi) – panel: ${panelName}`).catch(() => null);
        } else {
            if (hasRole) await member.roles.remove(role, `Autorole Reaction (multi) – panel: ${panelName}`).catch(() => null);
        }
        return;
    }

    // ════════════════════════════════════════════════════════════════════════
    // MODE: SINGLE — hanya boleh 1 role dari panel ini yang aktif
    // ════════════════════════════════════════════════════════════════════════
    if (panel.mode === 'single') {
        const allPanelRoleIds = panel.reactions.map(r => r.roleId);

        if (isAdd) {
            if (hasRole) return; // sudah punya, tidak perlu buat ulang

            // Lepas semua role panel lain yang aktif
            const currentPanelRoles = member.roles.cache.filter(r => allPanelRoleIds.includes(r.id));
            for (const [, oldRole] of currentPanelRoles) {
                await member.roles.remove(oldRole, `Autorole Reaction (single) – replaced – panel: ${panelName}`).catch(() => null);
                // Hapus reaction lama di pesan supaya UI sinkron
                try {
                    const oldEntry = panel.reactions.find(r => r.roleId === oldRole.id);
                    if (oldEntry) {
                        const oldEmojiArg = oldEntry.emoji.includes(':')
                            ? oldEntry.emoji.split(':')[1]  // gunakan ID untuk custom emoji
                            : oldEntry.emoji;
                        const oldReaction = reaction.message.reactions.cache.find(r =>
                            r.emoji.id === oldEmojiArg ||
                            r.emoji.name === oldEmojiArg ||
                            `${r.emoji.name}:${r.emoji.id}` === oldEntry.emoji
                        );
                        if (oldReaction) await oldReaction.users.remove(user.id).catch(() => null);
                    }
                } catch {}
            }

            await member.roles.add(role, `Autorole Reaction (single) – panel: ${panelName}`).catch(() => null);
        } else {
            // Remove reaction → lepas role jika punya
            if (hasRole) await member.roles.remove(role, `Autorole Reaction (single) – panel: ${panelName}`).catch(() => null);
        }
    }
}

// ── Event: messageReactionAdd ──────────────────────────────────────────────

module.exports = new Event({
    event: 'messageReactionAdd',
    once: false,

    /**
     * @param {import("../../client/DiscordBot")} client
     * @param {import("discord.js").MessageReaction} reaction
     * @param {import("discord.js").User} user
     */
    run: safeRun('[onReactionAutorole]', async (client, reaction, user) => {
        await handleReaction(client, reaction, user, true);
    })
}).toJSON();

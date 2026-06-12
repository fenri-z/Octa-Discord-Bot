const Event = require("../../structure/Event");
const { safeRun } = require('../../utils/logError');

// ── Helpers (duplikasi dari onReactionAutorole.js untuk menghindari circular dep) ──

function getPanel(client, guildId, name) {
    const raw = client.database.get(`autoreact-${guildId}-${name}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function emojiFromReaction(emoji) {
    if (emoji.id) return `${emoji.name}:${emoji.id}`;
    return emoji.name;
}

// ── Event: messageReactionRemove ──────────────────────────────────────────

module.exports = new Event({
    event: 'messageReactionRemove',
    once: false,

    /**
     * @param {import("../../client/DiscordBot")} client
     * @param {import("discord.js").MessageReaction} reaction
     * @param {import("discord.js").User} user
     */
    run: safeRun('[onReactionRemoveAutorole]', async (client, reaction, user) => {
        if (user.bot) return;
        if (!reaction.message.guild) return;

        try {
            if (reaction.partial) await reaction.fetch();
            if (reaction.message.partial) await reaction.message.fetch();
        } catch { return; }

        const guild     = reaction.message.guild;
        const messageId = reaction.message.id;
        const guildId   = guild.id;

        const panelName = client.database.get(`autoreact-msgmap-${guildId}-${messageId}`);
        if (!panelName) return;

        const panel = getPanel(client, guildId, panelName);
        if (!panel) return;

        const emojiKey   = emojiFromReaction(reaction.emoji);
        const reactEntry = panel.reactions.find(r => r.emoji === emojiKey);
        if (!reactEntry) return;

        const role = guild.roles.cache.get(reactEntry.roleId);
        if (!role) return;

        const botMember = guild.members.me;
        if (!botMember?.permissions.has('ManageRoles')) return;
        if (botMember.roles.highest.comparePositionTo(role) <= 0) return;

        const member = guild.members.cache.get(user.id)
            ?? await guild.members.fetch(user.id).catch(() => null);
        if (!member) return;

        if (member.roles.cache.has(reactEntry.roleId)) {
            await member.roles.remove(role, `Autorole Reaction (remove) – panel: ${panelName}`).catch(() => null);
        }
    })
}).toJSON();

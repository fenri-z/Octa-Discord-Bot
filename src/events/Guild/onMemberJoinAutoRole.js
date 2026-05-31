const Event = require("../../structure/Event");

// ── Helpers ────────────────────────────────────────────────────────────────
function getBool(client, key, defaultVal) {
    const raw = client.database.get(key);
    if (raw === null || raw === undefined) return defaultVal;
    if (raw === 'false' || raw === false || raw === 0) return false;
    return true;
}

module.exports = new Event({
    event: 'guildMemberAdd',
    once: false,

    /**
     * @param {import("../../client/DiscordBot")} client
     * @param {import("discord.js").GuildMember} member
     */
    run: async (client, member) => {
        const { guild } = member;
        const isBot = member.user.bot;

        // ── Pilih kategori: member atau bot ──────────────────────────────
        const enabledKey = isBot
            ? `autorole-bot-enabled-${guild.id}`
            : `autorole-member-enabled-${guild.id}`;

        const roleKey = isBot
            ? `autorole-bot-role-${guild.id}`
            : `autorole-member-role-${guild.id}`;

        const enabled = getBool(client, enabledKey, false);
        if (!enabled) return;

        const roleId = client.database.get(roleKey);
        if (!roleId) return;

        // ── Pastikan role masih ada di server ─────────────────────────────
        const role = guild.roles.cache.get(roleId);
        if (!role) return;

        // ── Pastikan bot punya izin untuk assign role ─────────────────────
        const botMember = guild.members.me;
        if (!botMember || !botMember.permissions.has('ManageRoles')) return;
        if (botMember.roles.highest.comparePositionTo(role) <= 0) return;

        // ── Assign role ───────────────────────────────────────────────────
        await member.roles.add(role, `Autorole ${isBot ? 'Bot' : 'Member'}`).catch(() => null);
    }
}).toJSON();

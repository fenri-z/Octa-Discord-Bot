const { safeRun } = require("../../utils/logError");
const cache = require("../../utils/GuildCache");
const Event = require("../../structure/Event");

function bool(db, key, def = false) {
    const v = db.get(key);
    return (v === null || v === undefined) ? def : (v !== 'false' && v !== false && v !== 0);
}

function readAutoroleConfig(db, guildId) {
    const g = guildId;
    return {
        memberEnabled: bool(db, `autorole-member-enabled-${g}`, false),
        memberRole:    db.get(`autorole-member-role-${g}`) ?? null,
        botEnabled:    bool(db, `autorole-bot-enabled-${g}`, false),
        botRole:       db.get(`autorole-bot-role-${g}`) ?? null,
    };
}

module.exports = new Event({
    event: 'guildMemberAdd',
    once: false,
    run: safeRun('[onMemberJoinAutoRole]', async (client, member) => {
        const { guild } = member;
        const guildId = guild.id;
        const isBot = member.user.bot;

        const cfgKey = `autorole-cfg-${guildId}`;
        let cfg = cache.get(cfgKey);
        if (!cfg) {
            cfg = readAutoroleConfig(client.database, guildId);
            cache.set(cfgKey, cfg);
        }

        const enabled = isBot ? cfg.botEnabled : cfg.memberEnabled;
        if (!enabled) return;

        const roleId = isBot ? cfg.botRole : cfg.memberRole;
        if (!roleId) return;

        // ── Pastikan role masih ada di server ─────────────────────────────
        const role = guild.roles.cache.get(roleId);
        if (!role) return;

        // ── Pastikan bot punya izin untuk assign role ─────────────────────
        const botMember = guild.members.me;
        if (!botMember || !botMember.permissions.has('ManageRoles')) return;
        if (botMember.roles.highest.comparePositionTo(role) <= 0) return;

        await member.roles.add(role, `Autorole ${isBot ? 'Bot' : 'Member'}`).catch(() => null);
    })
}).toJSON();

const { safeRun, logError } = require("../../utils/logError");
const cache = require("../../utils/GuildCache");
const Event = require("../../structure/Event");

function bool(db, key, def = false) {
    const v = db.get(key);
    return (v === null || v === undefined) ? def : (v !== 'false' && v !== false && v !== 0);
}

function readAutoroleConfig(db, guildId) {
    const g = guildId;
    return {
        allEnabled:    bool(db, `autorole-all-enabled-${g}`, false),
        allRole:       db.get(`autorole-all-role-${g}`) ?? null,
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

        const botMember = guild.members.me;
        if (!botMember || !botMember.permissions.has('ManageRoles')) return;

        const assignRole = async (roleId, label) => {
            if (!roleId) return;
            const role = guild.roles.cache.get(roleId);
            if (!role) return;
            if (botMember.roles.highest.comparePositionTo(role) <= 0) return;
            await member.roles.add(role, `Autorole ${label}`).catch(err => logError('[onMemberJoinAutoRole] roles.add failed:', err));
        };

        // Role "semua" — berlaku untuk member dan bot
        if (cfg.allEnabled) await assignRole(cfg.allRole, 'All');

        // Role spesifik member / bot
        if (isBot  && cfg.botEnabled)    await assignRole(cfg.botRole,    'Bot');
        if (!isBot && cfg.memberEnabled) await assignRole(cfg.memberRole, 'Member');
    })
}).toJSON();

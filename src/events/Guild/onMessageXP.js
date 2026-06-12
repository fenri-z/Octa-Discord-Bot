const { safeRun } = require('../../utils/logError');
const cache = require('../../utils/GuildCache');
const Event = require('../../structure/Event');

function xpForLevel(lvl) {
    return 5 * lvl * lvl + 50 * lvl + 100;
}

function getLevelFromXP(totalXP) {
    let level = 0;
    let accumulated = 0;
    while (true) {
        const needed = xpForLevel(level);
        if (accumulated + needed > totalXP) break;
        accumulated += needed;
        level++;
    }
    return level;
}

function readLevelConfig(db, guildId) {
    const g = guildId;
    return {
        enabled:     db.get(`level-enabled-${g}`) === 'true',
        channelId:   db.get(`level-channel-${g}`) ?? null,
        cooldownSec: parseInt(db.get(`level-cooldown-${g}`) || '60'),
        xpMin:       parseInt(db.get(`level-xp-min-${g}`)  || '15'),
        xpMax:       parseInt(db.get(`level-xp-max-${g}`)  || '25'),
        levelMsg:    db.get(`level-msg-${g}`)  || '🎉 {member} leveled up to **Level {level}**!',
        rolesRaw:    db.get(`level-roles-${g}`) ?? null,
    };
}

module.exports = new Event({
    event: 'messageCreate',
    once:  false,
    run: safeRun('[onMessageXP]', async (client, message) => {
        if (!message.guild || message.author.bot || message.webhookId) return;

        const { guild, author } = message;
        const guildId = guild.id;
        const userId  = author.id;
        const db      = client.database;

        // Cache level config (not user XP data — that changes per message)
        const cfgKey = `level-cfg-${guildId}`;
        let cfg = cache.get(cfgKey);
        if (!cfg) {
            cfg = readLevelConfig(db, guildId);
            cache.set(cfgKey, cfg);
        }

        if (!cfg.enabled) return;

        const raw      = db.get(`level-user-${guildId}-${userId}`);
        const userData = raw ? JSON.parse(raw) : { xp: 0, level: 0, lastMsg: 0 };

        if (Date.now() - userData.lastMsg < cfg.cooldownSec * 1000) return;

        const gain  = Math.floor(Math.random() * (cfg.xpMax - cfg.xpMin + 1)) + cfg.xpMin;
        userData.xp     += gain;
        userData.lastMsg = Date.now();

        const oldLevel = userData.level;
        const newLevel = getLevelFromXP(userData.xp);
        userData.level = newLevel;

        db.set(`level-user-${guildId}-${userId}`, JSON.stringify(userData));

        if (newLevel > oldLevel) {
            const announceIn = cfg.channelId
                ? guild.channels.cache.get(cfg.channelId)
                : message.channel;

            if (announceIn?.isTextBased()) {
                const text = cfg.levelMsg
                    .replace(/\{member\}/g,   `<@${userId}>`)
                    .replace(/\{level\}/g,    newLevel)
                    .replace(/\{server\}/g,   guild.name)
                    .replace(/\{username\}/g, author.username);
                await announceIn.send({ content: text }).catch(() => null);
            }

            if (cfg.rolesRaw) {
                const rewards = JSON.parse(cfg.rolesRaw);
                const member  = guild.members.cache.get(userId)
                    ?? await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    for (const rr of rewards) {
                        if (rr.level <= newLevel) {
                            const role = guild.roles.cache.get(rr.roleId);
                            if (role && !member.roles.cache.has(rr.roleId))
                                await member.roles.add(role).catch(() => null);
                        }
                    }
                }
            }
        }
    })
}).toJSON();

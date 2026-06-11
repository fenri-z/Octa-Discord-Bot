const Event = require('../../structure/Event');

// XP dibutuhkan untuk naik dari level N ke level N+1 (formula MEE6)
function xpForLevel(lvl) {
    return 5 * lvl * lvl + 50 * lvl + 100;
}

// Hitung level dari total XP
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

module.exports = new Event({
    event: 'messageCreate',
    once:  false,
    run: async (client, message) => {
        if (!message.guild || message.author.bot || message.webhookId) return;

        const { guild, author } = message;
        const guildId = guild.id;
        const userId  = author.id;
        const db      = client.database;

        if (db.get(`level-enabled-${guildId}`) !== 'true') return;

        const raw      = db.get(`level-user-${guildId}-${userId}`);
        const userData = raw ? JSON.parse(raw) : { xp: 0, level: 0, lastMsg: 0 };

        const cooldownSec = parseInt(db.get(`level-cooldown-${guildId}`) || '60');
        if (Date.now() - userData.lastMsg < cooldownSec * 1000) return;

        const xpMin = parseInt(db.get(`level-xp-min-${guildId}`) || '15');
        const xpMax = parseInt(db.get(`level-xp-max-${guildId}`) || '25');
        const gain  = Math.floor(Math.random() * (xpMax - xpMin + 1)) + xpMin;

        userData.xp     += gain;
        userData.lastMsg = Date.now();

        const oldLevel = userData.level;
        const newLevel = getLevelFromXP(userData.xp);
        userData.level = newLevel;

        db.set(`level-user-${guildId}-${userId}`, JSON.stringify(userData));

        if (newLevel > oldLevel) {
            const channelId     = db.get(`level-channel-${guildId}`);
            const announceIn    = channelId
                ? guild.channels.cache.get(channelId)
                : message.channel;

            if (announceIn?.isTextBased()) {
                const template = db.get(`level-msg-${guildId}`)
                    || '🎉 {member} leveled up to **Level {level}**!';
                const text = template
                    .replace(/\{member\}/g,   `<@${userId}>`)
                    .replace(/\{level\}/g,    newLevel)
                    .replace(/\{server\}/g,   guild.name)
                    .replace(/\{username\}/g, author.username);
                await announceIn.send({ content: text }).catch(() => null);
            }

            const rolesRaw = db.get(`level-roles-${guildId}`);
            if (rolesRaw) {
                const rewards = JSON.parse(rolesRaw);
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
    }
}).toJSON();

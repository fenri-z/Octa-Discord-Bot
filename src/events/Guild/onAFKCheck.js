const Event = require('../../structure/Event');
const { getLang, getStrings } = require('../../utils/BotLang');

module.exports = new Event({
    event: 'messageCreate',
    once:  false,
    run: async (client, message) => {
        if (!message.guild || message.author.bot || message.webhookId) return;

        const db      = client.database;
        const guildId = message.guild.id;
        const userId  = message.author.id;
        const s       = getStrings(getLang(db, guildId)).afk;

        // If the sender is AFK, remove their AFK status
        const selfAfk = db.get(`afk-${guildId}-${userId}`);
        if (selfAfk) {
            db.delete(`afk-${guildId}-${userId}`);
            const afkData = JSON.parse(selfAfk);
            const elapsed = formatElapsed(Date.now() - afkData.since, s);
            await message.reply({
                content: s.back(elapsed),
                allowedMentions: { repliedUser: false },
            }).catch(() => null);
            return;
        }

        // Notify if any mentioned users are AFK
        if (!message.mentions.users.size) return;

        const afkNotices = [];
        for (const [mentionedId, mentionedUser] of message.mentions.users) {
            if (mentionedUser.bot) continue;
            const raw = db.get(`afk-${guildId}-${mentionedId}`);
            if (!raw) continue;
            const { reason, since } = JSON.parse(raw);
            const elapsed = formatElapsed(Date.now() - since, s);
            afkNotices.push(s.notify(mentionedUser.username, reason, elapsed));
        }

        if (afkNotices.length) {
            await message.reply({
                content: afkNotices.join('\n'),
                allowedMentions: { repliedUser: false },
            }).catch(() => null);
        }
    }
}).toJSON();

function formatElapsed(ms, s) {
    const sec = Math.floor(ms / 1000);
    if (sec < 60)  return s.elapsed_s(sec);
    const m = Math.floor(sec / 60);
    if (m < 60)    return s.elapsed_m(m);
    const h = Math.floor(m / 60);
    if (h < 24)    return s.elapsed_h(h, m % 60);
    const d = Math.floor(h / 24);
    return s.elapsed_d(d, h % 24);
}

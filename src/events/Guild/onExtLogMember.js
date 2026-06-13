const Event        = require('../../structure/Event');
const { EmbedBuilder } = require('discord.js');
const { getLang, getStrings } = require('../../utils/BotLang');
const { safeRun, logError } = require('../../utils/logError');

function isEnabled(client, guildId, event) {
    const db = client.database;
    if (db.get(`extlog-enabled-${guildId}`) !== 'true') return false;
    const raw = db.get(`extlog-events-${guildId}`);
    if (!raw) return true;
    try { return JSON.parse(raw)[event] !== false; } catch { return true; }
}

async function sendLog(client, guildId, embed) {
    const db        = client.database;
    const channelId = db.get(`extlog-channel-${guildId}`);
    if (!channelId) return;
    const guild   = client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);
    if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(err => logError('[ExtLogMember] sendLog failed:', err));
}

module.exports = new Event({
    event: 'guildMemberUpdate',
    once:  false,
    run: safeRun('[onExtLogMember]', async (client, oldMember, newMember) => {
        const guildId = newMember.guild.id;
        const user    = newMember.user;
        const s       = getStrings(getLang(client.database, guildId)).extlog_event;

        // Nickname change
        if (oldMember.nickname !== newMember.nickname && isEnabled(client, guildId, 'nicknameChange')) {
            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle(s.nick_title)
                .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
                .addFields(
                    { name: s.field_member, value: `<@${user.id}>`,                                   inline: true },
                    { name: s.field_before, value: oldMember.nickname || s.nick_none,                 inline: true },
                    { name: s.field_after,  value: newMember.nickname || s.nick_none,                 inline: true },
                )
                .setTimestamp();
            await sendLog(client, guildId, embed);
        }

        // Role added / removed
        if (!isEnabled(client, guildId, 'roleChange')) return;

        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;

        const added   = newRoles.filter(r => !oldRoles.has(r.id));
        const removed = oldRoles.filter(r => !newRoles.has(r.id));

        if (!added.size && !removed.size) return;

        const fields = [];
        if (added.size)   fields.push({ name: s.role_added,   value: added.map(r => `<@&${r.id}>`).join(', ') });
        if (removed.size) fields.push({ name: s.role_removed, value: removed.map(r => `<@&${r.id}>`).join(', ') });

        const embed = new EmbedBuilder()
            .setColor(added.size ? 0x3BA55D : 0xED4245)
            .setTitle(s.role_title)
            .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
            .addFields({ name: s.field_member, value: `<@${user.id}>`, inline: true }, ...fields)
            .setTimestamp();

        await sendLog(client, guildId, embed);
    })
}).toJSON();

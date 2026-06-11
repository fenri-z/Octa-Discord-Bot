const Event        = require('../../structure/Event');
const { EmbedBuilder } = require('discord.js');
const { getLang, getStrings } = require('../../utils/BotLang');

async function sendLog(client, guildId, embed) {
    const db        = client.database;
    const channelId = db.get(`extlog-channel-${guildId}`);
    if (!channelId) return;
    const guild   = client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);
    if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(() => null);
}

function isEnabled(client, guildId, event) {
    const db  = client.database;
    if (db.get(`extlog-enabled-${guildId}`) !== 'true') return false;
    const raw = db.get(`extlog-events-${guildId}`);
    if (!raw) return true;
    try { return JSON.parse(raw)[event] !== false; } catch { return true; }
}

module.exports = new Event({
    event: 'messageUpdate',
    once:  false,
    run: async (client, oldMsg, newMsg) => {
        if (!newMsg.guild || newMsg.author?.bot) return;
        if (oldMsg.content === newMsg.content) return;
        if (!isEnabled(client, newMsg.guild.id, 'messageEdit')) return;

        const s = getStrings(getLang(client.database, newMsg.guild.id)).extlog_event;

        const embed = new EmbedBuilder()
            .setColor(0xF0A032)
            .setTitle(s.msg_edit_title)
            .setAuthor({ name: newMsg.author.tag, iconURL: newMsg.author.displayAvatarURL() })
            .addFields(
                { name: s.field_channel, value: `<#${newMsg.channel.id}>`, inline: true },
                { name: s.field_link,    value: s.field_link_val(newMsg.url), inline: true },
                { name: s.field_before,  value: (oldMsg.content || s.field_empty).substring(0, 1000) },
                { name: s.field_after,   value: (newMsg.content || s.field_empty).substring(0, 1000) },
            )
            .setTimestamp();

        await sendLog(client, newMsg.guild.id, embed);
    }
}).toJSON();

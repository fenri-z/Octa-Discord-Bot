const Event        = require('../../structure/Event');
const { EmbedBuilder } = require('discord.js');
const { getLang, getStrings } = require('../../utils/BotLang');

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
    if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(() => null);
}

module.exports = new Event({
    event: 'messageDelete',
    once:  false,
    run: async (client, message) => {
        if (!message.guild) return;
        if (message.author?.bot) return;
        if (!isEnabled(client, message.guild.id, 'messageDelete')) return;

        const s = getStrings(getLang(client.database, message.guild.id)).extlog_event;

        const embed = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle(s.msg_del_title)
            .addFields(
                { name: s.field_channel, value: `<#${message.channel.id}>`, inline: true },
                { name: s.field_sender,  value: message.author ? `<@${message.author.id}> (${message.author.tag})` : 'Unknown', inline: true },
                { name: s.field_content, value: (message.content || s.field_no_text).substring(0, 1000) },
            )
            .setTimestamp();

        if (message.author)
            embed.setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() });

        await sendLog(client, message.guild.id, embed);
    }
}).toJSON();

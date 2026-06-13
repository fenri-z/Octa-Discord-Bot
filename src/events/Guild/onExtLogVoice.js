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
    if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(err => logError('[ExtLogVoice] sendLog failed:', err));
}

module.exports = new Event({
    event: 'voiceStateUpdate',
    once:  false,
    run: safeRun('[onExtLogVoice]', async (client, oldState, newState) => {
        const guildId = newState.guild.id;
        if (!isEnabled(client, guildId, 'voiceActivity')) return;

        const member = newState.member;
        if (!member || member.user.bot) return;

        const s = getStrings(getLang(client.database, guildId)).extlog_event;

        let title, color;
        let fields = [{ name: s.field_member, value: `<@${member.id}> (${member.user.tag})`, inline: true }];

        if (!oldState.channelId && newState.channelId) {
            title = s.voice_join;
            color = 0x3BA55D;
            fields.push({ name: s.field_channel, value: `<#${newState.channelId}>`, inline: true });
        } else if (oldState.channelId && !newState.channelId) {
            title = s.voice_leave;
            color = 0xED4245;
            fields.push({ name: s.field_channel, value: `<#${oldState.channelId}>`, inline: true });
        } else if (oldState.channelId !== newState.channelId) {
            title = s.voice_move;
            color = 0xF0A032;
            fields.push(
                { name: s.field_from, value: `<#${oldState.channelId}>`, inline: true },
                { name: s.field_to,   value: `<#${newState.channelId}>`, inline: true },
            );
        } else {
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
            .addFields(fields)
            .setTimestamp();

        await sendLog(client, guildId, embed);
    })
}).toJSON();

const Event        = require('../../structure/Event');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { safeRun, logError } = require('../../utils/logError');

async function handleReaction(client, reaction, user, isAdd) {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (reaction.message.partial) await reaction.message.fetch().catch(() => null);

    const { message } = reaction;
    if (!message.guild) return;

    const db      = client.database;
    const guildId = message.guild.id;

    if (db.get(`starboard-enabled-${guildId}`) !== 'true') return;

    const sbChannelId = db.get(`starboard-channel-${guildId}`);
    if (!sbChannelId) return;

    const emoji     = db.get(`starboard-emoji-${guildId}`) || '⭐';
    const threshold = parseInt(db.get(`starboard-threshold-${guildId}`) || '3');

    if (reaction.emoji.name !== emoji && reaction.emoji.toString() !== emoji) return;
    if (message.channel.id === sbChannelId) return; // jangan re-star pesan starboard

    const count = reaction.count;

    const existingKey = `starboard-msg-${guildId}-${message.id}`;
    const existingId  = db.get(existingKey);

    const sbChannel = message.guild.channels.cache.get(sbChannelId);
    if (!sbChannel?.isTextBased()) return;

    if (count < threshold) {
        // Hapus dari starboard jika sudah ada dan bintang berkurang
        if (existingId) {
            const sbMsg = await sbChannel.messages.fetch(existingId).catch(() => null);
            if (sbMsg) await sbMsg.delete().catch(() => null);
            db.delete(existingKey);
        }
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0xF0A032)
        .setAuthor({
            name:    message.author.username,
            iconURL: message.author.displayAvatarURL({ size: 64 }),
        })
        .setDescription(message.content || null)
        .addFields({ name: 'Source', value: `[Jump to Message](${message.url})`, inline: true })
        .setTimestamp(message.createdAt);

    const img = message.attachments.find(a => a.contentType?.startsWith('image/'));
    if (img) embed.setImage(img.url);

    const content = `${emoji} **${count}** | <#${message.channel.id}>`;

    if (existingId) {
        // Update pesan yang sudah ada
        const sbMsg = await sbChannel.messages.fetch(existingId).catch(() => null);
        if (sbMsg) await sbMsg.edit({ content, embeds: [embed] }).catch(err => logError('[Starboard] edit failed:', err));
    } else {
        // Kirim pesan baru ke starboard
        const sent = await sbChannel.send({ content, embeds: [embed] }).catch(err => logError('[Starboard] send failed:', err));
        if (sent) db.set(existingKey, sent.id);
    }
}

module.exports = new Event({
    event: 'messageReactionAdd',
    once:  false,
    run:   safeRun('[onStarboardReaction]', (client, reaction, user) => handleReaction(client, reaction, user, true)),
}).toJSON();

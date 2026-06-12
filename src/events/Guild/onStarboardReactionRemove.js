const Event = require('../../structure/Event');
const { safeRun } = require('../../utils/logError');

// Import handler yang sama dari onStarboardReaction
async function handleReaction(client, reaction, user) {
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
    if (message.channel.id === sbChannelId) return;

    const count      = reaction.count;
    const existingKey = `starboard-msg-${guildId}-${message.id}`;
    const existingId  = db.get(existingKey);

    const sbChannel = message.guild.channels.cache.get(sbChannelId);
    if (!sbChannel?.isTextBased()) return;

    if (count < threshold && existingId) {
        const sbMsg = await sbChannel.messages.fetch(existingId).catch(() => null);
        if (sbMsg) await sbMsg.delete().catch(() => null);
        db.delete(existingKey);
    }
}

module.exports = new Event({
    event: 'messageReactionRemove',
    once:  false,
    run:   safeRun('[onStarboardReactionRemove]', (client, reaction, user) => handleReaction(client, reaction, user)),
}).toJSON();

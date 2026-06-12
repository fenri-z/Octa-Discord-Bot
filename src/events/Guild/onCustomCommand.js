const Event        = require('../../structure/Event');
const { EmbedBuilder } = require('discord.js');
const cache        = require('../../utils/GuildCache');

module.exports = new Event({
    event: 'messageCreate',
    once:  false,
    run: async (client, message) => {
        if (!message.guild || message.author.bot || message.webhookId) return;

        const db      = client.database;
        const guildId = message.guild.id;

        const cacheKey = `customcmd-list-${guildId}`;
        let raw = cache.get(cacheKey);
        if (raw === null) {
            raw = db.get(cacheKey);
            if (raw) cache.set(cacheKey, raw);
        }
        if (!raw) return;

        let commands;
        try { commands = JSON.parse(raw); } catch { return; }
        if (!Array.isArray(commands) || commands.length === 0) return;

        const botPrefix    = (db.get(`prefix_${guildId}`) || '').toLowerCase().trim();
        const content      = message.content.trim().toLowerCase();
        // Content with server prefix stripped (so trigger "rules" also matches "?rules")
        const contentNaked = (botPrefix && content.startsWith(botPrefix))
            ? content.slice(botPrefix.length).trimStart()
            : null;

        for (const cmd of commands) {
            if (!cmd.enabled) continue;
            const trigger = (cmd.trigger || '').toLowerCase().trim();
            if (!trigger) continue;

            let matches;
            if (cmd.mode === 'exact') {
                matches = content === trigger ||
                          (contentNaked !== null && contentNaked === trigger);
            } else {
                matches = content.startsWith(trigger) ||
                          (contentNaked !== null && contentNaked.startsWith(trigger));
            }
            if (!matches) continue;

            if (cmd.responseType === 'embed') {
                const res   = cmd.response || {};
                const embed = new EmbedBuilder()
                    .setColor(res.color || '#5865F2');
                if (res.title)       embed.setTitle(replacePlaceholders(res.title, message));
                if (res.description) embed.setDescription(replacePlaceholders(res.description, message));
                await message.channel.send({ embeds: [embed] }).catch(() => null);
            } else {
                const text = (cmd.response && cmd.response.text) || '';
                await message.channel.send({
                    content: replacePlaceholders(text, message),
                    allowedMentions: { parse: ['users', 'roles'] },
                }).catch(() => null);
            }
            break;
        }
    }
}).toJSON();

function replacePlaceholders(text, message) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/\{member\}/g,   `<@${message.author.id}>`)
        .replace(/\{username\}/g, message.author.username)
        .replace(/\{server\}/g,   message.guild.name)
        .replace(/\{channel\}/g,  `<#${message.channel.id}>`);
}

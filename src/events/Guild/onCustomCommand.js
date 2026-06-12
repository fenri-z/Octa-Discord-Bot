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

            if (cmd.responseType === 'embed' || cmd.responseType === 'both') {
                const res   = cmd.response || {};
                const rp    = (t) => replacePlaceholders(t, message);
                const embed = new EmbedBuilder().setColor(res.color || '#5865F2');

                if (res.author?.name) {
                    const ao = { name: rp(res.author.name) };
                    if (res.author.iconURL) try { new URL(res.author.iconURL); ao.iconURL = res.author.iconURL; } catch {}
                    embed.setAuthor(ao);
                }
                if (res.title)       embed.setTitle(rp(res.title));
                if (res.description) embed.setDescription(rp(res.description));
                if (Array.isArray(res.fields) && res.fields.length) {
                    try {
                        embed.addFields(res.fields.filter(f => f.name && f.value).map(f => ({
                            name: rp(f.name), value: rp(f.value), inline: !!f.inline,
                        })));
                    } catch {}
                }
                if (res.thumbnailURL) try { embed.setThumbnail(res.thumbnailURL); } catch {}
                if (res.imageURL)     try { embed.setImage(res.imageURL); } catch {}
                if (res.footer?.text) {
                    const fo = { text: rp(res.footer.text) };
                    if (res.footer.iconURL) try { new URL(res.footer.iconURL); fo.iconURL = res.footer.iconURL; } catch {}
                    embed.setFooter(fo);
                }
                if (res.timestamp) embed.setTimestamp();

                const sendOpts = { embeds: [embed] };
                if (cmd.responseType === 'both' && res.text) {
                    sendOpts.content = rp(res.text);
                    sendOpts.allowedMentions = { parse: ['users', 'roles'] };
                }
                await message.channel.send(sendOpts).catch(() => null);
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

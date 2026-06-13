const Event        = require('../../structure/Event');
const { EmbedBuilder } = require('discord.js');
const cache        = require('../../utils/GuildCache');
const { logError } = require('../../utils/logError');

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
                const prefixMatch = (str) =>
                    str === trigger || str.startsWith(trigger + ' ');
                matches = prefixMatch(content) ||
                          (contentNaked !== null && prefixMatch(contentNaked));
            }
            if (!matches) continue;

            if (cmd.responseType === 'embed' || cmd.responseType === 'both') {
                const res   = cmd.response || {};
                const rp    = (t) => replacePlaceholders(t, message);
                const embed = new EmbedBuilder().setColor(res.color || '#5865F2');

                if (res.author?.name) {
                    const resolvedName = rp(res.author.name);
                    if (resolvedName) {
                        const ao = { name: resolvedName };
                        if (res.author.iconURL) { const ri = rp(res.author.iconURL); try { new URL(ri); ao.iconURL = ri; } catch {} }
                        if (res.author.url)     try { new URL(res.author.url); ao.url = res.author.url; } catch {}
                        try { embed.setAuthor(ao); } catch {}
                    }
                }
                if (res.title) {
                    const resolvedTitle = rp(res.title);
                    if (resolvedTitle) {
                        try { embed.setTitle(resolvedTitle); } catch {}
                        if (res.titleUrl) try { embed.setURL(res.titleUrl); } catch {}
                    }
                }
                if (res.description) {
                    const resolvedDesc = rp(res.description);
                    if (resolvedDesc) try { embed.setDescription(resolvedDesc); } catch {}
                }
                if (Array.isArray(res.fields) && res.fields.length) {
                    try {
                        embed.addFields(res.fields.filter(f => f.name && f.value).map(f => ({
                            name:   rp(f.name)  || '​',
                            value:  rp(f.value) || '​',
                            inline: !!f.inline,
                        })));
                    } catch {}
                }
                if (res.thumbnailURL) { const rt = rp(res.thumbnailURL); try { embed.setThumbnail(rt); } catch {} }
                if (res.imageURL)     { const ri = rp(res.imageURL);     try { embed.setImage(ri);     } catch {} }
                if (res.footer?.text) {
                    const resolvedFooter = rp(res.footer.text);
                    if (resolvedFooter) {
                        const fo = { text: resolvedFooter };
                        if (res.footer.iconURL) { const rfi = rp(res.footer.iconURL); try { new URL(rfi); fo.iconURL = rfi; } catch {} }
                        try { embed.setFooter(fo); } catch {}
                    }
                }
                if (res.timestamp) embed.setTimestamp();

                const sendOpts = { embeds: [embed] };
                if (cmd.responseType === 'both' && res.text) {
                    sendOpts.content = rp(res.text);
                    sendOpts.allowedMentions = { parse: ['users', 'roles'] };
                }
                if (res.plainImageURL) {
                    const ri = rp(res.plainImageURL);
                    try { new URL(ri); if (isDirectImageUrl(ri)) sendOpts.files = [{ attachment: ri }]; } catch {}
                }
                await message.channel.send(sendOpts).catch(err => logError('[onCustomCommand] send failed:', err));
            } else {
                const text     = (cmd.response && cmd.response.text) || '';
                const plainImg = (cmd.response && cmd.response.plainImageURL) || '';
                const sendOpts = {
                    content: replacePlaceholders(text, message),
                    allowedMentions: { parse: ['users', 'roles'] },
                };
                if (plainImg) {
                    const ri = replacePlaceholders(plainImg, message);
                    try { new URL(ri); if (isDirectImageUrl(ri)) sendOpts.files = [{ attachment: ri }]; } catch {}
                }
                await message.channel.send(sendOpts).catch(err => logError('[onCustomCommand] send failed:', err));
            }
            break;
        }
    }
}).toJSON();

function isDirectImageUrl(url) {
    return /\.(png|jpe?g|gif|webp|bmp|avif)(?:[?#]|$)/i.test(url);
}

function replacePlaceholders(text, message) {
    if (!text || typeof text !== 'string') return '';
    const nickname      = message.member?.displayName || message.author.username;
    const avatarUrl     = message.author.displayAvatarURL?.({ extension: 'png', size: 256 }) || '';
    const serverIconUrl = message.guild.iconURL?.({ extension: 'png', size: 256 }) || '';
    return text
        // Dot-notation placeholders (process multi-part first to avoid partial matches)
        .replace(/\{user\.username\}/g, message.author.username)
        .replace(/\{user\.id\}/g,       message.author.id)
        .replace(/\{user\.avatar\}/g,   avatarUrl)
        .replace(/\{user\.mention\}/g,  `<@${message.author.id}>`)
        .replace(/\{user\}/g,           `<@${message.author.id}>`)
        .replace(/\{server\.name\}/g,   message.guild.name)
        .replace(/\{server\.id\}/g,     message.guild.id)
        .replace(/\{server\.icon\}/g,   serverIconUrl)
        // Legacy placeholders (backward compat)
        .replace(/\{member\}/g,         `<@${message.author.id}>`)
        .replace(/\{username\}/g,       message.author.username)
        .replace(/\{nickname\}/g,       nickname)
        .replace(/\{id\}/g,             message.author.id)
        .replace(/\{tag\}/g,            message.author.username)
        .replace(/\{server\}/g,         message.guild.name)
        .replace(/\{channel\}/g,        `<#${message.channel.id}>`);
}

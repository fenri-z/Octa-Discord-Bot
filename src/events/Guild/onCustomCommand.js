const Event        = require('../../structure/Event');
const { EmbedBuilder } = require('discord.js');

module.exports = new Event({
    event: 'messageCreate',
    once:  false,
    run: async (client, message) => {
        if (!message.guild || message.author.bot || message.webhookId) return;

        const db      = client.database;
        const guildId = message.guild.id;

        const raw = db.get(`customcmd-list-${guildId}`);
        if (!raw) return;

        let commands;
        try { commands = JSON.parse(raw); } catch { return; }
        if (!Array.isArray(commands) || commands.length === 0) return;

        const content = message.content.trim().toLowerCase();

        for (const cmd of commands) {
            if (!cmd.enabled) continue;
            const trigger = (cmd.trigger || '').toLowerCase().trim();
            if (!trigger) continue;

            // Cocokkan: mulai dengan trigger (prefix-style) atau persis sama
            const matches = cmd.exactMatch
                ? content === trigger
                : content.startsWith(trigger);
            if (!matches) continue;

            if (cmd.embedEnabled) {
                const embed = new EmbedBuilder()
                    .setColor(cmd.embedColor || '#5865F2')
                    .setDescription(replacePlaceholders(cmd.response, message));
                if (cmd.embedTitle)
                    embed.setTitle(replacePlaceholders(cmd.embedTitle, message));
                await message.channel.send({ embeds: [embed] }).catch(() => null);
            } else {
                await message.channel.send({
                    content: replacePlaceholders(cmd.response, message),
                    allowedMentions: { parse: ['users', 'roles'] },
                }).catch(() => null);
            }
            break; // hanya jalankan command pertama yang cocok
        }
    }
}).toJSON();

function replacePlaceholders(text, message) {
    if (!text) return '';
    return text
        .replace(/\{member\}/g,   `<@${message.author.id}>`)
        .replace(/\{username\}/g, message.author.username)
        .replace(/\{server\}/g,   message.guild.name)
        .replace(/\{channel\}/g,  `<#${message.channel.id}>`);
}

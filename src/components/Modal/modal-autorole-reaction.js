const { ModalSubmitInteraction, EmbedBuilder, MessageFlags } = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");
const { getLang, getStrings } = require('../../utils/BotLang');

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPanel(client, guildId, name) {
    const raw = client.database.get(`autoreact-${guildId}-${name}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function savePanel(client, guildId, name, data) {
    client.database.set(`autoreact-${guildId}-${name}`, JSON.stringify(data));
    const rawList = client.database.get(`autoreact-list-${guildId}`);
    let list = [];
    if (rawList && typeof rawList === 'string') {
        try { list = JSON.parse(rawList); } catch { list = []; }
    }
    if (!list.includes(name)) {
        list.push(name);
        client.database.set(`autoreact-list-${guildId}`, JSON.stringify(list));
    }
}

function getSentPanel(client, guildId, panelName) {
    const raw = client.database.get(`autoreact-sent-${guildId}-${panelName}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function buildPanelEmbed(panel) {
    const embed = new EmbedBuilder();
    const colorHex = panel.embedColor && /^#?[0-9A-Fa-f]{6}$/.test(panel.embedColor.trim())
        ? (panel.embedColor.startsWith('#') ? panel.embedColor : `#${panel.embedColor}`)
        : '#5865F2';
    embed.setColor(colorHex);
    if (panel.embedTitle)       embed.setTitle(panel.embedTitle.slice(0, 256));
    if (panel.embedDescription) embed.setDescription(panel.embedDescription.slice(0, 4096));
    if (panel.embedAuthorName)  embed.setAuthor({ name: panel.embedAuthorName.slice(0, 256), url: panel.embedAuthorUrl || undefined, iconURL: panel.embedAuthorIcon || undefined });
    if (panel.embedTitleUrl)    embed.setURL(panel.embedTitleUrl);
    if (panel.embedFooter || panel.embedFooterIcon) embed.setFooter({ text: (panel.embedFooter || '').slice(0, 2048), iconURL: panel.embedFooterIcon || undefined });
    if (panel.embedTimestamp)   embed.setTimestamp();
    if (panel.embedImage)       embed.setImage(panel.embedImage);
    if (panel.embedThumbnail)   embed.setThumbnail(panel.embedThumbnail);
    const embedFields = (panel.embedFields || []).filter(f => f.name && f.value).slice(0, 25);
    if (embedFields.length) embed.addFields(embedFields.map(f => ({ name: f.name.slice(0, 256), value: f.value.slice(0, 1024), inline: !!f.inline })));
    return embed;
}

// ── Modal Handler ─────────────────────────────────────────────────────────────

module.exports = new Component({
    customId: 'autoreact-modal',  // prefix match: autoreact-modal:<panelName>
    type: 'modal',

    /**
     * @param {DiscordBot} client
     * @param {ModalSubmitInteraction} interaction
     */
    run: async (client, interaction) => {
        const guildId = interaction.guild.id;
        const userId  = interaction.user.id;
        const s = getStrings(getLang(client.database, guildId)).autorole_reaction;

        const rawPending = client.database.get(`autoreact-pending-${guildId}-${userId}`);
        if (!rawPending) {
            return interaction.reply({
                content: s.session_expired,
                flags: MessageFlags.Ephemeral
            });
        }

        client.database.delete(`autoreact-pending-${guildId}-${userId}`);

        let pending;
        try { pending = JSON.parse(rawPending); }
        catch { return interaction.reply({ content: s.session_corrupt, flags: MessageFlags.Ephemeral }); }

        const { nama, mode, isNew } = pending;
        const existing = getPanel(client, guildId, nama);
        const now      = Date.now();

        // Read all 4 modal fields — plain text presence determines message type
        let embedTitle = '', embedDescription = '', embedFooter = '', plainText = '';
        try { embedTitle       = interaction.fields.getTextInputValue('autoreact-field-title').trim(); } catch {}
        try { embedDescription = interaction.fields.getTextInputValue('autoreact-field-description').trim(); } catch {}
        try { embedFooter      = interaction.fields.getTextInputValue('autoreact-field-footer').trim(); } catch {}
        try { plainText        = interaction.fields.getTextInputValue('autoreact-field-plaintext').trim(); } catch {}

        const messageType = plainText ? 'plain' : 'embed';

        const panel = {
            name:             nama,
            mode,
            embedTitle,
            embedDescription,
            embedFooter,
            messageType,
            plainText,
            embedColor:      existing?.embedColor      || '#5865F2',
            embedImage:      existing?.embedImage      || '',
            embedThumbnail:  existing?.embedThumbnail  || '',
            embedAuthorName: existing?.embedAuthorName || '',
            embedAuthorUrl:  existing?.embedAuthorUrl  || '',
            embedAuthorIcon: existing?.embedAuthorIcon || '',
            embedTitleUrl:   existing?.embedTitleUrl   || '',
            embedFooterIcon: existing?.embedFooterIcon || '',
            embedTimestamp:  existing?.embedTimestamp  || false,
            embedFields:     existing?.embedFields     || [],
            reactions:       existing?.reactions       || [],
            createdAt:       existing?.createdAt       || now,
            updatedAt:       now
        };

        savePanel(client, guildId, nama, panel);

        const sent = getSentPanel(client, guildId, nama);
        let statusStr = '';

        if (sent) {
            const channel = interaction.guild.channels.cache.get(sent.channelId)
                ?? await interaction.guild.channels.fetch(sent.channelId).catch(() => null);
            if (channel) {
                let message = null;
                try { message = await channel.messages.fetch(sent.messageId); } catch {}
                if (message) {
                    try {
                        if (panel.messageType === 'plain') {
                            await message.edit({ content: (panel.plainText || '').slice(0, 2000), embeds: [] });
                        } else {
                            await message.edit({ embeds: [buildPanelEmbed(panel)], content: null });
                        }
                        statusStr = s.modal_live_ok(guildId, sent.channelId, sent.messageId);
                    } catch {
                        statusStr = s.modal_live_fail(nama);
                    }
                } else {
                    statusStr = s.modal_msg_gone(nama);
                }
            } else {
                statusStr = s.modal_ch_gone(nama);
            }
        } else {
            statusStr = s.modal_not_sent_yet(nama);
        }

        const isEmpty  = messageType === 'embed' && !embedTitle && !embedDescription;
        const modeIcon = mode === 'single' ? '🔘 Single (radio)' : '✅ Multi';

        const fields = [
            { name: '🔧 Mode',          value: modeIcon,                         inline: true },
            { name: '✨ Reactions',      value: `${panel.reactions.length}/20`,   inline: true },
            { name: '🎨 Embed Color',    value: panel.embedColor,                  inline: true },
        ];

        if (isEmpty) {
            fields.push({
                name: '⚠️ Notice',
                value: 'Title and description are still empty. Fill in at least one so the embed is visible.',
                inline: false
            });
        }

        fields.push({
            name: '🛠️ Next Steps',
            value: [
                `• \`/autorole-reaction add-reaction\` — add emoji + role`,
                `• \`/autorole-reaction set-color\` — change embed color`,
                `• \`/autorole-reaction set-author\` — set embed author`,
                `• \`/autorole-reaction edit ${nama}\` — edit content again`,
                `• \`/autorole-reaction preview ${nama}\` — preview the panel`,
                `• \`/autorole-reaction send ${nama}\` — send to a channel`
            ].join('\n'),
            inline: false
        });

        fields.push({ name: '📤 Status', value: statusStr, inline: false });

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(isNew ? '#57F287' : '#FEE75C')
                    .setTitle(isNew ? s.modal_created(nama) : s.modal_updated(nama))
                    .addFields(...fields)
                    .setTimestamp()
            ],
            flags: MessageFlags.Ephemeral
        });
    }
}).toJSON();

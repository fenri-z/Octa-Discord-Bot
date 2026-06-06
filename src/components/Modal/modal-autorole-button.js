const { ModalSubmitInteraction, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPanel(client, guildId, name) {
    const raw = client.database.get(`autobtn-${guildId}-${name}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function savePanel(client, guildId, name, data) {
    client.database.set(`autobtn-${guildId}-${name}`, JSON.stringify(data));
    const rawList = client.database.get(`autobtn-list-${guildId}`);
    let list = [];
    if (rawList && typeof rawList === 'string') {
        try { list = JSON.parse(rawList); } catch { list = []; }
    }
    if (!list.includes(name)) {
        list.push(name);
        client.database.set(`autobtn-list-${guildId}`, JSON.stringify(list));
    }
}

function getSentPanel(client, guildId, panelName) {
    const raw = client.database.get(`autobtn-sent-${guildId}-${panelName}`);
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
    if (panel.embedFooter)      embed.setFooter({ text: panel.embedFooter.slice(0, 2048) });
    if (panel.embedImage)       embed.setImage(panel.embedImage);
    if (panel.embedThumbnail)   embed.setThumbnail(panel.embedThumbnail);
    return embed;
}

function buildButtonRows(panel) {
    const rows = [];
    let rowIndex = 0, colIndex = 0;
    let currentRow = new ActionRowBuilder();
    for (const btn of panel.buttons) {
        if (colIndex === 5) { rows.push(currentRow); currentRow = new ActionRowBuilder(); rowIndex++; colIndex = 0; }
        if (rowIndex >= 5) break;
        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`autobtn:${panel.mode}:${panel.name}:${btn.roleId}`)
                .setLabel(btn.label)
                .setStyle(btn.style || ButtonStyle.Primary)
        );
        colIndex++;
    }
    if (colIndex > 0) rows.push(currentRow);
    return rows;
}

// ── Modal Handler ─────────────────────────────────────────────────────────────

module.exports = new Component({
    customId: 'autobtn-modal',  // prefix match: autobtn-modal:<panelName>
    type: 'modal',

    /**
     * @param {DiscordBot} client
     * @param {ModalSubmitInteraction} interaction
     */
    run: async (client, interaction) => {
        const guildId = interaction.guild.id;
        const userId  = interaction.user.id;

        // Read pending data { nama, mode, isNew }
        const rawPending = client.database.get(`autobtn-pending-${guildId}-${userId}`);
        if (!rawPending) {
            return interaction.reply({
                content: '❌ Session expired. Run `/autorole-button create` again.',
                flags: MessageFlags.Ephemeral
            });
        }

        client.database.delete(`autobtn-pending-${guildId}-${userId}`);

        let pending;
        try { pending = JSON.parse(rawPending); } catch {
            return interaction.reply({ content: '❌ Session data corrupted. Please try again.', flags: MessageFlags.Ephemeral });
        }

        const { nama, mode, isNew, pendingType } = pending;

        // Read existing panel data (to preserve buttons, color, image, etc.)
        const existing = getPanel(client, guildId, nama);
        const now      = Date.now();

        // ── PLAIN TYPE: switch message type to plain text ───────────────────────────
        if (pendingType === 'plain') {
            let plainText = '';
            try { plainText = interaction.fields.getTextInputValue('autobtn-field-plaintext').trim(); } catch {}
            if (!existing) return interaction.reply({ content: `❌ Panel \`${nama}\` not found.`, flags: MessageFlags.Ephemeral });
            const panel = { ...existing, messageType: 'plain', plainText, updatedAt: Date.now() };
            savePanel(client, guildId, nama, panel);

            // If already sent, update the Discord message
            const sent = getSentPanel(client, guildId, nama);
            let statusStr = '';
            if (sent) {
                const channel = interaction.guild.channels.cache.get(sent.channelId)
                    ?? await interaction.guild.channels.fetch(sent.channelId).catch(() => null);
                if (channel) {
                    const rows = buildButtonRows(panel);
                    let message = null;
                    try { message = await channel.messages.fetch(sent.messageId); } catch {}
                    if (message) {
                        try {
                            await message.edit({ content: plainText.slice(0, 2000), embeds: [], components: rows });
                            statusStr = `\n✅ Discord message updated live!`;
                        } catch { statusStr = `\n⚠️ Failed to update Discord message.`; }
                    }
                }
            }

            return interaction.reply({
                content: `✅ Panel \`${nama}\` switched to **Plain Text**.${statusStr}\nUse \`/autorole-button preview ${nama}\` to preview.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Read form values (with try/catch so it won't throw if a field is missing)
        let embedTitle = '', embedDescription = '', embedFooter = '';
        try { embedTitle       = interaction.fields.getTextInputValue('autobtn-field-title').trim(); } catch {}
        try { embedDescription = interaction.fields.getTextInputValue('autobtn-field-description').trim(); } catch {}
        try { embedFooter      = interaction.fields.getTextInputValue('autobtn-field-footer').trim(); } catch {}

        const panel = {
            name:             nama,
            mode,
            embedTitle,
            embedDescription,
            embedFooter,
            embedColor:     existing?.embedColor     || '#5865F2',
            embedImage:     existing?.embedImage     || '',
            embedThumbnail: existing?.embedThumbnail || '',
            defaultStyle:   existing?.defaultStyle   || null,
            buttons:        existing?.buttons        || [],
            messageType:    existing?.messageType    || 'embed',
            plainText:      existing?.plainText      || '',
            createdAt:      existing?.createdAt      || now,
            updatedAt:      now
        };

        savePanel(client, guildId, nama, panel);

        // If the panel was already sent, update the Discord message live
        const sent = getSentPanel(client, guildId, nama);
        let statusStr = '';
        let updatedLive = false;

        if (sent) {
            const channel = interaction.guild.channels.cache.get(sent.channelId)
                ?? await interaction.guild.channels.fetch(sent.channelId).catch(() => null);

            if (channel) {
                let message = null;
                try { message = await channel.messages.fetch(sent.messageId); } catch { message = null; }

                if (message) {
                    try {
                        if (panel.messageType === 'plain') {
                            await message.edit({
                                content: (panel.plainText || '').slice(0, 2000),
                                embeds: [],
                                components: panel.buttons.length > 0 ? buildButtonRows(panel) : []
                            });
                        } else {
                            await message.edit({
                                embeds:     [buildPanelEmbed(panel)],
                                content:    null,
                                components: panel.buttons.length > 0 ? buildButtonRows(panel) : []
                            });
                        }
                        updatedLive = true;
                        statusStr = `✅ Sent message updated live!\n🔗 https://discord.com/channels/${guildId}/${sent.channelId}/${sent.messageId}`;
                    } catch {
                        statusStr = `⚠️ Failed to update the message. Resend: \`/autorole-button send ${nama}\``;
                    }
                } else {
                    statusStr = `📭 Message was deleted. Resend: \`/autorole-button send ${nama}\``;
                }
            } else {
                statusStr = `📭 Channel not found. Resend: \`/autorole-button send ${nama}\``;
            }
        } else {
            statusStr = `📭 Panel not sent yet. Use \`/autorole-button send ${nama}\` after finishing button setup.`;
        }

        const isEmpty  = !embedTitle && !embedDescription;
        const modeIcon = mode === 'single' ? '🔘 Single (radio)' : '✅ Multi';

        // Build fields array
        const fields = [
            { name: '🔧 Mode',       value: modeIcon,                     inline: true },
            { name: '🎭 Buttons',     value: `${panel.buttons.length}/25`, inline: true },
            { name: '🎨 Embed Color', value: panel.embedColor,             inline: true },
        ];

        if (isEmpty) {
            fields.push({
                name: '⚠️ Notice',
                value: 'Title and description are still empty. Fill in at least one so the embed is visible.',
                inline: false
            });
        }

        if (!isNew) {
            fields.push({
                name: '🛠️ Next Steps',
                value: [
                    `• \`/autorole-button add-button\` — add a role button`,
                    `• \`/autorole-button set-color\` — change embed color`,
                    `• \`/autorole-button set-image\` — add an image`,
                    `• \`/autorole-button set-thumbnail\` — add a thumbnail`,
                    `• \`/autorole-button preview ${nama}\` — preview the panel`,
                    `• \`/autorole-button send ${nama}\` — send to a channel`
                ].join('\n'),
                inline: false
            });
        } else {
            fields.push({
                name: '🛠️ Next Steps',
                value: 'Click **➕ Add Button Now** below to immediately add the first button to this panel.',
                inline: false
            });
        }

        fields.push({ name: '📤 Status', value: statusStr, inline: false });

        const embed = new EmbedBuilder()
            .setColor(isNew ? '#57F287' : '#FEE75C')
            .setTitle(isNew ? `✅ Panel \`${nama}\` Created` : `✏️ Panel \`${nama}\` Updated`)
            .addFields(...fields)
            .setTimestamp();

        // For new panels: show quick action buttons so the user can add a button right away
        if (isNew) {
            const quickRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`autobtn-quickadd:${nama}`)
                    .setLabel('➕ Add Button Now')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`autobtn-quickskip:${nama}`)
                    .setLabel('⏭️ Skip')
                    .setStyle(ButtonStyle.Secondary)
            );
            return interaction.reply({ embeds: [embed], components: [quickRow], flags: MessageFlags.Ephemeral });
        }

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
}).toJSON();

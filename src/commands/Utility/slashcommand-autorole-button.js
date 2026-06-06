const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { resolveRole, resolveChannel } = require('../../utils/resolveGuildOption');
const { checkBotPermissions } = require('../../utils/checkBotPermissions');

// ── Helpers panel ──────────────────────────────────────────────────────────

function getPanelList(client, guildId) {
    const raw = client.database.get(`autobtn-list-${guildId}`);
    if (!raw || typeof raw !== 'string') return [];
    try { return JSON.parse(raw); } catch { return []; }
}

function savePanelList(client, guildId, list) {
    client.database.set(`autobtn-list-${guildId}`, JSON.stringify(list));
}

function getPanel(client, guildId, name) {
    const raw = client.database.get(`autobtn-${guildId}-${name}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function savePanel(client, guildId, name, data) {
    client.database.set(`autobtn-${guildId}-${name}`, JSON.stringify(data));
    const list = getPanelList(client, guildId);
    if (!list.includes(name)) { list.push(name); savePanelList(client, guildId, list); }
}

function deletePanel(client, guildId, name) {
    client.database.delete(`autobtn-${guildId}-${name}`);
    savePanelList(client, guildId, getPanelList(client, guildId).filter(n => n !== name));
}

// ── Helpers sentData panel ─────────────────────────────────────────────────

function getSentPanel(client, guildId, panelName) {
    const raw = client.database.get(`autobtn-sent-${guildId}-${panelName}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function saveSentPanel(client, guildId, panelName, messageId, channelId) {
    client.database.set(`autobtn-sent-${guildId}-${panelName}`, JSON.stringify({ messageId, channelId }));
}

function deleteSentPanel(client, guildId, panelName) {
    client.database.delete(`autobtn-sent-${guildId}-${panelName}`);
}

async function resolveSentMessage(client, guild, panelName) {
    const sent = getSentPanel(client, guild.id, panelName);
    if (!sent) return null;

    const channel = guild.channels.cache.get(sent.channelId)
        ?? await guild.channels.fetch(sent.channelId).catch(() => null);
    if (!channel) {
        deleteSentPanel(client, guild.id, panelName);
        return null;
    }

    let message = null;
    try {
        message = await channel.messages.fetch(sent.messageId);
    } catch {
        deleteSentPanel(client, guild.id, panelName);
        return null;
    }

    return { sent, message, channel };
}

// ── Embed & Button builder ─────────────────────────────────────────────────

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
    let rowIndex = 0;
    let colIndex = 0;
    let currentRow = new ActionRowBuilder();

    for (const btn of panel.buttons) {
        if (colIndex === 5) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
            rowIndex++;
            colIndex = 0;
        }
        if (rowIndex >= 5) break;

        const builder = new ButtonBuilder()
            .setCustomId(`autobtn:${panel.mode}:${panel.name}:${btn.roleId}`)
            .setLabel(btn.label)
            .setStyle(btn.style || ButtonStyle.Primary);

        currentRow.addComponents(builder);
        colIndex++;
    }

    if (colIndex > 0) rows.push(currentRow);
    return rows;
}

function isValidName(name) {
    return /^[a-zA-Z0-9_-]{1,32}$/.test(name);
}

const STYLE_MAP = {
    primary:   ButtonStyle.Primary,
    success:   ButtonStyle.Success,
    danger:    ButtonStyle.Danger,
    secondary: ButtonStyle.Secondary
};

const STYLE_LABEL = {
    [ButtonStyle.Primary]:   '🔵 Blue (Primary)',
    [ButtonStyle.Success]:   '🟢 Green (Success)',
    [ButtonStyle.Danger]:    '🔴 Red (Danger)',
    [ButtonStyle.Secondary]: '⚪ Gray (Secondary)'
};

// ── Command ────────────────────────────────────────────────────────────────
module.exports = new ApplicationCommand({
    command: {
        name: 'autorole-button',
        description: 'Create a button panel for members to self-assign/remove roles.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [

            // ── list ──────────────────────────────────────────────────────
            {
                name: 'list',
                description: 'View all existing autorole button panels.',
                type: 1
            },

            // ── buat ─────────────────────────────────────────────────────
            {
                name: 'create',
                description: 'Create a new panel or edit the embed appearance of an existing panel.',
                type: 1,
                options: [
                    {
                        name: 'name',
                        description: 'Panel name (letters, numbers, - and _, max 32 characters)',
                        type: 3,
                        required: true,
                        max_length: 32,
                        autocomplete: true
                    },
                    {
                        name: 'mode',
                        description: 'Multi = can click all buttons | Single = only 1 role active at a time',
                        type: 3,
                        required: false,
                        choices: [
                            { name: '✅ Multi  – can pick multiple roles at once', value: 'multi'  },
                            { name: '🔘 Single – only 1 role allowed (radio button)',  value: 'single' }
                        ]
                    }
                ]
            },

            // ── set-warna ─────────────────────────────────────────────────
            {
                name: 'set-color',
                description: 'Change the panel embed left border color.',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Panel name',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'hex',
                        description: 'Hex color code, e.g. #5865F2 or FF5733',
                        type: 3, required: true, max_length: 7
                    }
                ]
            },

            // ── set-gambar ────────────────────────────────────────────────
            {
                name: 'set-image',
                description: 'Set or remove the large image below the panel embed.',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Panel name',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'url',
                        description: 'Image URL (https://...). Type - to remove.',
                        type: 3, required: true
                    }
                ]
            },

            // ── set-thumbnail ─────────────────────────────────────────────
            {
                name: 'set-thumbnail',
                description: 'Set or remove the thumbnail (small corner image) of the panel embed.',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Panel name',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'url',
                        description: 'Thumbnail URL (https://...). Type - to remove.',
                        type: 3, required: true
                    }
                ]
            },

            // ── tambah-button ─────────────────────────────────────────────
            {
                name: 'add-button',
                description: 'Add a role button to a panel.',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Target panel name',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'role',
                        description: 'Role granted/removed when the button is clicked',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'label',
                        description: 'Button label text, can include emoji: 🎮 Gaming (max 80 characters)',
                        type: 3, required: true, max_length: 80
                    },
                    {
                        name: 'color',
                        description: 'Button color',
                        type: 3, required: false,
                        choices: [
                            { name: '🔵 Blue (Primary)',      value: 'primary'   },
                            { name: '🟢 Green (Success)',     value: 'success'   },
                            { name: '🔴 Red (Danger)',        value: 'danger'    },
                            { name: '⚪ Gray (Secondary)',    value: 'secondary' }
                        ]
                    }
                ]
            },

            // ── add-bulk ───────────────────────────────────────────────
            {
                name: 'add-bulk',
                description: 'Add multiple buttons at once. Format per line: @Role | Label | color',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Target panel name',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'data',
                        description: 'One line = 1 button: @Role | Label | color  (color optional, default: primary)',
                        type: 3, required: true, max_length: 2000
                    }
                ]
            },

            // ── edit-button ───────────────────────────────────────────────
            {
                name: 'edit-button',
                description: 'Edit the label or color of an existing button in a panel.',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Panel name containing the button',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'role',
                        description: 'Role whose button you want to edit',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'label',
                        description: 'New button label (max 80 characters)',
                        type: 3, required: false, max_length: 80
                    },
                    {
                        name: 'color',
                        description: 'New button color',
                        type: 3, required: false,
                        choices: [
                            { name: '🔵 Blue (Primary)',      value: 'primary'   },
                            { name: '🟢 Green (Success)',     value: 'success'   },
                            { name: '🔴 Red (Danger)',        value: 'danger'    },
                            { name: '⚪ Gray (Secondary)',    value: 'secondary' }
                        ]
                    }
                ]
            },

            // ── edit-bulk ─────────────────────────────────────────────────
            {
                name: 'edit-bulk',
                description: 'Edit label/color of multiple buttons at once. Format: @Role | New label | new color',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Panel name containing the buttons',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'data',
                        description: 'One line = 1 button: @Role | New label | new color  (both optional)',
                        type: 3, required: true, max_length: 2000
                    }
                ]
            },

            // ── hapus-button ──────────────────────────────────────────────
            {
                name: 'delete-button',
                description: 'Remove a button from a panel by role.',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Panel name',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'role',
                        description: 'Role whose button you want to remove',
                        type: 3, required: true, autocomplete: true
                    }
                ]
            },

            // ── hapus-bulk ────────────────────────────────────────────────
            {
                name: 'delete-bulk',
                description: 'Remove multiple buttons at once. Format per line: @Role',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Panel name containing the buttons',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'data',
                        description: 'One line = 1 role whose button will be removed: @Role',
                        type: 3, required: true, max_length: 2000
                    }
                ]
            },

            // ── kirim ─────────────────────────────────────────────────────
            {
                name: 'send',
                description: 'Send the panel to a specific channel (can only be sent once).',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Name of the panel to send',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'channel',
                        description: 'Target channel (empty = current channel)',
                        type: 3, required: false, autocomplete: true
                    }
                ]
            },

            // ── hapus-panel ───────────────────────────────────────────────
            {
                name: 'delete-panel',
                description: 'Delete the entire panel from the database.',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Name of the panel to delete',
                        type: 3, required: true, autocomplete: true
                    }
                ]
            },

            // ── color-button ──────────────────────────────────────────────
            {
                name: 'color-button',
                description: 'Set the default color for new buttons in a panel.',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Panel name whose default color you want to change',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'color',
                        description: 'New default color for all new buttons in this panel',
                        type: 3, required: true,
                        choices: [
                            { name: '🔵 Blue (Primary)',      value: 'primary'   },
                            { name: '🟢 Green (Success)',     value: 'success'   },
                            { name: '🔴 Red (Danger)',        value: 'danger'    },
                            { name: '⚪ Gray (Secondary)',    value: 'secondary' }
                        ]
                    }
                ]
            },

            // ── preview ───────────────────────────────────────────────────
            {
                name: 'preview',
                description: 'Preview the panel (only visible to you).',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Name of the panel to preview',
                        type: 3, required: true, autocomplete: true
                    }
                ]
            },

            // ── type ──────────────────────────────────────────────────────
            {
                name: 'type',
                description: 'Change the panel message type: embed or plain text.',
                type: 1,
                options: [
                    {
                        name: 'panel', description: 'Panel name',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'type', description: 'Desired message type',
                        type: 3, required: true,
                        choices: [
                            { name: 'Embed — message in a colored box', value: 'embed' },
                            { name: 'Plain Text — text without an embed box', value: 'plain' }
                        ]
                    }
                ]
            }
        ]
    },

    options: { botOwner: false },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const { guild, options } = interaction;
        const sub = options.getSubcommand();

        // ── Check bot permissions ──────────────────────────────────────
        const ok = await checkBotPermissions(interaction, [
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ManageRoles,
        ]);
        if (!ok) return;

        // ── /autorole-button list ──────────────────────────────────────────
        if (sub === 'list') {
            const list = getPanelList(client, guild.id);

            if (list.length === 0) {
                return interaction.reply({
                    content: '📭 No autorole button panels yet. Create one with `/autorole-button create`.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const fields = list.map(name => {
                const panel = getPanel(client, guild.id, name);
                if (!panel) return { name: `\`${name}\``, value: '_Data rusak_', inline: true };

                const modeIcon = panel.mode === 'single' ? '🔘' : '✅';

                const sent    = getSentPanel(client, guild.id, name);
                const sentStr = sent
                    ? `📤 Sent — [View](https://discord.com/channels/${guild.id}/${sent.channelId}/${sent.messageId})`
                    : '📭 Not sent yet';

                const defaultWarna = panel.defaultStyle
                    ? (STYLE_LABEL[panel.defaultStyle] ?? '🔵 Blue (Primary)')
                    : '🔵 Blue (Primary)';

                return {
                    name: `\`${name}\``,
                    value: [
                        `${modeIcon} **Mode:** ${panel.mode === 'single' ? 'Single (radio)' : 'Multi'}`,
                        `🎭 **Buttons:** ${panel.buttons?.length ?? 0}`,
                        `🎨 **Default Color:** ${defaultWarna}`,
                        `🎨 **Embed Color:** ${panel.embedColor || '#5865F2'}`,
                        sentStr
                    ].join('\n'),
                    inline: true
                };
            });

            const embed = new EmbedBuilder()
                .setTitle('🗂️ Autorole Button Panel List')
                .setColor('#5865F2')
                .addFields(fields)
                .setFooter({ text: `${list.length} panel · ${guild.name}` })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── /autorole-button type ──────────────────────────────────────────
        if (sub === 'type') {
            const panelName = options.getString('panel');
            const tipe      = options.getString('type');
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });

            if (tipe === 'embed') {
                panel.messageType = 'embed';
                panel.updatedAt   = Date.now();
                savePanel(client, guild.id, panelName, panel);
                return interaction.reply({
                    content: `✅ Panel \`${panelName}\` type changed to **Embed**.\nUse \`/autorole-button create ${panelName}\` to set the title, description, and footer.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (tipe === 'plain') {
                client.database.set(
                    `autobtn-pending-${guild.id}-${interaction.user.id}`,
                    JSON.stringify({ nama: panelName, mode: panel.mode || 'multi', isNew: false, pendingType: 'plain' })
                );
                await interaction.showModal({
                    custom_id: `autobtn-modal:${panelName}`,
                    title: `Plain Text: ${panelName}`.slice(0, 45),
                    components: [{
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'autobtn-field-plaintext',
                            label: 'Plain Text Message Content (max. 2000)', style: 2,
                            placeholder: 'Write the message content here...',
                            value: panel.plainText || '', required: true, max_length: 2000
                        }]
                    }]
                });
                return;
            }
        }

        // ── /autorole-button buat ──────────────────────────────────────────
        if (sub === 'create') {
            const nama = options.getString('name').trim().toLowerCase();
            const mode = options.getString('mode'); // can be null (for re-editing)

            if (!isValidName(nama)) {
                return interaction.reply({
                    content: '❌ Panel name can only contain letters, numbers, `-`, and `_` (1–32 characters).',
                    flags: MessageFlags.Ephemeral
                });
            }

            const existing = getPanel(client, guild.id, nama);

            // If new panel, mode is required
            if (!existing && !mode) {
                return interaction.reply({
                    content: '❌ New panels require the `mode` option. Choose `multi` or `single`.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Save pending for modal handler
            const pendingMode = mode || existing?.mode || 'multi';
            client.database.set(
                `autobtn-pending-${guild.id}-${interaction.user.id}`,
                JSON.stringify({ nama, mode: pendingMode, isNew: !existing })
            );

            // Open modal with pre-fill from panel data (if exists)
            await interaction.showModal({
                custom_id: `autobtn-modal:${nama}`,
                title: `Panel: ${nama}`.slice(0, 45),
                components: [
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'autobtn-field-title',
                            label: 'Embed Title (max. 256 characters)', style: 1,
                            placeholder: 'Example: Choose Your Role',
                            value: existing?.embedTitle || '', required: false, max_length: 256
                        }]
                    },
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'autobtn-field-description',
                            label: 'Embed Description (max. 4000 characters)', style: 2,
                            placeholder: 'Describe the button function here...',
                            value: existing?.embedDescription || '', required: false, max_length: 4000
                        }]
                    },
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'autobtn-field-footer',
                            label: 'Embed Footer (max. 2048 characters)', style: 1,
                            placeholder: 'Text at the bottom of the embed...',
                            value: existing?.embedFooter || '', required: false, max_length: 2048
                        }]
                    }
                ]
            });
            return;
        }

        // ── /autorole-button set-warna ─────────────────────────────────────
        if (sub === 'set-color') {
            const panelName = options.getString('panel');
            const hex       = options.getString('hex').trim();
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });
            if (!/^#?[0-9A-Fa-f]{6}$/.test(hex)) return interaction.reply({ content: '❌ Invalid color format. Example: `#FF5733` or `FF5733`.', flags: MessageFlags.Ephemeral });

            panel.embedColor = hex.startsWith('#') ? hex : `#${hex}`;
            panel.updatedAt  = Date.now();
            savePanel(client, guild.id, panelName, panel);

            // Update the already-sent message
            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = '📭 Panel not yet sent.';
            if (sentResult) {
                try {
                    await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)], components: buildButtonRows(panel) });
                    statusStr = `✅ Sent message updated immediately!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = `⚠️ Failed to update message. Resend with: \`/autorole-button send ${panelName}\``;
                }
            }

            return interaction.reply({
                content: `✅ Embed color for panel \`${panelName}\` updated to \`${panel.embedColor}\`.\n${statusStr}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button set-gambar ────────────────────────────────────
        if (sub === 'set-image') {
            const panelName = options.getString('panel');
            const url       = options.getString('url').trim();
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });

            if (url === '-') {
                panel.embedImage = '';
            } else {
                if (!/^https?:\/\/.+\..+/.test(url)) return interaction.reply({ content: '❌ Invalid URL. Must start with `https://`.', flags: MessageFlags.Ephemeral });
                panel.embedImage = url;
            }
            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = '📭 Panel not yet sent.';
            if (sentResult) {
                try {
                    await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)], components: buildButtonRows(panel) });
                    statusStr = `✅ Sent message updated immediately!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = `⚠️ Failed to update message. Resend with: \`/autorole-button send ${panelName}\``;
                }
            }

            const action = url === '-' ? '**removed**' : 'updated';
            return interaction.reply({
                content: `✅ Panel \`${panelName}\` embed image ${action}.\n${statusStr}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button set-thumbnail ─────────────────────────────────
        if (sub === 'set-thumbnail') {
            const panelName = options.getString('panel');
            const url       = options.getString('url').trim();
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });

            if (url === '-') {
                panel.embedThumbnail = '';
            } else {
                if (!/^https?:\/\/.+\..+/.test(url)) return interaction.reply({ content: '❌ Invalid URL. Must start with `https://`.', flags: MessageFlags.Ephemeral });
                panel.embedThumbnail = url;
            }
            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = '📭 Panel not yet sent.';
            if (sentResult) {
                try {
                    await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)], components: buildButtonRows(panel) });
                    statusStr = `✅ Sent message updated immediately!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = `⚠️ Failed to update message. Resend with: \`/autorole-button send ${panelName}\``;
                }
            }

            const action = url === '-' ? '**removed**' : 'updated';
            return interaction.reply({
                content: `✅ Panel \`${panelName}\` embed thumbnail ${action}.\n${statusStr}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button tambah-button ─────────────────────────────────
        if (sub === 'add-button') {
            const panelName = options.getString('panel');
            const roleStr   = options.getString('role');
            const label     = options.getString('label').trim();
            const panel = getPanel(client, guild.id, panelName);
            if (!panel) {
                return interaction.reply({
                    content: `❌ Panel \`${panelName}\` not found.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const defaultKey = panel.defaultStyle
                ? Object.keys(STYLE_MAP).find(k => STYLE_MAP[k] === panel.defaultStyle) || 'primary'
                : 'primary';
            const warnaKey  = options.getString('color') || defaultKey;

            const role = resolveRole(guild, roleStr);
            if (!role) {
                return interaction.reply({ content: '❌ Role not found.', flags: MessageFlags.Ephemeral });
            }
            if (role.managed || role.id === guild.id) {
                return interaction.reply({ content: '❌ This role cannot be used (managed or @everyone).', flags: MessageFlags.Ephemeral });
            }
            if (panel.buttons.some(b => b.roleId === role.id)) {
                return interaction.reply({
                    content: `⚠️ Role ${role} already has a button in panel \`${panelName}\`. Use \`/autorole-button edit-button\` to modify it.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            if (panel.buttons.length >= 25) {
                return interaction.reply({
                    content: '❌ A panel can have at most 25 buttons (5 rows × 5 columns).',
                    flags: MessageFlags.Ephemeral
                });
            }

            panel.buttons.push({
                roleId: role.id,
                label,
                style:  STYLE_MAP[warnaKey] ?? ButtonStyle.Primary
            });
            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = `Send the panel with \`/autorole-button send ${panelName}\``;

            if (sentResult) {
                try {
                    await sentResult.message.edit({
                        embeds:     [buildPanelEmbed(panel)],
                        components: buildButtonRows(panel)
                    });
                    statusStr = `✅ Sent message updated immediately!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = `⚠️ Failed to update message. Resend with: \`/autorole-button send ${panelName}\``;
                }
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle(`✅ Button Added to Panel \`${panelName}\``)
                        .addFields(
                            { name: '🎭 Role',   value: `${role}`,  inline: true },
                            { name: '🏷️ Label',  value: label,      inline: true },
                            { name: '🎨 Color',  value: STYLE_LABEL[STYLE_MAP[warnaKey]] ?? warnaKey, inline: true },
                            { name: '📊 Total',  value: `${panel.buttons.length}/25 buttons`, inline: true },
                            { name: '📤 Status', value: statusStr, inline: false }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button tambah-bulk ──────────────────────────────────
        if (sub === 'add-bulk') {
            const panelName = options.getString('panel');
            const rawData   = options.getString('data');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) {
                return interaction.reply({
                    content: `❌ Panel \`${panelName}\` not found.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const lines = rawData.split(/[\n;]/g).map(l => l.trim()).filter(Boolean);
            if (lines.length === 0) {
                return interaction.reply({
                    content: '❌ Empty input. Enter at least one line: `@Role | Label | color`',
                    flags: MessageFlags.Ephemeral
                });
            }

            const results  = [];
            let addedCount = 0;

            for (const line of lines) {
                const parts = line.split('|').map(p => p.trim());
                if (parts.length < 2) {
                    results.push({ status: '❌', label: line, reason: 'Wrong format (missing `|`)' });
                    continue;
                }
                const [roleStr, labelRaw, warnaRaw] = parts;
                const label    = labelRaw?.trim();
                const panelDefaultKey = panel.defaultStyle
                    ? Object.keys(STYLE_MAP).find(k => STYLE_MAP[k] === panel.defaultStyle) || 'primary'
                    : 'primary';
                const warnaKey = (warnaRaw?.trim().toLowerCase()) || panelDefaultKey;

                if (!label) {
                    results.push({ status: '❌', label: roleStr, reason: 'Empty label' });
                    continue;
                }
                if (label.length > 80) {
                    results.push({ status: '❌', label, reason: 'Label exceeds 80 characters' });
                    continue;
                }
                if (!['primary','success','danger','secondary'].includes(warnaKey)) {
                    results.push({ status: '❌', label, reason: `Invalid color: \`${warnaKey}\`` });
                    continue;
                }
                const role = resolveRole(guild, roleStr);
                if (!role) {
                    results.push({ status: '❌', label, reason: `Role \`${roleStr}\` not found` });
                    continue;
                }
                if (role.managed || role.id === guild.id) {
                    results.push({ status: '❌', label, role: role.toString(), reason: 'Managed role or @everyone' });
                    continue;
                }
                if (panel.buttons.some(b => b.roleId === role.id)) {
                    results.push({ status: '⚠️', label, role: role.toString(), reason: 'Role already has a button (skipped)' });
                    continue;
                }
                if (panel.buttons.length + addedCount >= 25) {
                    results.push({ status: '❌', label, role: role.toString(), reason: 'Panel is full (max 25 buttons)' });
                    continue;
                }

                panel.buttons.push({ roleId: role.id, label, style: STYLE_MAP[warnaKey] ?? ButtonStyle.Primary });
                addedCount++;
                results.push({ status: '✅', label, role: role.toString(), warna: STYLE_LABEL[STYLE_MAP[warnaKey]] });
            }

            if (addedCount > 0) { panel.updatedAt = Date.now(); savePanel(client, guild.id, panelName, panel); }

            let statusStr = addedCount > 0 ? `Send panel: \`/autorole-button send ${panelName}\`` : 'No changes.';
            if (addedCount > 0) {
                const sentResult = await resolveSentMessage(client, guild, panelName);
                if (sentResult) {
                    try {
                        await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)], components: buildButtonRows(panel) });
                        statusStr = `✅ Sent message updated immediately!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                    } catch {
                        statusStr = `⚠️ Failed to update message. Resend with: \`/autorole-button send ${panelName}\``;
                    }
                }
            }

            const successLines = results.filter(r => r.status === '✅');
            const warnLines    = results.filter(r => r.status === '⚠️');
            const failLines    = results.filter(r => r.status === '❌');
            const summaryParts = [];
            if (successLines.length) summaryParts.push(
                `**✅ Successfully added (${successLines.length}):**\n` +
                successLines.map(r => `> ${r.role} — \`${r.label}\` ${r.warna}`).join('\n')
            );
            if (warnLines.length) summaryParts.push(
                `**⚠️ Skipped (${warnLines.length}):**\n` +
                warnLines.map(r => `> ${r.role ?? r.label} — ${r.reason}`).join('\n')
            );
            if (failLines.length) summaryParts.push(
                `**❌ Failed (${failLines.length}):**\n` +
                failLines.map(r => `> \`${r.label}\` — ${r.reason}`).join('\n')
            );

            const color = addedCount === lines.length ? '#57F287' : addedCount > 0 ? '#FEE75C' : '#ED4245';

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setTitle(`📦 Bulk Add Result — Panel \`${panelName}\``)
                        .setDescription(summaryParts.join('\n\n') || '_Tidak ada yang diproses._')
                        .addFields(
                            { name: '📊 Total Buttons', value: `${panel.buttons.length}/25`, inline: true },
                            { name: '📤 Status',        value: statusStr, inline: false }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button edit-button ───────────────────────────────────
        if (sub === 'edit-button') {
            const panelName = options.getString('panel');
            const roleStr   = options.getString('role');
            const labelBaru = options.getString('label');
            const warnaBaru = options.getString('color');

            if (!labelBaru && !warnaBaru) {
                return interaction.reply({
                    content: '⚠️ Fill in at least one field: `label` or `color`.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) {
                return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });
            }

            const sentResult = await resolveSentMessage(client, guild, panelName);
            if (!sentResult) {
                const sentRaw = getSentPanel(client, guild.id, panelName);
                if (!sentRaw) {
                    return interaction.reply({
                        content: [
                            `❌ Panel \`${panelName}\` has not been sent to any channel.`,
                            `Send it first with \`/autorole-button send ${panelName}\`, then use \`edit-button\`.`
                        ].join('\n'),
                        flags: MessageFlags.Ephemeral
                    });
                }
                return interaction.reply({
                    content: [
                        `❌ Panel \`${panelName}\` message was deleted from the channel.`,
                        `Resend the panel with \`/autorole-button send ${panelName}\`, then use \`edit-button\`.`
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            const role = resolveRole(guild, roleStr);
            if (!role) {
                return interaction.reply({ content: '❌ Role not found.', flags: MessageFlags.Ephemeral });
            }

            const btnIndex = panel.buttons.findIndex(b => b.roleId === role.id);
            if (btnIndex === -1) {
                return interaction.reply({
                    content: `⚠️ No button with role ${role} in panel \`${panelName}\`.\nAdd one first with \`/autorole-button add-button\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const btn       = panel.buttons[btnIndex];
            const labelLama = btn.label;
            const warnaLama = STYLE_LABEL[btn.style] ?? '?';

            if (labelBaru) btn.label = labelBaru.trim();
            if (warnaBaru) btn.style = STYLE_MAP[warnaBaru] ?? btn.style;

            panel.buttons[btnIndex] = btn;
            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            let statusStr = '';
            try {
                await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)], components: buildButtonRows(panel) });
                statusStr = `✅ Sent message updated immediately!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
            } catch {
                statusStr = `⚠️ Failed to update message. Resend with: \`/autorole-button send ${panelName}\``;
            }

            const changeFields = [];
            if (labelBaru) changeFields.push({ name: '🏷️ Label', value: `\`${labelLama}\` → \`${btn.label}\``, inline: true });
            if (warnaBaru) changeFields.push({ name: '🎨 Color',  value: `${warnaLama} → ${STYLE_LABEL[btn.style] ?? warnaBaru}`, inline: true });

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#FEE75C')
                        .setTitle(`✏️ Button Edited in Panel \`${panelName}\``)
                        .addFields(
                            { name: '🎭 Role', value: `${role}`, inline: false },
                            ...changeFields,
                            { name: '📤 Status', value: statusStr, inline: false }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button edit-bulk ─────────────────────────────────────
        if (sub === 'edit-bulk') {
            const panelName = options.getString('panel');
            const rawData   = options.getString('data');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) {
                return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });
            }

            const sentResult = await resolveSentMessage(client, guild, panelName);
            if (!sentResult) {
                const sentRaw = getSentPanel(client, guild.id, panelName);
                if (!sentRaw) {
                    return interaction.reply({
                        content: [
                            `❌ Panel \`${panelName}\` has not been sent to any channel.`,
                            `Send it first with \`/autorole-button send ${panelName}\`, then use \`edit-bulk\`.`
                        ].join('\n'),
                        flags: MessageFlags.Ephemeral
                    });
                }
                return interaction.reply({
                    content: [
                        `❌ Panel \`${panelName}\` message was deleted from the channel.`,
                        `Resend the panel with \`/autorole-button send ${panelName}\`, then use \`edit-bulk\`.`
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            const lines = rawData.split(/[\n;]/g).map(l => l.trim()).filter(Boolean);
            if (lines.length === 0) {
                return interaction.reply({ content: '❌ Empty input.', flags: MessageFlags.Ephemeral });
            }

            const results   = [];
            let editedCount = 0;

            for (const line of lines) {
                const parts = line.split('|').map(p => p.trim());
                const [roleStr, labelBaru, warnaBaru] = parts;

                if (!labelBaru && !warnaBaru) {
                    results.push({ status: '❌', label: line, reason: 'Fill in at least a label or color' });
                    continue;
                }
                if (labelBaru && labelBaru.length > 80) {
                    results.push({ status: '❌', label: labelBaru, reason: 'Label exceeds 80 characters' });
                    continue;
                }
                const warnaKey = warnaBaru?.toLowerCase();
                if (warnaKey && !['primary','success','danger','secondary'].includes(warnaKey)) {
                    results.push({ status: '❌', label: roleStr, reason: `Invalid color: \`${warnaKey}\`` });
                    continue;
                }

                const role = resolveRole(guild, roleStr);
                if (!role) {
                    results.push({ status: '❌', label: roleStr, reason: `Role \`${roleStr}\` not found` });
                    continue;
                }

                const btnIndex = panel.buttons.findIndex(b => b.roleId === role.id);
                if (btnIndex === -1) {
                    results.push({ status: '⚠️', label: roleStr, role: role.toString(), reason: 'Does not have a button in this panel' });
                    continue;
                }

                const btn       = panel.buttons[btnIndex];
                const labelLama = btn.label;
                const warnaLama = STYLE_LABEL[btn.style] ?? '?';
                if (labelBaru) btn.label = labelBaru.trim();
                if (warnaKey)  btn.style = STYLE_MAP[warnaKey] ?? btn.style;
                panel.buttons[btnIndex] = btn;
                editedCount++;

                const changes = [];
                if (labelBaru) changes.push(`label: \`${labelLama}\` → \`${btn.label}\``);
                if (warnaKey)  changes.push(`color: ${warnaLama} → ${STYLE_LABEL[btn.style]}`);
                results.push({ status: '✅', role: role.toString(), changes: changes.join(', ') });
            }

            if (editedCount > 0) { panel.updatedAt = Date.now(); savePanel(client, guild.id, panelName, panel); }

            let statusStr = editedCount > 0 ? '' : 'No changes.';
            if (editedCount > 0) {
                try {
                    await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)], components: buildButtonRows(panel) });
                    statusStr = `✅ Sent message updated immediately!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = `⚠️ Failed to update message. Resend with: \`/autorole-button send ${panelName}\``;
                }
            }

            const successLines = results.filter(r => r.status === '✅');
            const warnLines    = results.filter(r => r.status === '⚠️');
            const failLines    = results.filter(r => r.status === '❌');
            const summaryParts = [];
            if (successLines.length) summaryParts.push(
                `**✅ Successfully edited (${successLines.length}):**\n` +
                successLines.map(r => `> ${r.role} — ${r.changes}`).join('\n')
            );
            if (warnLines.length) summaryParts.push(
                `**⚠️ Skipped (${warnLines.length}):**\n` +
                warnLines.map(r => `> ${r.role ?? r.label} — ${r.reason}`).join('\n')
            );
            if (failLines.length) summaryParts.push(
                `**❌ Failed (${failLines.length}):**\n` +
                failLines.map(r => `> \`${r.label}\` — ${r.reason}`).join('\n')
            );

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(editedCount === lines.length ? '#FEE75C' : editedCount > 0 ? '#FEE75C' : '#ED4245')
                        .setTitle(`✏️ Bulk Edit Result — Panel \`${panelName}\``)
                        .setDescription(summaryParts.join('\n\n') || '_Nothing was processed._')
                        .addFields(
                            { name: '📊 Total Buttons', value: `${panel.buttons.length}/25`, inline: true },
                            { name: '📤 Status',        value: statusStr || 'No changes.', inline: false }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button hapus-button ──────────────────────────────────
        if (sub === 'delete-button') {
            const panelName = options.getString('panel');
            const roleStr   = options.getString('role');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) {
                return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });
            }

            const sentResult = await resolveSentMessage(client, guild, panelName);
            if (!sentResult) {
                const sentRaw = getSentPanel(client, guild.id, panelName);
                if (!sentRaw) {
                    return interaction.reply({
                        content: [
                            `❌ Panel \`${panelName}\` has not been sent to any channel.`,
                            `Send it first with \`/autorole-button send ${panelName}\`, then use \`delete-button\`.`
                        ].join('\n'),
                        flags: MessageFlags.Ephemeral
                    });
                }
                return interaction.reply({
                    content: [
                        `❌ Panel \`${panelName}\` message was deleted from the channel.`,
                        `Resend the panel with \`/autorole-button send ${panelName}\`, then use \`delete-button\`.`
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            const role = resolveRole(guild, roleStr);
            if (!role) {
                return interaction.reply({ content: '❌ Role not found.', flags: MessageFlags.Ephemeral });
            }

            const before = panel.buttons.length;
            panel.buttons = panel.buttons.filter(b => b.roleId !== role.id);

            if (panel.buttons.length === before) {
                return interaction.reply({
                    content: `⚠️ No button with role ${role} in panel \`${panelName}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            let statusStr = '';
            try {
                await sentResult.message.edit({
                    embeds:     [buildPanelEmbed(panel)],
                    components: panel.buttons.length > 0 ? buildButtonRows(panel) : []
                });
                statusStr = `✅ Sent message updated immediately!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
            } catch {
                statusStr = `⚠️ Failed to update message. Resend with: \`/autorole-button send ${panelName}\``;
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle(`🗑️ Button Removed from Panel \`${panelName}\``)
                        .setDescription(`The button for role ${role} has been removed.\nRemaining: **${panel.buttons.length}** buttons.`)
                        .addFields({ name: '📤 Status', value: statusStr, inline: false })
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button hapus-bulk ────────────────────────────────────
        if (sub === 'delete-bulk') {
            const panelName = options.getString('panel');
            const rawData   = options.getString('data');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) {
                return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });
            }

            const sentResult = await resolveSentMessage(client, guild, panelName);
            if (!sentResult) {
                const sentRaw = getSentPanel(client, guild.id, panelName);
                if (!sentRaw) {
                    return interaction.reply({
                        content: [
                            `❌ Panel \`${panelName}\` has not been sent to any channel.`,
                            `Send it first with \`/autorole-button send ${panelName}\`, then use \`delete-bulk\`.`
                        ].join('\n'),
                        flags: MessageFlags.Ephemeral
                    });
                }
                return interaction.reply({
                    content: [
                        `❌ Panel \`${panelName}\` message was deleted from the channel.`,
                        `Resend the panel with \`/autorole-button send ${panelName}\`, then use \`delete-bulk\`.`
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            const lines = rawData.split(/[\n;,\s]+/g).map(l => l.trim()).filter(Boolean);
            if (lines.length === 0) {
                return interaction.reply({ content: '❌ Empty input. Enter one @Role per line.', flags: MessageFlags.Ephemeral });
            }

            const results    = [];
            let deletedCount = 0;

            for (const line of lines) {
                const role = resolveRole(guild, line);
                if (!role) {
                    results.push({ status: '❌', label: line, reason: `Role \`${line}\` not found` });
                    continue;
                }
                const before = panel.buttons.length;
                panel.buttons = panel.buttons.filter(b => b.roleId !== role.id);
                if (panel.buttons.length === before) {
                    results.push({ status: '⚠️', role: role.toString(), reason: 'Does not have a button in this panel' });
                    continue;
                }
                deletedCount++;
                results.push({ status: '✅', role: role.toString() });
            }

            if (deletedCount > 0) { panel.updatedAt = Date.now(); savePanel(client, guild.id, panelName, panel); }

            let statusStr = deletedCount > 0 ? '' : 'No changes.';
            if (deletedCount > 0) {
                try {
                    await sentResult.message.edit({
                        embeds:     [buildPanelEmbed(panel)],
                        components: panel.buttons.length > 0 ? buildButtonRows(panel) : []
                    });
                    statusStr = `✅ Sent message updated immediately!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = `⚠️ Failed to update message. Resend with: \`/autorole-button send ${panelName}\``;
                }
            }

            const successLines = results.filter(r => r.status === '✅');
            const warnLines    = results.filter(r => r.status === '⚠️');
            const failLines    = results.filter(r => r.status === '❌');
            const summaryParts = [];
            if (successLines.length) summaryParts.push(`**✅ Successfully removed (${successLines.length}):**\n` + successLines.map(r => `> ${r.role}`).join('\n'));
            if (warnLines.length)    summaryParts.push(`**⚠️ Skipped (${warnLines.length}):**\n`             + warnLines.map(r => `> ${r.role} — ${r.reason}`).join('\n'));
            if (failLines.length)    summaryParts.push(`**❌ Failed (${failLines.length}):**\n`               + failLines.map(r => `> \`${r.label}\` — ${r.reason}`).join('\n'));

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(deletedCount > 0 ? '#ED4245' : '#FEE75C')
                        .setTitle(`🗑️ Bulk Delete Result — Panel \`${panelName}\``)
                        .setDescription(summaryParts.join('\n\n') || '_Nothing was processed._')
                        .addFields(
                            { name: '📊 Remaining Buttons', value: `${panel.buttons.length}/25`, inline: true },
                            { name: '📤 Status',             value: statusStr || 'No changes.', inline: false }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button color-button ──────────────────────────────────
        if (sub === 'color-button') {
            const panelName = options.getString('panel');
            const warnaKey  = options.getString('color');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) {
                return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });
            }

            const warnaLama    = panel.defaultStyle ? (STYLE_LABEL[panel.defaultStyle] ?? '🔵 Blue (Primary)') : '🔵 Blue (Primary)';
            panel.defaultStyle = STYLE_MAP[warnaKey] ?? ButtonStyle.Primary;
            panel.updatedAt    = Date.now();
            savePanel(client, guild.id, panelName, panel);

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#5865F2')
                        .setTitle(`🎨 Default Button Color Changed — Panel \`${panelName}\``)
                        .setDescription(
                            `The default color for **new buttons** in panel \`${panelName}\` has been updated.\n\n` +
                            `This color only applies to buttons that are **newly added**. ` +
                            `Existing buttons are not affected — use \`/autorole-button edit-button\` to change them.`
                        )
                        .addFields(
                            { name: '🎨 Old Color', value: warnaLama, inline: true },
                            { name: '🎨 New Color', value: STYLE_LABEL[panel.defaultStyle] ?? warnaKey, inline: true }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button preview ────────────────────────────────────────
        if (sub === 'preview') {
            const panelName = options.getString('panel');
            const panel     = getPanel(client, guild.id, panelName);

            if (!panel) {
                return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });
            }
            if (panel.buttons.length === 0) {
                return interaction.reply({
                    content: `⚠️ Panel \`${panelName}\` has no buttons yet. Add one with \`/autorole-button add-button\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const modeLabel = panel.mode === 'single'
                ? '🔘 **Single** – only 1 role active'
                : '✅ **Multi** – can pick multiple roles';

            const sent    = getSentPanel(client, guild.id, panelName);
            const sentStr = sent
                ? `\n📤 Already sent — [View Message](https://discord.com/channels/${guild.id}/${sent.channelId}/${sent.messageId})`
                : '\n📭 Not sent yet';

            if (panel.messageType === 'plain') {
                return interaction.reply({
                    content: `**Preview Panel \`${panelName}\` (Plain Text)**\n\n${panel.plainText || '*(empty text)*'}`,
                    components: buildButtonRows(panel),
                    flags: MessageFlags.Ephemeral
                });
            }

            return interaction.reply({
                content: `👁️ **Panel Preview \`${panelName}\`** — ${modeLabel}${sentStr}`,
                embeds:     [buildPanelEmbed(panel)],
                components: buildButtonRows(panel),
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button kirim ──────────────────────────────────────────
        if (sub === 'send') {
            const panelName  = options.getString('panel');
            const channelStr = options.getString('channel');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) {
                return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });
            }
            if (panel.buttons.length === 0) {
                return interaction.reply({
                    content: `⚠️ Panel \`${panelName}\` has no buttons yet. Add one first with \`/autorole-button add-button\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const existingSent = await resolveSentMessage(client, guild, panelName);
            if (existingSent) {
                return interaction.reply({
                    content: [
                        `❌ Panel \`${panelName}\` has already been sent and is still active.`,
                        `The autorole-button panel is **unique** — it can only be sent once.`,
                        ``,
                        `To change the appearance or buttons, use:`,
                        `• \`/autorole-button create ${panelName}\` — edit embed title/description`,
                        `• \`/autorole-button set-color\` — change embed color`,
                        `• \`/autorole-button edit-button\` — edit button label/color`,
                        `• \`/autorole-button add-button\` — add a new button`,
                        `• \`/autorole-button delete-button\` — remove a button`,
                        ``,
                        `🔗 https://discord.com/channels/${guild.id}/${existingSent.sent.channelId}/${existingSent.sent.messageId}`
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            let targetChannel = interaction.channel;
            if (channelStr) {
                const resolved = resolveChannel(guild, channelStr);
                if (!resolved) {
                    return interaction.reply({ content: '❌ Channel not found.', flags: MessageFlags.Ephemeral });
                }
                targetChannel = resolved;
            }

            const isPlain = panel.messageType === 'plain';

            const chPermsNeeded = isPlain
                ? [PermissionFlagsBits.SendMessages]
                : [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
            const chPermsOk = await checkBotPermissions(interaction, chPermsNeeded, targetChannel);
            if (!chPermsOk) return;

            if (isPlain && !panel.plainText) {
                return interaction.reply({
                    content: `❌ Panel \`${panelName}\` has no text. Use \`/autorole-button type plain ${panelName}\` to set the text.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const sentMsg = isPlain
                ? await targetChannel.send({ content: panel.plainText.slice(0, 2000), components: buildButtonRows(panel) })
                : await targetChannel.send({ embeds: [buildPanelEmbed(panel)], components: buildButtonRows(panel) });

            saveSentPanel(client, guild.id, panelName, sentMsg.id, targetChannel.id);

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('📤 Panel Sent!')
                        .setDescription(`Panel \`${panelName}\` successfully sent to ${targetChannel}.`)
                        .addFields(
                            { name: '🔧 Mode',   value: panel.mode === 'single' ? '🔘 Single (radio)' : '✅ Multi', inline: true },
                            { name: '🎭 Buttons', value: `${panel.buttons.length} buttons`, inline: true },
                            { name: '🔒 Note', value: 'Panel is **unique** — cannot be resent.\nUse edit/add/delete-button commands to update buttons.', inline: false }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button hapus-panel ────────────────────────────────────
        if (sub === 'delete-panel') {
            const panelName = options.getString('panel');
            const panel     = getPanel(client, guild.id, panelName);

            if (!panel) {
                return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });
            }

            // Try to delete the sent Discord message (if any)
            let sentNote = '';
            const sentResult = await resolveSentMessage(client, guild, panelName);
            if (sentResult) {
                try {
                    await sentResult.message.delete();
                    sentNote = `\n\n✅ Panel message in <#${sentResult.sent.channelId}> successfully deleted.`;
                } catch {
                    sentNote = `\n\n⚠️ Failed to delete panel message in channel. It may have already been deleted or the bot lacks permission.\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                }
            }

            deletePanel(client, guild.id, panelName);
            deleteSentPanel(client, guild.id, panelName);

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('🗑️ Panel Deleted')
                        .setDescription(
                            `Panel \`${panelName}\` and all its configurations have been deleted from the database.` +
                            sentNote
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }
    }
}).toJSON();

const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { resolveRole, resolveChannel } = require('../../utils/resolveGuildOption');
const { checkBotPermissions } = require('../../utils/checkBotPermissions');

// ── Helpers panel ──────────────────────────────────────────────────────────

function getPanelList(client, guildId) {
    const raw = client.database.get(`autoreact-list-${guildId}`);
    if (!raw || typeof raw !== 'string') return [];
    try { return JSON.parse(raw); } catch { return []; }
}

function savePanelList(client, guildId, list) {
    client.database.set(`autoreact-list-${guildId}`, JSON.stringify(list));
}

function getPanel(client, guildId, name) {
    const raw = client.database.get(`autoreact-${guildId}-${name}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function savePanel(client, guildId, name, data) {
    client.database.set(`autoreact-${guildId}-${name}`, JSON.stringify(data));
    const list = getPanelList(client, guildId);
    if (!list.includes(name)) { list.push(name); savePanelList(client, guildId, list); }
}

function deletePanel(client, guildId, name) {
    client.database.delete(`autoreact-${guildId}-${name}`);
    savePanelList(client, guildId, getPanelList(client, guildId).filter(n => n !== name));
}

// ── Helpers sentData panel ─────────────────────────────────────────────────

function getSentPanel(client, guildId, panelName) {
    const raw = client.database.get(`autoreact-sent-${guildId}-${panelName}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function saveSentPanel(client, guildId, panelName, messageId, channelId) {
    client.database.set(`autoreact-sent-${guildId}-${panelName}`, JSON.stringify({ messageId, channelId }));
    client.database.set(`autoreact-msgmap-${guildId}-${messageId}`, panelName);
}

function deleteSentPanel(client, guildId, panelName) {
    const sent = getSentPanel(client, guildId, panelName);
    if (sent?.messageId) client.database.delete(`autoreact-msgmap-${guildId}-${sent.messageId}`);
    client.database.delete(`autoreact-sent-${guildId}-${panelName}`);
}

async function resolveSentMessage(client, guild, panelName) {
    const sent = getSentPanel(client, guild.id, panelName);
    if (!sent) return null;
    const channel = guild.channels.cache.get(sent.channelId)
        ?? await guild.channels.fetch(sent.channelId).catch(() => null);
    if (!channel) { deleteSentPanel(client, guild.id, panelName); return null; }
    let message = null;
    try { message = await channel.messages.fetch(sent.messageId); }
    catch { deleteSentPanel(client, guild.id, panelName); return null; }
    return { sent, message, channel };
}

// ── Emoji utilities ────────────────────────────────────────────────────────

// Normalisasi emoji ke format penyimpanan:
//   unicode → karakter itu sendiri  (misal: 👍)
//   custom  → name:id               (misal: gaming:123456789)
function normalizeEmoji(emojiStr) {
    const customMatch = emojiStr.trim().match(/^<a?:([^:]+):(\d+)>$/);
    if (customMatch) return `${customMatch[1]}:${customMatch[2]}`;
    return emojiStr.trim();
}

// Untuk memanggil message.react(): custom pakai ID saja, unicode pakai char
function emojiToReactArg(normalized) {
    const customMatch = normalized.match(/^([a-zA-Z0-9_]+):(\d+)$/);
    return customMatch ? customMatch[2] : normalized;
}

// ── Embed builder ──────────────────────────────────────────────────────────

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

async function addReactionsToMessage(message, reactions) {
    for (const react of reactions) {
        try { await message.react(emojiToReactArg(react.emoji)); } catch { /* invalid emoji, skip */ }
    }
}

function isValidName(name) {
    return /^[a-zA-Z0-9_-]{1,32}$/.test(name);
}

// ── Command ────────────────────────────────────────────────────────────────
module.exports = new ApplicationCommand({
    command: {
        name: 'autorole-reaction',
        description: 'Create a reaction emoji panel for members to self-assign or remove roles.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [

            // ── list ──────────────────────────────────────────────────────
            {
                name: 'list',
                description: 'View all existing autorole reaction panels.',
                type: 1
            },

            // ── create ───────────────────────────────────────────────────
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
                        description: 'Multi = can select multiple roles | Single = only 1 active role allowed',
                        type: 3,
                        required: false,
                        choices: [
                            { name: '✅ Multi  – can pick multiple roles at once', value: 'multi'  },
                            { name: '🔘 Single – only 1 role allowed (radio)',        value: 'single' }
                        ]
                    }
                ]
            },

            // ── set-color ────────────────────────────────────────────────
            {
                name: 'set-color',
                description: 'Change the left border color of the panel embed.',
                type: 1,
                options: [
                    { name: 'panel', description: 'Panel name', type: 3, required: true, autocomplete: true },
                    { name: 'hex',   description: 'Hex color code, e.g.: #5865F2 or FF5733', type: 3, required: true, max_length: 7 }
                ]
            },

            // ── set-image ────────────────────────────────────────────────
            {
                name: 'set-image',
                description: 'Set or remove the large image below the panel embed.',
                type: 1,
                options: [
                    { name: 'panel', description: 'Panel name', type: 3, required: true, autocomplete: true },
                    { name: 'url',   description: 'Image URL (https://...). Type - to remove.', type: 3, required: true }
                ]
            },

            // ── set-thumbnail ─────────────────────────────────────────────
            {
                name: 'set-thumbnail',
                description: 'Set or remove the thumbnail (small image, top right) of the panel embed.',
                type: 1,
                options: [
                    { name: 'panel', description: 'Panel name', type: 3, required: true, autocomplete: true },
                    { name: 'url',   description: 'Thumbnail URL (https://...). Type - to remove.', type: 3, required: true }
                ]
            },

            // ── add-reaction ─────────────────────────────────────────────
            {
                name: 'add-reaction',
                description: 'Add an emoji reaction + role to a panel.',
                type: 1,
                options: [
                    { name: 'panel', description: 'Target panel name',               type: 3, required: true,  autocomplete: true },
                    { name: 'emoji', description: 'Emoji for the reaction (e.g.: 👍 or custom emoji)', type: 3, required: true },
                    { name: 'role',  description: 'Role granted/removed when the reaction is clicked', type: 3, required: true, autocomplete: true }
                ]
            },

            // ── delete-reaction ──────────────────────────────────────────
            {
                name: 'delete-reaction',
                description: 'Remove a reaction from a panel by role.',
                type: 1,
                options: [
                    { name: 'panel', description: 'Panel name',                       type: 3, required: true, autocomplete: true },
                    { name: 'role',  description: 'Role whose reaction you want to remove', type: 3, required: true, autocomplete: true }
                ]
            },

            // ── send ─────────────────────────────────────────────────────
            {
                name: 'send',
                description: 'Send the panel to a specific channel (can only be sent once).',
                type: 1,
                options: [
                    { name: 'panel',   description: 'Panel name to send',           type: 3, required: true,  autocomplete: true },
                    { name: 'channel', description: 'Target channel (empty = current channel)', type: 3, required: false, autocomplete: true }
                ]
            },

            // ── delete-panel ─────────────────────────────────────────────
            {
                name: 'delete-panel',
                description: 'Delete the entire panel from the database.',
                type: 1,
                options: [
                    { name: 'panel', description: 'Panel name to delete', type: 3, required: true, autocomplete: true }
                ]
            },

            // ── preview ───────────────────────────────────────────────────
            {
                name: 'preview',
                description: 'Preview the panel (only visible to you)',
                type: 1,
                options: [
                    { name: 'panel', description: 'Panel name to preview', type: 3, required: true, autocomplete: true }
                ]
            },

            // ── type ─────────────────────────────────────────────────────
            {
                name: 'type',
                description: 'Change the panel message type: embed or plain text.',
                type: 1,
                options: [
                    { name: 'panel', description: 'Panel name', type: 3, required: true, autocomplete: true },
                    {
                        name: 'type', description: 'Desired message type',
                        type: 3, required: true,
                        choices: [
                            { name: 'Embed — message in a colored box', value: 'embed' },
                            { name: 'Plain Text — text without an embed box',    value: 'plain' }
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

        const ok = await checkBotPermissions(interaction, [
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ManageRoles,
            PermissionFlagsBits.AddReactions,
            PermissionFlagsBits.ReadMessageHistory,
        ]);
        if (!ok) return;

        // ── /autorole-reaction list ────────────────────────────────────────
        if (sub === 'list') {
            const list = getPanelList(client, guild.id);
            if (list.length === 0) {
                return interaction.reply({
                    content: '📭 No autorole reaction panels yet. Create one with `/autorole-reaction create`.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const fields = list.map(name => {
                const panel = getPanel(client, guild.id, name);
                if (!panel) return { name: `\`${name}\``, value: '_Data rusak_', inline: true };
                const modeIcon = panel.mode === 'single' ? '🔘' : '✅';
                const sent     = getSentPanel(client, guild.id, name);
                const sentStr  = sent
                    ? `📤 Sent — [View](https://discord.com/channels/${guild.id}/${sent.channelId}/${sent.messageId})`
                    : '📭 Not sent yet';
                const emojiPreview = (panel.reactions || []).slice(0, 5)
                    .map(r => r.emoji.includes(':') ? `<:${r.emoji}>` : r.emoji).join(' ');
                return {
                    name: `\`${name}\``,
                    value: [
                        `${modeIcon} **Mode:** ${panel.mode === 'single' ? 'Single (radio)' : 'Multi'}`,
                        `✨ **Reactions:** ${panel.reactions?.length ?? 0}${emojiPreview ? ' ' + emojiPreview : ''}`,
                        sentStr
                    ].join('\n'),
                    inline: true
                };
            });

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🗂️ Autorole Reaction Panel List')
                        .setColor('#5865F2')
                        .addFields(fields)
                        .setFooter({ text: `${list.length} panel · ${guild.name}` })
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-reaction type ────────────────────────────────────────
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
                    content: `✅ Panel \`${panelName}\` type changed to **Embed**.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            client.database.set(
                `autoreact-pending-${guild.id}-${interaction.user.id}`,
                JSON.stringify({ nama: panelName, mode: panel.mode || 'multi', isNew: false, pendingType: 'plain' })
            );
            await interaction.showModal({
                custom_id: `autoreact-modal:${panelName}`,
                title: `Plain Text: ${panelName}`.slice(0, 45),
                components: [{
                    type: 1,
                    components: [{
                        type: 4, custom_id: 'autoreact-field-plaintext',
                        label: 'Plain Text Message Content (max. 2000)', style: 2,
                        placeholder: 'Write your message content here...',
                        value: panel.plainText || '', required: true, max_length: 2000
                    }]
                }]
            });
            return;
        }

        // ── /autorole-reaction create ──────────────────────────────────────
        if (sub === 'create') {
            const name = options.getString('name').trim().toLowerCase();
            const mode = options.getString('mode');

            if (!isValidName(name)) {
                return interaction.reply({
                    content: '❌ Panel name may only contain letters, numbers, `-`, and `_` (1–32 characters)',
                    flags: MessageFlags.Ephemeral
                });
            }

            const existing = getPanel(client, guild.id, name);
            if (!existing && !mode) {
                return interaction.reply({
                    content: '❌ A new panel requires the `mode` option. Choose `multi` or `single`.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const pendingMode = mode || existing?.mode || 'multi';
            client.database.set(
                `autoreact-pending-${guild.id}-${interaction.user.id}`,
                JSON.stringify({ nama: name, mode: pendingMode, isNew: !existing })
            );

            await interaction.showModal({
                custom_id: `autoreact-modal:${name}`,
                title: `Reaction Panel: ${name}`.slice(0, 45),
                components: [
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'autoreact-field-title',
                            label: 'Embed Title (max. 256 characters)', style: 1,
                            placeholder: 'Example: Choose Your Role',
                            value: existing?.embedTitle || '', required: false, max_length: 256
                        }]
                    },
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'autoreact-field-description',
                            label: 'Embed Description (max. 4000 characters)', style: 2,
                            placeholder: 'Explain how to use reactions here...',
                            value: existing?.embedDescription || '', required: false, max_length: 4000
                        }]
                    },
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'autoreact-field-footer',
                            label: 'Embed Footer (max. 2048 characters)', style: 1,
                            placeholder: 'Text at the bottom of the embed...',
                            value: existing?.embedFooter || '', required: false, max_length: 2048
                        }]
                    }
                ]
            });
            return;
        }

        // ── /autorole-reaction set-color ───────────────────────────────────
        if (sub === 'set-color') {
            const panelName = options.getString('panel');
            const hex       = options.getString('hex').trim();
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });
            if (!/^#?[0-9A-Fa-f]{6}$/.test(hex)) return interaction.reply({ content: '❌ Invalid color format. Example: `#FF5733` or `FF5733`.', flags: MessageFlags.Ephemeral });

            panel.embedColor = hex.startsWith('#') ? hex : `#${hex}`;
            panel.updatedAt  = Date.now();
            savePanel(client, guild.id, panelName, panel);

            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = '📭 Panel not sent yet.';
            if (sentResult) {
                try {
                    await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)] });
                    statusStr = `✅ Sent message updated live!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = '⚠️ Failed to update the message.';
                }
            }

            return interaction.reply({
                content: `✅ Panel \`${panelName}\` embed color updated to \`${panel.embedColor}\`.\n${statusStr}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-reaction set-image ───────────────────────────────────
        if (sub === 'set-image') {
            const panelName = options.getString('panel');
            const url       = options.getString('url').trim();
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });

            if (url === '-') { panel.embedImage = ''; }
            else {
                if (!/^https?:\/\/.+\..+/.test(url)) return interaction.reply({ content: '❌ Invalid URL.', flags: MessageFlags.Ephemeral });
                panel.embedImage = url;
            }
            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = '📭 Panel not sent yet.';
            if (sentResult) {
                try {
                    await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)] });
                    statusStr = `✅ Message updated!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch { statusStr = '⚠️ Failed to update the message.'; }
            }

            return interaction.reply({
                content: `✅ Panel \`${panelName}\` embed image ${url === '-' ? '**removed**' : 'updated'}.\n${statusStr}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-reaction set-thumbnail ──────────────────────────────
        if (sub === 'set-thumbnail') {
            const panelName = options.getString('panel');
            const url       = options.getString('url').trim();
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });

            if (url === '-') { panel.embedThumbnail = ''; }
            else {
                if (!/^https?:\/\/.+\..+/.test(url)) return interaction.reply({ content: '❌ Invalid URL.', flags: MessageFlags.Ephemeral });
                panel.embedThumbnail = url;
            }
            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = '📭 Panel not sent yet.';
            if (sentResult) {
                try {
                    await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)] });
                    statusStr = `✅ Message updated!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch { statusStr = '⚠️ Failed to update the message.'; }
            }

            return interaction.reply({
                content: `✅ Panel \`${panelName}\` embed thumbnail ${url === '-' ? '**removed**' : 'updated'}.\n${statusStr}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-reaction add-reaction ────────────────────────────────
        if (sub === 'add-reaction') {
            const panelName = options.getString('panel');
            const emojiRaw  = options.getString('emoji').trim();
            const roleStr   = options.getString('role');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });

            if ((panel.reactions || []).length >= 20) {
                return interaction.reply({ content: '❌ A panel can have a maximum of 20 reactions (Discord limit).', flags: MessageFlags.Ephemeral });
            }

            const emojiNorm = normalizeEmoji(emojiRaw);
            if (!emojiNorm) return interaction.reply({ content: '❌ Invalid emoji.', flags: MessageFlags.Ephemeral });

            const role = resolveRole(guild, roleStr);
            if (!role) return interaction.reply({ content: '❌ Role not found.', flags: MessageFlags.Ephemeral });
            if (role.managed || role.id === guild.id) {
                return interaction.reply({ content: '❌ This role cannot be used (managed or @everyone).', flags: MessageFlags.Ephemeral });
            }
            if (panel.reactions.some(r => r.roleId === role.id)) {
                return interaction.reply({
                    content: `⚠️ Role ${role} already has a reaction in panel \`${panelName}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            if (panel.reactions.some(r => normalizeEmoji(r.emoji) === emojiNorm)) {
                return interaction.reply({
                    content: `⚠️ That emoji is already used in panel \`${panelName}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            panel.reactions.push({ emoji: emojiNorm, roleId: role.id });
            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = `Send the panel with \`/autorole-reaction send ${panelName}\``;
            if (sentResult) {
                try {
                    await sentResult.message.react(emojiToReactArg(emojiNorm));
                    statusStr = `✅ Reaction added to the sent message!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = '⚠️ Failed to add reaction to the message (emoji may be invalid or already added).';
                }
            }

            const emojiDisplay = emojiNorm.includes(':') ? `<:${emojiNorm}>` : emojiNorm;
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle(`✅ Reaction Added to Panel \`${panelName}\``)
                        .addFields(
                            { name: '✨ Emoji',   value: emojiDisplay,  inline: true },
                            { name: '🎭 Role',   value: `${role}`,       inline: true },
                            { name: '📊 Total',  value: `${panel.reactions.length}/20 reactions`, inline: true },
                            { name: '📤 Status', value: statusStr,        inline: false }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-reaction delete-reaction ─────────────────────────────
        if (sub === 'delete-reaction') {
            const panelName = options.getString('panel');
            const roleStr   = options.getString('role');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });

            const role = resolveRole(guild, roleStr);
            if (!role) return interaction.reply({ content: '❌ Role not found.', flags: MessageFlags.Ephemeral });

            const idx = panel.reactions.findIndex(r => r.roleId === role.id);
            if (idx === -1) {
                return interaction.reply({
                    content: `⚠️ No reaction found for role ${role} in panel \`${panelName}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const removed = panel.reactions.splice(idx, 1)[0];
            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = '📭 Panel not sent yet.';
            if (sentResult) {
                try {
                    const reactArg = emojiToReactArg(removed.emoji);
                    const botReaction = sentResult.message.reactions.cache.find(r =>
                        r.emoji.id === reactArg || r.emoji.name === reactArg ||
                        `${r.emoji.name}:${r.emoji.id}` === removed.emoji
                    );
                    if (botReaction) await botReaction.users.remove(sentResult.message.client.user.id).catch(() => null);
                    statusStr = `✅ Reaction removed from the sent message.\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = '⚠️ Failed to remove reaction from the message.';
                }
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle(`🗑️ Reaction Removed from Panel \`${panelName}\``)
                        .setDescription(`Reaction for role ${role} has been removed.\nRemaining: **${panel.reactions.length}** reactions.`)
                        .addFields({ name: '📤 Status', value: statusStr, inline: false })
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-reaction preview ─────────────────────────────────────
        if (sub === 'preview') {
            const panelName = options.getString('panel');
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });
            if (!panel.reactions || panel.reactions.length === 0) {
                return interaction.reply({
                    content: `⚠️ Panel \`${panelName}\` has no reactions yet. Add one with \`/autorole-reaction add-reaction\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const modeLabel = panel.mode === 'single' ? '🔘 **Single**' : '✅ **Multi**';
            const sent      = getSentPanel(client, guild.id, panelName);
            const sentStr   = sent
                ? `\n📤 Sent — [View](https://discord.com/channels/${guild.id}/${sent.channelId}/${sent.messageId})`
                : '\n📭 Not sent yet';

            const reactList = panel.reactions.map(r => {
                const emojiDisplay = r.emoji.includes(':') ? `<:${r.emoji}>` : r.emoji;
                const roleMention  = guild.roles.cache.get(r.roleId) ? `<@&${r.roleId}>` : r.roleId;
                return `${emojiDisplay} → ${roleMention}`;
            }).join('\n');

            if (panel.messageType === 'plain') {
                return interaction.reply({
                    content: `**Preview \`${panelName}\` (Plain Text)** — ${modeLabel}${sentStr}\n\n${panel.plainText || '*(empty text)*'}\n\n**Reactions:**\n${reactList}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            return interaction.reply({
                content: `👁️ **Preview \`${panelName}\`** — ${modeLabel}${sentStr}\n\n**Reactions:**\n${reactList}`,
                embeds: [buildPanelEmbed(panel)],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-reaction send ────────────────────────────────────────
        if (sub === 'send') {
            const panelName  = options.getString('panel');
            const channelStr = options.getString('channel');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });
            if (!panel.reactions || panel.reactions.length === 0) {
                return interaction.reply({
                    content: `⚠️ Panel \`${panelName}\` has no reactions yet. Add one first with \`/autorole-reaction add-reaction\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const existingSent = await resolveSentMessage(client, guild, panelName);
            if (existingSent) {
                return interaction.reply({
                    content: [
                        `❌ Panel \`${panelName}\` has already been sent and is still active.`,
                        `The autorole-reaction panel is **unique** — it can only be sent once.`,
                        ``,
                        `To change the appearance or reactions:`,
                        `• \`/autorole-reaction create ${panelName}\` — edit embed title/description`,
                        `• \`/autorole-reaction add-reaction\` — add a new reaction`,
                        `• \`/autorole-reaction delete-reaction\` — remove a reaction`,
                        ``,
                        `🔗 https://discord.com/channels/${guild.id}/${existingSent.sent.channelId}/${existingSent.sent.messageId}`
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            let targetChannel = interaction.channel;
            if (channelStr) {
                const resolved = resolveChannel(guild, channelStr);
                if (!resolved) return interaction.reply({ content: '❌ Channel not found.', flags: MessageFlags.Ephemeral });
                targetChannel = resolved;
            }

            const isPlain = panel.messageType === 'plain';
            const chPermsNeeded = isPlain
                ? [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
                : [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions];
            const chPermsOk = await checkBotPermissions(interaction, chPermsNeeded, targetChannel);
            if (!chPermsOk) return;

            if (isPlain && !panel.plainText) {
                return interaction.reply({
                    content: `❌ Panel \`${panelName}\` has no text set. Use \`/autorole-reaction type plain\` to set it.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const sentMsg = isPlain
                ? await targetChannel.send({ content: panel.plainText.slice(0, 2000) })
                : await targetChannel.send({ embeds: [buildPanelEmbed(panel)] });

            saveSentPanel(client, guild.id, panelName, sentMsg.id, targetChannel.id);
            await addReactionsToMessage(sentMsg, panel.reactions);

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('📤 Panel Sent!')
                        .setDescription(`Panel \`${panelName}\` successfully sent to ${targetChannel}.`)
                        .addFields(
                            { name: '🔧 Mode',      value: panel.mode === 'single' ? '🔘 Single (radio)' : '✅ Multi', inline: true },
                            { name: '✨ Reactions', value: `${panel.reactions.length} reaction`, inline: true },
                            { name: '🔒 Note',   value: 'The panel is **unique** — it cannot be resent.\nUse add/delete-reaction to update it.', inline: false }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-reaction delete-panel ────────────────────────────────
        if (sub === 'delete-panel') {
            const panelName = options.getString('panel');
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` not found.`, flags: MessageFlags.Ephemeral });

            let sentNote = '';
            const sentResult = await resolveSentMessage(client, guild, panelName);
            if (sentResult) {
                try {
                    await sentResult.message.delete();
                    sentNote = `\n\n✅ Panel message in <#${sentResult.sent.channelId}> successfully deleted.`;
                } catch {
                    sentNote = `\n\n⚠️ Failed to delete the panel message.\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                }
            }

            deletePanel(client, guild.id, panelName);
            deleteSentPanel(client, guild.id, panelName);

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('🗑️ Panel Deleted')
                        .setDescription(`Panel \`${panelName}\` and all its configuration have been deleted.${sentNote}`)
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }
    }
}).toJSON();

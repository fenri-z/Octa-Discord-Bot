const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { getLang, getStrings } = require('../../utils/BotLang');
const { resolveChannel } = require('../../utils/resolveGuildOption');
const { checkBotPermissions } = require('../../utils/checkBotPermissions');

const KATEGORI = {
    UNIK:  'unik',
    BIASA: 'biasa',
};

function isValidName(name) {
    return /^[a-zA-Z0-9_-]{1,32}$/.test(name);
}

function getList(client, guildId) {
    const raw = client.database.get(`pesan-list-${guildId}`);
    if (!raw || typeof raw !== 'string') return [];
    try { return JSON.parse(raw); } catch { return []; }
}

function saveList(client, guildId, list) {
    client.database.set(`pesan-list-${guildId}`, JSON.stringify(list));
}

function addToList(client, guildId, name) {
    const list = getList(client, guildId);
    if (!list.includes(name)) { list.push(name); saveList(client, guildId, list); }
}

function removeFromList(client, guildId, name) {
    saveList(client, guildId, getList(client, guildId).filter(n => n !== name));
}

function getTemplate(client, guildId, name) {
    const raw = client.database.get(`pesan-${guildId}-${name}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function saveTemplate(client, guildId, name, data) {
    client.database.set(`pesan-${guildId}-${name}`, JSON.stringify(data));
    addToList(client, guildId, name);
}

function deleteTemplate(client, guildId, name) {
    client.database.delete(`pesan-${guildId}-${name}`);
    removeFromList(client, guildId, name);
}

function getSentUnik(client, guildId, name) {
    const raw = client.database.get(`pesan-unik-sent-${guildId}-${name}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function saveSentUnik(client, guildId, name, messageId, channelId) {
    client.database.set(`pesan-unik-sent-${guildId}-${name}`, JSON.stringify({ messageId, channelId }));
}

function deleteSentUnik(client, guildId, name) {
    client.database.delete(`pesan-unik-sent-${guildId}-${name}`);
}

function buildEmbed(data) {
    const embed = new EmbedBuilder();
    const colorHex = data.color && /^#?[0-9A-Fa-f]{6}$/.test(data.color.trim())
        ? (data.color.startsWith('#') ? data.color : `#${data.color}`)
        : '#5865F2';
    embed.setColor(colorHex);
    if (data.title)       embed.setTitle(data.title.slice(0, 256));
    if (data.description) embed.setDescription(data.description.slice(0, 4096));
    if (data.footer)      embed.setFooter({ text: data.footer.slice(0, 2048) });
    if (data.image)       embed.setImage(data.image);
    if (data.thumbnail)   embed.setThumbnail(data.thumbnail);
    if (data.authorName)  embed.setAuthor({
        name:    data.authorName.slice(0, 256),
        iconURL: data.authorIcon || undefined
    });
    return embed;
}

function badgeCategory(category) {
    return category === KATEGORI.UNIK ? '🔒 Unique' : '📄 Regular';
}

module.exports = new ApplicationCommand({
    command: {
        name: 'message',
        description: 'Manage custom embed message templates.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            // ── Create / edit template ───────────────────────────────────
            {
                name: 'create',
                description: 'Create or edit a message template via form.',
                type: 1,
                options: [
                    {
                        name: 'name',
                        description: 'Template name (letters, numbers, - and _, max. 32 characters)',
                        type: 3, required: true, max_length: 32, autocomplete: true
                    },
                    {
                        name: 'category',
                        description: 'Template category: unique (send once, editable) or regular (send multiple times)',
                        type: 3, required: false,
                        choices: [
                            { name: '🔒 Unique — send once, editable', value: KATEGORI.UNIK  },
                            { name: '📄 Regular — send multiple times', value: KATEGORI.BIASA },
                        ]
                    }
                ]
            },

            // ── Set color ────────────────────────────────────────────────
            {
                name: 'set-color',
                description: 'Change the left border color of the embed.',
                type: 1,
                options: [
                    { name: 'name', description: 'Template name', type: 3, required: true, max_length: 32, autocomplete: true },
                    { name: 'hex',  description: 'Hex code, e.g. #FF5733', type: 3, required: true, max_length: 7 }
                ]
            },

            // ── Set image ────────────────────────────────────────────────
            {
                name: 'set-image',
                description: 'Set a large image below the embed. Type "-" to remove.',
                type: 1,
                options: [
                    { name: 'name', description: 'Template name', type: 3, required: true, max_length: 32, autocomplete: true },
                    { name: 'url',  description: 'Image URL (https://...) or "-" to remove', type: 3, required: true }
                ]
            },

            // ── Set thumbnail ────────────────────────────────────────────
            {
                name: 'set-thumbnail',
                description: 'Set a small thumbnail in the top-right of the embed. Type "-" to remove.',
                type: 1,
                options: [
                    { name: 'name', description: 'Template name', type: 3, required: true, max_length: 32, autocomplete: true },
                    { name: 'url',  description: 'Image URL (https://...) or "-" to remove', type: 3, required: true }
                ]
            },

            // ── Set author ───────────────────────────────────────────────
            {
                name: 'set-author',
                description: 'Set the author name. Type "-" to remove.',
                type: 1,
                options: [
                    { name: 'name',   description: 'Template name', type: 3, required: true, max_length: 32, autocomplete: true },
                    { name: 'author', description: 'Author name, or "-" to remove', type: 3, required: true, max_length: 256 },
                    { name: 'icon',   description: 'Author icon URL (optional)', type: 3, required: false }
                ]
            },

            // ── Message type ─────────────────────────────────────────────
            {
                name: 'type',
                description: 'Change the message type: embed or plain text.',
                type: 1,
                options: [
                    { name: 'name', description: 'Template name', type: 3, required: true, max_length: 32, autocomplete: true },
                    {
                        name: 'type',
                        description: 'Select message type',
                        type: 3, required: true,
                        choices: [
                            { name: '🖼️ Embed — message in a colored box', value: 'embed' },
                            { name: '💬 Plain Text — text without embed box', value: 'plain' },
                        ]
                    }
                ]
            },

            // ── Preview ──────────────────────────────────────────────────
            {
                name: 'preview',
                description: 'Preview the message (only visible to you).',
                type: 1,
                options: [
                    { name: 'name', description: 'Template name', type: 3, required: true, max_length: 32, autocomplete: true }
                ]
            },

            // ── Info ─────────────────────────────────────────────────────
            {
                name: 'info',
                description: 'View the details of a template.',
                type: 1,
                options: [
                    { name: 'name', description: 'Template name', type: 3, required: true, max_length: 32, autocomplete: true }
                ]
            },

            // ── List ─────────────────────────────────────────────────────
            {
                name: 'list',
                description: 'Show all saved templates.',
                type: 1
            },

            // ── Send ─────────────────────────────────────────────────────
            {
                name: 'send',
                description: 'Send a template to the selected channel.',
                type: 1,
                options: [
                    { name: 'name',    description: 'Template name', type: 3, required: true, max_length: 32, autocomplete: true },
                    { name: 'channel', description: 'Target channel (mention #channel or ID)', type: 3, required: true, autocomplete: true }
                ]
            },

            // ── Edit (unique templates only) ─────────────────────────────
            {
                name: 'edit',
                description: 'Edit the content of a sent unique message using the latest template.',
                type: 1,
                options: [
                    { name: 'name', description: 'Unique template name', type: 3, required: true, max_length: 32, autocomplete: true }
                ]
            },

            // ── Copy ─────────────────────────────────────────────────────
            {
                name: 'copy',
                description: 'Duplicate a template with a new name.',
                type: 1,
                options: [
                    { name: 'source', description: 'Template to copy from', type: 3, required: true, max_length: 32, autocomplete: true },
                    { name: 'target', description: 'New template name (must be unused)', type: 3, required: true, max_length: 32, autocomplete: true }
                ]
            },

            // ── Delete template ──────────────────────────────────────────
            {
                name: 'delete',
                description: 'Permanently delete a message template.',
                type: 1,
                options: [
                    { name: 'name', description: 'Template name to delete', type: 3, required: true, max_length: 32, autocomplete: true }
                ]
            },
        ]
    },
    options: {
        cooldown: 3000
    },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const s       = getStrings(getLang(client.database, interaction.guild?.id)).message;
        const sub     = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        const userId  = interaction.user.id;

        const ok = await checkBotPermissions(interaction, [
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ReadMessageHistory,
        ]);
        if (!ok) return;

        // ── CREATE ────────────────────────────────────────────────────────
        if (sub === 'create') {
            const name     = interaction.options.getString('name').trim().toLowerCase();
            const catInput = interaction.options.getString('category');
            const existing = getTemplate(client, guildId, name);

            if (!isValidName(name)) {
                return interaction.reply({
                    content: s.invalid_name,
                    flags: MessageFlags.Ephemeral
                });
            }

            const category = catInput
                ? catInput
                : (existing?.kategori ?? KATEGORI.BIASA);

            if (existing?.kategori === KATEGORI.UNIK && catInput === KATEGORI.BIASA) {
                const sent = getSentUnik(client, guildId, name);
                if (sent) {
                    return interaction.reply({
                        content: s.unique_sent_locked(name),
                        flags: MessageFlags.Ephemeral
                    });
                }
            }

            client.database.set(`pesan-pending-${guildId}-${userId}`, JSON.stringify({ nama: name, kategori: category }));

            await interaction.showModal({
                custom_id: `message-modal:${name}:buat`,
                title: `[${category.toUpperCase()}] ${name}`.slice(0, 45),
                components: [
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'message-field-title',
                            label: 'Title (max. 256 characters)', style: 1,
                            placeholder: 'Enter embed title...',
                            value: existing?.title || '', required: false, max_length: 256
                        }]
                    },
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'message-field-description',
                            label: 'Description (max. 4096 characters)', style: 2,
                            placeholder: 'Enter embed content...',
                            value: existing?.description || '', required: false, max_length: 4000
                        }]
                    },
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'message-field-footer',
                            label: 'Footer (max. 2048 characters)', style: 1,
                            placeholder: 'Text at the bottom of the embed...',
                            value: existing?.footer || '', required: false, max_length: 2048
                        }]
                    }
                ]
            });
            return;
        }

        // ── SET-COLOR ─────────────────────────────────────────────────────
        if (sub === 'set-color') {
            const name = interaction.options.getString('name').trim().toLowerCase();
            const hex  = interaction.options.getString('hex').trim();
            const tmpl = getTemplate(client, guildId, name);
            if (!tmpl) return interaction.reply({ content: s.not_found(name), flags: MessageFlags.Ephemeral });
            if (!/^#?[0-9A-Fa-f]{6}$/.test(hex)) return interaction.reply({ content: s.invalid_color, flags: MessageFlags.Ephemeral });
            tmpl.color = hex.startsWith('#') ? hex : `#${hex}`;
            tmpl.updatedAt = Date.now();
            saveTemplate(client, guildId, name, tmpl);
            return interaction.reply({ content: s.color_updated(name, tmpl.color), flags: MessageFlags.Ephemeral });
        }

        // ── SET-IMAGE ─────────────────────────────────────────────────────
        if (sub === 'set-image') {
            const name = interaction.options.getString('name').trim().toLowerCase();
            const url  = interaction.options.getString('url').trim();
            const tmpl = getTemplate(client, guildId, name);
            if (!tmpl) return interaction.reply({ content: s.not_found(name), flags: MessageFlags.Ephemeral });
            if (url === '-') {
                tmpl.image = ''; tmpl.updatedAt = Date.now();
                saveTemplate(client, guildId, name, tmpl);
                return interaction.reply({ content: s.image_removed(name), flags: MessageFlags.Ephemeral });
            }
            if (!/^https?:\/\/.+\..+/.test(url)) return interaction.reply({ content: s.invalid_url, flags: MessageFlags.Ephemeral });
            tmpl.image = url; tmpl.updatedAt = Date.now();
            saveTemplate(client, guildId, name, tmpl);
            return interaction.reply({ content: s.image_updated(name), flags: MessageFlags.Ephemeral });
        }

        // ── SET-THUMBNAIL ─────────────────────────────────────────────────
        if (sub === 'set-thumbnail') {
            const name = interaction.options.getString('name').trim().toLowerCase();
            const url  = interaction.options.getString('url').trim();
            const tmpl = getTemplate(client, guildId, name);
            if (!tmpl) return interaction.reply({ content: s.not_found(name), flags: MessageFlags.Ephemeral });
            if (url === '-') {
                tmpl.thumbnail = ''; tmpl.updatedAt = Date.now();
                saveTemplate(client, guildId, name, tmpl);
                return interaction.reply({ content: s.thumbnail_removed(name), flags: MessageFlags.Ephemeral });
            }
            if (!/^https?:\/\/.+\..+/.test(url)) return interaction.reply({ content: s.invalid_url, flags: MessageFlags.Ephemeral });
            tmpl.thumbnail = url; tmpl.updatedAt = Date.now();
            saveTemplate(client, guildId, name, tmpl);
            return interaction.reply({ content: s.thumbnail_updated(name), flags: MessageFlags.Ephemeral });
        }

        // ── SET-AUTHOR ────────────────────────────────────────────────────
        if (sub === 'set-author') {
            const name   = interaction.options.getString('name').trim().toLowerCase();
            const author = interaction.options.getString('author').trim();
            const icon   = interaction.options.getString('icon')?.trim() || '';
            const tmpl   = getTemplate(client, guildId, name);
            if (!tmpl) return interaction.reply({ content: s.not_found(name), flags: MessageFlags.Ephemeral });
            if (icon && !/^https?:\/\/.+\..+/.test(icon)) return interaction.reply({ content: s.invalid_icon_url, flags: MessageFlags.Ephemeral });
            if (author === '-') {
                tmpl.authorName = ''; tmpl.authorIcon = ''; tmpl.updatedAt = Date.now();
                saveTemplate(client, guildId, name, tmpl);
                return interaction.reply({ content: s.author_removed(name), flags: MessageFlags.Ephemeral });
            }
            tmpl.authorName = author; tmpl.authorIcon = icon; tmpl.updatedAt = Date.now();
            saveTemplate(client, guildId, name, tmpl);
            return interaction.reply({ content: s.author_updated(name, author), flags: MessageFlags.Ephemeral });
        }

        // ── TYPE ──────────────────────────────────────────────────────────
        if (sub === 'type') {
            const name = interaction.options.getString('name').trim().toLowerCase();
            const type = interaction.options.getString('type'); // 'embed' | 'plain'
            const tmpl = getTemplate(client, guildId, name);
            if (!tmpl) return interaction.reply({ content: s.not_found(name), flags: MessageFlags.Ephemeral });

            if (type === 'embed') {
                tmpl.messageType = 'embed';
                tmpl.updatedAt   = Date.now();
                saveTemplate(client, guildId, name, tmpl);
                return interaction.reply({
                    content: s.type_embed(name),
                    flags: MessageFlags.Ephemeral
                });
            }

            // plain → open modal for text input
            client.database.set(`pesan-pending-${guildId}-${userId}`, JSON.stringify({ nama: name, kategori: tmpl.kategori ?? KATEGORI.BIASA, mode: 'tipe' }));
            await interaction.showModal({
                custom_id: `message-modal:${name}:tipe`,
                title: `[PLAIN] Text Content: ${name}`.slice(0, 45),
                components: [
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'message-field-plaintext',
                            label: 'Plain Text Content (max. 2000 characters)', style: 2,
                            placeholder: 'Hello everyone, this is an announcement!',
                            value: tmpl.plainText || '', required: false, max_length: 2000
                        }]
                    }
                ]
            });
            return;
        }

        // ── PREVIEW ───────────────────────────────────────────────────────
        if (sub === 'preview') {
            const name = interaction.options.getString('name').trim().toLowerCase();
            const tmpl = getTemplate(client, guildId, name);
            if (!tmpl) return interaction.reply({ content: s.not_found(name), flags: MessageFlags.Ephemeral });

            if (tmpl.messageType === 'plain') {
                const plainText = (tmpl.plainText || '').trim();
                if (!plainText) return interaction.reply({ content: s.preview_empty_plain(name), flags: MessageFlags.Ephemeral });
                const previewEmbed = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setAuthor({ name: `👁️ Preview [💬 Plain] [${badgeCategory(tmpl.kategori)}]: ${name}` })
                    .setDescription(`\`\`\`\n${plainText.slice(0, 4000)}\`\`\``)
                    .setFooter({ text: 'This message will appear as plain text in Discord (no embed box)' });
                return interaction.reply({ embeds: [previewEmbed], flags: MessageFlags.Ephemeral });
            }

            if (!tmpl.title && !tmpl.description) return interaction.reply({ content: s.preview_empty(name), flags: MessageFlags.Ephemeral });
            const embed = buildEmbed(tmpl);
            embed.setAuthor({ name: `👁️ Preview [🖼️ Embed] [${badgeCategory(tmpl.kategori)}]: ${name}` });
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── INFO ──────────────────────────────────────────────────────────
        if (sub === 'info') {
            const name = interaction.options.getString('name').trim().toLowerCase();
            const tmpl = getTemplate(client, guildId, name);
            if (!tmpl) return interaction.reply({ content: s.not_found(name), flags: MessageFlags.Ephemeral });

            const colorHex  = (tmpl.color || '#5865F2').startsWith('#') ? (tmpl.color || '#5865F2') : `#${tmpl.color}`;
            const isPlain   = tmpl.messageType === 'plain';
            const desc      = isPlain
                ? (tmpl.plainText ? tmpl.plainText.slice(0, 80) + (tmpl.plainText.length > 80 ? '…' : '') : '`(empty)`')
                : (tmpl.description ? tmpl.description.slice(0, 80) + (tmpl.description.length > 80 ? '…' : '') : '`(empty)`');

            const sentInfo = tmpl.kategori === KATEGORI.UNIK
                ? (() => {
                    const sent = getSentUnik(client, guildId, name);
                    return sent
                        ? `✅ Sent — [View message](https://discord.com/channels/${guildId}/${sent.channelId}/${sent.messageId})`
                        : '⏳ Not yet sent';
                })()
                : null;

            const embed = new EmbedBuilder()
                .setColor(colorHex)
                .setTitle(`📋 Template Info: ${name}`)
                .addFields(
                    { name: '🏷️ Category', value: badgeCategory(tmpl.kategori ?? KATEGORI.BIASA), inline: true },
                    { name: '📨 Type',     value: isPlain ? '💬 Plain Text' : '🖼️ Embed', inline: true },
                    { name: '📌 Title',    value: isPlain ? '`(not applicable)`' : (tmpl.title || '`(empty)`'), inline: true },
                    ...(!isPlain ? [
                        { name: '🎨 Color',     value: `\`${tmpl.color || '#5865F2'}\``, inline: true },
                        { name: '✍️ Author',    value: tmpl.authorName || '`(empty)`',   inline: true },
                        { name: '🖼️ Image',     value: tmpl.image ? '✅ Set' : '`(empty)`', inline: true },
                        { name: '📌 Thumbnail', value: tmpl.thumbnail ? '✅ Set' : '`(empty)`', inline: true },
                    ] : []),
                    { name: isPlain ? '💬 Content' : '📝 Description', value: desc, inline: false },
                    ...(!isPlain ? [{ name: '🔻 Footer', value: tmpl.footer || '`(empty)`', inline: true }] : []),
                    ...(sentInfo ? [{ name: '📨 Send Status', value: sentInfo, inline: false }] : []),
                )
                .setFooter({ text: `Created: ${new Date(tmpl.createdAt).toLocaleString('en-US')} · Edited: ${new Date(tmpl.updatedAt).toLocaleString('en-US')}` })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── LIST ──────────────────────────────────────────────────────────
        if (sub === 'list') {
            const list = getList(client, guildId);
            if (list.length === 0) return interaction.reply({ content: s.no_templates, flags: MessageFlags.Ephemeral });

            const uniqueList  = [];
            const regularList = [];

            for (const templateName of list) {
                const tmpl      = getTemplate(client, guildId, templateName);
                const isPlainL  = tmpl?.messageType === 'plain';
                const preview   = isPlainL
                    ? (tmpl?.plainText?.slice(0, 40) || '*(empty)*')
                    : (tmpl?.title || tmpl?.description?.slice(0, 40) || '*(empty)*');
                const typeBadge = isPlainL ? '💬' : '🖼️';
                const entry     = `${typeBadge} **${templateName}** — ${preview}`;
                if ((tmpl?.kategori ?? KATEGORI.BIASA) === KATEGORI.UNIK) {
                    const sent = getSentUnik(client, guildId, templateName);
                    uniqueList.push(`${entry} ${sent ? '📨' : '⏳'}`);
                } else {
                    regularList.push(entry);
                }
            }

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle(`📚 Message Templates (${list.length})`)
                .setFooter({ text: '📨 = sent · ⏳ = not sent · /message preview <name> to preview' })
                .setTimestamp();

            if (uniqueList.length > 0)  embed.addFields({ name: `🔒 Unique (${uniqueList.length})`,   value: uniqueList.map((e, i)  => `\`${String(i+1).padStart(2,'0')}.\` ${e}`).join('\n') });
            if (regularList.length > 0) embed.addFields({ name: `📄 Regular (${regularList.length})`, value: regularList.map((e, i) => `\`${String(i+1).padStart(2,'0')}.\` ${e}`).join('\n') });

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── SEND ──────────────────────────────────────────────────────────
        if (sub === 'send') {
            const name          = interaction.options.getString('name').trim().toLowerCase();
            const chInput       = interaction.options.getString('channel');
            const targetChannel = resolveChannel(interaction.guild, chInput);

            if (!targetChannel) return interaction.reply({ content: s.send_channel_nf, flags: MessageFlags.Ephemeral });

            const tmpl = getTemplate(client, guildId, name);
            if (!tmpl) return interaction.reply({ content: s.not_found(name), flags: MessageFlags.Ephemeral });

            const isPlainType = tmpl.messageType === 'plain';
            if (isPlainType) {
                if (!(tmpl.plainText || '').trim()) return interaction.reply({ content: s.send_empty_plain(name), flags: MessageFlags.Ephemeral });
            } else {
                if (!tmpl.title && !tmpl.description) return interaction.reply({ content: s.send_empty(name), flags: MessageFlags.Ephemeral });
            }

            const category = tmpl.kategori ?? KATEGORI.BIASA;

            if (category === KATEGORI.UNIK) {
                const sent = getSentUnik(client, guildId, name);
                if (sent) {
                    const sentChannel = interaction.guild.channels.cache.get(sent.channelId)
                        ?? await interaction.guild.channels.fetch(sent.channelId).catch(() => null);

                    let messageStillExists = false;
                    if (sentChannel) {
                        try {
                            await sentChannel.messages.fetch(sent.messageId);
                            messageStillExists = true;
                        } catch {
                            messageStillExists = false;
                        }
                    }

                    if (!messageStillExists) {
                        deleteSentUnik(client, guildId, name);
                    } else {
                        return interaction.reply({
                            content: s.already_sent(name, guildId, sent.channelId, sent.messageId),
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }
            }

            const permsNeeded = [PermissionFlagsBits.SendMessages];
            if (!isPlainType) permsNeeded.push(PermissionFlagsBits.EmbedLinks);
            const chPermsOk = await checkBotPermissions(interaction, permsNeeded, targetChannel);
            if (!chPermsOk) return;

            let sent;
            if (isPlainType) {
                sent = await targetChannel.send({ content: tmpl.plainText.slice(0, 2000) });
            } else {
                const embed = buildEmbed(tmpl);
                sent = await targetChannel.send({ embeds: [embed] });
            }

            if (category === KATEGORI.UNIK) {
                saveSentUnik(client, guildId, name, sent.id, targetChannel.id);
            }

            return interaction.reply({
                content: s.sent_success(name, targetChannel.id, sent.url),
                flags: MessageFlags.Ephemeral
            });
        }

        // ── EDIT (unique messages only) ───────────────────────────────────
        if (sub === 'edit') {
            const name = interaction.options.getString('name').trim().toLowerCase();
            const tmpl = getTemplate(client, guildId, name);

            if (!tmpl) return interaction.reply({ content: s.not_found(name), flags: MessageFlags.Ephemeral });

            if ((tmpl.kategori ?? KATEGORI.BIASA) !== KATEGORI.UNIK) {
                return interaction.reply({
                    content: s.edit_not_unique(name),
                    flags: MessageFlags.Ephemeral
                });
            }

            const sentData = getSentUnik(client, guildId, name);
            if (!sentData) {
                return interaction.reply({
                    content: s.edit_not_sent(name),
                    flags: MessageFlags.Ephemeral
                });
            }

            const targetChannel = interaction.guild.channels.cache.get(sentData.channelId)
                ?? await interaction.guild.channels.fetch(sentData.channelId).catch(() => null);

            if (!targetChannel) {
                deleteSentUnik(client, guildId, name);
                return interaction.reply({
                    content: s.edit_channel_gone(name),
                    flags: MessageFlags.Ephemeral
                });
            }

            try {
                await targetChannel.messages.fetch(sentData.messageId);
            } catch {
                deleteSentUnik(client, guildId, name);
                return interaction.reply({
                    content: s.edit_msg_gone(name),
                    flags: MessageFlags.Ephemeral
                });
            }

            client.database.set(
                `pesan-pending-${guildId}-${userId}`,
                JSON.stringify({ nama: name, kategori: KATEGORI.UNIK, mode: 'edit' })
            );

            if (tmpl.messageType === 'plain') {
                await interaction.showModal({
                    custom_id: `message-modal:${name}:edit`,
                    title: `[EDIT PLAIN] ${name}`.slice(0, 45),
                    components: [
                        {
                            type: 1,
                            components: [{
                                type: 4, custom_id: 'message-field-plaintext',
                                label: 'Plain Text Content (max. 2000 characters)', style: 2,
                                placeholder: 'Hello everyone, this is an announcement!',
                                value: tmpl.plainText || '', required: false, max_length: 2000
                            }]
                        }
                    ]
                });
            } else {
                await interaction.showModal({
                    custom_id: `message-modal:${name}:edit`,
                    title: `[EDIT UNIQUE] ${name}`.slice(0, 45),
                    components: [
                        {
                            type: 1,
                            components: [{
                                type: 4, custom_id: 'message-field-title',
                                label: 'Title (max. 256 characters)', style: 1,
                                placeholder: 'Enter embed title...',
                                value: tmpl.title || '', required: false, max_length: 256
                            }]
                        },
                        {
                            type: 1,
                            components: [{
                                type: 4, custom_id: 'message-field-description',
                                label: 'Description (max. 4096 characters)', style: 2,
                                placeholder: 'Enter embed content...',
                                value: tmpl.description || '', required: false, max_length: 4000
                            }]
                        },
                        {
                            type: 1,
                            components: [{
                                type: 4, custom_id: 'message-field-footer',
                                label: 'Footer (max. 2048 characters)', style: 1,
                                placeholder: 'Text at the bottom of the embed...',
                                value: tmpl.footer || '', required: false, max_length: 2048
                            }]
                        }
                    ]
                });
            }
            return;
        }

        // ── COPY ──────────────────────────────────────────────────────────
        if (sub === 'copy') {
            const source = interaction.options.getString('source').trim().toLowerCase();
            const target = interaction.options.getString('target').trim().toLowerCase();
            if (!isValidName(target)) return interaction.reply({ content: s.copy_invalid_name, flags: MessageFlags.Ephemeral });
            const tmpl = getTemplate(client, guildId, source);
            if (!tmpl) return interaction.reply({ content: s.copy_src_not_found(source), flags: MessageFlags.Ephemeral });
            if (getTemplate(client, guildId, target)) return interaction.reply({ content: s.copy_exists(target), flags: MessageFlags.Ephemeral });

            saveTemplate(client, guildId, target, {
                ...tmpl,
                kategori:  KATEGORI.BIASA,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
            return interaction.reply({
                content: s.copied(source, target),
                flags: MessageFlags.Ephemeral
            });
        }

        // ── DELETE ────────────────────────────────────────────────────────
        if (sub === 'delete') {
            const name = interaction.options.getString('name').trim().toLowerCase();
            const tmpl = getTemplate(client, guildId, name);
            if (!tmpl) return interaction.reply({ content: s.delete_not_found(name), flags: MessageFlags.Ephemeral });

            deleteTemplate(client, guildId, name);
            deleteSentUnik(client, guildId, name);

            let deletedPanels = [];
            try {
                const rawList   = client.database.get(`autobtn-list-${guildId}`);
                const panelList = rawList ? JSON.parse(rawList) : [];
                const remaining = [];
                for (const panelName of panelList) {
                    const rawPanel = client.database.get(`autobtn-${guildId}-${panelName}`);
                    if (!rawPanel) continue;
                    const panel = JSON.parse(rawPanel);
                    if (panel.templateName === name) {
                        client.database.delete(`autobtn-${guildId}-${panelName}`);
                        deletedPanels.push(panelName);
                    } else {
                        remaining.push(panelName);
                    }
                }
                if (deletedPanels.length > 0) {
                    client.database.set(`autobtn-list-${guildId}`, JSON.stringify(remaining));
                }
            } catch { /* ignore cascade errors */ }

            const cascadeInfo = deletedPanels.length > 0
                ? s.deleted_cascade(deletedPanels.map(n => `\`${n}\``).join(', '))
                : '';

            return interaction.reply({
                content: s.deleted(name) + cascadeInfo,
                flags: MessageFlags.Ephemeral
            });
        }
    }
}).toJSON();

const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    AttachmentBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { getLang, getStrings } = require('../../utils/BotLang');
const { resolveChannel } = require('../../utils/resolveGuildOption');
const { checkBotPermissions } = require('../../utils/checkBotPermissions');
const { generateCardAsync } = require('../../utils/generateWelcomeCard');

function setBool(client, key, val) {
    client.database.set(key, val ? 'true' : 'false');
}

function getBool(client, key, defaultVal) {
    const raw = client.database.get(key);
    if (raw === null || raw === undefined) return defaultVal;
    if (raw === 'false' || raw === false || raw === 0) return false;
    return true;
}

function getConfig(client, guildId) {
    return {
        enabled:      getBool(client, `goodbye-enabled-${guildId}`,      false),
        channelId:    client.database.get(`goodbye-channel-${guildId}`)  ?? null,
        messageType:  client.database.get(`goodbye-messageType-${guildId}`) ?? 'embed',
        plainText:    client.database.get(`goodbye-plainText-${guildId}`)   ?? '',
        title:        client.database.get(`goodbye-title-${guildId}`)    ?? '👋 Goodbye!',
        description:  client.database.get(`goodbye-description-${guildId}`) ?? '{member} has left the server.',
        color:        client.database.get(`goodbye-color-${guildId}`)    ?? '#ED4245',
        footerText:   client.database.get(`goodbye-footer-${guildId}`)   ?? null,
        thumbnail:    getBool(client, `goodbye-thumbnail-${guildId}`,     false),
        // ── Goodbye Card ────────────────────────────────────────────────
        cardEnabled:        getBool(client, `goodbye-cardEnabled-${guildId}`,   false),
        cardBgColor:        client.database.get(`goodbye-cardBgColor-${guildId}`)        ?? '#1a0a0a',
        cardBgColor2:       client.database.get(`goodbye-cardBgColor2-${guildId}`)       ?? '#2e0a0a',
        cardAccentColor:    client.database.get(`goodbye-cardAccent-${guildId}`)         ?? '#ED4245',
        cardTextColor:      client.database.get(`goodbye-cardTextColor-${guildId}`)      ?? '#ffffff',
        cardWelcomeText:    client.database.get(`goodbye-cardWelcomeText-${guildId}`)    ?? 'GOODBYE',
        cardSubText:        client.database.get(`goodbye-cardSubText-${guildId}`)        ?? 'FROM {server}',
        cardAvatarShape:    client.database.get(`goodbye-cardAvatarShape-${guildId}`)    ?? 'circle',
        cardBgType:         client.database.get(`goodbye-cardBgType-${guildId}`)         ?? 'gradient',
        cardBgImageUrl:     client.database.get(`goodbye-cardBgImageUrl-${guildId}`)     ?? '',
        cardOverlayColor:   client.database.get(`goodbye-cardOverlayColor-${guildId}`)   ?? '#000000',
        cardOverlayOpacity: parseInt(client.database.get(`goodbye-cardOverlayOpacity-${guildId}`) || '0'),
        cardTitleColor:     client.database.get(`goodbye-cardTitleColor-${guildId}`)     ?? '#ffffff',
        cardUsernameColor:  client.database.get(`goodbye-cardUsernameColor-${guildId}`)  ?? '',
        cardMsgColor:       client.database.get(`goodbye-cardMsgColor-${guildId}`)       ?? '#cccccc',
        cardFont:           client.database.get(`goodbye-cardFont-${guildId}`)           ?? 'impact',
    };
}

module.exports = new ApplicationCommand({
    command: {
        name: 'goodbye',
        description: 'Configure goodbye notifications for members who leave.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            { name: 'status',  description: 'View the current goodbye configuration.', type: 1 },
            {
                name: 'toggle',
                description: 'Enable or disable goodbye messages.',
                type: 1,
                options: [{ name: 'active', description: 'true = enable, false = disable', type: 5, required: true }]
            },
            {
                name: 'channel',
                description: 'Set the channel where goodbye messages will be sent.',
                type: 1,
                options: [{ name: 'channel', description: 'Select a text channel', type: 3, autocomplete: true, required: true }]
            },
            {
                name: 'type',
                description: 'Choose the message type: embed or plain text.',
                type: 1,
                options: [{ name: 'type', description: 'embed = use embed, plain = plain text', type: 3, required: true,
                    choices: [{ name: '🖼️ Embed', value: 'embed' }, { name: '💬 Plain Text', value: 'plain' }] }]
            },
            {
                name: 'text',
                description: 'Edit the embed title & description (embed mode) or plain text content (plain mode) via modal.',
                type: 1
            },
            {
                name: 'color',
                description: 'Change the embed color (hex, e.g. #ED4245).',
                type: 1,
                options: [{ name: 'hex', description: 'Hex color code, e.g. #ED4245', type: 3, required: true, max_length: 7 }]
            },
            {
                name: 'footer',
                description: 'Edit or remove the embed footer text.',
                type: 1,
                options: [{ name: 'text', description: 'Footer text. Type "-" to remove the footer.', type: 3, required: true, max_length: 2048 }]
            },
            {
                name: 'thumbnail',
                description: 'Show or hide the member profile picture in the embed.',
                type: 1,
                options: [{ name: 'show', description: 'true = show, false = hide', type: 5, required: true }]
            },
            {
                name: 'card',
                description: 'Configure the goodbye card (farewell image with profile picture).',
                type: 1,
                options: [{
                    name: 'action', description: 'Choose the action to perform', type: 3, required: true,
                    choices: [
                        { name: '🔌 Toggle on/off card', value: 'toggle' },
                        { name: '✏️  Edit card text',     value: 'teks'   },
                        { name: '🎨 Edit card colors',     value: 'warna'  },
                    ]
                }]
            },
            { name: 'reset',   description: 'Reset all goodbye settings to default.', type: 1 },
            { name: 'preview', description: 'Preview the goodbye message with the current settings.', type: 1 },
        ]
    },
    options: { cooldown: 3000 },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const s       = getStrings(getLang(client.database, interaction.guild?.id)).goodbye;
        const sub     = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        const ok = await checkBotPermissions(interaction, [
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
        ]);
        if (!ok) return;

        // ── STATUS ────────────────────────────────────────────────────────
        if (sub === 'status') {
            const cfg      = getConfig(client, guildId);
            const channel  = cfg.channelId ? interaction.guild.channels.cache.get(cfg.channelId) : null;
            const colorHex = cfg.color.startsWith('#') ? cfg.color : `#${cfg.color}`;
            const c        = getStrings(getLang(client.database, interaction.guild?.id)).common;
            const on  = c.shown;
            const off = c.hidden;

            const embed = new EmbedBuilder()
                .setColor(colorHex)
                .setTitle(s.status_title)
                .addFields(
                    { name: s.field_status,         value: cfg.enabled    ? c.enabled : c.disabled,                               inline: true  },
                    { name: s.field_msg_type,        value: cfg.messageType === 'plain' ? s.type_plain_label : s.type_embed_label, inline: true  },
                    { name: s.field_channel,         value: channel        ? `<#${channel.id}>` : s.not_set,                      inline: true  },
                    { name: s.field_color,           value: `\`${cfg.color}\``,                                                   inline: true  },
                    { name: s.field_title,           value: `\`${cfg.title}\``,                                                   inline: false },
                    { name: s.field_description,     value: `\`${cfg.description}\``,                                             inline: false },
                    { name: s.field_plain_text,      value: cfg.plainText  ? `\`${cfg.plainText.slice(0, 100)}\`` : s.val_none,   inline: false },
                    { name: s.field_card,            value: cfg.cardEnabled ? c.enabled : c.disabled,                             inline: true  },
                    { name: s.field_footer,    value: cfg.footerText ? `\`${cfg.footerText}\`` : s.val_none, inline: false },
                    { name: s.field_thumbnail, value: cfg.thumbnail  ? on : off, inline: true },
                )
                .setFooter({ text: s.status_footer })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── TOGGLE ────────────────────────────────────────────────────────
        if (sub === 'toggle') {
            const val = interaction.options.getBoolean('active');
            if (val && !client.database.get(`goodbye-channel-${guildId}`))
                return interaction.reply({ content: s.no_channel_error, flags: MessageFlags.Ephemeral });
            setBool(client, `goodbye-enabled-${guildId}`, val);
            return interaction.reply({
                content: val ? s.toggled_on : s.toggled_off,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── CHANNEL ───────────────────────────────────────────────────────
        if (sub === 'channel') {
            const ch = resolveChannel(interaction.guild, interaction.options.getString('channel'));
            if (!ch) return interaction.reply({ content: s.invalid_channel, flags: MessageFlags.Ephemeral });
            const chOk = await checkBotPermissions(interaction, [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], ch);
            if (!chOk) return;
            client.database.set(`goodbye-channel-${guildId}`, ch.id);
            return interaction.reply({ content: s.channel_set(`<#${ch.id}>`), flags: MessageFlags.Ephemeral });
        }

        // ── TIPE ─────────────────────────────────────────────────────────
        if (sub === 'type') {
            const val = interaction.options.getString('type');
            client.database.set(`goodbye-messageType-${guildId}`, val);
            return interaction.reply({
                content: val === 'plain' ? s.type_set_plain : s.type_set_embed,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── TEKS ─────────────────────────────────────────────────────────
        if (sub === 'text') {
            const cfg     = getConfig(client, guildId);
            const isPlain = cfg.messageType === 'plain';
            const shortId = `${interaction.user.id.slice(-6)}${Date.now().toString(36)}`;
            const modalId = `gteks-${guildId.slice(-8)}-${shortId}`;

            const modal = new ModalBuilder()
                .setCustomId(modalId)
                .setTitle(isPlain ? '✏️ Edit Plain Goodbye Text' : '✏️ Edit Goodbye Embed Text');

            if (isPlain) {
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('plainText')
                        .setLabel('Message Content: {member} {server} {count} {tag}')
                        .setStyle(TextInputStyle.Paragraph)
                        .setMaxLength(2000)
                        .setValue(cfg.plainText.slice(0, 2000))
                        .setRequired(true)
                ));
            } else {
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('title')
                            .setLabel('Title: {username} {tag} {server} (not a mention)')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(256)
                            .setValue(cfg.title.slice(0, 256))
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('description')
                            .setLabel('Description: {member}=mention {username} {server}')
                            .setStyle(TextInputStyle.Paragraph)
                            .setMaxLength(1024)
                            .setValue(cfg.description.slice(0, 1024))
                            .setRequired(true)
                    ),
                );
            }

            await interaction.showModal(modal);
            const submitted = await interaction.awaitModalSubmit({
                filter: i => i.customId === modalId && i.user.id === interaction.user.id,
                time: 5 * 60 * 1000
            }).catch(() => null);
            if (!submitted) return;

            if (isPlain) {
                const newPlain = submitted.fields.getTextInputValue('plainText').trim();
                client.database.set(`goodbye-plainText-${guildId}`, newPlain);
                return submitted.reply({
                    content: s.text_saved_plain(newPlain),
                    flags: MessageFlags.Ephemeral
                });
            } else {
                const newTitle = submitted.fields.getTextInputValue('title').trim();
                const newDesc  = submitted.fields.getTextInputValue('description').trim();
                client.database.set(`goodbye-title-${guildId}`,       newTitle);
                client.database.set(`goodbye-description-${guildId}`, newDesc);
                return submitted.reply({
                    content: s.text_saved_embed(newTitle, newDesc),
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // ── COLOR ─────────────────────────────────────────────────────────
        if (sub === 'color') {
            const val = interaction.options.getString('hex').trim();
            if (!/^#?[0-9A-Fa-f]{6}$/.test(val))
                return interaction.reply({ content: s.invalid_color, flags: MessageFlags.Ephemeral });
            const clean = val.startsWith('#') ? val : `#${val}`;
            client.database.set(`goodbye-color-${guildId}`, clean);
            return interaction.reply({ content: s.color_set(clean), flags: MessageFlags.Ephemeral });
        }

        // ── FOOTER ────────────────────────────────────────────────────────
        if (sub === 'footer') {
            const val = interaction.options.getString('text').trim();
            if (val === '-') {
                client.database.delete(`goodbye-footer-${guildId}`);
                return interaction.reply({ content: s.footer_removed, flags: MessageFlags.Ephemeral });
            }
            client.database.set(`goodbye-footer-${guildId}`, val);
            return interaction.reply({ content: s.footer_set, flags: MessageFlags.Ephemeral });
        }

        // ── THUMBNAIL ─────────────────────────────────────────────────────
        if (sub === 'thumbnail') {
            const val = interaction.options.getBoolean('show');
            setBool(client, `goodbye-thumbnail-${guildId}`, val);
            return interaction.reply({
                content: val ? s.thumbnail_on : s.thumbnail_off,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── CARD ─────────────────────────────────────────────────────────
        if (sub === 'card') {
            const action = interaction.options.getString('action');
            const cfg  = getConfig(client, guildId);

            if (action === 'toggle') {
                const newVal = !cfg.cardEnabled;
                setBool(client, `goodbye-cardEnabled-${guildId}`, newVal);
                return interaction.reply({
                    content: newVal ? s.card_on : s.card_off,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (action === 'teks') {
                const shortId = `${interaction.user.id.slice(-6)}${Date.now().toString(36)}`;
                const modalId = `gcard-teks-${guildId.slice(-8)}-${shortId}`;
                const modal = new ModalBuilder().setCustomId(modalId).setTitle('✏️ Edit Goodbye Card Text');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('welcomeText')
                            .setLabel('Large top text (e.g. GOODBYE)')
                            .setStyle(TextInputStyle.Short).setMaxLength(20)
                            .setValue(cfg.cardWelcomeText).setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('subText')
                            .setLabel('Small bottom text: {server} {count} {tag}')
                            .setStyle(TextInputStyle.Short).setMaxLength(60)
                            .setValue(cfg.cardSubText).setRequired(true)
                    ),
                );
                await interaction.showModal(modal);
                const submitted = await interaction.awaitModalSubmit({
                    filter: i => i.customId === modalId && i.user.id === interaction.user.id,
                    time: 5 * 60 * 1000
                }).catch(() => null);
                if (!submitted) return;
                client.database.set(`goodbye-cardWelcomeText-${guildId}`, submitted.fields.getTextInputValue('welcomeText').trim());
                client.database.set(`goodbye-cardSubText-${guildId}`,     submitted.fields.getTextInputValue('subText').trim());
                return submitted.reply({ content: s.card_text_saved, flags: MessageFlags.Ephemeral });
            }

            if (action === 'warna') {
                const shortId = `${interaction.user.id.slice(-6)}${Date.now().toString(36)}`;
                const modalId = `gcard-warna-${guildId.slice(-8)}-${shortId}`;
                const modal = new ModalBuilder().setCustomId(modalId).setTitle('🎨 Edit Goodbye Card Colors');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bgColor').setLabel('Left background color (hex)').setStyle(TextInputStyle.Short).setMaxLength(7).setValue(cfg.cardBgColor).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bgColor2').setLabel('Right background color (hex)').setStyle(TextInputStyle.Short).setMaxLength(7).setValue(cfg.cardBgColor2).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('accentColor').setLabel('Accent/avatar border color (hex)').setStyle(TextInputStyle.Short).setMaxLength(7).setValue(cfg.cardAccentColor).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('textColor').setLabel('Main text color (hex)').setStyle(TextInputStyle.Short).setMaxLength(7).setValue(cfg.cardTextColor).setRequired(true)),
                );
                await interaction.showModal(modal);
                const submitted = await interaction.awaitModalSubmit({
                    filter: i => i.customId === modalId && i.user.id === interaction.user.id,
                    time: 5 * 60 * 1000
                }).catch(() => null);
                if (!submitted) return;
                const hexRe = /^#[0-9A-Fa-f]{6}$/;
                const colorFields = [
                    { id: 'bgColor',     key: `goodbye-cardBgColor-${guildId}`,   label: 'Left background'  },
                    { id: 'bgColor2',    key: `goodbye-cardBgColor2-${guildId}`,  label: 'Right background' },
                    { id: 'accentColor', key: `goodbye-cardAccent-${guildId}`,    label: 'Accent'       },
                    { id: 'textColor',   key: `goodbye-cardTextColor-${guildId}`, label: 'Main text'  },
                ];
                const errors = [];
                for (const f of colorFields) {
                    const val = submitted.fields.getTextInputValue(f.id).trim();
                    if (!hexRe.test(val)) { errors.push(f.label); continue; }
                    client.database.set(f.key, val);
                }
                if (errors.length > 0) {
                    return submitted.reply({
                        content: s.card_colors_error(errors.join(', ')),
                        flags: MessageFlags.Ephemeral
                    });
                }
                return submitted.reply({ content: s.card_colors_saved, flags: MessageFlags.Ephemeral });
            }
        }

        // ── RESET ─────────────────────────────────────────────────────────
        if (sub === 'reset') {
            ['enabled', 'channel', 'messageType', 'plainText', 'title', 'description', 'color', 'footer', 'thumbnail',
             'cardEnabled', 'cardBgColor', 'cardBgColor2', 'cardAccent', 'cardTextColor', 'cardWelcomeText', 'cardSubText',
             'cardAvatarShape', 'cardBgType', 'cardBgImageUrl', 'cardOverlayColor', 'cardOverlayOpacity',
             'cardTitleColor', 'cardUsernameColor', 'cardMsgColor', 'cardFont']
                .forEach(k => client.database.delete(`goodbye-${k}-${guildId}`));
            return interaction.reply({ content: s.reset_done, flags: MessageFlags.Ephemeral });
        }

        // ── PREVIEW ───────────────────────────────────────────────────────
        if (sub === 'preview') {
            const cfg      = getConfig(client, guildId);
            const member   = interaction.member;
            const colorHex = cfg.color.startsWith('#') ? cfg.color : `#${cfg.color}`;

            const displayName     = member.displayName || member.user.username;
            const createdRelative = `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`;

            // For title & footer: {member} → @displayName (mention doesn't render in embed title)
            const parseTitle = (str) => str
                .replace(/{member}/g,       `@${displayName}`)
                .replace(/{username}/g,     member.user.username)
                .replace(/{tag}/g,          member.user.tag)
                .replace(/{server}/g,       interaction.guild.name)
                .replace(/{count}/g,        String(interaction.guild.memberCount))
                .replace(/{account\.created}/g, createdRelative);

            // For description & plain text: {member} → mention <@ID>
            const parse = (str) => str
                .replace(/{member}/g,          `<@${member.id}>`)
                .replace(/{username}/g,        member.user.username)
                .replace(/{tag}/g,             member.user.tag)
                .replace(/{server}/g,          interaction.guild.name)
                .replace(/{count}/g,           String(interaction.guild.memberCount))
                .replace(/{account\.created}/g,createdRelative);

            // Generate goodbye card
            let cardAttachment = null;
            if (cfg.cardEnabled) {
                try {
                    const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
                    const cardBuf   = await generateCardAsync({
                        avatarUrl,
                        username:       member.user.username,
                        serverName:     interaction.guild.name,
                        welcomeText:    cfg.cardWelcomeText,
                        subText:        cfg.cardSubText,
                        bgColor:        cfg.cardBgColor,
                        bgColor2:       cfg.cardBgColor2,
                        accentColor:    cfg.cardAccentColor,
                        avatarShape:    cfg.cardAvatarShape,
                        bgType:         cfg.cardBgType,
                        bgImageUrl:     cfg.cardBgImageUrl,
                        overlayColor:   cfg.cardOverlayColor,
                        overlayOpacity: cfg.cardOverlayOpacity,
                        titleColor:     cfg.cardTitleColor    || cfg.cardTextColor,
                        usernameColor:  cfg.cardUsernameColor || cfg.cardAccentColor,
                        messageColor:   cfg.cardMsgColor,
                        fontFamily:     cfg.cardFont,
                    });
                    cardAttachment = new AttachmentBuilder(cardBuf, { name: 'goodbye-card.png' });
                } catch (err) {
                    console.error('[goodbye preview] Card generation failed:', err.message);
                }
            }

            // Plain text mode
            if (cfg.messageType === 'plain') {
                const content = parse(cfg.plainText).trim();
                if (content || cardAttachment) {
                    const payload = { flags: MessageFlags.Ephemeral };
                    payload.content = `${s.preview_mode}${content ? '\n' + content : ''}`;
                    if (cardAttachment) payload.files = [cardAttachment];
                    return interaction.reply(payload);
                }
                return interaction.reply({ content: s.preview_mode_empty, flags: MessageFlags.Ephemeral });
            }

            // Embed mode
            const hasText = cfg.title.trim() || cfg.description.trim();

            if (!hasText && !cardAttachment) {
                return interaction.reply({ content: s.preview_mode_empty, flags: MessageFlags.Ephemeral });
            }

            const embed = new EmbedBuilder()
                .setColor(colorHex)
                .setAuthor({ name: s.preview_title })
                .setTimestamp();

            if (parseTitle(cfg.title))  embed.setTitle(parseTitle(cfg.title));
            if (parse(cfg.description)) embed.setDescription(parse(cfg.description));
            if (cfg.footerText) embed.setFooter({ text: parseTitle(cfg.footerText) });
            if (cfg.thumbnail)  embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));
            if (cardAttachment) embed.setImage('attachment://goodbye-card.png');

            const payload = { embeds: [embed], flags: MessageFlags.Ephemeral };
            if (cardAttachment) payload.files = [cardAttachment];
            return interaction.reply(payload);
        }
    }
}).toJSON();

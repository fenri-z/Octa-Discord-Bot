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
const { resolveChannel } = require('../../utils/resolveGuildOption');
const { checkBotPermissions } = require('../../utils/checkBotPermissions');
const { generateWelcomeCard } = require('../../utils/generateWelcomeCard');

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
        enabled:           getBool(client, `welcome-enabled-${guildId}`,           false),
        channelId:         client.database.get(`welcome-channel-${guildId}`)       ?? null,
        messageType:       client.database.get(`welcome-messageType-${guildId}`)   ?? 'embed',
        plainText:         client.database.get(`welcome-plainText-${guildId}`)     ?? '',
        title:             client.database.get(`welcome-title-${guildId}`)         ?? '',
        description:       client.database.get(`welcome-description-${guildId}`)   ?? '',
        color:             client.database.get(`welcome-color-${guildId}`)         ?? '#5865F2',
        footerText:        client.database.get(`welcome-footer-${guildId}`)        ?? null,
        thumbnail:         getBool(client, `welcome-thumbnail-${guildId}`,          false),
        // ── Welcome Card ────────────────────────────────────────────────
        cardEnabled:        getBool(client, `welcome-cardEnabled-${guildId}`,  false),
        cardBgColor:        client.database.get(`welcome-cardBgColor-${guildId}`)        ?? '#1a1a2e',
        cardBgColor2:       client.database.get(`welcome-cardBgColor2-${guildId}`)       ?? '#16213e',
        cardAccentColor:    client.database.get(`welcome-cardAccent-${guildId}`)         ?? '#5865F2',
        cardTextColor:      client.database.get(`welcome-cardTextColor-${guildId}`)      ?? '#ffffff',
        cardWelcomeText:    client.database.get(`welcome-cardWelcomeText-${guildId}`)    ?? 'WELCOME',
        cardUserPrefix:     client.database.get(`welcome-cardUserPrefix-${guildId}`)     ?? '.',
        cardSubText:        client.database.get(`welcome-cardSubText-${guildId}`)        ?? 'TO {server}',
        cardAvatarShape:    client.database.get(`welcome-cardAvatarShape-${guildId}`)    ?? 'circle',
        cardBgType:         client.database.get(`welcome-cardBgType-${guildId}`)         ?? 'gradient',
        cardBgImageUrl:     client.database.get(`welcome-cardBgImageUrl-${guildId}`)     ?? '',
        cardOverlayColor:   client.database.get(`welcome-cardOverlayColor-${guildId}`)   ?? '#000000',
        cardOverlayOpacity: parseInt(client.database.get(`welcome-cardOverlayOpacity-${guildId}`) || '0'),
        cardTitleColor:     client.database.get(`welcome-cardTitleColor-${guildId}`)     ?? '#ffffff',
        cardUsernameColor:  client.database.get(`welcome-cardUsernameColor-${guildId}`)  ?? '',
        cardMsgColor:       client.database.get(`welcome-cardMsgColor-${guildId}`)       ?? '#cccccc',
        cardFont:           client.database.get(`welcome-cardFont-${guildId}`)           ?? 'impact',
        // ── Toggle per-field ────────────────────────────────────────────
        showMemberNew:     getBool(client, `welcome-showMemberNew-${guildId}`,      false),
        showAkunDibuat:    getBool(client, `welcome-showAkunDibuat-${guildId}`,     false),
        showTotalMember:   getBool(client, `welcome-showTotalMember-${guildId}`,    false),
        showDiundangOleh:  getBool(client, `welcome-showDiundangOleh-${guildId}`,   false),
        showKodeInvite:    getBool(client, `welcome-showKodeInvite-${guildId}`,     false),
        showTotalUndangan: getBool(client, `welcome-showTotalUndangan-${guildId}`,  false),
    };
}

module.exports = new ApplicationCommand({
    command: {
        name: 'welcome',
        description: 'Configure welcome notifications for new members.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            {
                name: 'status',
                description: 'View the current welcome configuration.',
                type: 1
            },
            {
                name: 'toggle',
                description: 'Enable or disable welcome messages.',
                type: 1,
                options: [{ name: 'active', description: 'true = enable, false = disable', type: 5, required: true }]
            },
            {
                name: 'channel',
                description: 'Set the channel where welcome messages will be sent.',
                type: 1,
                options: [{ name: 'channel', description: 'Select a text channel', type: 3, autocomplete: true, required: true }]
            },
            {
                name: 'type',
                description: 'Choose the message type: embed or plain text.',
                type: 1,
                options: [{ name: 'type', description: 'embed = use embed, plain = plain text', type: 3, required: true, choices: [{ name: '🖼️ Embed', value: 'embed' }, { name: '💬 Plain Text', value: 'plain' }] }]
            },
            {
                name: 'text',
                description: 'Edit the embed title & description (embed mode) or plain text content (plain mode) via modal.',
                type: 1
            },
            {
                name: 'color',
                description: 'Change the embed color (hex, e.g. #FF5733).',
                type: 1,
                options: [{ name: 'hex', description: 'Hex color code, e.g. #5865F2', type: 3, required: true, max_length: 7 }]
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
                name: 'fields',
                description: 'Enable or disable info fields in the embed (member & inviter).',
                type: 1,
                options: [
                    {
                        name: 'field',
                        description: 'Choose the field to toggle',
                        type: 3,
                        required: true,
                        choices: [
                            { name: '👤 New Member',    value: 'member_baru'    },
                            { name: '📅 Account Created',    value: 'akun_dibuat'    },
                            { name: '👥 Total Members',   value: 'total_member'   },
                            { name: '📨 Invited By',  value: 'diundang_oleh'  },
                            { name: '🔗 Invite Code',    value: 'kode_invite'    },
                            { name: '📊 Total Invites', value: 'total_undangan' },
                        ]
                    },
                    { name: 'show', description: 'true = show, false = hide', type: 5, required: true }
                ]
            },
            {
                name: 'card',
                description: 'Configure the welcome card (greeting image with profile picture).',
                type: 1,
                options: [
                    {
                        name: 'action',
                        description: 'Choose the action to perform',
                        type: 3,
                        required: true,
                        choices: [
                            { name: '🔌 Toggle card on/off',       value: 'toggle'  },
                            { name: '✏️  Edit card text',           value: 'teks'    },
                            { name: '🎨 Edit card colors',           value: 'warna'   },
                        ]
                    }
                ]
            },
            {
                name: 'reset',
                description: 'Reset all welcome settings to default.',
                type: 1
            },
            {
                name: 'preview',
                description: 'Preview the welcome message with the current settings.',
                type: 1
            }
        ]
    },
    options: { cooldown: 3000 },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const sub     = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        const ok = await checkBotPermissions(interaction, [
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
        ]);
        if (!ok) return;

        // ── STATUS ────────────────────────────────────────────────────────
        if (sub === 'status') {
            const cfg     = getConfig(client, guildId);
            const channel = cfg.channelId ? interaction.guild.channels.cache.get(cfg.channelId) : null;
            const colorHex = cfg.color.startsWith('#') ? cfg.color : `#${cfg.color}`;

            const on  = '✅ Shown';
            const off = '❌ Hidden';

            const embed = new EmbedBuilder()
                .setColor(colorHex)
                .setTitle('⚙️ Welcome Message Configuration')
                .addFields(
                    { name: '🔌 Status',           value: cfg.enabled           ? '✅ Enabled' : '❌ Disabled',         inline: true },
                    { name: '📨 Message Type',        value: cfg.messageType === 'plain' ? '💬 Plain Text' : '🖼️ Embed',         inline: true },
                    { name: '📢 Channel',           value: channel               ? `<#${channel.id}>` : '`Not set`', inline: true },
                    { name: '🎨 Color',             value: `\`${cfg.color}\``,                                           inline: true },
                    { name: '📌 Title',             value: `\`${cfg.title}\``,                                           inline: false },
                    { name: '📝 Description',         value: `\`${cfg.description}\``,                                     inline: false },
                    { name: '💬 Plain Text',         value: `\`${cfg.plainText}\``,                                          inline: false },
                    { name: '🃏 Welcome Card',      value: cfg.cardEnabled ? '✅ Enabled' : '❌ Disabled',  inline: true },
                    { name: '🔻 Footer',            value: cfg.footerText        ? `\`${cfg.footerText}\`` : '`(none)`', inline: false },
                    { name: '🖼️ Thumbnail',         value: cfg.thumbnail         ? on : off,  inline: true },
                    { name: '👤 New Member',       value: cfg.showMemberNew     ? on : off,  inline: true },
                    { name: '📅 Account Created',       value: cfg.showAkunDibuat    ? on : off,  inline: true },
                    { name: '👥 Total Members',      value: cfg.showTotalMember   ? on : off,  inline: true },
                    { name: '📨 Invited By',     value: cfg.showDiundangOleh  ? on : off,  inline: true },
                    { name: '🔗 Invite Code',       value: cfg.showKodeInvite    ? on : off,  inline: true },
                    { name: '📊 Total Invites',    value: cfg.showTotalUndangan ? on : off,  inline: true },
                )
                .setFooter({ text: 'Use /welcome preview to see the embed preview.' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── TOGGLE ────────────────────────────────────────────────────────
        if (sub === 'toggle') {
            const val = interaction.options.getBoolean('active');
            if (val && !client.database.get(`welcome-channel-${guildId}`))
                return interaction.reply({ content: '❌ Set the welcome channel first using `/welcome channel`.', flags: MessageFlags.Ephemeral });
            setBool(client, `welcome-enabled-${guildId}`, val);
            return interaction.reply({
                content: val ? '✅ Welcome message **enabled**.' : '❌ Welcome message **disabled**.',
                flags: MessageFlags.Ephemeral
            });
        }

        // ── CHANNEL ───────────────────────────────────────────────────────
        if (sub === 'channel') {
            const ch = resolveChannel(interaction.guild, interaction.options.getString('channel'));
            if (!ch) return interaction.reply({ content: '❌ Channel not found.', flags: MessageFlags.Ephemeral });
            const chOk = await checkBotPermissions(interaction, [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], ch);
            if (!chOk) return;
            client.database.set(`welcome-channel-${guildId}`, ch.id);
            return interaction.reply({ content: `✅ Welcome channel set to <#${ch.id}>.`, flags: MessageFlags.Ephemeral });
        }

        // ── TIPE ─────────────────────────────────────────────────────────
        if (sub === 'type') {
            const val = interaction.options.getString('type');
            client.database.set(`welcome-messageType-${guildId}`, val);
            return interaction.reply({
                content: val === 'plain'
                    ? '✅ Welcome message type changed to **Plain Text**. Use `/welcome text` to set the content.'
                    : '✅ Welcome message type changed to **Embed**. Use `/welcome text` to set the title & description.',
                flags: MessageFlags.Ephemeral
            });
        }

        // ── TEXT (modal: embed title + description, or plain text) ───────────
        if (sub === 'text') {
            const cfg      = getConfig(client, guildId);
            const isPlain  = cfg.messageType === 'plain';
            const shortId  = `${interaction.user.id.slice(-6)}${Date.now().toString(36)}`;
            const modalId  = `wteks-${guildId.slice(-8)}-${shortId}`;

            const modal = new ModalBuilder()
                .setCustomId(modalId)
                .setTitle(isPlain ? '✏️ Edit Plain Welcome Text' : '✏️ Edit Welcome Embed Text');

            if (isPlain) {
                const plainInput = new TextInputBuilder()
                    .setCustomId('plainText')
                    .setLabel('Message Content: {member} {server} {count} {tag}')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(2000)
                    .setValue(cfg.plainText.slice(0, 2000))
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(plainInput));
            } else {
                const titleInput = new TextInputBuilder()
                    .setCustomId('title')
                    .setLabel('Title: {server} {member} {count} {tag}')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(256)
                    .setValue(cfg.title.slice(0, 256))
                    .setRequired(true);

                const descInput = new TextInputBuilder()
                    .setCustomId('description')
                    .setLabel('Description: {member} {server} {count}')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(1024)
                    .setValue(cfg.description.slice(0, 1024))
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(titleInput),
                    new ActionRowBuilder().addComponents(descInput),
                );
            }

            await interaction.showModal(modal);

            // Wait for modal submit (max 5 minutes), strict filter per modalId + user
            const submitted = await interaction.awaitModalSubmit({
                filter: i => i.customId === modalId && i.user.id === interaction.user.id,
                time: 5 * 60 * 1000
            }).catch(() => null);

            if (!submitted) return; // timeout or cancelled, do nothing

            if (isPlain) {
                const newPlain = submitted.fields.getTextInputValue('plainText').trim();
                client.database.set(`welcome-plainText-${guildId}`, newPlain);
                return submitted.reply({
                    content: `✅ Welcome plain text updated.\n**Message:** ${newPlain}`,
                    flags: MessageFlags.Ephemeral
                });
            } else {
                const newTitle = submitted.fields.getTextInputValue('title').trim();
                const newDesc  = submitted.fields.getTextInputValue('description').trim();
                client.database.set(`welcome-title-${guildId}`,       newTitle);
                client.database.set(`welcome-description-${guildId}`, newDesc);
                return submitted.reply({
                    content: `✅ Welcome embed text updated.\n**Title:** ${newTitle}\n**Description:** ${newDesc}`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // ── COLOR ─────────────────────────────────────────────────────────
        if (sub === 'color') {
            const val = interaction.options.getString('hex').trim();
            if (!/^#?[0-9A-Fa-f]{6}$/.test(val))
                return interaction.reply({ content: '❌ Invalid color format. Use hex like `#5865F2`.', flags: MessageFlags.Ephemeral });
            const clean = val.startsWith('#') ? val : `#${val}`;
            client.database.set(`welcome-color-${guildId}`, clean);
            return interaction.reply({ content: `✅ Embed color updated to \`${clean}\`.`, flags: MessageFlags.Ephemeral });
        }

        // ── FOOTER ────────────────────────────────────────────────────────
        if (sub === 'footer') {
            const val = interaction.options.getString('text').trim();
            if (val === '-') {
                client.database.delete(`welcome-footer-${guildId}`);
                return interaction.reply({ content: '✅ Embed footer **removed**.', flags: MessageFlags.Ephemeral });
            }
            client.database.set(`welcome-footer-${guildId}`, val);
            return interaction.reply({ content: `✅ Embed footer updated:\n> ${val}`, flags: MessageFlags.Ephemeral });
        }

        // ── THUMBNAIL ─────────────────────────────────────────────────────
        if (sub === 'thumbnail') {
            const val = interaction.options.getBoolean('show');
            setBool(client, `welcome-thumbnail-${guildId}`, val);
            return interaction.reply({
                content: val ? '✅ Profile picture thumbnail **shown**.' : '✅ Profile picture thumbnail **hidden**.',
                flags: MessageFlags.Ephemeral
            });
        }

        // ── FIELDS ────────────────────────────────────────────────────────
        if (sub === 'fields') {
            const field = interaction.options.getString('field');
            const val   = interaction.options.getBoolean('show');

            const fieldMap = {
                member_baru:    { key: `welcome-showMemberNew-${guildId}`,     label: '👤 New Member'    },
                akun_dibuat:    { key: `welcome-showAkunDibuat-${guildId}`,    label: '📅 Account Created'    },
                total_member:   { key: `welcome-showTotalMember-${guildId}`,   label: '👥 Total Members'   },
                diundang_oleh:  { key: `welcome-showDiundangOleh-${guildId}`,  label: '📨 Invited By'  },
                kode_invite:    { key: `welcome-showKodeInvite-${guildId}`,    label: '🔗 Invite Code'    },
                total_undangan: { key: `welcome-showTotalUndangan-${guildId}`, label: '📊 Total Invites' },
            };

            const target = fieldMap[field];
            if (!target) return interaction.reply({ content: '❌ Invalid field.', flags: MessageFlags.Ephemeral });

            setBool(client, target.key, val);
            return interaction.reply({
                content: val
                    ? `✅ Field **${target.label}** is now **shown** in the embed.`
                    : `✅ Field **${target.label}** is now **hidden** from the embed.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── CARD ─────────────────────────────────────────────────────────
        if (sub === 'card') {
            const action = interaction.options.getString('action');
            const cfg  = getConfig(client, guildId);

            // ── toggle ──────────────────────────────────────────────────
            if (action === 'toggle') {
                const newVal = !cfg.cardEnabled;
                setBool(client, `welcome-cardEnabled-${guildId}`, newVal);
                return interaction.reply({
                    content: newVal
                        ? '✅ Welcome card **enabled**. The greeting image will be sent along with the welcome message.'
                        : '❌ Welcome card **disabled**.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // ── teks ────────────────────────────────────────────────────
            if (action === 'teks') {
                const shortId = `${interaction.user.id.slice(-6)}${Date.now().toString(36)}`;
                const modalId = `wcard-teks-${guildId.slice(-8)}-${shortId}`;

                const modal = new ModalBuilder()
                    .setCustomId(modalId)
                    .setTitle('✏️ Edit Welcome Card Text');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('welcomeText')
                            .setLabel('Large top text (e.g. WELCOME)')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(20)
                            .setValue(cfg.cardWelcomeText)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('subText')
                            .setLabel('Small bottom text: {server} {count} {tag}')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(60)
                            .setValue(cfg.cardSubText)
                            .setRequired(true)
                    ),
                );

                await interaction.showModal(modal);
                const submitted = await interaction.awaitModalSubmit({
                    filter: i => i.customId === modalId && i.user.id === interaction.user.id,
                    time: 5 * 60 * 1000
                }).catch(() => null);

                if (!submitted) return;

                const newWelcomeText = submitted.fields.getTextInputValue('welcomeText').trim();
                const newSubText     = submitted.fields.getTextInputValue('subText').trim();

                client.database.set(`welcome-cardWelcomeText-${guildId}`, newWelcomeText);
                client.database.set(`welcome-cardSubText-${guildId}`,     newSubText);

                return submitted.reply({
                    content: `✅ Welcome card text updated!\n**Large Text:** ${newWelcomeText}\n**Sub Text:** ${newSubText}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // ── warna ───────────────────────────────────────────────────
            if (action === 'warna') {
                const shortId = `${interaction.user.id.slice(-6)}${Date.now().toString(36)}`;
                const modalId = `wcard-warna-${guildId.slice(-8)}-${shortId}`;

                const modal = new ModalBuilder()
                    .setCustomId(modalId)
                    .setTitle('🎨 Edit Welcome Card Colors');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('bgColor')
                            .setLabel('Left background color (hex, e.g. #1a1a2e)')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(7)
                            .setValue(cfg.cardBgColor)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('bgColor2')
                            .setLabel('Right background color (hex, e.g. #16213e)')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(7)
                            .setValue(cfg.cardBgColor2)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('accentColor')
                            .setLabel('Accent/avatar border color (hex)')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(7)
                            .setValue(cfg.cardAccentColor)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('textColor')
                            .setLabel('Main text color (hex, e.g. #ffffff)')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(7)
                            .setValue(cfg.cardTextColor)
                            .setRequired(true)
                    ),
                );

                await interaction.showModal(modal);
                const submitted = await interaction.awaitModalSubmit({
                    filter: i => i.customId === modalId && i.user.id === interaction.user.id,
                    time: 5 * 60 * 1000
                }).catch(() => null);

                if (!submitted) return;

                const hexRe = /^#[0-9A-Fa-f]{6}$/;
                const fields = [
                    { id: 'bgColor',     key: `welcome-cardBgColor-${guildId}`,   label: 'Left background'    },
                    { id: 'bgColor2',    key: `welcome-cardBgColor2-${guildId}`,  label: 'Right background'   },
                    { id: 'accentColor', key: `welcome-cardAccent-${guildId}`,    label: 'Accent'         },
                    { id: 'textColor',   key: `welcome-cardTextColor-${guildId}`, label: 'Main text'    },
                ];

                const errors = [];
                for (const f of fields) {
                    const val = submitted.fields.getTextInputValue(f.id).trim();
                    if (!hexRe.test(val)) { errors.push(f.label); continue; }
                    client.database.set(f.key, val);
                }

                if (errors.length > 0) {
                    return submitted.reply({
                        content: `⚠️ Invalid color format for: **${errors.join(', ')}**. Use hex format like \`#5865F2\`. Other valid fields have been saved.`,
                        flags: MessageFlags.Ephemeral
                    });
                }

                return submitted.reply({
                    content: '✅ Welcome card colors successfully updated!',
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // ── RESET ─────────────────────────────────────────────────────────
        if (sub === 'reset') {
            ['enabled', 'channel', 'messageType', 'plainText', 'title', 'description', 'color', 'footer', 'thumbnail',
             'cardEnabled', 'cardBgColor', 'cardBgColor2', 'cardAccent', 'cardTextColor', 'cardWelcomeText', 'cardUserPrefix', 'cardSubText',
             'showMemberNew', 'showAkunDibuat', 'showTotalMember',
             'showDiundangOleh', 'showKodeInvite', 'showTotalUndangan']
                .forEach(k => client.database.delete(`welcome-${k}-${guildId}`));
            return interaction.reply({ content: '🔄 All welcome settings have been **reset to default**.', flags: MessageFlags.Ephemeral });
        }

        // ── PREVIEW ───────────────────────────────────────────────────────
        if (sub === 'preview') {
            const cfg      = getConfig(client, guildId);
            const member   = interaction.member;
            const colorHex = cfg.color.startsWith('#') ? cfg.color : `#${cfg.color}`;

            const parse = (str) => str
                .replace(/{member}/g,          `<@${member.id}>`)
                .replace(/{username}/g,        member.user.username)
                .replace(/{tag}/g,             member.user.tag)
                .replace(/{server}/g,          interaction.guild.name)
                .replace(/{count}/g,           String(interaction.guild.memberCount))
                .replace(/{inviter}/g,         member.user.tag + ' (example)')
                .replace(/{kode\.invite}/g,    'abc123 (example)')
                .replace(/{total\.undangan}/g, '42 (example)')
                .replace(/{akun\.dibuat}/g,    `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`);

            // Generate welcome card if cardEnabled
            let cardAttachment = null;
            if (cfg.cardEnabled) {
                try {
                    const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
                    const cardBuf   = await generateWelcomeCard({
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
                    cardAttachment = new AttachmentBuilder(cardBuf, { name: 'welcome-card.png' });
                } catch (err) {
                    console.error('[preview] Welcome card generation failed:', err.message);
                }
            }

            // Plain text mode
            if (cfg.messageType === 'plain') {
                let content = parse(cfg.plainText).trim();
                const infoLines = [];
                if (cfg.showMemberNew)     infoLines.push(`👤 **New Member:** ${member.user.tag}`);
                if (cfg.showAkunDibuat)    infoLines.push(`📅 **Account Created:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`);
                if (cfg.showTotalMember)   infoLines.push(`👥 **Total Members:** ${interaction.guild.memberCount} members`);
                if (cfg.showDiundangOleh)  infoLines.push(`📨 **Invited By:** ${member.user.tag} (example)`);
                if (cfg.showKodeInvite)    infoLines.push(`🔗 **Invite Code:** \`abc123\` (example)`);
                if (cfg.showTotalUndangan) infoLines.push(`📊 **Total Invites:** 42 invites (example)`);
                if (infoLines.length > 0) content += (content ? '\n' : '') + infoLines.join('\n');
                content = content.trim();

                if (content) {
                    const payload = {
                        content: `> 👁️ **Preview Mode** — not a real welcome message\n${content}`,
                        flags: MessageFlags.Ephemeral
                    };
                    if (cardAttachment) payload.files = [cardAttachment];
                    return interaction.reply(payload);
                } else if (cardAttachment) {
                    return interaction.reply({
                        content: '> 👁️ **Preview Mode** — not a real welcome message *(empty message, welcome card only)*',
                        files: [cardAttachment],
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    return interaction.reply({
                        content: '> 👁️ **Preview Mode** — empty message and welcome card is not active.',
                        flags: MessageFlags.Ephemeral
                    });
                }
            }

            // Embed mode
            const hasText   = cfg.title.trim() || cfg.description.trim();
            const hasFields = cfg.showMemberNew || cfg.showAkunDibuat || cfg.showTotalMember
                           || cfg.showDiundangOleh || cfg.showKodeInvite || cfg.showTotalUndangan;

            if (!hasText && !hasFields) {
                if (cardAttachment) {
                    const cardOnlyEmbed = new EmbedBuilder()
                        .setColor(colorHex)
                        .setAuthor({ name: '👁️ Preview Mode — not a real welcome message' })
                        .setTimestamp()
                        .setImage('attachment://welcome-card.png');
                    return interaction.reply({
                        embeds: [cardOnlyEmbed],
                        files: [cardAttachment],
                        flags: MessageFlags.Ephemeral
                    });
                }
                return interaction.reply({
                    content: '> 👁️ **Preview Mode** — empty message and welcome card is not active.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const embed = new EmbedBuilder()
                .setColor(colorHex)
                .setAuthor({ name: '👁️ Preview Mode — not a real welcome message' })
                .setTimestamp();

            if (parse(cfg.title))       embed.setTitle(parse(cfg.title));
            if (parse(cfg.description)) embed.setDescription(parse(cfg.description));

            if (cfg.footerText) embed.setFooter({ text: parse(cfg.footerText) });
            if (cfg.thumbnail)  embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));

            const fields = [];
            if (cfg.showMemberNew)     fields.push({ name: '👤 New Member',    value: member.user.tag, inline: true });
            if (cfg.showAkunDibuat)    fields.push({ name: '📅 Account Created',    value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true });
            if (cfg.showTotalMember)   fields.push({ name: '👥 Total Members',   value: `**${interaction.guild.memberCount}** members`, inline: true });
            if (cfg.showDiundangOleh)  fields.push({ name: '📨 Invited By',  value: `${member.user.tag} (example)`, inline: true });
            if (cfg.showKodeInvite)    fields.push({ name: '🔗 Invite Code',    value: '`abc123` (example)', inline: true });
            if (cfg.showTotalUndangan) fields.push({ name: '📊 Total Invites', value: '**42** invites (example)', inline: true });
            if (fields.length > 0) embed.addFields(...fields);

            if (cardAttachment) embed.setImage('attachment://welcome-card.png');

            const payload = { embeds: [embed], flags: MessageFlags.Ephemeral };
            if (cardAttachment) payload.files = [cardAttachment];
            return interaction.reply(payload);
        }
    }
}).toJSON();

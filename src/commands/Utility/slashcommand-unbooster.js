const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    AttachmentBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { getLang, getStrings } = require('../../utils/BotLang');
const { resolveChannel } = require('../../utils/resolveGuildOption');
const { checkBotPermissions } = require('../../utils/checkBotPermissions');
const { generateWelcomeCard } = require('../../utils/generateWelcomeCard');

// ── Helpers ────────────────────────────────────────────────────────────────
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
        unboostEnabled:          getBool(client, `booster-unboost-enabled-${guildId}`,         false),
        unboostChannelId:        client.database.get(`booster-unboost-channel-${guildId}`)     ?? null,
        unboostMessageType:      client.database.get(`booster-unboost-messageType-${guildId}`) ?? 'embed',
        unboostPlainText:        client.database.get(`booster-unboost-plainText-${guildId}`)   ?? '',
        unboostTitle:            client.database.get(`booster-unboost-title-${guildId}`)       ?? '💔 Boost Ended',
        unboostDescription:      client.database.get(`booster-unboost-desc-${guildId}`)        ?? '{member} has removed their boost from the server.\nTotal boosts now: **{boosts}**.',
        unboostColor:            client.database.get(`booster-unboost-color-${guildId}`)       ?? '#ED4245',
        unboostFooter:           client.database.get(`booster-unboost-footer-${guildId}`)      ?? '',
        unboostShowMember:       getBool(client, `booster-unboost-showMember-${guildId}`,      true),
        unboostShowTotalBoost:   getBool(client, `booster-unboost-showTotalBoost-${guildId}`,  true),
        unboostShowLevelServer:  getBool(client, `booster-unboost-showLevelServer-${guildId}`, true),
        unboostShowThumbnail:    getBool(client, `booster-unboost-showThumbnail-${guildId}`,   true),
        unboostCardEnabled:      getBool(client, `booster-unboost-cardEnabled-${guildId}`,     false),
        unboostCardWelcomeText:  client.database.get(`booster-unboost-cardWelcomeText-${guildId}`)   ?? 'GOODBYE',
        unboostCardSubText:      client.database.get(`booster-unboost-cardSubText-${guildId}`)       ?? 'Boost berakhir...',
        unboostCardBgColor:      client.database.get(`booster-unboost-cardBgColor-${guildId}`)       ?? '#1e0a0a',
        unboostCardBgColor2:     client.database.get(`booster-unboost-cardBgColor2-${guildId}`)      ?? '#2e0a0a',
        unboostCardAccentColor:  client.database.get(`booster-unboost-cardAccent-${guildId}`)        ?? '#ED4245',
        unboostCardAvatarShape:  client.database.get(`booster-unboost-cardAvatarShape-${guildId}`)   ?? 'circle',
        unboostCardBgType:       client.database.get(`booster-unboost-cardBgType-${guildId}`)        ?? 'gradient',
        unboostCardBgImageUrl:   client.database.get(`booster-unboost-cardBgImageUrl-${guildId}`)    ?? '',
        unboostCardOverlayColor: client.database.get(`booster-unboost-cardOverlayColor-${guildId}`)  ?? '#000000',
        unboostCardOverlayOpacity: parseInt(client.database.get(`booster-unboost-cardOverlayOpacity-${guildId}`) || '0'),
        unboostCardTitleColor:   client.database.get(`booster-unboost-cardTitleColor-${guildId}`)    ?? '#ffffff',
        unboostCardUsernameColor:client.database.get(`booster-unboost-cardUsernameColor-${guildId}`) ?? '#ED4245',
        unboostCardMsgColor:     client.database.get(`booster-unboost-cardMsgColor-${guildId}`)      ?? '#cccccc',
        unboostCardFont:         client.database.get(`booster-unboost-cardFont-${guildId}`)          ?? 'impact',
    };
}

// ── Command ────────────────────────────────────────────────────────────────
module.exports = new ApplicationCommand({
    command: {
        name: 'unbooster',
        description: 'Configure unboost notification when someone stops boosting the server.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            // ── status ────────────────────────────────────────────────────
            {
                name: 'status',
                description: 'View unboost notification configuration.',
                type: 1
            },

            // ── notif ─────────────────────────────────────────────────────
            {
                name: 'notif',
                description: 'Configure unboost notification settings.',
                type: 2,
                options: [
                    {
                        name: 'unboost-toggle',
                        description: 'Enable / disable unboost notification.',
                        type: 1,
                        options: [{ name: 'active', description: 'true = enable', type: 5, required: true }]
                    },
                    {
                        name: 'unboost-channel',
                        description: 'Set the channel for unboost notifications.',
                        type: 1,
                        options: [{
                            name: 'channel', description: 'Select a text channel (mention #channel or ID)', type: 3, autocomplete: true,
required: true
                        }]
                    },
                    {
                        name: 'unboost-title',
                        description: 'Change the embed title for unboost notifications.',
                        type: 1,
                        options: [{ name: 'text', description: 'Embed title (max 256 characters)', type: 3, required: true, max_length: 256 }]
                    },
                    {
                        name: 'unboost-description',
                        description: 'Change the embed description for unboost notifications.',
                        type: 1,
                        options: [{ name: 'text', description: 'Embed description (max 2048 characters)', type: 3, required: true, max_length: 2048 }]
                    },
                    {
                        name: 'unboost-type',
                        description: 'Choose the unboost notification message type: embed or plain text.',
                        type: 1,
                        options: [{ name: 'type', description: 'embed = use embed, plain = plain text', type: 3, required: true, choices: [{ name: '🖼️ Embed', value: 'embed' }, { name: '💬 Plain Text', value: 'plain' }] }]
                    },
                    {
                        name: 'unboost-color',
                        description: 'Change the embed color for unboost notifications (hex).',
                        type: 1,
                        options: [{ name: 'hex', description: 'Example: #ED4245', type: 3, required: true, max_length: 7 }]
                    },
                    {
                        name: 'preview-unboost',
                        description: 'Preview the unboost notification appearance.',
                        type: 1
                    }
                ]
            },

            // ── reset ─────────────────────────────────────────────────────
            {
                name: 'reset',
                description: 'Reset unboost notification configuration to default.',
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
        const strings  = getStrings(getLang(client.database, interaction.guild?.id));
        const s        = strings.booster;
        const c        = strings.common;
        const { guild, options } = interaction;
        const subGroup = options.getSubcommandGroup(false);
        const sub      = options.getSubcommand();
        const guildId  = guild.id;
        const cfg      = getConfig(client, guildId);

        const ok = await checkBotPermissions(interaction, [
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
        ]);
        if (!ok) return;

        // ── /unbooster status ──────────────────────────────────────────────
        if (!subGroup && sub === 'status') {
            const unboostCh = cfg.unboostChannelId ? guild.channels.cache.get(cfg.unboostChannelId) : null;

            const embed = new EmbedBuilder()
                .setTitle(s.unboost_status_title)
                .setColor('#ED4245')
                .addFields(
                    {
                        name: s.field_unboost_notif,
                        value: [
                            `${c.lbl_status} ${cfg.unboostEnabled ? c.enabled : c.disabled}`,
                            `${c.lbl_channel} ${unboostCh ? `<#${unboostCh.id}>` : c.not_set}`,
                            `${c.lbl_type} ${cfg.unboostMessageType === 'plain' ? c.type_plain : c.type_embed}`,
                            cfg.unboostMessageType === 'plain'
                                ? `${c.lbl_message} \`${(cfg.unboostPlainText || '-').slice(0, 60)}${cfg.unboostPlainText?.length > 60 ? '…' : ''}\``
                                : `${c.lbl_title} \`${cfg.unboostTitle}\``,
                            `${c.lbl_color} \`${cfg.unboostColor}\``,
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: s.field_unboost_info,
                        value: [
                            `${s.info_member}: ${cfg.unboostShowMember ? '✅' : '❌'}`,
                            `${s.info_total_boost}: ${cfg.unboostShowTotalBoost ? '✅' : '❌'}`,
                            `${s.info_server_lvl}: ${cfg.unboostShowLevelServer ? '✅' : '❌'}`,
                        ].join('\n'),
                        inline: true
                    }
                )
                .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) ?? undefined })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── /unbooster reset ───────────────────────────────────────────────
        if (!subGroup && sub === 'reset') {
            const keys = [
                'unboost-enabled','unboost-channel','unboost-messageType','unboost-plainText',
                'unboost-title','unboost-desc','unboost-color','unboost-footer',
                'unboost-showMember','unboost-showTotalBoost','unboost-showLevelServer','unboost-showThumbnail',
                'unboost-cardEnabled','unboost-cardWelcomeText','unboost-cardSubText',
                'unboost-cardBgColor','unboost-cardBgColor2','unboost-cardAccent','unboost-cardAvatarShape',
                'unboost-cardBgType','unboost-cardBgImageUrl','unboost-cardOverlayColor','unboost-cardOverlayOpacity',
                'unboost-cardTitleColor','unboost-cardUsernameColor','unboost-cardMsgColor','unboost-cardFont',
            ];
            keys.forEach(k => client.database.delete(`booster-${k}-${guildId}`));
            return interaction.reply({ content: s.unboost_reset_done, flags: MessageFlags.Ephemeral });
        }

        // ── GROUP: notif ───────────────────────────────────────────────────
        if (subGroup === 'notif') {
            const validateHex = (val) => /^#?[0-9A-Fa-f]{6}$/.test(val);
            const toHex = (val) => val.startsWith('#') ? val : `#${val}`;

            if (sub === 'unboost-toggle') {
                const active = options.getBoolean('active');
                if (active && !cfg.unboostChannelId) return interaction.reply({ content: s.unboost_channel_unset, flags: MessageFlags.Ephemeral });
                setBool(client, `booster-unboost-enabled-${guildId}`, active);
                return interaction.reply({ content: active ? s.unboost_toggle_on : s.unboost_toggle_off, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'unboost-channel') {
                const ch = resolveChannel(interaction.guild, options.getString('channel'));
                if (!ch) return interaction.reply({ content: s.channel_not_found, flags: MessageFlags.Ephemeral });
                if (!await checkBotPermissions(interaction, [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], ch)) return;
                client.database.set(`booster-unboost-channel-${guildId}`, ch.id);
                return interaction.reply({ content: s.unboost_channel_set(ch.id), flags: MessageFlags.Ephemeral });
            }

            if (sub === 'unboost-title') {
                client.database.set(`booster-unboost-title-${guildId}`, options.getString('text'));
                return interaction.reply({ content: s.unboost_title_updated, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'unboost-description') {
                client.database.set(`booster-unboost-desc-${guildId}`, options.getString('text'));
                return interaction.reply({ content: s.unboost_desc_updated, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'unboost-type') {
                const val = options.getString('type');
                client.database.set(`booster-unboost-messageType-${guildId}`, val);
                return interaction.reply({
                    content: val === 'plain' ? s.unboost_type_plain : s.unboost_type_embed,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (sub === 'unboost-color') {
                const val = options.getString('hex').trim();
                if (!validateHex(val)) return interaction.reply({ content: s.invalid_hex, flags: MessageFlags.Ephemeral });
                client.database.set(`booster-unboost-color-${guildId}`, toHex(val));
                return interaction.reply({ content: s.unboost_color_updated(toHex(val)), flags: MessageFlags.Ephemeral });
            }

            if (sub === 'preview-unboost') {
                const parsePrev = (str) => str
                    .replace(/{member}/g,   `<@${interaction.member.id}>`)
                    .replace(/{username}/g, interaction.member.user.username)
                    .replace(/{tag}/g,      interaction.member.user.tag)
                    .replace(/{server}/g,   guild.name)
                    .replace(/{boosts}/g,   String(guild.premiumSubscriptionCount ?? 0))
                    .replace(/{level}/g,    String(guild.premiumTier));

                let unboostCard = null;
                if (cfg.unboostCardEnabled) {
                    try {
                        const buf = await generateWelcomeCard({
                            avatarUrl:      interaction.member.user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
                            username:       interaction.member.user.username,
                            serverName:     guild.name,
                            welcomeText:    cfg.unboostCardWelcomeText,
                            subText:        cfg.unboostCardSubText
                                .replace(/{server}/gi, guild.name)
                                .replace(/{boosts}/gi, String(guild.premiumSubscriptionCount ?? 0))
                                .replace(/{level}/gi,  String(guild.premiumTier)),
                            bgColor:        cfg.unboostCardBgColor,
                            bgColor2:       cfg.unboostCardBgColor2,
                            accentColor:    cfg.unboostCardAccentColor,
                            avatarShape:    cfg.unboostCardAvatarShape,
                            bgType:         cfg.unboostCardBgType,
                            bgImageUrl:     cfg.unboostCardBgImageUrl,
                            overlayColor:   cfg.unboostCardOverlayColor,
                            overlayOpacity: cfg.unboostCardOverlayOpacity,
                            titleColor:     cfg.unboostCardTitleColor,
                            usernameColor:  cfg.unboostCardUsernameColor,
                            messageColor:   cfg.unboostCardMsgColor,
                            fontFamily:     cfg.unboostCardFont,
                        });
                        unboostCard = new AttachmentBuilder(buf, { name: 'unboost-card.png' });
                    } catch (err) { console.error('[preview-unboost] Card generation failed:', err.message); }
                }

                if (cfg.unboostMessageType === 'plain') {
                    const text = cfg.unboostPlainText ? parsePrev(cfg.unboostPlainText) : '';
                    const payload = { flags: MessageFlags.Ephemeral };
                    payload.content = text
                        ? `> 👁️ **Unboost Preview (Plain Text)**\n${text}`
                        : `> 👁️ **Unboost Preview (Plain Text)** — empty message, card only`;
                    if (unboostCard) payload.files = [unboostCard];
                    return interaction.reply(payload);
                }

                const embed = new EmbedBuilder().setColor(cfg.unboostColor).setAuthor({ name: '👁️ Preview Mode — Unboost' }).setTimestamp();
                const parsedTitle = parsePrev(cfg.unboostTitle);
                if (parsedTitle) embed.setTitle(parsedTitle);
                const parsedDesc = parsePrev(cfg.unboostDescription);
                if (parsedDesc) embed.setDescription(parsedDesc);
                if (cfg.unboostShowThumbnail) embed.setThumbnail(interaction.member.user.displayAvatarURL({ dynamic: true, size: 256 }));
                const unboostFields = [];
                if (cfg.unboostShowMember)      unboostFields.push({ name: s.info_member,      value: interaction.member.user.tag,                          inline: true });
                if (cfg.unboostShowTotalBoost)  unboostFields.push({ name: s.info_total_boost,value: `**${guild.premiumSubscriptionCount ?? 0}** boost(s)`, inline: true });
                if (cfg.unboostShowLevelServer) unboostFields.push({ name: s.info_server_lvl, value: `Level **${guild.premiumTier}**`,                      inline: true });
                if (unboostFields.length) embed.addFields(...unboostFields);
                if (cfg.unboostFooter) embed.setFooter({ text: parsePrev(cfg.unboostFooter) });
                if (unboostCard) embed.setImage('attachment://unboost-card.png');
                const unboostPayload = { embeds: [embed], flags: MessageFlags.Ephemeral };
                if (unboostCard) unboostPayload.files = [unboostCard];
                return interaction.reply(unboostPayload);
            }
        }
    }
}).toJSON();

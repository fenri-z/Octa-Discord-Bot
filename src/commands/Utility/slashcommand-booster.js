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
        boostEnabled:            getBool(client, `booster-boost-enabled-${guildId}`,          false),
        boostChannelId:          client.database.get(`booster-boost-channel-${guildId}`)      ?? null,
        boostMessageType:        client.database.get(`booster-boost-messageType-${guildId}`)  ?? 'embed',
        boostPlainText:          client.database.get(`booster-boost-plainText-${guildId}`)    ?? '',
        boostTitle:              client.database.get(`booster-boost-title-${guildId}`)        ?? '🚀 New Server Boost!',
        boostDescription:        client.database.get(`booster-boost-desc-${guildId}`)         ?? 'Thank you {member} for boosting this server! 💖\nTotal boosts now: **{boosts}**.',
        boostColor:              client.database.get(`booster-boost-color-${guildId}`)        ?? '#FF73FA',
        boostFooter:             client.database.get(`booster-boost-footer-${guildId}`)       ?? '',
        boostShowMember:         getBool(client, `booster-boost-showMember-${guildId}`,       true),
        boostShowMulaiBoost:     getBool(client, `booster-boost-showMulaiBoost-${guildId}`,   true),
        boostShowTotalBoost:     getBool(client, `booster-boost-showTotalBoost-${guildId}`,   true),
        boostShowLevelServer:    getBool(client, `booster-boost-showLevelServer-${guildId}`,  true),
        boostShowThumbnail:      getBool(client, `booster-boost-showThumbnail-${guildId}`,    true),
        boostCardEnabled:        getBool(client, `booster-boost-cardEnabled-${guildId}`,      false),
        boostCardWelcomeText:    client.database.get(`booster-boost-cardWelcomeText-${guildId}`)    ?? 'BOOST!',
        boostCardSubText:        client.database.get(`booster-boost-cardSubText-${guildId}`)        ?? 'Thank you for boosting!',
        boostCardBgColor:        client.database.get(`booster-boost-cardBgColor-${guildId}`)        ?? '#0a0a1e',
        boostCardBgColor2:       client.database.get(`booster-boost-cardBgColor2-${guildId}`)       ?? '#1e0a2e',
        boostCardAccentColor:    client.database.get(`booster-boost-cardAccent-${guildId}`)         ?? '#FF73FA',
        boostCardAvatarShape:    client.database.get(`booster-boost-cardAvatarShape-${guildId}`)    ?? 'circle',
        boostCardBgType:         client.database.get(`booster-boost-cardBgType-${guildId}`)         ?? 'gradient',
        boostCardBgImageUrl:     client.database.get(`booster-boost-cardBgImageUrl-${guildId}`)     ?? '',
        boostCardOverlayColor:   client.database.get(`booster-boost-cardOverlayColor-${guildId}`)   ?? '#000000',
        boostCardOverlayOpacity: parseInt(client.database.get(`booster-boost-cardOverlayOpacity-${guildId}`) || '0'),
        boostCardTitleColor:     client.database.get(`booster-boost-cardTitleColor-${guildId}`)     ?? '#ffffff',
        boostCardUsernameColor:  client.database.get(`booster-boost-cardUsernameColor-${guildId}`)  ?? '#FF73FA',
        boostCardMsgColor:       client.database.get(`booster-boost-cardMsgColor-${guildId}`)       ?? '#cccccc',
        boostCardFont:           client.database.get(`booster-boost-cardFont-${guildId}`)           ?? 'impact',
    };
}

// ── Command ────────────────────────────────────────────────────────────────
module.exports = new ApplicationCommand({
    command: {
        name: 'booster',
        description: 'Configure boost notification when someone boosts the server.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            // ── status ────────────────────────────────────────────────────
            {
                name: 'status',
                description: 'View boost notification configuration.',
                type: 1
            },

            // ── list ──────────────────────────────────────────────────────
            {
                name: 'list',
                description: 'Show a list of all members currently boosting the server.',
                type: 1
            },

            // ── notif ─────────────────────────────────────────────────────
            {
                name: 'notif',
                description: 'Configure boost notification settings.',
                type: 2,
                options: [
                    {
                        name: 'boost-toggle',
                        description: 'Enable / disable boost notification.',
                        type: 1,
                        options: [{ name: 'active', description: 'true = enable', type: 5, required: true }]
                    },
                    {
                        name: 'boost-channel',
                        description: 'Set the channel for boost notifications.',
                        type: 1,
                        options: [{
                            name: 'channel', description: 'Select a text channel (mention #channel or ID)', type: 3, autocomplete: true,
required: true
                        }]
                    },
                    {
                        name: 'boost-title',
                        description: 'Change the embed title for boost notifications. Placeholders: {member} {server} {boosts} {tag}',
                        type: 1,
                        options: [{ name: 'text', description: 'Embed title (max 256 characters)', type: 3, required: true, max_length: 256 }]
                    },
                    {
                        name: 'boost-description',
                        description: 'Change the embed description for boost notifications.',
                        type: 1,
                        options: [{ name: 'text', description: 'Embed description (max 2048 characters)', type: 3, required: true, max_length: 2048 }]
                    },
                    {
                        name: 'boost-type',
                        description: 'Choose the boost notification message type: embed or plain text.',
                        type: 1,
                        options: [{ name: 'type', description: 'embed = use embed, plain = plain text', type: 3, required: true, choices: [{ name: '🖼️ Embed', value: 'embed' }, { name: '💬 Plain Text', value: 'plain' }] }]
                    },
                    {
                        name: 'boost-color',
                        description: 'Change the embed color for boost notifications (hex).',
                        type: 1,
                        options: [{ name: 'hex', description: 'Example: #FF73FA', type: 3, required: true, max_length: 7 }]
                    },
                    {
                        name: 'preview-boost',
                        description: 'Preview the boost notification appearance.',
                        type: 1
                    }
                ]
            },

            // ── reset ─────────────────────────────────────────────────────
            {
                name: 'reset',
                description: 'Reset boost notification configuration to default.',
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

        // ── /booster status ────────────────────────────────────────────────
        if (!subGroup && sub === 'status') {
            const boostCh = cfg.boostChannelId ? guild.channels.cache.get(cfg.boostChannelId) : null;

            const embed = new EmbedBuilder()
                .setTitle(s.status_title)
                .setColor('#FF73FA')
                .addFields(
                    {
                        name: s.field_boost_notif,
                        value: [
                            `${c.lbl_status} ${cfg.boostEnabled ? c.enabled : c.disabled}`,
                            `${c.lbl_channel} ${boostCh ? `<#${boostCh.id}>` : c.not_set}`,
                            `${c.lbl_type} ${cfg.boostMessageType === 'plain' ? c.type_plain : c.type_embed}`,
                            cfg.boostMessageType === 'plain'
                                ? `${c.lbl_message} \`${(cfg.boostPlainText || '-').slice(0, 60)}${cfg.boostPlainText?.length > 60 ? '…' : ''}\``
                                : `${c.lbl_title} \`${cfg.boostTitle}\``,
                            `${c.lbl_color} \`${cfg.boostColor}\``,
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: s.field_boost_info,
                        value: [
                            `${s.info_member}: ${cfg.boostShowMember ? '✅' : '❌'}`,
                            `${s.info_boost_start}: ${cfg.boostShowMulaiBoost ? '✅' : '❌'}`,
                            `${s.info_total_boost}: ${cfg.boostShowTotalBoost ? '✅' : '❌'}`,
                            `${s.info_server_lvl}: ${cfg.boostShowLevelServer ? '✅' : '❌'}`,
                        ].join('\n'),
                        inline: true
                    }
                )
                .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) ?? undefined })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── /booster list ──────────────────────────────────────────────────
        if (!subGroup && sub === 'list') {
            await guild.members.fetch();
            const boosters = guild.members.cache.filter(m => m.premiumSince !== null);

            if (boosters.size === 0) {
                return interaction.reply({
                    embeds: [new EmbedBuilder().setColor('#ED4245').setDescription(s.no_boosters)],
                    flags: MessageFlags.Ephemeral
                });
            }

            const sorted = [...boosters.values()].sort((a, b) => a.premiumSince - b.premiumSince);
            const lines  = sorted.map((m, i) =>
                `\`${String(i + 1).padStart(2, '0')}.\` ${m} — <t:${Math.floor(m.premiumSinceTimestamp / 1000)}:R>`
            );

            const embed = new EmbedBuilder()
                .setTitle(s.list_title(guild.name))
                .setColor('#FF73FA')
                .setDescription(lines.slice(0, 20).join('\n'))
                .addFields({ name: '​', value: s.total_boosters(boosters.size, guild.premiumTier), inline: false })
                .setThumbnail(guild.iconURL({ dynamic: true }))
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

        // ── /booster reset ─────────────────────────────────────────────────
        if (!subGroup && sub === 'reset') {
            const keys = [
                'boost-enabled','boost-channel','boost-messageType','boost-plainText',
                'boost-title','boost-desc','boost-color','boost-footer',
                'boost-showMember','boost-showMulaiBoost','boost-showTotalBoost','boost-showLevelServer','boost-showThumbnail',
                'boost-cardEnabled','boost-cardWelcomeText','boost-cardSubText',
                'boost-cardBgColor','boost-cardBgColor2','boost-cardAccent','boost-cardAvatarShape',
                'boost-cardBgType','boost-cardBgImageUrl','boost-cardOverlayColor','boost-cardOverlayOpacity',
                'boost-cardTitleColor','boost-cardUsernameColor','boost-cardMsgColor','boost-cardFont',
            ];
            keys.forEach(k => client.database.delete(`booster-${k}-${guildId}`));
            return interaction.reply({ content: s.reset_done, flags: MessageFlags.Ephemeral });
        }

        // ── GROUP: notif ───────────────────────────────────────────────────
        if (subGroup === 'notif') {
            const validateHex = (val) => /^#?[0-9A-Fa-f]{6}$/.test(val);
            const toHex = (val) => val.startsWith('#') ? val : `#${val}`;

            if (sub === 'boost-toggle') {
                const active = options.getBoolean('active');
                if (active && !cfg.boostChannelId) return interaction.reply({ content: s.boost_channel_unset, flags: MessageFlags.Ephemeral });
                setBool(client, `booster-boost-enabled-${guildId}`, active);
                return interaction.reply({ content: active ? s.boost_toggle_on : s.boost_toggle_off, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'boost-channel') {
                const ch = resolveChannel(interaction.guild, options.getString('channel'));
                if (!ch) return interaction.reply({ content: s.channel_not_found, flags: MessageFlags.Ephemeral });
                if (!await checkBotPermissions(interaction, [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], ch)) return;
                client.database.set(`booster-boost-channel-${guildId}`, ch.id);
                return interaction.reply({ content: s.boost_channel_set(ch.id), flags: MessageFlags.Ephemeral });
            }

            if (sub === 'boost-title') {
                client.database.set(`booster-boost-title-${guildId}`, options.getString('text'));
                return interaction.reply({ content: s.boost_title_updated, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'boost-description') {
                client.database.set(`booster-boost-desc-${guildId}`, options.getString('text'));
                return interaction.reply({ content: s.boost_desc_updated, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'boost-type') {
                const val = options.getString('type');
                client.database.set(`booster-boost-messageType-${guildId}`, val);
                return interaction.reply({
                    content: val === 'plain' ? s.boost_type_plain : s.boost_type_embed,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (sub === 'boost-color') {
                const val = options.getString('hex').trim();
                if (!validateHex(val)) return interaction.reply({ content: s.invalid_hex, flags: MessageFlags.Ephemeral });
                client.database.set(`booster-boost-color-${guildId}`, toHex(val));
                return interaction.reply({ content: s.boost_color_updated(toHex(val)), flags: MessageFlags.Ephemeral });
            }

            if (sub === 'preview-boost') {
                const parsePrev = (str) => str
                    .replace(/{member}/g,   `<@${interaction.member.id}>`)
                    .replace(/{username}/g, interaction.member.user.username)
                    .replace(/{tag}/g,      interaction.member.user.tag)
                    .replace(/{server}/g,   guild.name)
                    .replace(/{boosts}/g,   String(guild.premiumSubscriptionCount ?? 0))
                    .replace(/{level}/g,    String(guild.premiumTier));

                let boostCard = null;
                if (cfg.boostCardEnabled) {
                    try {
                        const buf = await generateWelcomeCard({
                            avatarUrl:      interaction.member.user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
                            username:       interaction.member.user.username,
                            serverName:     guild.name,
                            welcomeText:    cfg.boostCardWelcomeText,
                            subText:        cfg.boostCardSubText
                                .replace(/{server}/gi, guild.name)
                                .replace(/{boosts}/gi, String(guild.premiumSubscriptionCount ?? 0))
                                .replace(/{level}/gi,  String(guild.premiumTier)),
                            bgColor:        cfg.boostCardBgColor,
                            bgColor2:       cfg.boostCardBgColor2,
                            accentColor:    cfg.boostCardAccentColor,
                            avatarShape:    cfg.boostCardAvatarShape,
                            bgType:         cfg.boostCardBgType,
                            bgImageUrl:     cfg.boostCardBgImageUrl,
                            overlayColor:   cfg.boostCardOverlayColor,
                            overlayOpacity: cfg.boostCardOverlayOpacity,
                            titleColor:     cfg.boostCardTitleColor,
                            usernameColor:  cfg.boostCardUsernameColor,
                            messageColor:   cfg.boostCardMsgColor,
                            fontFamily:     cfg.boostCardFont,
                        });
                        boostCard = new AttachmentBuilder(buf, { name: 'boost-card.png' });
                    } catch (err) { console.error('[preview-boost] Card generation failed:', err.message); }
                }

                if (cfg.boostMessageType === 'plain') {
                    const text = cfg.boostPlainText ? parsePrev(cfg.boostPlainText) : '';
                    const payload = { flags: MessageFlags.Ephemeral };
                    payload.content = text
                        ? `> 👁️ **Boost Preview (Plain Text)**\n${text}`
                        : `> 👁️ **Boost Preview (Plain Text)** — empty message, card only`;
                    if (boostCard) payload.files = [boostCard];
                    return interaction.reply(payload);
                }

                const embed = new EmbedBuilder().setColor(cfg.boostColor).setAuthor({ name: '👁️ Preview Mode — Boost' }).setTimestamp();
                const parsedTitle = parsePrev(cfg.boostTitle);
                if (parsedTitle) embed.setTitle(parsedTitle);
                const parsedDesc = parsePrev(cfg.boostDescription);
                if (parsedDesc) embed.setDescription(parsedDesc);
                if (cfg.boostShowThumbnail) embed.setThumbnail(interaction.member.user.displayAvatarURL({ dynamic: true, size: 256 }));
                const boostFields = [];
                if (cfg.boostShowMember)      boostFields.push({ name: s.info_member,      value: interaction.member.user.tag,                         inline: true });
                if (cfg.boostShowMulaiBoost)  boostFields.push({ name: s.info_boost_start,value: `<t:${Math.floor(Date.now() / 1000)}:R>`,            inline: true });
                if (cfg.boostShowTotalBoost)  boostFields.push({ name: s.info_total_boost,value: `**${guild.premiumSubscriptionCount ?? 0}** boost(s)`,inline: true });
                if (cfg.boostShowLevelServer) boostFields.push({ name: s.info_server_lvl, value: `Level **${guild.premiumTier}**`,                    inline: true });
                if (boostFields.length) embed.addFields(...boostFields);
                if (cfg.boostFooter) embed.setFooter({ text: parsePrev(cfg.boostFooter) });
                if (boostCard) embed.setImage('attachment://boost-card.png');
                const boostPayload = { embeds: [embed], flags: MessageFlags.Ephemeral };
                if (boostCard) boostPayload.files = [boostCard];
                return interaction.reply(boostPayload);
            }
        }
    }
}).toJSON();

const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    AttachmentBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { getLang, getStrings } = require('../../utils/BotLang');
const { resolveChannel, resolveRole } = require('../../utils/resolveGuildOption');
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
        // notif boost
        boostEnabled:           getBool(client, `booster-boost-enabled-${guildId}`,          false),
        boostChannelId:         client.database.get(`booster-boost-channel-${guildId}`)      ?? null,
        boostMessageType:       client.database.get(`booster-boost-messageType-${guildId}`)  ?? 'embed',
        boostPlainText:         client.database.get(`booster-boost-plainText-${guildId}`)    ?? '',
        boostTitle:             client.database.get(`booster-boost-title-${guildId}`)        ?? '🚀 New Server Boost!',
        boostDescription:       client.database.get(`booster-boost-desc-${guildId}`)        ?? 'Thank you {member} for boosting this server! 💖\nTotal boosts now: **{boosts}**.',
        boostColor:             client.database.get(`booster-boost-color-${guildId}`)        ?? '#FF73FA',
        boostFooter:            client.database.get(`booster-boost-footer-${guildId}`)       ?? '',
        boostShowMember:        getBool(client, `booster-boost-showMember-${guildId}`,       true),
        boostShowMulaiBoost:    getBool(client, `booster-boost-showMulaiBoost-${guildId}`,   true),
        boostShowTotalBoost:    getBool(client, `booster-boost-showTotalBoost-${guildId}`,   true),
        boostShowLevelServer:   getBool(client, `booster-boost-showLevelServer-${guildId}`,  true),
        boostShowThumbnail:     getBool(client, `booster-boost-showThumbnail-${guildId}`,    true),
        // notif unboost
        unboostEnabled:         getBool(client, `booster-unboost-enabled-${guildId}`,        false),
        unboostChannelId:       client.database.get(`booster-unboost-channel-${guildId}`)    ?? null,
        unboostMessageType:     client.database.get(`booster-unboost-messageType-${guildId}`) ?? 'embed',
        unboostPlainText:       client.database.get(`booster-unboost-plainText-${guildId}`)  ?? '',
        unboostTitle:           client.database.get(`booster-unboost-title-${guildId}`)      ?? '💔 Boost Ended',
        unboostDescription:     client.database.get(`booster-unboost-desc-${guildId}`)      ?? '{member} has removed their boost from the server.\nTotal boosts now: **{boosts}**.',
        unboostColor:           client.database.get(`booster-unboost-color-${guildId}`)      ?? '#ED4245',
        unboostFooter:          client.database.get(`booster-unboost-footer-${guildId}`)     ?? '',
        unboostShowMember:      getBool(client, `booster-unboost-showMember-${guildId}`,     true),
        unboostShowTotalBoost:  getBool(client, `booster-unboost-showTotalBoost-${guildId}`, true),
        unboostShowLevelServer: getBool(client, `booster-unboost-showLevelServer-${guildId}`,true),
        unboostShowThumbnail:   getBool(client, `booster-unboost-showThumbnail-${guildId}`,  true),
        // card boost
        boostCardEnabled:       getBool(client, `booster-boost-cardEnabled-${guildId}`,      false),
        boostCardWelcomeText:   client.database.get(`booster-boost-cardWelcomeText-${guildId}`)   ?? 'BOOST!',
        boostCardSubText:       client.database.get(`booster-boost-cardSubText-${guildId}`)       ?? 'Thank you for boosting!',
        boostCardBgColor:       client.database.get(`booster-boost-cardBgColor-${guildId}`)       ?? '#0a0a1e',
        boostCardBgColor2:      client.database.get(`booster-boost-cardBgColor2-${guildId}`)      ?? '#1e0a2e',
        boostCardAccentColor:   client.database.get(`booster-boost-cardAccent-${guildId}`)        ?? '#FF73FA',
        boostCardAvatarShape:   client.database.get(`booster-boost-cardAvatarShape-${guildId}`)   ?? 'circle',
        boostCardBgType:        client.database.get(`booster-boost-cardBgType-${guildId}`)        ?? 'gradient',
        boostCardBgImageUrl:    client.database.get(`booster-boost-cardBgImageUrl-${guildId}`)    ?? '',
        boostCardOverlayColor:  client.database.get(`booster-boost-cardOverlayColor-${guildId}`)  ?? '#000000',
        boostCardOverlayOpacity:parseInt(client.database.get(`booster-boost-cardOverlayOpacity-${guildId}`) || '0'),
        boostCardTitleColor:    client.database.get(`booster-boost-cardTitleColor-${guildId}`)    ?? '#ffffff',
        boostCardUsernameColor: client.database.get(`booster-boost-cardUsernameColor-${guildId}`) ?? '#FF73FA',
        boostCardMsgColor:      client.database.get(`booster-boost-cardMsgColor-${guildId}`)      ?? '#cccccc',
        boostCardFont:          client.database.get(`booster-boost-cardFont-${guildId}`)          ?? 'impact',
        // card unboost
        unboostCardEnabled:      getBool(client, `booster-unboost-cardEnabled-${guildId}`,    false),
        unboostCardWelcomeText:  client.database.get(`booster-unboost-cardWelcomeText-${guildId}`)   ?? 'GOODBYE',
        unboostCardSubText:      client.database.get(`booster-unboost-cardSubText-${guildId}`)       ?? 'Boost berakhir...',
        unboostCardBgColor:      client.database.get(`booster-unboost-cardBgColor-${guildId}`)       ?? '#1e0a0a',
        unboostCardBgColor2:     client.database.get(`booster-unboost-cardBgColor2-${guildId}`)      ?? '#2e0a0a',
        unboostCardAccentColor:  client.database.get(`booster-unboost-cardAccent-${guildId}`)        ?? '#ED4245',
        unboostCardAvatarShape:  client.database.get(`booster-unboost-cardAvatarShape-${guildId}`)   ?? 'circle',
        unboostCardBgType:       client.database.get(`booster-unboost-cardBgType-${guildId}`)        ?? 'gradient',
        unboostCardBgImageUrl:   client.database.get(`booster-unboost-cardBgImageUrl-${guildId}`)    ?? '',
        unboostCardOverlayColor: client.database.get(`booster-unboost-cardOverlayColor-${guildId}`)  ?? '#000000',
        unboostCardOverlayOpacity:parseInt(client.database.get(`booster-unboost-cardOverlayOpacity-${guildId}`) || '0'),
        unboostCardTitleColor:   client.database.get(`booster-unboost-cardTitleColor-${guildId}`)    ?? '#ffffff',
        unboostCardUsernameColor:client.database.get(`booster-unboost-cardUsernameColor-${guildId}`) ?? '#ED4245',
        unboostCardMsgColor:     client.database.get(`booster-unboost-cardMsgColor-${guildId}`)      ?? '#cccccc',
        unboostCardFont:         client.database.get(`booster-unboost-cardFont-${guildId}`)          ?? 'impact',
        // autorole booster
        autoroleEnabled:    getBool(client, `booster-autorole-enabled-${guildId}`,       false),
        autoroleRoleId:     client.database.get(`booster-autorole-role-${guildId}`)      ?? null,
        // autorole remove saat unboost
        autoremoveEnabled:  getBool(client, `booster-autoremove-enabled-${guildId}`,     false),
    };
}

// ── Command ────────────────────────────────────────────────────────────────
module.exports = new ApplicationCommand({
    command: {
        name: 'booster',
        description: 'Configure server booster detection & notifications.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [

            // ── status ────────────────────────────────────────────────────
            {
                name: 'status',
                description: 'View all current booster configurations.',
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
                description: 'Configure notifications when someone boosts or unboosts.',
                type: 2, // SUB_COMMAND_GROUP
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
                        name: 'boost-color',
                        description: 'Change the embed color for boost notifications (hex).',
                        type: 1,
                        options: [{ name: 'hex', description: 'Example: #FF73FA', type: 3, required: true, max_length: 7 }]
                    },
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
                        name: 'unboost-color',
                        description: 'Change the embed color for unboost notifications (hex).',
                        type: 1,
                        options: [{ name: 'hex', description: 'Example: #ED4245', type: 3, required: true, max_length: 7 }]
                    },
                    {
                        name: 'preview-boost',
                        description: 'Preview the boost notification appearance.',
                        type: 1
                    },
                    {
                        name: 'preview-unboost',
                        description: 'Preview the unboost notification appearance.',
                        type: 1
                    }
                ]
            },

            // ── autorole ──────────────────────────────────────────────────
            {
                name: 'autorole',
                description: 'Configure automatic role for boosters.',
                type: 2,
                options: [
                    {
                        name: 'set',
                        description: 'Set the role assigned when someone boosts the server.',
                        type: 1,
                        options: [{
                            name: 'role', description: 'Booster role (mention @role or ID)', type: 3, autocomplete: true,
required: true
                        }]
                    },
                    {
                        name: 'toggle',
                        description: 'Enable / disable booster autorole.',
                        type: 1,
                        options: [{ name: 'active', description: 'true = enable', type: 5, required: true }]
                    },
                    {
                        name: 'autoremove',
                        description: 'Automatically remove the booster role when someone unboosts.',
                        type: 1,
                        options: [{ name: 'active', description: 'true = enable auto-removal', type: 5, required: true }]
                    },
                    {
                        name: 'remove',
                        description: 'Remove the booster autorole configuration.',
                        type: 1
                    }
                ]
            },

            // ── reset ─────────────────────────────────────────────────────
            {
                name: 'reset',
                description: 'Reset all booster configurations to default.',
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
        const s        = getStrings(getLang(client.database, interaction.guild?.id)).booster;
        const { guild, options } = interaction;
        const subGroup = options.getSubcommandGroup(false);
        const sub      = options.getSubcommand();
        const guildId  = guild.id;
        const cfg      = getConfig(client, guildId);

        // ── Cek permission bot ────────────────────────────────────────
        const ok = await checkBotPermissions(interaction, [
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ManageRoles,
        ]);
        if (!ok) return;

        // ── /booster status ────────────────────────────────────────────────
        if (!subGroup && sub === 'status') {
            const boostCh   = cfg.boostChannelId   ? guild.channels.cache.get(cfg.boostChannelId)   : null;
            const unboostCh = cfg.unboostChannelId ? guild.channels.cache.get(cfg.unboostChannelId) : null;
            const arRole    = cfg.autoroleRoleId   ? guild.roles.cache.get(cfg.autoroleRoleId)      : null;

            const embed = new EmbedBuilder()
                .setTitle(s.status_title)
                .setColor('#FF73FA')
                .addFields(
                    {
                        name: '🚀 Boost Notification',
                        value: [
                            `**Status:** ${cfg.boostEnabled ? '✅ Enabled' : '❌ Disabled'}`,
                            `**Channel:** ${boostCh ? `<#${boostCh.id}>` : '`Not set`'}`,
                            `**Type:** ${cfg.boostMessageType === 'plain' ? '📝 Plain Text' : '🖼️ Embed'}`,
                            cfg.boostMessageType === 'plain'
                                ? `**Message:** \`${(cfg.boostPlainText || '-').slice(0, 60)}${cfg.boostPlainText?.length > 60 ? '…' : ''}\``
                                : `**Title:** \`${cfg.boostTitle}\``,
                            `**Color:** \`${cfg.boostColor}\``,
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '🚀 Boost Info Fields',
                        value: [
                            `👤 Member: ${cfg.boostShowMember ? '✅' : '❌'}`,
                            `🚀 Boost Start: ${cfg.boostShowMulaiBoost ? '✅' : '❌'}`,
                            `✨ Total Boosts: ${cfg.boostShowTotalBoost ? '✅' : '❌'}`,
                            `🏅 Server Level: ${cfg.boostShowLevelServer ? '✅' : '❌'}`,
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '💔 Unboost Notification',
                        value: [
                            `**Status:** ${cfg.unboostEnabled ? '✅ Enabled' : '❌ Disabled'}`,
                            `**Channel:** ${unboostCh ? `<#${unboostCh.id}>` : '`Not set`'}`,
                            `**Type:** ${cfg.unboostMessageType === 'plain' ? '📝 Plain Text' : '🖼️ Embed'}`,
                            cfg.unboostMessageType === 'plain'
                                ? `**Message:** \`${(cfg.unboostPlainText || '-').slice(0, 60)}${cfg.unboostPlainText?.length > 60 ? '…' : ''}\``
                                : `**Title:** \`${cfg.unboostTitle}\``,
                            `**Color:** \`${cfg.unboostColor}\``,
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '💔 Unboost Info Fields',
                        value: [
                            `👤 Member: ${cfg.unboostShowMember ? '✅' : '❌'}`,
                            `✨ Total Boosts: ${cfg.unboostShowTotalBoost ? '✅' : '❌'}`,
                            `🏅 Server Level: ${cfg.unboostShowLevelServer ? '✅' : '❌'}`,
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '🎖️ Booster Autorole',
                        value: [
                            `**Status:** ${cfg.autoroleEnabled ? '✅ Enabled' : '❌ Disabled'}`,
                            `**Role:** ${arRole ? `${arRole}` : '`Not set`'}`,
                            `**Remove on unboost:** ${cfg.autoremoveEnabled ? '✅ Yes' : '❌ No'}`
                        ].join('\n'),
                        inline: false
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
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#ED4245')
                            .setDescription(s.no_boosters)
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            // Sort from longest boosting
            const sorted = [...boosters.values()].sort(
                (a, b) => a.premiumSince - b.premiumSince
            );

            const lines = sorted.map((m, i) =>
                `\`${String(i + 1).padStart(2, '0')}.\` ${m} — <t:${Math.floor(m.premiumSinceTimestamp / 1000)}:R>`
            );

            // Split into chunks of 20 per page to avoid exceeding 4096 characters
            const chunks = [];
            while (lines.length) chunks.push(lines.splice(0, 20));

            const embed = new EmbedBuilder()
                .setTitle(s.list_title(guild.name))
                .setColor('#FF73FA')
                .setDescription(chunks[0].join('\n'))
                .addFields({ name: '\u200b', value: `Total: **${boosters.size}** booster(s) · Level ${guild.premiumTier}`, inline: false })
                .setThumbnail(guild.iconURL({ dynamic: true }))
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: false });
        }

        // ── /booster reset ─────────────────────────────────────────────────
        if (!subGroup && sub === 'reset') {
            const keys = [
                'boost-enabled','boost-channel','boost-messageType','boost-plainText','boost-title','boost-desc','boost-color',
                'boost-showMember','boost-showMulaiBoost','boost-showTotalBoost','boost-showLevelServer',
                'unboost-enabled','unboost-channel','unboost-messageType','unboost-plainText','unboost-title','unboost-desc','unboost-color',
                'unboost-showMember','unboost-showTotalBoost','unboost-showLevelServer',
                'autorole-enabled','autorole-role','autoremove-enabled'
            ];
            keys.forEach(k => client.database.delete(`booster-${k}-${guildId}`));
            return interaction.reply({
                content: s.reset_done,
                flags: MessageFlags.Ephemeral
            });
        }

        // ═══════════════════════════════════════════════════════════════════
        // ── GRUP: notif ────────────────────────────────────────────────────
        // ═══════════════════════════════════════════════════════════════════
        if (subGroup === 'notif') {

            // Helper validasi hex
            const validateHex = (val) => /^#?[0-9A-Fa-f]{6}$/.test(val);
            const toHex = (val) => val.startsWith('#') ? val : `#${val}`;

            if (sub === 'boost-toggle') {
                const active = options.getBoolean('active');
                if (active && !cfg.boostChannelId) return interaction.reply({ content: s.boost_channel_unset, flags: MessageFlags.Ephemeral });
                setBool(client, `booster-boost-enabled-${guildId}`, active);
                return interaction.reply({ content: active ? s.boost_toggle_on : s.boost_toggle_off, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'boost-channel') {
                const chStr = options.getString('channel');
                const ch    = resolveChannel(interaction.guild, chStr);
                if (!ch) return interaction.reply({ content: s.channel_not_found, flags: MessageFlags.Ephemeral });
                const chPermsOkBoost = await checkBotPermissions(interaction, [
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.EmbedLinks,
                ], ch);
                if (!chPermsOkBoost) return;
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

            if (sub === 'boost-color') {
                const val = options.getString('hex').trim();
                if (!validateHex(val)) return interaction.reply({ content: s.invalid_hex, flags: MessageFlags.Ephemeral });
                client.database.set(`booster-boost-color-${guildId}`, toHex(val));
                return interaction.reply({ content: s.boost_color_updated(toHex(val)), flags: MessageFlags.Ephemeral });
            }

            if (sub === 'unboost-toggle') {
                const active = options.getBoolean('active');
                if (active && !cfg.unboostChannelId) return interaction.reply({ content: s.unboost_channel_unset, flags: MessageFlags.Ephemeral });
                setBool(client, `booster-unboost-enabled-${guildId}`, active);
                return interaction.reply({ content: active ? s.unboost_toggle_on : s.unboost_toggle_off, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'unboost-channel') {
                const chStr = options.getString('channel');
                const ch    = resolveChannel(interaction.guild, chStr);
                if (!ch) return interaction.reply({ content: s.channel_not_found, flags: MessageFlags.Ephemeral });
                const chPermsOkUnboost = await checkBotPermissions(interaction, [
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.EmbedLinks,
                ], ch);
                if (!chPermsOkUnboost) return;
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

            if (sub === 'unboost-color') {
                const val = options.getString('hex').trim();
                if (!validateHex(val)) return interaction.reply({ content: s.invalid_hex, flags: MessageFlags.Ephemeral });
                client.database.set(`booster-unboost-color-${guildId}`, toHex(val));
                return interaction.reply({ content: s.unboost_color_updated(toHex(val)), flags: MessageFlags.Ephemeral });
            }

            // ── Preview helper ─────────────────────────────────────────────
            const parsePrev = (str) => str
                .replace(/{member}/g,   `<@${interaction.member.id}>`)
                .replace(/{username}/g, interaction.member.user.username)
                .replace(/{tag}/g,      interaction.member.user.tag)
                .replace(/{server}/g,   guild.name)
                .replace(/{boosts}/g,   String(guild.premiumSubscriptionCount ?? 0))
                .replace(/{level}/g,    String(guild.premiumTier));

            if (sub === 'preview-boost') {
                // Generate card terlebih dahulu (sebelum cek tipe pesan)
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

                const embed = new EmbedBuilder()
                    .setColor(cfg.boostColor)
                    .setAuthor({ name: '👁️ Preview Mode — Boost' })
                    .setTimestamp();
                const parsedBoostTitle = parsePrev(cfg.boostTitle);
                if (parsedBoostTitle) embed.setTitle(parsedBoostTitle);
                const parsedBoostDesc = parsePrev(cfg.boostDescription);
                if (parsedBoostDesc) embed.setDescription(parsedBoostDesc);
                if (cfg.boostShowThumbnail) embed.setThumbnail(interaction.member.user.displayAvatarURL({ dynamic: true, size: 256 }));
                const boostFields = [];
                if (cfg.boostShowMember)      boostFields.push({ name: '👤 Member',        value: interaction.member.user.tag,                        inline: true });
                if (cfg.boostShowMulaiBoost)  boostFields.push({ name: '🚀 Boost Start',   value: `<t:${Math.floor(Date.now() / 1000)}:R>`,           inline: true });
                if (cfg.boostShowTotalBoost)  boostFields.push({ name: '✨ Total Boosts',  value: `**${guild.premiumSubscriptionCount ?? 0}** boost(s)`, inline: true });
                if (cfg.boostShowLevelServer) boostFields.push({ name: '🏅 Server Level',  value: `Level **${guild.premiumTier}**`,                   inline: true });
                if (boostFields.length) embed.addFields(...boostFields);
                if (cfg.boostFooter) embed.setFooter({ text: parsePrev(cfg.boostFooter) });
                if (boostCard) embed.setImage('attachment://boost-card.png');
                const boostPayload = { embeds: [embed], flags: MessageFlags.Ephemeral };
                if (boostCard) boostPayload.files = [boostCard];
                return interaction.reply(boostPayload);
            }

            if (sub === 'preview-unboost') {
                // Generate card terlebih dahulu (sebelum cek tipe pesan)
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

                const embed = new EmbedBuilder()
                    .setColor(cfg.unboostColor)
                    .setAuthor({ name: '👁️ Preview Mode — Unboost' })
                    .setTimestamp();
                const parsedUnboostTitle = parsePrev(cfg.unboostTitle);
                if (parsedUnboostTitle) embed.setTitle(parsedUnboostTitle);
                const parsedUnboostDesc = parsePrev(cfg.unboostDescription);
                if (parsedUnboostDesc) embed.setDescription(parsedUnboostDesc);
                if (cfg.unboostShowThumbnail) embed.setThumbnail(interaction.member.user.displayAvatarURL({ dynamic: true, size: 256 }));
                const unboostFields = [];
                if (cfg.unboostShowMember)      unboostFields.push({ name: '👤 Member',        value: interaction.member.user.tag,                         inline: true });
                if (cfg.unboostShowTotalBoost)  unboostFields.push({ name: '✨ Total Boosts',  value: `**${guild.premiumSubscriptionCount ?? 0}** boost(s)`, inline: true });
                if (cfg.unboostShowLevelServer) unboostFields.push({ name: '🏅 Server Level',  value: `Level **${guild.premiumTier}**`,                     inline: true });
                if (unboostFields.length) embed.addFields(...unboostFields);
                if (cfg.unboostFooter) embed.setFooter({ text: parsePrev(cfg.unboostFooter) });
                if (unboostCard) embed.setImage('attachment://unboost-card.png');
                const unboostPayload = { embeds: [embed], flags: MessageFlags.Ephemeral };
                if (unboostCard) unboostPayload.files = [unboostCard];
                return interaction.reply(unboostPayload);
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // ── GRUP: autorole ─────────────────────────────────────────────────
        // ═══════════════════════════════════════════════════════════════════
        if (subGroup === 'autorole') {

            if (sub === 'set') {
                const roleStr = options.getString('role');
                const role    = resolveRole(interaction.guild, roleStr);
                if (!role) return interaction.reply({ content: s.role_not_found, flags: MessageFlags.Ephemeral });
                if (role.managed)   return interaction.reply({ content: s.role_managed, flags: MessageFlags.Ephemeral });
                if (role.id === guildId) return interaction.reply({ content: s.role_everyone, flags: MessageFlags.Ephemeral });

                client.database.set(`booster-autorole-role-${guildId}`, role.id);
                setBool(client, `booster-autorole-enabled-${guildId}`, true);

                return interaction.reply({
                    embeds: [new EmbedBuilder().setColor('#57F287').setDescription(s.autorole_set(role))],
                    flags: MessageFlags.Ephemeral
                });
            }

            if (sub === 'toggle') {
                const active = options.getBoolean('active');
                if (active && !cfg.autoroleRoleId) return interaction.reply({ content: s.autorole_unset, flags: MessageFlags.Ephemeral });
                setBool(client, `booster-autorole-enabled-${guildId}`, active);
                return interaction.reply({ content: active ? s.autorole_enabled : s.autorole_disabled, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'autoremove') {
                const active = options.getBoolean('active');
                setBool(client, `booster-autoremove-enabled-${guildId}`, active);
                return interaction.reply({
                    content: active ? s.autoremove_on : s.autoremove_off,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (sub === 'remove') {
                client.database.delete(`booster-autorole-role-${guildId}`);
                setBool(client, `booster-autorole-enabled-${guildId}`, false);
                setBool(client, `booster-autoremove-enabled-${guildId}`, false);
                return interaction.reply({
                    embeds: [new EmbedBuilder().setColor('#ED4245').setDescription(s.autorole_removed)],
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    }
}).toJSON();

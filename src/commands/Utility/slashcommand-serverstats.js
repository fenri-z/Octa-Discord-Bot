const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require('../../structure/ApplicationCommand');
const { checkBotPermissions } = require('../../utils/checkBotPermissions');
const {
    updateStats,
    getServerStatsConfig,
    parseLabel,
    safeRename
} = require("../../utils/serverStatsHelper");

// ── Helpers lokal ──────────────────────────────────────────────────────────
function setBool(client, key, val) {
    client.database.set(key, val ? 'true' : 'false');
}

// ── Command ────────────────────────────────────────────────────────────────
module.exports = new ApplicationCommand({
    command: {
        name: 'serverstats',
        description: 'Set up automatic server statistics channels (total members, users, and bots).',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            // ── setup ──────────────────────────────────────────────────────
            {
                name: 'setup',
                description: 'Automatically create a category & voice channels for server statistics.',
                type: 1,
                options: [
                    {
                        name: 'category_name',
                        description: 'Name of the category to create (default: 📊 Server Stats)',
                        type: 3,
                        required: false
                    }
                ]
            },
            // ── status ─────────────────────────────────────────────────────
            {
                name: 'status',
                description: 'Enable or disable the server stats feature.',
                type: 1,
                options: [
                    {
                        name: 'active',
                        description: 'Enable or disable server stats',
                        type: 5,
                        required: true
                    }
                ]
            },
            // ── label ──────────────────────────────────────────────────────
            {
                name: 'label',
                description: 'Change the statistics channel text format. Use {count} as a number placeholder.',
                type: 1,
                options: [
                    {
                        name: 'type',
                        description: 'Which channel label do you want to change?',
                        type: 3,
                        required: true,
                        choices: [
                            { name: '👥 Total Members',     value: 'total'    },
                            { name: '👤 User (not bot)',     value: 'human'    },
                            { name: '🤖 Bot',               value: 'bot'      },
                            { name: '📁 Category Name',      value: 'category' },
                        ]
                    },
                    {
                        name: 'format',
                        description: 'New format. Use {count} for the number. Example: 👥 Members: {count}',
                        type: 3,
                        required: true
                    }
                ]
            },
            // ── info ───────────────────────────────────────────────────────
            {
                name: 'info',
                description: 'View the current server stats configuration.',
                type: 1
            },
            // ── reset ──────────────────────────────────────────────────────
            {
                name: 'reset',
                description: 'Remove all server stats configuration (channels/category are NOT deleted automatically).',
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
        const guild   = interaction.guild;
        const guildId = guild.id;

        // ── Cek izin bot ──────────────────────────────────────────────────
        const ok = await checkBotPermissions(interaction, [
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.MoveMembers,
        ]);
        if (!ok) return;

        // ══════════════════════════════════════════════════════════════════
        // SETUP
        // ══════════════════════════════════════════════════════════════════
        if (sub === 'setup') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const namaKategori = interaction.options.getString('category_name') ?? '📊 Server Stats';
            const cfg = getServerStatsConfig(client, guildId);

            // ── Cek apakah sudah pernah disetup — langsung tolak ────────
            if (cfg.categoryId && cfg.totalId && cfg.humanId && cfg.botId) {
                const embed = new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('❌ Server Stats Already Set Up!')
                    .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
                    .setDescription(
                        '> Server Stats is already active in this server and cannot be set up again.\n\n' +
                        '> If you want to **start over from scratch**, use `/serverstats reset` first, then run setup again.'
                    )
                    .addFields(
                        { name: '📁 Category',     value: `<#${cfg.categoryId}>`, inline: true },
                        { name: '👥 Total Members', value: `<#${cfg.totalId}>`,   inline: true },
                        { name: '👤 User',         value: `<#${cfg.humanId}>`,   inline: true },
                        { name: '🤖 Bot',          value: `<#${cfg.botId}>`,     inline: true },
                        { name: '⚡ Status',        value: cfg.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                    )
                    .setFooter({ text: 'Use /serverstats reset to remove the existing configuration.' })
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            // ── Helper: fetch channel langsung dari Discord API (bypass cache) ──
            const fetchChannelDirect = async (id) => {
                if (!id) return null;
                return guild.channels.fetch(id).catch(() => null);
            };

            // ── Buat atau gunakan category yang sudah ada ────────────────
            let category = cfg.categoryId ? await fetchChannelDirect(cfg.categoryId) : null;

            if (!category) {
                category = await guild.channels.create({
                    name: namaKategori,
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: [PermissionFlagsBits.Connect]
                        },
                        {
                            id: client.user.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.ManageChannels,
                                PermissionFlagsBits.Connect,
                                PermissionFlagsBits.MoveMembers,
                            ]
                        }
                    ]
                }).catch(() => null);

                if (category) {
                    await category.setPosition(0).catch(() => null);
                }
            } else if (category.name !== namaKategori) {
                await category.setName(namaKategori).catch(() => null);
            }

            if (!category) {
                return interaction.editReply({
                    content: '❌ Failed to create category. Make sure the bot has **Manage Channels** permission and its role is high enough.'
                });
            }



            // ── Hitung member ────────────────────────────────────────────
            await guild.members.fetch().catch(() => null);
            const allMembers = guild.members.cache;
            const totalCount = allMembers.size;
            const botCount   = allMembers.filter(m => m.user.bot).size;
            const humanCount = totalCount - botCount;

            // ── Helper: buat atau dapatkan voice channel ─────────────────
            async function ensureVoiceChannel(existingId, label, count) {
                const name = parseLabel(label, count);

                let channel = existingId ? await fetchChannelDirect(existingId) : null;

                if (!channel) {
                    channel = await guild.channels.create({
                        name,
                        type: ChannelType.GuildVoice,
                        parent: category.id,
                        permissionOverwrites: [
                            {
                                id: guild.id,
                                deny: [PermissionFlagsBits.Connect]
                            },
                            {
                                id: client.user.id,
                                allow: [
                                    PermissionFlagsBits.ViewChannel,
                                    PermissionFlagsBits.ManageChannels,
                                    PermissionFlagsBits.Connect,
                                    PermissionFlagsBits.MoveMembers,
                                ]
                            }
                        ]
                    }).catch(() => null);
                } else {
                    await channel.setParent(category.id, { lockPermissions: false }).catch(() => null);
                    await safeRename(channel, name);
                }

                return channel;
            }

            const totalCh = await ensureVoiceChannel(cfg.totalId, cfg.totalLabel, totalCount);
            const humanCh = await ensureVoiceChannel(cfg.humanId, cfg.humanLabel, humanCount);
            const botCh   = await ensureVoiceChannel(cfg.botId,   cfg.botLabel,   botCount);

            if (!totalCh || !humanCh || !botCh) {
                // Bersihkan category yang sudah terlanjur dibuat jika semua channel gagal
                const channelFailed = [
                    !totalCh ? 'Total Members' : null,
                    !humanCh ? 'User'         : null,
                    !botCh   ? 'Bot'          : null,
                ].filter(Boolean).join(', ');

                return interaction.editReply({
                    content: `❌ Failed to create channel: **${channelFailed}**.\nCheck the bot console for error details and make sure the bot has sufficient permissions.`
                });
            }

            // ── Simpan ke database ───────────────────────────────────────
            client.database.set(`serverstats-category-${guildId}`,      category.id);
            client.database.set(`serverstats-total-channel-${guildId}`, totalCh.id);
            client.database.set(`serverstats-human-channel-${guildId}`, humanCh.id);
            client.database.set(`serverstats-bot-channel-${guildId}`,   botCh.id);
            client.database.set(`serverstats-category-label-${guildId}`, namaKategori);
            setBool(client, `serverstats-enabled-${guildId}`, true);

            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('✅ Server Stats Set Up Successfully!')
                .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
                .setDescription(
                    '> Statistics channels have been created and will be **automatically updated** whenever a member joins or leaves.\n\n' +
                    '> ⚠️ These channels cannot be joined by regular members — they are for display only.'
                )
                .addFields(
                    { name: '📁 Category',       value: `<#${category.id}>`,  inline: true },
                    { name: '👥 Total Members',  value: `<#${totalCh.id}>`,   inline: true },
                    { name: '👤 User',           value: `<#${humanCh.id}>`,   inline: true },
                    { name: '🤖 Bot',            value: `<#${botCh.id}>`,     inline: true },
                    {
                        name: '📊 Current Statistics',
                        value: `${totalCount} member(s) (${humanCount} user(s), ${botCount} bot(s))`,
                        inline: false
                    },
                    {
                        name: '💡 Tips',
                        value: [
                            '• Change label format: `/serverstats label`',
                            '• Disable: `/serverstats status active:False`',
                            '• View config: `/serverstats info`',
                        ].join('\n'),
                        inline: false
                    }
                )
                .setFooter({ text: 'Use /serverstats label to customize channel text.' })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }

        // ══════════════════════════════════════════════════════════════════
        // STATUS
        // ══════════════════════════════════════════════════════════════════
        if (sub === 'status') {
            const active = interaction.options.getBoolean('active');
            const cfg   = getServerStatsConfig(client, guildId);

            if (active && (!cfg.categoryId || !cfg.totalId || !cfg.humanId || !cfg.botId)) {
                return interaction.reply({
                    content: '⚠️ Server stats has not been set up.\nUse `/serverstats setup` first.',
                    flags: MessageFlags.Ephemeral
                });
            }

            setBool(client, `serverstats-enabled-${guildId}`, active);

            if (active) await updateStats(client, guild);

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(active ? '#57F287' : '#ED4245')
                        .setTitle(active ? '✅ Server Stats Enabled' : '🔴 Server Stats Disabled')
                        .setDescription(
                            active
                                ? '> Stats channels will be updated automatically whenever a member joins or leaves.'
                                : '> Stats channels will not be updated until re-enabled.\n> Existing channels are **not deleted** automatically.'
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ══════════════════════════════════════════════════════════════════
        // LABEL
        // ══════════════════════════════════════════════════════════════════
        if (sub === 'label') {
            const tipe   = interaction.options.getString('type');
            const format = interaction.options.getString('format').trim();

            if (tipe !== 'category' && !format.includes('{count}')) {
                return interaction.reply({
                    content: '❌ The format must contain `{count}` to display the number.\nExample: `👥 Members: {count}`',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (format.length > 90) {
                return interaction.reply({
                    content: `❌ Format is too long (${format.length} characters). Maximum is 90 characters.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const cfg = getServerStatsConfig(client, guildId);

            const keyMap = {
                total:    `serverstats-total-label-${guildId}`,
                human:    `serverstats-human-label-${guildId}`,
                bot:      `serverstats-bot-label-${guildId}`,
                category: `serverstats-category-label-${guildId}`,
            };
            client.database.set(keyMap[tipe], format);

            await guild.members.fetch().catch(() => null);
            const allMembers = guild.members.cache;
            const totalCount = allMembers.size;
            const botCount   = allMembers.filter(m => m.user.bot).size;
            const humanCount = totalCount - botCount;

            if (tipe === 'category') {
                if (!cfg.categoryId) {
                    return interaction.reply({
                        content: '❌ Category has not been set up. Run `/serverstats setup` first.',
                        flags: MessageFlags.Ephemeral
                    });
                }
                const catCh = guild.channels.cache.get(cfg.categoryId)
                    ?? await guild.channels.fetch(cfg.categoryId).catch(() => null);

                if (!catCh) {
                    return interaction.reply({
                        content: '❌ Category channel not found in Discord. It may have been manually deleted.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                await safeRename(catCh, format);
            } else if (tipe === 'total') {
                const ch = cfg.totalId ? guild.channels.cache.get(cfg.totalId) : null;
                await safeRename(ch, parseLabel(format, totalCount));
            } else if (tipe === 'human') {
                const ch = cfg.humanId ? guild.channels.cache.get(cfg.humanId) : null;
                await safeRename(ch, parseLabel(format, humanCount));
            } else if (tipe === 'bot') {
                const ch = cfg.botId ? guild.channels.cache.get(cfg.botId) : null;
                await safeRename(ch, parseLabel(format, botCount));
            }

            const namaLabel = { total: 'Total Members', human: 'User', bot: 'Bot', category: 'Category' }[tipe];
            const previewCount = tipe === 'total' ? totalCount : tipe === 'human' ? humanCount : botCount;

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#FEE75C')
                        .setTitle('✏️ Label Updated')
                        .addFields(
                            { name: 'Channel',     value: `**${namaLabel}**`,   inline: true },
                            { name: 'New Format',  value: `\`${format}\``,      inline: true },
                            {
                                name: 'Preview',
                                value: tipe !== 'category'
                                    ? `\`${parseLabel(format, previewCount)}\``
                                    : `\`${format}\``,
                                inline: true
                            },
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ══════════════════════════════════════════════════════════════════
        // INFO
        // ══════════════════════════════════════════════════════════════════
        if (sub === 'info') {
            const cfg = getServerStatsConfig(client, guildId);

            const catCh   = cfg.categoryId ? guild.channels.cache.get(cfg.categoryId) : null;
            const totalCh = cfg.totalId    ? guild.channels.cache.get(cfg.totalId)    : null;
            const humanCh = cfg.humanId    ? guild.channels.cache.get(cfg.humanId)    : null;
            const botCh   = cfg.botId      ? guild.channels.cache.get(cfg.botId)      : null;

            const mention = (ch) => ch ? `<#${ch.id}>` : '`not set`';
            const tick    = (val) => val ? '✅ Enabled' : '❌ Disabled';

            await guild.members.fetch().catch(() => null);
            const allMembers = guild.members.cache;
            const totalCount = allMembers.size;
            const botCount   = allMembers.filter(m => m.user.bot).size;
            const humanCount = totalCount - botCount;

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#5865F2')
                        .setTitle('📊 Server Stats Configuration')
                        .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
                        .addFields(
                            { name: '⚡ Status',         value: tick(cfg.enabled),  inline: true  },
                            { name: '📁 Category',       value: mention(catCh),     inline: true  },
                            { name: '👥 Total Channel',  value: mention(totalCh),   inline: true  },
                            { name: '👤 User Channel',   value: mention(humanCh),   inline: true  },
                            { name: '🤖 Bot Channel',    value: mention(botCh),     inline: true  },
                            { name: '📝 Total Format',   value: `\`${cfg.totalLabel}\``,  inline: false },
                            { name: '📝 User Format',    value: `\`${cfg.humanLabel}\``,  inline: true  },
                            { name: '📝 Bot Format',     value: `\`${cfg.botLabel}\``,    inline: true  },
                            {
                                name: '📊 Current Statistics',
                                value: `Total: **${totalCount}** · User: **${humanCount}** · Bot: **${botCount}**`,
                                inline: false
                            },
                        )
                        .setFooter({ text: 'Use /serverstats label to change the text format.' })
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ══════════════════════════════════════════════════════════════════
        // RESET
        // ══════════════════════════════════════════════════════════════════
        if (sub === 'reset') {
            const cfg = getServerStatsConfig(client, guildId);

            // ── Jika belum pernah disetup ────────────────────────────────
            if (!cfg.categoryId && !cfg.totalId && !cfg.humanId && !cfg.botId) {
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#FEE75C')
                            .setTitle('⚠️ No Configuration Found')
                            .setDescription('> Server Stats has never been set up in this server.\n> Use `/serverstats setup` to get started.')
                            .setTimestamp()
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            // ── Kirim konfirmasi sebelum reset ───────────────────────────
            const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`serverstats-reset-confirm:${guildId}`)
                    .setLabel('Yes, Delete Everything')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️'),
                new ButtonBuilder()
                    .setCustomId(`serverstats-reset-cancel:${guildId}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('✖️')
            );

            const catCh   = cfg.categoryId ? guild.channels.cache.get(cfg.categoryId) : null;
            const totalCh = cfg.totalId    ? guild.channels.cache.get(cfg.totalId)    : null;
            const humanCh = cfg.humanId    ? guild.channels.cache.get(cfg.humanId)    : null;
            const botCh   = cfg.botId      ? guild.channels.cache.get(cfg.botId)      : null;

            const mention = (ch) => ch ? `<#${ch.id}>` : '`(not found)`';

            const confirmEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('🗑️ Confirm Server Stats Reset')
                .setDescription(
                    '> Are you sure you want to reset Server Stats?\n\n' +
                    '> ⚠️ **The following channels and category will be permanently deleted from Discord:**'
                )
                .addFields(
                    { name: '📁 Category',     value: mention(catCh),   inline: true },
                    { name: '👥 Total Members', value: mention(totalCh), inline: true },
                    { name: '👤 User',         value: mention(humanCh), inline: true },
                    { name: '🤖 Bot',          value: mention(botCh),   inline: true },
                )
                .setFooter({ text: 'This action cannot be undone after confirmation.' })
                .setTimestamp();

            return interaction.reply({
                embeds: [confirmEmbed],
                components: [row],
                flags: MessageFlags.Ephemeral
            });
        }

    }
}).toJSON();
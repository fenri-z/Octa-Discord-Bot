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
        description: 'Setup channel statistik server otomatis (total member, user, dan bot).',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            // ── setup ──────────────────────────────────────────────────────
            {
                name: 'setup',
                description: 'Buat category & channel voice statistik secara otomatis.',
                type: 1,
                options: [
                    {
                        name: 'nama_kategori',
                        description: 'Nama kategori yang akan dibuat (default: 📊 Server Stats)',
                        type: 3,
                        required: false
                    }
                ]
            },
            // ── status ─────────────────────────────────────────────────────
            {
                name: 'status',
                description: 'Aktifkan atau nonaktifkan fitur server stats.',
                type: 1,
                options: [
                    {
                        name: 'aktif',
                        description: 'Aktifkan atau nonaktifkan server stats',
                        type: 5,
                        required: true
                    }
                ]
            },
            // ── label ──────────────────────────────────────────────────────
            {
                name: 'label',
                description: 'Ubah format teks channel statistik. Gunakan {count} sebagai placeholder angka.',
                type: 1,
                options: [
                    {
                        name: 'tipe',
                        description: 'Channel mana yang ingin diubah labelnya?',
                        type: 3,
                        required: true,
                        choices: [
                            { name: '👥 Total Member',      value: 'total'    },
                            { name: '👤 User (bukan bot)',  value: 'human'    },
                            { name: '🤖 Bot',               value: 'bot'      },
                            { name: '📁 Nama Kategori',     value: 'category' },
                        ]
                    },
                    {
                        name: 'format',
                        description: 'Format baru. Gunakan {count} untuk angka. Contoh: 👥 Member: {count}',
                        type: 3,
                        required: true
                    }
                ]
            },
            // ── info ───────────────────────────────────────────────────────
            {
                name: 'info',
                description: 'Lihat konfigurasi server stats saat ini.',
                type: 1
            },
            // ── reset ──────────────────────────────────────────────────────
            {
                name: 'reset',
                description: 'Hapus semua konfigurasi server stats (channel/category TIDAK dihapus otomatis).',
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

            const namaKategori = interaction.options.getString('nama_kategori') ?? '📊 Server Stats';
            const cfg = getServerStatsConfig(client, guildId);

            // ── Cek apakah sudah pernah disetup — langsung tolak ────────
            if (cfg.categoryId && cfg.totalId && cfg.humanId && cfg.botId) {
                const embed = new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('❌ Server Stats Sudah Disetup!')
                    .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
                    .setDescription(
                        '> Server Stats sudah aktif di server ini dan tidak bisa disetup ulang.\n\n' +
                        '> Jika ingin **memulai ulang dari awal**, gunakan `/serverstats reset` terlebih dahulu, lalu jalankan setup kembali.'
                    )
                    .addFields(
                        { name: '📁 Kategori',     value: `<#${cfg.categoryId}>`, inline: true },
                        { name: '👥 Total Member', value: `<#${cfg.totalId}>`,   inline: true },
                        { name: '👤 User',         value: `<#${cfg.humanId}>`,   inline: true },
                        { name: '🤖 Bot',          value: `<#${cfg.botId}>`,     inline: true },
                        { name: '⚡ Status',       value: cfg.enabled ? '✅ Aktif' : '❌ Nonaktif', inline: true },
                    )
                    .setFooter({ text: 'Gunakan /serverstats reset untuk menghapus konfigurasi yang ada.' })
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
                    content: '❌ Gagal membuat kategori. Pastikan bot memiliki izin **Manage Channels** dan posisi role bot cukup tinggi.'
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
                    !totalCh ? 'Total Member' : null,
                    !humanCh ? 'User'         : null,
                    !botCh   ? 'Bot'          : null,
                ].filter(Boolean).join(', ');

                return interaction.editReply({
                    content: `❌ Gagal membuat channel: **${channelFailed}**.\nCek console bot untuk detail error, dan pastikan bot punya izin yang cukup.`
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
                .setTitle('✅ Server Stats Berhasil Disetup!')
                .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
                .setDescription(
                    '> Channel statistik berhasil dibuat dan akan **otomatis diperbarui** setiap kali member bergabung atau keluar.\n\n' +
                    '> ⚠️ Channel ini tidak bisa di-*join* oleh member biasa — hanya sebagai tampilan angka.'
                )
                .addFields(
                    { name: '📁 Kategori',       value: `<#${category.id}>`,  inline: true },
                    { name: '👥 Total Member',   value: `<#${totalCh.id}>`,   inline: true },
                    { name: '👤 User',           value: `<#${humanCh.id}>`,   inline: true },
                    { name: '🤖 Bot',            value: `<#${botCh.id}>`,     inline: true },
                    {
                        name: '📊 Statistik Saat Ini',
                        value: `${totalCount} member (${humanCount} user, ${botCount} bot)`,
                        inline: false
                    },
                    {
                        name: '💡 Tips',
                        value: [
                            '• Ubah format label: `/serverstats label`',
                            '• Nonaktifkan: `/serverstats status aktif:False`',
                            '• Lihat config: `/serverstats info`',
                        ].join('\n'),
                        inline: false
                    }
                )
                .setFooter({ text: 'Gunakan /serverstats label untuk kustomisasi teks channel.' })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }

        // ══════════════════════════════════════════════════════════════════
        // STATUS
        // ══════════════════════════════════════════════════════════════════
        if (sub === 'status') {
            const aktif = interaction.options.getBoolean('aktif');
            const cfg   = getServerStatsConfig(client, guildId);

            if (aktif && (!cfg.categoryId || !cfg.totalId || !cfg.humanId || !cfg.botId)) {
                return interaction.reply({
                    content: '⚠️ Server stats belum disetup.\nGunakan `/serverstats setup` terlebih dahulu.',
                    flags: MessageFlags.Ephemeral
                });
            }

            setBool(client, `serverstats-enabled-${guildId}`, aktif);

            if (aktif) await updateStats(client, guild);

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(aktif ? '#57F287' : '#ED4245')
                        .setTitle(aktif ? '✅ Server Stats Diaktifkan' : '🔴 Server Stats Dinonaktifkan')
                        .setDescription(
                            aktif
                                ? '> Channel stats akan diperbarui otomatis setiap ada member bergabung atau keluar.'
                                : '> Channel stats tidak akan diperbarui hingga diaktifkan kembali.\n> Channel yang sudah ada **tidak dihapus** secara otomatis.'
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
            const tipe   = interaction.options.getString('tipe');
            const format = interaction.options.getString('format').trim();

            if (tipe !== 'category' && !format.includes('{count}')) {
                return interaction.reply({
                    content: '❌ Format harus mengandung `{count}` agar angka bisa ditampilkan.\nContoh: `👥 Member: {count}`',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (format.length > 90) {
                return interaction.reply({
                    content: `❌ Format terlalu panjang (${format.length} karakter). Maksimal 90 karakter.`,
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
                        content: '❌ Kategori belum disetup. Jalankan `/serverstats setup` terlebih dahulu.',
                        flags: MessageFlags.Ephemeral
                    });
                }
                const catCh = guild.channels.cache.get(cfg.categoryId)
                    ?? await guild.channels.fetch(cfg.categoryId).catch(() => null);

                if (!catCh) {
                    return interaction.reply({
                        content: '❌ Channel kategori tidak ditemukan di Discord. Mungkin sudah dihapus manual.',
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

            const namaLabel = { total: 'Total Member', human: 'User', bot: 'Bot', category: 'Kategori' }[tipe];
            const previewCount = tipe === 'total' ? totalCount : tipe === 'human' ? humanCount : botCount;

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#FEE75C')
                        .setTitle('✏️ Label Berhasil Diubah')
                        .addFields(
                            { name: 'Channel',     value: `**${namaLabel}**`,   inline: true },
                            { name: 'Format Baru', value: `\`${format}\``,      inline: true },
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

            const mention = (ch) => ch ? `<#${ch.id}>` : '`belum diatur`';
            const tick    = (val) => val ? '✅ Aktif' : '❌ Nonaktif';

            await guild.members.fetch().catch(() => null);
            const allMembers = guild.members.cache;
            const totalCount = allMembers.size;
            const botCount   = allMembers.filter(m => m.user.bot).size;
            const humanCount = totalCount - botCount;

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#5865F2')
                        .setTitle('📊 Konfigurasi Server Stats')
                        .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
                        .addFields(
                            { name: '⚡ Status',        value: tick(cfg.enabled),         inline: true  },
                            { name: '📁 Kategori',       value: mention(catCh),             inline: true  },
                            { name: '👥 Channel Total', value: mention(totalCh),            inline: true  },
                            { name: '👤 Channel User',  value: mention(humanCh),            inline: true  },
                            { name: '🤖 Channel Bot',   value: mention(botCh),              inline: true  },
                            { name: '📝 Format Total',  value: `\`${cfg.totalLabel}\``,    inline: false },
                            { name: '📝 Format User',   value: `\`${cfg.humanLabel}\``,    inline: true  },
                            { name: '📝 Format Bot',    value: `\`${cfg.botLabel}\``,      inline: true  },
                            {
                                name: '📊 Statistik Saat Ini',
                                value: `Total: **${totalCount}** · User: **${humanCount}** · Bot: **${botCount}**`,
                                inline: false
                            },
                        )
                        .setFooter({ text: 'Gunakan /serverstats label untuk mengubah format teks.' })
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
                            .setTitle('⚠️ Belum Ada Konfigurasi')
                            .setDescription('> Server Stats belum pernah disetup di server ini.\n> Gunakan `/serverstats setup` untuk memulai.')
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
                    .setLabel('Ya, Hapus Semuanya')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️'),
                new ButtonBuilder()
                    .setCustomId(`serverstats-reset-cancel:${guildId}`)
                    .setLabel('Batal')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('✖️')
            );

            const catCh   = cfg.categoryId ? guild.channels.cache.get(cfg.categoryId) : null;
            const totalCh = cfg.totalId    ? guild.channels.cache.get(cfg.totalId)    : null;
            const humanCh = cfg.humanId    ? guild.channels.cache.get(cfg.humanId)    : null;
            const botCh   = cfg.botId      ? guild.channels.cache.get(cfg.botId)      : null;

            const mention = (ch) => ch ? `<#${ch.id}>` : '`(tidak ditemukan)`';

            const confirmEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('🗑️ Konfirmasi Reset Server Stats')
                .setDescription(
                    '> Apakah kamu yakin ingin mereset Server Stats?\n\n' +
                    '> ⚠️ **Channel dan category berikut akan dihapus permanen dari Discord:**'
                )
                .addFields(
                    { name: '📁 Kategori',     value: mention(catCh),   inline: true },
                    { name: '👥 Total Member', value: mention(totalCh), inline: true },
                    { name: '👤 User',         value: mention(humanCh), inline: true },
                    { name: '🤖 Bot',          value: mention(botCh),   inline: true },
                )
                .setFooter({ text: 'Tindakan ini tidak bisa dibatalkan setelah dikonfirmasi.' })
                .setTimestamp();

            return interaction.reply({
                embeds: [confirmEmbed],
                components: [row],
                flags: MessageFlags.Ephemeral
            });
        }

    }
}).toJSON();
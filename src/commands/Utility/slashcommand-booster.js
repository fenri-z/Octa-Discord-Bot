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
        boostTitle:             client.database.get(`booster-boost-title-${guildId}`)        ?? '🚀 Server Boost Baru!',
        boostDescription:       client.database.get(`booster-boost-desc-${guildId}`)        ?? 'Terima kasih {member} sudah boost server ini! 💖\nTotal boost sekarang: **{boosts}**.',
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
        unboostTitle:           client.database.get(`booster-unboost-title-${guildId}`)      ?? '💔 Boost Berakhir',
        unboostDescription:     client.database.get(`booster-unboost-desc-${guildId}`)      ?? '{member} telah mencabut boost-nya dari server.\nTotal boost sekarang: **{boosts}**.',
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
        description: 'Konfigurasi deteksi & notifikasi server booster.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [

            // ── status ────────────────────────────────────────────────────
            {
                name: 'status',
                description: 'Lihat semua konfigurasi booster saat ini.',
                type: 1
            },

            // ── list ──────────────────────────────────────────────────────
            {
                name: 'list',
                description: 'Tampilkan daftar semua member yang sedang boost server.',
                type: 1
            },

            // ── notif ─────────────────────────────────────────────────────
            {
                name: 'notif',
                description: 'Atur notifikasi ketika seseorang boost atau unboost.',
                type: 2, // SUB_COMMAND_GROUP
                options: [
                    {
                        name: 'boost-toggle',
                        description: 'Aktifkan / nonaktifkan notifikasi saat boost.',
                        type: 1,
                        options: [{ name: 'aktif', description: 'true = nyalakan', type: 5, required: true }]
                    },
                    {
                        name: 'boost-channel',
                        description: 'Atur channel untuk notifikasi boost.',
                        type: 1,
                        options: [{
                            name: 'channel', description: 'Pilih channel teks (mention #channel atau ID)', type: 3, autocomplete: true,
required: true
                        }]
                    },
                    {
                        name: 'boost-title',
                        description: 'Ubah judul embed notifikasi boost. Placeholder: {member} {server} {boosts} {tag}',
                        type: 1,
                        options: [{ name: 'teks', description: 'Judul embed (maks. 256 karakter)', type: 3, required: true, max_length: 256 }]
                    },
                    {
                        name: 'boost-description',
                        description: 'Ubah deskripsi embed notifikasi boost.',
                        type: 1,
                        options: [{ name: 'teks', description: 'Deskripsi embed (maks. 2048 karakter)', type: 3, required: true, max_length: 2048 }]
                    },
                    {
                        name: 'boost-color',
                        description: 'Ubah warna embed notifikasi boost (hex).',
                        type: 1,
                        options: [{ name: 'hex', description: 'Contoh: #FF73FA', type: 3, required: true, max_length: 7 }]
                    },
                    {
                        name: 'unboost-toggle',
                        description: 'Aktifkan / nonaktifkan notifikasi saat unboost.',
                        type: 1,
                        options: [{ name: 'aktif', description: 'true = nyalakan', type: 5, required: true }]
                    },
                    {
                        name: 'unboost-channel',
                        description: 'Atur channel untuk notifikasi unboost.',
                        type: 1,
                        options: [{
                            name: 'channel', description: 'Pilih channel teks (mention #channel atau ID)', type: 3, autocomplete: true,
required: true
                        }]
                    },
                    {
                        name: 'unboost-title',
                        description: 'Ubah judul embed notifikasi unboost.',
                        type: 1,
                        options: [{ name: 'teks', description: 'Judul embed (maks. 256 karakter)', type: 3, required: true, max_length: 256 }]
                    },
                    {
                        name: 'unboost-description',
                        description: 'Ubah deskripsi embed notifikasi unboost.',
                        type: 1,
                        options: [{ name: 'teks', description: 'Deskripsi embed (maks. 2048 karakter)', type: 3, required: true, max_length: 2048 }]
                    },
                    {
                        name: 'unboost-color',
                        description: 'Ubah warna embed notifikasi unboost (hex).',
                        type: 1,
                        options: [{ name: 'hex', description: 'Contoh: #ED4245', type: 3, required: true, max_length: 7 }]
                    },
                    {
                        name: 'preview-boost',
                        description: 'Pratinjau tampilan notifikasi boost.',
                        type: 1
                    },
                    {
                        name: 'preview-unboost',
                        description: 'Pratinjau tampilan notifikasi unboost.',
                        type: 1
                    }
                ]
            },

            // ── autorole ──────────────────────────────────────────────────
            {
                name: 'autorole',
                description: 'Atur role otomatis untuk booster.',
                type: 2,
                options: [
                    {
                        name: 'set',
                        description: 'Tetapkan role yang diberikan saat seseorang boost server.',
                        type: 1,
                        options: [{
                            name: 'role', description: 'Role booster (mention @role atau ID)', type: 3, autocomplete: true,
required: true
                        }]
                    },
                    {
                        name: 'toggle',
                        description: 'Aktifkan / nonaktifkan autorole booster.',
                        type: 1,
                        options: [{ name: 'aktif', description: 'true = nyalakan', type: 5, required: true }]
                    },
                    {
                        name: 'autoremove',
                        description: 'Cabut role booster otomatis saat seseorang unboost.',
                        type: 1,
                        options: [{ name: 'aktif', description: 'true = aktifkan pencabutan otomatis', type: 5, required: true }]
                    },
                    {
                        name: 'remove',
                        description: 'Hapus konfigurasi autorole booster.',
                        type: 1
                    }
                ]
            },

            // ── reset ─────────────────────────────────────────────────────
            {
                name: 'reset',
                description: 'Reset semua konfigurasi booster ke default.',
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
                .setTitle('⚙️ Konfigurasi Booster')
                .setColor('#FF73FA')
                .addFields(
                    {
                        name: '🚀 Notifikasi Boost',
                        value: [
                            `**Status:** ${cfg.boostEnabled ? '✅ Aktif' : '❌ Nonaktif'}`,
                            `**Channel:** ${boostCh ? `<#${boostCh.id}>` : '`Belum diatur`'}`,
                            `**Tipe:** ${cfg.boostMessageType === 'plain' ? '📝 Teks Biasa' : '🖼️ Embed'}`,
                            cfg.boostMessageType === 'plain'
                                ? `**Pesan:** \`${(cfg.boostPlainText || '-').slice(0, 60)}${cfg.boostPlainText?.length > 60 ? '…' : ''}\``
                                : `**Judul:** \`${cfg.boostTitle}\``,
                            `**Warna:** \`${cfg.boostColor}\``,
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '🚀 Field Info Boost',
                        value: [
                            `👤 Member: ${cfg.boostShowMember ? '✅' : '❌'}`,
                            `🚀 Mulai Boost: ${cfg.boostShowMulaiBoost ? '✅' : '❌'}`,
                            `✨ Total Boost: ${cfg.boostShowTotalBoost ? '✅' : '❌'}`,
                            `🏅 Level Server: ${cfg.boostShowLevelServer ? '✅' : '❌'}`,
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '💔 Notifikasi Unboost',
                        value: [
                            `**Status:** ${cfg.unboostEnabled ? '✅ Aktif' : '❌ Nonaktif'}`,
                            `**Channel:** ${unboostCh ? `<#${unboostCh.id}>` : '`Belum diatur`'}`,
                            `**Tipe:** ${cfg.unboostMessageType === 'plain' ? '📝 Teks Biasa' : '🖼️ Embed'}`,
                            cfg.unboostMessageType === 'plain'
                                ? `**Pesan:** \`${(cfg.unboostPlainText || '-').slice(0, 60)}${cfg.unboostPlainText?.length > 60 ? '…' : ''}\``
                                : `**Judul:** \`${cfg.unboostTitle}\``,
                            `**Warna:** \`${cfg.unboostColor}\``,
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '💔 Field Info Unboost',
                        value: [
                            `👤 Member: ${cfg.unboostShowMember ? '✅' : '❌'}`,
                            `✨ Total Boost: ${cfg.unboostShowTotalBoost ? '✅' : '❌'}`,
                            `🏅 Level Server: ${cfg.unboostShowLevelServer ? '✅' : '❌'}`,
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '🎖️ Autorole Booster',
                        value: [
                            `**Status:** ${cfg.autoroleEnabled ? '✅ Aktif' : '❌ Nonaktif'}`,
                            `**Role:** ${arRole ? `${arRole}` : '`Belum diatur`'}`,
                            `**Cabut saat unboost:** ${cfg.autoremoveEnabled ? '✅ Ya' : '❌ Tidak'}`
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
                            .setDescription('❌ Tidak ada member yang sedang boost server ini.')
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            // Urutkan dari yang paling lama boost
            const sorted = [...boosters.values()].sort(
                (a, b) => a.premiumSince - b.premiumSince
            );

            const lines = sorted.map((m, i) =>
                `\`${String(i + 1).padStart(2, '0')}.\` ${m} — <t:${Math.floor(m.premiumSinceTimestamp / 1000)}:R>`
            );

            // Bagi ke chunks 20 per halaman agar tidak melebihi 4096 karakter
            const chunks = [];
            while (lines.length) chunks.push(lines.splice(0, 20));

            const embed = new EmbedBuilder()
                .setTitle(`🚀 Daftar Server Booster — ${guild.name}`)
                .setColor('#FF73FA')
                .setDescription(chunks[0].join('\n'))
                .addFields({ name: '\u200b', value: `Total: **${boosters.size}** booster · Level ${guild.premiumTier}`, inline: false })
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
                content: '🔄 Semua konfigurasi booster telah **direset ke default**.',
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
                const aktif = options.getBoolean('aktif');
                if (aktif && !cfg.boostChannelId) return interaction.reply({ content: '❌ Atur channel boost terlebih dahulu dengan `/booster notif boost-channel`.', flags: MessageFlags.Ephemeral });
                setBool(client, `booster-boost-enabled-${guildId}`, aktif);
                return interaction.reply({ content: aktif ? '✅ Notifikasi boost **diaktifkan**.' : '❌ Notifikasi boost **dinonaktifkan**.', flags: MessageFlags.Ephemeral });
            }

            if (sub === 'boost-channel') {
                const chStr = options.getString('channel');
                const ch    = resolveChannel(interaction.guild, chStr);
                if (!ch) return interaction.reply({ content: '❌ Channel tidak ditemukan. Gunakan mention `#channel` atau ID channel.', flags: MessageFlags.Ephemeral });
                const chPermsOkBoost = await checkBotPermissions(interaction, [
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.EmbedLinks,
                ], ch);
                if (!chPermsOkBoost) return;
                client.database.set(`booster-boost-channel-${guildId}`, ch.id);
                return interaction.reply({ content: `✅ Channel notifikasi boost diatur ke <#${ch.id}>.`, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'boost-title') {
                client.database.set(`booster-boost-title-${guildId}`, options.getString('teks'));
                return interaction.reply({ content: `✅ Judul notifikasi boost diperbarui.`, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'boost-description') {
                client.database.set(`booster-boost-desc-${guildId}`, options.getString('teks'));
                return interaction.reply({ content: `✅ Deskripsi notifikasi boost diperbarui.`, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'boost-color') {
                const val = options.getString('hex').trim();
                if (!validateHex(val)) return interaction.reply({ content: '❌ Format hex tidak valid. Contoh: `#FF73FA`', flags: MessageFlags.Ephemeral });
                client.database.set(`booster-boost-color-${guildId}`, toHex(val));
                return interaction.reply({ content: `✅ Warna notifikasi boost diperbarui ke \`${toHex(val)}\`.`, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'unboost-toggle') {
                const aktif = options.getBoolean('aktif');
                if (aktif && !cfg.unboostChannelId) return interaction.reply({ content: '❌ Atur channel unboost terlebih dahulu dengan `/booster notif unboost-channel`.', flags: MessageFlags.Ephemeral });
                setBool(client, `booster-unboost-enabled-${guildId}`, aktif);
                return interaction.reply({ content: aktif ? '✅ Notifikasi unboost **diaktifkan**.' : '❌ Notifikasi unboost **dinonaktifkan**.', flags: MessageFlags.Ephemeral });
            }

            if (sub === 'unboost-channel') {
                const chStr = options.getString('channel');
                const ch    = resolveChannel(interaction.guild, chStr);
                if (!ch) return interaction.reply({ content: '❌ Channel tidak ditemukan. Gunakan mention `#channel` atau ID channel.', flags: MessageFlags.Ephemeral });
                const chPermsOkUnboost = await checkBotPermissions(interaction, [
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.EmbedLinks,
                ], ch);
                if (!chPermsOkUnboost) return;
                client.database.set(`booster-unboost-channel-${guildId}`, ch.id);
                return interaction.reply({ content: `✅ Channel notifikasi unboost diatur ke <#${ch.id}>.`, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'unboost-title') {
                client.database.set(`booster-unboost-title-${guildId}`, options.getString('teks'));
                return interaction.reply({ content: `✅ Judul notifikasi unboost diperbarui.`, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'unboost-description') {
                client.database.set(`booster-unboost-desc-${guildId}`, options.getString('teks'));
                return interaction.reply({ content: `✅ Deskripsi notifikasi unboost diperbarui.`, flags: MessageFlags.Ephemeral });
            }

            if (sub === 'unboost-color') {
                const val = options.getString('hex').trim();
                if (!validateHex(val)) return interaction.reply({ content: '❌ Format hex tidak valid. Contoh: `#ED4245`', flags: MessageFlags.Ephemeral });
                client.database.set(`booster-unboost-color-${guildId}`, toHex(val));
                return interaction.reply({ content: `✅ Warna notifikasi unboost diperbarui ke \`${toHex(val)}\`.`, flags: MessageFlags.Ephemeral });
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
                        ? `> 👁️ **Pratinjau Boost (Teks Biasa)**\n${text}`
                        : `> 👁️ **Pratinjau Boost (Teks Biasa)** — pesan kosong, hanya card`;
                    if (boostCard) payload.files = [boostCard];
                    return interaction.reply(payload);
                }

                const embed = new EmbedBuilder()
                    .setColor(cfg.boostColor)
                    .setAuthor({ name: '👁️ Mode Pratinjau — Boost' })
                    .setTimestamp();
                const parsedBoostTitle = parsePrev(cfg.boostTitle);
                if (parsedBoostTitle) embed.setTitle(parsedBoostTitle);
                const parsedBoostDesc = parsePrev(cfg.boostDescription);
                if (parsedBoostDesc) embed.setDescription(parsedBoostDesc);
                if (cfg.boostShowThumbnail) embed.setThumbnail(interaction.member.user.displayAvatarURL({ dynamic: true, size: 256 }));
                const boostFields = [];
                if (cfg.boostShowMember)      boostFields.push({ name: '👤 Member',       value: interaction.member.user.tag,                        inline: true });
                if (cfg.boostShowMulaiBoost)  boostFields.push({ name: '🚀 Mulai Boost',  value: `<t:${Math.floor(Date.now() / 1000)}:R>`,           inline: true });
                if (cfg.boostShowTotalBoost)  boostFields.push({ name: '✨ Total Boost',  value: `**${guild.premiumSubscriptionCount ?? 0}** boost`,  inline: true });
                if (cfg.boostShowLevelServer) boostFields.push({ name: '🏅 Level Server', value: `Level **${guild.premiumTier}**`,                   inline: true });
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
                        ? `> 👁️ **Pratinjau Unboost (Teks Biasa)**\n${text}`
                        : `> 👁️ **Pratinjau Unboost (Teks Biasa)** — pesan kosong, hanya card`;
                    if (unboostCard) payload.files = [unboostCard];
                    return interaction.reply(payload);
                }

                const embed = new EmbedBuilder()
                    .setColor(cfg.unboostColor)
                    .setAuthor({ name: '👁️ Mode Pratinjau — Unboost' })
                    .setTimestamp();
                const parsedUnboostTitle = parsePrev(cfg.unboostTitle);
                if (parsedUnboostTitle) embed.setTitle(parsedUnboostTitle);
                const parsedUnboostDesc = parsePrev(cfg.unboostDescription);
                if (parsedUnboostDesc) embed.setDescription(parsedUnboostDesc);
                if (cfg.unboostShowThumbnail) embed.setThumbnail(interaction.member.user.displayAvatarURL({ dynamic: true, size: 256 }));
                const unboostFields = [];
                if (cfg.unboostShowMember)      unboostFields.push({ name: '👤 Member',       value: interaction.member.user.tag,                        inline: true });
                if (cfg.unboostShowTotalBoost)  unboostFields.push({ name: '✨ Total Boost',  value: `**${guild.premiumSubscriptionCount ?? 0}** boost`,  inline: true });
                if (cfg.unboostShowLevelServer) unboostFields.push({ name: '🏅 Level Server', value: `Level **${guild.premiumTier}**`,                    inline: true });
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
                if (!role) return interaction.reply({ content: '❌ Role tidak ditemukan. Gunakan mention `@role` atau ID role.', flags: MessageFlags.Ephemeral });
                if (role.managed)   return interaction.reply({ content: '❌ Role yang dikelola integrasi eksternal tidak bisa dipakai.', flags: MessageFlags.Ephemeral });
                if (role.id === guildId) return interaction.reply({ content: '❌ Role `@everyone` tidak bisa dipakai.', flags: MessageFlags.Ephemeral });

                client.database.set(`booster-autorole-role-${guildId}`, role.id);
                setBool(client, `booster-autorole-enabled-${guildId}`, true);

                return interaction.reply({
                    embeds: [new EmbedBuilder().setColor('#57F287').setDescription(`✅ Autorole booster diatur ke ${role}.\nStatus otomatis **diaktifkan**.`)],
                    flags: MessageFlags.Ephemeral
                });
            }

            if (sub === 'toggle') {
                const aktif = options.getBoolean('aktif');
                if (aktif && !cfg.autoroleRoleId) return interaction.reply({ content: '❌ Belum ada role yang diatur. Gunakan `/booster autorole set` terlebih dahulu.', flags: MessageFlags.Ephemeral });
                setBool(client, `booster-autorole-enabled-${guildId}`, aktif);
                return interaction.reply({ content: aktif ? '✅ Autorole booster **diaktifkan**.' : '❌ Autorole booster **dinonaktifkan**.', flags: MessageFlags.Ephemeral });
            }

            if (sub === 'autoremove') {
                const aktif = options.getBoolean('aktif');
                setBool(client, `booster-autoremove-enabled-${guildId}`, aktif);
                return interaction.reply({
                    content: aktif
                        ? '✅ Role booster akan **dicabut otomatis** saat member unboost.'
                        : '❌ Pencabutan role otomatis **dinonaktifkan**.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (sub === 'remove') {
                client.database.delete(`booster-autorole-role-${guildId}`);
                setBool(client, `booster-autorole-enabled-${guildId}`, false);
                setBool(client, `booster-autoremove-enabled-${guildId}`, false);
                return interaction.reply({
                    embeds: [new EmbedBuilder().setColor('#ED4245').setDescription('🗑️ Konfigurasi autorole booster berhasil dihapus.')],
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    }
}).toJSON();

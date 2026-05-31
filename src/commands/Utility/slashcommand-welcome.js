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
        description: 'Konfigurasi welcome notification untuk member baru.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            {
                name: 'status',
                description: 'Lihat konfigurasi welcome saat ini.',
                type: 1
            },
            {
                name: 'toggle',
                description: 'Aktifkan atau nonaktifkan pesan sambutan.',
                type: 1,
                options: [{ name: 'aktif', description: 'true = nyalakan, false = matikan', type: 5, required: true }]
            },
            {
                name: 'channel',
                description: 'Atur channel tempat pesan sambutan dikirim.',
                type: 1,
                options: [{ name: 'channel', description: 'Pilih channel teks', type: 3, autocomplete: true, required: true }]
            },
            {
                name: 'tipe',
                description: 'Pilih tipe pesan: embed atau teks biasa.',
                type: 1,
                options: [{ name: 'tipe', description: 'embed = pakai embed, plain = teks biasa', type: 3, required: true, choices: [{ name: '🖼️ Embed', value: 'embed' }, { name: '💬 Teks Biasa', value: 'plain' }] }]
            },
            {
                name: 'teks',
                description: 'Ubah judul & deskripsi embed (mode embed) atau isi teks biasa (mode plain) via modal.',
                type: 1
            },
            {
                name: 'color',
                description: 'Ubah warna embed (hex, contoh: #FF5733).',
                type: 1,
                options: [{ name: 'hex', description: 'Kode warna hex, contoh: #5865F2', type: 3, required: true, max_length: 7 }]
            },
            {
                name: 'footer',
                description: 'Ubah atau hapus teks footer embed.',
                type: 1,
                options: [{ name: 'teks', description: 'Teks footer. Ketik "-" untuk menghapus footer.', type: 3, required: true, max_length: 2048 }]
            },
            {
                name: 'thumbnail',
                description: 'Tampilkan atau sembunyikan foto profil member di embed.',
                type: 1,
                options: [{ name: 'tampil', description: 'true = tampilkan, false = sembunyikan', type: 5, required: true }]
            },
            {
                name: 'fields',
                description: 'Aktifkan atau nonaktifkan field info di embed (member & pengundang).',
                type: 1,
                options: [
                    {
                        name: 'field',
                        description: 'Pilih field yang ingin diubah',
                        type: 3,
                        required: true,
                        choices: [
                            { name: '👤 Member Baru',    value: 'member_baru'    },
                            { name: '📅 Akun Dibuat',    value: 'akun_dibuat'    },
                            { name: '👥 Total Member',   value: 'total_member'   },
                            { name: '📨 Diundang Oleh',  value: 'diundang_oleh'  },
                            { name: '🔗 Kode Invite',    value: 'kode_invite'    },
                            { name: '📊 Total Undangan', value: 'total_undangan' },
                        ]
                    },
                    { name: 'tampil', description: 'true = tampilkan, false = sembunyikan', type: 5, required: true }
                ]
            },
            {
                name: 'card',
                description: 'Konfigurasi welcome card (gambar sambutan dengan foto profil).',
                type: 1,
                options: [
                    {
                        name: 'aksi',
                        description: 'Pilih aksi yang ingin dilakukan',
                        type: 3,
                        required: true,
                        choices: [
                            { name: '🔌 Toggle on/off card',       value: 'toggle'  },
                            { name: '✏️  Ubah teks card',           value: 'teks'    },
                            { name: '🎨 Ubah warna card',           value: 'warna'   },
                        ]
                    }
                ]
            },
            {
                name: 'reset',
                description: 'Reset semua pengaturan welcome ke default.',
                type: 1
            },
            {
                name: 'preview',
                description: 'Pratinjau pesan sambutan dengan pengaturan saat ini.',
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

            const on  = '✅ Tampil';
            const off = '❌ Disembunyikan';

            const embed = new EmbedBuilder()
                .setColor(colorHex)
                .setTitle('⚙️ Konfigurasi Pesan Sambutan')
                .addFields(
                    { name: '🔌 Status',           value: cfg.enabled           ? '✅ Aktif' : '❌ Nonaktif',         inline: true },
                    { name: '📨 Tipe Pesan',        value: cfg.messageType === 'plain' ? '💬 Teks Biasa' : '🖼️ Embed',         inline: true },
                    { name: '📢 Channel',           value: channel               ? `<#${channel.id}>` : '`Belum diatur`', inline: true },
                    { name: '🎨 Warna',             value: `\`${cfg.color}\``,                                           inline: true },
                    { name: '📌 Judul',             value: `\`${cfg.title}\``,                                           inline: false },
                    { name: '📝 Deskripsi',         value: `\`${cfg.description}\``,                                     inline: false },
                    { name: '💬 Teks Biasa',         value: `\`${cfg.plainText}\``,                                          inline: false },
                    { name: '🃏 Welcome Card',      value: cfg.cardEnabled ? '✅ Aktif' : '❌ Nonaktif',  inline: true },
                    { name: '🔻 Footer',            value: cfg.footerText        ? `\`${cfg.footerText}\`` : '`(tidak ada)`', inline: false },
                    { name: '🖼️ Thumbnail',         value: cfg.thumbnail         ? on : off,  inline: true },
                    { name: '👤 Member Baru',       value: cfg.showMemberNew     ? on : off,  inline: true },
                    { name: '📅 Akun Dibuat',       value: cfg.showAkunDibuat    ? on : off,  inline: true },
                    { name: '👥 Total Member',      value: cfg.showTotalMember   ? on : off,  inline: true },
                    { name: '📨 Diundang Oleh',     value: cfg.showDiundangOleh  ? on : off,  inline: true },
                    { name: '🔗 Kode Invite',       value: cfg.showKodeInvite    ? on : off,  inline: true },
                    { name: '📊 Total Undangan',    value: cfg.showTotalUndangan ? on : off,  inline: true },
                )
                .setFooter({ text: 'Gunakan /welcome preview untuk melihat tampilan embed.' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── TOGGLE ────────────────────────────────────────────────────────
        if (sub === 'toggle') {
            const val = interaction.options.getBoolean('aktif');
            setBool(client, `welcome-enabled-${guildId}`, val);
            return interaction.reply({
                content: val ? '✅ Pesan sambutan **diaktifkan**.' : '❌ Pesan sambutan **dinonaktifkan**.',
                flags: MessageFlags.Ephemeral
            });
        }

        // ── CHANNEL ───────────────────────────────────────────────────────
        if (sub === 'channel') {
            const ch = resolveChannel(interaction.guild, interaction.options.getString('channel'));
            if (!ch) return interaction.reply({ content: '❌ Channel tidak ditemukan.', flags: MessageFlags.Ephemeral });
            const chOk = await checkBotPermissions(interaction, [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], ch);
            if (!chOk) return;
            client.database.set(`welcome-channel-${guildId}`, ch.id);
            return interaction.reply({ content: `✅ Channel sambutan diatur ke <#${ch.id}>.`, flags: MessageFlags.Ephemeral });
        }

        // ── TIPE ─────────────────────────────────────────────────────────
        if (sub === 'tipe') {
            const val = interaction.options.getString('tipe');
            client.database.set(`welcome-messageType-${guildId}`, val);
            return interaction.reply({
                content: val === 'plain'
                    ? '✅ Tipe pesan welcome diubah ke **Teks Biasa**. Gunakan `/welcome teks` untuk mengatur isinya.'
                    : '✅ Tipe pesan welcome diubah ke **Embed**. Gunakan `/welcome teks` untuk mengatur judul & deskripsinya.',
                flags: MessageFlags.Ephemeral
            });
        }

        // ── TEKS (modal: judul + deskripsi embed, atau teks biasa) ───────────
        if (sub === 'teks') {
            const cfg      = getConfig(client, guildId);
            const isPlain  = cfg.messageType === 'plain';
            const shortId  = `${interaction.user.id.slice(-6)}${Date.now().toString(36)}`;
            const modalId  = `wteks-${guildId.slice(-8)}-${shortId}`;

            const modal = new ModalBuilder()
                .setCustomId(modalId)
                .setTitle(isPlain ? '✏️ Ubah Teks Biasa Welcome' : '✏️ Ubah Teks Embed Welcome');

            if (isPlain) {
                const plainInput = new TextInputBuilder()
                    .setCustomId('plainText')
                    .setLabel('Isi Pesan: {member} {server} {count} {tag}')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(2000)
                    .setValue(cfg.plainText.slice(0, 2000))
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(plainInput));
            } else {
                const titleInput = new TextInputBuilder()
                    .setCustomId('title')
                    .setLabel('Judul: {server} {member} {count} {tag}')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(256)
                    .setValue(cfg.title.slice(0, 256))
                    .setRequired(true);

                const descInput = new TextInputBuilder()
                    .setCustomId('description')
                    .setLabel('Deskripsi: {member} {server} {count}')
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

            // Tunggu submit modal (max 5 menit), filter ketat per modalId + user
            const submitted = await interaction.awaitModalSubmit({
                filter: i => i.customId === modalId && i.user.id === interaction.user.id,
                time: 5 * 60 * 1000
            }).catch(() => null);

            if (!submitted) return; // timeout atau dibatalkan, diam saja

            if (isPlain) {
                const newPlain = submitted.fields.getTextInputValue('plainText').trim();
                client.database.set(`welcome-plainText-${guildId}`, newPlain);
                return submitted.reply({
                    content: `✅ Teks biasa welcome diperbarui.\n**Pesan:** ${newPlain}`,
                    flags: MessageFlags.Ephemeral
                });
            } else {
                const newTitle = submitted.fields.getTextInputValue('title').trim();
                const newDesc  = submitted.fields.getTextInputValue('description').trim();
                client.database.set(`welcome-title-${guildId}`,       newTitle);
                client.database.set(`welcome-description-${guildId}`, newDesc);
                return submitted.reply({
                    content: `✅ Teks embed welcome diperbarui.\n**Judul:** ${newTitle}\n**Deskripsi:** ${newDesc}`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // ── COLOR ─────────────────────────────────────────────────────────
        if (sub === 'color') {
            const val = interaction.options.getString('hex').trim();
            if (!/^#?[0-9A-Fa-f]{6}$/.test(val))
                return interaction.reply({ content: '❌ Format warna tidak valid. Gunakan hex seperti `#5865F2`.', flags: MessageFlags.Ephemeral });
            const clean = val.startsWith('#') ? val : `#${val}`;
            client.database.set(`welcome-color-${guildId}`, clean);
            return interaction.reply({ content: `✅ Warna embed diperbarui ke \`${clean}\`.`, flags: MessageFlags.Ephemeral });
        }

        // ── FOOTER ────────────────────────────────────────────────────────
        if (sub === 'footer') {
            const val = interaction.options.getString('teks').trim();
            if (val === '-') {
                client.database.delete(`welcome-footer-${guildId}`);
                return interaction.reply({ content: '✅ Footer embed **dihapus**.', flags: MessageFlags.Ephemeral });
            }
            client.database.set(`welcome-footer-${guildId}`, val);
            return interaction.reply({ content: `✅ Footer embed diperbarui:\n> ${val}`, flags: MessageFlags.Ephemeral });
        }

        // ── THUMBNAIL ─────────────────────────────────────────────────────
        if (sub === 'thumbnail') {
            const val = interaction.options.getBoolean('tampil');
            setBool(client, `welcome-thumbnail-${guildId}`, val);
            return interaction.reply({
                content: val ? '✅ Thumbnail foto profil **ditampilkan**.' : '✅ Thumbnail foto profil **disembunyikan**.',
                flags: MessageFlags.Ephemeral
            });
        }

        // ── FIELDS ────────────────────────────────────────────────────────
        if (sub === 'fields') {
            const field = interaction.options.getString('field');
            const val   = interaction.options.getBoolean('tampil');

            const fieldMap = {
                member_baru:    { key: `welcome-showMemberNew-${guildId}`,     label: '👤 Member Baru'    },
                akun_dibuat:    { key: `welcome-showAkunDibuat-${guildId}`,    label: '📅 Akun Dibuat'    },
                total_member:   { key: `welcome-showTotalMember-${guildId}`,   label: '👥 Total Member'   },
                diundang_oleh:  { key: `welcome-showDiundangOleh-${guildId}`,  label: '📨 Diundang Oleh'  },
                kode_invite:    { key: `welcome-showKodeInvite-${guildId}`,    label: '🔗 Kode Invite'    },
                total_undangan: { key: `welcome-showTotalUndangan-${guildId}`, label: '📊 Total Undangan' },
            };

            const target = fieldMap[field];
            if (!target) return interaction.reply({ content: '❌ Field tidak valid.', flags: MessageFlags.Ephemeral });

            setBool(client, target.key, val);
            return interaction.reply({
                content: val
                    ? `✅ Field **${target.label}** sekarang **ditampilkan** di embed.`
                    : `✅ Field **${target.label}** sekarang **disembunyikan** dari embed.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── CARD ─────────────────────────────────────────────────────────
        if (sub === 'card') {
            const aksi = interaction.options.getString('aksi');
            const cfg  = getConfig(client, guildId);

            // ── toggle ──────────────────────────────────────────────────
            if (aksi === 'toggle') {
                const newVal = !cfg.cardEnabled;
                setBool(client, `welcome-cardEnabled-${guildId}`, newVal);
                return interaction.reply({
                    content: newVal
                        ? '✅ Welcome card **diaktifkan**. Gambar sambutan akan dikirim bersama pesan welcome.'
                        : '❌ Welcome card **dinonaktifkan**.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // ── teks ────────────────────────────────────────────────────
            if (aksi === 'teks') {
                const shortId = `${interaction.user.id.slice(-6)}${Date.now().toString(36)}`;
                const modalId = `wcard-teks-${guildId.slice(-8)}-${shortId}`;

                const modal = new ModalBuilder()
                    .setCustomId(modalId)
                    .setTitle('✏️ Ubah Teks Welcome Card');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('welcomeText')
                            .setLabel('Teks besar atas (misal: WELCOME)')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(20)
                            .setValue(cfg.cardWelcomeText)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('subText')
                            .setLabel('Teks kecil bawah: {server} {count} {tag}')
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
                    content: `✅ Teks welcome card diperbarui!\n**Teks Besar:** ${newWelcomeText}\n**Sub teks:** ${newSubText}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // ── warna ───────────────────────────────────────────────────
            if (aksi === 'warna') {
                const shortId = `${interaction.user.id.slice(-6)}${Date.now().toString(36)}`;
                const modalId = `wcard-warna-${guildId.slice(-8)}-${shortId}`;

                const modal = new ModalBuilder()
                    .setCustomId(modalId)
                    .setTitle('🎨 Ubah Warna Welcome Card');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('bgColor')
                            .setLabel('Warna latar kiri (hex, contoh: #1a1a2e)')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(7)
                            .setValue(cfg.cardBgColor)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('bgColor2')
                            .setLabel('Warna latar kanan (hex, contoh: #16213e)')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(7)
                            .setValue(cfg.cardBgColor2)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('accentColor')
                            .setLabel('Warna aksen/border avatar (hex)')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(7)
                            .setValue(cfg.cardAccentColor)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('textColor')
                            .setLabel('Warna teks utama (hex, contoh: #ffffff)')
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
                    { id: 'bgColor',     key: `welcome-cardBgColor-${guildId}`,   label: 'Latar kiri'    },
                    { id: 'bgColor2',    key: `welcome-cardBgColor2-${guildId}`,  label: 'Latar kanan'   },
                    { id: 'accentColor', key: `welcome-cardAccent-${guildId}`,    label: 'Aksen'         },
                    { id: 'textColor',   key: `welcome-cardTextColor-${guildId}`, label: 'Teks utama'    },
                ];

                const errors = [];
                for (const f of fields) {
                    const val = submitted.fields.getTextInputValue(f.id).trim();
                    if (!hexRe.test(val)) { errors.push(f.label); continue; }
                    client.database.set(f.key, val);
                }

                if (errors.length > 0) {
                    return submitted.reply({
                        content: `⚠️ Format warna tidak valid untuk: **${errors.join(', ')}**. Gunakan format hex seperti \`#5865F2\`. Field lain yang valid sudah disimpan.`,
                        flags: MessageFlags.Ephemeral
                    });
                }

                return submitted.reply({
                    content: '✅ Warna welcome card berhasil diperbarui!',
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
            return interaction.reply({ content: '🔄 Semua pengaturan welcome telah **direset ke default**.', flags: MessageFlags.Ephemeral });
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
                .replace(/{inviter}/g,         member.user.tag + ' (contoh)')
                .replace(/{kode\.invite}/g,    'abc123 (contoh)')
                .replace(/{total\.undangan}/g, '42 (contoh)')
                .replace(/{akun\.dibuat}/g,    `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`);

            // Generate welcome card jika cardEnabled
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

            // Mode teks biasa
            if (cfg.messageType === 'plain') {
                let content = parse(cfg.plainText).trim();
                const infoLines = [];
                if (cfg.showMemberNew)     infoLines.push(`👤 **Member Baru:** ${member.user.tag}`);
                if (cfg.showAkunDibuat)    infoLines.push(`📅 **Akun Dibuat:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`);
                if (cfg.showTotalMember)   infoLines.push(`👥 **Total Member:** ${interaction.guild.memberCount} member`);
                if (cfg.showDiundangOleh)  infoLines.push(`📨 **Diundang Oleh:** ${member.user.tag} (contoh)`);
                if (cfg.showKodeInvite)    infoLines.push(`🔗 **Kode Invite:** \`abc123\` (contoh)`);
                if (cfg.showTotalUndangan) infoLines.push(`📊 **Total Undangan:** 42 undangan (contoh)`);
                if (infoLines.length > 0) content += (content ? '\n' : '') + infoLines.join('\n');
                content = content.trim();

                if (content) {
                    const payload = {
                        content: `> 👁️ **Mode Pratinjau** — bukan sambutan sungguhan\n${content}`,
                        flags: MessageFlags.Ephemeral
                    };
                    if (cardAttachment) payload.files = [cardAttachment];
                    return interaction.reply(payload);
                } else if (cardAttachment) {
                    return interaction.reply({
                        content: '> 👁️ **Mode Pratinjau** — bukan sambutan sungguhan *(pesan kosong, hanya welcome card)*',
                        files: [cardAttachment],
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    return interaction.reply({
                        content: '> 👁️ **Mode Pratinjau** — pesan kosong dan welcome card tidak aktif.',
                        flags: MessageFlags.Ephemeral
                    });
                }
            }

            // Mode embed
            const hasText   = cfg.title.trim() || cfg.description.trim();
            const hasFields = cfg.showMemberNew || cfg.showAkunDibuat || cfg.showTotalMember
                           || cfg.showDiundangOleh || cfg.showKodeInvite || cfg.showTotalUndangan;

            if (!hasText && !hasFields) {
                if (cardAttachment) {
                    const cardOnlyEmbed = new EmbedBuilder()
                        .setColor(colorHex)
                        .setAuthor({ name: '👁️ Mode Pratinjau — bukan sambutan sungguhan' })
                        .setTimestamp()
                        .setImage('attachment://welcome-card.png');
                    return interaction.reply({
                        embeds: [cardOnlyEmbed],
                        files: [cardAttachment],
                        flags: MessageFlags.Ephemeral
                    });
                }
                return interaction.reply({
                    content: '> 👁️ **Mode Pratinjau** — pesan kosong dan welcome card tidak aktif.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const embed = new EmbedBuilder()
                .setColor(colorHex)
                .setAuthor({ name: '👁️ Mode Pratinjau — bukan sambutan sungguhan' })
                .setTimestamp();

            if (parse(cfg.title))       embed.setTitle(parse(cfg.title));
            if (parse(cfg.description)) embed.setDescription(parse(cfg.description));

            if (cfg.footerText) embed.setFooter({ text: parse(cfg.footerText) });
            if (cfg.thumbnail)  embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));

            const fields = [];
            if (cfg.showMemberNew)     fields.push({ name: '👤 Member Baru',    value: member.user.tag, inline: true });
            if (cfg.showAkunDibuat)    fields.push({ name: '📅 Akun Dibuat',    value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true });
            if (cfg.showTotalMember)   fields.push({ name: '👥 Total Member',   value: `**${interaction.guild.memberCount}** member`, inline: true });
            if (cfg.showDiundangOleh)  fields.push({ name: '📨 Diundang Oleh',  value: `${member.user.tag} (contoh)`, inline: true });
            if (cfg.showKodeInvite)    fields.push({ name: '🔗 Kode Invite',    value: '`abc123` (contoh)', inline: true });
            if (cfg.showTotalUndangan) fields.push({ name: '📊 Total Undangan', value: '**42** undangan (contoh)', inline: true });
            if (fields.length > 0) embed.addFields(...fields);

            if (cardAttachment) embed.setImage('attachment://welcome-card.png');

            const payload = { embeds: [embed], flags: MessageFlags.Ephemeral };
            if (cardAttachment) payload.files = [cardAttachment];
            return interaction.reply(payload);
        }
    }
}).toJSON();

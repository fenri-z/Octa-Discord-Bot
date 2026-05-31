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
        enabled:      getBool(client, `goodbye-enabled-${guildId}`,      false),
        channelId:    client.database.get(`goodbye-channel-${guildId}`)  ?? null,
        messageType:  client.database.get(`goodbye-messageType-${guildId}`) ?? 'embed',
        plainText:    client.database.get(`goodbye-plainText-${guildId}`)   ?? '',
        title:        client.database.get(`goodbye-title-${guildId}`)    ?? '👋 Selamat Tinggal!',
        description:  client.database.get(`goodbye-description-${guildId}`) ?? '{member} telah meninggalkan server.',
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
        // ── Toggle per-field ────────────────────────────────────────────
        showMember:      getBool(client, `goodbye-showMember-${guildId}`,      false),
        showBergabung:   getBool(client, `goodbye-showBergabung-${guildId}`,   false),
        showAkunDibuat:  getBool(client, `goodbye-showAkunDibuat-${guildId}`,  false),
        showTotalMember: getBool(client, `goodbye-showTotalMember-${guildId}`, false),
    };
}

module.exports = new ApplicationCommand({
    command: {
        name: 'goodbye',
        description: 'Konfigurasi goodbye notification untuk member yang keluar.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            { name: 'status',  description: 'Lihat konfigurasi goodbye saat ini.', type: 1 },
            {
                name: 'toggle',
                description: 'Aktifkan atau nonaktifkan pesan perpisahan.',
                type: 1,
                options: [{ name: 'aktif', description: 'true = nyalakan, false = matikan', type: 5, required: true }]
            },
            {
                name: 'channel',
                description: 'Atur channel tempat pesan perpisahan dikirim.',
                type: 1,
                options: [{ name: 'channel', description: 'Pilih channel teks', type: 3, autocomplete: true, required: true }]
            },
            {
                name: 'tipe',
                description: 'Pilih tipe pesan: embed atau teks biasa.',
                type: 1,
                options: [{ name: 'tipe', description: 'embed = pakai embed, plain = teks biasa', type: 3, required: true,
                    choices: [{ name: '🖼️ Embed', value: 'embed' }, { name: '💬 Teks Biasa', value: 'plain' }] }]
            },
            {
                name: 'teks',
                description: 'Ubah judul & deskripsi embed (mode embed) atau isi teks biasa (mode plain) via modal.',
                type: 1
            },
            {
                name: 'color',
                description: 'Ubah warna embed (hex, contoh: #ED4245).',
                type: 1,
                options: [{ name: 'hex', description: 'Kode warna hex, contoh: #ED4245', type: 3, required: true, max_length: 7 }]
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
                description: 'Aktifkan atau nonaktifkan field info di embed.',
                type: 1,
                options: [
                    {
                        name: 'field',
                        description: 'Pilih field yang ingin diubah',
                        type: 3,
                        required: true,
                        choices: [
                            { name: '👤 Member',       value: 'member'       },
                            { name: '📅 Bergabung',    value: 'bergabung'    },
                            { name: '📅 Akun Dibuat',  value: 'akun_dibuat'  },
                            { name: '👥 Total Member', value: 'total_member' },
                        ]
                    },
                    { name: 'tampil', description: 'true = tampilkan, false = sembunyikan', type: 5, required: true }
                ]
            },
            {
                name: 'card',
                description: 'Konfigurasi goodbye card (gambar perpisahan dengan foto profil).',
                type: 1,
                options: [{
                    name: 'aksi', description: 'Pilih aksi yang ingin dilakukan', type: 3, required: true,
                    choices: [
                        { name: '🔌 Toggle on/off card', value: 'toggle' },
                        { name: '✏️  Ubah teks card',     value: 'teks'   },
                        { name: '🎨 Ubah warna card',     value: 'warna'  },
                    ]
                }]
            },
            { name: 'reset',   description: 'Reset semua pengaturan goodbye ke default.', type: 1 },
            { name: 'preview', description: 'Pratinjau pesan perpisahan dengan pengaturan saat ini.', type: 1 },
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
            const cfg      = getConfig(client, guildId);
            const channel  = cfg.channelId ? interaction.guild.channels.cache.get(cfg.channelId) : null;
            const colorHex = cfg.color.startsWith('#') ? cfg.color : `#${cfg.color}`;
            const on = '✅ Tampil', off = '❌ Disembunyikan';

            const embed = new EmbedBuilder()
                .setColor(colorHex)
                .setTitle('⚙️ Konfigurasi Pesan Perpisahan')
                .addFields(
                    { name: '🔌 Status',      value: cfg.enabled ? '✅ Aktif' : '❌ Nonaktif',                     inline: true },
                    { name: '📨 Tipe Pesan',  value: cfg.messageType === 'plain' ? '💬 Teks Biasa' : '🖼️ Embed', inline: true },
                    { name: '📢 Channel',     value: channel ? `<#${channel.id}>` : '`Belum diatur`',              inline: true },
                    { name: '🎨 Warna',       value: `\`${cfg.color}\``,                                            inline: true },
                    { name: '📌 Judul',       value: `\`${cfg.title}\``,                                            inline: false },
                    { name: '📝 Deskripsi',   value: `\`${cfg.description}\``,                                      inline: false },
                    { name: '💬 Teks Biasa',  value: cfg.plainText ? `\`${cfg.plainText.slice(0,100)}\`` : '`(kosong)`', inline: false },
                    { name: '🃏 Goodbye Card',value: cfg.cardEnabled ? '✅ Aktif' : '❌ Nonaktif',                 inline: true },
                    { name: '🔻 Footer',      value: cfg.footerText ? `\`${cfg.footerText}\`` : '`(tidak ada)`',  inline: false },
                    { name: '🖼️ Thumbnail',   value: cfg.thumbnail ? on : off,        inline: true },
                    { name: '👤 Member',      value: cfg.showMember ? on : off,        inline: true },
                    { name: '📅 Bergabung',   value: cfg.showBergabung ? on : off,     inline: true },
                    { name: '📅 Akun Dibuat', value: cfg.showAkunDibuat ? on : off,    inline: true },
                    { name: '👥 Total Member',value: cfg.showTotalMember ? on : off,   inline: true },
                )
                .setFooter({ text: 'Gunakan /goodbye preview untuk melihat tampilan embed.' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── TOGGLE ────────────────────────────────────────────────────────
        if (sub === 'toggle') {
            const val = interaction.options.getBoolean('aktif');
            setBool(client, `goodbye-enabled-${guildId}`, val);
            return interaction.reply({
                content: val ? '✅ Pesan perpisahan **diaktifkan**.' : '❌ Pesan perpisahan **dinonaktifkan**.',
                flags: MessageFlags.Ephemeral
            });
        }

        // ── CHANNEL ───────────────────────────────────────────────────────
        if (sub === 'channel') {
            const ch = resolveChannel(interaction.guild, interaction.options.getString('channel'));
            if (!ch) return interaction.reply({ content: '❌ Channel tidak ditemukan. Gunakan mention `#channel` atau ID channel.', flags: MessageFlags.Ephemeral });
            const chOk = await checkBotPermissions(interaction, [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], ch);
            if (!chOk) return;
            client.database.set(`goodbye-channel-${guildId}`, ch.id);
            return interaction.reply({ content: `✅ Channel perpisahan diatur ke <#${ch.id}>.`, flags: MessageFlags.Ephemeral });
        }

        // ── TIPE ─────────────────────────────────────────────────────────
        if (sub === 'tipe') {
            const val = interaction.options.getString('tipe');
            client.database.set(`goodbye-messageType-${guildId}`, val);
            return interaction.reply({
                content: val === 'plain'
                    ? '✅ Tipe pesan goodbye diubah ke **Teks Biasa**. Gunakan `/goodbye teks` untuk mengatur isinya.'
                    : '✅ Tipe pesan goodbye diubah ke **Embed**. Gunakan `/goodbye teks` untuk mengatur judul & deskripsinya.',
                flags: MessageFlags.Ephemeral
            });
        }

        // ── TEKS ─────────────────────────────────────────────────────────
        if (sub === 'teks') {
            const cfg     = getConfig(client, guildId);
            const isPlain = cfg.messageType === 'plain';
            const shortId = `${interaction.user.id.slice(-6)}${Date.now().toString(36)}`;
            const modalId = `gteks-${guildId.slice(-8)}-${shortId}`;

            const modal = new ModalBuilder()
                .setCustomId(modalId)
                .setTitle(isPlain ? '✏️ Ubah Teks Biasa Goodbye' : '✏️ Ubah Teks Embed Goodbye');

            if (isPlain) {
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('plainText')
                        .setLabel('Isi Pesan: {member} {server} {count} {tag}')
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
                            .setLabel('Judul: {username} {tag} {server} (bukan mention)')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(256)
                            .setValue(cfg.title.slice(0, 256))
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('description')
                            .setLabel('Deskripsi: {member}=mention {username} {server}')
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
                    content: `✅ Teks biasa goodbye diperbarui.\n**Pesan:** ${newPlain}`,
                    flags: MessageFlags.Ephemeral
                });
            } else {
                const newTitle = submitted.fields.getTextInputValue('title').trim();
                const newDesc  = submitted.fields.getTextInputValue('description').trim();
                client.database.set(`goodbye-title-${guildId}`,       newTitle);
                client.database.set(`goodbye-description-${guildId}`, newDesc);
                return submitted.reply({
                    content: `✅ Teks embed goodbye diperbarui.\n**Judul:** ${newTitle}\n**Deskripsi:** ${newDesc}`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // ── COLOR ─────────────────────────────────────────────────────────
        if (sub === 'color') {
            const val = interaction.options.getString('hex').trim();
            if (!/^#?[0-9A-Fa-f]{6}$/.test(val))
                return interaction.reply({ content: '❌ Format warna tidak valid. Gunakan hex seperti `#ED4245` atau `ED4245`.', flags: MessageFlags.Ephemeral });
            const clean = val.startsWith('#') ? val : `#${val}`;
            client.database.set(`goodbye-color-${guildId}`, clean);
            return interaction.reply({ content: `✅ Warna embed diperbarui ke \`${clean}\`.`, flags: MessageFlags.Ephemeral });
        }

        // ── FOOTER ────────────────────────────────────────────────────────
        if (sub === 'footer') {
            const val = interaction.options.getString('teks').trim();
            if (val === '-') {
                client.database.delete(`goodbye-footer-${guildId}`);
                return interaction.reply({ content: '✅ Footer embed **dihapus**.', flags: MessageFlags.Ephemeral });
            }
            client.database.set(`goodbye-footer-${guildId}`, val);
            return interaction.reply({ content: `✅ Footer embed diperbarui:\n> ${val}`, flags: MessageFlags.Ephemeral });
        }

        // ── THUMBNAIL ─────────────────────────────────────────────────────
        if (sub === 'thumbnail') {
            const val = interaction.options.getBoolean('tampil');
            setBool(client, `goodbye-thumbnail-${guildId}`, val);
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
                member:       { key: `goodbye-showMember-${guildId}`,      label: '👤 Member'       },
                bergabung:    { key: `goodbye-showBergabung-${guildId}`,    label: '📅 Bergabung'    },
                akun_dibuat:  { key: `goodbye-showAkunDibuat-${guildId}`,   label: '📅 Akun Dibuat'  },
                total_member: { key: `goodbye-showTotalMember-${guildId}`,  label: '👥 Total Member' },
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

            if (aksi === 'toggle') {
                const newVal = !cfg.cardEnabled;
                setBool(client, `goodbye-cardEnabled-${guildId}`, newVal);
                return interaction.reply({
                    content: newVal
                        ? '✅ Goodbye card **diaktifkan**. Gambar perpisahan akan dikirim bersama pesan goodbye.'
                        : '❌ Goodbye card **dinonaktifkan**.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (aksi === 'teks') {
                const shortId = `${interaction.user.id.slice(-6)}${Date.now().toString(36)}`;
                const modalId = `gcard-teks-${guildId.slice(-8)}-${shortId}`;
                const modal = new ModalBuilder().setCustomId(modalId).setTitle('✏️ Ubah Teks Goodbye Card');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('welcomeText')
                            .setLabel('Teks besar atas (misal: GOODBYE)')
                            .setStyle(TextInputStyle.Short).setMaxLength(20)
                            .setValue(cfg.cardWelcomeText).setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('subText')
                            .setLabel('Teks kecil bawah: {server} {count} {tag}')
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
                return submitted.reply({ content: '✅ Teks goodbye card diperbarui!', flags: MessageFlags.Ephemeral });
            }

            if (aksi === 'warna') {
                const shortId = `${interaction.user.id.slice(-6)}${Date.now().toString(36)}`;
                const modalId = `gcard-warna-${guildId.slice(-8)}-${shortId}`;
                const modal = new ModalBuilder().setCustomId(modalId).setTitle('🎨 Ubah Warna Goodbye Card');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bgColor').setLabel('Warna latar kiri (hex)').setStyle(TextInputStyle.Short).setMaxLength(7).setValue(cfg.cardBgColor).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bgColor2').setLabel('Warna latar kanan (hex)').setStyle(TextInputStyle.Short).setMaxLength(7).setValue(cfg.cardBgColor2).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('accentColor').setLabel('Warna aksen/border avatar (hex)').setStyle(TextInputStyle.Short).setMaxLength(7).setValue(cfg.cardAccentColor).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('textColor').setLabel('Warna teks utama (hex)').setStyle(TextInputStyle.Short).setMaxLength(7).setValue(cfg.cardTextColor).setRequired(true)),
                );
                await interaction.showModal(modal);
                const submitted = await interaction.awaitModalSubmit({
                    filter: i => i.customId === modalId && i.user.id === interaction.user.id,
                    time: 5 * 60 * 1000
                }).catch(() => null);
                if (!submitted) return;
                const hexRe = /^#[0-9A-Fa-f]{6}$/;
                const colorFields = [
                    { id: 'bgColor',     key: `goodbye-cardBgColor-${guildId}`,   label: 'Latar kiri'  },
                    { id: 'bgColor2',    key: `goodbye-cardBgColor2-${guildId}`,  label: 'Latar kanan' },
                    { id: 'accentColor', key: `goodbye-cardAccent-${guildId}`,    label: 'Aksen'       },
                    { id: 'textColor',   key: `goodbye-cardTextColor-${guildId}`, label: 'Teks utama'  },
                ];
                const errors = [];
                for (const f of colorFields) {
                    const val = submitted.fields.getTextInputValue(f.id).trim();
                    if (!hexRe.test(val)) { errors.push(f.label); continue; }
                    client.database.set(f.key, val);
                }
                if (errors.length > 0) {
                    return submitted.reply({
                        content: `⚠️ Format warna tidak valid untuk: **${errors.join(', ')}**. Field lain yang valid sudah disimpan.`,
                        flags: MessageFlags.Ephemeral
                    });
                }
                return submitted.reply({ content: '✅ Warna goodbye card berhasil diperbarui!', flags: MessageFlags.Ephemeral });
            }
        }

        // ── RESET ─────────────────────────────────────────────────────────
        if (sub === 'reset') {
            ['enabled', 'channel', 'messageType', 'plainText', 'title', 'description', 'color', 'footer', 'thumbnail',
             'cardEnabled', 'cardBgColor', 'cardBgColor2', 'cardAccent', 'cardTextColor', 'cardWelcomeText', 'cardSubText',
             'cardAvatarShape', 'cardBgType', 'cardBgImageUrl', 'cardOverlayColor', 'cardOverlayOpacity',
             'cardTitleColor', 'cardUsernameColor', 'cardMsgColor', 'cardFont',
             'showMember', 'showBergabung', 'showAkunDibuat', 'showTotalMember']
                .forEach(k => client.database.delete(`goodbye-${k}-${guildId}`));
            return interaction.reply({ content: '🔄 Semua pengaturan goodbye telah **direset ke default**.', flags: MessageFlags.Ephemeral });
        }

        // ── PREVIEW ───────────────────────────────────────────────────────
        if (sub === 'preview') {
            const cfg      = getConfig(client, guildId);
            const member   = interaction.member;
            const colorHex = cfg.color.startsWith('#') ? cfg.color : `#${cfg.color}`;

            const displayName     = member.displayName || member.user.username;
            const createdRelative = `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`;

            // Untuk title & footer: {member} → @displayName (mention tidak render di embed title)
            const parseTitle = (str) => str
                .replace(/{member}/g,       `@${displayName}`)
                .replace(/{username}/g,     member.user.username)
                .replace(/{tag}/g,          member.user.tag)
                .replace(/{server}/g,       interaction.guild.name)
                .replace(/{count}/g,        String(interaction.guild.memberCount))
                .replace(/{akun\.dibuat}/g, createdRelative);

            // Untuk description & plain text: {member} → mention <@ID>
            const parse = (str) => str
                .replace(/{member}/g,       `<@${member.id}>`)
                .replace(/{username}/g,     member.user.username)
                .replace(/{tag}/g,          member.user.tag)
                .replace(/{server}/g,       interaction.guild.name)
                .replace(/{count}/g,        String(interaction.guild.memberCount))
                .replace(/{akun\.dibuat}/g, createdRelative);

            // Generate goodbye card
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
                    cardAttachment = new AttachmentBuilder(cardBuf, { name: 'goodbye-card.png' });
                } catch (err) {
                    console.error('[goodbye preview] Card generation failed:', err.message);
                }
            }

            // Mode teks biasa
            if (cfg.messageType === 'plain') {
                let content = parse(cfg.plainText).trim();
                const infoLines = [];
                if (cfg.showMember)      infoLines.push(`👤 **Member:** ${member.user.tag}`);
                if (cfg.showBergabung)   infoLines.push(`📅 **Bergabung:** <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`);
                if (cfg.showAkunDibuat)  infoLines.push(`📅 **Akun Dibuat:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`);
                if (cfg.showTotalMember) infoLines.push(`👥 **Total Member:** ${interaction.guild.memberCount} member`);
                if (infoLines.length > 0) content += (content ? '\n' : '') + infoLines.join('\n');
                content = content.trim();
                if (content || cardAttachment) {
                    const payload = { flags: MessageFlags.Ephemeral };
                    payload.content = `> 👁️ **Mode Pratinjau** — bukan pesan perpisahan sungguhan${content ? '\n' + content : ''}`;
                    if (cardAttachment) payload.files = [cardAttachment];
                    return interaction.reply(payload);
                }
                return interaction.reply({ content: '> 👁️ **Mode Pratinjau** — pesan kosong dan goodbye card tidak aktif.', flags: MessageFlags.Ephemeral });
            }

            // Mode embed
            const hasText   = cfg.title.trim() || cfg.description.trim();
            const hasFields = cfg.showMember || cfg.showBergabung || cfg.showAkunDibuat || cfg.showTotalMember;

            if (!hasText && !hasFields && !cardAttachment) {
                return interaction.reply({ content: '> 👁️ **Mode Pratinjau** — pesan kosong dan goodbye card tidak aktif.', flags: MessageFlags.Ephemeral });
            }

            const embed = new EmbedBuilder()
                .setColor(colorHex)
                .setAuthor({ name: '👁️ Mode Pratinjau — bukan pesan perpisahan sungguhan' })
                .setTimestamp();

            if (parseTitle(cfg.title))  embed.setTitle(parseTitle(cfg.title));
            if (parse(cfg.description)) embed.setDescription(parse(cfg.description));
            if (cfg.footerText)         embed.setFooter({ text: parseTitle(cfg.footerText) });
            if (cfg.thumbnail)          embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));

            const fields = [];
            if (cfg.showMember)      fields.push({ name: '👤 Member',       value: member.user.tag, inline: true });
            if (cfg.showBergabung)   fields.push({ name: '📅 Bergabung',    value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '`Tidak diketahui`', inline: true });
            if (cfg.showAkunDibuat)  fields.push({ name: '📅 Akun Dibuat',  value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true });
            if (cfg.showTotalMember) fields.push({ name: '👥 Total Member', value: `**${interaction.guild.memberCount}** member`, inline: true });
            if (fields.length > 0) embed.addFields(...fields);
            if (cardAttachment) embed.setImage('attachment://goodbye-card.png');

            const payload = { embeds: [embed], flags: MessageFlags.Ephemeral };
            if (cardAttachment) payload.files = [cardAttachment];
            return interaction.reply(payload);
        }
    }
}).toJSON();

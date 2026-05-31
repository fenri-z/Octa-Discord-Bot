const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { resolveChannel } = require('../../utils/resolveGuildOption');
const { checkBotPermissions } = require('../../utils/checkBotPermissions');

// ─────────────────────────────────────────────────────────────────────────────
// KONSTANTA KATEGORI
// ─────────────────────────────────────────────────────────────────────────────

const KATEGORI = {
    UNIK:  'unik',   // Hanya bisa dikirim sekali, bisa diedit, tidak bisa dihapus via command
    BIASA: 'biasa',  // Bisa dikirim berkali-kali, tidak bisa diedit/dihapus via command
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — Template
// ─────────────────────────────────────────────────────────────────────────────

function isValidName(name) {
    return /^[a-zA-Z0-9_-]{1,32}$/.test(name);
}

function getList(client, guildId) {
    const raw = client.database.get(`pesan-list-${guildId}`);
    if (!raw || typeof raw !== 'string') return [];
    try { return JSON.parse(raw); } catch { return []; }
}

function saveList(client, guildId, list) {
    client.database.set(`pesan-list-${guildId}`, JSON.stringify(list));
}

function addToList(client, guildId, name) {
    const list = getList(client, guildId);
    if (!list.includes(name)) { list.push(name); saveList(client, guildId, list); }
}

function removeFromList(client, guildId, name) {
    saveList(client, guildId, getList(client, guildId).filter(n => n !== name));
}

function getTemplate(client, guildId, name) {
    const raw = client.database.get(`pesan-${guildId}-${name}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function saveTemplate(client, guildId, name, data) {
    client.database.set(`pesan-${guildId}-${name}`, JSON.stringify(data));
    addToList(client, guildId, name);
}

function deleteTemplate(client, guildId, name) {
    client.database.delete(`pesan-${guildId}-${name}`);
    removeFromList(client, guildId, name);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — Pesan Unik yang Terkirim
// key: pesan-unik-sent-${guildId}-${nama} → { messageId, channelId }
// ─────────────────────────────────────────────────────────────────────────────

function getSentUnik(client, guildId, nama) {
    const raw = client.database.get(`pesan-unik-sent-${guildId}-${nama}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function saveSentUnik(client, guildId, nama, messageId, channelId) {
    client.database.set(`pesan-unik-sent-${guildId}-${nama}`, JSON.stringify({ messageId, channelId }));
}

function deleteSentUnik(client, guildId, nama) {
    client.database.delete(`pesan-unik-sent-${guildId}-${nama}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — Embed Builder
// ─────────────────────────────────────────────────────────────────────────────

function buildEmbed(data) {
    const embed = new EmbedBuilder();
    const colorHex = data.color && /^#?[0-9A-Fa-f]{6}$/.test(data.color.trim())
        ? (data.color.startsWith('#') ? data.color : `#${data.color}`)
        : '#5865F2';
    embed.setColor(colorHex);
    if (data.title)       embed.setTitle(data.title.slice(0, 256));
    if (data.description) embed.setDescription(data.description.slice(0, 4096));
    if (data.footer)      embed.setFooter({ text: data.footer.slice(0, 2048) });
    if (data.image)       embed.setImage(data.image);
    if (data.thumbnail)   embed.setThumbnail(data.thumbnail);
    if (data.authorName)  embed.setAuthor({
        name:    data.authorName.slice(0, 256),
        iconURL: data.authorIcon || undefined
    });
    return embed;
}

// Badge label kategori untuk tampilan list/info
function badgeKategori(kategori) {
    return kategori === KATEGORI.UNIK ? '🔒 Unik' : '📄 Biasa';
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND
// ─────────────────────────────────────────────────────────────────────────────

module.exports = new ApplicationCommand({
    command: {
        name: 'pesan',
        description: 'Kelola template pesan embed kustom.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            // ── Buat / edit template ─────────────────────────────────────
            {
                name: 'buat',
                description: 'Buat atau edit template pesan lewat form.',
                type: 1,
                options: [
                    {
                        name: 'nama',
                        description: 'Nama template (huruf, angka, - dan _, maks. 32 karakter)',
                        type: 3, required: true, max_length: 32, autocomplete: true
                    },
                    {
                        name: 'kategori',
                        description: 'Kategori template: unik (kirim sekali, bisa diedit) atau biasa (kirim berkali-kali)',
                        type: 3, required: false,
                        choices: [
                            { name: '🔒 Unik — kirim sekali, bisa diedit', value: KATEGORI.UNIK  },
                            { name: '📄 Biasa — kirim berkali-kali',        value: KATEGORI.BIASA },
                        ]
                    }
                ]
            },

            // ── Set warna ────────────────────────────────────────────────
            {
                name: 'set-warna',
                description: 'Ubah warna garis kiri embed.',
                type: 1,
                options: [
                    { name: 'nama', description: 'Nama template', type: 3, required: true, max_length: 32, autocomplete: true },
                    { name: 'hex',  description: 'Kode hex, contoh: #FF5733', type: 3, required: true, max_length: 7 }
                ]
            },

            // ── Set gambar ───────────────────────────────────────────────
            {
                name: 'set-gambar',
                description: 'Pasang gambar besar di bawah embed. Ketik "-" untuk hapus.',
                type: 1,
                options: [
                    { name: 'nama', description: 'Nama template', type: 3, required: true, max_length: 32, autocomplete: true },
                    { name: 'url',  description: 'URL gambar (https://...) atau "-" untuk hapus', type: 3, required: true }
                ]
            },

            // ── Set thumbnail ────────────────────────────────────────────
            {
                name: 'set-thumbnail',
                description: 'Pasang gambar kecil di pojok kanan embed. Ketik "-" untuk hapus.',
                type: 1,
                options: [
                    { name: 'nama', description: 'Nama template', type: 3, required: true, max_length: 32, autocomplete: true },
                    { name: 'url',  description: 'URL gambar (https://...) atau "-" untuk hapus', type: 3, required: true }
                ]
            },

            // ── Set author ───────────────────────────────────────────────
            {
                name: 'set-author',
                description: 'Atur nama author. Ketik "-" untuk hapus.',
                type: 1,
                options: [
                    { name: 'nama',   description: 'Nama template', type: 3, required: true, max_length: 32, autocomplete: true },
                    { name: 'author', description: 'Nama author, atau "-" untuk hapus', type: 3, required: true, max_length: 256 },
                    { name: 'ikon',   description: 'URL ikon author (opsional)', type: 3, required: false }
                ]
            },

            // ── Tipe pesan ───────────────────────────────────────────────
            {
                name: 'tipe',
                description: 'Ubah tipe pesan template: embed atau teks biasa.',
                type: 1,
                options: [
                    { name: 'nama', description: 'Nama template', type: 3, required: true, max_length: 32, autocomplete: true },
                    {
                        name: 'tipe',
                        description: 'Pilih tipe pesan',
                        type: 3, required: true,
                        choices: [
                            { name: '🖼️ Embed — pesan dalam kotak dengan warna', value: 'embed' },
                            { name: '💬 Teks Biasa — teks tanpa kotak embed',    value: 'plain' },
                        ]
                    }
                ]
            },

            // ── Preview ──────────────────────────────────────────────────
            {
                name: 'preview',
                description: 'Pratinjau pesan (hanya terlihat olehmu).',
                type: 1,
                options: [
                    { name: 'nama', description: 'Nama template', type: 3, required: true, max_length: 32, autocomplete: true }
                ]
            },

            // ── Info ─────────────────────────────────────────────────────
            {
                name: 'info',
                description: 'Lihat detail isi template dalam bentuk teks.',
                type: 1,
                options: [
                    { name: 'nama', description: 'Nama template', type: 3, required: true, max_length: 32, autocomplete: true }
                ]
            },

            // ── List ─────────────────────────────────────────────────────
            {
                name: 'list',
                description: 'Tampilkan semua template yang tersimpan.',
                type: 1
            },

            // ── Kirim ────────────────────────────────────────────────────
            {
                name: 'kirim',
                description: 'Kirim embed ke channel yang dipilih.',
                type: 1,
                options: [
                    { name: 'nama',    description: 'Nama template', type: 3, required: true, max_length: 32, autocomplete: true },
                    { name: 'channel', description: 'Channel tujuan (mention #channel atau ID)', type: 3, required: true, autocomplete: true }
                ]
            },

            // ── Edit (khusus template unik) ──────────────────────────────
            {
                name: 'edit',
                description: 'Edit isi pesan unik yang sudah terkirim menggunakan template terbaru.',
                type: 1,
                options: [
                    { name: 'nama', description: 'Nama template unik', type: 3, required: true, max_length: 32, autocomplete: true }
                ]
            },

            // ── Salin ────────────────────────────────────────────────────
            {
                name: 'salin',
                description: 'Duplikasi template dengan nama baru.',
                type: 1,
                options: [
                    { name: 'sumber', description: 'Nama template yang akan disalin', type: 3, required: true, max_length: 32, autocomplete: true },
                    { name: 'tujuan', description: 'Nama template baru (belum dipakai)', type: 3, required: true, max_length: 32, autocomplete: true }
                ]
            },

            // ── Hapus template ───────────────────────────────────────────
            {
                name: 'hapus',
                description: 'Hapus template pesan secara permanen.',
                type: 1,
                options: [
                    { name: 'nama', description: 'Nama template yang akan dihapus', type: 3, required: true, max_length: 32, autocomplete: true }
                ]
            },
        ]
    },
    options: {
        cooldown: 3000
    },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const sub     = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        const userId  = interaction.user.id;

        // ── Cek permission bot ────────────────────────────────────────────
        const ok = await checkBotPermissions(interaction, [
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ReadMessageHistory,
        ]);
        if (!ok) return;

        // ── BUAT ──────────────────────────────────────────────────────────
        if (sub === 'buat') {
            const nama      = interaction.options.getString('nama').trim().toLowerCase();
            const katInput  = interaction.options.getString('kategori');
            const existing  = getTemplate(client, guildId, nama);

            if (!isValidName(nama)) {
                return interaction.reply({
                    content: '❌ Nama template tidak valid. Gunakan hanya huruf, angka, `-` dan `_` (maks. 32 karakter).',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Tentukan kategori:
            // - Jika template baru dan kategori dipilih → gunakan pilihan
            // - Jika template baru dan kategori tidak dipilih → default biasa
            // - Jika template sudah ada dan kategori dipilih → update kategori
            // - Jika template sudah ada dan kategori tidak dipilih → pertahankan kategori lama
            const kategori = katInput
                ? katInput
                : (existing?.kategori ?? KATEGORI.BIASA);

            // Jika mengubah kategori dari unik ke biasa saat sudah pernah terkirim → tolak
            if (existing?.kategori === KATEGORI.UNIK && katInput === KATEGORI.BIASA) {
                const sent = getSentUnik(client, guildId, nama);
                if (sent) {
                    return interaction.reply({
                        content: `❌ Template \`${nama}\` adalah pesan unik yang sudah terkirim. Tidak bisa diubah ke kategori biasa.\nHapus template dulu jika ingin membuat ulang.`,
                        flags: MessageFlags.Ephemeral
                    });
                }
            }

            // Simpan pending (nama + kategori) untuk modal handler
            client.database.set(`pesan-pending-${guildId}-${userId}`, JSON.stringify({ nama, kategori }));

            await interaction.showModal({
                custom_id: `pesan-modal:${nama}:buat`,
                title: `[${kategori.toUpperCase()}] ${nama}`.slice(0, 45),
                components: [
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'pesan-field-title',
                            label: 'Judul (maks. 256 karakter)', style: 1,
                            placeholder: 'Masukkan judul embed...',
                            value: existing?.title || '', required: false, max_length: 256
                        }]
                    },
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'pesan-field-description',
                            label: 'Deskripsi (maks. 4096 karakter)', style: 2,
                            placeholder: 'Masukkan isi embed...',
                            value: existing?.description || '', required: false, max_length: 4000
                        }]
                    },
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'pesan-field-footer',
                            label: 'Footer (maks. 2048 karakter)', style: 1,
                            placeholder: 'Teks di bagian bawah embed...',
                            value: existing?.footer || '', required: false, max_length: 2048
                        }]
                    }
                ]
            });
            return;
        }

        // ── SET-WARNA ─────────────────────────────────────────────────────
        if (sub === 'set-warna') {
            const nama = interaction.options.getString('nama').trim().toLowerCase();
            const hex  = interaction.options.getString('hex').trim();
            const tmpl = getTemplate(client, guildId, nama);
            if (!tmpl) return interaction.reply({ content: `❌ Template \`${nama}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            if (!/^#?[0-9A-Fa-f]{6}$/.test(hex)) return interaction.reply({ content: '❌ Format warna tidak valid. Contoh: `#FF5733` atau `FF5733`.', flags: MessageFlags.Ephemeral });
            tmpl.color = hex.startsWith('#') ? hex : `#${hex}`;
            tmpl.updatedAt = Date.now();
            saveTemplate(client, guildId, nama, tmpl);
            return interaction.reply({ content: `✅ Warna template \`${nama}\` diperbarui ke \`${tmpl.color}\`.`, flags: MessageFlags.Ephemeral });
        }

        // ── SET-GAMBAR ────────────────────────────────────────────────────
        if (sub === 'set-gambar') {
            const nama = interaction.options.getString('nama').trim().toLowerCase();
            const url  = interaction.options.getString('url').trim();
            const tmpl = getTemplate(client, guildId, nama);
            if (!tmpl) return interaction.reply({ content: `❌ Template \`${nama}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            if (url === '-') {
                tmpl.image = ''; tmpl.updatedAt = Date.now();
                saveTemplate(client, guildId, nama, tmpl);
                return interaction.reply({ content: `✅ Gambar template \`${nama}\` **dihapus**.`, flags: MessageFlags.Ephemeral });
            }
            if (!/^https?:\/\/.+\..+/.test(url)) return interaction.reply({ content: '❌ URL tidak valid. Harus dimulai dengan `https://`.', flags: MessageFlags.Ephemeral });
            tmpl.image = url; tmpl.updatedAt = Date.now();
            saveTemplate(client, guildId, nama, tmpl);
            return interaction.reply({ content: `✅ Gambar template \`${nama}\` diperbarui.`, flags: MessageFlags.Ephemeral });
        }

        // ── SET-THUMBNAIL ─────────────────────────────────────────────────
        if (sub === 'set-thumbnail') {
            const nama = interaction.options.getString('nama').trim().toLowerCase();
            const url  = interaction.options.getString('url').trim();
            const tmpl = getTemplate(client, guildId, nama);
            if (!tmpl) return interaction.reply({ content: `❌ Template \`${nama}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            if (url === '-') {
                tmpl.thumbnail = ''; tmpl.updatedAt = Date.now();
                saveTemplate(client, guildId, nama, tmpl);
                return interaction.reply({ content: `✅ Thumbnail template \`${nama}\` **dihapus**.`, flags: MessageFlags.Ephemeral });
            }
            if (!/^https?:\/\/.+\..+/.test(url)) return interaction.reply({ content: '❌ URL tidak valid. Harus dimulai dengan `https://`.', flags: MessageFlags.Ephemeral });
            tmpl.thumbnail = url; tmpl.updatedAt = Date.now();
            saveTemplate(client, guildId, nama, tmpl);
            return interaction.reply({ content: `✅ Thumbnail template \`${nama}\` diperbarui.`, flags: MessageFlags.Ephemeral });
        }

        // ── SET-AUTHOR ────────────────────────────────────────────────────
        if (sub === 'set-author') {
            const nama   = interaction.options.getString('nama').trim().toLowerCase();
            const author = interaction.options.getString('author').trim();
            const ikon   = interaction.options.getString('ikon')?.trim() || '';
            const tmpl   = getTemplate(client, guildId, nama);
            if (!tmpl) return interaction.reply({ content: `❌ Template \`${nama}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            if (ikon && !/^https?:\/\/.+\..+/.test(ikon)) return interaction.reply({ content: '❌ URL ikon tidak valid.', flags: MessageFlags.Ephemeral });
            if (author === '-') {
                tmpl.authorName = ''; tmpl.authorIcon = ''; tmpl.updatedAt = Date.now();
                saveTemplate(client, guildId, nama, tmpl);
                return interaction.reply({ content: `✅ Author template \`${nama}\` **dihapus**.`, flags: MessageFlags.Ephemeral });
            }
            tmpl.authorName = author; tmpl.authorIcon = ikon; tmpl.updatedAt = Date.now();
            saveTemplate(client, guildId, nama, tmpl);
            return interaction.reply({ content: `✅ Author template \`${nama}\` diperbarui ke **${author}**.`, flags: MessageFlags.Ephemeral });
        }

        // ── TIPE ──────────────────────────────────────────────────────────
        if (sub === 'tipe') {
            const nama  = interaction.options.getString('nama').trim().toLowerCase();
            const tipe  = interaction.options.getString('tipe'); // 'embed' | 'plain'
            const tmpl  = getTemplate(client, guildId, nama);
            if (!tmpl) return interaction.reply({ content: `❌ Template \`${nama}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });

            if (tipe === 'embed') {
                tmpl.messageType = 'embed';
                tmpl.updatedAt   = Date.now();
                saveTemplate(client, guildId, nama, tmpl);
                return interaction.reply({
                    content: `✅ Template \`${nama}\` diubah ke tipe **Embed**.\nGunakan \`/pesan buat ${nama}\` untuk mengisi judul & deskripsi.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // plain → buka modal untuk isi teks
            client.database.set(`pesan-pending-${guildId}-${userId}`, JSON.stringify({ nama, kategori: tmpl.kategori ?? KATEGORI.BIASA, mode: 'tipe' }));
            await interaction.showModal({
                custom_id: `pesan-modal:${nama}:tipe`,
                title: `[PLAIN] Isi Teks: ${nama}`.slice(0, 45),
                components: [
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'pesan-field-plaintext',
                            label: 'Isi Pesan Teks Biasa (maks. 2000 karakter)', style: 2,
                            placeholder: 'Halo semua, ini adalah pengumuman!',
                            value: tmpl.plainText || '', required: false, max_length: 2000
                        }]
                    }
                ]
            });
            return;
        }

        // ── PREVIEW ───────────────────────────────────────────────────────
        if (sub === 'preview') {
            const nama = interaction.options.getString('nama').trim().toLowerCase();
            const tmpl = getTemplate(client, guildId, nama);
            if (!tmpl) return interaction.reply({ content: `❌ Template \`${nama}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });

            if (tmpl.messageType === 'plain') {
                const plainText = (tmpl.plainText || '').trim();
                if (!plainText) return interaction.reply({ content: `⚠️ Template \`${nama}\` (teks biasa) masih kosong. Isi dengan \`/pesan tipe ${nama} tipe:plain\`.`, flags: MessageFlags.Ephemeral });
                const previewEmbed = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setAuthor({ name: `👁️ Pratinjau [💬 Plain] [${badgeKategori(tmpl.kategori)}]: ${nama}` })
                    .setDescription(`\`\`\`\n${plainText.slice(0, 4000)}\`\`\``)
                    .setFooter({ text: 'Pesan di Discord akan tampil sebagai teks biasa (tanpa kotak embed)' });
                return interaction.reply({ embeds: [previewEmbed], flags: MessageFlags.Ephemeral });
            }

            if (!tmpl.title && !tmpl.description) return interaction.reply({ content: `⚠️ Template \`${nama}\` masih kosong.`, flags: MessageFlags.Ephemeral });
            const embed = buildEmbed(tmpl);
            embed.setAuthor({ name: `👁️ Pratinjau [🖼️ Embed] [${badgeKategori(tmpl.kategori)}]: ${nama}` });
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── INFO ──────────────────────────────────────────────────────────
        if (sub === 'info') {
            const nama = interaction.options.getString('nama').trim().toLowerCase();
            const tmpl = getTemplate(client, guildId, nama);
            if (!tmpl) return interaction.reply({ content: `❌ Template \`${nama}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });

            const colorHex = (tmpl.color || '#5865F2').startsWith('#') ? (tmpl.color || '#5865F2') : `#${tmpl.color}`;
            const isPlainInfo = tmpl.messageType === 'plain';
            const desc = isPlainInfo
                ? (tmpl.plainText ? tmpl.plainText.slice(0, 80) + (tmpl.plainText.length > 80 ? '…' : '') : '`(kosong)`')
                : (tmpl.description ? tmpl.description.slice(0, 80) + (tmpl.description.length > 80 ? '…' : '') : '`(kosong)`');

            // Info tambahan untuk pesan unik: apakah sudah terkirim?
            const sentInfo = tmpl.kategori === KATEGORI.UNIK
                ? (() => {
                    const sent = getSentUnik(client, guildId, nama);
                    return sent
                        ? `✅ Sudah terkirim — [Lihat pesan](https://discord.com/channels/${guildId}/${sent.channelId}/${sent.messageId})`
                        : '⏳ Belum pernah dikirim';
                })()
                : null;

            const embed = new EmbedBuilder()
                .setColor(colorHex)
                .setTitle(`📋 Info Template: ${nama}`)
                .addFields(
                    { name: '🏷️ Kategori',   value: badgeKategori(tmpl.kategori ?? KATEGORI.BIASA), inline: true },
                    { name: '📨 Tipe',        value: isPlainInfo ? '💬 Teks Biasa' : '🖼️ Embed', inline: true },
                    { name: '📌 Judul',       value: isPlainInfo ? '`(tidak berlaku)`' : (tmpl.title || '`(kosong)`'), inline: true },
                    ...(!isPlainInfo ? [
                        { name: '🎨 Warna',   value: `\`${tmpl.color || '#5865F2'}\``, inline: true },
                        { name: '✍️ Author',  value: tmpl.authorName || '`(kosong)`',   inline: true },
                        { name: '🖼️ Gambar',  value: tmpl.image ? '✅ Ada' : '`(kosong)`', inline: true },
                        { name: '📌 Thumbnail', value: tmpl.thumbnail ? '✅ Ada' : '`(kosong)`', inline: true },
                    ] : []),
                    { name: isPlainInfo ? '💬 Isi Pesan' : '📝 Deskripsi', value: desc, inline: false },
                    ...(!isPlainInfo ? [{ name: '🔻 Footer', value: tmpl.footer || '`(kosong)`', inline: true }] : []),
                    ...(sentInfo ? [{ name: '📨 Status Kirim', value: sentInfo, inline: false }] : []),
                )
                .setFooter({ text: `Dibuat: ${new Date(tmpl.createdAt).toLocaleString('id-ID')} · Diedit: ${new Date(tmpl.updatedAt).toLocaleString('id-ID')}` })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── LIST ──────────────────────────────────────────────────────────
        if (sub === 'list') {
            const list = getList(client, guildId);
            if (list.length === 0) return interaction.reply({ content: '📭 Belum ada template pesan. Buat dengan `/pesan buat <nama>`.', flags: MessageFlags.Ephemeral });

            const unikList  = [];
            const biasaList = [];

            for (const name of list) {
                const tmpl    = getTemplate(client, guildId, name);
                const isPlainL = tmpl?.messageType === 'plain';
                const preview = isPlainL
                    ? (tmpl?.plainText?.slice(0, 40) || '*(kosong)*')
                    : (tmpl?.title || tmpl?.description?.slice(0, 40) || '*(kosong)*');
                const typeBadge = isPlainL ? '💬' : '🖼️';
                const entry   = `${typeBadge} **${name}** — ${preview}`;
                if ((tmpl?.kategori ?? KATEGORI.BIASA) === KATEGORI.UNIK) {
                    const sent = getSentUnik(client, guildId, name);
                    unikList.push(`${entry} ${sent ? '📨' : '⏳'}`);
                } else {
                    biasaList.push(entry);
                }
            }

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle(`📚 Daftar Template Pesan (${list.length})`)
                .setFooter({ text: '📨 = sudah terkirim · ⏳ = belum dikirim · /pesan preview <nama> untuk lihat tampilan' })
                .setTimestamp();

            if (unikList.length > 0)  embed.addFields({ name: `🔒 Unik (${unikList.length})`,  value: unikList.map((e, i)  => `\`${String(i+1).padStart(2,'0')}.\` ${e}`).join('\n') });
            if (biasaList.length > 0) embed.addFields({ name: `📄 Biasa (${biasaList.length})`, value: biasaList.map((e, i) => `\`${String(i+1).padStart(2,'0')}.\` ${e}`).join('\n') });

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── KIRIM ─────────────────────────────────────────────────────────
        if (sub === 'kirim') {
            const nama          = interaction.options.getString('nama').trim().toLowerCase();
            const chInput       = interaction.options.getString('channel');
            const targetChannel = resolveChannel(interaction.guild, chInput);

            if (!targetChannel) return interaction.reply({ content: '❌ Channel tidak ditemukan.', flags: MessageFlags.Ephemeral });

            const tmpl = getTemplate(client, guildId, nama);
            if (!tmpl) return interaction.reply({ content: `❌ Template \`${nama}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });

            const isPlainType = tmpl.messageType === 'plain';
            if (isPlainType) {
                if (!(tmpl.plainText || '').trim()) return interaction.reply({ content: `⚠️ Template \`${nama}\` (teks biasa) masih kosong. Isi dengan \`/pesan tipe ${nama} tipe:plain\`.`, flags: MessageFlags.Ephemeral });
            } else {
                if (!tmpl.title && !tmpl.description) return interaction.reply({ content: `⚠️ Template \`${nama}\` masih kosong.`, flags: MessageFlags.Ephemeral });
            }

            const kategori = tmpl.kategori ?? KATEGORI.BIASA;

            // ── Pesan unik: cek apakah sudah pernah dikirim ────────────────
            if (kategori === KATEGORI.UNIK) {
                const sent = getSentUnik(client, guildId, nama);
                if (sent) {
                    // Verifikasi apakah pesan Discord-nya masih ada
                    const sentChannel = interaction.guild.channels.cache.get(sent.channelId)
                        ?? await interaction.guild.channels.fetch(sent.channelId).catch(() => null);

                    let messageStillExists = false;
                    if (sentChannel) {
                        try {
                            await sentChannel.messages.fetch(sent.messageId);
                            messageStillExists = true;
                        } catch {
                            // Pesan sudah dihapus manual — reset sentData
                            messageStillExists = false;
                        }
                    }

                    if (!messageStillExists) {
                        // Reset sentData agar bisa dikirim ulang
                        deleteSentUnik(client, guildId, nama);
                        // Lanjut ke pengiriman di bawah
                    } else {
                        return interaction.reply({
                            content: `❌ Template \`${nama}\` adalah pesan unik yang sudah terkirim.\nGunakan \`/pesan edit ${nama}\` untuk memperbarui isinya.\n🔗 https://discord.com/channels/${guildId}/${sent.channelId}/${sent.messageId}`,
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }
            }

            const permsNeeded = [PermissionFlagsBits.SendMessages];
            if (!isPlainType) permsNeeded.push(PermissionFlagsBits.EmbedLinks);
            const chPermsOk = await checkBotPermissions(interaction, permsNeeded, targetChannel);
            if (!chPermsOk) return;

            let sent;
            if (isPlainType) {
                sent = await targetChannel.send({ content: tmpl.plainText.slice(0, 2000) });
            } else {
                const embed = buildEmbed(tmpl);
                sent = await targetChannel.send({ embeds: [embed] });
            }

            // ── Simpan referensi pesan unik ────────────────────────────────
            if (kategori === KATEGORI.UNIK) {
                saveSentUnik(client, guildId, nama, sent.id, targetChannel.id);
            }

            return interaction.reply({
                content: `✅ Template \`${nama}\` berhasil dikirim ke <#${targetChannel.id}>!\n🔗 [Lihat pesan](${sent.url})`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── EDIT (khusus pesan unik) — buka modal dulu ───────────────────
        if (sub === 'edit') {
            const nama = interaction.options.getString('nama').trim().toLowerCase();
            const tmpl = getTemplate(client, guildId, nama);

            if (!tmpl) return interaction.reply({ content: `❌ Template \`${nama}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });

            if ((tmpl.kategori ?? KATEGORI.BIASA) !== KATEGORI.UNIK) {
                return interaction.reply({
                    content: `❌ Template \`${nama}\` adalah pesan **biasa** — tidak bisa diedit via command.\nHanya pesan dengan kategori 🔒 **Unik** yang bisa diedit.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const sentData = getSentUnik(client, guildId, nama);
            if (!sentData) {
                return interaction.reply({
                    content: `⚠️ Template \`${nama}\` belum pernah dikirim. Kirim dulu dengan \`/pesan kirim ${nama}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // Verifikasi pesan masih ada sebelum buka modal
            const targetChannel = interaction.guild.channels.cache.get(sentData.channelId)
                ?? await interaction.guild.channels.fetch(sentData.channelId).catch(() => null);

            if (!targetChannel) {
                deleteSentUnik(client, guildId, nama);
                return interaction.reply({
                    content: `❌ Channel tempat pesan dikirim tidak ditemukan. Data direset — kamu bisa kirim ulang dengan \`/pesan kirim ${nama}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            try {
                await targetChannel.messages.fetch(sentData.messageId);
            } catch {
                deleteSentUnik(client, guildId, nama);
                return interaction.reply({
                    content: `❌ Pesan unik \`${nama}\` tidak ditemukan (mungkin sudah dihapus manual). Data direset — kamu bisa kirim ulang dengan \`/pesan kirim ${nama}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // Simpan pending dengan mode 'edit' agar modal handler tahu harus update pesan Discord
            client.database.set(
                `pesan-pending-${guildId}-${userId}`,
                JSON.stringify({ nama, kategori: KATEGORI.UNIK, mode: 'edit' })
            );

            // Buka modal sesuai tipe template
            if (tmpl.messageType === 'plain') {
                await interaction.showModal({
                    custom_id: `pesan-modal:${nama}:edit`,
                    title: `[EDIT PLAIN] ${nama}`.slice(0, 45),
                    components: [
                        {
                            type: 1,
                            components: [{
                                type: 4, custom_id: 'pesan-field-plaintext',
                                label: 'Isi Pesan Teks Biasa (maks. 2000 karakter)', style: 2,
                                placeholder: 'Halo semua, ini adalah pengumuman!',
                                value: tmpl.plainText || '', required: false, max_length: 2000
                            }]
                        }
                    ]
                });
            } else {
                await interaction.showModal({
                    custom_id: `pesan-modal:${nama}:edit`,
                    title: `[EDIT UNIK] ${nama}`.slice(0, 45),
                    components: [
                        {
                            type: 1,
                            components: [{
                                type: 4, custom_id: 'pesan-field-title',
                                label: 'Judul (maks. 256 karakter)', style: 1,
                                placeholder: 'Masukkan judul embed...',
                                value: tmpl.title || '', required: false, max_length: 256
                            }]
                        },
                        {
                            type: 1,
                            components: [{
                                type: 4, custom_id: 'pesan-field-description',
                                label: 'Deskripsi (maks. 4096 karakter)', style: 2,
                                placeholder: 'Masukkan isi embed...',
                                value: tmpl.description || '', required: false, max_length: 4000
                            }]
                        },
                        {
                            type: 1,
                            components: [{
                                type: 4, custom_id: 'pesan-field-footer',
                                label: 'Footer (maks. 2048 karakter)', style: 1,
                                placeholder: 'Teks di bagian bawah embed...',
                                value: tmpl.footer || '', required: false, max_length: 2048
                            }]
                        }
                    ]
                });
            }
            return;
        }

        // ── SALIN ─────────────────────────────────────────────────────────
        if (sub === 'salin') {
            const sumber = interaction.options.getString('sumber').trim().toLowerCase();
            const tujuan = interaction.options.getString('tujuan').trim().toLowerCase();
            if (!isValidName(tujuan)) return interaction.reply({ content: '❌ Nama template tujuan tidak valid.', flags: MessageFlags.Ephemeral });
            const tmpl = getTemplate(client, guildId, sumber);
            if (!tmpl) return interaction.reply({ content: `❌ Template \`${sumber}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            if (getTemplate(client, guildId, tujuan)) return interaction.reply({ content: `❌ Template \`${tujuan}\` sudah ada.`, flags: MessageFlags.Ephemeral });

            // Salin selalu menghasilkan template BIASA (tidak mewarisi status unik + sent data)
            saveTemplate(client, guildId, tujuan, {
                ...tmpl,
                kategori:  KATEGORI.BIASA,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
            return interaction.reply({
                content: `✅ Template \`${sumber}\` berhasil disalin ke \`${tujuan}\`.\n💡 Kategori hasil salinan diatur ke **Biasa**. Ubah lewat \`/pesan buat ${tujuan} kategori:unik\` jika perlu.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── HAPUS ─────────────────────────────────────────────────────────
        if (sub === 'hapus') {
            const nama = interaction.options.getString('nama').trim().toLowerCase();
            const tmpl = getTemplate(client, guildId, nama);
            if (!tmpl) return interaction.reply({ content: `❌ Template \`${nama}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });

            deleteTemplate(client, guildId, nama);
            deleteSentUnik(client, guildId, nama); // bersihkan data sent jika ada

            // Cascade: hapus panel autorole-button yang terhubung
            let deletedPanels = [];
            try {
                const rawList   = client.database.get(`autobtn-list-${guildId}`);
                const panelList = rawList ? JSON.parse(rawList) : [];
                const remaining = [];
                for (const panelName of panelList) {
                    const rawPanel = client.database.get(`autobtn-${guildId}-${panelName}`);
                    if (!rawPanel) continue;
                    const panel = JSON.parse(rawPanel);
                    if (panel.templateName === nama) {
                        client.database.delete(`autobtn-${guildId}-${panelName}`);
                        deletedPanels.push(panelName);
                    } else {
                        remaining.push(panelName);
                    }
                }
                if (deletedPanels.length > 0) {
                    client.database.set(`autobtn-list-${guildId}`, JSON.stringify(remaining));
                }
            } catch { /* abaikan error cascade */ }

            const cascadeInfo = deletedPanels.length > 0
                ? `\n🗑️ Panel autorole-button ikut dihapus: ${deletedPanels.map(n => `\`${n}\``).join(', ')}`
                : '';

            return interaction.reply({
                content: `🗑️ Template \`${nama}\` berhasil dihapus.${cascadeInfo}`,
                flags: MessageFlags.Ephemeral
            });
        }
    }
}).toJSON();

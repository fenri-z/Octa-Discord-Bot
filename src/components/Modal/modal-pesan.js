const { ModalSubmitInteraction, EmbedBuilder, MessageFlags } = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");

const KATEGORI = { UNIK: 'unik', BIASA: 'biasa' };

function buildEmbed(data) {
    const { EmbedBuilder } = require('discord.js');
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

module.exports = new Component({
    customId: 'pesan-modal',  // prefix match: pesan-modal:nama:mode
    type: 'modal',

    /**
     * @param {DiscordBot} client
     * @param {ModalSubmitInteraction} interaction
     */
    run: async (client, interaction) => {
        const guildId = interaction.guild.id;
        const userId  = interaction.user.id;

        // Baca pending data { nama, kategori, mode? }
        const rawPending = client.database.get(`pesan-pending-${guildId}-${userId}`);
        if (!rawPending) {
            return interaction.reply({
                content: '❌ Sesi expired. Jalankan perintahnya lagi.',
                flags: MessageFlags.Ephemeral
            });
        }

        client.database.delete(`pesan-pending-${guildId}-${userId}`);

        let pending;
        try { pending = JSON.parse(rawPending); } catch {
            // Kompatibilitas mundur: value lama berupa string nama saja
            pending = { nama: rawPending, kategori: KATEGORI.BIASA, mode: 'buat' };
        }

        const { nama, kategori = KATEGORI.BIASA, mode = 'buat' } = pending;

        // Baca data lama agar warna/gambar/thumbnail/dll tidak hilang
        const rawExisting = client.database.get(`pesan-${guildId}-${nama}`);
        let existing = null;
        if (rawExisting && typeof rawExisting === 'string') {
            try { existing = JSON.parse(rawExisting); } catch { existing = null; }
        }

        const now = Date.now();

        // ── MODE TIPE: simpan sebagai plain text ───────────────────────────
        if (mode === 'tipe') {
            let plainText = '';
            try { plainText = interaction.fields.getTextInputValue('pesan-field-plaintext').trim(); } catch {}
            const tmpl = {
                ...(existing || {}),
                kategori,
                messageType: 'plain',
                plainText,
                updatedAt:   now,
                createdAt:   existing?.createdAt || now,
            };
            client.database.set(`pesan-${guildId}-${nama}`, JSON.stringify(tmpl));

            const rawList = client.database.get(`pesan-list-${guildId}`);
            let list = [];
            if (rawList && typeof rawList === 'string') { try { list = JSON.parse(rawList); } catch {} }
            if (!list.includes(nama)) { list.push(nama); client.database.set(`pesan-list-${guildId}`, JSON.stringify(list)); }

            return interaction.reply({
                content: `✅ Template \`${nama}\` diubah ke tipe **Teks Biasa**.\nGunakan \`/pesan preview ${nama}\` untuk pratinjau, lalu \`/pesan kirim ${nama}\` untuk mengirim.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Ambil nilai dari form untuk mode buat/edit
        let title = '', description = '', footer = '', plainText = '';
        const isPlainMode = existing?.messageType === 'plain' && mode === 'edit';
        if (isPlainMode) {
            try { plainText = interaction.fields.getTextInputValue('pesan-field-plaintext').trim(); } catch {}
        } else {
            try { title       = interaction.fields.getTextInputValue('pesan-field-title').trim(); }       catch {}
            try { description = interaction.fields.getTextInputValue('pesan-field-description').trim(); } catch {}
            try { footer      = interaction.fields.getTextInputValue('pesan-field-footer').trim(); }      catch {}
        }

        const isNew = !existing;
        const tmpl  = {
            messageType: existing?.messageType || 'embed',
            plainText:   isPlainMode ? plainText : (existing?.plainText || ''),
            title:       isPlainMode ? (existing?.title || '') : title,
            description: isPlainMode ? (existing?.description || '') : description,
            footer:      isPlainMode ? (existing?.footer || '') : footer,
            kategori,
            color:      existing?.color      || '#5865F2',
            image:      existing?.image      || '',
            thumbnail:  existing?.thumbnail  || '',
            authorName: existing?.authorName || '',
            authorIcon: existing?.authorIcon || '',
            createdAt:  existing?.createdAt  || now,
            updatedAt:  now,
        };

        // Simpan template yang diperbarui
        client.database.set(`pesan-${guildId}-${nama}`, JSON.stringify(tmpl));

        // Update daftar template
        const rawList = client.database.get(`pesan-list-${guildId}`);
        let list = [];
        if (rawList && typeof rawList === 'string') {
            try { list = JSON.parse(rawList); } catch { list = []; }
        }
        if (!list.includes(nama)) {
            list.push(nama);
            client.database.set(`pesan-list-${guildId}`, JSON.stringify(list));
        }

        // ── MODE EDIT: langsung perbarui pesan Discord setelah submit ──────
        if (mode === 'edit') {
            const rawSent = client.database.get(`pesan-unik-sent-${guildId}-${nama}`);
            if (!rawSent) {
                return interaction.reply({
                    content: `✏️ Template \`${nama}\` diperbarui, tapi data pesan hilang. Kirim ulang dengan \`/pesan kirim ${nama}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            let sentData;
            try { sentData = JSON.parse(rawSent); } catch {
                return interaction.reply({ content: '❌ Data pesan unik rusak.', flags: MessageFlags.Ephemeral });
            }

            const targetChannel = interaction.guild.channels.cache.get(sentData.channelId)
                ?? await interaction.guild.channels.fetch(sentData.channelId).catch(() => null);

            if (!targetChannel) {
                client.database.delete(`pesan-unik-sent-${guildId}-${nama}`);
                return interaction.reply({
                    content: `❌ Channel tidak ditemukan. Data direset — kirim ulang dengan \`/pesan kirim ${nama}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            let targetMessage;
            try {
                targetMessage = await targetChannel.messages.fetch(sentData.messageId);
            } catch {
                client.database.delete(`pesan-unik-sent-${guildId}-${nama}`);
                return interaction.reply({
                    content: `❌ Pesan tidak ditemukan (mungkin sudah dihapus manual). Data direset — kirim ulang dengan \`/pesan kirim ${nama}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (targetMessage.author.id !== interaction.client.user.id) {
                return interaction.reply({
                    content: '❌ Bot hanya bisa mengedit pesan milik bot sendiri.',
                    flags: MessageFlags.Ephemeral
                });
            }

            try {
                if (tmpl.messageType === 'plain') {
                    await targetMessage.edit({ content: (tmpl.plainText || '').slice(0, 2000), embeds: [] });
                } else {
                    await targetMessage.edit({ embeds: [buildEmbed(tmpl)], content: null });
                }
                return interaction.reply({
                    content: `✅ Pesan unik \`${nama}\` berhasil diperbarui!\n🔗 [Lihat pesan](${targetMessage.url})`,
                    flags: MessageFlags.Ephemeral
                });
            } catch {
                return interaction.reply({ content: '❌ Gagal mengedit pesan di Discord.', flags: MessageFlags.Ephemeral });
            }
        }

        // ── MODE BUAT: tampilkan konfirmasi seperti biasa ──────────────────
        const isEmpty  = !tmpl.title && !tmpl.description;
        const isUnik   = kategori === KATEGORI.UNIK;
        const badgeKat = isUnik ? '🔒 Unik' : '📄 Biasa';

        const embed = new EmbedBuilder()
            .setColor(isNew ? '#57F287' : '#FEE75C')
            .setTitle(isNew
                ? `✅ Template \`${nama}\` Dibuat [${badgeKat}]`
                : `✏️ Template \`${nama}\` Diperbarui [${badgeKat}]`)
            .setDescription(
                isEmpty
                    ? '⚠️ Judul dan deskripsi masih kosong. Isi salah satunya agar embed bisa dikirim.'
                    : isUnik
                        ? '🔒 Pesan unik: hanya bisa dikirim **sekali**, lalu gunakan `/pesan edit` untuk memperbarui isinya.'
                        : '📄 Pesan biasa: bisa dikirim berkali-kali. Tidak bisa diedit/dihapus via command setelah terkirim.'
            )
            .addFields(
                { name: '👁️ Pratinjau',        value: `\`/pesan preview ${nama}\``,       inline: true },
                { name: '🎨 Ubah Warna',        value: `\`/pesan set-warna ${nama}\``,     inline: true },
                { name: '🖼️ Tambah Gambar',     value: `\`/pesan set-gambar ${nama}\``,    inline: true },
                { name: '📌 Tambah Thumbnail',  value: `\`/pesan set-thumbnail ${nama}\``, inline: true },
                { name: '✍️ Tambah Author',      value: `\`/pesan set-author ${nama}\``,    inline: true },
                { name: '📤 Kirim',             value: `\`/pesan kirim ${nama}\``,         inline: true },
                ...(isUnik ? [{ name: '✏️ Edit Pesan', value: `\`/pesan edit ${nama}\``, inline: true }] : []),
            )
            .setFooter({ text: `Total template: ${list.length} · Gunakan /pesan list untuk melihat semua.` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
}).toJSON();

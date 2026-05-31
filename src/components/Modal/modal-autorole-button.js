const { ModalSubmitInteraction, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPanel(client, guildId, name) {
    const raw = client.database.get(`autobtn-${guildId}-${name}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function savePanel(client, guildId, name, data) {
    client.database.set(`autobtn-${guildId}-${name}`, JSON.stringify(data));
    const rawList = client.database.get(`autobtn-list-${guildId}`);
    let list = [];
    if (rawList && typeof rawList === 'string') {
        try { list = JSON.parse(rawList); } catch { list = []; }
    }
    if (!list.includes(name)) {
        list.push(name);
        client.database.set(`autobtn-list-${guildId}`, JSON.stringify(list));
    }
}

function getSentPanel(client, guildId, panelName) {
    const raw = client.database.get(`autobtn-sent-${guildId}-${panelName}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function buildPanelEmbed(panel) {
    const embed = new EmbedBuilder();
    const colorHex = panel.embedColor && /^#?[0-9A-Fa-f]{6}$/.test(panel.embedColor.trim())
        ? (panel.embedColor.startsWith('#') ? panel.embedColor : `#${panel.embedColor}`)
        : '#5865F2';
    embed.setColor(colorHex);
    if (panel.embedTitle)       embed.setTitle(panel.embedTitle.slice(0, 256));
    if (panel.embedDescription) embed.setDescription(panel.embedDescription.slice(0, 4096));
    if (panel.embedFooter)      embed.setFooter({ text: panel.embedFooter.slice(0, 2048) });
    if (panel.embedImage)       embed.setImage(panel.embedImage);
    if (panel.embedThumbnail)   embed.setThumbnail(panel.embedThumbnail);
    return embed;
}

function buildButtonRows(panel) {
    const rows = [];
    let rowIndex = 0, colIndex = 0;
    let currentRow = new ActionRowBuilder();
    for (const btn of panel.buttons) {
        if (colIndex === 5) { rows.push(currentRow); currentRow = new ActionRowBuilder(); rowIndex++; colIndex = 0; }
        if (rowIndex >= 5) break;
        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`autobtn:${panel.mode}:${panel.name}:${btn.roleId}`)
                .setLabel(btn.label)
                .setStyle(btn.style || ButtonStyle.Primary)
        );
        colIndex++;
    }
    if (colIndex > 0) rows.push(currentRow);
    return rows;
}

// ── Modal Handler ─────────────────────────────────────────────────────────────

module.exports = new Component({
    customId: 'autobtn-modal',  // prefix match: autobtn-modal:<panelName>
    type: 'modal',

    /**
     * @param {DiscordBot} client
     * @param {ModalSubmitInteraction} interaction
     */
    run: async (client, interaction) => {
        const guildId = interaction.guild.id;
        const userId  = interaction.user.id;

        // Baca pending data { nama, mode, isNew }
        const rawPending = client.database.get(`autobtn-pending-${guildId}-${userId}`);
        if (!rawPending) {
            return interaction.reply({
                content: '❌ Sesi expired. Jalankan `/autorole-button buat` lagi.',
                flags: MessageFlags.Ephemeral
            });
        }

        client.database.delete(`autobtn-pending-${guildId}-${userId}`);

        let pending;
        try { pending = JSON.parse(rawPending); } catch {
            return interaction.reply({ content: '❌ Data sesi rusak. Coba lagi.', flags: MessageFlags.Ephemeral });
        }

        const { nama, mode, isNew, pendingType } = pending;

        // Baca data panel lama (agar tombol, warna, gambar, dll tidak hilang)
        const existing = getPanel(client, guildId, nama);
        const now      = Date.now();

        // ── TIPE PLAIN: ganti tipe pesan ke teks biasa ──────────────────────────────
        if (pendingType === 'plain') {
            let plainText = '';
            try { plainText = interaction.fields.getTextInputValue('autobtn-field-plaintext').trim(); } catch {}
            if (!existing) return interaction.reply({ content: `❌ Panel \`${nama}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            const panel = { ...existing, messageType: 'plain', plainText, updatedAt: Date.now() };
            savePanel(client, guildId, nama, panel);

            // Jika sudah terkirim, update pesan Discord
            const sent = getSentPanel(client, guildId, nama);
            let statusStr = '';
            if (sent) {
                const channel = interaction.guild.channels.cache.get(sent.channelId)
                    ?? await interaction.guild.channels.fetch(sent.channelId).catch(() => null);
                if (channel) {
                    const rows = buildButtonRows(panel);
                    let message = null;
                    try { message = await channel.messages.fetch(sent.messageId); } catch {}
                    if (message) {
                        try {
                            await message.edit({ content: plainText.slice(0, 2000), embeds: [], components: rows });
                            statusStr = `\n✅ Pesan Discord diperbarui langsung!`;
                        } catch { statusStr = `\n⚠️ Gagal update pesan Discord.`; }
                    }
                }
            }

            return interaction.reply({
                content: `✅ Panel \`${nama}\` diubah ke **Teks Biasa**.${statusStr}\nGunakan \`/autorole-button preview ${nama}\` untuk pratinjau.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Ambil nilai dari form (dengan try/catch agar tidak throw jika field tidak ada)
        let embedTitle = '', embedDescription = '', embedFooter = '';
        try { embedTitle       = interaction.fields.getTextInputValue('autobtn-field-title').trim(); } catch {}
        try { embedDescription = interaction.fields.getTextInputValue('autobtn-field-description').trim(); } catch {}
        try { embedFooter      = interaction.fields.getTextInputValue('autobtn-field-footer').trim(); } catch {}

        const panel = {
            name:             nama,
            mode,
            embedTitle,
            embedDescription,
            embedFooter,
            embedColor:     existing?.embedColor     || '#5865F2',
            embedImage:     existing?.embedImage     || '',
            embedThumbnail: existing?.embedThumbnail || '',
            defaultStyle:   existing?.defaultStyle   || null,
            buttons:        existing?.buttons        || [],
            messageType:    existing?.messageType    || 'embed',
            plainText:      existing?.plainText      || '',
            createdAt:      existing?.createdAt      || now,
            updatedAt:      now
        };

        savePanel(client, guildId, nama, panel);

        // Jika panel sudah terkirim, perbarui pesan Discord langsung
        const sent = getSentPanel(client, guildId, nama);
        let statusStr = '';
        let updatedLive = false;

        if (sent) {
            const channel = interaction.guild.channels.cache.get(sent.channelId)
                ?? await interaction.guild.channels.fetch(sent.channelId).catch(() => null);

            if (channel) {
                let message = null;
                try { message = await channel.messages.fetch(sent.messageId); } catch { message = null; }

                if (message) {
                    try {
                        if (panel.messageType === 'plain') {
                            await message.edit({
                                content: (panel.plainText || '').slice(0, 2000),
                                embeds: [],
                                components: panel.buttons.length > 0 ? buildButtonRows(panel) : []
                            });
                        } else {
                            await message.edit({
                                embeds:     [buildPanelEmbed(panel)],
                                content:    null,
                                components: panel.buttons.length > 0 ? buildButtonRows(panel) : []
                            });
                        }
                        updatedLive = true;
                        statusStr = `✅ Pesan terkirim langsung diperbarui!\n🔗 https://discord.com/channels/${guildId}/${sent.channelId}/${sent.messageId}`;
                    } catch {
                        statusStr = `⚠️ Gagal memperbarui pesan. Kirim ulang: \`/autorole-button kirim ${nama}\``;
                    }
                } else {
                    statusStr = `📭 Pesan sudah dihapus. Kirim ulang: \`/autorole-button kirim ${nama}\``;
                }
            } else {
                statusStr = `📭 Channel tidak ditemukan. Kirim ulang: \`/autorole-button kirim ${nama}\``;
            }
        } else {
            statusStr = `📭 Panel belum dikirim. Gunakan \`/autorole-button kirim ${nama}\` setelah selesai mengatur tombol.`;
        }

        const isEmpty  = !embedTitle && !embedDescription;
        const modeIcon = mode === 'single' ? '🔘 Single (radio)' : '✅ Multi';

        // Build fields array
        const fields = [
            { name: '🔧 Mode',       value: modeIcon,                     inline: true },
            { name: '🎭 Tombol',      value: `${panel.buttons.length}/25`, inline: true },
            { name: '🎨 Warna Embed', value: panel.embedColor,             inline: true },
        ];

        if (isEmpty) {
            fields.push({
                name: '⚠️ Perhatian',
                value: 'Judul dan deskripsi masih kosong. Isi salah satunya agar embed terlihat.',
                inline: false
            });
        }

        if (!isNew) {
            fields.push({
                name: '🛠️ Langkah Selanjutnya',
                value: [
                    `• \`/autorole-button tambah-button\` — tambah tombol role`,
                    `• \`/autorole-button set-warna\` — ubah warna embed`,
                    `• \`/autorole-button set-gambar\` — tambah gambar`,
                    `• \`/autorole-button set-thumbnail\` — tambah thumbnail`,
                    `• \`/autorole-button preview ${nama}\` — pratinjau panel`,
                    `• \`/autorole-button kirim ${nama}\` — kirim ke channel`
                ].join('\n'),
                inline: false
            });
        } else {
            fields.push({
                name: '🛠️ Langkah Selanjutnya',
                value: 'Klik **➕ Tambah Button Sekarang** di bawah untuk langsung menambahkan button pertama ke panel ini.',
                inline: false
            });
        }

        fields.push({ name: '📤 Status', value: statusStr, inline: false });

        const embed = new EmbedBuilder()
            .setColor(isNew ? '#57F287' : '#FEE75C')
            .setTitle(isNew ? `✅ Panel \`${nama}\` Dibuat` : `✏️ Panel \`${nama}\` Diperbarui`)
            .addFields(...fields)
            .setTimestamp();

        // Untuk panel baru: tampilkan tombol aksi cepat agar user bisa langsung tambah button
        if (isNew) {
            const quickRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`autobtn-quickadd:${nama}`)
                    .setLabel('➕ Tambah Button Sekarang')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`autobtn-quickskip:${nama}`)
                    .setLabel('⏭️ Lewati')
                    .setStyle(ButtonStyle.Secondary)
            );
            return interaction.reply({ embeds: [embed], components: [quickRow], flags: MessageFlags.Ephemeral });
        }

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
}).toJSON();

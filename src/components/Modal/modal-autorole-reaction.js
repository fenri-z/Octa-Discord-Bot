const { ModalSubmitInteraction, EmbedBuilder, MessageFlags } = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPanel(client, guildId, name) {
    const raw = client.database.get(`autoreact-${guildId}-${name}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function savePanel(client, guildId, name, data) {
    client.database.set(`autoreact-${guildId}-${name}`, JSON.stringify(data));
    const rawList = client.database.get(`autoreact-list-${guildId}`);
    let list = [];
    if (rawList && typeof rawList === 'string') {
        try { list = JSON.parse(rawList); } catch { list = []; }
    }
    if (!list.includes(name)) {
        list.push(name);
        client.database.set(`autoreact-list-${guildId}`, JSON.stringify(list));
    }
}

function getSentPanel(client, guildId, panelName) {
    const raw = client.database.get(`autoreact-sent-${guildId}-${panelName}`);
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

// ── Modal Handler ─────────────────────────────────────────────────────────────

module.exports = new Component({
    customId: 'autoreact-modal',  // prefix match: autoreact-modal:<panelName>
    type: 'modal',

    /**
     * @param {DiscordBot} client
     * @param {ModalSubmitInteraction} interaction
     */
    run: async (client, interaction) => {
        const guildId = interaction.guild.id;
        const userId  = interaction.user.id;

        const rawPending = client.database.get(`autoreact-pending-${guildId}-${userId}`);
        if (!rawPending) {
            return interaction.reply({
                content: '❌ Sesi expired. Jalankan `/autorole-reaction buat` lagi.',
                flags: MessageFlags.Ephemeral
            });
        }

        client.database.delete(`autoreact-pending-${guildId}-${userId}`);

        let pending;
        try { pending = JSON.parse(rawPending); }
        catch { return interaction.reply({ content: '❌ Data sesi rusak. Coba lagi.', flags: MessageFlags.Ephemeral }); }

        const { nama, mode, isNew, pendingType } = pending;
        const existing = getPanel(client, guildId, nama);
        const now      = Date.now();

        // ── TIPE PLAIN ────────────────────────────────────────────────────────
        if (pendingType === 'plain') {
            let plainText = '';
            try { plainText = interaction.fields.getTextInputValue('autoreact-field-plaintext').trim(); } catch {}
            if (!existing) return interaction.reply({ content: `❌ Panel \`${nama}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });

            const panel = { ...existing, messageType: 'plain', plainText, updatedAt: now };
            savePanel(client, guildId, nama, panel);

            const sent = getSentPanel(client, guildId, nama);
            let statusStr = '';
            if (sent) {
                const channel = interaction.guild.channels.cache.get(sent.channelId)
                    ?? await interaction.guild.channels.fetch(sent.channelId).catch(() => null);
                if (channel) {
                    let message = null;
                    try { message = await channel.messages.fetch(sent.messageId); } catch {}
                    if (message) {
                        try {
                            await message.edit({ content: plainText.slice(0, 2000), embeds: [] });
                            statusStr = `\n✅ Pesan Discord diperbarui langsung!`;
                        } catch { statusStr = `\n⚠️ Gagal update pesan Discord.`; }
                    }
                }
            }

            return interaction.reply({
                content: `✅ Panel \`${nama}\` diubah ke **Teks Biasa**.${statusStr}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── TIPE EMBED ────────────────────────────────────────────────────────
        let embedTitle = '', embedDescription = '', embedFooter = '';
        try { embedTitle       = interaction.fields.getTextInputValue('autoreact-field-title').trim(); } catch {}
        try { embedDescription = interaction.fields.getTextInputValue('autoreact-field-description').trim(); } catch {}
        try { embedFooter      = interaction.fields.getTextInputValue('autoreact-field-footer').trim(); } catch {}

        const panel = {
            name:             nama,
            mode,
            embedTitle,
            embedDescription,
            embedFooter,
            embedColor:     existing?.embedColor     || '#5865F2',
            embedImage:     existing?.embedImage     || '',
            embedThumbnail: existing?.embedThumbnail || '',
            reactions:      existing?.reactions      || [],
            messageType:    existing?.messageType    || 'embed',
            plainText:      existing?.plainText      || '',
            createdAt:      existing?.createdAt      || now,
            updatedAt:      now
        };

        savePanel(client, guildId, nama, panel);

        const sent = getSentPanel(client, guildId, nama);
        let statusStr = '';

        if (sent) {
            const channel = interaction.guild.channels.cache.get(sent.channelId)
                ?? await interaction.guild.channels.fetch(sent.channelId).catch(() => null);
            if (channel) {
                let message = null;
                try { message = await channel.messages.fetch(sent.messageId); } catch {}
                if (message) {
                    try {
                        if (panel.messageType === 'plain') {
                            await message.edit({ content: (panel.plainText || '').slice(0, 2000), embeds: [] });
                        } else {
                            await message.edit({ embeds: [buildPanelEmbed(panel)], content: null });
                        }
                        statusStr = `✅ Pesan terkirim langsung diperbarui!\n🔗 https://discord.com/channels/${guildId}/${sent.channelId}/${sent.messageId}`;
                    } catch {
                        statusStr = `⚠️ Gagal memperbarui pesan.`;
                    }
                } else {
                    statusStr = `📭 Pesan sudah dihapus.`;
                }
            } else {
                statusStr = `📭 Channel tidak ditemukan.`;
            }
        } else {
            statusStr = `📭 Panel belum dikirim. Gunakan \`/autorole-reaction kirim ${nama}\` setelah menambahkan reaction.`;
        }

        const isEmpty  = !embedTitle && !embedDescription;
        const modeIcon = mode === 'single' ? '🔘 Single (radio)' : '✅ Multi';

        const fields = [
            { name: '🔧 Mode',          value: modeIcon,                         inline: true },
            { name: '✨ Reactions',      value: `${panel.reactions.length}/20`,   inline: true },
            { name: '🎨 Warna Embed',   value: panel.embedColor,                  inline: true },
        ];

        if (isEmpty) {
            fields.push({
                name: '⚠️ Perhatian',
                value: 'Judul dan deskripsi masih kosong. Isi salah satunya agar embed terlihat.',
                inline: false
            });
        }

        fields.push({
            name: '🛠️ Langkah Selanjutnya',
            value: [
                `• \`/autorole-reaction tambah-reaction\` — tambah emoji + role`,
                `• \`/autorole-reaction set-warna\` — ubah warna embed`,
                `• \`/autorole-reaction set-gambar\` — tambah gambar`,
                `• \`/autorole-reaction preview ${nama}\` — pratinjau panel`,
                `• \`/autorole-reaction kirim ${nama}\` — kirim ke channel`
            ].join('\n'),
            inline: false
        });

        fields.push({ name: '📤 Status', value: statusStr, inline: false });

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(isNew ? '#57F287' : '#FEE75C')
                    .setTitle(isNew ? `✅ Panel \`${nama}\` Dibuat` : `✏️ Panel \`${nama}\` Diperbarui`)
                    .addFields(...fields)
                    .setTimestamp()
            ],
            flags: MessageFlags.Ephemeral
        });
    }
}).toJSON();

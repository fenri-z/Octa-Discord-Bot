const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { resolveRole, resolveChannel } = require('../../utils/resolveGuildOption');
const { checkBotPermissions } = require('../../utils/checkBotPermissions');

// ── Helpers panel ──────────────────────────────────────────────────────────

function getPanelList(client, guildId) {
    const raw = client.database.get(`autobtn-list-${guildId}`);
    if (!raw || typeof raw !== 'string') return [];
    try { return JSON.parse(raw); } catch { return []; }
}

function savePanelList(client, guildId, list) {
    client.database.set(`autobtn-list-${guildId}`, JSON.stringify(list));
}

function getPanel(client, guildId, name) {
    const raw = client.database.get(`autobtn-${guildId}-${name}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function savePanel(client, guildId, name, data) {
    client.database.set(`autobtn-${guildId}-${name}`, JSON.stringify(data));
    const list = getPanelList(client, guildId);
    if (!list.includes(name)) { list.push(name); savePanelList(client, guildId, list); }
}

function deletePanel(client, guildId, name) {
    client.database.delete(`autobtn-${guildId}-${name}`);
    savePanelList(client, guildId, getPanelList(client, guildId).filter(n => n !== name));
}

// ── Helpers sentData panel ─────────────────────────────────────────────────

function getSentPanel(client, guildId, panelName) {
    const raw = client.database.get(`autobtn-sent-${guildId}-${panelName}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function saveSentPanel(client, guildId, panelName, messageId, channelId) {
    client.database.set(`autobtn-sent-${guildId}-${panelName}`, JSON.stringify({ messageId, channelId }));
}

function deleteSentPanel(client, guildId, panelName) {
    client.database.delete(`autobtn-sent-${guildId}-${panelName}`);
}

async function resolveSentMessage(client, guild, panelName) {
    const sent = getSentPanel(client, guild.id, panelName);
    if (!sent) return null;

    const channel = guild.channels.cache.get(sent.channelId)
        ?? await guild.channels.fetch(sent.channelId).catch(() => null);
    if (!channel) {
        deleteSentPanel(client, guild.id, panelName);
        return null;
    }

    let message = null;
    try {
        message = await channel.messages.fetch(sent.messageId);
    } catch {
        deleteSentPanel(client, guild.id, panelName);
        return null;
    }

    return { sent, message, channel };
}

// ── Embed & Button builder ─────────────────────────────────────────────────

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
    let rowIndex = 0;
    let colIndex = 0;
    let currentRow = new ActionRowBuilder();

    for (const btn of panel.buttons) {
        if (colIndex === 5) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
            rowIndex++;
            colIndex = 0;
        }
        if (rowIndex >= 5) break;

        const builder = new ButtonBuilder()
            .setCustomId(`autobtn:${panel.mode}:${panel.name}:${btn.roleId}`)
            .setLabel(btn.label)
            .setStyle(btn.style || ButtonStyle.Primary);

        currentRow.addComponents(builder);
        colIndex++;
    }

    if (colIndex > 0) rows.push(currentRow);
    return rows;
}

function isValidName(name) {
    return /^[a-zA-Z0-9_-]{1,32}$/.test(name);
}

const STYLE_MAP = {
    primary:   ButtonStyle.Primary,
    success:   ButtonStyle.Success,
    danger:    ButtonStyle.Danger,
    secondary: ButtonStyle.Secondary
};

const STYLE_LABEL = {
    [ButtonStyle.Primary]:   '🔵 Biru (Primary)',
    [ButtonStyle.Success]:   '🟢 Hijau (Success)',
    [ButtonStyle.Danger]:    '🔴 Merah (Danger)',
    [ButtonStyle.Secondary]: '⚪ Abu-abu (Secondary)'
};

// ── Command ────────────────────────────────────────────────────────────────
module.exports = new ApplicationCommand({
    command: {
        name: 'autorole-button',
        description: 'Buat panel button untuk member mengambil/melepas role sendiri.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [

            // ── list ──────────────────────────────────────────────────────
            {
                name: 'list',
                description: 'Lihat semua panel autorole button yang ada.',
                type: 1
            },

            // ── buat ─────────────────────────────────────────────────────
            {
                name: 'buat',
                description: 'Buat panel baru atau edit tampilan embed panel yang sudah ada.',
                type: 1,
                options: [
                    {
                        name: 'nama',
                        description: 'Nama panel (huruf, angka, - dan _, maks 32 karakter)',
                        type: 3,
                        required: true,
                        max_length: 32,
                        autocomplete: true
                    },
                    {
                        name: 'mode',
                        description: 'Multi = bisa klik semua button | Single = hanya boleh 1 role aktif',
                        type: 3,
                        required: false,
                        choices: [
                            { name: '✅ Multi  – bisa ambil banyak role sekaligus', value: 'multi'  },
                            { name: '🔘 Single – hanya boleh 1 role (radio button)',  value: 'single' }
                        ]
                    }
                ]
            },

            // ── set-warna ─────────────────────────────────────────────────
            {
                name: 'set-warna',
                description: 'Ubah warna garis kiri embed panel.',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Nama panel',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'hex',
                        description: 'Kode warna hex, contoh: #5865F2 atau FF5733',
                        type: 3, required: true, max_length: 7
                    }
                ]
            },

            // ── set-gambar ────────────────────────────────────────────────
            {
                name: 'set-gambar',
                description: 'Pasang atau hapus gambar besar di bawah embed panel.',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Nama panel',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'url',
                        description: 'URL gambar (https://...). Ketik - untuk menghapus.',
                        type: 3, required: true
                    }
                ]
            },

            // ── set-thumbnail ─────────────────────────────────────────────
            {
                name: 'set-thumbnail',
                description: 'Pasang atau hapus thumbnail (gambar kecil pojok kanan) embed panel.',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Nama panel',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'url',
                        description: 'URL thumbnail (https://...). Ketik - untuk menghapus.',
                        type: 3, required: true
                    }
                ]
            },

            // ── tambah-button ─────────────────────────────────────────────
            {
                name: 'tambah-button',
                description: 'Tambah tombol role ke sebuah panel.',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Nama panel tujuan',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'role',
                        description: 'Role yang diberikan/dicabut saat tombol diklik',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'label',
                        description: 'Teks label tombol, bisa sertakan emoji: 🎮 Gaming (maks 80 karakter)',
                        type: 3, required: true, max_length: 80
                    },
                    {
                        name: 'warna',
                        description: 'Warna tombol',
                        type: 3, required: false,
                        choices: [
                            { name: '🔵 Biru (Primary)',      value: 'primary'   },
                            { name: '🟢 Hijau (Success)',     value: 'success'   },
                            { name: '🔴 Merah (Danger)',      value: 'danger'    },
                            { name: '⚪ Abu-abu (Secondary)', value: 'secondary' }
                        ]
                    }
                ]
            },

            // ── tambah-bulk ───────────────────────────────────────────────
            {
                name: 'tambah-bulk',
                description: 'Tambah banyak tombol sekaligus. Format tiap baris: @Role | Label | warna',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Nama panel tujuan',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'data',
                        description: 'Satu baris = 1 tombol: @Role | Label | warna  (warna opsional, default: primary)',
                        type: 3, required: true, max_length: 2000
                    }
                ]
            },

            // ── edit-button ───────────────────────────────────────────────
            {
                name: 'edit-button',
                description: 'Edit label atau warna tombol yang sudah ada di panel.',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Nama panel yang berisi tombol',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'role',
                        description: 'Role yang tombolnya ingin diedit',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'label',
                        description: 'Label baru tombol (maks 80 karakter)',
                        type: 3, required: false, max_length: 80
                    },
                    {
                        name: 'warna',
                        description: 'Warna baru tombol',
                        type: 3, required: false,
                        choices: [
                            { name: '🔵 Biru (Primary)',      value: 'primary'   },
                            { name: '🟢 Hijau (Success)',     value: 'success'   },
                            { name: '🔴 Merah (Danger)',      value: 'danger'    },
                            { name: '⚪ Abu-abu (Secondary)', value: 'secondary' }
                        ]
                    }
                ]
            },

            // ── edit-bulk ─────────────────────────────────────────────────
            {
                name: 'edit-bulk',
                description: 'Edit label/warna banyak tombol sekaligus. Format: @Role | Label baru | warna baru',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Nama panel yang berisi tombol',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'data',
                        description: 'Satu baris = 1 tombol: @Role | Label baru | warna baru  (keduanya opsional)',
                        type: 3, required: true, max_length: 2000
                    }
                ]
            },

            // ── hapus-button ──────────────────────────────────────────────
            {
                name: 'hapus-button',
                description: 'Hapus sebuah tombol dari panel berdasarkan role.',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Nama panel',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'role',
                        description: 'Role yang ingin dihapus tombolnya',
                        type: 3, required: true, autocomplete: true
                    }
                ]
            },

            // ── hapus-bulk ────────────────────────────────────────────────
            {
                name: 'hapus-bulk',
                description: 'Hapus banyak tombol sekaligus. Format tiap baris: @Role',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Nama panel yang berisi tombol',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'data',
                        description: 'Satu baris = 1 role yang tombolnya akan dihapus: @Role',
                        type: 3, required: true, max_length: 2000
                    }
                ]
            },

            // ── kirim ─────────────────────────────────────────────────────
            {
                name: 'kirim',
                description: 'Kirim panel ke channel tertentu (hanya bisa dikirim 1 kali).',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Nama panel yang akan dikirim',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'channel',
                        description: 'Channel tujuan (kosong = channel saat ini)',
                        type: 3, required: false, autocomplete: true
                    }
                ]
            },

            // ── hapus-panel ───────────────────────────────────────────────
            {
                name: 'hapus-panel',
                description: 'Hapus seluruh panel dari database.',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Nama panel yang akan dihapus',
                        type: 3, required: true, autocomplete: true
                    }
                ]
            },

            // ── color-button ──────────────────────────────────────────────
            {
                name: 'color-button',
                description: 'Atur warna default tombol baru untuk sebuah panel.',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Nama panel yang ingin diubah warna defaultnya',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'warna',
                        description: 'Warna default baru untuk semua tombol baru di panel ini',
                        type: 3, required: true,
                        choices: [
                            { name: '🔵 Biru (Primary)',      value: 'primary'   },
                            { name: '🟢 Hijau (Success)',     value: 'success'   },
                            { name: '🔴 Merah (Danger)',      value: 'danger'    },
                            { name: '⚪ Abu-abu (Secondary)', value: 'secondary' }
                        ]
                    }
                ]
            },

            // ── preview ───────────────────────────────────────────────────
            {
                name: 'preview',
                description: 'Pratinjau panel (hanya terlihat olehmu).',
                type: 1,
                options: [
                    {
                        name: 'panel',
                        description: 'Nama panel yang ingin dipratinjau',
                        type: 3, required: true, autocomplete: true
                    }
                ]
            },

            // ── tipe ──────────────────────────────────────────────────────
            {
                name: 'tipe',
                description: 'Ubah tipe pesan panel: embed atau teks biasa.',
                type: 1,
                options: [
                    {
                        name: 'panel', description: 'Nama panel',
                        type: 3, required: true, autocomplete: true
                    },
                    {
                        name: 'tipe', description: 'Tipe pesan yang diinginkan',
                        type: 3, required: true,
                        choices: [
                            { name: 'Embed — pesan dalam kotak dengan warna', value: 'embed' },
                            { name: 'Teks Biasa — teks tanpa kotak embed', value: 'plain' }
                        ]
                    }
                ]
            }
        ]
    },

    options: { botOwner: false },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const { guild, options } = interaction;
        const sub = options.getSubcommand();

        // ── Cek permission bot ────────────────────────────────────────
        const ok = await checkBotPermissions(interaction, [
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ManageRoles,
        ]);
        if (!ok) return;

        // ── /autorole-button list ──────────────────────────────────────────
        if (sub === 'list') {
            const list = getPanelList(client, guild.id);

            if (list.length === 0) {
                return interaction.reply({
                    content: '📭 Belum ada panel autorole button. Buat dengan `/autorole-button buat`.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const fields = list.map(name => {
                const panel = getPanel(client, guild.id, name);
                if (!panel) return { name: `\`${name}\``, value: '_Data rusak_', inline: true };

                const modeIcon = panel.mode === 'single' ? '🔘' : '✅';

                const sent    = getSentPanel(client, guild.id, name);
                const sentStr = sent
                    ? `📤 Terkirim — [Lihat](https://discord.com/channels/${guild.id}/${sent.channelId}/${sent.messageId})`
                    : '📭 Belum dikirim';

                const defaultWarna = panel.defaultStyle
                    ? (STYLE_LABEL[panel.defaultStyle] ?? '🔵 Biru (Primary)')
                    : '🔵 Biru (Primary)';

                return {
                    name: `\`${name}\``,
                    value: [
                        `${modeIcon} **Mode:** ${panel.mode === 'single' ? 'Single (radio)' : 'Multi'}`,
                        `🎭 **Tombol:** ${panel.buttons?.length ?? 0}`,
                        `🎨 **Warna Default:** ${defaultWarna}`,
                        `🎨 **Warna Embed:** ${panel.embedColor || '#5865F2'}`,
                        sentStr
                    ].join('\n'),
                    inline: true
                };
            });

            const embed = new EmbedBuilder()
                .setTitle('🗂️ Daftar Panel Autorole Button')
                .setColor('#5865F2')
                .addFields(fields)
                .setFooter({ text: `${list.length} panel · ${guild.name}` })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── /autorole-button tipe ──────────────────────────────────────────
        if (sub === 'tipe') {
            const panelName = options.getString('panel');
            const tipe      = options.getString('tipe');
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });

            if (tipe === 'embed') {
                panel.messageType = 'embed';
                panel.updatedAt   = Date.now();
                savePanel(client, guild.id, panelName, panel);
                return interaction.reply({
                    content: `✅ Tipe panel \`${panelName}\` diubah ke **Embed**.\nGunakan \`/autorole-button buat ${panelName}\` untuk mengatur judul, deskripsi, dan footer embed.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (tipe === 'plain') {
                client.database.set(
                    `autobtn-pending-${guild.id}-${interaction.user.id}`,
                    JSON.stringify({ nama: panelName, mode: panel.mode || 'multi', isNew: false, pendingType: 'plain' })
                );
                await interaction.showModal({
                    custom_id: `autobtn-modal:${panelName}`,
                    title: `Teks Biasa: ${panelName}`.slice(0, 45),
                    components: [{
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'autobtn-field-plaintext',
                            label: 'Isi Pesan Teks Biasa (maks. 2000)', style: 2,
                            placeholder: 'Tulis isi pesan di sini...',
                            value: panel.plainText || '', required: true, max_length: 2000
                        }]
                    }]
                });
                return;
            }
        }

        // ── /autorole-button buat ──────────────────────────────────────────
        if (sub === 'buat') {
            const nama = options.getString('nama').trim().toLowerCase();
            const mode = options.getString('mode'); // bisa null (untuk edit ulang)

            if (!isValidName(nama)) {
                return interaction.reply({
                    content: '❌ Nama panel hanya boleh berisi huruf, angka, `-`, dan `_` (1–32 karakter).',
                    flags: MessageFlags.Ephemeral
                });
            }

            const existing = getPanel(client, guild.id, nama);

            // Jika panel baru, mode wajib diisi
            if (!existing && !mode) {
                return interaction.reply({
                    content: '❌ Panel baru memerlukan opsi `mode`. Pilih `multi` atau `single`.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Simpan pending untuk modal handler
            const pendingMode = mode || existing?.mode || 'multi';
            client.database.set(
                `autobtn-pending-${guild.id}-${interaction.user.id}`,
                JSON.stringify({ nama, mode: pendingMode, isNew: !existing })
            );

            // Buka modal dengan pre-fill dari data panel (jika sudah ada)
            await interaction.showModal({
                custom_id: `autobtn-modal:${nama}`,
                title: `Panel: ${nama}`.slice(0, 45),
                components: [
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'autobtn-field-title',
                            label: 'Judul Embed (maks. 256 karakter)', style: 1,
                            placeholder: 'Contoh: Pilih Role Kamu',
                            value: existing?.embedTitle || '', required: false, max_length: 256
                        }]
                    },
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'autobtn-field-description',
                            label: 'Deskripsi Embed (maks. 4000 karakter)', style: 2,
                            placeholder: 'Jelaskan fungsi tombol di sini...',
                            value: existing?.embedDescription || '', required: false, max_length: 4000
                        }]
                    },
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'autobtn-field-footer',
                            label: 'Footer Embed (maks. 2048 karakter)', style: 1,
                            placeholder: 'Teks di bagian bawah embed...',
                            value: existing?.embedFooter || '', required: false, max_length: 2048
                        }]
                    }
                ]
            });
            return;
        }

        // ── /autorole-button set-warna ─────────────────────────────────────
        if (sub === 'set-warna') {
            const panelName = options.getString('panel');
            const hex       = options.getString('hex').trim();
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            if (!/^#?[0-9A-Fa-f]{6}$/.test(hex)) return interaction.reply({ content: '❌ Format warna tidak valid. Contoh: `#FF5733` atau `FF5733`.', flags: MessageFlags.Ephemeral });

            panel.embedColor = hex.startsWith('#') ? hex : `#${hex}`;
            panel.updatedAt  = Date.now();
            savePanel(client, guild.id, panelName, panel);

            // Perbarui pesan yang sudah terkirim
            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = '📭 Panel belum dikirim.';
            if (sentResult) {
                try {
                    await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)], components: buildButtonRows(panel) });
                    statusStr = `✅ Pesan terkirim langsung diperbarui!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = `⚠️ Gagal memperbarui pesan. Kirim ulang: \`/autorole-button kirim ${panelName}\``;
                }
            }

            return interaction.reply({
                content: `✅ Warna embed panel \`${panelName}\` diperbarui ke \`${panel.embedColor}\`.\n${statusStr}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button set-gambar ────────────────────────────────────
        if (sub === 'set-gambar') {
            const panelName = options.getString('panel');
            const url       = options.getString('url').trim();
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });

            if (url === '-') {
                panel.embedImage = '';
            } else {
                if (!/^https?:\/\/.+\..+/.test(url)) return interaction.reply({ content: '❌ URL tidak valid. Harus dimulai dengan `https://`.', flags: MessageFlags.Ephemeral });
                panel.embedImage = url;
            }
            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = '📭 Panel belum dikirim.';
            if (sentResult) {
                try {
                    await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)], components: buildButtonRows(panel) });
                    statusStr = `✅ Pesan terkirim langsung diperbarui!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = `⚠️ Gagal memperbarui pesan. Kirim ulang: \`/autorole-button kirim ${panelName}\``;
                }
            }

            const action = url === '-' ? '**dihapus**' : 'diperbarui';
            return interaction.reply({
                content: `✅ Gambar embed panel \`${panelName}\` ${action}.\n${statusStr}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button set-thumbnail ─────────────────────────────────
        if (sub === 'set-thumbnail') {
            const panelName = options.getString('panel');
            const url       = options.getString('url').trim();
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });

            if (url === '-') {
                panel.embedThumbnail = '';
            } else {
                if (!/^https?:\/\/.+\..+/.test(url)) return interaction.reply({ content: '❌ URL tidak valid. Harus dimulai dengan `https://`.', flags: MessageFlags.Ephemeral });
                panel.embedThumbnail = url;
            }
            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = '📭 Panel belum dikirim.';
            if (sentResult) {
                try {
                    await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)], components: buildButtonRows(panel) });
                    statusStr = `✅ Pesan terkirim langsung diperbarui!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = `⚠️ Gagal memperbarui pesan. Kirim ulang: \`/autorole-button kirim ${panelName}\``;
                }
            }

            const action = url === '-' ? '**dihapus**' : 'diperbarui';
            return interaction.reply({
                content: `✅ Thumbnail embed panel \`${panelName}\` ${action}.\n${statusStr}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button tambah-button ─────────────────────────────────
        if (sub === 'tambah-button') {
            const panelName = options.getString('panel');
            const roleStr   = options.getString('role');
            const label     = options.getString('label').trim();
            const panel = getPanel(client, guild.id, panelName);
            if (!panel) {
                return interaction.reply({
                    content: `❌ Panel \`${panelName}\` tidak ditemukan.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const defaultKey = panel.defaultStyle
                ? Object.keys(STYLE_MAP).find(k => STYLE_MAP[k] === panel.defaultStyle) || 'primary'
                : 'primary';
            const warnaKey  = options.getString('warna') || defaultKey;

            const role = resolveRole(guild, roleStr);
            if (!role) {
                return interaction.reply({ content: '❌ Role tidak ditemukan.', flags: MessageFlags.Ephemeral });
            }
            if (role.managed || role.id === guild.id) {
                return interaction.reply({ content: '❌ Role ini tidak bisa digunakan (managed atau @everyone).', flags: MessageFlags.Ephemeral });
            }
            if (panel.buttons.some(b => b.roleId === role.id)) {
                return interaction.reply({
                    content: `⚠️ Role ${role} sudah punya tombol di panel \`${panelName}\`. Gunakan \`/autorole-button edit-button\` untuk mengubahnya.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            if (panel.buttons.length >= 25) {
                return interaction.reply({
                    content: '❌ Satu panel maksimal 25 tombol (5 baris × 5 kolom).',
                    flags: MessageFlags.Ephemeral
                });
            }

            panel.buttons.push({
                roleId: role.id,
                label,
                style:  STYLE_MAP[warnaKey] ?? ButtonStyle.Primary
            });
            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = `Kirim panel dengan \`/autorole-button kirim ${panelName}\``;

            if (sentResult) {
                try {
                    await sentResult.message.edit({
                        embeds:     [buildPanelEmbed(panel)],
                        components: buildButtonRows(panel)
                    });
                    statusStr = `✅ Pesan terkirim langsung diperbarui!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = `⚠️ Gagal memperbarui pesan. Kirim ulang: \`/autorole-button kirim ${panelName}\``;
                }
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle(`✅ Tombol Ditambahkan ke Panel \`${panelName}\``)
                        .addFields(
                            { name: '🎭 Role',   value: `${role}`,  inline: true },
                            { name: '🏷️ Label',  value: label,      inline: true },
                            { name: '🎨 Warna',  value: STYLE_LABEL[STYLE_MAP[warnaKey]] ?? warnaKey, inline: true },
                            { name: '📊 Total',  value: `${panel.buttons.length}/25 tombol`, inline: true },
                            { name: '📤 Status', value: statusStr, inline: false }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button tambah-bulk ──────────────────────────────────
        if (sub === 'tambah-bulk') {
            const panelName = options.getString('panel');
            const rawData   = options.getString('data');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) {
                return interaction.reply({
                    content: `❌ Panel \`${panelName}\` tidak ditemukan.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const lines = rawData.split(/[\n;]/g).map(l => l.trim()).filter(Boolean);
            if (lines.length === 0) {
                return interaction.reply({
                    content: '❌ Input kosong. Masukkan minimal satu baris: `@Role | Label | warna`',
                    flags: MessageFlags.Ephemeral
                });
            }

            const results  = [];
            let addedCount = 0;

            for (const line of lines) {
                const parts = line.split('|').map(p => p.trim());
                if (parts.length < 2) {
                    results.push({ status: '❌', label: line, reason: 'Format salah (kurang `|`)' });
                    continue;
                }
                const [roleStr, labelRaw, warnaRaw] = parts;
                const label    = labelRaw?.trim();
                const panelDefaultKey = panel.defaultStyle
                    ? Object.keys(STYLE_MAP).find(k => STYLE_MAP[k] === panel.defaultStyle) || 'primary'
                    : 'primary';
                const warnaKey = (warnaRaw?.trim().toLowerCase()) || panelDefaultKey;

                if (!label) {
                    results.push({ status: '❌', label: roleStr, reason: 'Label kosong' });
                    continue;
                }
                if (label.length > 80) {
                    results.push({ status: '❌', label, reason: 'Label melebihi 80 karakter' });
                    continue;
                }
                if (!['primary','success','danger','secondary'].includes(warnaKey)) {
                    results.push({ status: '❌', label, reason: `Warna tidak valid: \`${warnaKey}\`` });
                    continue;
                }
                const role = resolveRole(guild, roleStr);
                if (!role) {
                    results.push({ status: '❌', label, reason: `Role \`${roleStr}\` tidak ditemukan` });
                    continue;
                }
                if (role.managed || role.id === guild.id) {
                    results.push({ status: '❌', label, role: role.toString(), reason: 'Role managed atau @everyone' });
                    continue;
                }
                if (panel.buttons.some(b => b.roleId === role.id)) {
                    results.push({ status: '⚠️', label, role: role.toString(), reason: 'Role sudah punya tombol (dilewati)' });
                    continue;
                }
                if (panel.buttons.length + addedCount >= 25) {
                    results.push({ status: '❌', label, role: role.toString(), reason: 'Panel sudah penuh (maks 25 tombol)' });
                    continue;
                }

                panel.buttons.push({ roleId: role.id, label, style: STYLE_MAP[warnaKey] ?? ButtonStyle.Primary });
                addedCount++;
                results.push({ status: '✅', label, role: role.toString(), warna: STYLE_LABEL[STYLE_MAP[warnaKey]] });
            }

            if (addedCount > 0) { panel.updatedAt = Date.now(); savePanel(client, guild.id, panelName, panel); }

            let statusStr = addedCount > 0 ? `Kirim panel: \`/autorole-button kirim ${panelName}\`` : 'Tidak ada perubahan.';
            if (addedCount > 0) {
                const sentResult = await resolveSentMessage(client, guild, panelName);
                if (sentResult) {
                    try {
                        await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)], components: buildButtonRows(panel) });
                        statusStr = `✅ Pesan terkirim langsung diperbarui!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                    } catch {
                        statusStr = `⚠️ Gagal memperbarui pesan. Kirim ulang: \`/autorole-button kirim ${panelName}\``;
                    }
                }
            }

            const successLines = results.filter(r => r.status === '✅');
            const warnLines    = results.filter(r => r.status === '⚠️');
            const failLines    = results.filter(r => r.status === '❌');
            const summaryParts = [];
            if (successLines.length) summaryParts.push(
                `**✅ Berhasil ditambahkan (${successLines.length}):**\n` +
                successLines.map(r => `> ${r.role} — \`${r.label}\` ${r.warna}`).join('\n')
            );
            if (warnLines.length) summaryParts.push(
                `**⚠️ Dilewati (${warnLines.length}):**\n` +
                warnLines.map(r => `> ${r.role ?? r.label} — ${r.reason}`).join('\n')
            );
            if (failLines.length) summaryParts.push(
                `**❌ Gagal (${failLines.length}):**\n` +
                failLines.map(r => `> \`${r.label}\` — ${r.reason}`).join('\n')
            );

            const color = addedCount === lines.length ? '#57F287' : addedCount > 0 ? '#FEE75C' : '#ED4245';

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setTitle(`📦 Hasil Tambah Bulk — Panel \`${panelName}\``)
                        .setDescription(summaryParts.join('\n\n') || '_Tidak ada yang diproses._')
                        .addFields(
                            { name: '📊 Total Tombol', value: `${panel.buttons.length}/25`, inline: true },
                            { name: '📤 Status',        value: statusStr, inline: false }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button edit-button ───────────────────────────────────
        if (sub === 'edit-button') {
            const panelName = options.getString('panel');
            const roleStr   = options.getString('role');
            const labelBaru = options.getString('label');
            const warnaBaru = options.getString('warna');

            if (!labelBaru && !warnaBaru) {
                return interaction.reply({
                    content: '⚠️ Isi minimal satu field: `label` atau `warna`.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) {
                return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            }

            const sentResult = await resolveSentMessage(client, guild, panelName);
            if (!sentResult) {
                const sentRaw = getSentPanel(client, guild.id, panelName);
                if (!sentRaw) {
                    return interaction.reply({
                        content: [
                            `❌ Panel \`${panelName}\` belum dikirim ke channel manapun.`,
                            `Kirim dulu dengan \`/autorole-button kirim ${panelName}\`, kemudian gunakan \`edit-button\`.`
                        ].join('\n'),
                        flags: MessageFlags.Ephemeral
                    });
                }
                return interaction.reply({
                    content: [
                        `❌ Pesan panel \`${panelName}\` sudah dihapus dari channel.`,
                        `Kirim ulang panel dengan \`/autorole-button kirim ${panelName}\`, kemudian gunakan \`edit-button\`.`
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            const role = resolveRole(guild, roleStr);
            if (!role) {
                return interaction.reply({ content: '❌ Role tidak ditemukan.', flags: MessageFlags.Ephemeral });
            }

            const btnIndex = panel.buttons.findIndex(b => b.roleId === role.id);
            if (btnIndex === -1) {
                return interaction.reply({
                    content: `⚠️ Tidak ada tombol dengan role ${role} di panel \`${panelName}\`.\nTambah dulu dengan \`/autorole-button tambah-button\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const btn       = panel.buttons[btnIndex];
            const labelLama = btn.label;
            const warnaLama = STYLE_LABEL[btn.style] ?? '?';

            if (labelBaru) btn.label = labelBaru.trim();
            if (warnaBaru) btn.style = STYLE_MAP[warnaBaru] ?? btn.style;

            panel.buttons[btnIndex] = btn;
            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            let statusStr = '';
            try {
                await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)], components: buildButtonRows(panel) });
                statusStr = `✅ Pesan terkirim langsung diperbarui!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
            } catch {
                statusStr = `⚠️ Gagal memperbarui pesan. Kirim ulang: \`/autorole-button kirim ${panelName}\``;
            }

            const changeFields = [];
            if (labelBaru) changeFields.push({ name: '🏷️ Label', value: `\`${labelLama}\` → \`${btn.label}\``, inline: true });
            if (warnaBaru) changeFields.push({ name: '🎨 Warna',  value: `${warnaLama} → ${STYLE_LABEL[btn.style] ?? warnaBaru}`, inline: true });

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#FEE75C')
                        .setTitle(`✏️ Tombol Diedit di Panel \`${panelName}\``)
                        .addFields(
                            { name: '🎭 Role', value: `${role}`, inline: false },
                            ...changeFields,
                            { name: '📤 Status', value: statusStr, inline: false }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button edit-bulk ─────────────────────────────────────
        if (sub === 'edit-bulk') {
            const panelName = options.getString('panel');
            const rawData   = options.getString('data');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) {
                return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            }

            const sentResult = await resolveSentMessage(client, guild, panelName);
            if (!sentResult) {
                const sentRaw = getSentPanel(client, guild.id, panelName);
                if (!sentRaw) {
                    return interaction.reply({
                        content: [
                            `❌ Panel \`${panelName}\` belum dikirim ke channel manapun.`,
                            `Kirim dulu dengan \`/autorole-button kirim ${panelName}\`, kemudian gunakan \`edit-bulk\`.`
                        ].join('\n'),
                        flags: MessageFlags.Ephemeral
                    });
                }
                return interaction.reply({
                    content: [
                        `❌ Pesan panel \`${panelName}\` sudah dihapus dari channel.`,
                        `Kirim ulang panel dengan \`/autorole-button kirim ${panelName}\`, kemudian gunakan \`edit-bulk\`.`
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            const lines = rawData.split(/[\n;]/g).map(l => l.trim()).filter(Boolean);
            if (lines.length === 0) {
                return interaction.reply({ content: '❌ Input kosong.', flags: MessageFlags.Ephemeral });
            }

            const results   = [];
            let editedCount = 0;

            for (const line of lines) {
                const parts = line.split('|').map(p => p.trim());
                const [roleStr, labelBaru, warnaBaru] = parts;

                if (!labelBaru && !warnaBaru) {
                    results.push({ status: '❌', label: line, reason: 'Isi minimal label atau warna' });
                    continue;
                }
                if (labelBaru && labelBaru.length > 80) {
                    results.push({ status: '❌', label: labelBaru, reason: 'Label melebihi 80 karakter' });
                    continue;
                }
                const warnaKey = warnaBaru?.toLowerCase();
                if (warnaKey && !['primary','success','danger','secondary'].includes(warnaKey)) {
                    results.push({ status: '❌', label: roleStr, reason: `Warna tidak valid: \`${warnaKey}\`` });
                    continue;
                }

                const role = resolveRole(guild, roleStr);
                if (!role) {
                    results.push({ status: '❌', label: roleStr, reason: `Role \`${roleStr}\` tidak ditemukan` });
                    continue;
                }

                const btnIndex = panel.buttons.findIndex(b => b.roleId === role.id);
                if (btnIndex === -1) {
                    results.push({ status: '⚠️', label: roleStr, role: role.toString(), reason: 'Tidak punya tombol di panel ini' });
                    continue;
                }

                const btn       = panel.buttons[btnIndex];
                const labelLama = btn.label;
                const warnaLama = STYLE_LABEL[btn.style] ?? '?';
                if (labelBaru) btn.label = labelBaru.trim();
                if (warnaKey)  btn.style = STYLE_MAP[warnaKey] ?? btn.style;
                panel.buttons[btnIndex] = btn;
                editedCount++;

                const changes = [];
                if (labelBaru) changes.push(`label: \`${labelLama}\` → \`${btn.label}\``);
                if (warnaKey)  changes.push(`warna: ${warnaLama} → ${STYLE_LABEL[btn.style]}`);
                results.push({ status: '✅', role: role.toString(), changes: changes.join(', ') });
            }

            if (editedCount > 0) { panel.updatedAt = Date.now(); savePanel(client, guild.id, panelName, panel); }

            let statusStr = editedCount > 0 ? '' : 'Tidak ada perubahan.';
            if (editedCount > 0) {
                try {
                    await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)], components: buildButtonRows(panel) });
                    statusStr = `✅ Pesan terkirim langsung diperbarui!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = `⚠️ Gagal memperbarui pesan. Kirim ulang: \`/autorole-button kirim ${panelName}\``;
                }
            }

            const successLines = results.filter(r => r.status === '✅');
            const warnLines    = results.filter(r => r.status === '⚠️');
            const failLines    = results.filter(r => r.status === '❌');
            const summaryParts = [];
            if (successLines.length) summaryParts.push(
                `**✅ Berhasil diedit (${successLines.length}):**\n` +
                successLines.map(r => `> ${r.role} — ${r.changes}`).join('\n')
            );
            if (warnLines.length) summaryParts.push(
                `**⚠️ Dilewati (${warnLines.length}):**\n` +
                warnLines.map(r => `> ${r.role ?? r.label} — ${r.reason}`).join('\n')
            );
            if (failLines.length) summaryParts.push(
                `**❌ Gagal (${failLines.length}):**\n` +
                failLines.map(r => `> \`${r.label}\` — ${r.reason}`).join('\n')
            );

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(editedCount === lines.length ? '#FEE75C' : editedCount > 0 ? '#FEE75C' : '#ED4245')
                        .setTitle(`✏️ Hasil Edit Bulk — Panel \`${panelName}\``)
                        .setDescription(summaryParts.join('\n\n') || '_Tidak ada yang diproses._')
                        .addFields(
                            { name: '📊 Total Tombol', value: `${panel.buttons.length}/25`, inline: true },
                            { name: '📤 Status',        value: statusStr || 'Tidak ada perubahan.', inline: false }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button hapus-button ──────────────────────────────────
        if (sub === 'hapus-button') {
            const panelName = options.getString('panel');
            const roleStr   = options.getString('role');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) {
                return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            }

            const sentResult = await resolveSentMessage(client, guild, panelName);
            if (!sentResult) {
                const sentRaw = getSentPanel(client, guild.id, panelName);
                if (!sentRaw) {
                    return interaction.reply({
                        content: [
                            `❌ Panel \`${panelName}\` belum dikirim ke channel manapun.`,
                            `Kirim dulu dengan \`/autorole-button kirim ${panelName}\`, kemudian gunakan \`hapus-button\`.`
                        ].join('\n'),
                        flags: MessageFlags.Ephemeral
                    });
                }
                return interaction.reply({
                    content: [
                        `❌ Pesan panel \`${panelName}\` sudah dihapus dari channel.`,
                        `Kirim ulang panel dengan \`/autorole-button kirim ${panelName}\`, kemudian gunakan \`hapus-button\`.`
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            const role = resolveRole(guild, roleStr);
            if (!role) {
                return interaction.reply({ content: '❌ Role tidak ditemukan.', flags: MessageFlags.Ephemeral });
            }

            const before = panel.buttons.length;
            panel.buttons = panel.buttons.filter(b => b.roleId !== role.id);

            if (panel.buttons.length === before) {
                return interaction.reply({
                    content: `⚠️ Tidak ada tombol dengan role ${role} di panel \`${panelName}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            let statusStr = '';
            try {
                await sentResult.message.edit({
                    embeds:     [buildPanelEmbed(panel)],
                    components: panel.buttons.length > 0 ? buildButtonRows(panel) : []
                });
                statusStr = `✅ Pesan terkirim langsung diperbarui!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
            } catch {
                statusStr = `⚠️ Gagal memperbarui pesan. Kirim ulang: \`/autorole-button kirim ${panelName}\``;
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle(`🗑️ Tombol Dihapus dari Panel \`${panelName}\``)
                        .setDescription(`Tombol untuk role ${role} telah dihapus.\nSisa: **${panel.buttons.length}** tombol.`)
                        .addFields({ name: '📤 Status', value: statusStr, inline: false })
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button hapus-bulk ────────────────────────────────────
        if (sub === 'hapus-bulk') {
            const panelName = options.getString('panel');
            const rawData   = options.getString('data');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) {
                return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            }

            const sentResult = await resolveSentMessage(client, guild, panelName);
            if (!sentResult) {
                const sentRaw = getSentPanel(client, guild.id, panelName);
                if (!sentRaw) {
                    return interaction.reply({
                        content: [
                            `❌ Panel \`${panelName}\` belum dikirim ke channel manapun.`,
                            `Kirim dulu dengan \`/autorole-button kirim ${panelName}\`, kemudian gunakan \`hapus-bulk\`.`
                        ].join('\n'),
                        flags: MessageFlags.Ephemeral
                    });
                }
                return interaction.reply({
                    content: [
                        `❌ Pesan panel \`${panelName}\` sudah dihapus dari channel.`,
                        `Kirim ulang panel dengan \`/autorole-button kirim ${panelName}\`, kemudian gunakan \`hapus-bulk\`.`
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            const lines = rawData.split(/[\n;,\s]+/g).map(l => l.trim()).filter(Boolean);
            if (lines.length === 0) {
                return interaction.reply({ content: '❌ Input kosong. Masukkan satu @Role per baris.', flags: MessageFlags.Ephemeral });
            }

            const results    = [];
            let deletedCount = 0;

            for (const line of lines) {
                const role = resolveRole(guild, line);
                if (!role) {
                    results.push({ status: '❌', label: line, reason: `Role \`${line}\` tidak ditemukan` });
                    continue;
                }
                const before = panel.buttons.length;
                panel.buttons = panel.buttons.filter(b => b.roleId !== role.id);
                if (panel.buttons.length === before) {
                    results.push({ status: '⚠️', role: role.toString(), reason: 'Tidak punya tombol di panel ini' });
                    continue;
                }
                deletedCount++;
                results.push({ status: '✅', role: role.toString() });
            }

            if (deletedCount > 0) { panel.updatedAt = Date.now(); savePanel(client, guild.id, panelName, panel); }

            let statusStr = deletedCount > 0 ? '' : 'Tidak ada perubahan.';
            if (deletedCount > 0) {
                try {
                    await sentResult.message.edit({
                        embeds:     [buildPanelEmbed(panel)],
                        components: panel.buttons.length > 0 ? buildButtonRows(panel) : []
                    });
                    statusStr = `✅ Pesan terkirim langsung diperbarui!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = `⚠️ Gagal memperbarui pesan. Kirim ulang: \`/autorole-button kirim ${panelName}\``;
                }
            }

            const successLines = results.filter(r => r.status === '✅');
            const warnLines    = results.filter(r => r.status === '⚠️');
            const failLines    = results.filter(r => r.status === '❌');
            const summaryParts = [];
            if (successLines.length) summaryParts.push(`**✅ Berhasil dihapus (${successLines.length}):**\n` + successLines.map(r => `> ${r.role}`).join('\n'));
            if (warnLines.length)    summaryParts.push(`**⚠️ Dilewati (${warnLines.length}):**\n`           + warnLines.map(r => `> ${r.role} — ${r.reason}`).join('\n'));
            if (failLines.length)    summaryParts.push(`**❌ Gagal (${failLines.length}):**\n`               + failLines.map(r => `> \`${r.label}\` — ${r.reason}`).join('\n'));

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(deletedCount > 0 ? '#ED4245' : '#FEE75C')
                        .setTitle(`🗑️ Hasil Hapus Bulk — Panel \`${panelName}\``)
                        .setDescription(summaryParts.join('\n\n') || '_Tidak ada yang diproses._')
                        .addFields(
                            { name: '📊 Sisa Tombol', value: `${panel.buttons.length}/25`, inline: true },
                            { name: '📤 Status',       value: statusStr || 'Tidak ada perubahan.', inline: false }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button color-button ──────────────────────────────────
        if (sub === 'color-button') {
            const panelName = options.getString('panel');
            const warnaKey  = options.getString('warna');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) {
                return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            }

            const warnaLama    = panel.defaultStyle ? (STYLE_LABEL[panel.defaultStyle] ?? '🔵 Biru (Primary)') : '🔵 Biru (Primary)';
            panel.defaultStyle = STYLE_MAP[warnaKey] ?? ButtonStyle.Primary;
            panel.updatedAt    = Date.now();
            savePanel(client, guild.id, panelName, panel);

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#5865F2')
                        .setTitle(`🎨 Warna Default Tombol Diubah — Panel \`${panelName}\``)
                        .setDescription(
                            `Warna default untuk **tombol baru** di panel \`${panelName}\` berhasil diperbarui.\n\n` +
                            `Warna ini hanya berlaku untuk tombol yang **baru ditambahkan**. ` +
                            `Tombol lama tidak berubah — gunakan \`/autorole-button edit-button\` untuk mengubahnya.`
                        )
                        .addFields(
                            { name: '🎨 Warna Lama', value: warnaLama, inline: true },
                            { name: '🎨 Warna Baru', value: STYLE_LABEL[panel.defaultStyle] ?? warnaKey, inline: true }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button preview ────────────────────────────────────────
        if (sub === 'preview') {
            const panelName = options.getString('panel');
            const panel     = getPanel(client, guild.id, panelName);

            if (!panel) {
                return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            }
            if (panel.buttons.length === 0) {
                return interaction.reply({
                    content: `⚠️ Panel \`${panelName}\` belum punya tombol. Tambah dengan \`/autorole-button tambah-button\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const modeLabel = panel.mode === 'single'
                ? '🔘 **Single** – hanya 1 role aktif'
                : '✅ **Multi** – bisa pilih banyak role';

            const sent    = getSentPanel(client, guild.id, panelName);
            const sentStr = sent
                ? `\n📤 Sudah terkirim — [Lihat Pesan](https://discord.com/channels/${guild.id}/${sent.channelId}/${sent.messageId})`
                : '\n📭 Belum dikirim';

            if (panel.messageType === 'plain') {
                return interaction.reply({
                    content: `**Preview Panel \`${panelName}\` (Teks Biasa)**\n\n${panel.plainText || '*(teks kosong)*'}`,
                    components: buildButtonRows(panel),
                    flags: MessageFlags.Ephemeral
                });
            }

            return interaction.reply({
                content: `👁️ **Pratinjau Panel \`${panelName}\`** — ${modeLabel}${sentStr}`,
                embeds:     [buildPanelEmbed(panel)],
                components: buildButtonRows(panel),
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button kirim ──────────────────────────────────────────
        if (sub === 'kirim') {
            const panelName  = options.getString('panel');
            const channelStr = options.getString('channel');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) {
                return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            }
            if (panel.buttons.length === 0) {
                return interaction.reply({
                    content: `⚠️ Panel \`${panelName}\` belum punya tombol. Tambah dulu dengan \`/autorole-button tambah-button\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const existingSent = await resolveSentMessage(client, guild, panelName);
            if (existingSent) {
                return interaction.reply({
                    content: [
                        `❌ Panel \`${panelName}\` sudah pernah dikirim dan masih aktif.`,
                        `Panel autorole-button bersifat **unik** — hanya bisa dikirim 1 kali.`,
                        ``,
                        `Untuk mengubah tampilan atau tombol, gunakan:`,
                        `• \`/autorole-button buat ${panelName}\` — edit judul/deskripsi embed`,
                        `• \`/autorole-button set-warna\` — ubah warna embed`,
                        `• \`/autorole-button edit-button\` — edit label/warna tombol`,
                        `• \`/autorole-button tambah-button\` — tambah tombol baru`,
                        `• \`/autorole-button hapus-button\` — hapus tombol`,
                        ``,
                        `🔗 https://discord.com/channels/${guild.id}/${existingSent.sent.channelId}/${existingSent.sent.messageId}`
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            let targetChannel = interaction.channel;
            if (channelStr) {
                const resolved = resolveChannel(guild, channelStr);
                if (!resolved) {
                    return interaction.reply({ content: '❌ Channel tidak ditemukan.', flags: MessageFlags.Ephemeral });
                }
                targetChannel = resolved;
            }

            const isPlain = panel.messageType === 'plain';

            const chPermsNeeded = isPlain
                ? [PermissionFlagsBits.SendMessages]
                : [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
            const chPermsOk = await checkBotPermissions(interaction, chPermsNeeded, targetChannel);
            if (!chPermsOk) return;

            if (isPlain && !panel.plainText) {
                return interaction.reply({
                    content: `❌ Panel \`${panelName}\` belum punya teks. Gunakan \`/autorole-button tipe plain ${panelName}\` untuk mengatur teksnya.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const sentMsg = isPlain
                ? await targetChannel.send({ content: panel.plainText.slice(0, 2000), components: buildButtonRows(panel) })
                : await targetChannel.send({ embeds: [buildPanelEmbed(panel)], components: buildButtonRows(panel) });

            saveSentPanel(client, guild.id, panelName, sentMsg.id, targetChannel.id);

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('📤 Panel Terkirim!')
                        .setDescription(`Panel \`${panelName}\` berhasil dikirim ke ${targetChannel}.`)
                        .addFields(
                            { name: '🔧 Mode',   value: panel.mode === 'single' ? '🔘 Single (radio)' : '✅ Multi', inline: true },
                            { name: '🎭 Tombol', value: `${panel.buttons.length} tombol`, inline: true },
                            { name: '🔒 Catatan', value: 'Panel bersifat **unik** — tidak bisa dikirim ulang.\nGunakan perintah edit/tambah/hapus-button untuk memperbarui tombol.', inline: false }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-button hapus-panel ────────────────────────────────────
        if (sub === 'hapus-panel') {
            const panelName = options.getString('panel');
            const panel     = getPanel(client, guild.id, panelName);

            if (!panel) {
                return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            }

            // Coba hapus pesan Discord yang sudah terkirim (jika ada)
            let sentNote = '';
            const sentResult = await resolveSentMessage(client, guild, panelName);
            if (sentResult) {
                try {
                    await sentResult.message.delete();
                    sentNote = `\n\n✅ Pesan panel di <#${sentResult.sent.channelId}> berhasil dihapus.`;
                } catch {
                    sentNote = `\n\n⚠️ Gagal menghapus pesan panel di channel. Mungkin sudah dihapus atau bot tidak punya permission.\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                }
            }

            deletePanel(client, guild.id, panelName);
            deleteSentPanel(client, guild.id, panelName);

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('🗑️ Panel Dihapus')
                        .setDescription(
                            `Panel \`${panelName}\` beserta semua konfigurasinya telah dihapus dari database.` +
                            sentNote
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }
    }
}).toJSON();

const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { resolveRole, resolveChannel } = require('../../utils/resolveGuildOption');
const { checkBotPermissions } = require('../../utils/checkBotPermissions');

// ── Helpers panel ──────────────────────────────────────────────────────────

function getPanelList(client, guildId) {
    const raw = client.database.get(`autoreact-list-${guildId}`);
    if (!raw || typeof raw !== 'string') return [];
    try { return JSON.parse(raw); } catch { return []; }
}

function savePanelList(client, guildId, list) {
    client.database.set(`autoreact-list-${guildId}`, JSON.stringify(list));
}

function getPanel(client, guildId, name) {
    const raw = client.database.get(`autoreact-${guildId}-${name}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function savePanel(client, guildId, name, data) {
    client.database.set(`autoreact-${guildId}-${name}`, JSON.stringify(data));
    const list = getPanelList(client, guildId);
    if (!list.includes(name)) { list.push(name); savePanelList(client, guildId, list); }
}

function deletePanel(client, guildId, name) {
    client.database.delete(`autoreact-${guildId}-${name}`);
    savePanelList(client, guildId, getPanelList(client, guildId).filter(n => n !== name));
}

// ── Helpers sentData panel ─────────────────────────────────────────────────

function getSentPanel(client, guildId, panelName) {
    const raw = client.database.get(`autoreact-sent-${guildId}-${panelName}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function saveSentPanel(client, guildId, panelName, messageId, channelId) {
    client.database.set(`autoreact-sent-${guildId}-${panelName}`, JSON.stringify({ messageId, channelId }));
    client.database.set(`autoreact-msgmap-${guildId}-${messageId}`, panelName);
}

function deleteSentPanel(client, guildId, panelName) {
    const sent = getSentPanel(client, guildId, panelName);
    if (sent?.messageId) client.database.delete(`autoreact-msgmap-${guildId}-${sent.messageId}`);
    client.database.delete(`autoreact-sent-${guildId}-${panelName}`);
}

async function resolveSentMessage(client, guild, panelName) {
    const sent = getSentPanel(client, guild.id, panelName);
    if (!sent) return null;
    const channel = guild.channels.cache.get(sent.channelId)
        ?? await guild.channels.fetch(sent.channelId).catch(() => null);
    if (!channel) { deleteSentPanel(client, guild.id, panelName); return null; }
    let message = null;
    try { message = await channel.messages.fetch(sent.messageId); }
    catch { deleteSentPanel(client, guild.id, panelName); return null; }
    return { sent, message, channel };
}

// ── Emoji utilities ────────────────────────────────────────────────────────

// Normalisasi emoji ke format penyimpanan:
//   unicode → karakter itu sendiri  (misal: 👍)
//   custom  → name:id               (misal: gaming:123456789)
function normalizeEmoji(emojiStr) {
    const customMatch = emojiStr.trim().match(/^<a?:([^:]+):(\d+)>$/);
    if (customMatch) return `${customMatch[1]}:${customMatch[2]}`;
    return emojiStr.trim();
}

// Untuk memanggil message.react(): custom pakai ID saja, unicode pakai char
function emojiToReactArg(normalized) {
    const customMatch = normalized.match(/^([a-zA-Z0-9_]+):(\d+)$/);
    return customMatch ? customMatch[2] : normalized;
}

// ── Embed builder ──────────────────────────────────────────────────────────

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

async function addReactionsToMessage(message, reactions) {
    for (const react of reactions) {
        try { await message.react(emojiToReactArg(react.emoji)); } catch { /* emoji tidak valid, lewati */ }
    }
}

function isValidName(name) {
    return /^[a-zA-Z0-9_-]{1,32}$/.test(name);
}

// ── Command ────────────────────────────────────────────────────────────────
module.exports = new ApplicationCommand({
    command: {
        name: 'autorole-reaction',
        description: 'Buat panel reaction emoji untuk member mengambil/melepas role sendiri.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [

            // ── list ──────────────────────────────────────────────────────
            {
                name: 'list',
                description: 'Lihat semua panel autorole reaction yang ada.',
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
                        description: 'Multi = bisa pilih banyak role | Single = hanya boleh 1 role aktif',
                        type: 3,
                        required: false,
                        choices: [
                            { name: '✅ Multi  – bisa ambil banyak role sekaligus', value: 'multi'  },
                            { name: '🔘 Single – hanya boleh 1 role (radio)',        value: 'single' }
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
                    { name: 'panel', description: 'Nama panel', type: 3, required: true, autocomplete: true },
                    { name: 'hex',   description: 'Kode warna hex, contoh: #5865F2 atau FF5733', type: 3, required: true, max_length: 7 }
                ]
            },

            // ── set-gambar ────────────────────────────────────────────────
            {
                name: 'set-gambar',
                description: 'Pasang atau hapus gambar besar di bawah embed panel.',
                type: 1,
                options: [
                    { name: 'panel', description: 'Nama panel', type: 3, required: true, autocomplete: true },
                    { name: 'url',   description: 'URL gambar (https://...). Ketik - untuk menghapus.', type: 3, required: true }
                ]
            },

            // ── set-thumbnail ─────────────────────────────────────────────
            {
                name: 'set-thumbnail',
                description: 'Pasang atau hapus thumbnail (gambar kecil pojok kanan) embed panel.',
                type: 1,
                options: [
                    { name: 'panel', description: 'Nama panel', type: 3, required: true, autocomplete: true },
                    { name: 'url',   description: 'URL thumbnail (https://...). Ketik - untuk menghapus.', type: 3, required: true }
                ]
            },

            // ── tambah-reaction ───────────────────────────────────────────
            {
                name: 'tambah-reaction',
                description: 'Tambah emoji reaction + role ke sebuah panel.',
                type: 1,
                options: [
                    { name: 'panel', description: 'Nama panel tujuan',               type: 3, required: true,  autocomplete: true },
                    { name: 'emoji', description: 'Emoji untuk reaction (misal: 👍 atau emoji kustom)', type: 3, required: true },
                    { name: 'role',  description: 'Role yang diberikan/dicabut saat reaction diklik', type: 3, required: true, autocomplete: true }
                ]
            },

            // ── hapus-reaction ────────────────────────────────────────────
            {
                name: 'hapus-reaction',
                description: 'Hapus sebuah reaction dari panel berdasarkan role.',
                type: 1,
                options: [
                    { name: 'panel', description: 'Nama panel',                       type: 3, required: true, autocomplete: true },
                    { name: 'role',  description: 'Role yang reactionnya ingin dihapus', type: 3, required: true, autocomplete: true }
                ]
            },

            // ── kirim ─────────────────────────────────────────────────────
            {
                name: 'kirim',
                description: 'Kirim panel ke channel tertentu (hanya bisa dikirim 1 kali).',
                type: 1,
                options: [
                    { name: 'panel',   description: 'Nama panel yang akan dikirim',           type: 3, required: true,  autocomplete: true },
                    { name: 'channel', description: 'Channel tujuan (kosong = channel saat ini)', type: 3, required: false, autocomplete: true }
                ]
            },

            // ── hapus-panel ───────────────────────────────────────────────
            {
                name: 'hapus-panel',
                description: 'Hapus seluruh panel dari database.',
                type: 1,
                options: [
                    { name: 'panel', description: 'Nama panel yang akan dihapus', type: 3, required: true, autocomplete: true }
                ]
            },

            // ── preview ───────────────────────────────────────────────────
            {
                name: 'preview',
                description: 'Pratinjau panel (hanya terlihat olehmu).',
                type: 1,
                options: [
                    { name: 'panel', description: 'Nama panel yang ingin dipratinjau', type: 3, required: true, autocomplete: true }
                ]
            },

            // ── tipe ──────────────────────────────────────────────────────
            {
                name: 'tipe',
                description: 'Ubah tipe pesan panel: embed atau teks biasa.',
                type: 1,
                options: [
                    { name: 'panel', description: 'Nama panel', type: 3, required: true, autocomplete: true },
                    {
                        name: 'tipe', description: 'Tipe pesan yang diinginkan',
                        type: 3, required: true,
                        choices: [
                            { name: 'Embed — pesan dalam kotak dengan warna', value: 'embed' },
                            { name: 'Teks Biasa — teks tanpa kotak embed',    value: 'plain' }
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

        const ok = await checkBotPermissions(interaction, [
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ManageRoles,
            PermissionFlagsBits.AddReactions,
            PermissionFlagsBits.ReadMessageHistory,
        ]);
        if (!ok) return;

        // ── /autorole-reaction list ────────────────────────────────────────
        if (sub === 'list') {
            const list = getPanelList(client, guild.id);
            if (list.length === 0) {
                return interaction.reply({
                    content: '📭 Belum ada panel autorole reaction. Buat dengan `/autorole-reaction buat`.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const fields = list.map(name => {
                const panel = getPanel(client, guild.id, name);
                if (!panel) return { name: `\`${name}\``, value: '_Data rusak_', inline: true };
                const modeIcon = panel.mode === 'single' ? '🔘' : '✅';
                const sent     = getSentPanel(client, guild.id, name);
                const sentStr  = sent
                    ? `📤 Terkirim — [Lihat](https://discord.com/channels/${guild.id}/${sent.channelId}/${sent.messageId})`
                    : '📭 Belum dikirim';
                const emojiPreview = (panel.reactions || []).slice(0, 5)
                    .map(r => r.emoji.includes(':') ? `<:${r.emoji}>` : r.emoji).join(' ');
                return {
                    name: `\`${name}\``,
                    value: [
                        `${modeIcon} **Mode:** ${panel.mode === 'single' ? 'Single (radio)' : 'Multi'}`,
                        `✨ **Reactions:** ${panel.reactions?.length ?? 0}${emojiPreview ? ' ' + emojiPreview : ''}`,
                        sentStr
                    ].join('\n'),
                    inline: true
                };
            });

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🗂️ Daftar Panel Autorole Reaction')
                        .setColor('#5865F2')
                        .addFields(fields)
                        .setFooter({ text: `${list.length} panel · ${guild.name}` })
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-reaction tipe ────────────────────────────────────────
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
                    content: `✅ Tipe panel \`${panelName}\` diubah ke **Embed**.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            client.database.set(
                `autoreact-pending-${guild.id}-${interaction.user.id}`,
                JSON.stringify({ nama: panelName, mode: panel.mode || 'multi', isNew: false, pendingType: 'plain' })
            );
            await interaction.showModal({
                custom_id: `autoreact-modal:${panelName}`,
                title: `Teks Biasa: ${panelName}`.slice(0, 45),
                components: [{
                    type: 1,
                    components: [{
                        type: 4, custom_id: 'autoreact-field-plaintext',
                        label: 'Isi Pesan Teks Biasa (maks. 2000)', style: 2,
                        placeholder: 'Tulis isi pesan di sini...',
                        value: panel.plainText || '', required: true, max_length: 2000
                    }]
                }]
            });
            return;
        }

        // ── /autorole-reaction buat ────────────────────────────────────────
        if (sub === 'buat') {
            const nama = options.getString('nama').trim().toLowerCase();
            const mode = options.getString('mode');

            if (!isValidName(nama)) {
                return interaction.reply({
                    content: '❌ Nama panel hanya boleh berisi huruf, angka, `-`, dan `_` (1–32 karakter).',
                    flags: MessageFlags.Ephemeral
                });
            }

            const existing = getPanel(client, guild.id, nama);
            if (!existing && !mode) {
                return interaction.reply({
                    content: '❌ Panel baru memerlukan opsi `mode`. Pilih `multi` atau `single`.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const pendingMode = mode || existing?.mode || 'multi';
            client.database.set(
                `autoreact-pending-${guild.id}-${interaction.user.id}`,
                JSON.stringify({ nama, mode: pendingMode, isNew: !existing })
            );

            await interaction.showModal({
                custom_id: `autoreact-modal:${nama}`,
                title: `Panel Reaction: ${nama}`.slice(0, 45),
                components: [
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'autoreact-field-title',
                            label: 'Judul Embed (maks. 256 karakter)', style: 1,
                            placeholder: 'Contoh: Pilih Role Kamu',
                            value: existing?.embedTitle || '', required: false, max_length: 256
                        }]
                    },
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'autoreact-field-description',
                            label: 'Deskripsi Embed (maks. 4000 karakter)', style: 2,
                            placeholder: 'Jelaskan cara menggunakan reaction di sini...',
                            value: existing?.embedDescription || '', required: false, max_length: 4000
                        }]
                    },
                    {
                        type: 1,
                        components: [{
                            type: 4, custom_id: 'autoreact-field-footer',
                            label: 'Footer Embed (maks. 2048 karakter)', style: 1,
                            placeholder: 'Teks di bagian bawah embed...',
                            value: existing?.embedFooter || '', required: false, max_length: 2048
                        }]
                    }
                ]
            });
            return;
        }

        // ── /autorole-reaction set-warna ───────────────────────────────────
        if (sub === 'set-warna') {
            const panelName = options.getString('panel');
            const hex       = options.getString('hex').trim();
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            if (!/^#?[0-9A-Fa-f]{6}$/.test(hex)) return interaction.reply({ content: '❌ Format warna tidak valid. Contoh: `#FF5733` atau `FF5733`.', flags: MessageFlags.Ephemeral });

            panel.embedColor = hex.startsWith('#') ? hex : `#${hex}`;
            panel.updatedAt  = Date.now();
            savePanel(client, guild.id, panelName, panel);

            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = '📭 Panel belum dikirim.';
            if (sentResult) {
                try {
                    await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)] });
                    statusStr = `✅ Pesan terkirim langsung diperbarui!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = '⚠️ Gagal memperbarui pesan.';
                }
            }

            return interaction.reply({
                content: `✅ Warna embed panel \`${panelName}\` diperbarui ke \`${panel.embedColor}\`.\n${statusStr}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-reaction set-gambar ──────────────────────────────────
        if (sub === 'set-gambar') {
            const panelName = options.getString('panel');
            const url       = options.getString('url').trim();
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });

            if (url === '-') { panel.embedImage = ''; }
            else {
                if (!/^https?:\/\/.+\..+/.test(url)) return interaction.reply({ content: '❌ URL tidak valid.', flags: MessageFlags.Ephemeral });
                panel.embedImage = url;
            }
            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = '📭 Panel belum dikirim.';
            if (sentResult) {
                try {
                    await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)] });
                    statusStr = `✅ Pesan diperbarui!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch { statusStr = '⚠️ Gagal memperbarui pesan.'; }
            }

            return interaction.reply({
                content: `✅ Gambar embed panel \`${panelName}\` ${url === '-' ? '**dihapus**' : 'diperbarui'}.\n${statusStr}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-reaction set-thumbnail ──────────────────────────────
        if (sub === 'set-thumbnail') {
            const panelName = options.getString('panel');
            const url       = options.getString('url').trim();
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });

            if (url === '-') { panel.embedThumbnail = ''; }
            else {
                if (!/^https?:\/\/.+\..+/.test(url)) return interaction.reply({ content: '❌ URL tidak valid.', flags: MessageFlags.Ephemeral });
                panel.embedThumbnail = url;
            }
            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = '📭 Panel belum dikirim.';
            if (sentResult) {
                try {
                    await sentResult.message.edit({ embeds: [buildPanelEmbed(panel)] });
                    statusStr = `✅ Pesan diperbarui!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch { statusStr = '⚠️ Gagal memperbarui pesan.'; }
            }

            return interaction.reply({
                content: `✅ Thumbnail embed panel \`${panelName}\` ${url === '-' ? '**dihapus**' : 'diperbarui'}.\n${statusStr}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-reaction tambah-reaction ────────────────────────────
        if (sub === 'tambah-reaction') {
            const panelName = options.getString('panel');
            const emojiRaw  = options.getString('emoji').trim();
            const roleStr   = options.getString('role');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });

            if ((panel.reactions || []).length >= 20) {
                return interaction.reply({ content: '❌ Satu panel maksimal 20 reaction (batas Discord).', flags: MessageFlags.Ephemeral });
            }

            const emojiNorm = normalizeEmoji(emojiRaw);
            if (!emojiNorm) return interaction.reply({ content: '❌ Emoji tidak valid.', flags: MessageFlags.Ephemeral });

            const role = resolveRole(guild, roleStr);
            if (!role) return interaction.reply({ content: '❌ Role tidak ditemukan.', flags: MessageFlags.Ephemeral });
            if (role.managed || role.id === guild.id) {
                return interaction.reply({ content: '❌ Role ini tidak bisa digunakan (managed atau @everyone).', flags: MessageFlags.Ephemeral });
            }
            if (panel.reactions.some(r => r.roleId === role.id)) {
                return interaction.reply({
                    content: `⚠️ Role ${role} sudah punya reaction di panel \`${panelName}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            if (panel.reactions.some(r => normalizeEmoji(r.emoji) === emojiNorm)) {
                return interaction.reply({
                    content: `⚠️ Emoji tersebut sudah digunakan di panel \`${panelName}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            panel.reactions.push({ emoji: emojiNorm, roleId: role.id });
            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = `Kirim panel dengan \`/autorole-reaction kirim ${panelName}\``;
            if (sentResult) {
                try {
                    await sentResult.message.react(emojiToReactArg(emojiNorm));
                    statusStr = `✅ Reaction ditambahkan ke pesan terkirim!\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = '⚠️ Gagal menambahkan reaction ke pesan (mungkin emoji tidak valid atau sudah ada).';
                }
            }

            const emojiDisplay = emojiNorm.includes(':') ? `<:${emojiNorm}>` : emojiNorm;
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle(`✅ Reaction Ditambahkan ke Panel \`${panelName}\``)
                        .addFields(
                            { name: '✨ Emoji',   value: emojiDisplay,  inline: true },
                            { name: '🎭 Role',   value: `${role}`,       inline: true },
                            { name: '📊 Total',  value: `${panel.reactions.length}/20 reaction`, inline: true },
                            { name: '📤 Status', value: statusStr,        inline: false }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-reaction hapus-reaction ─────────────────────────────
        if (sub === 'hapus-reaction') {
            const panelName = options.getString('panel');
            const roleStr   = options.getString('role');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });

            const role = resolveRole(guild, roleStr);
            if (!role) return interaction.reply({ content: '❌ Role tidak ditemukan.', flags: MessageFlags.Ephemeral });

            const idx = panel.reactions.findIndex(r => r.roleId === role.id);
            if (idx === -1) {
                return interaction.reply({
                    content: `⚠️ Tidak ada reaction dengan role ${role} di panel \`${panelName}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const removed = panel.reactions.splice(idx, 1)[0];
            panel.updatedAt = Date.now();
            savePanel(client, guild.id, panelName, panel);

            const sentResult = await resolveSentMessage(client, guild, panelName);
            let statusStr = '📭 Panel belum dikirim.';
            if (sentResult) {
                try {
                    const reactArg = emojiToReactArg(removed.emoji);
                    const botReaction = sentResult.message.reactions.cache.find(r =>
                        r.emoji.id === reactArg || r.emoji.name === reactArg ||
                        `${r.emoji.name}:${r.emoji.id}` === removed.emoji
                    );
                    if (botReaction) await botReaction.users.remove(sentResult.message.client.user.id).catch(() => null);
                    statusStr = `✅ Reaction dihapus dari pesan terkirim.\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                } catch {
                    statusStr = '⚠️ Gagal menghapus reaction dari pesan.';
                }
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle(`🗑️ Reaction Dihapus dari Panel \`${panelName}\``)
                        .setDescription(`Reaction untuk role ${role} telah dihapus.\nSisa: **${panel.reactions.length}** reaction.`)
                        .addFields({ name: '📤 Status', value: statusStr, inline: false })
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-reaction preview ─────────────────────────────────────
        if (sub === 'preview') {
            const panelName = options.getString('panel');
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            if (!panel.reactions || panel.reactions.length === 0) {
                return interaction.reply({
                    content: `⚠️ Panel \`${panelName}\` belum punya reaction. Tambah dengan \`/autorole-reaction tambah-reaction\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const modeLabel = panel.mode === 'single' ? '🔘 **Single**' : '✅ **Multi**';
            const sent      = getSentPanel(client, guild.id, panelName);
            const sentStr   = sent
                ? `\n📤 Terkirim — [Lihat](https://discord.com/channels/${guild.id}/${sent.channelId}/${sent.messageId})`
                : '\n📭 Belum dikirim';

            const reactList = panel.reactions.map(r => {
                const emojiDisplay = r.emoji.includes(':') ? `<:${r.emoji}>` : r.emoji;
                const roleMention  = guild.roles.cache.get(r.roleId) ? `<@&${r.roleId}>` : r.roleId;
                return `${emojiDisplay} → ${roleMention}`;
            }).join('\n');

            if (panel.messageType === 'plain') {
                return interaction.reply({
                    content: `**Preview \`${panelName}\` (Teks Biasa)** — ${modeLabel}${sentStr}\n\n${panel.plainText || '*(teks kosong)*'}\n\n**Reactions:**\n${reactList}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            return interaction.reply({
                content: `👁️ **Pratinjau \`${panelName}\`** — ${modeLabel}${sentStr}\n\n**Reactions:**\n${reactList}`,
                embeds: [buildPanelEmbed(panel)],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-reaction kirim ───────────────────────────────────────
        if (sub === 'kirim') {
            const panelName  = options.getString('panel');
            const channelStr = options.getString('channel');

            const panel = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });
            if (!panel.reactions || panel.reactions.length === 0) {
                return interaction.reply({
                    content: `⚠️ Panel \`${panelName}\` belum punya reaction. Tambah dulu dengan \`/autorole-reaction tambah-reaction\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const existingSent = await resolveSentMessage(client, guild, panelName);
            if (existingSent) {
                return interaction.reply({
                    content: [
                        `❌ Panel \`${panelName}\` sudah pernah dikirim dan masih aktif.`,
                        `Panel autorole-reaction bersifat **unik** — hanya bisa dikirim 1 kali.`,
                        ``,
                        `Untuk mengubah tampilan atau reaction:`,
                        `• \`/autorole-reaction buat ${panelName}\` — edit judul/deskripsi embed`,
                        `• \`/autorole-reaction tambah-reaction\` — tambah reaction baru`,
                        `• \`/autorole-reaction hapus-reaction\` — hapus reaction`,
                        ``,
                        `🔗 https://discord.com/channels/${guild.id}/${existingSent.sent.channelId}/${existingSent.sent.messageId}`
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            let targetChannel = interaction.channel;
            if (channelStr) {
                const resolved = resolveChannel(guild, channelStr);
                if (!resolved) return interaction.reply({ content: '❌ Channel tidak ditemukan.', flags: MessageFlags.Ephemeral });
                targetChannel = resolved;
            }

            const isPlain = panel.messageType === 'plain';
            const chPermsNeeded = isPlain
                ? [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
                : [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions];
            const chPermsOk = await checkBotPermissions(interaction, chPermsNeeded, targetChannel);
            if (!chPermsOk) return;

            if (isPlain && !panel.plainText) {
                return interaction.reply({
                    content: `❌ Panel \`${panelName}\` belum punya teks. Gunakan \`/autorole-reaction tipe plain\` untuk mengaturnya.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const sentMsg = isPlain
                ? await targetChannel.send({ content: panel.plainText.slice(0, 2000) })
                : await targetChannel.send({ embeds: [buildPanelEmbed(panel)] });

            saveSentPanel(client, guild.id, panelName, sentMsg.id, targetChannel.id);
            await addReactionsToMessage(sentMsg, panel.reactions);

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('📤 Panel Terkirim!')
                        .setDescription(`Panel \`${panelName}\` berhasil dikirim ke ${targetChannel}.`)
                        .addFields(
                            { name: '🔧 Mode',      value: panel.mode === 'single' ? '🔘 Single (radio)' : '✅ Multi', inline: true },
                            { name: '✨ Reactions', value: `${panel.reactions.length} reaction`, inline: true },
                            { name: '🔒 Catatan',   value: 'Panel bersifat **unik** — tidak bisa dikirim ulang.\nGunakan tambah/hapus-reaction untuk memperbarui.', inline: false }
                        )
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-reaction hapus-panel ─────────────────────────────────
        if (sub === 'hapus-panel') {
            const panelName = options.getString('panel');
            const panel     = getPanel(client, guild.id, panelName);
            if (!panel) return interaction.reply({ content: `❌ Panel \`${panelName}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });

            let sentNote = '';
            const sentResult = await resolveSentMessage(client, guild, panelName);
            if (sentResult) {
                try {
                    await sentResult.message.delete();
                    sentNote = `\n\n✅ Pesan panel di <#${sentResult.sent.channelId}> berhasil dihapus.`;
                } catch {
                    sentNote = `\n\n⚠️ Gagal menghapus pesan panel.\n🔗 https://discord.com/channels/${guild.id}/${sentResult.sent.channelId}/${sentResult.sent.messageId}`;
                }
            }

            deletePanel(client, guild.id, panelName);
            deleteSentPanel(client, guild.id, panelName);

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('🗑️ Panel Dihapus')
                        .setDescription(`Panel \`${panelName}\` beserta semua konfigurasinya telah dihapus.${sentNote}`)
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }
    }
}).toJSON();

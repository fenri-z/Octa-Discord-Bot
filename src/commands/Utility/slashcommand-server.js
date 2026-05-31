const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    ChannelType,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { isDeveloper } = require("../../utils/dmGuildProxy");

// ── Label tipe channel ────────────────────────────────────────────────────
const CHANNEL_TYPE_LABEL = {
    [ChannelType.GuildText]:          '💬 Teks',
    [ChannelType.GuildVoice]:         '🔊 Suara',
    [ChannelType.GuildCategory]:      '📁 Kategori',
    [ChannelType.GuildAnnouncement]:  '📢 Pengumuman',
    [ChannelType.GuildStageVoice]:    '🎙️ Stage',
    [ChannelType.GuildForum]:         '🗂️ Forum',
    [ChannelType.GuildMedia]:         '🖼️ Media',
    [ChannelType.AnnouncementThread]: '🔁 Thread Pengumuman',
    [ChannelType.PublicThread]:       '🔁 Thread Publik',
    [ChannelType.PrivateThread]:      '🔒 Thread Privat',
};
function typeLabel(type) {
    return CHANNEL_TYPE_LABEL[type] ?? `❓ Tipe ${type}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

async function sendChunked(interaction, embeds) {
    await interaction.reply({ embeds: [embeds[0]], flags: MessageFlags.Ephemeral });
    for (let i = 1; i < embeds.length; i++) {
        await interaction.followUp({ embeds: [embeds[i]], flags: MessageFlags.Ephemeral });
    }
}

// ── Ambil guild aktif yang sudah dipilih ──────────────────────────────────
function getActiveGuild(client, userId, interaction) {
    // Jika dipanggil dari server langsung (bukan DM), pakai guild tersebut
    if (interaction.guild) return interaction.guild;
    // DM → pakai yang dipilih via /server pilih
    const selectedGuildId = client.database.get(`dm-guild-${userId}`);
    if (!selectedGuildId) return null;
    return client.guilds.cache.get(selectedGuildId) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
module.exports = new ApplicationCommand({
    command: {
        name: 'server',
        description: 'Kelola server aktif untuk kontrol bot lewat DM. (Khusus owner/developer)',
        type: 1,
        options: [
            // ── list ──────────────────────────────────────────────────
            {
                name: 'list',
                description: 'Tampilkan semua server yang diikuti bot.',
                type: 1
            },
            // ── pilih ─────────────────────────────────────────────────
            {
                name: 'pilih',
                description: 'Pilih server aktif untuk dikontrol lewat DM.',
                type: 1,
                options: [
                    {
                        name: 'id',
                        description: 'Pilih atau ketik nama server',
                        type: 3,
                        required: true,
                        autocomplete: true
                    }
                ]
            },
            // ── info ──────────────────────────────────────────────────
            {
                name: 'info',
                description: 'Lihat server aktif yang sedang dipilih.',
                type: 1
            },
            // ── channels ──────────────────────────────────────────────
            {
                name: 'channels',
                description: 'Tampilkan semua channel di server aktif beserta ID-nya.',
                type: 1,
                options: [
                    {
                        name: 'tipe',
                        description: 'Filter berdasarkan tipe channel (kosongkan = semua)',
                        type: 3,
                        required: false,
                        choices: [
                            { name: '💬 Teks',       value: 'text'     },
                            { name: '🔊 Suara',      value: 'voice'    },
                            { name: '📁 Kategori',   value: 'category' },
                            { name: '📢 Pengumuman', value: 'news'     },
                            { name: '🎙️ Stage',      value: 'stage'    },
                            { name: '🗂️ Forum',      value: 'forum'    },
                        ]
                    }
                ]
            },
            // ── roles ─────────────────────────────────────────────────
            {
                name: 'roles',
                description: 'Tampilkan semua role di server aktif beserta ID-nya.',
                type: 1,
                options: [
                    {
                        name: 'filter',
                        description: 'Filter role yang ditampilkan (kosongkan = semua)',
                        type: 3,
                        required: false,
                        choices: [
                            { name: '🤖 Bot / Managed',      value: 'bot'     },
                            { name: '👤 Manual (bukan bot)',  value: 'manual'  },
                            { name: '💎 Booster',             value: 'booster' },
                        ]
                    }
                ]
            },
            // ── commands ──────────────────────────────────────────────
            {
                name: 'commands',
                description: 'Tampilkan semua command server beserta status konfigurasinya.',
                type: 1,
                options: [
                    {
                        name: 'kategori',
                        description: 'Filter berdasarkan kategori command (kosongkan = semua)',
                        type: 3,
                        required: false,
                        choices: [
                            { name: '👋 Member (welcome, goodbye)',         value: 'member'  },
                            { name: '🎭 Role (autorole)',                   value: 'role'    },
                            { name: '💎 Booster',                           value: 'booster' },
                            { name: '📨 Pesan & Embed',                     value: 'pesan'   },
                            { name: '🔧 Utilitas (ping, prefix, invites)',  value: 'utility' },
                        ]
                    }
                ]
            },
            // ── batalkan ──────────────────────────────────────────────
            {
                name: 'batalkan',
                description: 'Batalkan pilihan server aktif.',
                type: 1
            }
        ]
    },

    options: { cooldown: 2000 },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const sub    = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        // ── Hanya owner/developer ─────────────────────────────────────
        if (!isDeveloper(userId)) {
            return interaction.reply({
                content: '❌ Command ini hanya bisa digunakan oleh owner atau developer bot.',
                flags: MessageFlags.Ephemeral
            });
        }

        const isFromGuild = !!interaction.guild;

        // ══════════════════════════════════════════════════════════════
        // LIST
        // ══════════════════════════════════════════════════════════════
        if (sub === 'list') {
            const guilds = [...client.guilds.cache.values()];

            if (guilds.length === 0) {
                return interaction.reply({
                    content: '📭 Bot tidak ada di server manapun saat ini.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const selectedGuildId = client.database.get(`dm-guild-${userId}`);

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle(`🌐 Daftar Server Bot (${guilds.length})`)
                .setDescription(
                    guilds.map((g, i) => {
                        const isActive = g.id === selectedGuildId;
                        const num = String(i + 1).padStart(2, '0');
                        return `\`${num}.\` ${isActive ? '**▶ ' : ''}${g.name}${isActive ? '** *(aktif)*' : ''}\n` +
                               `      ID: \`${g.id}\` · ${g.memberCount} member`;
                    }).join('\n\n')
                )
                .setFooter({ text: 'Gunakan /server pilih <id> untuk memilih server.' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ══════════════════════════════════════════════════════════════
        // PILIH
        // ══════════════════════════════════════════════════════════════
        if (sub === 'pilih') {
            const guildId = interaction.options.getString('id').trim();
            const guild   = client.guilds.cache.get(guildId);

            if (!guild) {
                return interaction.reply({
                    content: `❌ Server dengan ID \`${guildId}\` tidak ditemukan.\nPastikan bot sudah ada di server tersebut. Gunakan \`/server list\` untuk melihat daftar.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            client.database.set(`dm-guild-${userId}`, guildId);

            // Langsung fetch channel & role setelah server dipilih
            await Promise.all([
                guild.channels.fetch().catch(() => null),
                guild.roles.fetch().catch(() => null),
                guild.members.fetch().catch(() => null),
            ]);

            const channelCount = guild.channels.cache.size;
            const roleCount    = guild.roles.cache.size - 1; // kurangi @everyone

            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('✅ Server Aktif Dipilih')
                .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
                .addFields(
                    { name: '🏠 Server',       value: guild.name,             inline: true },
                    { name: '🆔 ID',           value: `\`${guild.id}\``,      inline: true },
                    { name: '👥 Member',        value: `${guild.memberCount}`, inline: true },
                    { name: '📋 Channel',       value: `${channelCount}`,      inline: true },
                    { name: '🎭 Role',          value: `${roleCount}`,         inline: true },
                    { name: '\u200b',           value: '\u200b',               inline: true },
                )
                .setDescription(
                    (isFromGuild
                        ? '> ⚠️ Kamu menggunakan command ini dari dalam server. Untuk kontrol penuh, gunakan lewat **DM bot**.\n'
                        : '') +
                    '> Gunakan `/server channels` atau `/server roles` untuk melihat daftar.'
                )
                .setFooter({ text: 'Gunakan /server batalkan untuk membatalkan pilihan.' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ══════════════════════════════════════════════════════════════
        // INFO
        // ══════════════════════════════════════════════════════════════
        if (sub === 'info') {
            const selectedGuildId = client.database.get(`dm-guild-${userId}`);

            if (!selectedGuildId && !isFromGuild) {
                return interaction.reply({
                    content: '📭 Belum ada server yang dipilih.\nGunakan `/server pilih <id>` untuk memilih server.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const guild = isFromGuild
                ? interaction.guild
                : client.guilds.cache.get(selectedGuildId);

            if (!guild) {
                client.database.delete(`dm-guild-${userId}`);
                return interaction.reply({
                    content: '❌ Server yang dipilih tidak ditemukan lagi. Pilihan telah dihapus otomatis.\nGunakan `/server pilih` untuk memilih server lain.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const botMember   = guild.members.me;
            const botPerms    = botMember?.permissions.toArray() ?? [];
            const hasAdmin    = botPerms.includes('Administrator');
            const hasMsgPerm  = hasAdmin || botPerms.includes('SendMessages');
            const hasRolePerm = hasAdmin || botPerms.includes('ManageRoles');

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('🏠 Server Aktif Saat Ini')
                .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
                .addFields(
                    { name: '🏠 Nama Server',  value: guild.name,                                                    inline: true },
                    { name: '🆔 ID',           value: `\`${guild.id}\``,                                              inline: true },
                    { name: '👥 Total Member', value: `${guild.memberCount}`,                                         inline: true },
                    { name: '👑 Owner Server', value: `<@${guild.ownerId}>`,                                          inline: true },
                    { name: '📅 Dibuat',       value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,           inline: true },
                    { name: '\u200b',          value: '\u200b',                                                       inline: true },
                    { name: '🔑 Izin Bot',
                      value: [
                        `Kirim Pesan: ${hasMsgPerm  ? '✅' : '❌'}`,
                        `Manage Roles: ${hasRolePerm ? '✅' : '❌'}`,
                        `Administrator: ${hasAdmin   ? '✅' : '❌'}`,
                      ].join('\n'),
                      inline: false
                    }
                )
                .setFooter({ text: 'Semua command akan dijalankan di server ini.' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ══════════════════════════════════════════════════════════════
        // CHANNELS
        // ══════════════════════════════════════════════════════════════
        if (sub === 'channels') {
            // Ambil guild aktif (dari server langsung atau dari pilihan DM)
            const guild = getActiveGuild(client, userId, interaction);

            if (!guild) {
                return interaction.reply({
                    content: [
                        '⚠️ **Belum ada server yang dipilih.**',
                        'Gunakan `/server pilih <id>` untuk memilih server terlebih dahulu.',
                        'Gunakan `/server list` untuk melihat daftar server yang tersedia.'
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            await guild.channels.fetch().catch(() => null);

            const tipeFilter = interaction.options.getString('tipe');
            const TIPE_MAP = {
                text:     [ChannelType.GuildText],
                voice:    [ChannelType.GuildVoice],
                category: [ChannelType.GuildCategory],
                news:     [ChannelType.GuildAnnouncement, ChannelType.AnnouncementThread],
                stage:    [ChannelType.GuildStageVoice],
                forum:    [ChannelType.GuildForum, ChannelType.GuildMedia],
            };

            let channels = [...guild.channels.cache.values()];
            if (tipeFilter && TIPE_MAP[tipeFilter]) {
                channels = channels.filter(c => TIPE_MAP[tipeFilter].includes(c.type));
            }

            // Urutkan: kategori dulu, lalu nama
            channels.sort((a, b) => {
                if (a.type === ChannelType.GuildCategory && b.type !== ChannelType.GuildCategory) return -1;
                if (b.type === ChannelType.GuildCategory && a.type !== ChannelType.GuildCategory) return 1;
                return a.name.localeCompare(b.name);
            });

            if (channels.length === 0) {
                return interaction.reply({
                    content: `📭 Tidak ada channel${tipeFilter ? ` dengan tipe **${tipeFilter}**` : ''} di server ini.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const lines  = channels.map(c =>
                `${typeLabel(c.type)} **${c.name}**\n> ID: \`${c.id}\``
            );
            const pages  = chunk(lines, 20);
            const total  = channels.length;
            const embeds = pages.map((page, i) =>
                new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle(
                        i === 0
                            ? `📋 Channel — ${guild.name}${tipeFilter ? ` (${tipeFilter})` : ''}`
                            : `📋 Channel (lanjutan ${i + 1}/${pages.length})`
                    )
                    .setDescription(page.join('\n'))
                    .setFooter({
                        text: `Total: ${total} channel · Server: ${guild.name}${tipeFilter ? ` · Filter: ${tipeFilter}` : ''}`
                    })
                    .setTimestamp()
            );

            return sendChunked(interaction, embeds);
        }

        // ══════════════════════════════════════════════════════════════
        // ROLES
        // ══════════════════════════════════════════════════════════════
        if (sub === 'roles') {
            const guild = getActiveGuild(client, userId, interaction);

            if (!guild) {
                return interaction.reply({
                    content: [
                        '⚠️ **Belum ada server yang dipilih.**',
                        'Gunakan `/server pilih <id>` untuk memilih server terlebih dahulu.',
                        'Gunakan `/server list` untuk melihat daftar server yang tersedia.'
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            await guild.roles.fetch().catch(() => null);

            const filter = interaction.options.getString('filter');

            let roles = [...guild.roles.cache.values()]
                .filter(r => r.id !== guild.id); // hapus @everyone

            if (filter === 'bot')     roles = roles.filter(r => r.managed);
            if (filter === 'manual')  roles = roles.filter(r => !r.managed);
            if (filter === 'booster') roles = roles.filter(r => r.tags?.premiumSubscriberRole);

            // Urutkan dari posisi tertinggi ke terendah
            roles.sort((a, b) => b.position - a.position);

            if (roles.length === 0) {
                return interaction.reply({
                    content: `📭 Tidak ada role${filter ? ` dengan filter **${filter}**` : ''} di server ini.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const lines = roles.map(r => {
                // 🛡️ = role administrator/managed (bot/integration)
                // 🎭 = role custom biasa
                const isAdmin = r.managed || r.permissions?.has?.('Administrator');
                const emoji   = isAdmin ? '🛡️' : '🎭';
                return `${emoji} <@&${r.id}> **${r.name}**\n> ID: \`${r.id}\``;
            });

            const pages  = chunk(lines, 15);
            const total  = roles.length;
            const embeds = pages.map((page, i) =>
                new EmbedBuilder()
                    .setColor('#FF73FA')
                    .setTitle(
                        i === 0
                            ? `🎭 Role — ${guild.name}${filter ? ` (${filter})` : ''}`
                            : `🎭 Role (lanjutan ${i + 1}/${pages.length})`
                    )
                    .setDescription(page.join('\n'))
                    .setFooter({
                        text: `Total: ${total} role · Server: ${guild.name}${filter ? ` · Filter: ${filter}` : ''} · Urutan: tertinggi → terendah`
                    })
                    .setTimestamp()
            );

            return sendChunked(interaction, embeds);
        }

        // ══════════════════════════════════════════════════════════════
        // COMMANDS
        // ══════════════════════════════════════════════════════════════
        if (sub === 'commands') {
            const guild = getActiveGuild(client, userId, interaction);

            if (!guild) {
                return interaction.reply({
                    content: [
                        '⚠️ **Belum ada server yang dipilih.**',
                        'Gunakan `/server pilih <id>` untuk memilih server terlebih dahulu.',
                        'Gunakan `/server list` untuk melihat daftar server yang tersedia.'
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            const guildId   = guild.id;
            const kategori  = interaction.options.getString('kategori');

            // ── Helper baca db ────────────────────────────────────────
            const db = client.database;
            const getBoolCmd = (key, def) => {
                const raw = db.get(key);
                if (raw === null || raw === undefined) return def;
                if (raw === 'false' || raw === false || raw === 0) return false;
                return true;
            };
            const getStr = (key, fallback = null) => db.get(key) ?? fallback;
            const channelMention = (id) => id ? `<#${id}>` : '`belum diatur`';
            const roleMention    = (id) => id ? `<@&${id}>` : '`belum diatur`';
            const tick = (val) => val ? '✅ Aktif' : '❌ Nonaktif';

            // ── Definisi semua command beserta status ─────────────────
            const ALL_CATEGORIES = {

                member: {
                    label: '👋 Member',
                    commands: [
                        {
                            name: '`/welcome`',
                            desc: 'Pesan sambutan member baru.',
                            fields: [
                                { name: 'Status',   value: tick(getBoolCmd(`welcome-enabled-${guildId}`, true)),          inline: true },
                                { name: 'Channel',  value: channelMention(getStr(`welcome-channel-${guildId}`)),           inline: true },
                                { name: 'Thumbnail',value: tick(getBoolCmd(`welcome-thumbnail-${guildId}`, true)),         inline: true },
                                { name: 'Judul',    value: `\`${getStr(`welcome-title-${guildId}`, '👋 Selamat Datang di {server}!')}\``, inline: false },
                            ]
                        },
                        {
                            name: '`/goodbye`',
                            desc: 'Pesan perpisahan member keluar.',
                            fields: [
                                { name: 'Status',   value: tick(getBoolCmd(`goodbye-enabled-${guildId}`, true)),           inline: true },
                                { name: 'Channel',  value: channelMention(getStr(`goodbye-channel-${guildId}`)),           inline: true },
                                { name: 'Thumbnail',value: tick(getBoolCmd(`goodbye-thumbnail-${guildId}`, true)),         inline: true },
                                { name: 'Judul',    value: `\`${getStr(`goodbye-title-${guildId}`, '👋 Selamat Tinggal!')}\``, inline: false },
                            ]
                        },
                    ]
                },

                role: {
                    label: '🎭 Role',
                    commands: [
                        {
                            name: '`/autorole`',
                            desc: 'Role otomatis saat member/bot bergabung.',
                            fields: [
                                { name: 'Human — Status', value: tick(getBoolCmd(`autorole-human-enabled-${guildId}`, false)), inline: true },
                                { name: 'Human — Role',   value: roleMention(getStr(`autorole-human-role-${guildId}`)),        inline: true },
                                { name: '\u200b',          value: '\u200b',                                                     inline: true },
                                { name: 'Bot — Status',   value: tick(getBoolCmd(`autorole-bot-enabled-${guildId}`, false)),   inline: true },
                                { name: 'Bot — Role',     value: roleMention(getStr(`autorole-bot-role-${guildId}`)),          inline: true },
                                { name: '\u200b',          value: '\u200b',                                                     inline: true },
                            ]
                        },
                    ]
                },

                booster: {
                    label: '💎 Booster',
                    commands: [
                        {
                            name: '`/booster`',
                            desc: 'Notifikasi & autorole untuk server booster.',
                            fields: [
                                { name: '🚀 Boost — Status',   value: tick(getBoolCmd(`booster-boost-enabled-${guildId}`, false)),      inline: true },
                                { name: '🚀 Boost — Channel',  value: channelMention(getStr(`booster-boost-channel-${guildId}`)),       inline: true },
                                { name: '\u200b',               value: '\u200b',                                                         inline: true },
                                { name: '💔 Unboost — Status', value: tick(getBoolCmd(`booster-unboost-enabled-${guildId}`, false)),    inline: true },
                                { name: '💔 Unboost — Channel',value: channelMention(getStr(`booster-unboost-channel-${guildId}`)),     inline: true },
                                { name: '\u200b',               value: '\u200b',                                                         inline: true },
                                { name: '🎭 Autorole — Status',value: tick(getBoolCmd(`booster-autorole-enabled-${guildId}`, false)),   inline: true },
                                { name: '🎭 Autorole — Role',  value: roleMention(getStr(`booster-autorole-role-${guildId}`)),          inline: true },
                                { name: '🗑️ Auto-remove',      value: tick(getBoolCmd(`booster-autoremove-enabled-${guildId}`, false)), inline: true },
                            ]
                        },
                    ]
                },

                pesan: {
                    label: '📨 Pesan & Embed',
                    commands: [
                        {
                            name: '`/pesan`',
                            desc: 'Template pesan tersimpan yang bisa dikirim ke channel manapun.',
                            fields: (() => {
                                const raw  = db.get(`pesan-list-${guildId}`);
                                let list   = [];
                                try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
                                return [
                                    {
                                        name:  'Template Tersimpan',
                                        value: list.length
                                            ? list.map(n => `\`${n}\``).join(', ')
                                            : '`(belum ada template)`',
                                        inline: false
                                    }
                                ];
                            })()
                        },
                        {
                            name: '`/embed`',
                            desc: 'Buat & kirim embed custom ke channel server.',
                            fields: [
                                { name: 'Cara pakai', value: '`/embed buat` → edit → `/embed kirim`', inline: false }
                            ]
                        },
                    ]
                },

                utility: {
                    label: '🔧 Utilitas',
                    commands: [
                        {
                            name: '`/ping`',
                            desc: 'Cek latensi bot ke Discord API.',
                            fields: [
                                { name: 'Cara pakai', value: '`/ping`', inline: false }
                            ]
                        },
                        {
                            name: '`!setprefix`',
                            desc: 'Ubah prefix message command untuk server ini.',
                            fields: [
                                { name: 'Prefix saat ini', value: `\`${getStr(`prefix-${guildId}`, '!')}\``, inline: false }
                            ]
                        },
                        {
                            name: '`/invites`',
                            desc: 'Lihat total undangan seorang member.',
                            fields: [
                                { name: 'Cara pakai', value: '`/invites [member]`', inline: false }
                            ]
                        },
                        {
                            name: '`/serverstats`',
                            desc: 'Channel voice otomatis yang menampilkan jumlah member, user, dan bot.',
                            fields: (() => {
                                const getBoolCmd = (key, def) => {
                                    const raw = db.get(key);
                                    if (raw === null || raw === undefined) return def;
                                    if (raw === 'false' || raw === false || raw === 0) return false;
                                    return true;
                                };
                                const enabled    = getBoolCmd(`serverstats-enabled-${guildId}`, false);
                                const categoryId = getStr(`serverstats-category-${guildId}`);
                                const totalId    = getStr(`serverstats-total-channel-${guildId}`);
                                const humanId    = getStr(`serverstats-human-channel-${guildId}`);
                                const botId      = getStr(`serverstats-bot-channel-${guildId}`);
                                const totalLabel = getStr(`serverstats-total-label-${guildId}`, '👥 Total Member: {count}');
                                const humanLabel = getStr(`serverstats-human-label-${guildId}`, '👤 User: {count}');
                                const botLabel   = getStr(`serverstats-bot-label-${guildId}`,   '🤖 Bot: {count}');
                                return [
                                    { name: 'Status',           value: enabled ? '✅ Aktif' : '❌ Nonaktif', inline: true  },
                                    { name: 'Kategori',         value: categoryId ? `<#${categoryId}>` : '`belum diatur`', inline: true },
                                    { name: '\u200b',           value: '\u200b', inline: true },
                                    { name: 'Channel Total',    value: totalId    ? `<#${totalId}>`    : '`belum diatur`', inline: true  },
                                    { name: 'Channel User',     value: humanId    ? `<#${humanId}>`    : '`belum diatur`', inline: true  },
                                    { name: 'Channel Bot',      value: botId      ? `<#${botId}>`      : '`belum diatur`', inline: true  },
                                    { name: 'Format Total',     value: `\`${totalLabel}\``, inline: false },
                                    { name: 'Format User',      value: `\`${humanLabel}\``, inline: true  },
                                    { name: 'Format Bot',       value: `\`${botLabel}\``,   inline: true  },
                                ];
                            })()
                        },
                    ]
                },
            };

            // ── Tentukan kategori yang akan ditampilkan ────────────────
            const selectedCats = kategori
                ? (ALL_CATEGORIES[kategori] ? [ALL_CATEGORIES[kategori]] : [])
                : Object.values(ALL_CATEGORIES);

            if (selectedCats.length === 0) {
                return interaction.reply({
                    content: `❌ Kategori **${kategori}** tidak dikenali.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // ── Bangun embed per-kategori ──────────────────────────────
            const COLOR_MAP = {
                member:  '#57F287',
                role:    '#FF73FA',
                booster: '#FEE75C',
                pesan:   '#5865F2',
                utility: '#EB459E',
            };
            const catKey = kategori ?? 'semua';
            const baseColor = COLOR_MAP[kategori] ?? '#5865F2';

            const embeds = [];

            for (const cat of selectedCats) {
                for (const cmd of cat.commands) {
                    const embed = new EmbedBuilder()
                        .setColor(baseColor)
                        .setAuthor({ name: `${cat.label} · ${guild.name}` })
                        .setTitle(cmd.name)
                        .setDescription(`> ${cmd.desc}`)
                        .addFields(cmd.fields)
                        .setTimestamp();
                    embeds.push(embed);
                }
            }

            // Tambah embed ringkasan di awal
            const summaryEmbed = new EmbedBuilder()
                .setColor(baseColor)
                .setTitle(`🗂️ Daftar Command — ${guild.name}`)
                .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
                .setDescription(
                    selectedCats.map(cat =>
                        `**${cat.label}**\n` +
                        cat.commands.map(c => `• ${c.name} — ${c.desc}`).join('\n')
                    ).join('\n\n') +
                    '\n\n> Gunakan `/server commands kategori:<nama>` untuk melihat detail per kategori.'
                )
                .setFooter({
                    text: `Server: ${guild.name}${kategori ? ` · Kategori: ${kategori}` : ' · Semua kategori'}`
                })
                .setTimestamp();

            // Gabung: summary + detail per command
            const allEmbeds = [summaryEmbed, ...embeds];

            // Discord max 10 embeds per message — kirim bertahap jika > 10
            const BATCH = 10;
            await interaction.reply({
                embeds: allEmbeds.slice(0, BATCH),
                flags: MessageFlags.Ephemeral
            });
            for (let i = BATCH; i < allEmbeds.length; i += BATCH) {
                await interaction.followUp({
                    embeds: allEmbeds.slice(i, i + BATCH),
                    flags: MessageFlags.Ephemeral
                });
            }
            return;
        }

        // ══════════════════════════════════════════════════════════════
        // BATALKAN
        // ══════════════════════════════════════════════════════════════
        if (sub === 'batalkan') {
            const existing = client.database.get(`dm-guild-${userId}`);

            if (!existing) {
                return interaction.reply({
                    content: '⚠️ Tidak ada server aktif yang dipilih.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const guild = client.guilds.cache.get(existing);
            client.database.delete(`dm-guild-${userId}`);

            return interaction.reply({
                content: `✅ Pilihan server **${guild?.name ?? existing}** telah dibatalkan.\nCommand dari DM tidak akan diteruskan ke server manapun sampai kamu memilih server lagi.`,
                flags: MessageFlags.Ephemeral
            });
        }
    }
}).toJSON();

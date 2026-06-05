const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");

function getBool(client, key, def = false) {
    const raw = client.database.get(key);
    if (raw === null || raw === undefined) return def;
    return raw !== 'false' && raw !== false && raw !== 0;
}

function getJSON(client, key, def = null) {
    const raw = client.database.get(key);
    if (!raw) return def;
    try { return JSON.parse(raw); } catch { return def; }
}

function getConfig(client, guildId) {
    const spam        = getJSON(client, `automod-spam-${guildId}`,        { enabled: false, limit: 5, interval: 5 });
    const massmention = getJSON(client, `automod-massmention-${guildId}`, { enabled: false, limit: 5 });
    const antiraid    = getJSON(client, `automod-antiraid-${guildId}`,    { enabled: false, joinLimit: 10, interval: 10 });
    return {
        antilink:    getBool(client, `automod-antilink-${guildId}`),
        antiinvite:  getBool(client, `automod-antiinvite-${guildId}`),
        attachments: getBool(client, `automod-attachments-${guildId}`),
        spam,
        massmention,
        antiraid,
        muteDuration: parseInt(client.database.get(`automod-mute-duration-${guildId}`) || '600000'),
        auditLog:    client.database.get(`automod-auditlog-${guildId}`)  ?? null,
        action:      client.database.get(`automod-action-${guildId}`)   ?? 'delete',
        words:       getJSON(client, `automod-words-${guildId}`,        []),
        wlChannels:  getJSON(client, `automod-wl-channels-${guildId}`,  []),
        wlRoles:     getJSON(client, `automod-wl-roles-${guildId}`,     []),
    };
}

module.exports = new ApplicationCommand({
    command: {
        name: 'automod',
        description: 'Sistem moderasi otomatis untuk melindungi server dari spam, link, dan pelanggaran lainnya.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            {
                type: 1,
                name: 'config',
                description: 'Lihat konfigurasi automod saat ini.'
            },
            {
                type: 1,
                name: 'guide',
                description: 'Panduan penggunaan sistem automod.'
            },
            {
                type: 1,
                name: 'muteperms',
                description: 'Panduan pengaturan izin mute untuk bot.'
            },
            {
                type: 1,
                name: 'action',
                description: 'Atur tindakan yang dilakukan bot saat ada pelanggaran.',
                options: [
                    {
                        type: 3,
                        name: 'tipe',
                        description: 'Tindakan yang dilakukan saat pelanggaran terdeteksi.',
                        required: true,
                        choices: [
                            { name: 'Delete — Hanya hapus pesan',          value: 'delete' },
                            { name: 'Warn — Hapus pesan + peringatkan DM', value: 'warn'   },
                            { name: 'Mute — Hapus pesan + mute sementara', value: 'mute'   },
                            { name: 'Kick — Hapus pesan + kick member',    value: 'kick'   },
                            { name: 'Ban  — Hapus pesan + ban member',     value: 'ban'    },
                        ]
                    }
                ]
            },
            {
                type: 1,
                name: 'antilink',
                description: 'Aktifkan/nonaktifkan proteksi anti-link (semua URL).',
                options: [
                    { type: 5, name: 'aktif', description: 'Aktifkan atau nonaktifkan.', required: true }
                ]
            },
            {
                type: 1,
                name: 'antiinvite',
                description: 'Aktifkan/nonaktifkan proteksi anti Discord invite.',
                options: [
                    { type: 5, name: 'aktif', description: 'Aktifkan atau nonaktifkan.', required: true }
                ]
            },
            {
                type: 1,
                name: 'spam',
                description: 'Konfigurasi proteksi anti-spam.',
                options: [
                    { type: 5, name: 'aktif',    description: 'Aktifkan atau nonaktifkan.',                               required: true  },
                    { type: 4, name: 'limit',    description: 'Jumlah pesan maksimal per interval (default: 5).',         required: false, min_value: 2, max_value: 20 },
                    { type: 4, name: 'interval', description: 'Interval pengecekan dalam detik (default: 5).',            required: false, min_value: 1, max_value: 30 }
                ]
            },
            {
                type: 1,
                name: 'massmention',
                description: 'Konfigurasi proteksi anti mass-mention.',
                options: [
                    { type: 5, name: 'aktif', description: 'Aktifkan atau nonaktifkan.',                                  required: true  },
                    { type: 4, name: 'limit', description: 'Jumlah mention maksimal dalam satu pesan (default: 5).',     required: false, min_value: 2, max_value: 20 }
                ]
            },
            {
                type: 1,
                name: 'attachments',
                description: 'Aktifkan/nonaktifkan filter attachment/file dalam pesan.',
                options: [
                    { type: 5, name: 'aktif', description: 'Aktifkan atau nonaktifkan.', required: true }
                ]
            },
            {
                type: 1,
                name: 'mute',
                description: 'Atur durasi timeout saat tindakan mute (menggunakan Discord Timeout bawaan).',
                options: [
                    {
                        type: 3,
                        name: 'durasi',
                        description: 'Berapa lama member di-timeout.',
                        required: true,
                        choices: [
                            { name: '1 menit',   value: '60000'     },
                            { name: '5 menit',   value: '300000'    },
                            { name: '10 menit',  value: '600000'    },
                            { name: '30 menit',  value: '1800000'   },
                            { name: '1 jam',     value: '3600000'   },
                            { name: '1 hari',    value: '86400000'  },
                        ]
                    }
                ]
            },
            {
                type: 1,
                name: 'auditlog',
                description: 'Atur channel untuk log aktivitas automod.',
                options: [
                    { type: 7, name: 'channel', description: 'Channel teks untuk log automod.', required: true, channel_types: [0] }
                ]
            },
            {
                type: 1,
                name: 'antiraid',
                description: 'Konfigurasi proteksi anti-raid (join massal dalam waktu singkat).',
                options: [
                    { type: 5, name: 'aktif',       description: 'Aktifkan atau nonaktifkan.',                            required: true  },
                    { type: 4, name: 'join_limit',  description: 'Jumlah join per interval yang dianggap raid (def: 10)', required: false, min_value: 2,  max_value: 50 },
                    { type: 4, name: 'interval',    description: 'Interval dalam detik (default: 10).',                   required: false, min_value: 5,  max_value: 60 }
                ]
            },
            {
                type: 2,
                name: 'words',
                description: 'Kelola daftar kata terlarang.',
                options: [
                    {
                        type: 1,
                        name: 'add',
                        description: 'Tambahkan kata ke daftar terlarang.',
                        options: [
                            { type: 3, name: 'kata', description: 'Kata yang ingin dilarang.', required: true }
                        ]
                    },
                    {
                        type: 1,
                        name: 'list',
                        description: 'Lihat semua kata terlarang.'
                    },
                    {
                        type: 1,
                        name: 'delete',
                        description: 'Hapus kata dari daftar terlarang.',
                        options: [
                            { type: 3, name: 'kata', description: 'Kata yang ingin dihapus.', required: true }
                        ]
                    }
                ]
            },
            {
                type: 2,
                name: 'whitelist',
                description: 'Kelola channel/role yang bebas dari pemeriksaan automod.',
                options: [
                    {
                        type: 1,
                        name: 'add',
                        description: 'Tambah channel atau role ke whitelist.',
                        options: [
                            { type: 7, name: 'channel', description: 'Channel yang di-whitelist.',         required: false, channel_types: [0] },
                            { type: 8, name: 'role',    description: 'Role yang di-whitelist.',             required: false }
                        ]
                    },
                    {
                        type: 1,
                        name: 'remove',
                        description: 'Hapus channel atau role dari whitelist.',
                        options: [
                            { type: 7, name: 'channel', description: 'Channel yang dihapus dari whitelist.', required: false, channel_types: [0] },
                            { type: 8, name: 'role',    description: 'Role yang dihapus dari whitelist.',     required: false }
                        ]
                    },
                    {
                        type: 1,
                        name: 'list',
                        description: 'Lihat semua channel dan role yang di-whitelist.'
                    }
                ]
            }
        ]
    },

    options: {
        botOwner: false
    },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const { guild, options } = interaction;
        const subGroup = options.getSubcommandGroup(false);
        const sub      = options.getSubcommand();
        const guildId  = guild.id;

        // ── /automod config ────────────────────────────────────────────────
        if (!subGroup && sub === 'config') {
            const cfg = getConfig(client, guildId);
            const auditCh   = cfg.auditLog ? guild.channels.cache.get(cfg.auditLog) : null;
            const actionMap = { delete: '🗑️ Delete', warn: '⚠️ Warn', mute: '🔇 Mute', kick: '👢 Kick', ban: '🔨 Ban' };
            const durationLabel = {
                60000: '1 menit', 300000: '5 menit', 600000: '10 menit',
                1800000: '30 menit', 3600000: '1 jam', 86400000: '1 hari'
            };

            const wordsPreview = cfg.words.length > 0
                ? cfg.words.slice(0, 15).map(w => `\`${w}\``).join(', ') + (cfg.words.length > 15 ? ` *(+${cfg.words.length - 15} lagi)*` : '')
                : '`Belum ada`';

            const wlCh = cfg.wlChannels.map(id => `<#${id}>`).join(', ')   || '`Tidak ada`';
            const wlRl = cfg.wlRoles.map(id => `<@&${id}>`).join(', ')     || '`Tidak ada`';

            const embed = new EmbedBuilder()
                .setTitle('🛡️ Konfigurasi Automod')
                .setColor('#5865F2')
                .addFields(
                    { name: '⚔️ Tindakan Pelanggaran', value: actionMap[cfg.action] ?? cfg.action,                                  inline: true },
                    { name: '🔇 Durasi Timeout',        value: durationLabel[cfg.muteDuration] ?? `${cfg.muteDuration / 60000} menit`, inline: true },
                    { name: '📋 Channel Log',           value: auditCh ? `${auditCh}` : '`Belum diatur`',                            inline: true },
                    { name: '🔗 Anti-Link',             value: cfg.antilink    ? '✅ Aktif' : '❌ Nonaktif', inline: true },
                    { name: '📨 Anti-Invite',           value: cfg.antiinvite  ? '✅ Aktif' : '❌ Nonaktif', inline: true },
                    { name: '📎 Anti-Attachment',       value: cfg.attachments ? '✅ Aktif' : '❌ Nonaktif', inline: true },
                    {
                        name: '🔁 Anti-Spam',
                        value: cfg.spam.enabled
                            ? `✅ Aktif — maks. **${cfg.spam.limit}** pesan / **${cfg.spam.interval}** detik`
                            : '❌ Nonaktif',
                        inline: false
                    },
                    {
                        name: '📢 Anti Mass-Mention',
                        value: cfg.massmention.enabled
                            ? `✅ Aktif — maks. **${cfg.massmention.limit}** mention per pesan`
                            : '❌ Nonaktif',
                        inline: false
                    },
                    {
                        name: '🚨 Anti-Raid',
                        value: cfg.antiraid.enabled
                            ? `✅ Aktif — maks. **${cfg.antiraid.joinLimit}** join / **${cfg.antiraid.interval}** detik`
                            : '❌ Nonaktif',
                        inline: false
                    },
                    { name: '🚫 Kata Terlarang',       value: wordsPreview, inline: false },
                    { name: '✅ Whitelist Channel',    value: wlCh,         inline: true  },
                    { name: '✅ Whitelist Role',       value: wlRl,         inline: true  }
                )
                .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) ?? undefined })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── /automod guide ─────────────────────────────────────────────────
        if (!subGroup && sub === 'guide') {
            const embed = new EmbedBuilder()
                .setTitle('📖 Panduan Automod')
                .setColor('#5865F2')
                .setDescription([
                    '**Sistem Automod** melindungi server dari berbagai ancaman secara otomatis.',
                    '',
                    '**Langkah Setup:**',
                    '1. Atur tindakan: `/automod action`',
                    '2. (Opsional) Set role mute: `/automod mute`',
                    '3. (Opsional) Set channel log: `/automod auditlog`',
                    '4. Aktifkan proteksi yang diinginkan:',
                    '   • `/automod antilink aktif:true`',
                    '   • `/automod antiinvite aktif:true`',
                    '   • `/automod spam aktif:true`',
                    '   • `/automod massmention aktif:true`',
                    '   • `/automod attachments aktif:true`',
                    '   • `/automod antiraid aktif:true`',
                    '5. Tambah kata terlarang: `/automod words add`',
                    '6. Whitelist channel/role: `/automod whitelist add`',
                    '',
                    '**Tindakan Tersedia:**',
                    '🗑️ `delete` — Hapus pesan pelanggar saja',
                    '⚠️ `warn` — Hapus pesan + kirim peringatan ke DM',
                    '🔇 `mute` — Hapus pesan + beri role mute 10 menit',
                    '👢 `kick` — Hapus pesan + kick member',
                    '🔨 `ban` — Hapus pesan + ban member',
                    '',
                    '💡 Gunakan `/automod config` untuk melihat status lengkap.'
                ].join('\n'))
                .setFooter({ text: 'Gunakan /automod muteperms untuk panduan setup role mute.' });

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── /automod muteperms ─────────────────────────────────────────────
        if (!subGroup && sub === 'muteperms') {
            const embed = new EmbedBuilder()
                .setTitle('🔇 Panduan Setup Izin Timeout (Mute)')
                .setColor('#FEE75C')
                .setDescription([
                    'Fitur **Mute** sekarang menggunakan **Discord Timeout** bawaan.',
                    'Tidak perlu membuat role mute! Jauh lebih simpel dan tidak bisa dibypass.',
                    '',
                    '**Yang dibutuhkan:**',
                    '',
                    '**1. Permission Bot: Moderate Members**',
                    '• Buka **Server Settings → Roles → [Role Bot]**',
                    '• Centang ✅ **Moderate Members** (atau **Timeout Members**)',
                    '',
                    '**2. Atur Durasi Timeout**',
                    '• Gunakan `/automod mute durasi:10 menit`',
                    '• Pilihan: 1 menit / 5 menit / 10 menit / 30 menit / 1 jam / 1 hari',
                    '',
                    '**3. Set Tindakan ke Mute**',
                    '• Gunakan `/automod action tipe:Mute`',
                    '',
                    '**Cara kerja Discord Timeout:**',
                    '• Member tidak bisa kirim pesan, reply, atau react',
                    '• Berlaku di **semua channel** tanpa perlu setting per channel',
                    '• Timeout otomatis berakhir setelah durasi habis',
                    '• Tidak bisa dibypass dengan role lain',
                    '',
                    '> ✅ Lebih andal dari role mute karena dikelola langsung oleh Discord.'
                ].join('\n'));

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── /automod action ────────────────────────────────────────────────
        if (!subGroup && sub === 'action') {
            const tipe = options.getString('tipe');
            client.database.set(`automod-action-${guildId}`, tipe);
            const actionMap = { delete: '🗑️ Delete', warn: '⚠️ Warn', mute: '🔇 Mute', kick: '👢 Kick', ban: '🔨 Ban' };
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('✅ Tindakan Automod Diatur')
                        .setDescription(`Tindakan pelanggaran diubah ke: **${actionMap[tipe]}**`)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod antilink ──────────────────────────────────────────────
        if (!subGroup && sub === 'antilink') {
            const aktif = options.getBoolean('aktif');
            client.database.set(`automod-antilink-${guildId}`, aktif ? 'true' : 'false');
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(aktif ? '#57F287' : '#ED4245')
                        .setTitle(`${aktif ? '✅' : '❌'} Anti-Link ${aktif ? 'Diaktifkan' : 'Dinonaktifkan'}`)
                        .setDescription(`Proteksi anti-link sekarang **${aktif ? 'aktif' : 'nonaktif'}**.\nSemua URL yang dikirim member akan dihapus.`)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod antiinvite ────────────────────────────────────────────
        if (!subGroup && sub === 'antiinvite') {
            const aktif = options.getBoolean('aktif');
            client.database.set(`automod-antiinvite-${guildId}`, aktif ? 'true' : 'false');
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(aktif ? '#57F287' : '#ED4245')
                        .setTitle(`${aktif ? '✅' : '❌'} Anti-Invite ${aktif ? 'Diaktifkan' : 'Dinonaktifkan'}`)
                        .setDescription(`Proteksi anti Discord invite sekarang **${aktif ? 'aktif' : 'nonaktif'}**.`)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod spam ──────────────────────────────────────────────────
        if (!subGroup && sub === 'spam') {
            const aktif    = options.getBoolean('aktif');
            const limit    = options.getInteger('limit')    ?? 5;
            const interval = options.getInteger('interval') ?? 5;
            const existing = getJSON(client, `automod-spam-${guildId}`, { enabled: false, limit: 5, interval: 5 });
            const newCfg   = { enabled: aktif, limit: aktif ? limit : existing.limit, interval: aktif ? interval : existing.interval };
            client.database.set(`automod-spam-${guildId}`, JSON.stringify(newCfg));
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(aktif ? '#57F287' : '#ED4245')
                        .setTitle(`${aktif ? '✅' : '❌'} Anti-Spam ${aktif ? 'Diaktifkan' : 'Dinonaktifkan'}`)
                        .setDescription(aktif
                            ? `Batas: **${limit}** pesan setiap **${interval}** detik.`
                            : 'Proteksi anti-spam dinonaktifkan.')
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod massmention ───────────────────────────────────────────
        if (!subGroup && sub === 'massmention') {
            const aktif    = options.getBoolean('aktif');
            const limit    = options.getInteger('limit') ?? 5;
            const existing = getJSON(client, `automod-massmention-${guildId}`, { enabled: false, limit: 5 });
            const newCfg   = { enabled: aktif, limit: aktif ? limit : existing.limit };
            client.database.set(`automod-massmention-${guildId}`, JSON.stringify(newCfg));
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(aktif ? '#57F287' : '#ED4245')
                        .setTitle(`${aktif ? '✅' : '❌'} Anti Mass-Mention ${aktif ? 'Diaktifkan' : 'Dinonaktifkan'}`)
                        .setDescription(aktif
                            ? `Batas: **${limit}** mention per pesan.`
                            : 'Proteksi anti mass-mention dinonaktifkan.')
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod attachments ───────────────────────────────────────────
        if (!subGroup && sub === 'attachments') {
            const aktif = options.getBoolean('aktif');
            client.database.set(`automod-attachments-${guildId}`, aktif ? 'true' : 'false');
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(aktif ? '#57F287' : '#ED4245')
                        .setTitle(`${aktif ? '✅' : '❌'} Anti-Attachment ${aktif ? 'Diaktifkan' : 'Dinonaktifkan'}`)
                        .setDescription(`Filter file/attachment sekarang **${aktif ? 'aktif' : 'nonaktif'}**.`)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod mute ──────────────────────────────────────────────────
        if (!subGroup && sub === 'mute') {
            const durasi     = options.getString('durasi');
            const durationMs = parseInt(durasi);
            const durationLabel = {
                60000: '1 menit', 300000: '5 menit', 600000: '10 menit',
                1800000: '30 menit', 3600000: '1 jam', 86400000: '1 hari'
            };
            client.database.set(`automod-mute-duration-${guildId}`, String(durationMs));
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('✅ Durasi Timeout Diatur')
                        .setDescription(
                            `Durasi timeout diatur ke: **${durationLabel[durationMs] ?? durasi}**\n\n` +
                            `Bot menggunakan **Discord Timeout** bawaan — tidak perlu role mute.\n` +
                            `Pastikan bot punya permission **Moderate Members**. Lihat \`/automod muteperms\`.`
                        )
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod auditlog ──────────────────────────────────────────────
        if (!subGroup && sub === 'auditlog') {
            const channel = options.getChannel('channel');
            client.database.set(`automod-auditlog-${guildId}`, channel.id);
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('✅ Channel Log Automod Diatur')
                        .setDescription(`Semua aktivitas automod akan dicatat di: ${channel}`)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod antiraid ──────────────────────────────────────────────
        if (!subGroup && sub === 'antiraid') {
            const aktif     = options.getBoolean('aktif');
            const joinLimit = options.getInteger('join_limit') ?? 10;
            const interval  = options.getInteger('interval')   ?? 10;
            const existing  = getJSON(client, `automod-antiraid-${guildId}`, { enabled: false, joinLimit: 10, interval: 10 });
            const newCfg    = { enabled: aktif, joinLimit: aktif ? joinLimit : existing.joinLimit, interval: aktif ? interval : existing.interval };
            client.database.set(`automod-antiraid-${guildId}`, JSON.stringify(newCfg));
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(aktif ? '#57F287' : '#ED4245')
                        .setTitle(`${aktif ? '✅' : '❌'} Anti-Raid ${aktif ? 'Diaktifkan' : 'Dinonaktifkan'}`)
                        .setDescription(aktif
                            ? `Aktif jika **${joinLimit}** atau lebih member bergabung dalam **${interval}** detik.\nVerifikasi server akan ditingkatkan otomatis selama 5 menit.`
                            : 'Proteksi anti-raid dinonaktifkan.')
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod words add ─────────────────────────────────────────────
        if (subGroup === 'words' && sub === 'add') {
            const kata  = options.getString('kata').toLowerCase().trim();
            const words = getJSON(client, `automod-words-${guildId}`, []);
            if (words.includes(kata)) {
                return interaction.reply({ content: `❌ Kata \`${kata}\` sudah ada di daftar terlarang.`, flags: MessageFlags.Ephemeral });
            }
            if (words.length >= 100) {
                return interaction.reply({ content: '❌ Daftar kata terlarang sudah mencapai batas maksimal (100 kata).', flags: MessageFlags.Ephemeral });
            }
            words.push(kata);
            client.database.set(`automod-words-${guildId}`, JSON.stringify(words));
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('✅ Kata Terlarang Ditambahkan')
                        .setDescription(`Kata \`${kata}\` berhasil ditambahkan ke daftar terlarang.\nTotal: **${words.length}** / 100 kata`)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod words list ────────────────────────────────────────────
        if (subGroup === 'words' && sub === 'list') {
            const words = getJSON(client, `automod-words-${guildId}`, []);
            if (words.length === 0) {
                return interaction.reply({
                    content: '📭 Belum ada kata terlarang yang ditambahkan. Gunakan `/automod words add` untuk menambahkan.',
                    flags: MessageFlags.Ephemeral
                });
            }
            const embed = new EmbedBuilder()
                .setTitle(`🚫 Daftar Kata Terlarang (${words.length} / 100)`)
                .setColor('#ED4245')
                .setDescription(words.map((w, i) => `\`${String(i + 1).padStart(2, '0')}.\` ${w}`).join('\n'));
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── /automod words delete ──────────────────────────────────────────
        if (subGroup === 'words' && sub === 'delete') {
            const kata  = options.getString('kata').toLowerCase().trim();
            const words = getJSON(client, `automod-words-${guildId}`, []);
            const idx   = words.indexOf(kata);
            if (idx === -1) {
                return interaction.reply({ content: `❌ Kata \`${kata}\` tidak ditemukan dalam daftar terlarang.`, flags: MessageFlags.Ephemeral });
            }
            words.splice(idx, 1);
            client.database.set(`automod-words-${guildId}`, JSON.stringify(words));
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('✅ Kata Terlarang Dihapus')
                        .setDescription(`Kata \`${kata}\` berhasil dihapus.\nSisa: **${words.length}** / 100 kata`)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod whitelist add ─────────────────────────────────────────
        if (subGroup === 'whitelist' && sub === 'add') {
            const channel = options.getChannel('channel');
            const role    = options.getRole('role');
            if (!channel && !role) {
                return interaction.reply({ content: '❌ Berikan setidaknya satu channel atau role.', flags: MessageFlags.Ephemeral });
            }
            const lines = [];
            if (channel) {
                const chs = getJSON(client, `automod-wl-channels-${guildId}`, []);
                if (!chs.includes(channel.id)) {
                    chs.push(channel.id);
                    client.database.set(`automod-wl-channels-${guildId}`, JSON.stringify(chs));
                    lines.push(`📌 Channel ${channel} ditambahkan ke whitelist.`);
                } else {
                    lines.push(`⚠️ Channel ${channel} sudah ada di whitelist.`);
                }
            }
            if (role) {
                const rls = getJSON(client, `automod-wl-roles-${guildId}`, []);
                if (!rls.includes(role.id)) {
                    rls.push(role.id);
                    client.database.set(`automod-wl-roles-${guildId}`, JSON.stringify(rls));
                    lines.push(`🎭 Role ${role} ditambahkan ke whitelist.`);
                } else {
                    lines.push(`⚠️ Role ${role} sudah ada di whitelist.`);
                }
            }
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('✅ Whitelist Diperbarui')
                        .setDescription(lines.join('\n'))
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod whitelist remove ──────────────────────────────────────
        if (subGroup === 'whitelist' && sub === 'remove') {
            const channel = options.getChannel('channel');
            const role    = options.getRole('role');
            if (!channel && !role) {
                return interaction.reply({ content: '❌ Berikan setidaknya satu channel atau role.', flags: MessageFlags.Ephemeral });
            }
            const lines = [];
            if (channel) {
                const chs = getJSON(client, `automod-wl-channels-${guildId}`, []);
                const idx = chs.indexOf(channel.id);
                if (idx !== -1) {
                    chs.splice(idx, 1);
                    client.database.set(`automod-wl-channels-${guildId}`, JSON.stringify(chs));
                    lines.push(`📌 Channel ${channel} dihapus dari whitelist.`);
                } else {
                    lines.push(`⚠️ Channel ${channel} tidak ada di whitelist.`);
                }
            }
            if (role) {
                const rls = getJSON(client, `automod-wl-roles-${guildId}`, []);
                const idx = rls.indexOf(role.id);
                if (idx !== -1) {
                    rls.splice(idx, 1);
                    client.database.set(`automod-wl-roles-${guildId}`, JSON.stringify(rls));
                    lines.push(`🎭 Role ${role} dihapus dari whitelist.`);
                } else {
                    lines.push(`⚠️ Role ${role} tidak ada di whitelist.`);
                }
            }
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('✅ Whitelist Diperbarui')
                        .setDescription(lines.join('\n'))
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod whitelist list ────────────────────────────────────────
        if (subGroup === 'whitelist' && sub === 'list') {
            const chs = getJSON(client, `automod-wl-channels-${guildId}`, []);
            const rls = getJSON(client, `automod-wl-roles-${guildId}`, []);
            const embed = new EmbedBuilder()
                .setTitle('✅ Daftar Whitelist Automod')
                .setColor('#5865F2')
                .setDescription('Channel dan role berikut **tidak** diperiksa oleh automod.')
                .addFields(
                    { name: '📌 Channel', value: chs.length > 0 ? chs.map(id => `<#${id}>`).join('\n')   : '`Tidak ada`', inline: true },
                    { name: '🎭 Role',    value: rls.length > 0 ? rls.map(id => `<@&${id}>`).join('\n')  : '`Tidak ada`', inline: true }
                )
                .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) ?? undefined });
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
    }
}).toJSON();

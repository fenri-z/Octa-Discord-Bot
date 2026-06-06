/**
 * autocompleteHelper.js
 *
 * Fungsi autocomplete untuk channel, role (dengan warna hex), dan template pesan.
 */

const { ChannelType } = require('discord.js');

// ── Tipe channel yang relevan untuk pengiriman pesan ──────────────────────
const TEXT_CHANNEL_TYPES = [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildForum,
    ChannelType.PublicThread,
    ChannelType.AnnouncementThread,
];

/**
 * Ambil guild yang tepat — dari interaksi langsung, user-install di server, atau DM proxy.
 */
function resolveGuild(interaction, client) {
    if (interaction.guild) return interaction.guild;
    // user-install di server: interaction.guild null tapi guildId ada
    if (interaction.guildId) return client.guilds.cache.get(interaction.guildId) ?? null;
    // DM proxy (developer)
    const selectedId = client.database.get(`dm-guild-${interaction.user.id}`);
    if (!selectedId) return null;
    return client.guilds.cache.get(selectedId) ?? null;
}

/**
 * Ambil guildId yang tepat (langsung, user-install, atau via DM proxy).
 */
function resolveGuildId(interaction, client) {
    if (interaction.guildId) return interaction.guildId;
    return client.database.get(`dm-guild-${interaction.user.id}`) ?? null;
}

// ── Konversi integer warna Discord → hex string ───────────────────────────
function toHex(color) {
    if (!color) return null;
    return '#' + color.toString(16).padStart(6, '0').toUpperCase();
}

// ── Label tipe channel ────────────────────────────────────────────────────
const CH_ICON = {
    [ChannelType.GuildText]:         '💬',
    [ChannelType.GuildAnnouncement]: '📢',
    [ChannelType.GuildForum]:        '🗂️',
    [ChannelType.PublicThread]:      '🔁',
    [ChannelType.AnnouncementThread]:'🔁',
};

// ─────────────────────────────────────────────────────────────────────────
// CHANNEL
// ─────────────────────────────────────────────────────────────────────────
/**
 * Autocomplete untuk input channel.
 * Menampilkan icon tipe + nama channel. Value = ID channel.
 */
async function autocompleteChannel(interaction, client) {
    const guild = resolveGuild(interaction, client);
    if (!guild) return interaction.respond([]).catch(() => null);

    // Fetch dari API jika cache kosong (server baru / belum pernah di-cache)
    if (guild.channels.cache.size === 0) {
        await guild.channels.fetch().catch(() => null);
    }

    const focused = interaction.options.getFocused().toLowerCase();

    const choices = guild.channels.cache
        .filter(c => TEXT_CHANNEL_TYPES.includes(c.type))
        .sort((a, b) => {
            const catA = a.parent?.name ?? '';
            const catB = b.parent?.name ?? '';
            return catA.localeCompare(catB) || a.name.localeCompare(b.name);
        })
        .map(c => {
            const icon = CH_ICON[c.type] ?? '💬';
            const cat  = c.parent ? `${c.parent.name} › ` : '';
            return {
                name: `${icon} ${cat}${c.name}`.slice(0, 100),
                value: c.id
            };
        })
        .filter(c => !focused || c.name.toLowerCase().includes(focused))
        .slice(0, 25);

    await interaction.respond(choices).catch(() => null);
}

// ─────────────────────────────────────────────────────────────────────────
// ROLE
// ─────────────────────────────────────────────────────────────────────────
/**
 * Autocomplete untuk input role.
 * Menampilkan nama role + warna hex-nya. Value = ID role.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.excludeManaged] - Saring role bot/integrasi
 */
async function autocompleteRole(interaction, client, opts = {}) {
    const guild = resolveGuild(interaction, client);
    if (!guild) return interaction.respond([]).catch(() => null);

    // Fetch dari API jika cache kosong (server baru / belum pernah di-cache)
    if (guild.roles.cache.size === 0) {
        await guild.roles.fetch().catch(() => null);
    }

    const focused = interaction.options.getFocused().toLowerCase();

    const choices = guild.roles.cache
        .filter(r => r.id !== guild.id)                          // buang @everyone
        .filter(r => !opts.excludeManaged || !r.managed)        // opsional buang role bot
        .sort((a, b) => b.position - a.position)                // tertinggi dulu
        .map(r => {
            // 🛡️ = role administrator/managed  |  🎭 = role custom biasa
            const isAdmin = r.managed || r.permissions?.has?.('Administrator');
            const emoji   = isAdmin ? '🛡️' : '🎭';
            return {
                name:  `${emoji} @${r.name}`.slice(0, 100),
                value: r.id
            };
        })
        .filter(r => !focused || r.name.toLowerCase().includes(focused))
        .slice(0, 25);

    await interaction.respond(choices).catch(() => null);
}

// ─────────────────────────────────────────────────────────────────────────
// TEMPLATE PESAN
// ─────────────────────────────────────────────────────────────────────────
/**
 * Autocomplete untuk nama template pesan.
 * Membaca daftar template dari database guild yang aktif.
 * Value = nama template.
 */
async function autocompleteTemplate(interaction, client) {
    const guildId = resolveGuildId(interaction, client);
    if (!guildId) return interaction.respond([]).catch(() => null);

    const focused = interaction.options.getFocused().toLowerCase();

    // Baca list template dari database (key: pesan-list-<guildId>)
    let list = [];
    try {
        const raw = client.database.get(`pesan-list-${guildId}`);
        if (raw && typeof raw === 'string') list = JSON.parse(raw);
    } catch {
        list = [];
    }

    if (!Array.isArray(list) || list.length === 0) {
        return interaction.respond([
            { name: '📭 No templates yet — create one with /message create', value: '__none__' }
        ]).catch(() => null);
    }

    const choices = list
        .filter(name => !focused || name.toLowerCase().includes(focused))
        .map(name => ({
            name: `📄 ${name}`,
            value: name
        }))
        .slice(0, 25);

    await interaction.respond(choices).catch(() => null);
}

// ─────────────────────────────────────────────────────────────────────────
// PANEL AUTOROLE BUTTON — untuk field 'panel' (pilih panel yang sudah ada)
// ─────────────────────────────────────────────────────────────────────────
/**
 * Autocomplete untuk field `panel` di autorole-button.
 * Menampilkan daftar panel yang sudah dibuat + info mode & jumlah tombol.
 * Value = nama panel.
 */
async function autocompletePanel(interaction, client) {
    const guildId = resolveGuildId(interaction, client);
    if (!guildId) return interaction.respond([]).catch(() => null);

    const focused = interaction.options.getFocused().toLowerCase();

    let list = [];
    try {
        const raw = client.database.get(`autobtn-list-${guildId}`);
        if (raw && typeof raw === 'string') list = JSON.parse(raw);
    } catch {
        list = [];
    }

    if (!Array.isArray(list) || list.length === 0) {
        return interaction.respond([
            { name: '📭 No panels yet — create one with /autorole-button create', value: '__none__' }
        ]).catch(() => null);
    }

    const choices = list
        .filter(name => !focused || name.toLowerCase().includes(focused))
        .map(name => {
            try {
                const raw      = client.database.get(`autobtn-${guildId}-${name}`);
                const panel    = raw ? JSON.parse(raw) : null;
                const modeIcon = panel?.mode === 'single' ? '🔘' : '✅';
                const btnCount = panel?.buttons?.length ?? 0;
                // Cek apakah template masih ada
                const tmplOk   = panel?.templateName
                    ? !!client.database.get(`pesan-${guildId}-${panel.templateName}`)
                    : false;
                const tmplIcon = tmplOk ? '📄' : '⚠️';
                return {
                    name:  `${modeIcon} ${name} ${tmplIcon} (${btnCount} buttons)`.slice(0, 100),
                    value: name
                };
            } catch {
                return { name: `📋 ${name}`, value: name };
            }
        })
        .slice(0, 25);

    await interaction.respond(choices).catch(() => null);
}

// ─────────────────────────────────────────────────────────────────────────
// TEMPLATE PESAN UNTUK AUTOROLE-BUTTON BUAT
// field 'nama' di subcommand 'buat' — hanya tampilkan template 🔒 Unik,
// beri tanda ✅ jika sudah jadi panel atau 🆕 jika belum
// ─────────────────────────────────────────────────────────────────────────
/**
 * Autocomplete untuk field `nama` di `/autorole-button buat`.
 * Only shows message templates with category 'unik'.
 * Beri tanda ✅ jika sudah ada panel, 🆕 jika belum.
 * Value = nama template.
 */
async function autocompletePesanForPanel(interaction, client) {
    const guildId = resolveGuildId(interaction, client);
    if (!guildId) return interaction.respond([]).catch(() => null);

    const focused = interaction.options.getFocused().toLowerCase();

    // Baca daftar template pesan
    let pesanList = [];
    try {
        const raw = client.database.get(`pesan-list-${guildId}`);
        if (raw && typeof raw === 'string') pesanList = JSON.parse(raw);
    } catch { pesanList = []; }

    // Baca daftar panel yang sudah ada (untuk tanda ✅)
    let panelList = [];
    try {
        const raw = client.database.get(`autobtn-list-${guildId}`);
        if (raw && typeof raw === 'string') panelList = JSON.parse(raw);
    } catch { panelList = []; }

    const panelSet = new Set(panelList);

    if (!Array.isArray(pesanList) || pesanList.length === 0) {
        return interaction.respond([
            { name: '📭 No templates yet — create one with /message create', value: '__none__' }
        ]).catch(() => null);
    }

    // Filter hanya template berkategori 'unik'
    const unikList = pesanList.filter(name => {
        try {
            const raw  = client.database.get(`pesan-${guildId}-${name}`);
            const tmpl = raw ? JSON.parse(raw) : null;
            return tmpl?.kategori === 'unik';
        } catch { return false; }
    });

    if (unikList.length === 0) {
        return interaction.respond([
            { name: '📭 No Unique templates — create one with /message create (select category: unique)', value: '__none__' }
        ]).catch(() => null);
    }

    const choices = unikList
        .filter(name => !focused || name.toLowerCase().includes(focused))
        .map(name => {
            let judul = '';
            try {
                const raw  = client.database.get(`pesan-${guildId}-${name}`);
                const tmpl = raw ? JSON.parse(raw) : null;
                judul = tmpl?.title ? ` — ${tmpl.title.slice(0, 30)}` : '';
            } catch { /* abaikan */ }

            const sudahPanel = panelSet.has(name);
            const icon   = sudahPanel ? '✅' : '🆕';
            const suffix = sudahPanel ? ' (panel exists)' : ' (not yet a panel)';
            return {
                name:  `🔒 ${icon} ${name}${judul}${suffix}`.slice(0, 100),
                value: name
            };
        })
        .slice(0, 25);

    if (choices.length === 0) {
        return interaction.respond([
            { name: `📭 Tidak ada template 🔒 Unik yang cocok dengan "${focused}"`, value: '__none__' }
        ]).catch(() => null);
    }

    await interaction.respond(choices).catch(() => null);
}

// ─────────────────────────────────────────────────────────────────────────
// SALIN — field 'sumber' (semua template) dan 'tujuan' (nama baru, bebas)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Autocomplete field `sumber` in `/pesan salin`.
 * Tampilkan semua template dengan badge kategori dan judul.
 */
async function autocompleteSumberSalin(interaction, client) {
    const guildId = resolveGuildId(interaction, client);
    if (!guildId) return interaction.respond([]).catch(() => null);

    const focused = interaction.options.getFocused().toLowerCase();

    let list = [];
    try {
        const raw = client.database.get(`pesan-list-${guildId}`);
        if (raw && typeof raw === 'string') list = JSON.parse(raw);
    } catch { list = []; }

    if (!Array.isArray(list) || list.length === 0) {
        return interaction.respond([
            { name: '📭 No templates yet — create one with /message create', value: '__none__' }
        ]).catch(() => null);
    }

    const choices = list
        .filter(name => !focused || name.toLowerCase().includes(focused))
        .map(name => {
            try {
                const raw  = client.database.get(`pesan-${guildId}-${name}`);
                const tmpl = raw ? JSON.parse(raw) : null;
                const kat  = tmpl?.kategori === 'unik' ? '🔒' : '📄';
                const judul = tmpl?.title ? ` — ${tmpl.title.slice(0, 35)}` : '';
                return { name: `${kat} ${name}${judul}`.slice(0, 100), value: name };
            } catch {
                return { name: `📄 ${name}`, value: name };
            }
        })
        .slice(0, 25);

    await interaction.respond(choices).catch(() => null);
}

/**
 * Autocomplete field `tujuan` in `/pesan salin`.
 * Show templates that ALREADY EXIST with label "⚠️ already used"
 * agar user tahu nama itu tidak bisa dipakai — tapi tetap bisa ketik nama baru.
 */
async function autocompleteTujuanSalin(interaction, client) {
    const guildId = resolveGuildId(interaction, client);
    if (!guildId) return interaction.respond([]).catch(() => null);

    const focused = interaction.options.getFocused().toLowerCase();

    let list = [];
    try {
        const raw = client.database.get(`pesan-list-${guildId}`);
        if (raw && typeof raw === 'string') list = JSON.parse(raw);
    } catch { list = []; }

    // Jika ada teks yang diketik dan nama itu belum dipakai → tampilkan sebagai opsi baru
    const suggestions = [];

    if (focused && !list.includes(focused)) {
        suggestions.push({ name: `✅ "${focused}" — new name (not yet used)`, value: focused });
    }

    // Tambahkan nama yang sudah ada sebagai peringatan
    const existing = list
        .filter(name => !focused || name.toLowerCase().includes(focused))
        .map(name => ({ name: `⚠️ "${name}" — already in use, will be rejected`, value: name }))
        .slice(0, 24 - suggestions.length);

    await interaction.respond([...suggestions, ...existing]).catch(() => null);
}

/**
 * Autocomplete field `nama` di `/autorole-button buat`.
 * Tampilkan panel yang sudah ada (untuk edit) + input bebas (untuk buat baru).
 * Panel yang sudah ada ditandai ✏️, input baru ditandai ✅.
 */
async function autocompleteAutobtnNama(interaction, client) {
    const guildId = resolveGuildId(interaction, client);
    if (!guildId) return interaction.respond([]).catch(() => null);

    const focused = interaction.options.getFocused().toLowerCase();

    let list = [];
    try {
        const raw = client.database.get(`autobtn-list-${guildId}`);
        if (raw && typeof raw === 'string') list = JSON.parse(raw);
    } catch { list = []; }

    const suggestions = [];

    // Jika ada teks yang diketik dan belum ada panel dengan nama itu → tawarkan buat baru
    if (focused && !list.map(n => n.toLowerCase()).includes(focused) && /^[a-zA-Z0-9_-]{1,32}$/.test(focused)) {
        suggestions.push({ name: `✅ "${focused}" — buat panel baru`, value: focused });
    }

    // Tampilkan panel yang sudah ada
    const existing = list
        .filter(name => !focused || name.toLowerCase().includes(focused))
        .map(name => {
            try {
                const raw   = client.database.get(`autobtn-${guildId}-${name}`);
                const panel = raw ? JSON.parse(raw) : null;
                const mode  = panel?.mode === 'single' ? '🔘' : '✅';
                const btns  = panel?.buttons?.length ?? 0;
                return { name: `✏️ ${mode} ${name} — ${btns} buttons`.slice(0, 100), value: name };
            } catch {
                return { name: `✏️ ${name}`, value: name };
            }
        })
        .slice(0, 25 - suggestions.length);

    await interaction.respond([...suggestions, ...existing]).catch(() => null);
}

// ─────────────────────────────────────────────────────────────────────────
// PANEL AUTOROLE REACTION — untuk field 'panel' di autorole-reaction
// ─────────────────────────────────────────────────────────────────────────

async function autocompleteReactPanel(interaction, client) {
    const guildId = resolveGuildId(interaction, client);
    if (!guildId) return interaction.respond([]).catch(() => null);

    const focused = interaction.options.getFocused().toLowerCase();

    let list = [];
    try {
        const raw = client.database.get(`autoreact-list-${guildId}`);
        if (raw && typeof raw === 'string') list = JSON.parse(raw);
    } catch { list = []; }

    if (!Array.isArray(list) || list.length === 0) {
        return interaction.respond([
            { name: '📭 No panels yet — create one with /autorole-reaction create', value: '__none__' }
        ]).catch(() => null);
    }

    const choices = list
        .filter(name => !focused || name.toLowerCase().includes(focused))
        .map(name => {
            try {
                const raw      = client.database.get(`autoreact-${guildId}-${name}`);
                const panel    = raw ? JSON.parse(raw) : null;
                const modeIcon = panel?.mode === 'single' ? '🔘' : '✅';
                const count    = panel?.reactions?.length ?? 0;
                return { name: `${modeIcon} ${name} ✨ (${count} reaction)`.slice(0, 100), value: name };
            } catch {
                return { name: `✨ ${name}`, value: name };
            }
        })
        .slice(0, 25);

    await interaction.respond(choices).catch(() => null);
}

async function autocompleteAutoreactNama(interaction, client) {
    const guildId = resolveGuildId(interaction, client);
    if (!guildId) return interaction.respond([]).catch(() => null);

    const focused = interaction.options.getFocused().toLowerCase();

    let list = [];
    try {
        const raw = client.database.get(`autoreact-list-${guildId}`);
        if (raw && typeof raw === 'string') list = JSON.parse(raw);
    } catch { list = []; }

    const suggestions = [];

    if (focused && !list.map(n => n.toLowerCase()).includes(focused) && /^[a-zA-Z0-9_-]{1,32}$/.test(focused)) {
        suggestions.push({ name: `✅ "${focused}" — buat panel baru`, value: focused });
    }

    const existing = list
        .filter(name => !focused || name.toLowerCase().includes(focused))
        .map(name => {
            try {
                const raw   = client.database.get(`autoreact-${guildId}-${name}`);
                const panel = raw ? JSON.parse(raw) : null;
                const mode  = panel?.mode === 'single' ? '🔘' : '✅';
                const count = panel?.reactions?.length ?? 0;
                return { name: `✏️ ${mode} ${name} — ${count} reaction`.slice(0, 100), value: name };
            } catch {
                return { name: `✏️ ${name}`, value: name };
            }
        })
        .slice(0, 25 - suggestions.length);

    await interaction.respond([...suggestions, ...existing]).catch(() => null);
}

module.exports = {
    autocompleteChannel,
    autocompleteRole,
    autocompleteTemplate,
    autocompletePanel,
    autocompleteAutobtnNama,
    autocompletePesanForPanel,
    autocompleteSumberSalin,
    autocompleteTujuanSalin,
    autocompleteReactPanel,
    autocompleteAutoreactNama,
    resolveGuild,
    resolveGuildId
};

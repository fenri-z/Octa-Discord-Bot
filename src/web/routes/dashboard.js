/**
 * routes/dashboard.js
 * Key database disesuaikan dengan slashcommand-welcome.js & slashcommand-goodbye.js
 */

const express             = require('express');
const { PermissionsBitField } = require('discord.js');
const router  = express.Router();

// ── In-memory member cache (60 detik TTL) ──────────────────────────────────
const _memberCache = new Map();

// ── Invite cache (60 detik TTL) ────────────────────────────────────────────
const _inviteCache = new Map();
function _mapInvite(inv) {
    return {
        code:        inv.code,
        url:         `https://discord.gg/${inv.code}`,
        inviterId:   inv.inviter?.id        ?? null,
        inviterTag:  inv.inviter?.username  ?? 'Tidak diketahui',
        channelId:   inv.channel?.id        ?? null,
        channelName: inv.channel?.name      ?? '-',
        uses:        inv.uses               ?? 0,
        maxUses:     inv.maxUses            ?? 0,
        expiresAt:   inv.expiresTimestamp   ?? null,
        temporary:   inv.temporary          ?? false,
        createdAt:   inv.createdTimestamp   ?? null,
    };
}
async function _getCachedInvites(guild) {
    const key   = `invites:${guild.id}`;
    const entry = _inviteCache.get(key);
    if (entry && entry.expires > Date.now()) return entry.data;

    const raw  = await guild.invites.fetch();
    const data = [...raw.values()]
        .sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0))
        .map(_mapInvite);
    _inviteCache.set(key, { data, expires: Date.now() + 60_000 });
    return data;
}

// ── Member stats cache untuk serverstats (5 menit TTL) ────────────────────
const _statsCache = new Map();
async function _getCachedMemberStats(guild) {
    const key   = `stats:${guild.id}`;
    const entry = _statsCache.get(key);
    if (entry && entry.expires > Date.now()) return entry.stats;

    // Gunakan cache Discord.js jika sudah cukup lengkap (≥80% dari total)
    if (guild.members.cache.size >= guild.memberCount * 0.8) {
        const botCount   = guild.members.cache.filter(m => m.user.bot).size;
        const stats = { totalCount: guild.memberCount, botCount, humanCount: guild.memberCount - botCount };
        _statsCache.set(key, { stats, expires: Date.now() + 300_000 });
        return stats;
    }

    // Fetch hanya jika cache belum cukup, lalu simpan hasilnya
    await guild.members.fetch().catch(() => null);
    const botCount   = guild.members.cache.filter(m => m.user.bot).size;
    const totalCount = guild.memberCount;
    const stats = { totalCount, botCount, humanCount: totalCount - botCount };
    _statsCache.set(key, { stats, expires: Date.now() + 300_000 });
    return stats;
}
function _getCachedMember(guildId, userId) {
    const entry = _memberCache.get(`${guildId}:${userId}`);
    if (entry && entry.expires > Date.now()) return entry.member;
    return null;
}
function _setCachedMember(guildId, userId, member) {
    _memberCache.set(`${guildId}:${userId}`, { member, expires: Date.now() + 60_000 });
}
async function _getMember(guild, userId) {
    // 1. cek Discord.js cache
    let m = guild.members.cache.get(userId);
    if (m) return m;
    // 2. cek TTL cache
    m = _getCachedMember(guild.id, userId);
    if (m) return m;
    // 3. fetch dari Discord API (hanya jika benar-benar belum ada)
    try { m = await guild.members.fetch(userId); if (m) _setCachedMember(guild.id, userId, m); } catch (_) {}
    return m || null;
}
// Gunakan cache Discord.js — hanya fetch jika cache kosong
async function _ensureRoles(guild) {
    if (guild.roles.cache.size <= 1) {
        try { await guild.roles.fetch(); } catch (_) {}
    }
}
async function _ensureChannels(guild) {
    if (guild.channels.cache.size === 0) {
        try { await guild.channels.fetch(); } catch (_) {}
    }
}

const REQUIRED_PERMS = [
    { flag: PermissionsBitField.Flags.ViewChannel,        name: 'View Channel',         desc: 'Melihat channel' },
    { flag: PermissionsBitField.Flags.SendMessages,       name: 'Send Messages',        desc: 'Mengirim pesan (welcome, goodbye, dll.)' },
    { flag: PermissionsBitField.Flags.EmbedLinks,         name: 'Embed Links',          desc: 'Mengirim embed (welcome, goodbye, pesan)' },
    { flag: PermissionsBitField.Flags.AttachFiles,        name: 'Attach Files',         desc: 'Mengirim gambar welcome card' },
    { flag: PermissionsBitField.Flags.ManageRoles,        name: 'Manage Roles',         desc: 'Autorole & autorole button' },
    { flag: PermissionsBitField.Flags.ManageChannels,     name: 'Manage Channels',      desc: 'Server Stats (buat channel statistik)' },
    { flag: PermissionsBitField.Flags.ChangeNickname,     name: 'Change Nickname',      desc: 'Ganti nickname bot sendiri' },
    { flag: PermissionsBitField.Flags.ReadMessageHistory, name: 'Read Message History', desc: 'Membaca riwayat pesan' },
];

function requireLogin(req, res, next) {
    if (!req.isAuthenticated()) {
        req.session.returnTo = req.originalUrl;
        return res.redirect('/auth/login');
    }
    next();
}

function requireManageGuild(req, res, next) {
    const { guildId } = req.params;
    const userGuilds  = req.user?.guilds || [];
    const MANAGE_GUILD = 0x20;

    const guild = userGuilds.find(g =>
        g.id === guildId && (
            (parseInt(g.permissions) & MANAGE_GUILD) !== 0 || g.owner
        )
    );

    if (!guild) {
        return res.status(403).render('error', { hasSidebar: false,
            title: 'Akses Ditolak',
            message: 'Kamu tidak punya izin untuk mengatur server ini.'
        });
    }

    const botGuild = req.discordClient?.guilds.cache.get(guildId);
    if (!botGuild) {
        return res.render('dashboard/invite', {
            title: 'Undang Bot',
            guild,
            clientId: process.env.CLIENT_ID
        });
    }

    // Daftar server mutual (user punya akses + bot ada di sana) untuk sidebar switcher
    const manageableGuilds = userGuilds.filter(g =>
        (parseInt(g.permissions) & MANAGE_GUILD) !== 0 || g.owner
    );
    res.locals.mutualGuilds = manageableGuilds
        .filter(g => req.discordClient?.guilds.cache.has(g.id))
        .map(g => ({
            id:       g.id,
            name:     g.name,
            iconURL:  g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
            isActive: g.id === guildId
        }));

    req.botGuild = botGuild;
    req.userGuildData = guild;
    next();
}

// ── Helper: baca boolean dari database ───────────────────────────────────────
function getDbBool(db, key, defaultVal = false) {
    const raw = db?.get(key);
    if (raw === null || raw === undefined) return defaultVal;
    if (raw === 'false' || raw === false || raw === 0) return false;
    return true;
}

// GET /dashboard
router.get('/', requireLogin, (req, res) => {
    const userGuilds   = req.user?.guilds || [];
    const MANAGE_GUILD = 0x20;

    const manageableGuilds = userGuilds.filter(g =>
        (parseInt(g.permissions) & MANAGE_GUILD) !== 0 || g.owner
    );

    const guildsWithStatus = manageableGuilds.map(g => ({
        ...g,
        botPresent: !!req.discordClient?.guilds.cache.get(g.id),
        iconURL: g.icon
            ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`
            : null
    }));

    res.render('dashboard/servers', {
        title: 'Pilih Server',
        guilds: guildsWithStatus,
        hasSidebar: false
    });
});

// GET /dashboard/:guildId
router.get('/:guildId', requireLogin, requireManageGuild, (req, res) => {
    const guild       = req.botGuild;
    const me          = guild.members.me;
    const botNickname = me?.nickname || req.discordClient?.user?.username || 'Bot';

    const missingPerms = me
        ? REQUIRED_PERMS.filter(p => !me.permissions.has(p.flag))
        : [];

    res.render('dashboard/home', {
        title: guild.name,
        guild,
        guildData: req.userGuildData,
        botNickname,
        missingPerms,
        activePage: 'home',
        hasSidebar: true
    });
});

// GET /dashboard/:guildId/welcome
router.get('/:guildId/welcome', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const db      = req.discordClient?.database;
        const guildId = req.params.guildId;
        const guild   = req.botGuild;

        await _ensureRoles(guild);
        await _ensureChannels(guild);

        // Baca semua key yang dipakai slashcommand-welcome.js
        const welcomeData = {
            enabled:           getDbBool(db, `welcome-enabled-${guildId}`,           false),
            channelId:         db?.get(`welcome-channel-${guildId}`)                 ?? '',
            messageType:       db?.get(`welcome-messageType-${guildId}`)             ?? 'embed',
            plainText:         db?.get(`welcome-plainText-${guildId}`)               ?? '',
            title:             db?.get(`welcome-title-${guildId}`)                   ?? '',
            description:       db?.get(`welcome-description-${guildId}`)             ?? '',
            color:             db?.get(`welcome-color-${guildId}`)                   ?? '#5865F2',
            footerText:        db?.get(`welcome-footer-${guildId}`)                  ?? '',
            thumbnail:         getDbBool(db, `welcome-thumbnail-${guildId}`,          false),
            showMemberNew:     getDbBool(db, `welcome-showMemberNew-${guildId}`,      false),
            showAkunDibuat:    getDbBool(db, `welcome-showAkunDibuat-${guildId}`,     false),
            showTotalMember:   getDbBool(db, `welcome-showTotalMember-${guildId}`,    false),
            showDiundangOleh:  getDbBool(db, `welcome-showDiundangOleh-${guildId}`,   false),
            showKodeInvite:    getDbBool(db, `welcome-showKodeInvite-${guildId}`,     false),
            showTotalUndangan: getDbBool(db, `welcome-showTotalUndangan-${guildId}`,  false),
            // Card settings
            cardEnabled:        getDbBool(db, `welcome-cardEnabled-${guildId}`, false),
            cardWelcomeText:    db?.get(`welcome-cardWelcomeText-${guildId}`)   ?? 'WELCOME',
            cardUserPrefix:     db?.get(`welcome-cardUserPrefix-${guildId}`)    ?? '.',
            cardSubText:        db?.get(`welcome-cardSubText-${guildId}`)       ?? 'TO {server}',
            cardBgColor:        db?.get(`welcome-cardBgColor-${guildId}`)       ?? '#1a1a2e',
            cardBgColor2:       db?.get(`welcome-cardBgColor2-${guildId}`)      ?? '#16213e',
            cardAccentColor:    db?.get(`welcome-cardAccent-${guildId}`)        ?? '#5865F2',
            cardTextColor:      db?.get(`welcome-cardTextColor-${guildId}`)     ?? '#ffffff',
            cardAvatarShape:    db?.get(`welcome-cardAvatarShape-${guildId}`)   ?? 'circle',
            cardBgType:         db?.get(`welcome-cardBgType-${guildId}`)        ?? 'gradient',
            cardBgImageUrl:     db?.get(`welcome-cardBgImageUrl-${guildId}`)    ?? '',
            cardOverlayColor:   db?.get(`welcome-cardOverlayColor-${guildId}`)  ?? '#000000',
            cardOverlayOpacity: db?.get(`welcome-cardOverlayOpacity-${guildId}`)  ?? '0',
            cardTitleColor:     db?.get(`welcome-cardTitleColor-${guildId}`)    ?? '#ffffff',
            cardUsernameColor:  db?.get(`welcome-cardUsernameColor-${guildId}`) ?? '#5865F2',
            cardMsgColor:       db?.get(`welcome-cardMsgColor-${guildId}`)      ?? '#cccccc',
            cardFont:           db?.get(`welcome-cardFont-${guildId}`)          ?? 'impact',
        };

        const channels = [...guild.channels.cache.values()]
            .filter(c => c.type === 0)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const roles = [...guild.roles.cache.values()]
            .filter(r => r.id !== guild.id)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#99aab5' : r.hexColor }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const u = req.user || {};

        // Fetch member login untuk display name & warna role tertinggi
        let loginMember = null;
        loginMember = await _getMember(guild, u.id);

        const loginUser = {
            username:    u.username || 'User',
            displayName: loginMember?.displayName || u.username || 'User',
            avatarUrl:   u.avatar
                ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=256`
                : 'https://cdn.discordapp.com/embed/avatars/0.png',
            roleColor: (loginMember?.displayHexColor && loginMember.displayHexColor !== '#000000')
                ? loginMember.displayHexColor : '#ffffff',
        };

        // Fetch member bot untuk display name & warna role tertinggi
        const botClientUser = req.discordClient?.user;
        let botMember = null;
        if (botClientUser) {
            botMember = await _getMember(guild, botClientUser.id);
        }
        const botUser = {
            username:  botMember?.displayName || botClientUser?.username || 'Bot',
            avatarUrl: botClientUser?.avatar
                ? `https://cdn.discordapp.com/avatars/${botClientUser.id}/${botClientUser.avatar}.png?size=256`
                : 'https://cdn.discordapp.com/embed/avatars/0.png',
            roleColor: (botMember?.displayHexColor && botMember.displayHexColor !== '#000000')
                ? botMember.displayHexColor : '#ffffff',
        };

        res.render('dashboard/welcome', {
            title: `Welcome — ${guild.name}`,
            guild,
            channels,
            roles,
            welcomeData,
            loginUser,
            botUser,
            activePage: 'welcome',
            hasSidebar: true
        });
    } catch (err) {
        console.error('[dashboard/welcome] Error fetching guild data:', err);
        res.status(500).render('error', { hasSidebar: false,
            title: 'Server Error',
            message: 'Gagal memuat data server dari Discord.'
        });
    }
});

// GET /dashboard/:guildId/goodbye
router.get('/:guildId/goodbye', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const db      = req.discordClient?.database;
        const guildId = req.params.guildId;
        const guild   = req.botGuild;

        await _ensureRoles(guild);
        await _ensureChannels(guild);

        const goodbyeData = {
            enabled:       getDbBool(db, `goodbye-enabled-${guildId}`,        false),
            channelId:     db?.get(`goodbye-channel-${guildId}`)              ?? '',
            messageType:   db?.get(`goodbye-messageType-${guildId}`)          ?? 'embed',
            plainText:     db?.get(`goodbye-plainText-${guildId}`)            ?? '',
            title:         db?.get(`goodbye-title-${guildId}`)                ?? '',
            description:   db?.get(`goodbye-description-${guildId}`)          ?? '',
            color:         db?.get(`goodbye-color-${guildId}`)                ?? '#ED4245',
            footerText:    db?.get(`goodbye-footer-${guildId}`)               ?? '',
            thumbnail:     getDbBool(db, `goodbye-thumbnail-${guildId}`,       false),
            // Card settings
            cardEnabled:        getDbBool(db, `goodbye-cardEnabled-${guildId}`, false),
            cardWelcomeText:    db?.get(`goodbye-cardWelcomeText-${guildId}`)   ?? 'GOODBYE',
            cardSubText:        db?.get(`goodbye-cardSubText-${guildId}`)       ?? 'FROM {server}',
            cardBgColor:        db?.get(`goodbye-cardBgColor-${guildId}`)       ?? '#1a0a0a',
            cardBgColor2:       db?.get(`goodbye-cardBgColor2-${guildId}`)      ?? '#2e0a0a',
            cardAccentColor:    db?.get(`goodbye-cardAccent-${guildId}`)        ?? '#ED4245',
            cardAvatarShape:    db?.get(`goodbye-cardAvatarShape-${guildId}`)   ?? 'circle',
            cardBgType:         db?.get(`goodbye-cardBgType-${guildId}`)        ?? 'gradient',
            cardBgImageUrl:     db?.get(`goodbye-cardBgImageUrl-${guildId}`)    ?? '',
            cardOverlayColor:   db?.get(`goodbye-cardOverlayColor-${guildId}`)  ?? '#000000',
            cardOverlayOpacity: db?.get(`goodbye-cardOverlayOpacity-${guildId}`) ?? '0',
            cardTitleColor:     db?.get(`goodbye-cardTitleColor-${guildId}`)    ?? '#ffffff',
            cardUsernameColor:  db?.get(`goodbye-cardUsernameColor-${guildId}`) ?? '#ED4245',
            cardMsgColor:       db?.get(`goodbye-cardMsgColor-${guildId}`)      ?? '#cccccc',
            cardFont:           db?.get(`goodbye-cardFont-${guildId}`)          ?? 'impact',
            // Fields
            showMember:      getDbBool(db, `goodbye-showMember-${guildId}`,      false),
            showBergabung:   getDbBool(db, `goodbye-showBergabung-${guildId}`,   false),
            showAkunDibuat:  getDbBool(db, `goodbye-showAkunDibuat-${guildId}`,  false),
            showTotalMember: getDbBool(db, `goodbye-showTotalMember-${guildId}`, false),
        };

        const channels = [...guild.channels.cache.values()]
            .filter(c => c.type === 0)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const roles = [...guild.roles.cache.values()]
            .filter(r => r.id !== guild.id)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#99aab5' : r.hexColor }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const u = req.user || {};
        let loginMember = null;
        loginMember = await _getMember(guild, u.id);
        const loginUser = {
            username:    u.username || 'User',
            displayName: loginMember?.displayName || u.username || 'User',
            avatarUrl:   u.avatar
                ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=256`
                : 'https://cdn.discordapp.com/embed/avatars/0.png',
            roleColor: (loginMember?.displayHexColor && loginMember.displayHexColor !== '#000000')
                ? loginMember.displayHexColor : '#ffffff',
        };

        const botClientUser = req.discordClient?.user;
        let botMember = null;
        if (botClientUser) {
            botMember = await _getMember(guild, botClientUser.id);
        }
        const botUser = {
            username:  botMember?.displayName || botClientUser?.username || 'Bot',
            avatarUrl: botClientUser?.avatar
                ? `https://cdn.discordapp.com/avatars/${botClientUser.id}/${botClientUser.avatar}.png?size=256`
                : 'https://cdn.discordapp.com/embed/avatars/0.png',
            roleColor: (botMember?.displayHexColor && botMember.displayHexColor !== '#000000')
                ? botMember.displayHexColor : '#ffffff',
        };

        res.render('dashboard/goodbye', {
            title: `Goodbye — ${guild.name}`,
            guild,
            channels,
            roles,
            goodbyeData,
            loginUser,
            botUser,
            activePage: 'goodbye',
            hasSidebar: true
        });
    } catch (err) {
        console.error('[dashboard/goodbye] Error fetching guild data:', err);
        res.status(500).render('error', { hasSidebar: false,
            title: 'Server Error',
            message: 'Gagal memuat data server dari Discord.'
        });
    }
});

// GET /dashboard/:guildId/booster
router.get('/:guildId/booster', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const db      = req.discordClient?.database;
        const guildId = req.params.guildId;
        const guild   = req.botGuild;

        await _ensureChannels(guild);

        const boostData = {
            enabled:            getDbBool(db, `booster-boost-enabled-${guildId}`,          false),
            channelId:          db?.get(`booster-boost-channel-${guildId}`)                 ?? '',
            messageType:        db?.get(`booster-boost-messageType-${guildId}`)             ?? 'embed',
            plainText:          db?.get(`booster-boost-plainText-${guildId}`)               ?? '',
            title:              db?.get(`booster-boost-title-${guildId}`)                   ?? '🚀 Server Boost Baru!',
            description:        db?.get(`booster-boost-desc-${guildId}`)                    ?? 'Terima kasih {member} sudah boost server ini! 💖\nTotal boost sekarang: **{boosts}**.',
            color:              db?.get(`booster-boost-color-${guildId}`)                   ?? '#FF73FA',
            footerText:         db?.get(`booster-boost-footer-${guildId}`)                  ?? '',
            showMember:         getDbBool(db, `booster-boost-showMember-${guildId}`,        true),
            showMulaiBoost:     getDbBool(db, `booster-boost-showMulaiBoost-${guildId}`,    true),
            showTotalBoost:     getDbBool(db, `booster-boost-showTotalBoost-${guildId}`,    true),
            showLevelServer:    getDbBool(db, `booster-boost-showLevelServer-${guildId}`,   true),
            showThumbnail:      getDbBool(db, `booster-boost-showThumbnail-${guildId}`,     true),
            cardEnabled:        getDbBool(db, `booster-boost-cardEnabled-${guildId}`,       false),
            cardWelcomeText:    db?.get(`booster-boost-cardWelcomeText-${guildId}`)         ?? 'BOOST!',
            cardSubText:        db?.get(`booster-boost-cardSubText-${guildId}`)             ?? 'Thank you for boosting!',
            cardBgColor:        db?.get(`booster-boost-cardBgColor-${guildId}`)             ?? '#0a0a1e',
            cardBgColor2:       db?.get(`booster-boost-cardBgColor2-${guildId}`)            ?? '#1e0a2e',
            cardAccentColor:    db?.get(`booster-boost-cardAccent-${guildId}`)              ?? '#FF73FA',
            cardAvatarShape:    db?.get(`booster-boost-cardAvatarShape-${guildId}`)         ?? 'circle',
            cardBgType:         db?.get(`booster-boost-cardBgType-${guildId}`)              ?? 'gradient',
            cardBgImageUrl:     db?.get(`booster-boost-cardBgImageUrl-${guildId}`)          ?? '',
            cardOverlayColor:   db?.get(`booster-boost-cardOverlayColor-${guildId}`)        ?? '#000000',
            cardOverlayOpacity: db?.get(`booster-boost-cardOverlayOpacity-${guildId}`)      ?? '0',
            cardTitleColor:     db?.get(`booster-boost-cardTitleColor-${guildId}`)          ?? '#ffffff',
            cardUsernameColor:  db?.get(`booster-boost-cardUsernameColor-${guildId}`)       ?? '#FF73FA',
            cardMsgColor:       db?.get(`booster-boost-cardMsgColor-${guildId}`)            ?? '#cccccc',
            cardFont:           db?.get(`booster-boost-cardFont-${guildId}`)                ?? 'impact',
        };

        const unboostData = {
            enabled:            getDbBool(db, `booster-unboost-enabled-${guildId}`,         false),
            channelId:          db?.get(`booster-unboost-channel-${guildId}`)                ?? '',
            messageType:        db?.get(`booster-unboost-messageType-${guildId}`)            ?? 'embed',
            plainText:          db?.get(`booster-unboost-plainText-${guildId}`)              ?? '',
            title:              db?.get(`booster-unboost-title-${guildId}`)                  ?? '💔 Boost Berakhir',
            description:        db?.get(`booster-unboost-desc-${guildId}`)                   ?? '{member} telah mencabut boost-nya dari server.\nTotal boost sekarang: **{boosts}**.',
            color:              db?.get(`booster-unboost-color-${guildId}`)                  ?? '#ED4245',
            footerText:         db?.get(`booster-unboost-footer-${guildId}`)                 ?? '',
            showMember:         getDbBool(db, `booster-unboost-showMember-${guildId}`,       true),
            showTotalBoost:     getDbBool(db, `booster-unboost-showTotalBoost-${guildId}`,   true),
            showLevelServer:    getDbBool(db, `booster-unboost-showLevelServer-${guildId}`,  true),
            showThumbnail:      getDbBool(db, `booster-unboost-showThumbnail-${guildId}`,    true),
            cardEnabled:        getDbBool(db, `booster-unboost-cardEnabled-${guildId}`,      false),
            cardWelcomeText:    db?.get(`booster-unboost-cardWelcomeText-${guildId}`)        ?? 'GOODBYE',
            cardSubText:        db?.get(`booster-unboost-cardSubText-${guildId}`)            ?? 'Boost berakhir...',
            cardBgColor:        db?.get(`booster-unboost-cardBgColor-${guildId}`)            ?? '#1e0a0a',
            cardBgColor2:       db?.get(`booster-unboost-cardBgColor2-${guildId}`)           ?? '#2e0a0a',
            cardAccentColor:    db?.get(`booster-unboost-cardAccent-${guildId}`)             ?? '#ED4245',
            cardAvatarShape:    db?.get(`booster-unboost-cardAvatarShape-${guildId}`)        ?? 'circle',
            cardBgType:         db?.get(`booster-unboost-cardBgType-${guildId}`)             ?? 'gradient',
            cardBgImageUrl:     db?.get(`booster-unboost-cardBgImageUrl-${guildId}`)         ?? '',
            cardOverlayColor:   db?.get(`booster-unboost-cardOverlayColor-${guildId}`)       ?? '#000000',
            cardOverlayOpacity: db?.get(`booster-unboost-cardOverlayOpacity-${guildId}`)     ?? '0',
            cardTitleColor:     db?.get(`booster-unboost-cardTitleColor-${guildId}`)         ?? '#ffffff',
            cardUsernameColor:  db?.get(`booster-unboost-cardUsernameColor-${guildId}`)      ?? '#ED4245',
            cardMsgColor:       db?.get(`booster-unboost-cardMsgColor-${guildId}`)           ?? '#cccccc',
            cardFont:           db?.get(`booster-unboost-cardFont-${guildId}`)               ?? 'impact',
        };

        const channels = [...guild.channels.cache.values()]
            .filter(c => c.type === 0)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const u = req.user || {};
        let loginMember = null;
        loginMember = await _getMember(guild, u.id);
        const loginUser = {
            username:    u.username || 'User',
            displayName: loginMember?.displayName || u.username || 'User',
            avatarUrl:   u.avatar
                ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=256`
                : 'https://cdn.discordapp.com/embed/avatars/0.png',
            roleColor: (loginMember?.displayHexColor && loginMember.displayHexColor !== '#000000')
                ? loginMember.displayHexColor : '#ffffff',
        };

        const botClientUser = req.discordClient?.user;
        let botMember = null;
        if (botClientUser) {
            botMember = await _getMember(guild, botClientUser.id);
        }
        const botUser = {
            username:  botMember?.displayName || botClientUser?.username || 'Bot',
            avatarUrl: botClientUser?.avatar
                ? `https://cdn.discordapp.com/avatars/${botClientUser.id}/${botClientUser.avatar}.png?size=256`
                : 'https://cdn.discordapp.com/embed/avatars/0.png',
            roleColor: (botMember?.displayHexColor && botMember.displayHexColor !== '#000000')
                ? botMember.displayHexColor : '#ffffff',
        };

        res.render('dashboard/booster', {
            title: `Booster — ${guild.name}`,
            guild,
            channels,
            boostData,
            unboostData,
            loginUser,
            botUser,
            activePage: 'booster',
            hasSidebar: true
        });
    } catch (err) {
        console.error('[dashboard/booster] Error:', err);
        res.status(500).render('error', { hasSidebar: false, title: 'Server Error', message: 'Gagal memuat data server.' });
    }
});

// GET /dashboard/:guildId/autorole
router.get('/:guildId/autorole', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const guild   = req.botGuild;

    await _ensureRoles(guild);
    await _ensureChannels(guild);

    // ── Autorole Join ──────────────────────────────────────────────────────
    function getDbBool(key, def = false) {
        const raw = db?.get(key);
        if (raw === null || raw === undefined) return def;
        if (raw === 'false' || raw === false || raw === 0) return false;
        return true;
    }

    const joinData = {
        memberEnabled: getDbBool(`autorole-member-enabled-${guildId}`, false),
        memberRoleId:  db?.get(`autorole-member-role-${guildId}`) ?? null,
        botEnabled:    getDbBool(`autorole-bot-enabled-${guildId}`, false),
        botRoleId:     db?.get(`autorole-bot-role-${guildId}`)    ?? null,
    };

    // ── Autorole Button: ambil semua panel ────────────────────────────────
    // Struktur panel sinkron dengan slashcommand-autorole-button.js:
    // { name, mode, embedTitle, embedDescription, embedFooter,
    //   embedColor, embedImage, embedThumbnail, defaultStyle, buttons }
    let panelNames = [];
    try {
        const raw = db?.get(`autobtn-list-${guildId}`);
        panelNames = raw ? JSON.parse(raw) : [];
    } catch { panelNames = []; }

    const panels = panelNames.map(name => {
        try {
            const raw = db?.get(`autobtn-${guildId}-${name}`);
            if (!raw) return null;
            const panel = JSON.parse(raw);
            // Tambahkan styleKey string ke tiap button untuk pewarnaan CSS (ar-btn-1 s/d ar-btn-4)
            panel.buttons = (panel.buttons || []).map(btn => ({
                ...btn,
                styleKey: String(parseInt(btn.style) || 1)
            }));
            return panel;
        } catch { return null; }
    }).filter(Boolean);

    // Ambil sentData tiap panel (untuk status & link)
    const sentPanels = {};
    for (const p of panels) {
        try {
            const raw = db?.get(`autobtn-sent-${guildId}-${p.name}`);
            if (raw) sentPanels[p.name] = JSON.parse(raw);
        } catch {}
    }

    // ── Autorole Booster ──────────────────────────────────────────────────
    const boosterData = {
        autoroleEnabled:   getDbBool(`booster-autorole-enabled-${guildId}`, false),
        autoroleRoleId:    db?.get(`booster-autorole-role-${guildId}`)   ?? null,
        autoremoveEnabled: getDbBool(`booster-autoremove-enabled-${guildId}`, false),
    };

    // ── Roles & Channels ──────────────────────────────────────────────────
    const botRolePosition = guild.members.me?.roles.highest.position || 0;
    const roles = [...guild.roles.cache.values()]
        .filter(r => r.id !== guild.id && r.position < botRolePosition)
        .map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#99aab5' : r.hexColor }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const channels = [...guild.channels.cache.values()]
        .filter(c => c.type === 0)
        .map(c => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name));

    res.render('dashboard/autorole', {
        title: `Auto Role — ${guild.name}`,
        guild,
        roles,
        channels,
        joinData,
        boosterData,
        panels,
        sentPanels,
        activePage: 'autorole',
        hasSidebar: true
    });
});

// GET /dashboard/:guildId/message-builder
router.get('/:guildId/message-builder', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const db      = req.discordClient?.database;
        const guildId = req.params.guildId;
        const guild   = req.botGuild;

        // Fetch channels & roles terbaru dari Discord API
        await _ensureChannels(guild);
        await _ensureRoles(guild);

        const channels = [...guild.channels.cache.values()]
            .filter(c => c.type === 0)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const roles = [...guild.roles.cache.values()]
            .filter(r => r.id !== guild.id)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#99aab5' : r.hexColor }))
            .sort((a, b) => a.name.localeCompare(b.name));

        // Ambil list nama template, lalu baca tiap template satu per satu
        let templateNames = [];
        try {
            const raw = db?.get(`pesan-list-${guildId}`);
            templateNames = raw ? JSON.parse(raw) : [];
        } catch { templateNames = []; }

        const templates = templateNames.map(name => {
            try {
                const raw = db?.get(`pesan-${guildId}-${name}`);
                return raw ? { name, ...JSON.parse(raw) } : null;
            } catch { return null; }
        }).filter(Boolean);

        // Login user & bot user untuk preview
        const u = req.user || {};
        let loginMember = null;
        loginMember = await _getMember(guild, u.id);
        const loginUser = {
            username:    u.username || 'User',
            displayName: loginMember?.displayName || u.username || 'User',
            avatarUrl:   u.avatar
                ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=256`
                : 'https://cdn.discordapp.com/embed/avatars/0.png',
            roleColor: (loginMember?.displayHexColor && loginMember.displayHexColor !== '#000000')
                ? loginMember.displayHexColor : '#ffffff',
        };

        const botClientUser = req.discordClient?.user;
        let botMember = null;
        if (botClientUser) {
            botMember = await _getMember(guild, botClientUser.id);
        }
        const botUser = {
            username:  botMember?.displayName || botClientUser?.username || 'Bot',
            avatarUrl: botClientUser?.avatar
                ? `https://cdn.discordapp.com/avatars/${botClientUser.id}/${botClientUser.avatar}.png?size=256`
                : 'https://cdn.discordapp.com/embed/avatars/0.png',
            roleColor: (botMember?.displayHexColor && botMember.displayHexColor !== '#000000')
                ? botMember.displayHexColor : '#ffffff',
        };

        res.render('dashboard/message-builder', {
            title: `Message Builder — ${guild.name}`,
            guild,
            channels,
            roles,
            templates,
            loginUser,
            botUser,
            activePage: 'message-builder',
            hasSidebar: true
        });
    } catch (err) {
        console.error('[dashboard/message-builder] Error:', err);
        res.status(500).render('error', {
            hasSidebar: false,
            title: 'Server Error',
            message: 'Gagal memuat halaman Message Builder.'
        });
    }
});

// GET /dashboard/:guildId/invites
router.get('/:guildId/invites', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const guild = req.botGuild;

        let invites    = [];
        let fetchError = null;

        try {
            // Gunakan cache 60 detik — hindari fetch ke Discord API setiap page load
            invites = await _getCachedInvites(guild);
        } catch {
            fetchError = 'Bot tidak memiliki izin Manage Guild untuk membaca invite server ini.';
        }

        const totalUses      = invites.reduce((s, inv) => s + inv.uses, 0);
        const uniqueInviters = new Set(invites.map(inv => inv.inviterId).filter(Boolean)).size;

        res.render('dashboard/invites', {
            title: `Invite Links — ${guild.name}`,
            guild,
            invites,
            totalUses,
            uniqueInviters,
            fetchError,
            activePage: 'invites',
            hasSidebar: true
        });
    } catch (err) {
        console.error('[dashboard/invites] Error:', err);
        res.status(500).render('error', {
            hasSidebar: false,
            title: 'Server Error',
            message: 'Gagal memuat halaman Invite Links.'
        });
    }
});

// GET /dashboard/:guildId/serverstats
router.get('/:guildId/serverstats', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const db      = req.discordClient?.database;
        const guildId = req.params.guildId;
        const guild   = req.botGuild;

        const { getServerStatsConfig } = require('../../utils/serverStatsHelper');
        const cfg = getServerStatsConfig({ database: db }, guildId);

        // Pakai cache TTL 5 menit — hindari fetch semua member setiap page load
        const { totalCount, humanCount, botCount } = await _getCachedMemberStats(guild);

        // Gunakan channel cache yang sudah ada; hanya fetch jika kosong
        await _ensureChannels(guild);
        const totalCh = cfg.totalId    ? guild.channels.cache.get(cfg.totalId)    : null;
        const humanCh = cfg.humanId    ? guild.channels.cache.get(cfg.humanId)    : null;
        const botCh   = cfg.botId      ? guild.channels.cache.get(cfg.botId)      : null;
        const catCh   = cfg.categoryId ? guild.channels.cache.get(cfg.categoryId) : null;

        res.render('dashboard/serverstats', {
            title: `Server Stats — ${guild.name}`,
            guild,
            serverstatsData: cfg,
            totalCount,
            humanCount,
            botCount,
            channels: {
                total:    totalCh ? { id: totalCh.id, name: totalCh.name } : null,
                human:    humanCh ? { id: humanCh.id, name: humanCh.name } : null,
                bot:      botCh   ? { id: botCh.id,   name: botCh.name   } : null,
                category: catCh   ? { id: catCh.id,   name: catCh.name   } : null,
            },
            activePage: 'serverstats',
            hasSidebar: true
        });
    } catch (err) {
        console.error('[dashboard/serverstats] Error:', err);
        res.status(500).render('error', {
            hasSidebar: false,
            title: 'Server Error',
            message: 'Gagal memuat halaman Server Stats.'
        });
    }
});

module.exports = router;

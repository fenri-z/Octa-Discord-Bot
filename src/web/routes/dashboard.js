/**
 * routes/dashboard.js
 * Key database disesuaikan dengan slashcommand-welcome.js & slashcommand-goodbye.js
 */

const express             = require('express');
const { PermissionsBitField } = require('discord.js');
const config  = require('../../config');
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
        inviterTag:  inv.inviter?.username  ?? 'Unknown',
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
    { flag: PermissionsBitField.Flags.ViewChannel,        name: 'View Channel',         desc: 'View channels' },
    { flag: PermissionsBitField.Flags.SendMessages,       name: 'Send Messages',        desc: 'Send messages (welcome, goodbye, etc.)' },
    { flag: PermissionsBitField.Flags.EmbedLinks,         name: 'Embed Links',          desc: 'Send embeds (welcome, goodbye, messages)' },
    { flag: PermissionsBitField.Flags.AttachFiles,        name: 'Attach Files',         desc: 'Send welcome card images' },
    { flag: PermissionsBitField.Flags.ManageRoles,        name: 'Manage Roles',         desc: 'Autorole & autorole button' },
    { flag: PermissionsBitField.Flags.ManageChannels,     name: 'Manage Channels',      desc: 'Server Stats (create stats channels)' },
    { flag: PermissionsBitField.Flags.ChangeNickname,     name: 'Change Nickname',      desc: "Change the bot's own nickname" },
    { flag: PermissionsBitField.Flags.ReadMessageHistory, name: 'Read Message History', desc: 'Read message history' },
];

function getMissingPerms(guild) {
    const me = guild.members.me;
    return me ? REQUIRED_PERMS.filter(p => !me.permissions.has(p.flag)) : [];
}

// Cek permission dengan BigInt agar tidak terpotong di atas 32-bit.
// Administrator (0x8) dianggap setara dengan Manage Guild.
function canManageGuild(g) {
    if (g.owner) return true;
    try {
        const p = BigInt(g.permissions || '0');
        return (p & 0x20n) !== 0n || (p & 0x8n) !== 0n;
    } catch { return false; }
}

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

    const guild = userGuilds.find(g => g.id === guildId && canManageGuild(g));

    if (!guild) {
        return res.status(403).render('error', { hasSidebar: false,
            title: 'Akses Ditolak',
            message: 'You do not have permission to manage this server.'
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
    const manageableGuilds = userGuilds.filter(canManageGuild);
    res.locals.mutualGuilds = manageableGuilds
        .filter(g => req.discordClient?.guilds.cache.has(g.id))
        .map(g => {
            const djs = req.discordClient.guilds.cache.get(g.id);
            return {
                id:       g.id,
                name:     djs?.name ?? g.name,
                iconURL:  djs?.iconURL({ size: 64 }) ?? (g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null),
                isActive: g.id === guildId
            };
        });

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

// GET /dashboard/refresh — re-fetch daftar guild dari Discord API
router.get('/refresh', requireLogin, async (req, res) => {
    const token = req.user?._accessToken;
    if (!token) return res.redirect('/dashboard');
    try {
        const resp = await fetch('https://discord.com/api/v10/users/@me/guilds', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (resp.ok) {
            const guilds = await resp.json();
            req.user.guilds = guilds;
            await new Promise((resolve) => req.session.save(resolve));
        }
    } catch (_) { /* abaikan error, tetap redirect */ }
    res.redirect('/dashboard');
});

// GET /dashboard
router.get('/', requireLogin, (req, res) => {
    const userGuilds = req.user?.guilds || [];

    const manageableGuilds = userGuilds.filter(canManageGuild);

    const guildsWithStatus = manageableGuilds.map(g => {
        const botGuild = req.discordClient?.guilds.cache.get(g.id);
        return {
            ...g,
            name:        botGuild?.name ?? g.name,
            botPresent:  !!botGuild,
            iconURL:     botGuild?.iconURL({ size: 256 }) ?? (g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=256` : null),
            bannerURL:   botGuild?.bannerURL({ size: 480 }) ?? (g.banner ? `https://cdn.discordapp.com/banners/${g.id}/${g.banner}.png?size=480` : null),
            memberCount: botGuild?.memberCount ?? null,
        };
    });

    res.render('dashboard/servers', {
        title: 'Dashboard',
        guilds: guildsWithStatus,
        hasSidebar: false
    });
});

// GET /dashboard/:guildId
router.get('/:guildId', requireLogin, requireManageGuild, (req, res) => {
    const guild       = req.botGuild;
    const me          = guild.members.me;
    const db          = req.discordClient?.database;
    const botNickname = me?.nickname || req.discordClient?.user?.username || 'Bot';
    const botPrefix   = db?.get(`prefix_${guild.id}`) || config.commands.prefix;

    const missingPerms = me
        ? REQUIRED_PERMS.filter(p => !me.permissions.has(p.flag))
        : [];

    res.render('dashboard/home', {
        title: guild.name,
        guild,
        guildData: req.userGuildData,
        botNickname,
        botPrefix,
        defaultPrefix: config.commands.prefix,
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
            messageType:       db?.get(`welcome-messageType-${guildId}`)             ?? 'plain',
            plainText:         db?.get(`welcome-plainText-${guildId}`)               ?? 'Hello {member}, welcome to **{server}**! 🎉 You are member #**{count}**.',
            title:             db?.get(`welcome-title-${guildId}`)                   ?? '👋 Welcome to {server}!',
            description:       db?.get(`welcome-description-${guildId}`)             ?? 'Hello {member}, glad to have you here! 🎉\nYou are member #**{count}**.',
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
            .filter(c => c.type === 0 || c.type === 5 || c.type === 10 || c.type === 11 || c.type === 12)
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
            title: 'Welcome Notification',
            guild,
            channels,
            roles,
            welcomeData,
            missingPerms: getMissingPerms(guild),
            loginUser,
            botUser,
            activePage: 'welcome',
            hasSidebar: true
        });
    } catch (err) {
        console.error('[dashboard/welcome] Error fetching guild data:', err);
        res.status(500).render('error', { hasSidebar: false,
            title: 'Server Error',
            message: 'Failed to load server data from Discord.'
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
            messageType:   db?.get(`goodbye-messageType-${guildId}`)          ?? 'plain',
            plainText:     db?.get(`goodbye-plainText-${guildId}`)            ?? 'Goodbye, {member}! Thanks for being with us in **{server}**.',
            title:         db?.get(`goodbye-title-${guildId}`)                ?? '👋 Goodbye!',
            description:   db?.get(`goodbye-description-${guildId}`)          ?? '{member} has left the server.',
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
            .filter(c => c.type === 0 || c.type === 5 || c.type === 10 || c.type === 11 || c.type === 12)
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
            title: 'Goodbye Notification',
            guild,
            channels,
            roles,
            goodbyeData,
            missingPerms: getMissingPerms(guild),
            loginUser,
            botUser,
            activePage: 'goodbye',
            hasSidebar: true
        });
    } catch (err) {
        console.error('[dashboard/goodbye] Error fetching guild data:', err);
        res.status(500).render('error', { hasSidebar: false,
            title: 'Server Error',
            message: 'Failed to load server data from Discord.'
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
            messageType:        db?.get(`booster-boost-messageType-${guildId}`)             ?? 'plain',
            plainText:          db?.get(`booster-boost-plainText-${guildId}`)               ?? '🚀 {member} just boosted **{server}**! Total boosts: **{boosts}**.',
            title:              db?.get(`booster-boost-title-${guildId}`)                   ?? '🚀 New Server Boost!',
            description:        db?.get(`booster-boost-desc-${guildId}`)                    ?? 'Thank you {member} for boosting this server! 💖\nTotal boosts now: **{boosts}**.',
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
            messageType:        db?.get(`booster-unboost-messageType-${guildId}`)            ?? 'plain',
            plainText:          db?.get(`booster-unboost-plainText-${guildId}`)              ?? '💔 {member} has stopped boosting **{server}**. Total boosts: **{boosts}**.',
            title:              db?.get(`booster-unboost-title-${guildId}`)                  ?? '💔 Boost Ended',
            description:        db?.get(`booster-unboost-desc-${guildId}`)                   ?? '{member} has removed their boost from the server.\nTotal boosts now: **{boosts}**.',
            color:              db?.get(`booster-unboost-color-${guildId}`)                  ?? '#ED4245',
            footerText:         db?.get(`booster-unboost-footer-${guildId}`)                 ?? '',
            showMember:         getDbBool(db, `booster-unboost-showMember-${guildId}`,       true),
            showTotalBoost:     getDbBool(db, `booster-unboost-showTotalBoost-${guildId}`,   true),
            showLevelServer:    getDbBool(db, `booster-unboost-showLevelServer-${guildId}`,  true),
            showThumbnail:      getDbBool(db, `booster-unboost-showThumbnail-${guildId}`,    true),
            cardEnabled:        getDbBool(db, `booster-unboost-cardEnabled-${guildId}`,      false),
            cardWelcomeText:    db?.get(`booster-unboost-cardWelcomeText-${guildId}`)        ?? 'UNBOOST',
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
            .filter(c => c.type === 0 || c.type === 5 || c.type === 10 || c.type === 11 || c.type === 12)
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

        const boosterTab   = req.query.tab === 'unboost' ? 'Unboost Notification' : 'Boost Notification';
        res.render('dashboard/booster', {
            title: boosterTab,
            guild,
            channels,
            roles,
            missingPerms: getMissingPerms(guild),
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

    // ── Autorole Reaction: ambil semua panel ──────────────────────────────
    let reactPanelNames = [];
    try {
        const raw = db?.get(`autoreact-list-${guildId}`);
        reactPanelNames = raw ? JSON.parse(raw) : [];
    } catch { reactPanelNames = []; }

    const reactPanels = reactPanelNames.map(name => {
        try {
            const raw = db?.get(`autoreact-${guildId}-${name}`);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch { return null; }
    }).filter(Boolean);

    const sentReactPanels = {};
    for (const p of reactPanels) {
        try {
            const raw = db?.get(`autoreact-sent-${guildId}-${p.name}`);
            if (raw) sentReactPanels[p.name] = JSON.parse(raw);
        } catch {}
    }

    // ── Roles & Channels ──────────────────────────────────────────────────
    const botRolePosition = guild.members.me?.roles.highest.position || 0;
    const roles = [...guild.roles.cache.values()]
        .filter(r => r.id !== guild.id && r.position < botRolePosition)
        .map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#99aab5' : r.hexColor }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const channels = [...guild.channels.cache.values()]
        .filter(c => c.type === 0 || c.type === 5 || c.type === 10 || c.type === 11 || c.type === 12)
        .map(c => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const autoroleTabTitles = { join: 'Autorole Join', booster: 'Autorole Booster', button: 'Autorole Button', reaction: 'Autorole Reaction' };
    res.render('dashboard/autorole', {
        title: autoroleTabTitles[req.query.tab] || 'Auto Role',
        guild,
        roles,
        channels,
        missingPerms: getMissingPerms(guild),
        joinData,
        boosterData,
        panels,
        sentPanels,
        reactPanels,
        sentReactPanels,
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
            .filter(c => c.type === 0 || c.type === 5 || c.type === 10 || c.type === 11 || c.type === 12)
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
            title: 'Message Builder',
            guild,
            channels,
            roles,
            missingPerms: getMissingPerms(guild),
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
            message: 'Failed to load the Message Builder page.'
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
            fetchError = 'Bot does not have the Manage Guild permission to read server invites.';
        }

        const totalUses      = invites.reduce((s, inv) => s + inv.uses, 0);
        const uniqueInviters = new Set(invites.map(inv => inv.inviterId).filter(Boolean)).size;

        res.render('dashboard/invites', {
            title: 'Invite Links',
            guild,
            invites,
            totalUses,
            missingPerms: getMissingPerms(guild),
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
            message: 'Failed to load the Invite Links page.'
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
            title: 'Server Stats',
            guild,
            serverstatsData: cfg,
            missingPerms: getMissingPerms(guild),
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
            message: 'Failed to load the Server Stats page.'
        });
    }
});

// ── GET /dashboard/:guildId/ticket ────────────────────────────────────────────
router.get('/:guildId/ticket', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const guild   = req.botGuild;

    await _ensureRoles(guild);
    await _ensureChannels(guild);

    const staffRolesRaw = db?.get(`ticket-staff-roles-${guildId}`);
    let staffRoles = [];
    try { staffRoles = staffRolesRaw ? JSON.parse(staffRolesRaw) : []; } catch {}

    const panelMsgRaw = db?.get(`ticket-panel-msg-${guildId}`);
    let panelSent = false, panelMsgId = null, panelChannelId = null;
    try {
        if (panelMsgRaw) {
            const p = JSON.parse(panelMsgRaw);
            panelSent = true; panelMsgId = p.messageId; panelChannelId = p.channelId;
        }
    } catch {}

    const ticketData = {
        enabled:       !!db?.get(`ticket-enabled-${guildId}`),
        categoryId:    db?.get(`ticket-category-${guildId}`)    ?? '',
        logChannelId:  db?.get(`ticket-log-channel-${guildId}`) ?? '',
        staffRoles,
        embedTitle:    db?.get(`ticket-embed-title-${guildId}`) ?? '🎫 Support Ticket',
        embedDesc:     db?.get(`ticket-embed-desc-${guildId}`)  ?? 'Click the button below to create a ticket and get help from staff.',
        embedColor:    db?.get(`ticket-embed-color-${guildId}`) ?? '#5865F2',
        btnLabel:      db?.get(`ticket-embed-btn-label-${guildId}`) ?? '📩 Create Ticket',
        panelSent,
        panelMsgId,
        panelChannelId,
    };

    // Ambil tiket yang sedang terbuka
    const openListRaw = db?.get(`ticket-open-list-${guildId}`);
    let openList = [];
    try { openList = openListRaw ? JSON.parse(openListRaw) : []; } catch {}

    const openTickets = openList.map(channelId => {
        try {
            const info = JSON.parse(db?.get(`ticket-info-${guildId}-${channelId}`) || '{}');
            return { ...info, channelId };
        } catch { return null; }
    }).filter(Boolean);

    const botRolePosition = guild.members.me?.roles.highest.position || 0;
    const roles = [...guild.roles.cache.values()]
        .filter(r => r.id !== guild.id && r.position < botRolePosition)
        .map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#99aab5' : r.hexColor }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const channels = [...guild.channels.cache.values()]
        .filter(c => c.type === 0 || c.type === 5 || c.type === 10 || c.type === 11 || c.type === 12)
        .map(c => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const categories = [...guild.channels.cache.values()]
        .filter(c => c.type === 4)
        .map(c => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name));

    res.render('dashboard/ticket', {
        title: 'Ticket',
        guild, roles, channels, categories, ticketData, openTickets,
        missingPerms: getMissingPerms(guild),
        activePage: 'ticket', hasSidebar: true
    });
});

// ── GET /dashboard/:guildId/tiktok ───────────────────────────────────────────
router.get('/:guildId/tiktok', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const db      = req.discordClient?.database;
        const guildId = req.params.guildId;
        const guild   = req.botGuild;

        await _ensureChannels(guild);

        let ttAccounts = [];
        try { ttAccounts = JSON.parse(db?.get(`tiktok-accounts-${guildId}`) || '[]'); }
        catch { ttAccounts = []; }

        const lastVideoIds = {};
        for (const acc of ttAccounts) {
            lastVideoIds[acc.username] = db?.get(`tiktok-lastVideo-${guildId}-${acc.username}`) || null;
        }

        const channels = [...guild.channels.cache.values()]
            .filter(c => c.type === 0 || c.type === 5 || c.type === 10 || c.type === 11 || c.type === 12)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const rsshubBase    = (process.env.RSSHUB_BASE_URL || 'https://rsshub.app').replace(/\/$/, '');
        const liveSupported = !!(req.discordClient?.tiktokNotifier?.liveSupported);

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
        if (botClientUser) botMember = await _getMember(guild, botClientUser.id);
        const botUser = {
            username:  botMember?.displayName || botClientUser?.username || 'Bot',
            avatarUrl: botClientUser?.avatar
                ? `https://cdn.discordapp.com/avatars/${botClientUser.id}/${botClientUser.avatar}.png?size=256`
                : 'https://cdn.discordapp.com/embed/avatars/0.png',
            roleColor: (botMember?.displayHexColor && botMember.displayHexColor !== '#000000')
                ? botMember.displayHexColor : '#ffffff',
        };

        await _ensureRoles(guild);
        const roles = [...guild.roles.cache.values()]
            .filter(r => r.id !== guild.id)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#99aab5' : r.hexColor }))
            .sort((a, b) => b.position - a.position);

        res.render('dashboard/tiktok', {
            title: 'TikTok Notification',
            guild,
            channels,
            roles,
            ttAccounts,
            lastVideoIds,
            rsshubBase,
            liveSupported,
            loginUser,
            botUser,
            maxAccounts: 10,
            missingPerms: getMissingPerms(guild),
            activePage: 'tiktok',
            hasSidebar: true,
        });
    } catch (err) {
        console.error('[dashboard/tiktok] Error:', err);
        res.status(500).render('error', {
            hasSidebar: false,
            title: 'Server Error',
            message: 'Failed to load the TikTok Notification page.',
        });
    }
});

// ── GET /dashboard/:guildId/giveaway ─────────────────────────────────────────
router.get('/:guildId/giveaway', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const guildId = req.params.guildId;
        const guild   = req.botGuild;

        await _ensureChannels(guild);
        await _ensureRoles(guild);

        const channels = [...guild.channels.cache.values()]
            .filter(c => c.type === 0 || c.type === 5 || c.type === 10 || c.type === 11 || c.type === 12)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const botRolePosition = guild.members.me?.roles.highest.position || 0;
        const roles = [...guild.roles.cache.values()]
            .filter(r => r.id !== guild.id && r.position < botRolePosition)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#99aab5' : r.hexColor }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const manager   = req.discordClient?.giveawayManager;
        const giveaways = manager ? manager.getAll(guildId) : [];

        res.render('dashboard/giveaway', {
            title: 'Giveaway',
            guild, channels, roles, giveaways,
            missingPerms: getMissingPerms(guild),
            activePage: 'giveaway',
            hasSidebar: true,
        });
    } catch (err) {
        console.error('[dashboard/giveaway] Error:', err);
        res.status(500).render('error', {
            hasSidebar: false,
            title: 'Server Error',
            message: 'Failed to load the Giveaway page.',
        });
    }
});

// ── GET /dashboard/:guildId/twitch ───────────────────────────────────────────
router.get('/:guildId/twitch', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const db      = req.discordClient?.database;
        const guildId = req.params.guildId;
        const guild   = req.botGuild;

        await _ensureChannels(guild);

        let twAccounts = [];
        try { twAccounts = JSON.parse(db?.get(`twitch-accounts-${guildId}`) || '[]'); }
        catch { twAccounts = []; }

        const channels = [...guild.channels.cache.values()]
            .filter(c => c.type === 0 || c.type === 5 || c.type === 10 || c.type === 11 || c.type === 12)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const notifier     = req.discordClient?.twitchNotifier;
        const isConfigured = true; // polling GQL — tidak butuh credentials

        const botClientUser = req.discordClient?.user;
        let botMember = null;
        if (botClientUser) botMember = await _getMember(guild, botClientUser.id);
        const botUser = {
            username:  botMember?.displayName || botClientUser?.username || 'Bot',
            avatarUrl: botClientUser?.avatar
                ? `https://cdn.discordapp.com/avatars/${botClientUser.id}/${botClientUser.avatar}.png?size=256`
                : 'https://cdn.discordapp.com/embed/avatars/0.png',
            roleColor: (botMember?.displayHexColor && botMember.displayHexColor !== '#000000')
                ? botMember.displayHexColor : '#ffffff',
        };

        await _ensureRoles(guild);
        const roles = [...guild.roles.cache.values()]
            .filter(r => r.id !== guild.id)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#99aab5' : r.hexColor }))
            .sort((a, b) => b.position - a.position);

        res.render('dashboard/twitch', {
            title: 'Twitch Notification',
            guild,
            channels,
            roles,
            twAccounts,
            isConfigured,
            maxAccounts: 10,
            missingPerms: getMissingPerms(guild),
            botUser,
            activePage: 'twitch',
            hasSidebar: true,
        });
    } catch (err) {
        console.error('[dashboard/twitch] Error:', err);
        res.status(500).render('error', {
            hasSidebar: false,
            title: 'Server Error',
            message: 'Failed to load the Twitch Notification page.',
        });
    }
});

// ── GET /dashboard/:guildId/kick ─────────────────────────────────────────────
router.get('/:guildId/kick', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const db      = req.discordClient?.database;
        const guildId = req.params.guildId;
        const guild   = req.botGuild;

        await _ensureChannels(guild);

        let kickAccounts = [];
        try { kickAccounts = JSON.parse(db?.get(`kick-accounts-${guildId}`) || '[]'); }
        catch { kickAccounts = []; }

        const channels = [...guild.channels.cache.values()]
            .filter(c => c.type === 0 || c.type === 5 || c.type === 10 || c.type === 11 || c.type === 12)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const isConfigured = !!(req.discordClient?.kickNotifier?.isConfigured);

        await _ensureRoles(guild);
        const roles = [...guild.roles.cache.values()]
            .filter(r => r.id !== guild.id)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#99aab5' : r.hexColor }))
            .sort((a, b) => b.position - a.position);

        res.render('dashboard/kick', {
            title: 'Kick Notification',
            guild,
            channels,
            roles,
            kickAccounts,
            maxAccounts: 10,
            isConfigured,
            missingPerms: getMissingPerms(guild),
            activePage: 'kick',
            hasSidebar: true,
        });
    } catch (err) {
        console.error('[dashboard/kick] Error:', err);
        res.status(500).render('error', {
            hasSidebar: false,
            title: 'Server Error',
            message: 'Failed to load the Kick Notification page.',
        });
    }
});

// ── GET /dashboard/:guildId/youtube ──────────────────────────────────────────
router.get('/:guildId/youtube', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const db      = req.discordClient?.database;
        const guildId = req.params.guildId;
        const guild   = req.botGuild;

        await _ensureChannels(guild);

        let ytChannels = [];
        try { ytChannels = JSON.parse(db?.get(`youtube-channels-${guildId}`) || '[]'); }
        catch { ytChannels = []; }
        // Decode HTML entities di nama channel (data lama mungkin tersimpan dengan &amp; dsb.)
        const _decHtml = s => (s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        ytChannels = ytChannels.map(ch => ({ ...ch, name: _decHtml(ch.name) }));

        const channels = [...guild.channels.cache.values()]
            .filter(c => c.type === 0 || c.type === 5 || c.type === 10 || c.type === 11 || c.type === 12)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const useWebSub = !!process.env.BASE_URL;

        await _ensureRoles(guild);
        const roles = [...guild.roles.cache.values()]
            .filter(r => r.id !== guild.id)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#99aab5' : r.hexColor }))
            .sort((a, b) => b.position - a.position);

        // Ambil last video ID dan WebSub metadata per channel
        const lastVideoIds = {};
        const websubMeta   = {};
        for (const ch of ytChannels) {
            lastVideoIds[ch.id] = db?.get(`youtube-lastVideo-${guildId}-${ch.id}`) || null;
            try { websubMeta[ch.id] = JSON.parse(db?.get(`youtube-websub-${ch.id}`) || '{}'); }
            catch { websubMeta[ch.id] = {}; }
        }

        res.render('dashboard/youtube', {
            title: 'YouTube Notification',
            guild,
            channels,
            roles,
            ytChannels,
            useWebSub,
            lastVideoIds,
            websubMeta,
            maxChannels: 10,
            missingPerms: getMissingPerms(guild),
            activePage: 'youtube',
            hasSidebar: true,
        });
    } catch (err) {
        console.error('[dashboard/youtube] Error:', err);
        res.status(500).render('error', {
            hasSidebar: false,
            title: 'Server Error',
            message: 'Failed to load the YouTube Notification page.'
        });
    }
});

// ── GET /dashboard/:guildId/automod ───────────────────────────────────────────
router.get('/:guildId/automod', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const db      = req.discordClient?.database;
        const guildId = req.params.guildId;
        const guild   = req.botGuild;

        await _ensureChannels(guild);
        await _ensureRoles(guild);

        function getJSON(key, def) {
            const raw = db?.get(key);
            if (!raw) return def;
            try { return JSON.parse(raw); } catch { return def; }
        }

        const spamCfg        = getJSON(`automod-spam-${guildId}`,        { enabled: false, limit: 5, interval: 5 });
        const mentionCfg     = getJSON(`automod-massmention-${guildId}`, { enabled: false, limit: 5 });
        const raidCfg        = getJSON(`automod-antiraid-${guildId}`,    { enabled: false, joinLimit: 10, interval: 10 });
        const bannedWords    = getJSON(`automod-words-${guildId}`,       []);
        const wlChannelIds   = getJSON(`automod-wl-channels-${guildId}`, []);
        const wlRoleIds      = getJSON(`automod-wl-roles-${guildId}`,    []);

        const textChannels = [...guild.channels.cache.values()]
            .filter(c => c.type === 0)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(c => ({ id: c.id, name: c.name }));

        const roles = [...guild.roles.cache.values()]
            .filter(r => !r.managed && r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor !== '#000000' ? r.hexColor : null }));

        const automodData = {
            action:       db?.get(`automod-action-${guildId}`)           ?? 'delete',
            muteDuration: db?.get(`automod-mute-duration-${guildId}`)    ?? '600000',
            auditLogId:   db?.get(`automod-auditlog-${guildId}`)         ?? '',
            antilink:    getDbBool(db, `automod-antilink-${guildId}`,    false),
            antiinvite:  getDbBool(db, `automod-antiinvite-${guildId}`,  false),
            attachments: getDbBool(db, `automod-attachments-${guildId}`, false),
            spam:        spamCfg,
            massmention: mentionCfg,
            antiraid:    raidCfg,
            words:       bannedWords,
            wlChannels:  wlChannelIds,
            wlRoles:     wlRoleIds,
        };

        const activeCount = [
            automodData.antilink,
            automodData.antiinvite,
            automodData.attachments,
            automodData.spam.enabled,
            automodData.massmention.enabled,
            automodData.antiraid.enabled,
            automodData.words.length > 0,
        ].filter(Boolean).length;

        res.render('dashboard/automod', {
            title: 'Automod',
            guild,
            automodData,
            textChannels,
            roles,        // still used for role whitelist
            activeCount,
            missingPerms: getMissingPerms(guild),
            activePage: 'automod',
            hasSidebar: true,
        });
    } catch (err) {
        console.error('[dashboard/automod] Error:', err);
        res.status(500).render('error', {
            hasSidebar: false,
            title: 'Server Error',
            message: 'Failed to load the Automod page.'
        });
    }
});

// ── GET /:guildId/warnings ────────────────────────────────────────────────────
router.get('/:guildId/warnings', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const guild   = req.botGuild;
        const guildId = guild.id;
        const db      = req.discordClient?.database;

        function getWarnJSON(key, def) {
            const raw = db?.get(key);
            if (!raw) return def;
            try { return JSON.parse(raw); } catch { return def; }
        }

        const config   = getWarnJSON(`warn-config-${guildId}`, { thresholds: [] });
        const warnLog  = getWarnJSON(`warn-log-${guildId}`, []);

        // Normalisasi: pastikan selalu ada tepat 2 slot threshold di UI
        const t1 = config.thresholds[0] ?? { count: 3, action: 'none', duration: 600000 };
        const t2 = config.thresholds[1] ?? { count: 5, action: 'none', duration: 600000 };

        const activeThresholds = config.thresholds.filter(t => t.action && t.action !== 'none').length;

        res.render('dashboard/warnings', {
            title:   'Warning System',
            guild,
            warnLog,
            t1,
            t2,
            activeThresholds,
            activePage:  'warnings',
            hasSidebar:  true,
            missingPerms: getMissingPerms(guild),
        });
    } catch (err) {
        console.error('[dashboard/warnings] Error:', err);
        res.status(500).render('error', {
            hasSidebar: false,
            title:   'Server Error',
            message: 'Failed to load the Warning System page.',
        });
    }
});

// ── GET /dashboard/:guildId/modlog ────────────────────────────────────────────
router.get('/:guildId/modlog', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const db      = req.discordClient?.database;
        const guildId = req.params.guildId;
        const guild   = req.botGuild;

        await _ensureChannels(guild);

        const DEFAULT_EVENTS = { ban: true, unban: true, kick: true, timeout: true, warn: true };
        function getModlogJSON(key, def) {
            const raw = db?.get(key);
            if (!raw) return def;
            try { return JSON.parse(raw); } catch { return def; }
        }

        const logChannelId = db?.get(`modlog-channel-${guildId}`) ?? '';
        const events       = { ...DEFAULT_EVENTS, ...getModlogJSON(`modlog-events-${guildId}`, {}) };

        const textChannels = [...guild.channels.cache.values()]
            .filter(c => c.type === 0)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(c => ({ id: c.id, name: c.name }));

        const enabledCount = Object.values(events).filter(Boolean).length;

        res.render('dashboard/modlog', {
            title: 'Mod Log',
            guild,
            logChannelId,
            events,
            enabledCount,
            textChannels,
            missingPerms: getMissingPerms(guild),
            activePage: 'modlog',
            hasSidebar: true,
        });
    } catch (err) {
        console.error('[dashboard/modlog] Error:', err);
        res.status(500).render('error', {
            hasSidebar: false,
            title: 'Server Error',
            message: 'Failed to load the Mod Log page.',
        });
    }
});

// ── GET /dashboard/:guildId/level ─────────────────────────────────────────────
router.get('/:guildId/level', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const db      = req.discordClient?.database;
        const guildId = req.params.guildId;
        const guild   = req.botGuild;

        await _ensureChannels(guild);
        await _ensureRoles(guild);

        const levelData = {
            enabled:  getDbBool(db, `level-enabled-${guildId}`, false),
            channelId: db?.get(`level-channel-${guildId}`) ?? '',
            message:   db?.get(`level-message-${guildId}`) ?? 'Selamat {member}, kamu naik ke Level **{level}**! 🎉',
            xpMin:    parseInt(db?.get(`level-xpMin-${guildId}`)    || '15'),
            xpMax:    parseInt(db?.get(`level-xpMax-${guildId}`)    || '25'),
            cooldown: parseInt(db?.get(`level-cooldown-${guildId}`) || '60'),
            roleRewards: (() => { try { return JSON.parse(db?.get(`level-roles-${guildId}`) || '[]'); } catch { return []; } })(),
        };

        const channels = [...guild.channels.cache.values()]
            .filter(c => c.type === 0 || c.type === 5 || c.type === 10 || c.type === 11 || c.type === 12)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const botRolePosition = guild.members.me?.roles.highest.position || 0;
        const roles = [...guild.roles.cache.values()]
            .filter(r => r.id !== guild.id && r.position < botRolePosition)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#99aab5' : r.hexColor }))
            .sort((a, b) => a.name.localeCompare(b.name));

        // Build leaderboard from DB
        const keys = db?.keysLike ? db.keysLike(`level-user-${guildId}-`) : [];
        const leaderboard = keys.map(k => {
            try {
                const d = JSON.parse(db.get(k) || '{}');
                const userId = k.replace(`level-user-${guildId}-`, '');
                return { userId, xp: d.xp || 0, level: d.level || 0 };
            } catch { return null; }
        }).filter(Boolean).sort((a, b) => b.xp - a.xp).slice(0, 10);

        res.render('dashboard/level', {
            title: 'Level / XP System',
            guild, channels, roles, levelData, leaderboard,
            missingPerms: getMissingPerms(guild),
            activePage: 'level',
            hasSidebar: true,
        });
    } catch (err) {
        console.error('[dashboard/level] Error:', err);
        res.status(500).render('error', { hasSidebar: false, title: 'Server Error', message: 'Gagal memuat halaman Level.' });
    }
});

// ── GET /dashboard/:guildId/starboard ─────────────────────────────────────────
router.get('/:guildId/starboard', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const db      = req.discordClient?.database;
        const guildId = req.params.guildId;
        const guild   = req.botGuild;

        await _ensureChannels(guild);

        const starboardData = {
            enabled:   getDbBool(db, `starboard-enabled-${guildId}`, false),
            channelId: db?.get(`starboard-channel-${guildId}`)   ?? '',
            emoji:     db?.get(`starboard-emoji-${guildId}`)     ?? '⭐',
            threshold: parseInt(db?.get(`starboard-threshold-${guildId}`) || '3'),
        };

        const channels = [...guild.channels.cache.values()]
            .filter(c => c.type === 0 || c.type === 5 || c.type === 10 || c.type === 11 || c.type === 12)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        res.render('dashboard/starboard', {
            title: 'Starboard',
            guild, channels, starboardData,
            missingPerms: getMissingPerms(guild),
            activePage: 'starboard',
            hasSidebar: true,
        });
    } catch (err) {
        console.error('[dashboard/starboard] Error:', err);
        res.status(500).render('error', { hasSidebar: false, title: 'Server Error', message: 'Gagal memuat halaman Starboard.' });
    }
});

// ── GET /dashboard/:guildId/custom-commands ───────────────────────────────────
router.get('/:guildId/custom-commands', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const db      = req.discordClient?.database;
        const guildId = req.params.guildId;
        const guild   = req.botGuild;

        await _ensureRoles(guild);
        await _ensureChannels(guild);

        let commands = [];
        try { commands = JSON.parse(db?.get(`customcmd-list-${guildId}`) || '[]'); } catch {}

        const channels = [...guild.channels.cache.values()]
            .filter(c => c.type === 0 || c.type === 5 || c.type === 10 || c.type === 11 || c.type === 12)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const roles = [...guild.roles.cache.values()]
            .filter(r => r.id !== guild.id)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#99aab5' : r.hexColor }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const u = req.user || {};
        const sampleUser = {
            username: u.username || 'user',
            id:       u.id       || '000000000000000000',
            avatarUrl: u.avatar
                ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=256`
                : 'https://cdn.discordapp.com/embed/avatars/0.png',
        };
        const guildIconUrl = guild.iconURL?.({ extension: 'png', size: 64 }) || '';

        res.render('dashboard/custom-commands', {
            title: 'Custom Commands',
            guild, commands, channels, roles,
            sampleUser, guildIconUrl,
            missingPerms: getMissingPerms(guild),
            activePage: 'custom-commands',
            hasSidebar: true,
        });
    } catch (err) {
        console.error('[dashboard/custom-commands] Error:', err);
        res.status(500).render('error', { hasSidebar: false, title: 'Server Error', message: 'Gagal memuat halaman Custom Commands.' });
    }
});

// ── GET /dashboard/:guildId/extlog ─────────────────────────────────────────────
router.get('/:guildId/extlog', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const db      = req.discordClient?.database;
        const guildId = req.params.guildId;
        const guild   = req.botGuild;

        await _ensureChannels(guild);

        const DEFAULT_EVENTS = { messageEdit: true, messageDelete: true, voiceActivity: true, nicknameChange: true, roleChange: true };
        let eventsRaw = {};
        try { eventsRaw = JSON.parse(db?.get(`extlog-events-${guildId}`) || '{}'); } catch {}

        const extlogData = {
            enabled:   getDbBool(db, `extlog-enabled-${guildId}`, false),
            channelId: db?.get(`extlog-channel-${guildId}`) ?? '',
            events:    { ...DEFAULT_EVENTS, ...eventsRaw },
        };

        const enabledCount = Object.values(extlogData.events).filter(Boolean).length;

        const textChannels = [...guild.channels.cache.values()]
            .filter(c => c.type === 0)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(c => ({ id: c.id, name: c.name }));

        res.render('dashboard/extlog', {
            title: 'Extended Logging',
            guild, textChannels, extlogData, enabledCount,
            missingPerms: getMissingPerms(guild),
            activePage: 'extlog',
            hasSidebar: true,
        });
    } catch (err) {
        console.error('[dashboard/extlog] Error:', err);
        res.status(500).render('error', { hasSidebar: false, title: 'Server Error', message: 'Gagal memuat halaman Extended Logging.' });
    }
});

module.exports = router;

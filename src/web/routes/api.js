/**
 * routes/api.js
 * REST API untuk menyimpan settings dari dashboard ke database bot.
 * Key database disesuaikan dengan yang dipakai slashcommand-welcome.js & slashcommand-goodbye.js
 * Semua endpoint return JSON.
 */

const express = require('express');
const router  = express.Router();

// ── Middleware: wajib login (return JSON error jika tidak) ────────────────────
function requireLogin(req, res, next) {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ success: false, message: 'Kamu harus login terlebih dahulu.' });
    }
    next();
}

// ── Middleware: cek izin Manage Guild + bot ada di server ─────────────────────
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
        return res.status(403).json({ success: false, message: 'Akses ditolak.' });
    }

    req.botGuild = req.discordClient?.guilds.cache.get(guildId);
    if (!req.botGuild) {
        return res.status(404).json({ success: false, message: 'Bot tidak ada di server ini.' });
    }

    next();
}

// ── Helper: set boolean di database ──────────────────────────────────────────
function setDbBool(db, key, val) {
    db.set(key, val ? 'true' : 'false');
}

// ── GET /api/guild/:guildId — info singkat server ─────────────────────────────
router.get('/guild/:guildId', requireLogin, requireManageGuild, (req, res) => {
    const guild = req.botGuild;
    res.json({
        success: true,
        guild: {
            id:          guild.id,
            name:        guild.name,
            memberCount: guild.memberCount,
            iconURL:     guild.iconURL()
        }
    });
});

// ── POST /api/guild/:guildId/welcome ──────────────────────────────────────────
router.post('/guild/:guildId/welcome', requireLogin, requireManageGuild, (req, res) => {
    const {
        enabled, channelId,
        messageType, plainText,
        title, description, color, footerText, thumbnail,
        showMemberNew, showAkunDibuat, showTotalMember,
        showDiundangOleh, showKodeInvite, showTotalUndangan,
        cardEnabled, cardWelcomeText, cardUserPrefix, cardSubText,
        cardBgColor, cardBgColor2, cardAccentColor, cardTextColor,
        cardAvatarShape, cardBgType, cardBgImageUrl,
        cardOverlayColor, cardOverlayOpacity,
        cardTitleColor, cardUsernameColor, cardMsgColor, cardFont,
    } = req.body;

    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;

    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    // Validasi channel
    if (channelId) {
        const channel = req.botGuild.channels.cache.get(channelId);
        if (!channel) return res.status(400).json({ success: false, message: 'Channel tidak ditemukan.' });
    }

    // Validasi warna hex
    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
        return res.status(400).json({ success: false, message: 'Format warna tidak valid. Gunakan format hex, contoh: #5865F2' });
    }

    // Simpan ke database — key sama persis dengan yang dipakai slashcommand-welcome.js
    setDbBool(db, `welcome-enabled-${guildId}`,           !!enabled);
    db.set(`welcome-channel-${guildId}`,                  channelId || '');
    // Tipe pesan dan teks biasa
    const validTypes = ['embed', 'plain'];
    db.set(`welcome-messageType-${guildId}`, validTypes.includes(messageType) ? messageType : 'embed');
    // Hapus key jika dikosongkan agar tidak ada nilai lama yang tersisa
    const _pt = (plainText   ?? '').trim();
    if (_pt) db.set(`welcome-plainText-${guildId}`, _pt); else db.delete(`welcome-plainText-${guildId}`);

    const _t  = (title       ?? '').trim();
    if (_t)  db.set(`welcome-title-${guildId}`, _t);       else db.delete(`welcome-title-${guildId}`);

    const _d  = (description ?? '').trim();
    if (_d)  db.set(`welcome-description-${guildId}`, _d); else db.delete(`welcome-description-${guildId}`);
    db.set(`welcome-color-${guildId}`,                    color?.trim()       || '#5865F2');

    // Footer: string kosong = hapus footer
    const footer = footerText?.trim();
    if (!footer || footer === '-') {
        db.delete(`welcome-footer-${guildId}`);
    } else {
        db.set(`welcome-footer-${guildId}`, footer);
    }

    setDbBool(db, `welcome-thumbnail-${guildId}`,         !!thumbnail);
    setDbBool(db, `welcome-showMemberNew-${guildId}`,     !!showMemberNew);
    setDbBool(db, `welcome-showAkunDibuat-${guildId}`,    !!showAkunDibuat);
    setDbBool(db, `welcome-showTotalMember-${guildId}`,   !!showTotalMember);
    setDbBool(db, `welcome-showDiundangOleh-${guildId}`,  !!showDiundangOleh);
    setDbBool(db, `welcome-showKodeInvite-${guildId}`,    !!showKodeInvite);
    setDbBool(db, `welcome-showTotalUndangan-${guildId}`, !!showTotalUndangan);

    // Welcome card settings
    setDbBool(db, `welcome-cardEnabled-${guildId}`, !!cardEnabled);
    db.set(`welcome-cardWelcomeText-${guildId}`, (cardWelcomeText || 'WELCOME').slice(0, 20));
    db.set(`welcome-cardUserPrefix-${guildId}`,  cardUserPrefix != null ? String(cardUserPrefix).slice(0, 5) : '.');
    db.set(`welcome-cardSubText-${guildId}`,     (cardSubText || 'TO {server}').slice(0, 60));
    const hexRe = /^#[0-9A-Fa-f]{6}$/;
    db.set(`welcome-cardBgColor-${guildId}`,  hexRe.test(cardBgColor)    ? cardBgColor    : '#1a1a2e');
    db.set(`welcome-cardBgColor2-${guildId}`, hexRe.test(cardBgColor2)   ? cardBgColor2   : '#16213e');
    db.set(`welcome-cardAccent-${guildId}`,   hexRe.test(cardAccentColor)? cardAccentColor: '#5865F2');
    db.set(`welcome-cardTextColor-${guildId}`,hexRe.test(cardTextColor)  ? cardTextColor  : '#ffffff');
    // New customization fields
    db.set(`welcome-cardAvatarShape-${guildId}`,    cardAvatarShape === 'square' ? 'square' : 'circle');
    db.set(`welcome-cardBgType-${guildId}`,         ['gradient','solid','image','transparent'].includes(cardBgType) ? cardBgType : 'gradient');
    db.set(`welcome-cardBgImageUrl-${guildId}`,     (cardBgImageUrl || '').trim().slice(0, 500));
    db.set(`welcome-cardOverlayColor-${guildId}`,   hexRe.test(cardOverlayColor)   ? cardOverlayColor   : '#000000');
    db.set(`welcome-cardOverlayOpacity-${guildId}`, String(Math.max(0, Math.min(100, parseInt(cardOverlayOpacity) || 0))));
    db.set(`welcome-cardTitleColor-${guildId}`,     hexRe.test(cardTitleColor)     ? cardTitleColor     : '#ffffff');
    db.set(`welcome-cardUsernameColor-${guildId}`,  hexRe.test(cardUsernameColor)  ? cardUsernameColor  : '#5865F2');
    db.set(`welcome-cardMsgColor-${guildId}`,       hexRe.test(cardMsgColor)       ? cardMsgColor       : '#cccccc');
    db.set(`welcome-cardFont-${guildId}`,           ['impact','arial','georgia','courier','verdana'].includes(cardFont) ? cardFont : 'impact');

    res.json({ success: true, message: 'Pengaturan welcome berhasil disimpan.' });
});

// ── POST /api/guild/:guildId/goodbye ──────────────────────────────────────────
router.post('/guild/:guildId/goodbye', requireLogin, requireManageGuild, (req, res) => {
    const {
        enabled, channelId,
        messageType, plainText,
        title, description, color, footerText, thumbnail,
        cardEnabled, cardWelcomeText, cardSubText,
        cardBgColor, cardBgColor2, cardAccentColor, cardTextColor,
        cardAvatarShape, cardBgType, cardBgImageUrl,
        cardOverlayColor, cardOverlayOpacity,
        cardTitleColor, cardUsernameColor, cardMsgColor, cardFont,
        showMember, showBergabung, showAkunDibuat, showTotalMember,
    } = req.body;

    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;

    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    if (channelId) {
        const channel = req.botGuild.channels.cache.get(channelId);
        if (!channel) return res.status(400).json({ success: false, message: 'Channel tidak ditemukan.' });
    }

    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
        return res.status(400).json({ success: false, message: 'Format warna tidak valid. Gunakan format hex, contoh: #ED4245' });
    }

    // Simpan ke database — key sama persis dengan yang dipakai slashcommand-goodbye.js
    setDbBool(db, `goodbye-enabled-${guildId}`,         !!enabled);
    db.set(`goodbye-channel-${guildId}`,                channelId || '');
    db.set(`goodbye-messageType-${guildId}`,            messageType === 'plain' ? 'plain' : 'embed');
    db.set(`goodbye-plainText-${guildId}`,              plainText?.trim()    || '');
    db.set(`goodbye-title-${guildId}`,                  title?.trim()        ?? '');
    db.set(`goodbye-description-${guildId}`,            description?.trim()  ?? '');
    db.set(`goodbye-color-${guildId}`,                  color?.trim()        || '#ED4245');

    const footer = footerText?.trim();
    if (!footer || footer === '-') {
        db.delete(`goodbye-footer-${guildId}`);
    } else {
        db.set(`goodbye-footer-${guildId}`, footer);
    }

    setDbBool(db, `goodbye-thumbnail-${guildId}`,       !!thumbnail);

    // Card settings
    setDbBool(db, `goodbye-cardEnabled-${guildId}`,     !!cardEnabled);
    db.set(`goodbye-cardWelcomeText-${guildId}`,        cardWelcomeText?.trim()  || 'GOODBYE');
    db.set(`goodbye-cardSubText-${guildId}`,            cardSubText?.trim()      || 'FROM {server}');
    db.set(`goodbye-cardBgColor-${guildId}`,            cardBgColor?.trim()      || '#1a0a0a');
    db.set(`goodbye-cardBgColor2-${guildId}`,           cardBgColor2?.trim()     || '#2e0a0a');
    db.set(`goodbye-cardAccent-${guildId}`,             cardAccentColor?.trim()  || '#ED4245');
    db.set(`goodbye-cardTextColor-${guildId}`,          cardTextColor?.trim()    || '#ffffff');
    db.set(`goodbye-cardAvatarShape-${guildId}`,        cardAvatarShape          || 'circle');
    db.set(`goodbye-cardBgType-${guildId}`,             cardBgType               || 'gradient');
    db.set(`goodbye-cardBgImageUrl-${guildId}`,         cardBgImageUrl?.trim()   || '');
    db.set(`goodbye-cardOverlayColor-${guildId}`,       cardOverlayColor?.trim() || '#000000');
    db.set(`goodbye-cardOverlayOpacity-${guildId}`,     String(parseInt(cardOverlayOpacity) || 0));
    db.set(`goodbye-cardTitleColor-${guildId}`,         cardTitleColor?.trim()   || '#ffffff');
    db.set(`goodbye-cardUsernameColor-${guildId}`,      cardUsernameColor?.trim() || '');
    db.set(`goodbye-cardMsgColor-${guildId}`,           cardMsgColor?.trim()     || '#cccccc');
    db.set(`goodbye-cardFont-${guildId}`,               cardFont                 || 'impact');

    // Fields
    setDbBool(db, `goodbye-showMember-${guildId}`,      !!showMember);
    setDbBool(db, `goodbye-showBergabung-${guildId}`,   !!showBergabung);
    setDbBool(db, `goodbye-showAkunDibuat-${guildId}`,  !!showAkunDibuat);
    setDbBool(db, `goodbye-showTotalMember-${guildId}`, !!showTotalMember);

    res.json({ success: true, message: 'Pengaturan goodbye berhasil disimpan.' });
});

// ── POST /api/guild/:guildId/autorole-join ────────────────────────────────
router.post('/guild/:guildId/autorole-join', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const { memberEnabled, memberRoleId, botEnabled, botRoleId } = req.body;
    const botHighest = req.botGuild.members.me?.roles.highest.position || 0;

    function validateRole(id, label) {
        if (!id) return null;
        const role = req.botGuild.roles.cache.get(id);
        if (!role) return `Role ${label} tidak ditemukan.`;
        if (role.position >= botHighest) return `Bot tidak bisa assign role ${label} (posisi terlalu tinggi).`;
        return null;
    }

    const errMember = validateRole(memberRoleId, 'Member');
    if (errMember) return res.json({ success: false, message: errMember });

    const errBot = validateRole(botRoleId, 'Bot');
    if (errBot) return res.json({ success: false, message: errBot });

    // Simpan dengan key yang sama seperti slashcommand-autorole.js
    db.set(`autorole-member-enabled-${guildId}`, memberEnabled ? 'true' : 'false');
    db.set(`autorole-bot-enabled-${guildId}`,    botEnabled    ? 'true' : 'false');

    if (memberRoleId) db.set(`autorole-member-role-${guildId}`, memberRoleId);
    else              db.delete(`autorole-member-role-${guildId}`);

    if (botRoleId) db.set(`autorole-bot-role-${guildId}`, botRoleId);
    else           db.delete(`autorole-bot-role-${guildId}`);

    res.json({ success: true, message: 'Autorole Join berhasil disimpan.' });
});

// ── POST /api/guild/:guildId/booster-boost ───────────────────────────────
router.post('/guild/:guildId/booster-boost', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const { enabled, channelId, messageType, plainText, title, description, color, footerText,
            showMember, showMulaiBoost, showTotalBoost, showLevelServer, showThumbnail,
            cardEnabled, cardWelcomeText, cardSubText, cardBgColor, cardBgColor2,
            cardAccentColor, cardAvatarShape, cardBgType, cardBgImageUrl,
            cardOverlayColor, cardOverlayOpacity, cardTitleColor, cardUsernameColor,
            cardMsgColor, cardFont } = req.body;

    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color))
        return res.json({ success: false, message: 'Format warna tidak valid. Contoh: #FF73FA' });

    db.set(`booster-boost-enabled-${guildId}`,        enabled ? 'true' : 'false');
    db.set(`booster-boost-messageType-${guildId}`,    messageType === 'plain' ? 'plain' : 'embed');
    db.set(`booster-boost-showMember-${guildId}`,     showMember     ? 'true' : 'false');
    db.set(`booster-boost-showMulaiBoost-${guildId}`, showMulaiBoost ? 'true' : 'false');
    db.set(`booster-boost-showTotalBoost-${guildId}`, showTotalBoost ? 'true' : 'false');
    db.set(`booster-boost-showLevelServer-${guildId}`,showLevelServer? 'true' : 'false');
    db.set(`booster-boost-showThumbnail-${guildId}`,  showThumbnail  ? 'true' : 'false');
    db.set(`booster-boost-cardEnabled-${guildId}`,    cardEnabled    ? 'true' : 'false');
    if (cardWelcomeText)    db.set(`booster-boost-cardWelcomeText-${guildId}`,    cardWelcomeText);
    if (cardSubText)        db.set(`booster-boost-cardSubText-${guildId}`,        cardSubText);
    if (cardBgColor)        db.set(`booster-boost-cardBgColor-${guildId}`,        cardBgColor);
    if (cardBgColor2)       db.set(`booster-boost-cardBgColor2-${guildId}`,       cardBgColor2);
    if (cardAccentColor)    db.set(`booster-boost-cardAccent-${guildId}`,         cardAccentColor);
    if (cardAvatarShape)    db.set(`booster-boost-cardAvatarShape-${guildId}`,    cardAvatarShape);
    if (cardBgType)         db.set(`booster-boost-cardBgType-${guildId}`,         cardBgType);
    if (cardBgImageUrl !== undefined) db.set(`booster-boost-cardBgImageUrl-${guildId}`, cardBgImageUrl || '');
    if (cardOverlayColor)   db.set(`booster-boost-cardOverlayColor-${guildId}`,   cardOverlayColor);
    if (cardOverlayOpacity !== undefined) db.set(`booster-boost-cardOverlayOpacity-${guildId}`, String(cardOverlayOpacity ?? 0));
    if (cardTitleColor)     db.set(`booster-boost-cardTitleColor-${guildId}`,     cardTitleColor);
    if (cardUsernameColor)  db.set(`booster-boost-cardUsernameColor-${guildId}`,  cardUsernameColor);
    if (cardMsgColor)       db.set(`booster-boost-cardMsgColor-${guildId}`,       cardMsgColor);
    if (cardFont)           db.set(`booster-boost-cardFont-${guildId}`,           cardFont);
    if (channelId)  db.set(`booster-boost-channel-${guildId}`,   channelId);
    else            db.delete(`booster-boost-channel-${guildId}`);
    if (plainText !== undefined) db.set(`booster-boost-plainText-${guildId}`, plainText);
    if (title !== undefined)       db.set(`booster-boost-title-${guildId}`,  title?.trim() ?? '');
    if (description !== undefined) db.set(`booster-boost-desc-${guildId}`,  description?.trim() ?? '');
    if (color)       db.set(`booster-boost-color-${guildId}`,  color);
    if (footerText !== undefined) {
        if (footerText) db.set(`booster-boost-footer-${guildId}`, footerText);
        else            db.delete(`booster-boost-footer-${guildId}`);
    }

    res.json({ success: true, message: 'Pengaturan Boost Notification berhasil disimpan.' });
});

// ── POST /api/guild/:guildId/booster-unboost ──────────────────────────────
router.post('/guild/:guildId/booster-unboost', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const { enabled, channelId, messageType, plainText, title, description, color, footerText,
            showMember, showTotalBoost, showLevelServer, showThumbnail,
            cardEnabled, cardWelcomeText, cardSubText, cardBgColor, cardBgColor2,
            cardAccentColor, cardAvatarShape, cardBgType, cardBgImageUrl,
            cardOverlayColor, cardOverlayOpacity, cardTitleColor, cardUsernameColor,
            cardMsgColor, cardFont } = req.body;

    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color))
        return res.json({ success: false, message: 'Format warna tidak valid. Contoh: #ED4245' });

    db.set(`booster-unboost-enabled-${guildId}`,        enabled ? 'true' : 'false');
    db.set(`booster-unboost-messageType-${guildId}`,    messageType === 'plain' ? 'plain' : 'embed');
    db.set(`booster-unboost-showMember-${guildId}`,     showMember     ? 'true' : 'false');
    db.set(`booster-unboost-showTotalBoost-${guildId}`, showTotalBoost ? 'true' : 'false');
    db.set(`booster-unboost-showLevelServer-${guildId}`,showLevelServer? 'true' : 'false');
    db.set(`booster-unboost-showThumbnail-${guildId}`,  showThumbnail  ? 'true' : 'false');
    db.set(`booster-unboost-cardEnabled-${guildId}`,    cardEnabled    ? 'true' : 'false');
    if (cardWelcomeText)    db.set(`booster-unboost-cardWelcomeText-${guildId}`,    cardWelcomeText);
    if (cardSubText)        db.set(`booster-unboost-cardSubText-${guildId}`,        cardSubText);
    if (cardBgColor)        db.set(`booster-unboost-cardBgColor-${guildId}`,        cardBgColor);
    if (cardBgColor2)       db.set(`booster-unboost-cardBgColor2-${guildId}`,       cardBgColor2);
    if (cardAccentColor)    db.set(`booster-unboost-cardAccent-${guildId}`,         cardAccentColor);
    if (cardAvatarShape)    db.set(`booster-unboost-cardAvatarShape-${guildId}`,    cardAvatarShape);
    if (cardBgType)         db.set(`booster-unboost-cardBgType-${guildId}`,         cardBgType);
    if (cardBgImageUrl !== undefined) db.set(`booster-unboost-cardBgImageUrl-${guildId}`, cardBgImageUrl || '');
    if (cardOverlayColor)   db.set(`booster-unboost-cardOverlayColor-${guildId}`,   cardOverlayColor);
    if (cardOverlayOpacity !== undefined) db.set(`booster-unboost-cardOverlayOpacity-${guildId}`, String(cardOverlayOpacity ?? 0));
    if (cardTitleColor)     db.set(`booster-unboost-cardTitleColor-${guildId}`,     cardTitleColor);
    if (cardUsernameColor)  db.set(`booster-unboost-cardUsernameColor-${guildId}`,  cardUsernameColor);
    if (cardMsgColor)       db.set(`booster-unboost-cardMsgColor-${guildId}`,       cardMsgColor);
    if (cardFont)           db.set(`booster-unboost-cardFont-${guildId}`,           cardFont);
    if (channelId)  db.set(`booster-unboost-channel-${guildId}`,   channelId);
    else            db.delete(`booster-unboost-channel-${guildId}`);
    if (plainText !== undefined) db.set(`booster-unboost-plainText-${guildId}`, plainText);
    if (title !== undefined)       db.set(`booster-unboost-title-${guildId}`,  title?.trim() ?? '');
    if (description !== undefined) db.set(`booster-unboost-desc-${guildId}`,  description?.trim() ?? '');
    if (color)       db.set(`booster-unboost-color-${guildId}`,  color);
    if (footerText !== undefined) {
        if (footerText) db.set(`booster-unboost-footer-${guildId}`, footerText);
        else            db.delete(`booster-unboost-footer-${guildId}`);
    }

    res.json({ success: true, message: 'Pengaturan Unboost Notification berhasil disimpan.' });
});

// ── POST /api/guild/:guildId/autorole-booster ─────────────────────────────
router.post('/guild/:guildId/autorole-booster', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const { autoroleEnabled, autoroleRoleId, autoremoveEnabled } = req.body;
    const botHighest = req.botGuild.members.me?.roles.highest.position || 0;

    if (autoroleRoleId) {
        const role = req.botGuild.roles.cache.get(autoroleRoleId);
        if (!role) return res.json({ success: false, message: 'Role tidak ditemukan.' });
        if (role.position >= botHighest) return res.json({ success: false, message: `Bot tidak bisa assign role tersebut (posisi terlalu tinggi).` });
    }

    db.set(`booster-autorole-enabled-${guildId}`,   autoroleEnabled   ? 'true' : 'false');
    db.set(`booster-autoremove-enabled-${guildId}`,  autoremoveEnabled ? 'true' : 'false');

    if (autoroleRoleId) db.set(`booster-autorole-role-${guildId}`, autoroleRoleId);
    else                db.delete(`booster-autorole-role-${guildId}`);

    res.json({ success: true, message: 'Autorole Booster berhasil disimpan.' });
});

// ── GET /api/guild/:guildId/autorole-button/:name — ambil satu panel ──────
router.get('/guild/:guildId/autorole-button/:name', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const name    = req.params.name.trim().toLowerCase();
    const raw     = db?.get(`autobtn-${guildId}-${name}`);
    if (!raw) return res.json({ success: false, message: 'Panel tidak ditemukan.' });
    try {
        const panel = JSON.parse(raw);
        const sentRaw = db?.get(`autobtn-sent-${guildId}-${name}`);
        panel.isSent  = !!sentRaw;
        res.json({ success: true, panel });
    } catch {
        res.json({ success: false, message: 'Data panel rusak.' });
    }
});

// ── POST /api/guild/:guildId/autorole-button — buat panel baru ────────────
// Field yang diterima (sinkron dengan slashcommand-autorole-button.js):
//   name, mode, embedTitle, embedDescription, embedFooter,
//   embedColor, embedImage, embedThumbnail
router.post('/guild/:guildId/autorole-button', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const {
        name, mode,
        messageType, plainText,
        embedTitle, embedDescription, embedFooter,
        embedColor, embedImage, embedThumbnail
    } = req.body;

    const panelName = (name || '').trim().toLowerCase();
    if (!panelName || !/^[a-zA-Z0-9_-]{1,32}$/.test(panelName))
        return res.json({ success: false, message: 'Nama panel tidak valid.' });

    // Validasi warna hex jika diisi
    if (embedColor && !/^#?[0-9A-Fa-f]{6}$/.test(embedColor.trim()))
        return res.json({ success: false, message: 'Format warna tidak valid. Gunakan hex, contoh: #5865F2' });

    // Validasi URL gambar jika diisi
    const urlOk = v => !v || v === '' || /^https?:\/\/.+\..+/.test(v);
    if (!urlOk(embedImage))     return res.json({ success: false, message: 'URL Gambar tidak valid.' });
    if (!urlOk(embedThumbnail)) return res.json({ success: false, message: 'URL Thumbnail tidak valid.' });

    const existing = (() => {
        try { const r = db?.get(`autobtn-${guildId}-${panelName}`); return r ? JSON.parse(r) : null; } catch { return null; }
    })();

    const colorHex = embedColor
        ? (embedColor.startsWith('#') ? embedColor : `#${embedColor}`)
        : (existing?.embedColor || '#5865F2');

    const now   = Date.now();
    const panel = {
        name:             panelName,
        mode:             mode             || existing?.mode             || 'multi',
        embedTitle:       embedTitle       !== undefined ? embedTitle.trim()       : (existing?.embedTitle       || ''),
        embedDescription: embedDescription !== undefined ? embedDescription.trim() : (existing?.embedDescription || ''),
        embedFooter:      embedFooter      !== undefined ? embedFooter.trim()      : (existing?.embedFooter      || ''),
        embedColor:       colorHex,
        embedImage:       embedImage       !== undefined ? embedImage.trim()       : (existing?.embedImage       || ''),
        embedThumbnail:   embedThumbnail   !== undefined ? embedThumbnail.trim()   : (existing?.embedThumbnail   || ''),
        defaultStyle:     existing?.defaultStyle || null,
        buttons:          existing?.buttons      || [],
        messageType: messageType === 'plain' ? 'plain' : (existing?.messageType || 'embed'),
        plainText:   messageType === 'plain' ? (plainText || '').trim() : (existing?.plainText || ''),
        createdAt:        existing?.createdAt    || now,
        updatedAt:        now,
    };
    db.set(`autobtn-${guildId}-${panelName}`, JSON.stringify(panel));

    // Update list — atomic agar aman jika banyak request bersamaan
    if (db) db.modifyList(`autobtn-list-${guildId}`, list => {
        if (!list.includes(panelName)) list.push(panelName);
        return list;
    });

    res.json({ success: true, message: `Panel "${panelName}" berhasil ${existing ? 'diperbarui' : 'dibuat'}.` });
});

// ── POST /api/guild/:guildId/autorole-button/:name — edit panel ───────────
// Menerima field yang sama dengan create: mode + semua embedXxx
// Jika panel sudah terkirim, langsung update embed di Discord.
router.post('/guild/:guildId/autorole-button/:name', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const name    = req.params.name.trim().toLowerCase();
    const {
        mode,
        messageType, plainText,
        embedTitle, embedDescription, embedFooter,
        embedColor, embedImage, embedThumbnail
    } = req.body;

    const raw = db?.get(`autobtn-${guildId}-${name}`);
    if (!raw) return res.json({ success: false, message: 'Panel tidak ditemukan.' });

    let panel;
    try { panel = JSON.parse(raw); } catch { return res.json({ success: false, message: 'Data panel rusak.' }); }

    // Validasi opsional
    if (embedColor && !/^#?[0-9A-Fa-f]{6}$/.test(embedColor.trim()))
        return res.json({ success: false, message: 'Format warna tidak valid. Gunakan hex, contoh: #5865F2' });
    const urlOk = v => !v || v === '' || /^https?:\/\/.+\..+/.test(v);
    if (!urlOk(embedImage))     return res.json({ success: false, message: 'URL Gambar tidak valid.' });
    if (!urlOk(embedThumbnail)) return res.json({ success: false, message: 'URL Thumbnail tidak valid.' });

    if (mode)             panel.mode             = mode;
    if (embedTitle       !== undefined) panel.embedTitle       = embedTitle.trim();
    if (embedDescription !== undefined) panel.embedDescription = embedDescription.trim();
    if (embedFooter      !== undefined) panel.embedFooter      = embedFooter.trim();
    if (embedColor       !== undefined) {
        panel.embedColor = embedColor.startsWith('#') ? embedColor : `#${embedColor}`;
    }
    if (embedImage       !== undefined) panel.embedImage       = embedImage.trim();
    if (embedThumbnail   !== undefined) panel.embedThumbnail   = embedThumbnail.trim();
    if (messageType !== undefined) panel.messageType = messageType === 'plain' ? 'plain' : 'embed';
    if (plainText   !== undefined) panel.plainText   = plainText.trim();
    panel.updatedAt = Date.now();
    db.set(`autobtn-${guildId}-${name}`, JSON.stringify(panel));

    // Jika sudah terkirim, update embed + components di Discord secara langsung
    let liveUpdate = '';
    try {
        const sentRaw = db?.get(`autobtn-sent-${guildId}-${name}`);
        if (sentRaw) {
            const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
            const sent    = JSON.parse(sentRaw);
            const guild   = await client?.guilds.fetch(guildId).catch(() => null);
            const channel = guild ? await guild.channels.fetch(sent.channelId).catch(() => null) : null;
            if (channel) {
                const discordMsg = await channel.messages.fetch(sent.messageId).catch(() => null);
                if (discordMsg) {
                    // Bangun embed dari field panel (sinkron dengan buildPanelEmbed di command)
                    const colorHex = panel.embedColor && /^#?[0-9A-Fa-f]{6}$/.test(panel.embedColor.trim())
                        ? (panel.embedColor.startsWith('#') ? panel.embedColor : `#${panel.embedColor}`)
                        : '#5865F2';
                    const embed = new EmbedBuilder().setColor(colorHex);
                    if (panel.embedTitle)       embed.setTitle(panel.embedTitle.slice(0, 256));
                    if (panel.embedDescription) embed.setDescription(panel.embedDescription.slice(0, 4096));
                    if (panel.embedFooter)      embed.setFooter({ text: panel.embedFooter.slice(0, 2048) });
                    if (panel.embedImage)       embed.setImage(panel.embedImage);
                    if (panel.embedThumbnail)   embed.setThumbnail(panel.embedThumbnail);

                    // Bangun components (sinkron dengan buildButtonRows di command)
                    const rows = [];
                    let rowIdx = 0, colIdx = 0;
                    let currentRow = new ActionRowBuilder();
                    for (const btn of panel.buttons) {
                        if (colIdx === 5) { rows.push(currentRow); currentRow = new ActionRowBuilder(); rowIdx++; colIdx = 0; }
                        if (rowIdx >= 5) break;
                        currentRow.addComponents(
                            new ButtonBuilder()
                                .setCustomId(`autobtn:${panel.mode}:${panel.name}:${btn.roleId}`)
                                .setLabel(btn.label)
                                .setStyle(btn.style || ButtonStyle.Primary)
                        );
                        colIdx++;
                    }
                    if (colIdx > 0) rows.push(currentRow);

                    if (panel.messageType === 'plain') {
                        await discordMsg.edit({ content: (panel.plainText || '').slice(0, 2000), embeds: [], components: panel.buttons.length > 0 ? rows : [] });
                    } else {
                        await discordMsg.edit({ embeds: [embed], content: null, components: panel.buttons.length > 0 ? rows : [] });
                    }
                    liveUpdate = ' Pesan Discord diperbarui secara langsung.';
                }
            }
        }
    } catch (err) { console.error('[autorole-button/edit]', err.message); }

    res.json({ success: true, message: `Panel "${name}" berhasil diperbarui.${liveUpdate}` });
});

// ── DELETE /api/guild/:guildId/autorole-button/:name ──────────────────────
router.delete('/guild/:guildId/autorole-button/:name', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const name    = req.params.name.trim().toLowerCase();

    // Hapus pesan Discord yang sudah terkirim (jika ada)
    const sentRaw = db?.get(`autobtn-sent-${guildId}-${name}`);
    if (sentRaw) {
        try {
            const sent    = JSON.parse(sentRaw);
            const guild   = client?.guilds.cache.get(guildId);
            const channel = guild ? await guild.channels.fetch(sent.channelId).catch(() => null) : null;
            if (channel) {
                const msg = await channel.messages.fetch(sent.messageId).catch(() => null);
                if (msg) await msg.delete().catch(() => null);
            }
        } catch (err) {
            console.error('[autorole-button/delete] gagal hapus pesan Discord:', err.message);
        }
    }

    db?.delete(`autobtn-${guildId}-${name}`);
    db?.delete(`autobtn-sent-${guildId}-${name}`);

    if (db) db.modifyList(`autobtn-list-${guildId}`, list => list.filter(n => n !== name));

    res.json({ success: true, message: `Panel "${name}" berhasil dihapus.` });
});

// ── POST /api/guild/:guildId/autorole-button/:name/buttons — simpan tombol
// customId format sinkron dengan command JS: autobtn:<mode>:<panelName>:<roleId>
// styleKey (string '1'-'4') disimpan bersama style (integer) untuk kebutuhan CSS di web.
router.post('/guild/:guildId/autorole-button/:name/buttons', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const name    = req.params.name.trim().toLowerCase();
    const { buttons } = req.body;

    const raw = db?.get(`autobtn-${guildId}-${name}`);
    if (!raw) return res.json({ success: false, message: 'Panel tidak ditemukan.' });

    let panel;
    try { panel = JSON.parse(raw); } catch { return res.json({ success: false, message: 'Data panel rusak.' }); }

    // Normalisasi: pastikan style adalah integer, tambahkan styleKey string untuk CSS web
    panel.buttons = (buttons || []).map(btn => ({
        roleId:   btn.roleId,
        label:    btn.label,
        style:    parseInt(btn.style) || 1,
        styleKey: String(parseInt(btn.style) || 1),
    }));
    panel.updatedAt = Date.now();
    db.set(`autobtn-${guildId}-${name}`, JSON.stringify(panel));

    // Jika sudah terkirim, update embed + components di Discord
    try {
        const sentRaw = db?.get(`autobtn-sent-${guildId}-${name}`);
        if (sentRaw) {
            const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
            const sent    = JSON.parse(sentRaw);
            const guild   = await client?.guilds.fetch(guildId).catch(() => null);
            const channel = guild ? await guild.channels.fetch(sent.channelId).catch(() => null) : null;
            if (channel) {
                const discordMsg = await channel.messages.fetch(sent.messageId).catch(() => null);
                if (discordMsg) {
                    // Bangun components — customId sinkron: autobtn:<mode>:<panelName>:<roleId>
                    const rows = [];
                    let rowIdx = 0, colIdx = 0;
                    let currentRow = new ActionRowBuilder();
                    for (const btn of panel.buttons) {
                        if (colIdx === 5) { rows.push(currentRow); currentRow = new ActionRowBuilder(); rowIdx++; colIdx = 0; }
                        if (rowIdx >= 5) break;
                        currentRow.addComponents(
                            new ButtonBuilder()
                                .setCustomId(`autobtn:${panel.mode}:${panel.name}:${btn.roleId}`)
                                .setLabel(btn.label)
                                .setStyle(btn.style || ButtonStyle.Primary)
                        );
                        colIdx++;
                    }
                    if (colIdx > 0) rows.push(currentRow);
                    const components = panel.buttons.length > 0 ? rows : [];

                    if (panel.messageType === 'plain') {
                        // Tipe teks biasa: update content saja, hapus embeds
                        await discordMsg.edit({
                            content:    (panel.plainText || '').slice(0, 2000),
                            embeds:     [],
                            components,
                        });
                    } else {
                        // Tipe embed: bangun embed dari field panel
                        const colorHex = panel.embedColor && /^#?[0-9A-Fa-f]{6}$/.test(panel.embedColor.trim())
                            ? (panel.embedColor.startsWith('#') ? panel.embedColor : `#${panel.embedColor}`)
                            : '#5865F2';
                        const embed = new EmbedBuilder().setColor(colorHex);
                        if (panel.embedTitle)       embed.setTitle(panel.embedTitle.slice(0, 256));
                        if (panel.embedDescription) embed.setDescription(panel.embedDescription.slice(0, 4096));
                        if (panel.embedFooter)      embed.setFooter({ text: panel.embedFooter.slice(0, 2048) });
                        if (panel.embedImage)       embed.setImage(panel.embedImage);
                        if (panel.embedThumbnail)   embed.setThumbnail(panel.embedThumbnail);
                        await discordMsg.edit({ embeds: [embed], content: null, components });
                    }
                }
            }
        }
    } catch (err) { console.error('[autorole-button/buttons]', err.message); }

    res.json({ success: true, message: 'Tombol berhasil disimpan.' });
});

// ── POST /api/guild/:guildId/autorole-button/:name/send — kirim panel ─────
// Embed dibaca dari field panel (embedTitle, embedColor, dll) — sinkron
// dengan buildPanelEmbed() di slashcommand-autorole-button.js.
// customId tombol: autobtn:<mode>:<panelName>:<roleId> — sinkron dengan
// buildButtonRows() di command dan button-autorole.js handler.
router.post('/guild/:guildId/autorole-button/:name/send', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const name    = req.params.name.trim().toLowerCase();
    const { channelId } = req.body;

    const raw = db?.get(`autobtn-${guildId}-${name}`);
    if (!raw) return res.json({ success: false, message: 'Panel tidak ditemukan.' });

    let panel;
    try { panel = JSON.parse(raw); } catch { return res.json({ success: false, message: 'Data panel rusak.' }); }

    if (!panel.buttons || panel.buttons.length === 0)
        return res.json({ success: false, message: 'Panel belum punya tombol. Tambahkan tombol dulu.' });

    // Lock pengiriman — cegah duplikat jika dua request datang bersamaan
    const lockKey = `autobtn-sending-lock-${guildId}-${name}`;
    if (!db?.tryLock(lockKey)) {
        return res.json({ success: false, message: 'Panel sedang dalam proses pengiriman, tunggu sebentar.' });
    }

    try {
    // Cek apakah sudah pernah dikirim dan pesannya masih ada
    const existingSentRaw = db?.get(`autobtn-sent-${guildId}-${name}`);
    if (existingSentRaw) {
        try {
            const existingSent = JSON.parse(existingSentRaw);
            const g  = client?.guilds.cache.get(guildId);
            const ch = g ? await g.channels.fetch(existingSent.channelId).catch(() => null) : null;
            if (ch) {
                const m = await ch.messages.fetch(existingSent.messageId).catch(() => null);
                if (m) return res.json({
                    success: false,
                    message: `Panel "${name}" sudah terkirim dan masih aktif. Gunakan Edit Panel untuk memperbarui tampilan.`
                });
            }
            // Pesan sudah dihapus dari Discord — boleh kirim ulang
            db?.delete(`autobtn-sent-${guildId}-${name}`);
        } catch { db?.delete(`autobtn-sent-${guildId}-${name}`); }
    }

    {
        const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');

        const guild   = client?.guilds.cache.get(guildId);
        const channel = await guild?.channels.fetch(channelId).catch(() => null);
        if (!channel) return res.json({ success: false, message: 'Channel tidak ditemukan.' });

        // Bangun embed dari field panel — sinkron dengan buildPanelEmbed() di command
        const colorHex = panel.embedColor && /^#?[0-9A-Fa-f]{6}$/.test(panel.embedColor.trim())
            ? (panel.embedColor.startsWith('#') ? panel.embedColor : `#${panel.embedColor}`)
            : '#5865F2';
        const embed = new EmbedBuilder().setColor(colorHex);
        if (panel.embedTitle)       embed.setTitle(panel.embedTitle.slice(0, 256));
        if (panel.embedDescription) embed.setDescription(panel.embedDescription.slice(0, 4096));
        if (panel.embedFooter)      embed.setFooter({ text: panel.embedFooter.slice(0, 2048) });
        if (panel.embedImage)       embed.setImage(panel.embedImage);
        if (panel.embedThumbnail)   embed.setThumbnail(panel.embedThumbnail);

        // Bangun rows tombol — customId sinkron: autobtn:<mode>:<panelName>:<roleId>
        const rows = [];
        let rowIdx = 0, colIdx = 0;
        let currentRow = new ActionRowBuilder();
        for (const btn of panel.buttons) {
            if (colIdx === 5) { rows.push(currentRow); currentRow = new ActionRowBuilder(); rowIdx++; colIdx = 0; }
            if (rowIdx >= 5) break;
            currentRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`autobtn:${panel.mode || 'multi'}:${name}:${btn.roleId}`)
                    .setLabel(btn.label)
                    .setStyle(btn.style || ButtonStyle.Primary)
            );
            colIdx++;
        }
        if (colIdx > 0) rows.push(currentRow);

        let sent;
        if (panel.messageType === 'plain') {
            if (!panel.plainText) return res.json({ success: false, message: 'Isi pesan teks biasa masih kosong.' });
            sent = await channel.send({ content: panel.plainText.slice(0, 2000), components: rows });
        } else {
            sent = await channel.send({ embeds: [embed], components: rows });
        }
        db?.set(`autobtn-sent-${guildId}-${name}`, JSON.stringify({ messageId: sent.id, channelId: channel.id }));

        res.json({ success: true, message: `Panel berhasil dikirim ke #${channel.name}!` });
    }
    } catch (err) {
        console.error('[autorole-button/send]', err);
        res.json({ success: false, message: 'Gagal mengirim panel. Cek permission bot.' });
    } finally {
        db?.unlock(lockKey);
    }
});

// ════════════════════════════════════════════════════════════════════════════
// AUTOROLE REACTION API
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/guild/:guildId/autorole-reaction/:name ────────────────────────
router.get('/guild/:guildId/autorole-reaction/:name', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const name    = req.params.name.trim().toLowerCase();
    const raw     = db?.get(`autoreact-${guildId}-${name}`);
    if (!raw) return res.json({ success: false, message: 'Panel tidak ditemukan.' });
    try {
        const panel   = JSON.parse(raw);
        const sentRaw = db?.get(`autoreact-sent-${guildId}-${name}`);
        panel.isSent  = !!sentRaw;
        res.json({ success: true, panel });
    } catch {
        res.json({ success: false, message: 'Data panel rusak.' });
    }
});

// ── POST /api/guild/:guildId/autorole-reaction — buat panel baru ───────────
router.post('/guild/:guildId/autorole-reaction', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const {
        name, mode,
        messageType, plainText,
        embedTitle, embedDescription, embedFooter,
        embedColor, embedImage, embedThumbnail
    } = req.body;

    const panelName = (name || '').trim().toLowerCase();
    if (!panelName || !/^[a-zA-Z0-9_-]{1,32}$/.test(panelName))
        return res.json({ success: false, message: 'Nama panel tidak valid.' });

    if (embedColor && !/^#?[0-9A-Fa-f]{6}$/.test(embedColor.trim()))
        return res.json({ success: false, message: 'Format warna tidak valid. Gunakan hex, contoh: #5865F2' });

    const urlOk = v => !v || v === '' || /^https?:\/\/.+\..+/.test(v);
    if (!urlOk(embedImage))     return res.json({ success: false, message: 'URL Gambar tidak valid.' });
    if (!urlOk(embedThumbnail)) return res.json({ success: false, message: 'URL Thumbnail tidak valid.' });

    const existing = (() => {
        try { const r = db?.get(`autoreact-${guildId}-${panelName}`); return r ? JSON.parse(r) : null; } catch { return null; }
    })();

    const colorHex = embedColor
        ? (embedColor.startsWith('#') ? embedColor : `#${embedColor}`)
        : (existing?.embedColor || '#5865F2');

    const now   = Date.now();
    const panel = {
        name:             panelName,
        mode:             mode             || existing?.mode             || 'multi',
        embedTitle:       embedTitle       !== undefined ? embedTitle.trim()       : (existing?.embedTitle       || ''),
        embedDescription: embedDescription !== undefined ? embedDescription.trim() : (existing?.embedDescription || ''),
        embedFooter:      embedFooter      !== undefined ? embedFooter.trim()      : (existing?.embedFooter      || ''),
        embedColor:       colorHex,
        embedImage:       embedImage       !== undefined ? embedImage.trim()       : (existing?.embedImage       || ''),
        embedThumbnail:   embedThumbnail   !== undefined ? embedThumbnail.trim()   : (existing?.embedThumbnail   || ''),
        reactions:        existing?.reactions || [],
        messageType: messageType === 'plain' ? 'plain' : (existing?.messageType || 'embed'),
        plainText:   messageType === 'plain' ? (plainText || '').trim() : (existing?.plainText || ''),
        createdAt:        existing?.createdAt || now,
        updatedAt:        now,
    };
    db.set(`autoreact-${guildId}-${panelName}`, JSON.stringify(panel));

    if (db) db.modifyList(`autoreact-list-${guildId}`, list => {
        if (!list.includes(panelName)) list.push(panelName);
        return list;
    });

    res.json({ success: true, message: `Panel "${panelName}" berhasil ${existing ? 'diperbarui' : 'dibuat'}.` });
});

// ── POST /api/guild/:guildId/autorole-reaction/:name — edit panel ──────────
router.post('/guild/:guildId/autorole-reaction/:name', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const name    = req.params.name.trim().toLowerCase();
    const {
        mode,
        messageType, plainText,
        embedTitle, embedDescription, embedFooter,
        embedColor, embedImage, embedThumbnail
    } = req.body;

    const raw = db?.get(`autoreact-${guildId}-${name}`);
    if (!raw) return res.json({ success: false, message: 'Panel tidak ditemukan.' });

    let panel;
    try { panel = JSON.parse(raw); } catch { return res.json({ success: false, message: 'Data panel rusak.' }); }

    if (embedColor && !/^#?[0-9A-Fa-f]{6}$/.test(embedColor.trim()))
        return res.json({ success: false, message: 'Format warna tidak valid.' });
    const urlOk = v => !v || v === '' || /^https?:\/\/.+\..+/.test(v);
    if (!urlOk(embedImage))     return res.json({ success: false, message: 'URL Gambar tidak valid.' });
    if (!urlOk(embedThumbnail)) return res.json({ success: false, message: 'URL Thumbnail tidak valid.' });

    if (mode)             panel.mode             = mode;
    if (embedTitle       !== undefined) panel.embedTitle       = embedTitle.trim();
    if (embedDescription !== undefined) panel.embedDescription = embedDescription.trim();
    if (embedFooter      !== undefined) panel.embedFooter      = embedFooter.trim();
    if (embedColor       !== undefined) panel.embedColor       = embedColor.startsWith('#') ? embedColor : `#${embedColor}`;
    if (embedImage       !== undefined) panel.embedImage       = embedImage.trim();
    if (embedThumbnail   !== undefined) panel.embedThumbnail   = embedThumbnail.trim();
    if (messageType !== undefined) panel.messageType = messageType === 'plain' ? 'plain' : 'embed';
    if (plainText   !== undefined) panel.plainText   = plainText.trim();
    panel.updatedAt = Date.now();
    db.set(`autoreact-${guildId}-${name}`, JSON.stringify(panel));

    let liveUpdate = '';
    try {
        const sentRaw = db?.get(`autoreact-sent-${guildId}-${name}`);
        if (sentRaw) {
            const { EmbedBuilder } = require('discord.js');
            const sent    = JSON.parse(sentRaw);
            const guild   = await client?.guilds.fetch(guildId).catch(() => null);
            const channel = guild ? await guild.channels.fetch(sent.channelId).catch(() => null) : null;
            if (channel) {
                const discordMsg = await channel.messages.fetch(sent.messageId).catch(() => null);
                if (discordMsg) {
                    const colorHex = panel.embedColor && /^#?[0-9A-Fa-f]{6}$/.test(panel.embedColor.trim())
                        ? (panel.embedColor.startsWith('#') ? panel.embedColor : `#${panel.embedColor}`)
                        : '#5865F2';
                    const embed = new EmbedBuilder().setColor(colorHex);
                    if (panel.embedTitle)       embed.setTitle(panel.embedTitle.slice(0, 256));
                    if (panel.embedDescription) embed.setDescription(panel.embedDescription.slice(0, 4096));
                    if (panel.embedFooter)      embed.setFooter({ text: panel.embedFooter.slice(0, 2048) });
                    if (panel.embedImage)       embed.setImage(panel.embedImage);
                    if (panel.embedThumbnail)   embed.setThumbnail(panel.embedThumbnail);

                    if (panel.messageType === 'plain') {
                        await discordMsg.edit({ content: (panel.plainText || '').slice(0, 2000), embeds: [] });
                    } else {
                        await discordMsg.edit({ embeds: [embed], content: null });
                    }
                    liveUpdate = ' Pesan Discord diperbarui secara langsung.';
                }
            }
        }
    } catch (err) { console.error('[autorole-reaction/edit]', err.message); }

    res.json({ success: true, message: `Panel "${name}" berhasil diperbarui.${liveUpdate}` });
});

// ── DELETE /api/guild/:guildId/autorole-reaction/:name ─────────────────────
router.delete('/guild/:guildId/autorole-reaction/:name', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const name    = req.params.name.trim().toLowerCase();

    const sentRaw = db?.get(`autoreact-sent-${guildId}-${name}`);
    if (sentRaw) {
        try {
            const sent    = JSON.parse(sentRaw);
            const guild   = client?.guilds.cache.get(guildId);
            const channel = guild ? await guild.channels.fetch(sent.channelId).catch(() => null) : null;
            if (channel) {
                const msg = await channel.messages.fetch(sent.messageId).catch(() => null);
                if (msg) await msg.delete().catch(() => null);
            }
            db?.delete(`autoreact-msgmap-${guildId}-${sent.messageId}`);
        } catch (err) {
            console.error('[autorole-reaction/delete]', err.message);
        }
    }

    db?.delete(`autoreact-${guildId}-${name}`);
    db?.delete(`autoreact-sent-${guildId}-${name}`);
    if (db) db.modifyList(`autoreact-list-${guildId}`, list => list.filter(n => n !== name));

    res.json({ success: true, message: `Panel "${name}" berhasil dihapus.` });
});

// ── POST /api/guild/:guildId/autorole-reaction/:name/reactions — simpan reactions
router.post('/guild/:guildId/autorole-reaction/:name/reactions', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const name    = req.params.name.trim().toLowerCase();
    const { reactions } = req.body;

    const raw = db?.get(`autoreact-${guildId}-${name}`);
    if (!raw) return res.json({ success: false, message: 'Panel tidak ditemukan.' });

    let panel;
    try { panel = JSON.parse(raw); } catch { return res.json({ success: false, message: 'Data panel rusak.' }); }

    panel.reactions = (reactions || []).map(r => ({
        emoji:  (r.emoji || '').trim(),
        roleId: r.roleId,
    }));
    panel.updatedAt = Date.now();
    db.set(`autoreact-${guildId}-${name}`, JSON.stringify(panel));

    // Jika sudah terkirim, sinkronkan reactions di pesan Discord
    try {
        const sentRaw = db?.get(`autoreact-sent-${guildId}-${name}`);
        if (sentRaw) {
            const sent    = JSON.parse(sentRaw);
            const guild   = await client?.guilds.fetch(guildId).catch(() => null);
            const channel = guild ? await guild.channels.fetch(sent.channelId).catch(() => null) : null;
            if (channel) {
                const discordMsg = await channel.messages.fetch(sent.messageId).catch(() => null);
                if (discordMsg) {
                    // Hapus semua reaction bot, lalu tambahkan ulang sesuai daftar baru
                    await discordMsg.reactions.removeAll().catch(() => null);
                    for (const react of panel.reactions) {
                        try {
                            const customMatch = react.emoji.match(/^([a-zA-Z0-9_]+):(\d+)$/);
                            await discordMsg.react(customMatch ? customMatch[2] : react.emoji);
                        } catch { /* emoji tidak valid, lewati */ }
                    }
                }
            }
        }
    } catch (err) { console.error('[autorole-reaction/reactions]', err.message); }

    res.json({ success: true, message: 'Reactions berhasil disimpan.' });
});

// ── POST /api/guild/:guildId/autorole-reaction/:name/send — kirim panel ────
router.post('/guild/:guildId/autorole-reaction/:name/send', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const name    = req.params.name.trim().toLowerCase();
    const { channelId } = req.body;

    const raw = db?.get(`autoreact-${guildId}-${name}`);
    if (!raw) return res.json({ success: false, message: 'Panel tidak ditemukan.' });

    let panel;
    try { panel = JSON.parse(raw); } catch { return res.json({ success: false, message: 'Data panel rusak.' }); }

    if (!panel.reactions || panel.reactions.length === 0)
        return res.json({ success: false, message: 'Panel belum punya reaction. Tambahkan dulu.' });

    const lockKey = `autoreact-sending-lock-${guildId}-${name}`;
    if (!db?.tryLock(lockKey)) {
        return res.json({ success: false, message: 'Panel sedang dalam proses pengiriman, tunggu sebentar.' });
    }

    try {
        const existingSentRaw = db?.get(`autoreact-sent-${guildId}-${name}`);
        if (existingSentRaw) {
            try {
                const existingSent = JSON.parse(existingSentRaw);
                const g  = client?.guilds.cache.get(guildId);
                const ch = g ? await g.channels.fetch(existingSent.channelId).catch(() => null) : null;
                if (ch) {
                    const m = await ch.messages.fetch(existingSent.messageId).catch(() => null);
                    if (m) return res.json({
                        success: false,
                        message: `Panel "${name}" sudah terkirim dan masih aktif.`
                    });
                }
                db?.delete(`autoreact-sent-${guildId}-${name}`);
                db?.delete(`autoreact-msgmap-${guildId}-${existingSent.messageId}`);
            } catch {
                db?.delete(`autoreact-sent-${guildId}-${name}`);
            }
        }

        const { EmbedBuilder } = require('discord.js');
        const guild   = client?.guilds.cache.get(guildId);
        const channel = await guild?.channels.fetch(channelId).catch(() => null);
        if (!channel) return res.json({ success: false, message: 'Channel tidak ditemukan.' });

        const colorHex = panel.embedColor && /^#?[0-9A-Fa-f]{6}$/.test(panel.embedColor.trim())
            ? (panel.embedColor.startsWith('#') ? panel.embedColor : `#${panel.embedColor}`)
            : '#5865F2';
        const embed = new EmbedBuilder().setColor(colorHex);
        if (panel.embedTitle)       embed.setTitle(panel.embedTitle.slice(0, 256));
        if (panel.embedDescription) embed.setDescription(panel.embedDescription.slice(0, 4096));
        if (panel.embedFooter)      embed.setFooter({ text: panel.embedFooter.slice(0, 2048) });
        if (panel.embedImage)       embed.setImage(panel.embedImage);
        if (panel.embedThumbnail)   embed.setThumbnail(panel.embedThumbnail);

        let sent;
        if (panel.messageType === 'plain') {
            if (!panel.plainText) return res.json({ success: false, message: 'Isi pesan teks biasa masih kosong.' });
            sent = await channel.send({ content: panel.plainText.slice(0, 2000) });
        } else {
            sent = await channel.send({ embeds: [embed] });
        }

        db?.set(`autoreact-sent-${guildId}-${name}`, JSON.stringify({ messageId: sent.id, channelId: channel.id }));
        db?.set(`autoreact-msgmap-${guildId}-${sent.id}`, name);

        // Tambahkan reactions ke pesan
        for (const react of panel.reactions) {
            try {
                const customMatch = react.emoji.match(/^([a-zA-Z0-9_]+):(\d+)$/);
                await sent.react(customMatch ? customMatch[2] : react.emoji);
            } catch { /* emoji tidak valid, lewati */ }
        }

        res.json({ success: true, message: `Panel berhasil dikirim ke #${channel.name}!` });
    } catch (err) {
        console.error('[autorole-reaction/send]', err);
        res.json({ success: false, message: 'Gagal mengirim panel. Cek permission bot.' });
    } finally {
        db?.unlock(lockKey);
    }
});

// ── POST /api/guild/:guildId/prefix ───────────────────────────────────────────
router.post('/guild/:guildId/prefix', requireLogin, requireManageGuild, (req, res) => {
    const { prefix } = req.body;
    const db         = req.discordClient?.database;
    const guildId    = req.params.guildId;

    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    if (!prefix || prefix.length > 5) {
        return res.status(400).json({ success: false, message: 'Prefix tidak valid (maks 5 karakter).' });
    }

    db.set(`prefix_${guildId}`, prefix.trim());
    res.json({ success: true, message: `Prefix berhasil diubah ke "${prefix.trim()}".` });
});


// ── POST /api/guild/:guildId/nickname ────────────────────────────────────────
router.post('/guild/:guildId/nickname', requireLogin, requireManageGuild, async (req, res) => {
    const { nickname } = req.body;
    const guild = req.botGuild;

    if (nickname && nickname.length > 32) {
        return res.status(400).json({ success: false, message: 'Nickname terlalu panjang (maks 32 karakter).' });
    }

    try {
        await guild.members.me.setNickname(nickname || null);
        const msg = nickname
            ? `Nickname berhasil diubah ke "${nickname}".`
            : 'Nickname berhasil direset ke nama asli.';
        res.json({ success: true, message: msg });
    } catch (e) {
        console.error('[nickname set]', e);
        res.json({ success: false, message: 'Gagal mengubah nickname. Pastikan bot punya izin Manage Nicknames.' });
    }
});

// ── GET /api/guild/:guildId/members/search?q= ─────────────────────────────
// Cari member berdasarkan ID atau username, dipakai oleh preview mention web.
router.get('/guild/:guildId/members/search', requireLogin, requireManageGuild, async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json({ success: true, members: [] });

    const guild = req.botGuild;

    // Jika query berupa ID murni, fetch langsung (paling akurat)
    if (/^\d+$/.test(q.trim())) {
        try {
            const member = await guild.members.fetch(q.trim());
            return res.json({
                success: true,
                members: [{
                    id:      member.id,
                    display: member.displayName,
                    avatar:  member.user.displayAvatarURL({ size: 32, extension: 'webp' })
                }]
            });
        } catch {
            return res.json({ success: true, members: [] });
        }
    }

    // Jika query berupa nama, search via Discord API
    try {
        const fetched = await guild.members.search({ query: q.trim(), limit: 10 });
        const members = fetched.map(m => ({
            id:      m.id,
            display: m.displayName,
            avatar:  m.user.displayAvatarURL({ size: 32, extension: 'webp' })
        }));
        return res.json({ success: true, members });
    } catch {
        return res.json({ success: true, members: [] });
    }
});

// ── GET /api/guild/:guildId/roles/:roleId ─────────────────────────────────
// Lookup satu role berdasarkan ID, dipakai oleh preview mention web.
router.get('/guild/:guildId/roles/:roleId', requireLogin, requireManageGuild, (req, res) => {
    const { roleId } = req.params;
    const guild = req.botGuild;

    const role = guild.roles.cache.get(roleId);
    if (!role) {
        return res.json({ success: false, message: 'Role tidak ditemukan.' });
    }

    const color = role.hexColor === '#000000' ? '#99aab5' : role.hexColor;
    return res.json({
        success: true,
        role: {
            id:    role.id,
            name:  role.name,
            color: color
        }
    });
});

// ── GET /api/guild/:guildId/channels/:channelId ───────────────────────────
// Lookup satu channel berdasarkan ID, dipakai oleh preview mention web.
// Mendukung semua tipe channel (teks, announcement, forum, thread, dll.)
router.get('/guild/:guildId/channels/:channelId', requireLogin, requireManageGuild, async (req, res) => {
    const { channelId, guildId } = req.params;
    const client = req.discordClient;

    try {
        // Pakai client.channels.fetch agar semua tipe channel bisa di-resolve,
        // tidak hanya yang sudah ada di guild.channels.cache
        const channel = await client.channels.fetch(channelId);

        // Pastikan channel ini milik guild yang diminta (keamanan)
        if (!channel || channel.guildId !== guildId) {
            return res.json({ success: false, message: 'Channel tidak ditemukan.' });
        }

        return res.json({
            success: true,
            channel: {
                id:   channel.id,
                name: channel.name
            }
        });
    } catch {
        return res.json({ success: false, message: 'Channel tidak ditemukan.' });
    }
});


// ── Message Builder API ───────────────────────────────────────────────────────

function mbGetList(db, guildId) {
    const raw = db?.get(`pesan-list-${guildId}`);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
}
function mbSaveList(db, guildId, list) {
    db?.set(`pesan-list-${guildId}`, JSON.stringify(list));
}
function mbGetTemplate(db, guildId, name) {
    const raw = db?.get(`pesan-${guildId}-${name}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}
function mbSaveTemplate(db, guildId, name, data) {
    if (!db) return;
    db.transaction(() => {
        db.set(`pesan-${guildId}-${name}`, JSON.stringify(data));
        db.modifyList(`pesan-list-${guildId}`, list => {
            if (!list.includes(name)) list.push(name);
            return list;
        });
    });
}
function mbDeleteTemplate(db, guildId, name) {
    if (!db) return;
    db.transaction(() => {
        db.delete(`pesan-${guildId}-${name}`);
        db.modifyList(`pesan-list-${guildId}`, list => list.filter(n => n !== name));
    });
}

// GET /api/guild/:guildId/message-builder/:name — ambil satu template
router.get('/guild/:guildId/message-builder/:name', requireLogin, requireManageGuild, (req, res) => {
    const db       = req.discordClient?.database;
    const { guildId } = req.params;
    const name = req.params.name.trim().toLowerCase();
    const template = mbGetTemplate(db, guildId, name);
    if (!template) return res.json({ success: false, message: 'Template tidak ditemukan.' });
    res.json({ success: true, template });
});

// POST /api/guild/:guildId/message-builder — simpan (buat/edit) template
router.post('/guild/:guildId/message-builder', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const { kategori, title, description, footer, authorName, authorIcon, image, thumbnail, color,
            messageType, plainText } = req.body;
    const name    = (req.body.name || '').trim().toLowerCase();

    if (!name || !/^[a-zA-Z0-9_-]{1,32}$/.test(name)) {
        return res.json({ success: false, message: 'Nama template tidak valid.' });
    }

    const existing  = mbGetTemplate(db, guildId, name);
    const now       = Date.now();
    const validType = messageType === 'plain' ? 'plain' : 'embed';
    const data      = {
        kategori:    kategori    || 'biasa',
        messageType: validType,
        plainText:   validType === 'plain' ? (plainText || '').trim() : (existing?.plainText || ''),
        title:       title       || '',
        description: description || '',
        footer:      footer      || '',
        authorName:  authorName  || '',
        authorIcon:  authorIcon  || '',
        image:       image       || '',
        thumbnail:   thumbnail   || '',
        color:       color       || '#5865F2',
        createdAt:   existing?.createdAt || now,
        updatedAt:   now,
    };
    mbSaveTemplate(db, guildId, name, data);

    // Jika kategori unik dan sudah pernah dikirim, edit pesan Discord-nya
    const isUnik = data.kategori === 'unik' || existing?.kategori === 'unik';
    if (isUnik) {
        const sentRaw = db?.get(`pesan-unik-sent-${guildId}-${name}`);
        if (sentRaw) {
            let sent;
            try { sent = JSON.parse(sentRaw); } catch {
                return res.json({ success: true, message: `Template disimpan, tapi data pesan unik rusak.` });
            }

            try {
                const guild = client?.guilds.cache.get(guildId);
                if (!guild) throw new Error('Guild tidak ada di cache bot.');

                const channel = await guild.channels.fetch(sent.channelId);
                if (!channel) throw new Error('Channel tidak ditemukan.');
                const msg = await channel.messages.fetch(sent.messageId);
                if (!msg) throw new Error('Pesan tidak ditemukan.');

                if (validType === 'plain') {
                    await msg.edit({ content: (data.plainText || '').slice(0, 2000), embeds: [] });
                } else {
                    const { EmbedBuilder } = require('discord.js');
                    const embed = new EmbedBuilder();
                    const colorHex = data.color && /^#?[0-9A-Fa-f]{6}$/.test(data.color.trim())
                        ? (data.color.startsWith('#') ? data.color : `#${data.color}`) : '#5865F2';
                    embed.setColor(colorHex);
                    if (data.title)       embed.setTitle(data.title.slice(0, 256));
                    if (data.description) embed.setDescription(data.description.slice(0, 4096));
                    if (data.footer)      embed.setFooter({ text: data.footer.slice(0, 2048) });
                    if (data.image)       embed.setImage(data.image);
                    if (data.thumbnail)   embed.setThumbnail(data.thumbnail);
                    if (data.authorName)  embed.setAuthor({ name: data.authorName.slice(0, 256), iconURL: data.authorIcon || undefined });
                    await msg.edit({ embeds: [embed], content: null });
                }
                return res.json({ success: true, message: `Template "${name}" disimpan dan pesan Discord berhasil diperbarui! ✅` });

            } catch (err) {
                if (err.code === 10008) {
                    db?.delete(`pesan-unik-sent-${guildId}-${name}`);
                    return res.json({ success: true, message: `Template disimpan, tapi pesan Discord sudah dihapus. Kirim ulang via tombol Kirim.` });
                }
                console.error('[message-builder/edit-unik]', err.message);
                return res.json({ success: true, message: `Template disimpan, tapi gagal edit pesan Discord: ${err.message}` });
            }
        }
    }

    res.json({ success: true, message: `Template "${name}" berhasil disimpan.` });
});

// DELETE /api/guild/:guildId/message-builder/:name — hapus template
router.delete('/guild/:guildId/message-builder/:name', requireLogin, requireManageGuild, async (req, res) => {
    const db       = req.discordClient?.database;
    const client   = req.discordClient;
    const { guildId } = req.params;
    const name = req.params.name.trim().toLowerCase();
    if (!mbGetTemplate(db, guildId, name)) return res.json({ success: false, message: 'Template tidak ditemukan.' });

    // Cari semua panel autorole-button yang pakai template ini, lalu hapus pesan Discord-nya
    try {
        const panelListRaw = db?.get(`autobtn-list-${guildId}`);
        const panelNames   = panelListRaw ? JSON.parse(panelListRaw) : [];
        const guild        = client?.guilds.cache.get(guildId);

        for (const panelName of panelNames) {
            const panelRaw = db?.get(`autobtn-${guildId}-${panelName}`);
            if (!panelRaw) continue;
            const panel = JSON.parse(panelRaw);

            // Cek apakah panel ini pakai template yang dihapus
            if ((panel.templateName || panelName) !== name) continue;

            // Cek apakah panel sudah pernah dikirim
            const sentRaw = db?.get(`autobtn-sent-${guildId}-${panelName}`);
            if (!sentRaw) continue;

            const sent = JSON.parse(sentRaw);
            try {
                const channel = await guild?.channels.fetch(sent.channelId).catch(() => null);
                if (channel) {
                    const msg = await channel.messages.fetch(sent.messageId).catch(() => null);
                    if (msg) await msg.delete().catch(() => null);
                }
            } catch { /* pesan sudah dihapus manual, lanjut */ }

            // Hapus data sent dari DB
            db?.delete(`autobtn-sent-${guildId}-${panelName}`);
        }
    } catch (err) {
        console.error('[message-builder/delete] gagal hapus pesan panel:', err.message);
    }

    mbDeleteTemplate(db, guildId, name);
    // Hapus data sent-unik jika ada
    db?.delete(`pesan-unik-sent-${guildId}-${name}`);
    res.json({ success: true, message: `Template "${name}" berhasil dihapus.` });
});

// POST /api/guild/:guildId/message-builder/:name/send — kirim ke channel
router.post('/guild/:guildId/message-builder/:name/send', requireLogin, requireManageGuild, async (req, res) => {
    const db       = req.discordClient?.database;
    const client   = req.discordClient;
    const { guildId } = req.params;
    const name = req.params.name.trim().toLowerCase(); // tambahkan ini
    const { channelId }     = req.body;

    const template = mbGetTemplate(db, guildId, name);
    if (!template) return res.json({ success: false, message: 'Template tidak ditemukan.' });

    const isPlain = template.messageType === 'plain';
    if (isPlain) {
        if (!template.plainText?.trim()) return res.json({ success: false, message: 'Template teks biasa masih kosong.' });
    } else {
        if (!template.title && !template.description) return res.json({ success: false, message: 'Template masih kosong.' });
    }

    const guild   = client?.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);
    if (!channel) return res.json({ success: false, message: 'Channel tidak ditemukan.' });

    // Cek jika unik dan sudah pernah dikirim
    if (template.kategori === 'unik') {
        const raw  = db?.get(`pesan-unik-sent-${guildId}-${name}`);
        const sent = raw ? JSON.parse(raw) : null;
        if (sent) {
            try {
                const ch = guild.channels.cache.get(sent.channelId);
                if (ch) await ch.messages.fetch(sent.messageId);
                return res.json({ success: false, message: `Template unik "${name}" sudah terkirim. Gunakan /pesan edit untuk memperbarui.` });
            } catch { db?.delete(`pesan-unik-sent-${guildId}-${name}`); }
        }
    }

    try {
        let sent;
        if (isPlain) {
            sent = await channel.send({ content: template.plainText.slice(0, 2000) });
        } else {
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder();
            const colorHex = template.color && /^#?[0-9A-Fa-f]{6}$/.test(template.color.trim())
                ? (template.color.startsWith('#') ? template.color : `#${template.color}`) : '#5865F2';
            embed.setColor(colorHex);
            if (template.title)       embed.setTitle(template.title.slice(0, 256));
            if (template.description) embed.setDescription(template.description.slice(0, 4096));
            if (template.footer)      embed.setFooter({ text: template.footer.slice(0, 2048) });
            if (template.image)       embed.setImage(template.image);
            if (template.thumbnail)   embed.setThumbnail(template.thumbnail);
            if (template.authorName)  embed.setAuthor({ name: template.authorName.slice(0, 256), iconURL: template.authorIcon || undefined });
            sent = await channel.send({ embeds: [embed] });
        }

        if (template.kategori === 'unik') {
            db?.set(`pesan-unik-sent-${guildId}-${name}`, JSON.stringify({ messageId: sent.id, channelId: channel.id }));
        }

        res.json({ success: true, message: `Berhasil dikirim ke #${channel.name}!` });
    } catch (err) {
        console.error('[message-builder/send]', err);
        res.json({ success: false, message: 'Gagal mengirim pesan. Cek permission bot.' });
    }
});

// ── GET /api/guild/:guildId/invites — ambil semua invite (live dari Discord) ─
router.get('/guild/:guildId/invites', requireLogin, requireManageGuild, async (req, res) => {
    try {
        const guild = req.botGuild;
        const raw   = await guild.invites.fetch();
        const invites = [...raw.values()]
            .sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0))
            .map(inv => ({
                code:        inv.code,
                url:         `https://discord.gg/${inv.code}`,
                inviterId:   inv.inviter?.id   ?? null,
                inviterTag:  inv.inviter?.username ?? 'Tidak diketahui',
                channelId:   inv.channel?.id   ?? null,
                channelName: inv.channel?.name ?? '-',
                uses:        inv.uses    ?? 0,
                maxUses:     inv.maxUses ?? 0,
                expiresAt:   inv.expiresTimestamp ?? null,
                temporary:   inv.temporary ?? false,
                createdAt:   inv.createdTimestamp ?? null,
            }));

        const totalUses      = invites.reduce((s, inv) => s + inv.uses, 0);
        const uniqueInviters = new Set(invites.map(inv => inv.inviterId).filter(Boolean)).size;
        res.json({ success: true, invites, totalUses, uniqueInviters });
    } catch {
        res.json({ success: false, message: 'Gagal mengambil invite. Pastikan bot punya izin Manage Guild.' });
    }
});

// ── POST /api/guild/:guildId/serverstats — simpan status + label ─────────────
router.post('/guild/:guildId/serverstats', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const { enabled, totalLabel, humanLabel, botLabel, categoryLabel } = req.body;
    const { getServerStatsConfig, updateStats } = require('../../utils/serverStatsHelper');
    const cfg = getServerStatsConfig({ database: db }, guildId);

    if (enabled !== undefined) {
        if (enabled && (!cfg.categoryId || !cfg.totalId || !cfg.humanId || !cfg.botId)) {
            return res.json({ success: false, message: 'Server Stats belum disetup. Klik tombol Setup terlebih dahulu.' });
        }
        db.set(`serverstats-enabled-${guildId}`, enabled ? 'true' : 'false');
    }

    if (totalLabel !== undefined && totalLabel) {
        if (!totalLabel.includes('{count}'))
            return res.json({ success: false, message: 'Format Total Member harus mengandung {count}.' });
        db.set(`serverstats-total-label-${guildId}`, totalLabel.trim().slice(0, 90));
    }
    if (humanLabel !== undefined && humanLabel) {
        if (!humanLabel.includes('{count}'))
            return res.json({ success: false, message: 'Format User harus mengandung {count}.' });
        db.set(`serverstats-human-label-${guildId}`, humanLabel.trim().slice(0, 90));
    }
    if (botLabel !== undefined && botLabel) {
        if (!botLabel.includes('{count}'))
            return res.json({ success: false, message: 'Format Bot harus mengandung {count}.' });
        db.set(`serverstats-bot-label-${guildId}`, botLabel.trim().slice(0, 90));
    }
    if (categoryLabel !== undefined && categoryLabel) {
        db.set(`serverstats-category-label-${guildId}`, categoryLabel.trim().slice(0, 90));
        // Rename category channel if it exists
        const updatedCfg = getServerStatsConfig({ database: db }, guildId);
        if (updatedCfg.categoryId) {
            const guild   = req.botGuild;
            const catCh   = guild.channels.cache.get(updatedCfg.categoryId)
                ?? await guild.channels.fetch(updatedCfg.categoryId).catch(() => null);
            if (catCh) await catCh.setName(categoryLabel.trim().slice(0, 90)).catch(() => null);
        }
    }

    const currentEnabled = db.get(`serverstats-enabled-${guildId}`);
    if (currentEnabled === 'true') {
        await updateStats(client, req.botGuild).catch(() => null);
    }

    res.json({ success: true, message: 'Pengaturan Server Stats berhasil disimpan.' });
});

// ── POST /api/guild/:guildId/serverstats/setup — buat channel statistik ───────
router.post('/guild/:guildId/serverstats/setup', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const guild   = req.botGuild;
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const { getServerStatsConfig, parseLabel } = require('../../utils/serverStatsHelper');
    const cfg = getServerStatsConfig({ database: db }, guildId);

    if (cfg.categoryId && cfg.totalId && cfg.humanId && cfg.botId) {
        return res.json({ success: false, message: 'Server Stats sudah disetup. Gunakan Reset terlebih dahulu untuk memulai ulang.' });
    }

    const { ChannelType, PermissionFlagsBits } = require('discord.js');
    const categoryName = ((req.body.categoryName || '').trim() || '📊 Server Stats').slice(0, 90);

    let category = cfg.categoryId ? await guild.channels.fetch(cfg.categoryId).catch(() => null) : null;
    if (!category) {
        category = await guild.channels.create({
            name: categoryName,
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
                { id: guild.id,       deny:  [PermissionFlagsBits.Connect] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect, PermissionFlagsBits.MoveMembers] }
            ]
        }).catch(() => null);
        if (category) await category.setPosition(0).catch(() => null);
    }
    if (!category) return res.json({ success: false, message: 'Gagal membuat kategori. Pastikan bot punya izin Manage Channels.' });

    await guild.members.fetch().catch(() => null);
    const allMembers = guild.members.cache;
    const totalCount = allMembers.size;
    const botCount   = allMembers.filter(m => m.user.bot).size;
    const humanCount = totalCount - botCount;

    async function createVC(name) {
        return guild.channels.create({
            name,
            type: ChannelType.GuildVoice,
            parent: category.id,
            permissionOverwrites: [
                { id: guild.id,       deny:  [PermissionFlagsBits.Connect] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect, PermissionFlagsBits.MoveMembers] }
            ]
        }).catch(() => null);
    }

    const totalCh = await createVC(parseLabel(cfg.totalLabel, totalCount));
    const humanCh = await createVC(parseLabel(cfg.humanLabel, humanCount));
    const botCh   = await createVC(parseLabel(cfg.botLabel,   botCount));

    if (!totalCh || !humanCh || !botCh) {
        return res.json({ success: false, message: 'Gagal membuat satu atau lebih channel statistik. Cek permission bot.' });
    }

    db.set(`serverstats-category-${guildId}`,       category.id);
    db.set(`serverstats-total-channel-${guildId}`,  totalCh.id);
    db.set(`serverstats-human-channel-${guildId}`,  humanCh.id);
    db.set(`serverstats-bot-channel-${guildId}`,    botCh.id);
    db.set(`serverstats-category-label-${guildId}`, categoryName);
    db.set(`serverstats-enabled-${guildId}`,        'true');

    res.json({
        success: true,
        message: `Server Stats berhasil disetup! Kategori: ${category.name} · Total: ${totalCh.name} · User: ${humanCh.name} · Bot: ${botCh.name}`
    });
});

// ── POST /api/guild/:guildId/serverstats/reset — hapus semua config + channel ─
router.post('/guild/:guildId/serverstats/reset', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const guild   = req.botGuild;
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const { getServerStatsConfig } = require('../../utils/serverStatsHelper');
    const cfg = getServerStatsConfig({ database: db }, guildId);

    // Delete voice channels first, then category
    const voiceIds = [cfg.totalId, cfg.humanId, cfg.botId].filter(Boolean);
    for (const id of voiceIds) {
        const ch = guild.channels.cache.get(id) ?? await guild.channels.fetch(id).catch(() => null);
        if (ch) await ch.delete('Server Stats reset via dashboard').catch(() => null);
    }
    if (cfg.categoryId) {
        const cat = guild.channels.cache.get(cfg.categoryId) ?? await guild.channels.fetch(cfg.categoryId).catch(() => null);
        if (cat) await cat.delete('Server Stats reset via dashboard').catch(() => null);
    }

    const keys = [
        `serverstats-category-${guildId}`,
        `serverstats-total-channel-${guildId}`,
        `serverstats-human-channel-${guildId}`,
        `serverstats-bot-channel-${guildId}`,
        `serverstats-enabled-${guildId}`,
        `serverstats-total-label-${guildId}`,
        `serverstats-human-label-${guildId}`,
        `serverstats-bot-label-${guildId}`,
        `serverstats-category-label-${guildId}`,
    ];
    for (const key of keys) db.delete(key);

    res.json({ success: true, message: 'Server Stats berhasil direset. Semua channel statistik telah dihapus.' });
});

// ── GET /api/guild/:guildId/image-proxy — proxy gambar eksternal agar canvas ─
// bisa menggambar tanpa terkena blokir CORS browser.
router.get('/guild/:guildId/image-proxy', requireLogin, requireManageGuild, (req, res) => {
    const { url } = req.query;
    if (!url || !/^https?:\/\/.+/.test(url)) return res.status(400).json({ success: false, message: 'URL tidak valid.' });

    const mod = url.startsWith('https') ? require('https') : require('http');
    const request = mod.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (upstream) => {
        if (upstream.statusCode !== 200) {
            return res.status(upstream.statusCode || 500).json({ success: false, message: `HTTP ${upstream.statusCode}` });
        }
        const ct = upstream.headers['content-type'] || 'image/png';
        res.setHeader('Content-Type', ct);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        upstream.pipe(res);
    });
    request.on('error', () => res.status(500).json({ success: false, message: 'Gagal fetch gambar.' }));
    request.on('timeout', () => { request.destroy(); res.status(504).json({ success: false, message: 'Timeout.' }); });
});

module.exports = router;

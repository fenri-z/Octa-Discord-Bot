/**
 * routes/api.js
 * REST API untuk menyimpan settings dari dashboard ke database bot.
 * Key database disesuaikan dengan yang dipakai slashcommand-welcome.js & slashcommand-goodbye.js
 * Semua endpoint return JSON.
 */

const express              = require('express');
const { PermissionsBitField } = require('discord.js');
const { body }             = require('express-validator');
const { handleValidation } = require('../middleware/validate');
const guildCache           = require('../../utils/GuildCache');
const { logError }         = require('../../utils/logError');
const router  = express.Router();

// ── Shared regex ──────────────────────────────────────────────────────────────
const HEX_COLOR   = /^#[0-9A-Fa-f]{6}$/;
const SNOWFLAKE   = /^\d{17,20}$/;

// ── Reusable validator sets ───────────────────────────────────────────────────
const vChannelId = body('channelId')
    .notEmpty().withMessage('Target channel is required.')
    .matches(SNOWFLAKE).withMessage('Invalid channel ID.');

const vHexColor = (field, def) =>
    body(field).optional({ checkFalsy: true })
        .matches(HEX_COLOR).withMessage(`${field}: invalid hex color (e.g. ${def}).`);

const vNotifFields = [
    vChannelId,
    vHexColor('color', '#5865F2'),
    body('messageType').optional().isIn(['embed', 'plain']).withMessage('Invalid message type.'),
    body('plainText').optional().isString().trim().isLength({ max: 2000 }).withMessage('Plain text is too long (max 2000 chars).'),
    body('title').optional().isString().trim().isLength({ max: 256 }).withMessage('Title is too long (max 256 chars).'),
    body('description').optional().isString().trim().isLength({ max: 4096 }).withMessage('Description is too long (max 4096 chars).'),
    body('footerText').optional().isString().trim().isLength({ max: 2048 }).withMessage('Footer text is too long (max 2048 chars).'),
];

// ── Permission helpers ────────────────────────────────────────────────────────
const PERM_LABELS = {
    [PermissionsBitField.Flags.SendMessages]:       'Send Messages',
    [PermissionsBitField.Flags.EmbedLinks]:         'Embed Links',
    [PermissionsBitField.Flags.AttachFiles]:        'Attach Files',
    [PermissionsBitField.Flags.ManageRoles]:        'Manage Roles',
    [PermissionsBitField.Flags.ManageChannels]:     'Manage Channels',
    [PermissionsBitField.Flags.ViewChannel]:        'View Channel',
    [PermissionsBitField.Flags.ReadMessageHistory]: 'Read Message History',
    [PermissionsBitField.Flags.AddReactions]:       'Add Reactions',
    [PermissionsBitField.Flags.ManageMessages]:     'Manage Messages',
};

// Cek permission bot di channel tertentu — return array nama permission yang kurang
function missingChannelPerms(guild, channelId, flags) {
    const channel   = guild.channels.cache.get(channelId);
    const botMember = guild.members.me;
    if (!channel || !botMember) return [];
    const perms = channel.permissionsFor(botMember);
    return flags.filter(f => !perms.has(f)).map(f => PERM_LABELS[f] ?? String(f));
}

// Cek permission bot secara global — return array nama permission yang kurang
function missingGlobalPerms(guild, flags) {
    const botMember = guild.members.me;
    if (!botMember) return [];
    return flags.filter(f => !botMember.permissions.has(f)).map(f => PERM_LABELS[f] ?? String(f));
}

// ── Middleware: wajib login (return JSON error jika tidak) ────────────────────
function requireLogin(req, res, next) {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ success: false, message: 'You must be logged in first.' });
    }
    next();
}

// ── Middleware: cek izin Manage Guild + bot ada di server ─────────────────────
function requireManageGuild(req, res, next) {
    const { guildId } = req.params;
    const userGuilds  = req.user?.guilds || [];

    function canManage(g) {
        if (g.owner) return true;
        try {
            const p = BigInt(g.permissions || '0');
            return (p & 0x20n) !== 0n || (p & 0x8n) !== 0n; // Manage Guild or Administrator
        } catch { return false; }
    }

    const guild = userGuilds.find(g => g.id === guildId && canManage(g));

    if (!guild) {
        return res.status(403).json({ success: false, message: 'Akses ditolak.' });
    }

    req.botGuild = req.discordClient?.guilds.cache.get(guildId);
    if (!req.botGuild) {
        return res.status(404).json({ success: false, message: 'Bot is not in this server.' });
    }

    next();
}

// ── Helper: set boolean di database ──────────────────────────────────────────
function setDbBool(db, key, val) {
    db.set(key, val ? 'true' : 'false');
}

// ── In-memory rate limiter (30 write requests/minute per user) ────────────────
const _rlStore = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [k, e] of _rlStore) if (now > e.reset) _rlStore.delete(k);
}, 300_000);

router.use((req, res, next) => {
    if (req.method === 'GET') return next();
    const uid = req.user?.id ?? req.ip;
    const now = Date.now();
    let e = _rlStore.get(uid);
    if (!e || now > e.reset) { e = { count: 0, reset: now + 60_000 }; _rlStore.set(uid, e); }
    e.count++;
    if (e.count > 30) return res.status(429).json({ success: false, message: 'Too many requests. Please slow down.' });
    next();
});

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
router.post('/guild/:guildId/welcome', requireLogin, requireManageGuild, vNotifFields, handleValidation, (req, res) => {
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

    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    // Channel wajib diisi
    if (!channelId) return res.status(400).json({ success: false, message: 'Target channel is required.' });
    if (!req.botGuild.channels.cache.get(channelId)) return res.status(400).json({ success: false, message: 'Channel not found.' });

    // Cek permission bot di channel welcome
    const wpMissing = missingChannelPerms(req.botGuild, channelId, [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.AttachFiles,
    ]);
    if (wpMissing.length) return res.status(400).json({ success: false, message: `Bot lacks permission in this channel:\n${wpMissing.map(p => `• ${p}`).join('\n')}` });

    // Validasi warna hex
    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
        return res.status(400).json({ success: false, message: 'Invalid color format. Use hex format, e.g.: #5865F2' });
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

    db.set(`welcome-title-${guildId}`,       (title       ?? '').trim());
    db.set(`welcome-description-${guildId}`, (description ?? '').trim());
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

    guildCache.del(`welcome-cfg-${guildId}`);
    res.json({ success: true, message: 'Welcome settings saved successfully.' });
});

// ── POST /api/guild/:guildId/goodbye ──────────────────────────────────────────
router.post('/guild/:guildId/goodbye', requireLogin, requireManageGuild, vNotifFields, handleValidation, (req, res) => {
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

    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    // Channel wajib diisi
    if (!channelId) return res.status(400).json({ success: false, message: 'Target channel is required.' });
    if (!req.botGuild.channels.cache.get(channelId)) return res.status(400).json({ success: false, message: 'Channel not found.' });

    // Cek permission bot di channel goodbye
    const gbMissing = missingChannelPerms(req.botGuild, channelId, [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.AttachFiles,
    ]);
    if (gbMissing.length) return res.status(400).json({ success: false, message: `Bot lacks permission in this channel:\n${gbMissing.map(p => `• ${p}`).join('\n')}` });

    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
        return res.status(400).json({ success: false, message: 'Invalid color format. Use hex format, e.g.: #ED4245' });
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

    guildCache.del(`goodbye-cfg-${guildId}`);
    res.json({ success: true, message: 'Goodbye settings saved successfully.' });
});

// ── POST /api/guild/:guildId/autorole-join ────────────────────────────────
router.post('/guild/:guildId/autorole-join', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { memberEnabled, memberRoleId, botEnabled, botRoleId } = req.body;

    const arjMissing = missingGlobalPerms(req.botGuild, [PermissionsBitField.Flags.ManageRoles]);
    if (arjMissing.length) return res.json({ success: false, message: `Bot lacks permission:\n${arjMissing.map(p => `• ${p}`).join('\n')}` });

    const botHighest = req.botGuild.members.me?.roles.highest.position || 0;

    function validateRole(id, label) {
        if (!id) return null;
        const role = req.botGuild.roles.cache.get(id);
        if (!role) return `Role ${label} not found.`;
        if (role.position >= botHighest) return `Bot cannot assign role ${label} (position too high).`;
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

    guildCache.del(`autorole-cfg-${guildId}`);
    res.json({ success: true, message: 'Join Autorole saved successfully.' });
});

// ── POST /api/guild/:guildId/booster-boost ───────────────────────────────
router.post('/guild/:guildId/booster-boost', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { enabled, channelId, messageType, plainText, title, description, color, footerText,
            showMember, showMulaiBoost, showTotalBoost, showLevelServer, showThumbnail,
            cardEnabled, cardWelcomeText, cardSubText, cardBgColor, cardBgColor2,
            cardAccentColor, cardAvatarShape, cardBgType, cardBgImageUrl,
            cardOverlayColor, cardOverlayOpacity, cardTitleColor, cardUsernameColor,
            cardMsgColor, cardFont } = req.body;

    if (!channelId) return res.json({ success: false, message: 'Target channel is required.' });
    if (!req.botGuild.channels.cache.get(channelId)) return res.json({ success: false, message: 'Channel not found.' });

    const boostMissing = missingChannelPerms(req.botGuild, channelId, [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.AttachFiles,
    ]);
    if (boostMissing.length) return res.json({ success: false, message: `Bot lacks permission in this channel:\n${boostMissing.map(p => `• ${p}`).join('\n')}` });

    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color))
        return res.json({ success: false, message: 'Invalid color format. Example: #FF73FA' });

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

    guildCache.del(`booster-cfg-${guildId}`);
    res.json({ success: true, message: 'Boost Notification settings saved successfully.' });
});

// ── POST /api/guild/:guildId/booster-unboost ──────────────────────────────
router.post('/guild/:guildId/booster-unboost', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { enabled, channelId, messageType, plainText, title, description, color, footerText,
            showMember, showTotalBoost, showLevelServer, showThumbnail,
            cardEnabled, cardWelcomeText, cardSubText, cardBgColor, cardBgColor2,
            cardAccentColor, cardAvatarShape, cardBgType, cardBgImageUrl,
            cardOverlayColor, cardOverlayOpacity, cardTitleColor, cardUsernameColor,
            cardMsgColor, cardFont } = req.body;

    if (!channelId) return res.json({ success: false, message: 'Target channel is required.' });
    if (!req.botGuild.channels.cache.get(channelId)) return res.json({ success: false, message: 'Channel not found.' });

    const unboostMissing = missingChannelPerms(req.botGuild, channelId, [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.AttachFiles,
    ]);
    if (unboostMissing.length) return res.json({ success: false, message: `Bot lacks permission in this channel:\n${unboostMissing.map(p => `• ${p}`).join('\n')}` });

    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color))
        return res.json({ success: false, message: 'Invalid color format. Example: #ED4245' });

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

    guildCache.del(`booster-cfg-${guildId}`);
    res.json({ success: true, message: 'Unboost Notification settings saved successfully.' });
});

// ── POST /api/guild/:guildId/autorole-booster ─────────────────────────────
router.post('/guild/:guildId/autorole-booster', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { autoroleEnabled, autoroleRoleId, autoremoveEnabled } = req.body;

    const arbMissing = missingGlobalPerms(req.botGuild, [PermissionsBitField.Flags.ManageRoles]);
    if (arbMissing.length) return res.json({ success: false, message: `Bot lacks permission:\n${arbMissing.map(p => `• ${p}`).join('\n')}` });

    const botHighest = req.botGuild.members.me?.roles.highest.position || 0;

    if (autoroleRoleId) {
        const role = req.botGuild.roles.cache.get(autoroleRoleId);
        if (!role) return res.json({ success: false, message: 'Role not found.' });
        if (role.position >= botHighest) return res.json({ success: false, message: `Bot cannot assign that role (position too high).` });
    }

    db.set(`booster-autorole-enabled-${guildId}`,   autoroleEnabled   ? 'true' : 'false');
    db.set(`booster-autoremove-enabled-${guildId}`,  autoremoveEnabled ? 'true' : 'false');

    if (autoroleRoleId) db.set(`booster-autorole-role-${guildId}`, autoroleRoleId);
    else                db.delete(`booster-autorole-role-${guildId}`);

    guildCache.del(`booster-cfg-${guildId}`);
    res.json({ success: true, message: 'Booster Autorole saved successfully.' });
});

// Shared helper — applies extended embed fields (author, titleUrl, footer icon, timestamp, fields)
function _applyEmbedExtras(embed, panel) {
    if (panel.embedAuthorName) {
        embed.setAuthor({ name: panel.embedAuthorName.slice(0, 256), url: panel.embedAuthorUrl || undefined, iconURL: panel.embedAuthorIcon || undefined });
    }
    if (panel.embedTitleUrl) embed.setURL(panel.embedTitleUrl);
    if (panel.embedFooter || panel.embedFooterIcon) {
        embed.setFooter({ text: (panel.embedFooter || '').slice(0, 2048), iconURL: panel.embedFooterIcon || undefined });
    }
    if (panel.embedTimestamp) embed.setTimestamp();
    const fields = (panel.embedFields || []).filter(f => f.name && f.value).slice(0, 25);
    if (fields.length) embed.addFields(fields.map(f => ({ name: f.name.slice(0, 256), value: f.value.slice(0, 1024), inline: !!f.inline })));
}

// ── GET /api/guild/:guildId/autorole-button/:name — ambil satu panel ──────
router.get('/guild/:guildId/autorole-button/:name', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const name    = req.params.name.trim().toLowerCase();
    const raw     = db?.get(`autobtn-${guildId}-${name}`);
    if (!raw) return res.json({ success: false, message: 'Panel not found.' });
    try {
        const panel = JSON.parse(raw);
        const sentRaw = db?.get(`autobtn-sent-${guildId}-${name}`);
        panel.isSent       = !!sentRaw;
        panel.sentChannelId = sentRaw ? (JSON.parse(sentRaw).channelId || '') : '';
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
        messageType, plainText, channelId,
        embedTitle, embedDescription, embedFooter,
        embedColor, embedImage, embedThumbnail,
        embedAuthorName, embedAuthorUrl, embedAuthorIcon,
        embedTitleUrl, embedFooterIcon, embedTimestamp, embedFields,
    } = req.body;

    const panelName = (name || '').trim().toLowerCase();
    if (!panelName || !/^[a-zA-Z0-9_-]{1,32}$/.test(panelName))
        return res.json({ success: false, message: 'Invalid panel name.' });

    // Validasi warna hex jika diisi
    if (embedColor && !/^#?[0-9A-Fa-f]{6}$/.test(embedColor.trim()))
        return res.json({ success: false, message: 'Invalid color format. Use hex format, e.g.: #5865F2' });

    // Validasi URL gambar jika diisi
    const urlOk = v => !v || v === '' || /^https?:\/\/.+\..+/.test(v);
    if (!urlOk(embedImage))     return res.json({ success: false, message: 'Invalid image URL.' });
    if (!urlOk(embedThumbnail)) return res.json({ success: false, message: 'Invalid thumbnail URL.' });

    const existing = (() => {
        try { const r = db?.get(`autobtn-${guildId}-${panelName}`); return r ? JSON.parse(r) : null; } catch { return null; }
    })();

    if (!existing) {
        const listRaw = db?.get(`autobtn-list-${guildId}`);
        const currentList = listRaw ? (() => { try { return JSON.parse(listRaw); } catch { return []; } })() : [];
        if (currentList.length >= 20)
            return res.json({ success: false, message: 'Panel limit reached. Maximum 20 button panels allowed.' });
    }

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
        embedAuthorName:  embedAuthorName  !== undefined ? (embedAuthorName||'').trim()  : (existing?.embedAuthorName  || ''),
        embedAuthorUrl:   embedAuthorUrl   !== undefined ? (embedAuthorUrl||'').trim()   : (existing?.embedAuthorUrl   || ''),
        embedAuthorIcon:  embedAuthorIcon  !== undefined ? (embedAuthorIcon||'').trim()  : (existing?.embedAuthorIcon  || ''),
        embedTitleUrl:    embedTitleUrl    !== undefined ? (embedTitleUrl||'').trim()    : (existing?.embedTitleUrl    || ''),
        embedFooterIcon:  embedFooterIcon  !== undefined ? (embedFooterIcon||'').trim()  : (existing?.embedFooterIcon  || ''),
        embedTimestamp:   embedTimestamp   !== undefined ? !!embedTimestamp               : (existing?.embedTimestamp   || false),
        embedFields:      Array.isArray(embedFields) ? embedFields.filter(f=>f.name&&f.value) : (existing?.embedFields || []),
        defaultStyle:     existing?.defaultStyle || null,
        buttons:          existing?.buttons      || [],
        messageType: ['plain','both'].includes(messageType) ? messageType : (existing?.messageType || 'embed'),
        plainText:   (plainText || '').trim() || (existing?.plainText || ''),
        channelId:   (channelId || '').trim() || (existing?.channelId || ''),
        createdAt:        existing?.createdAt    || now,
        updatedAt:        now,
    };
    db.set(`autobtn-${guildId}-${panelName}`, JSON.stringify(panel));

    // Update list — atomic agar aman jika banyak request bersamaan
    if (db) db.modifyList(`autobtn-list-${guildId}`, list => {
        if (!list.includes(panelName)) list.push(panelName);
        return list;
    });

    res.json({ success: true, message: `Panel "${panelName}" successfully ${existing ? 'updated' : 'created'}.` });
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
        messageType, plainText, channelId,
        embedTitle, embedDescription, embedFooter,
        embedColor, embedImage, embedThumbnail,
        embedAuthorName, embedAuthorUrl, embedAuthorIcon,
        embedTitleUrl, embedFooterIcon, embedTimestamp, embedFields,
    } = req.body;

    const raw = db?.get(`autobtn-${guildId}-${name}`);
    if (!raw) return res.json({ success: false, message: 'Panel not found.' });

    let panel;
    try { panel = JSON.parse(raw); } catch { return res.json({ success: false, message: 'Data panel rusak.' }); }

    // Validasi opsional
    if (embedColor && !/^#?[0-9A-Fa-f]{6}$/.test(embedColor.trim()))
        return res.json({ success: false, message: 'Invalid color format. Use hex format, e.g.: #5865F2' });
    const urlOk = v => !v || v === '' || /^https?:\/\/.+\..+/.test(v);
    if (!urlOk(embedImage))     return res.json({ success: false, message: 'Invalid image URL.' });
    if (!urlOk(embedThumbnail)) return res.json({ success: false, message: 'Invalid thumbnail URL.' });

    if (mode)             panel.mode             = mode;
    if (embedTitle       !== undefined) panel.embedTitle       = embedTitle.trim();
    if (embedDescription !== undefined) panel.embedDescription = embedDescription.trim();
    if (embedFooter      !== undefined) panel.embedFooter      = embedFooter.trim();
    if (embedColor       !== undefined) panel.embedColor = embedColor.startsWith('#') ? embedColor : `#${embedColor}`;
    if (embedImage       !== undefined) panel.embedImage       = embedImage.trim();
    if (embedThumbnail   !== undefined) panel.embedThumbnail   = embedThumbnail.trim();
    if (embedAuthorName  !== undefined) panel.embedAuthorName  = (embedAuthorName||'').trim();
    if (embedAuthorUrl   !== undefined) panel.embedAuthorUrl   = (embedAuthorUrl||'').trim();
    if (embedAuthorIcon  !== undefined) panel.embedAuthorIcon  = (embedAuthorIcon||'').trim();
    if (embedTitleUrl    !== undefined) panel.embedTitleUrl    = (embedTitleUrl||'').trim();
    if (embedFooterIcon  !== undefined) panel.embedFooterIcon  = (embedFooterIcon||'').trim();
    if (embedTimestamp   !== undefined) panel.embedTimestamp   = !!embedTimestamp;
    if (Array.isArray(embedFields))    panel.embedFields      = embedFields.filter(f=>f.name&&f.value);
    if (messageType !== undefined) panel.messageType = ['plain','both'].includes(messageType) ? messageType : 'embed';
    if (plainText   !== undefined) panel.plainText   = plainText.trim();
    if (channelId   !== undefined) panel.channelId   = (channelId || '').trim();
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
                    if (panel.embedImage)       embed.setImage(panel.embedImage);
                    if (panel.embedThumbnail)   embed.setThumbnail(panel.embedThumbnail);
                    _applyEmbedExtras(embed, panel);

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

                    const comps = panel.buttons.length > 0 ? rows : [];
                    if (panel.messageType === 'both') {
                        await discordMsg.edit({ content: (panel.plainText || '').slice(0, 2000), embeds: [embed], components: comps });
                    } else if (panel.messageType === 'plain') {
                        await discordMsg.edit({ content: (panel.plainText || '').slice(0, 2000), embeds: [], components: comps });
                    } else {
                        await discordMsg.edit({ embeds: [embed], content: null, components: comps });
                    }
                    liveUpdate = ' Discord message updated live.';
                }
            }
        }
    } catch (err) { logError('[autorole-button/edit]', err); }

    res.json({ success: true, message: `Panel "${name}" successfully updated.${liveUpdate}` });
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
            logError('[autorole-button/delete] failed to delete Discord message:', err);
        }
    }

    db?.delete(`autobtn-${guildId}-${name}`);
    db?.delete(`autobtn-sent-${guildId}-${name}`);

    if (db) db.modifyList(`autobtn-list-${guildId}`, list => list.filter(n => n !== name));

    res.json({ success: true, message: `Panel "${name}" successfully deleted.` });
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
    if (!raw) return res.json({ success: false, message: 'Panel not found.' });

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
    } catch (err) { logError('[autorole-button/buttons]', err); }

    res.json({ success: true, message: 'Button(s) saved successfully.' });
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
    if (!raw) return res.json({ success: false, message: 'Panel not found.' });

    let panel;
    try { panel = JSON.parse(raw); } catch { return res.json({ success: false, message: 'Data panel rusak.' }); }

    if (!panel.buttons || panel.buttons.length === 0)
        return res.json({ success: false, message: 'Panel has no buttons yet. Add buttons first.' });

    // Lock pengiriman — cegah duplikat jika dua request datang bersamaan
    const lockKey = `autobtn-sending-lock-${guildId}-${name}`;
    if (!db?.tryLock(lockKey)) {
        return res.json({ success: false, message: 'Panel is being sent, please wait a moment.' });
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
                    message: `Panel "${name}" has already been sent and is still active. Use Edit Panel to update its appearance.`
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
        if (!channel) return res.json({ success: false, message: 'Channel not found.' });

        // Bangun embed dari field panel — sinkron dengan buildPanelEmbed() di command
        const colorHex = panel.embedColor && /^#?[0-9A-Fa-f]{6}$/.test(panel.embedColor.trim())
            ? (panel.embedColor.startsWith('#') ? panel.embedColor : `#${panel.embedColor}`)
            : '#5865F2';
        const embed = new EmbedBuilder().setColor(colorHex);
        if (panel.embedTitle)       embed.setTitle(panel.embedTitle.slice(0, 256));
        if (panel.embedDescription) embed.setDescription(panel.embedDescription.slice(0, 4096));
        if (panel.embedImage)       embed.setImage(panel.embedImage);
        if (panel.embedThumbnail)   embed.setThumbnail(panel.embedThumbnail);
        _applyEmbedExtras(embed, panel);

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
        if (panel.messageType === 'both') {
            sent = await channel.send({ content: (panel.plainText || '').slice(0, 2000), embeds: [embed], components: rows });
        } else if (panel.messageType === 'plain') {
            if (!panel.plainText) return res.json({ success: false, message: 'Plain text message content is still empty.' });
            sent = await channel.send({ content: panel.plainText.slice(0, 2000), components: rows });
        } else {
            sent = await channel.send({ embeds: [embed], components: rows });
        }
        db?.set(`autobtn-sent-${guildId}-${name}`, JSON.stringify({ messageId: sent.id, channelId: channel.id }));

        res.json({ success: true, message: `Panel successfully sent to #${channel.name}!` });
    }
    } catch (err) {
        logError('[autorole-button/send]', err);
        res.json({ success: false, message: 'Failed to send panel. Check bot permissions.' });
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
    if (!raw) return res.json({ success: false, message: 'Panel not found.' });
    try {
        const panel   = JSON.parse(raw);
        const sentRaw = db?.get(`autoreact-sent-${guildId}-${name}`);
        panel.isSent       = !!sentRaw;
        panel.sentChannelId = sentRaw ? (JSON.parse(sentRaw).channelId || '') : '';
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
        messageType, plainText, channelId,
        embedTitle, embedDescription, embedFooter,
        embedColor, embedImage, embedThumbnail,
        embedAuthorName, embedAuthorUrl, embedAuthorIcon,
        embedTitleUrl, embedFooterIcon, embedTimestamp, embedFields,
    } = req.body;

    const panelName = (name || '').trim().toLowerCase();
    if (!panelName || !/^[a-zA-Z0-9_-]{1,32}$/.test(panelName))
        return res.json({ success: false, message: 'Invalid panel name.' });

    if (embedColor && !/^#?[0-9A-Fa-f]{6}$/.test(embedColor.trim()))
        return res.json({ success: false, message: 'Invalid color format. Use hex format, e.g.: #5865F2' });

    const urlOk = v => !v || v === '' || /^https?:\/\/.+\..+/.test(v);
    if (!urlOk(embedImage))     return res.json({ success: false, message: 'Invalid image URL.' });
    if (!urlOk(embedThumbnail)) return res.json({ success: false, message: 'Invalid thumbnail URL.' });

    const existing = (() => {
        try { const r = db?.get(`autoreact-${guildId}-${panelName}`); return r ? JSON.parse(r) : null; } catch { return null; }
    })();

    if (!existing) {
        const listRaw = db?.get(`autoreact-list-${guildId}`);
        const currentList = listRaw ? (() => { try { return JSON.parse(listRaw); } catch { return []; } })() : [];
        if (currentList.length >= 20)
            return res.json({ success: false, message: 'Panel limit reached. Maximum 20 reaction panels allowed.' });
    }

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
        embedAuthorName:  embedAuthorName  !== undefined ? (embedAuthorName||'').trim()  : (existing?.embedAuthorName  || ''),
        embedAuthorUrl:   embedAuthorUrl   !== undefined ? (embedAuthorUrl||'').trim()   : (existing?.embedAuthorUrl   || ''),
        embedAuthorIcon:  embedAuthorIcon  !== undefined ? (embedAuthorIcon||'').trim()  : (existing?.embedAuthorIcon  || ''),
        embedTitleUrl:    embedTitleUrl    !== undefined ? (embedTitleUrl||'').trim()    : (existing?.embedTitleUrl    || ''),
        embedFooterIcon:  embedFooterIcon  !== undefined ? (embedFooterIcon||'').trim()  : (existing?.embedFooterIcon  || ''),
        embedTimestamp:   embedTimestamp   !== undefined ? !!embedTimestamp               : (existing?.embedTimestamp   || false),
        embedFields:      Array.isArray(embedFields) ? embedFields.filter(f=>f.name&&f.value) : (existing?.embedFields || []),
        reactions:        existing?.reactions || [],
        messageType: ['plain','both'].includes(messageType) ? messageType : (existing?.messageType || 'embed'),
        plainText:   (plainText || '').trim() || (existing?.plainText || ''),
        channelId:   (channelId || '').trim() || (existing?.channelId || ''),
        createdAt:        existing?.createdAt || now,
        updatedAt:        now,
    };
    db.set(`autoreact-${guildId}-${panelName}`, JSON.stringify(panel));

    if (db) db.modifyList(`autoreact-list-${guildId}`, list => {
        if (!list.includes(panelName)) list.push(panelName);
        return list;
    });

    res.json({ success: true, message: `Panel "${panelName}" successfully ${existing ? 'updated' : 'created'}.` });
});

// ── POST /api/guild/:guildId/autorole-reaction/:name — edit panel ──────────
router.post('/guild/:guildId/autorole-reaction/:name', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const name    = req.params.name.trim().toLowerCase();
    const {
        mode,
        messageType, plainText, channelId,
        embedTitle, embedDescription, embedFooter,
        embedColor, embedImage, embedThumbnail,
        embedAuthorName, embedAuthorUrl, embedAuthorIcon,
        embedTitleUrl, embedFooterIcon, embedTimestamp, embedFields,
    } = req.body;

    const raw = db?.get(`autoreact-${guildId}-${name}`);
    if (!raw) return res.json({ success: false, message: 'Panel not found.' });

    let panel;
    try { panel = JSON.parse(raw); } catch { return res.json({ success: false, message: 'Data panel rusak.' }); }

    if (embedColor && !/^#?[0-9A-Fa-f]{6}$/.test(embedColor.trim()))
        return res.json({ success: false, message: 'Invalid color format.' });
    const urlOk = v => !v || v === '' || /^https?:\/\/.+\..+/.test(v);
    if (!urlOk(embedImage))     return res.json({ success: false, message: 'Invalid image URL.' });
    if (!urlOk(embedThumbnail)) return res.json({ success: false, message: 'Invalid thumbnail URL.' });

    if (mode)             panel.mode             = mode;
    if (embedTitle       !== undefined) panel.embedTitle       = embedTitle.trim();
    if (embedDescription !== undefined) panel.embedDescription = embedDescription.trim();
    if (embedFooter      !== undefined) panel.embedFooter      = embedFooter.trim();
    if (embedColor       !== undefined) panel.embedColor       = embedColor.startsWith('#') ? embedColor : `#${embedColor}`;
    if (embedImage       !== undefined) panel.embedImage       = embedImage.trim();
    if (embedThumbnail   !== undefined) panel.embedThumbnail   = embedThumbnail.trim();
    if (embedAuthorName  !== undefined) panel.embedAuthorName  = (embedAuthorName||'').trim();
    if (embedAuthorUrl   !== undefined) panel.embedAuthorUrl   = (embedAuthorUrl||'').trim();
    if (embedAuthorIcon  !== undefined) panel.embedAuthorIcon  = (embedAuthorIcon||'').trim();
    if (embedTitleUrl    !== undefined) panel.embedTitleUrl    = (embedTitleUrl||'').trim();
    if (embedFooterIcon  !== undefined) panel.embedFooterIcon  = (embedFooterIcon||'').trim();
    if (embedTimestamp   !== undefined) panel.embedTimestamp   = !!embedTimestamp;
    if (Array.isArray(embedFields))    panel.embedFields      = embedFields.filter(f=>f.name&&f.value);
    if (messageType !== undefined) panel.messageType = ['plain','both'].includes(messageType) ? messageType : 'embed';
    if (plainText   !== undefined) panel.plainText   = plainText.trim();
    if (channelId   !== undefined) panel.channelId   = (channelId || '').trim();
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
                    if (panel.embedImage)       embed.setImage(panel.embedImage);
                    if (panel.embedThumbnail)   embed.setThumbnail(panel.embedThumbnail);
                    _applyEmbedExtras(embed, panel);

                    if (panel.messageType === 'both') {
                        await discordMsg.edit({ content: (panel.plainText || '').slice(0, 2000), embeds: [embed] });
                    } else if (panel.messageType === 'plain') {
                        await discordMsg.edit({ content: (panel.plainText || '').slice(0, 2000), embeds: [] });
                    } else {
                        await discordMsg.edit({ embeds: [embed], content: null });
                    }
                    liveUpdate = ' Discord message updated live.';
                }
            }
        }
    } catch (err) { logError('[autorole-reaction/edit]', err); }

    res.json({ success: true, message: `Panel "${name}" successfully updated.${liveUpdate}` });
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
            logError('[autorole-reaction/delete]', err);
        }
    }

    db?.delete(`autoreact-${guildId}-${name}`);
    db?.delete(`autoreact-sent-${guildId}-${name}`);
    if (db) db.modifyList(`autoreact-list-${guildId}`, list => list.filter(n => n !== name));

    res.json({ success: true, message: `Panel "${name}" successfully deleted.` });
});

// ── POST /api/guild/:guildId/autorole-reaction/:name/reactions — simpan reactions
router.post('/guild/:guildId/autorole-reaction/:name/reactions', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const name    = req.params.name.trim().toLowerCase();
    const { reactions } = req.body;

    const raw = db?.get(`autoreact-${guildId}-${name}`);
    if (!raw) return res.json({ success: false, message: 'Panel not found.' });

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
                        } catch { /* invalid emoji, skip */ }
                    }
                }
            }
        }
    } catch (err) { logError('[autorole-reaction/reactions]', err); }

    res.json({ success: true, message: 'Reactions saved successfully.' });
});

// ── POST /api/guild/:guildId/autorole-reaction/:name/send — kirim panel ────
router.post('/guild/:guildId/autorole-reaction/:name/send', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const name    = req.params.name.trim().toLowerCase();
    const { channelId } = req.body;

    const raw = db?.get(`autoreact-${guildId}-${name}`);
    if (!raw) return res.json({ success: false, message: 'Panel not found.' });

    let panel;
    try { panel = JSON.parse(raw); } catch { return res.json({ success: false, message: 'Data panel rusak.' }); }

    if (!panel.reactions || panel.reactions.length === 0)
        return res.json({ success: false, message: 'Panel has no reactions yet. Add one first.' });

    const lockKey = `autoreact-sending-lock-${guildId}-${name}`;
    if (!db?.tryLock(lockKey)) {
        return res.json({ success: false, message: 'Panel is being sent, please wait a moment.' });
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
                        message: `Panel "${name}" has already been sent and is still active.`
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
        if (!channel) return res.json({ success: false, message: 'Channel not found.' });

        const colorHex = panel.embedColor && /^#?[0-9A-Fa-f]{6}$/.test(panel.embedColor.trim())
            ? (panel.embedColor.startsWith('#') ? panel.embedColor : `#${panel.embedColor}`)
            : '#5865F2';
        const embed = new EmbedBuilder().setColor(colorHex);
        if (panel.embedTitle)       embed.setTitle(panel.embedTitle.slice(0, 256));
        if (panel.embedDescription) embed.setDescription(panel.embedDescription.slice(0, 4096));
        if (panel.embedImage)       embed.setImage(panel.embedImage);
        if (panel.embedThumbnail)   embed.setThumbnail(panel.embedThumbnail);
        _applyEmbedExtras(embed, panel);

        let sent;
        if (panel.messageType === 'both') {
            sent = await channel.send({ content: (panel.plainText || '').slice(0, 2000), embeds: [embed] });
        } else if (panel.messageType === 'plain') {
            if (!panel.plainText) return res.json({ success: false, message: 'Plain text message content is still empty.' });
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

        res.json({ success: true, message: `Panel successfully sent to #${channel.name}!` });
    } catch (err) {
        logError('[autorole-reaction/send]', err);
        res.json({ success: false, message: 'Failed to send panel. Check bot permissions.' });
    } finally {
        db?.unlock(lockKey);
    }
});

// ════════════════════════════════════════════════════════════════════════════
// TICKET API
// ════════════════════════════════════════════════════════════════════════════

// ── POST /api/guild/:guildId/ticket/config ────────────────────────────────
router.post('/guild/:guildId/ticket/config', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const { enabled, categoryId, logChannelId, staffRoles } = req.body;

    // Cek permission global untuk ticket
    const tkMissing = missingGlobalPerms(req.botGuild, [
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.ManageMessages,
    ]);
    if (tkMissing.length) return res.json({ success: false, message: `Bot lacks permission for ticket:\n${tkMissing.map(p => `• ${p}`).join('\n')}` });

    if (enabled) db.set(`ticket-enabled-${guildId}`, '1');
    else         db.delete(`ticket-enabled-${guildId}`);

    if (categoryId)   db.set(`ticket-category-${guildId}`, categoryId);
    else              db.delete(`ticket-category-${guildId}`);

    if (logChannelId) db.set(`ticket-log-channel-${guildId}`, logChannelId);
    else              db.delete(`ticket-log-channel-${guildId}`);

    if (Array.isArray(staffRoles)) db.set(`ticket-staff-roles-${guildId}`, JSON.stringify(staffRoles));

    res.json({ success: true, message: 'Ticket configuration saved successfully.' });
});

// ── POST /api/guild/:guildId/ticket/staff-roles — tambah satu role ───────────
router.post('/guild/:guildId/ticket/staff-roles', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const { roleId } = req.body;
    if (!roleId) return res.json({ success: false, message: 'No role ID provided.' });

    const key   = `ticket-staff-roles-${guildId}`;
    const roles = JSON.parse(db.get(key) || '[]');
    if (!roles.includes(roleId)) { roles.push(roleId); db.set(key, JSON.stringify(roles)); }
    res.json({ success: true, message: 'Staff role added.' });
});

// ── DELETE /api/guild/:guildId/ticket/staff-roles/:roleId — hapus satu role ──
router.delete('/guild/:guildId/ticket/staff-roles/:roleId', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const roleId  = req.params.roleId;

    const key   = `ticket-staff-roles-${guildId}`;
    const roles = JSON.parse(db.get(key) || '[]').filter(id => id !== roleId);
    db.set(key, JSON.stringify(roles));
    res.json({ success: true, message: 'Staff role removed.' });
});

// ── POST /api/guild/:guildId/ticket/panel-embed ────────────────────────────
router.post('/guild/:guildId/ticket/panel-embed', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const { embedTitle, embedDesc, embedColor, btnLabel } = req.body;

    if (embedTitle) db.set(`ticket-embed-title-${guildId}`, embedTitle.slice(0, 256));
    if (embedDesc)  db.set(`ticket-embed-desc-${guildId}`,  embedDesc.slice(0, 4000));
    if (embedColor && /^#?[0-9A-Fa-f]{6}$/.test(embedColor.trim())) {
        db.set(`ticket-embed-color-${guildId}`, embedColor.startsWith('#') ? embedColor : `#${embedColor}`);
    }
    if (btnLabel) db.set(`ticket-embed-btn-label-${guildId}`, btnLabel.slice(0, 80));

    res.json({ success: true, message: 'Panel appearance saved successfully.' });
});

// ── POST /api/guild/:guildId/ticket/send-panel ────────────────────────────
router.post('/guild/:guildId/ticket/send-panel', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const { channelId } = req.body;

    if (!channelId) return res.json({ success: false, message: 'No channel selected.' });

    try {
        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const guild   = client?.guilds.cache.get(guildId);
        const channel = await guild?.channels.fetch(channelId).catch(() => null);
        if (!channel) return res.json({ success: false, message: 'Channel not found.' });

        // Hapus panel lama
        const oldRaw = db?.get(`ticket-panel-msg-${guildId}`);
        if (oldRaw) {
            try {
                const old   = JSON.parse(oldRaw);
                const oldCh = guild.channels.cache.get(old.channelId);
                if (oldCh) { const oldMsg = await oldCh.messages.fetch(old.messageId).catch(() => null); if (oldMsg) await oldMsg.delete().catch(() => null); }
            } catch {}
        }

        const title    = db?.get(`ticket-embed-title-${guildId}`)     || '🎫 Support Ticket';
        const desc     = db?.get(`ticket-embed-desc-${guildId}`)      || 'Click the button below to create a ticket.';
        const colorRaw = db?.get(`ticket-embed-color-${guildId}`)     || '#5865F2';
        const btnLabel = db?.get(`ticket-embed-btn-label-${guildId}`) || '📩 Create Ticket';
        const color    = colorRaw.startsWith('#') ? colorRaw : `#${colorRaw}`;

        const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc);
        const row   = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket-open').setLabel(btnLabel).setStyle(ButtonStyle.Primary)
        );

        const sent = await channel.send({ embeds: [embed], components: [row] });
        db?.set(`ticket-panel-msg-${guildId}`, JSON.stringify({ messageId: sent.id, channelId: channel.id }));
        db?.set(`ticket-panel-channel-${guildId}`, channel.id);

        res.json({ success: true, message: `Panel successfully sent to #${channel.name}!` });
    } catch (err) {
        logError('[ticket/send-panel]', err);
        res.json({ success: false, message: 'Failed to send panel. Check bot permissions.' });
    }
});

// ── POST /api/guild/:guildId/prefix ───────────────────────────────────────────
router.post('/guild/:guildId/prefix', requireLogin, requireManageGuild, (req, res) => {
    const { prefix } = req.body;
    const db         = req.discordClient?.database;
    const guildId    = req.params.guildId;

    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    if (!prefix || prefix.length > 5) {
        return res.status(400).json({ success: false, message: 'Invalid prefix (max 5 characters).' });
    }

    db.set(`prefix_${guildId}`, prefix.trim());
    res.json({ success: true, message: `Prefix successfully changed to "${prefix.trim()}".` });
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
            ? `Nickname successfully changed to "${nickname}".`
            : 'Nickname successfully reset to the original name.';
        res.json({ success: true, message: msg });
    } catch (e) {
        logError('[nickname set]', e);
        res.json({ success: false, message: 'Failed to change nickname. Make sure the bot has the Manage Nicknames permission.' });
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
        return res.json({ success: false, message: 'Role not found.' });
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
            return res.json({ success: false, message: 'Channel not found.' });
        }

        return res.json({
            success: true,
            channel: {
                id:   channel.id,
                name: channel.name
            }
        });
    } catch {
        return res.json({ success: false, message: 'Channel not found.' });
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
function mbBuildEmbed(data) {
    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder();
    const colorHex = data.color && /^#?[0-9A-Fa-f]{6}$/.test(data.color.trim())
        ? (data.color.startsWith('#') ? data.color : `#${data.color}`) : '#5865F2';
    embed.setColor(colorHex);
    if (data.title) {
        try { embed.setTitle(data.title.slice(0, 256)); } catch {}
        if (data.titleUrl) try { embed.setURL(data.titleUrl); } catch {}
    }
    if (data.description) try { embed.setDescription(data.description.slice(0, 4096)); } catch {}
    if (data.footer) {
        const fo = { text: data.footer.slice(0, 2048) };
        if (data.footerIcon) try { new URL(data.footerIcon); fo.iconURL = data.footerIcon; } catch {}
        embed.setFooter(fo);
    }
    if (data.image)       try { embed.setImage(data.image); } catch {}
    if (data.thumbnail)   try { embed.setThumbnail(data.thumbnail); } catch {}
    if (data.authorName) {
        const ao = { name: data.authorName.slice(0, 256) };
        if (data.authorIcon) try { new URL(data.authorIcon); ao.iconURL = data.authorIcon; } catch {}
        if (data.authorUrl)  try { new URL(data.authorUrl);  ao.url     = data.authorUrl;  } catch {}
        try { embed.setAuthor(ao); } catch {}
    }
    if (Array.isArray(data.fields) && data.fields.length) {
        const validFields = data.fields.filter(f => f.name?.trim() || f.value?.trim()).slice(0, 25);
        if (validFields.length) try { embed.addFields(validFields.map(f => ({ name: f.name || '​', value: f.value || '​', inline: !!f.inline }))); } catch {}
    }
    if (data.timestamp) embed.setTimestamp();
    return embed;
}
function mbBuildSendOpts(data) {
    const type = data.messageType || 'embed';
    const hasEmbed = type === 'embed' || type === 'both';
    const hasText  = type === 'plain' || type === 'both';
    const opts = {};

    opts.content = (hasText && data.plainText) ? data.plainText.slice(0, 2000) : null;

    // Send plainImage as a real file attachment (no URL text shown in Discord)
    if (hasText && data.plainImage && /^https?:\/\/.+/i.test(data.plainImage)) {
        try { new URL(data.plainImage); opts.files = [{ attachment: data.plainImage }]; } catch {}
    }

    opts.embeds = hasEmbed ? [mbBuildEmbed(data)] : [];
    return opts;
}

// GET /api/guild/:guildId/message-builder/:name — ambil satu template
router.get('/guild/:guildId/message-builder/:name', requireLogin, requireManageGuild, (req, res) => {
    const db       = req.discordClient?.database;
    const { guildId } = req.params;
    const name = req.params.name.trim().toLowerCase();
    const template = mbGetTemplate(db, guildId, name);
    if (!template) return res.json({ success: false, message: 'Template not found.' });
    res.json({ success: true, template });
});

// POST /api/guild/:guildId/message-builder — simpan (buat/edit) template
router.post('/guild/:guildId/message-builder', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const { channelId, title, description, footer, footerIcon, authorName, authorIcon, authorUrl,
            titleUrl, image, thumbnail, color, timestamp, messageType, plainText, plainImage, fields } = req.body;
    const name    = (req.body.name || '').trim().toLowerCase();

    if (!name || !/^[a-zA-Z0-9_-]{1,32}$/.test(name)) {
        return res.json({ success: false, message: 'Invalid template name.' });
    }

    const existing  = mbGetTemplate(db, guildId, name);
    if (!existing) {
        const currentList = mbGetList(db, guildId);
        if (currentList.length >= 20)
            return res.json({ success: false, message: 'Template limit reached (20/20). Delete an existing template first.' });
    }
    const now       = Date.now();
    const validType = ['plain','embed','both'].includes(messageType) ? messageType : 'embed';
    const data      = {
        channelId:   channelId   || '',
        messageType: validType,
        plainText:   (plainText  || '').trim(),
        title:       title       || '',
        description: description || '',
        footer:      footer      || '',
        authorName:  authorName  || '',
        authorIcon:  authorIcon  || '',
        authorUrl:   authorUrl   || '',
        titleUrl:    titleUrl    || '',
        image:       image       || '',
        thumbnail:   thumbnail   || '',
        plainImage:  plainImage  || '',
        footerIcon:  footerIcon  || '',
        color:       color       || '#5865F2',
        timestamp:   !!timestamp,
        fields:      Array.isArray(fields) ? fields.slice(0, 25).map(f => ({ name: String(f.name || '').slice(0, 256), value: String(f.value || '').slice(0, 1024), inline: !!f.inline })) : [],
        createdAt:   existing?.createdAt || now,
        updatedAt:   now,
    };
    mbSaveTemplate(db, guildId, name, data);

    // Jika sudah pernah dikirim, edit pesan Discord-nya
    const sentRaw = db?.get(`pesan-unik-sent-${guildId}-${name}`);
    if (sentRaw) {
        let sent;
        try { sent = JSON.parse(sentRaw); } catch {
            return res.json({ success: true, message: `Template saved, but sent message data is corrupted.` });
        }

        try {
            const guild = client?.guilds.cache.get(guildId);
            if (!guild) throw new Error('Guild not found in bot cache.');

            const channel = await guild.channels.fetch(sent.channelId);
            if (!channel) throw new Error('Channel not found.');
            const msg = await channel.messages.fetch(sent.messageId);
            if (!msg) throw new Error('Message not found.');

            await msg.edit({ ...mbBuildSendOpts(data), attachments: [] });
            return res.json({ success: true, message: `Template "${name}" saved and Discord message successfully updated! ✅` });

        } catch (err) {
            if (err.code === 10008) {
                db?.delete(`pesan-unik-sent-${guildId}-${name}`);
                return res.json({ success: true, message: `Template saved, but the Discord message was deleted. Resend it via the Send button.` });
            }
            logError('[message-builder/edit-sent]', err);
            return res.json({ success: true, message: `Template saved, but failed to edit Discord message: ${err.message}` });
        }
    }

    res.json({ success: true, message: `Template "${name}" saved successfully.` });
});

// DELETE /api/guild/:guildId/message-builder/:name — hapus template
router.delete('/guild/:guildId/message-builder/:name', requireLogin, requireManageGuild, async (req, res) => {
    const db       = req.discordClient?.database;
    const client   = req.discordClient;
    const { guildId } = req.params;
    const name = req.params.name.trim().toLowerCase();
    if (!mbGetTemplate(db, guildId, name)) return res.json({ success: false, message: 'Template not found.' });

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
            } catch { /* message already manually deleted, continue */ }

            // Hapus data sent dari DB
            db?.delete(`autobtn-sent-${guildId}-${panelName}`);
        }
    } catch (err) {
        logError('[message-builder/delete] failed to delete panel message:', err);
    }

    // Hapus pesan Discord yang dikirim via Send button (jika ada)
    const sentUnikRaw = db?.get(`pesan-unik-sent-${guildId}-${name}`);
    if (sentUnikRaw) {
        try {
            const sentUnik = JSON.parse(sentUnikRaw);
            const guild = client?.guilds.cache.get(guildId);
            const channel = await guild?.channels.fetch(sentUnik.channelId).catch(() => null);
            if (channel) {
                const msg = await channel.messages.fetch(sentUnik.messageId).catch(() => null);
                if (msg) await msg.delete().catch(() => null);
            }
        } catch { /* pesan sudah dihapus manual, lanjut */ }
        db?.delete(`pesan-unik-sent-${guildId}-${name}`);
    }

    mbDeleteTemplate(db, guildId, name);
    res.json({ success: true, message: `Template "${name}" deleted successfully.` });
});

// POST /api/guild/:guildId/message-builder/:name/send — kirim ke channel
router.post('/guild/:guildId/message-builder/:name/send', requireLogin, requireManageGuild, async (req, res) => {
    const db       = req.discordClient?.database;
    const client   = req.discordClient;
    const { guildId } = req.params;
    const name = req.params.name.trim().toLowerCase();

    const template = mbGetTemplate(db, guildId, name);
    if (!template) return res.json({ success: false, message: 'Template not found.' });

    const channelId = template.channelId;
    if (!channelId) return res.json({ success: false, message: 'No channel set for this template. Edit the template and select a target channel.' });

    const mtype = template.messageType || 'embed';
    const hasEmbed = mtype === 'embed' || mtype === 'both';
    const hasText  = mtype === 'plain' || mtype === 'both';
    if (hasText  && !template.plainText?.trim() && !hasEmbed)
        return res.json({ success: false, message: 'Plain text template is still empty.' });
    if (hasEmbed && !template.title && !template.description && !hasText)
        return res.json({ success: false, message: 'Template is still empty.' });

    const guild   = client?.guilds.cache.get(guildId);
    if (!guild) return res.json({ success: false, message: 'Guild not found in bot cache.' });

    // Cek apakah sudah pernah dikirim
    const sentRaw = db?.get(`pesan-unik-sent-${guildId}-${name}`);
    if (sentRaw) {
        let sent;
        try { sent = JSON.parse(sentRaw); } catch { db?.delete(`pesan-unik-sent-${guildId}-${name}`); }
        if (sent) {
            try {
                const ch = guild.channels.cache.get(sent.channelId) ?? await guild.channels.fetch(sent.channelId).catch(() => null);
                if (ch) {
                    await ch.messages.fetch(sent.messageId);
                    return res.json({ success: false, message: `Template "${name}" has already been sent. Edit and save the template to update the message automatically.` });
                }
            } catch { /* message deleted — allow resend */ }
            db?.delete(`pesan-unik-sent-${guildId}-${name}`);
        }
    }

    const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return res.json({ success: false, message: 'Target channel not found. It may have been deleted.' });

    try {
        const sent = await channel.send(mbBuildSendOpts(template));
        db?.set(`pesan-unik-sent-${guildId}-${name}`, JSON.stringify({ messageId: sent.id, channelId: channel.id }));
        res.json({ success: true, message: `Successfully sent to #${channel.name}!` });
    } catch (err) {
        logError('[message-builder/send]', err);
        res.json({ success: false, message: 'Failed to send message. Check bot permissions.' });
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
                inviterTag:  inv.inviter?.username ?? 'Unknown',
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
        res.json({ success: false, message: 'Failed to fetch invites. Make sure the bot has the Manage Guild permission.' });
    }
});

// ── POST /api/guild/:guildId/serverstats — simpan status + label ─────────────
router.post('/guild/:guildId/serverstats', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { enabled, totalLabel, humanLabel, botLabel, categoryLabel } = req.body;
    const { getServerStatsConfig, updateStats } = require('../../utils/serverStatsHelper');
    const cfg = getServerStatsConfig({ database: db }, guildId);

    if (enabled !== undefined) {
        if (enabled && (!cfg.categoryId || !cfg.totalId || !cfg.humanId || !cfg.botId)) {
            return res.json({ success: false, message: 'Server Stats not set up. Click the Setup button first.' });
        }
        db.set(`serverstats-enabled-${guildId}`, enabled ? 'true' : 'false');
    }

    if (totalLabel !== undefined && totalLabel) {
        if (!totalLabel.includes('{count}'))
            return res.json({ success: false, message: 'Total Member format must include {count}.' });
        db.set(`serverstats-total-label-${guildId}`, totalLabel.trim().slice(0, 90));
    }
    if (humanLabel !== undefined && humanLabel) {
        if (!humanLabel.includes('{count}'))
            return res.json({ success: false, message: 'User format must include {count}.' });
        db.set(`serverstats-human-label-${guildId}`, humanLabel.trim().slice(0, 90));
    }
    if (botLabel !== undefined && botLabel) {
        if (!botLabel.includes('{count}'))
            return res.json({ success: false, message: 'Bot format must include {count}.' });
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

    res.json({ success: true, message: 'Server Stats settings saved successfully.' });
});

// ── POST /api/guild/:guildId/serverstats/setup — buat channel statistik ───────
router.post('/guild/:guildId/serverstats/setup', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const guild   = req.botGuild;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const ssMissing = missingGlobalPerms(guild, [PermissionsBitField.Flags.ManageChannels]);
    if (ssMissing.length) return res.json({ success: false, message: `Bot lacks permission to create stats channels:\n${ssMissing.map(p => `• ${p}`).join('\n')}` });

    const { getServerStatsConfig, parseLabel } = require('../../utils/serverStatsHelper');
    const cfg = getServerStatsConfig({ database: db }, guildId);

    if (cfg.categoryId && cfg.totalId && cfg.humanId && cfg.botId) {
        return res.json({ success: false, message: 'Server Stats is already set up. Use Reset first to start over.' });
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
    if (!category) return res.json({ success: false, message: 'Failed to create category. Make sure the bot has the Manage Channels permission.' });

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
        return res.json({ success: false, message: 'Failed to create one or more stats channels. Check bot permissions.' });
    }

    db.set(`serverstats-category-${guildId}`,       category.id);
    db.set(`serverstats-total-channel-${guildId}`,  totalCh.id);
    db.set(`serverstats-human-channel-${guildId}`,  humanCh.id);
    db.set(`serverstats-bot-channel-${guildId}`,    botCh.id);
    db.set(`serverstats-category-label-${guildId}`, categoryName);
    db.set(`serverstats-enabled-${guildId}`,        'true');

    res.json({
        success: true,
        message: `Server Stats set up successfully! Category: ${category.name} · Total: ${totalCh.name} · User: ${humanCh.name} · Bot: ${botCh.name}`
    });
});

// ── POST /api/guild/:guildId/serverstats/reset — hapus semua config + channel ─
router.post('/guild/:guildId/serverstats/reset', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const guild   = req.botGuild;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

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

    res.json({ success: true, message: 'Server Stats successfully reset. All stats channels have been deleted.' });
});

// ── GET /api/guild/:guildId/image-proxy — proxy gambar eksternal agar canvas ─
// bisa menggambar tanpa terkena blokir CORS browser.
router.get('/guild/:guildId/image-proxy', requireLogin, requireManageGuild, (req, res) => {
    const { url } = req.query;
    if (!url || !/^https?:\/\/.+/.test(url)) return res.status(400).json({ success: false, message: 'Invalid URL.' });

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
    request.on('error', () => res.status(500).json({ success: false, message: 'Failed to fetch image.' }));
    request.on('timeout', () => { request.destroy(); res.status(504).json({ success: false, message: 'Timeout.' }); });
});

// ══════════════════════════════════════════════════════════════════════════════
// YouTube Notifications
// ══════════════════════════════════════════════════════════════════════════════

const MAX_YT_CHANNELS = 10;

function getYtChannels(db, guildId) {
    try { return JSON.parse(db.get(`youtube-channels-${guildId}`) || '[]'); }
    catch { return []; }
}
function setYtChannels(db, guildId, channels) {
    db.set(`youtube-channels-${guildId}`, JSON.stringify(channels));
}

// POST /api/guild/:guildId/youtube/lookup — cari channel YouTube dari ID / handle
router.post('/guild/:guildId/youtube/lookup', requireLogin, requireManageGuild, async (req, res) => {
    const { input } = req.body;
    if (!input?.trim()) return res.json({ success: false, message: 'Input cannot be empty.' });

    const notifier = req.discordClient?.youtubeNotifier;
    if (!notifier) return res.json({ success: false, message: 'YouTubeNotifier is not available. Make sure the bot is connected to Discord.' });

    try {
        const ch = await notifier.lookupChannel(input.trim());
        res.json({ success: true, channel: ch });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// POST /api/guild/:guildId/youtube/channels — tambah channel baru
router.post('/guild/:guildId/youtube/channels', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { id, name, thumbnail, handle } = req.body;
    if (!id || !name) return res.json({ success: false, message: 'Channel data is incomplete.' });

    const channels = getYtChannels(db, guildId);
    if (channels.length >= MAX_YT_CHANNELS)
        return res.json({ success: false, message: `Maximum ${MAX_YT_CHANNELS} YouTube channels per server.` });
    if (channels.find(c => c.id === id))
        return res.json({ success: false, message: 'This channel has already been added.' });

    channels.push({
        id, name, thumbnail: thumbnail || null, handle: handle || null,
        videoEnabled: false, videoChannelId: '', videoMessage: '',
        shortEnabled: false, shortChannelId: '', shortMessage: '',
        liveEnabled:  false, liveChannelId:  '', liveMessage:  '',
        addedAt: Date.now(),
    });
    setYtChannels(db, guildId, channels);

    // WebSub: subscribe ke hub agar notifikasi instan
    const notifier = req.discordClient?.youtubeNotifier;
    if (notifier) {
        notifier.subscribe(id).catch(() => {});
        // Inisialisasi lastVideo & liveNotified agar tidak ada notif untuk video/stream lama
        notifier.pollGuild(guildId).catch(() => {});
        notifier.seedLiveNotified(guildId, id).catch(() => {});
    }

    res.json({ success: true, message: `Channel "${name}" added successfully.` });
});

// PUT /api/guild/:guildId/youtube/channels/:ytChannelId — update settings notif
router.put('/guild/:guildId/youtube/channels/:ytChannelId', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const ytId    = req.params.ytChannelId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const channels = getYtChannels(db, guildId);
    const idx      = channels.findIndex(c => c.id === ytId);
    if (idx === -1) return res.json({ success: false, message: 'Channel not found.' });

    const guild = req.botGuild;
    const {
        videoEnabled, videoChannelId, videoMessage,
        shortEnabled, shortChannelId, shortMessage,
        liveEnabled,  liveChannelId,  liveMessage,
    } = req.body;

    const REQUIRED_PERMS = [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
    ];

    const typeLabels = { video: 'Video', short: 'Short', live: 'Live' };
    const entries = [
        { label: 'Video', flag: videoEnabled, chId: videoChannelId },
        { label: 'Short', flag: shortEnabled, chId: shortChannelId },
        { label: 'Live',  flag: liveEnabled,  chId: liveChannelId  },
    ];

    for (const { label, flag, chId } of entries) {
        if (!flag) continue;

        // Wajib pilih channel jika notifikasi diaktifkan
        if (!chId) {
            return res.json({ success: false, message: `${label} notification is enabled but no Discord channel has been selected.` });
        }

        // Cek channel ada di server
        if (!guild.channels.cache.get(chId)) {
            return res.json({ success: false, message: `Discord channel for ${label} notification not found.` });
        }

        // Cek permission bot di channel tersebut
        const missing = missingChannelPerms(guild, chId, REQUIRED_PERMS);
        if (missing.length) {
            return res.json({
                success: false,
                message: `Bot lacks permission in the ${label} notification channel:\n${missing.map(p => `• ${p}`).join('\n')}`,
            });
        }
    }

    channels[idx] = {
        ...channels[idx],
        videoEnabled: !!videoEnabled, videoChannelId: videoChannelId || '', videoMessage: videoMessage || '',
        shortEnabled: !!shortEnabled, shortChannelId: shortChannelId || '', shortMessage: shortMessage || '',
        liveEnabled:  !!liveEnabled,  liveChannelId:  liveChannelId  || '', liveMessage:  liveMessage  || '',
    };
    setYtChannels(db, guildId, channels);

    // Auto-refresh profile di background
    const notifier = req.discordClient?.youtubeNotifier;
    if (notifier) {
        notifier.lookupChannel(ytId).then(info => {
            const chs = getYtChannels(db, guildId);
            const i   = chs.findIndex(c => c.id === ytId);
            if (i !== -1) {
                chs[i] = {
                    ...chs[i],
                    name:      info.name      || chs[i].name,
                    thumbnail: info.thumbnail || chs[i].thumbnail,
                    handle:    info.handle    || chs[i].handle,
                };
                setYtChannels(db, guildId, chs);
            }
        }).catch(() => {});
    }

    res.json({ success: true, message: 'Notification settings saved successfully.' });
});

// POST /api/guild/:guildId/youtube/channels/:ytChannelId/refresh-profile — refresh profile channel
router.post('/guild/:guildId/youtube/channels/:ytChannelId/refresh-profile', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const ytId    = req.params.ytChannelId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const channels = getYtChannels(db, guildId);
    const idx      = channels.findIndex(c => c.id === ytId);
    if (idx === -1) return res.json({ success: false, message: 'Channel not found.' });

    const notifier = req.discordClient?.youtubeNotifier;
    if (!notifier) return res.json({ success: false, message: 'YouTubeNotifier is not available.' });

    try {
        const info = await notifier.lookupChannel(ytId);
        channels[idx] = {
            ...channels[idx],
            name:      info.name      || channels[idx].name,
            thumbnail: info.thumbnail || channels[idx].thumbnail,
            handle:    info.handle    || channels[idx].handle,
        };
        setYtChannels(db, guildId, channels);
        res.json({
            success: true,
            message: 'Profile updated successfully.',
            channel: { name: info.name, thumbnail: info.thumbnail, handle: info.handle },
        });
    } catch (err) {
        res.json({ success: false, message: `Failed to refresh: ${err.message}` });
    }
});

// POST /api/guild/:guildId/youtube/channels/:ytChannelId/test — kirim test notif
router.post('/guild/:guildId/youtube/channels/:ytChannelId/test', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const ytId    = req.params.ytChannelId;
    const { type } = req.body;

    if (!['video', 'short', 'live'].includes(type)) {
        return res.json({ success: false, message: 'Invalid type.' });
    }

    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const channels = getYtChannels(db, guildId);
    const ytCh     = channels.find(c => c.id === ytId);
    if (!ytCh) return res.json({ success: false, message: 'Channel not found.' });

    const notifier = req.discordClient?.youtubeNotifier;
    if (!notifier) return res.json({ success: false, message: 'YouTubeNotifier is not available.' });

    const typeLabels = { video: 'Video', short: 'Short', live: 'Live' };
    const chIdKey    = { video: 'videoChannelId', short: 'shortChannelId', live: 'liveChannelId' };
    const enabledKey = { video: 'videoEnabled',   short: 'shortEnabled',   live: 'liveEnabled'   };

    if (!ytCh[enabledKey[type]]) {
        return res.json({ success: false, message: `${typeLabels[type]} notification is not enabled.` });
    }
    if (!ytCh[chIdKey[type]]) {
        return res.json({ success: false, message: `Discord channel for ${typeLabels[type]} has not been selected.` });
    }

    try {
        await notifier._sendNotification(req.botGuild, ytCh, type, {
            videoId:   'dQw4w9WgXcQ',
            url:       'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            title:     `[TEST] Example ${typeLabels[type]} Notification from ${ytCh.name}`,
            channel:   ytCh.name,
            thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        });
        res.json({ success: true, message: `${typeLabels[type]} test notification successfully sent to Discord!` });
    } catch (err) {
        res.json({ success: false, message: `Failed to send: ${err.message}` });
    }
});

// DELETE /api/guild/:guildId/youtube/channels/:ytChannelId — hapus channel
router.delete('/guild/:guildId/youtube/channels/:ytChannelId', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const ytId    = req.params.ytChannelId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const channels = getYtChannels(db, guildId);
    const ch       = channels.find(c => c.id === ytId);
    if (!ch) return res.json({ success: false, message: 'Channel not found.' });

    setYtChannels(db, guildId, channels.filter(c => c.id !== ytId));
    db.delete(`youtube-lastVideo-${guildId}-${ytId}`);

    // WebSub: unsubscribe hanya jika tidak ada guild lain yang masih pantau channel ini
    const notifier = req.discordClient?.youtubeNotifier;
    if (notifier) {
        const stillTracked = [...req.discordClient.guilds.cache.values()].some(g => {
            if (g.id === guildId) return false;
            const raw = db.get(`youtube-channels-${g.id}`);
            if (!raw) return false;
            try { return JSON.parse(raw).some(c => c.id === ytId); } catch { return false; }
        });
        if (!stillTracked) notifier.unsubscribe(ytId).catch(() => {});
    }

    res.json({ success: true, message: `Channel "${ch.name}" deleted successfully.` });
});

// ══════════════════════════════════════════════════════════════════════════════
// TikTok Notifications
// ══════════════════════════════════════════════════════════════════════════════

const MAX_TT_ACCOUNTS = 10;

function getTtAccounts(db, guildId) {
    try { return JSON.parse(db.get(`tiktok-accounts-${guildId}`) || '[]'); }
    catch { return []; }
}
function setTtAccounts(db, guildId, accounts) {
    db.set(`tiktok-accounts-${guildId}`, JSON.stringify(accounts));
}

// POST /api/guild/:guildId/tiktok/lookup
router.post('/guild/:guildId/tiktok/lookup', requireLogin, requireManageGuild, async (req, res) => {
    const { input } = req.body;
    if (!input?.trim()) return res.json({ success: false, message: 'Input cannot be empty.' });

    const notifier = req.discordClient?.tiktokNotifier;
    if (!notifier) return res.json({ success: false, message: 'TikTokNotifier is not available.' });

    try {
        const account = await notifier.lookupAccount(input.trim());
        res.json({ success: true, account });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// POST /api/guild/:guildId/tiktok/accounts — tambah akun TikTok
router.post('/guild/:guildId/tiktok/accounts', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { username, name, thumbnail } = req.body;
    if (!username) return res.json({ success: false, message: 'Username cannot be empty.' });

    const accounts = getTtAccounts(db, guildId);
    if (accounts.length >= MAX_TT_ACCOUNTS)
        return res.json({ success: false, message: `Maximum ${MAX_TT_ACCOUNTS} TikTok accounts per server.` });
    if (accounts.find(a => a.username === username))
        return res.json({ success: false, message: 'This account has already been added.' });

    accounts.push({
        username,
        name:           name || username,
        thumbnail:      thumbnail || null,
        videoEnabled:   false,
        videoChannelId: '',
        videoMessage:   '',
        liveEnabled:    false,
        liveChannelId:  '',
        liveMessage:    '',
        addedAt:        Date.now(),
    });
    setTtAccounts(db, guildId, accounts);

    // Inisialisasi lastVideo sekarang agar tidak ada notif untuk video lama
    const notifier = req.discordClient?.tiktokNotifier;
    if (notifier) notifier.pollGuild(guildId).catch(() => {});

    res.json({ success: true, message: `Account "${username}" added successfully.` });
});

// PUT /api/guild/:guildId/tiktok/accounts/:username — update settings notifikasi
router.put('/guild/:guildId/tiktok/accounts/:username', requireLogin, requireManageGuild, (req, res) => {
    const db       = req.discordClient?.database;
    const guildId  = req.params.guildId;
    const username = decodeURIComponent(req.params.username);
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const accounts = getTtAccounts(db, guildId);
    const idx      = accounts.findIndex(a => a.username === username);
    if (idx === -1) return res.json({ success: false, message: 'Account not found.' });

    const { videoEnabled, videoChannelId, videoMessage,
            liveEnabled,  liveChannelId,  liveMessage  } = req.body;
    const guild = req.botGuild;

    const REQUIRED_PERMS = [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
    ];

    for (const { label, flag, chId } of [
        { label: 'Video', flag: videoEnabled, chId: videoChannelId },
        { label: 'Live',  flag: liveEnabled,  chId: liveChannelId  },
    ]) {
        if (!flag) continue;
        if (!chId)
            return res.json({ success: false, message: `${label} notification is enabled but no Discord channel has been selected.` });
        if (!guild.channels.cache.get(chId))
            return res.json({ success: false, message: `Discord channel for ${label} not found.` });
        const missing = missingChannelPerms(guild, chId, REQUIRED_PERMS);
        if (missing.length)
            return res.json({ success: false, message: `Bot lacks permission in the ${label} channel:\n${missing.map(p => `• ${p}`).join('\n')}` });
    }

    accounts[idx] = {
        ...accounts[idx],
        videoEnabled:   !!videoEnabled,
        videoChannelId: videoChannelId || '',
        videoMessage:   videoMessage   || '',
        liveEnabled:    !!liveEnabled,
        liveChannelId:  liveChannelId  || '',
        liveMessage:    liveMessage    || '',
    };
    setTtAccounts(db, guildId, accounts);

    // Auto-refresh thumbnail di background
    const notifier = req.discordClient?.tiktokNotifier;
    if (notifier) {
        notifier.lookupAccount(username).then(info => {
            if (info?.thumbnail) {
                const accs = getTtAccounts(db, guildId);
                const i = accs.findIndex(a => a.username === username);
                if (i !== -1) { accs[i].thumbnail = info.thumbnail; setTtAccounts(db, guildId, accs); }
            }
        }).catch(() => {});
    }

    res.json({ success: true, message: 'Settings saved successfully.' });
});

// POST /api/guild/:guildId/tiktok/accounts/:username/test — kirim test notifikasi
router.post('/guild/:guildId/tiktok/accounts/:username/test', requireLogin, requireManageGuild, async (req, res) => {
    const db       = req.discordClient?.database;
    const guildId  = req.params.guildId;
    const username = decodeURIComponent(req.params.username);
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { type = 'video' } = req.body;
    if (!['video', 'live'].includes(type))
        return res.json({ success: false, message: 'Invalid type.' });

    const accounts = getTtAccounts(db, guildId);
    const account  = accounts.find(a => a.username === username);
    if (!account) return res.json({ success: false, message: 'Account not found.' });

    if (type === 'video') {
        if (!account.videoEnabled)   return res.json({ success: false, message: 'Video notification is not enabled.' });
        if (!account.videoChannelId) return res.json({ success: false, message: 'Discord channel for Video has not been selected.' });
    } else {
        if (!account.liveEnabled)    return res.json({ success: false, message: 'Live notification is not enabled.' });
        if (!account.liveChannelId)  return res.json({ success: false, message: 'Discord channel for Live has not been selected.' });
        const notifier = req.discordClient?.tiktokNotifier;
        if (!notifier?.liveSupported) return res.json({ success: false, message: 'Live detection is not active. Run: npm install tiktok-live-connector' });
    }

    const notifier = req.discordClient?.tiktokNotifier;
    if (!notifier) return res.json({ success: false, message: 'TikTokNotifier is not available.' });

    try {
        await notifier._sendNotification(req.botGuild, account, type, {
            id:    '0000000000000000000',
            url:   `https://www.tiktok.com/${username}/video/0000000000000000000`,
            title: `[TEST] Example ${type === 'live' ? 'Live' : 'Video'} Notification from ${account.name || username}`,
        });
        res.json({ success: true, message: `${type === 'live' ? 'Live' : 'Video'} test notification sent successfully!` });
    } catch (err) {
        res.json({ success: false, message: `Failed to send: ${err.message}` });
    }
});

// POST /api/guild/:guildId/tiktok/accounts/:username/reenable — aktifkan kembali akun yang dinonaktifkan otomatis
router.post('/guild/:guildId/tiktok/accounts/:username/reenable', requireLogin, requireManageGuild, (req, res) => {
    const db       = req.discordClient?.database;
    const guildId  = req.params.guildId;
    const username = decodeURIComponent(req.params.username);
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const accounts = getTtAccounts(db, guildId);
    const idx      = accounts.findIndex(a => a.username === username);
    if (idx === -1) return res.json({ success: false, message: 'Account not found.' });

    const acc = accounts[idx];
    if (!acc.broken) return res.json({ success: false, message: 'Account is not disabled.' });

    acc.broken       = false;
    acc.brokenAt     = null;
    acc.failCount    = 0;
    acc.videoEnabled = true;
    acc.liveEnabled  = true;
    setTtAccounts(db, guildId, accounts);

    res.json({ success: true, message: `@${username} has been re-enabled successfully.` });
});

// DELETE /api/guild/:guildId/tiktok/accounts/:username — hapus akun
router.delete('/guild/:guildId/tiktok/accounts/:username', requireLogin, requireManageGuild, (req, res) => {
    const db       = req.discordClient?.database;
    const guildId  = req.params.guildId;
    const username = decodeURIComponent(req.params.username);
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const accounts = getTtAccounts(db, guildId);
    const account  = accounts.find(a => a.username === username);
    if (!account) return res.json({ success: false, message: 'Account not found.' });

    setTtAccounts(db, guildId, accounts.filter(a => a.username !== username));
    db.delete(`tiktok-lastVideo-${guildId}-${username}`);
    res.json({ success: true, message: `Account "${username}" deleted successfully.` });
});

// ════════════════════════════════════════════════════════════════════════════════
// TWITCH EVENTSUB
// ════════════════════════════════════════════════════════════════════════════════

const MAX_TWITCH_ACCOUNTS = 10;

function getTwAccounts(db, guildId) {
    try { return JSON.parse(db.get(`twitch-accounts-${guildId}`) || '[]'); }
    catch { return []; }
}
function setTwAccounts(db, guildId, accounts) {
    db.set(`twitch-accounts-${guildId}`, JSON.stringify(accounts));
}

// POST /api/guild/:guildId/twitch/lookup
router.post('/guild/:guildId/twitch/lookup', requireLogin, requireManageGuild, async (req, res) => {
    const { input } = req.body;
    if (!input?.trim()) return res.json({ success: false, message: 'Input cannot be empty.' });

    const notifier = req.discordClient?.twitchNotifier;
    if (!notifier) return res.json({ success: false, message: 'TwitchNotifier is not available.' });
    if (!notifier.isConfigured) return res.json({ success: false, message: 'Twitch is not configured. Set TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, and BASE_URL in .env.' });

    try {
        const user = await notifier.lookupUser(input);
        res.json({ success: true, user });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// POST /api/guild/:guildId/twitch/accounts — tambah akun
router.post('/guild/:guildId/twitch/accounts', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { userId, login, displayName, thumbnail } = req.body;
    if (!userId || !login) return res.json({ success: false, message: 'Invalid account data.' });

    const accounts = getTwAccounts(db, guildId);
    if (accounts.length >= MAX_TWITCH_ACCOUNTS)
        return res.json({ success: false, message: `Maximum ${MAX_TWITCH_ACCOUNTS} Twitch accounts per server.` });
    if (accounts.find(a => a.userId === userId))
        return res.json({ success: false, message: `Account "${login}" has already been added.` });

    accounts.push({
        userId, login, displayName, thumbnail: thumbnail || null,
        enabled: false, channelId: '', message: '',
    });
    setTwAccounts(db, guildId, accounts);

    // Subscribe EventSub
    const notifier = req.discordClient?.twitchNotifier;
    if (notifier?.isConfigured) {
        notifier.subscribeUser(userId).catch(err => console.warn('[Twitch] subscribe error:', err.message));
    }

    res.json({ success: true, message: `Account "${displayName || login}" added successfully.` });
});

// PUT /api/guild/:guildId/twitch/accounts/:userId — update settings
router.put('/guild/:guildId/twitch/accounts/:userId', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const userId  = req.params.userId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { enabled, channelId, message } = req.body;
    const accounts = getTwAccounts(db, guildId);
    const idx = accounts.findIndex(a => a.userId === userId);
    if (idx === -1) return res.json({ success: false, message: 'Account not found.' });

    if (enabled && !channelId)
        return res.json({ success: false, message: 'Notification is enabled but no Discord channel has been selected.' });

    accounts[idx] = {
        ...accounts[idx],
        enabled:   !!enabled,
        channelId: channelId || '',
        message:   (message || '').trim(),
    };
    setTwAccounts(db, guildId, accounts);
    res.json({ success: true, message: 'Settings saved successfully.' });
});

// POST /api/guild/:guildId/twitch/accounts/:userId/test — test notifikasi
router.post('/guild/:guildId/twitch/accounts/:userId/test', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const userId  = req.params.userId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const accounts = getTwAccounts(db, guildId);
    const account  = accounts.find(a => a.userId === userId);
    if (!account)         return res.json({ success: false, message: 'Account not found.' });
    if (!account.enabled) return res.json({ success: false, message: 'Notification is not enabled.' });
    if (!account.channelId) return res.json({ success: false, message: 'Discord channel has not been selected.' });

    const notifier = req.discordClient?.twitchNotifier;
    if (!notifier) return res.json({ success: false, message: 'TwitchNotifier is not available.' });

    try {
        await notifier.sendTestNotification(req.botGuild, account);
        res.json({ success: true, message: 'Test notification successfully sent!' });
    } catch (err) {
        res.json({ success: false, message: `Failed: ${err.message}` });
    }
});

// DELETE /api/guild/:guildId/twitch/accounts/:userId — hapus akun
router.delete('/guild/:guildId/twitch/accounts/:userId', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const userId  = req.params.userId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const accounts = getTwAccounts(db, guildId);
    const account  = accounts.find(a => a.userId === userId);
    if (!account) return res.json({ success: false, message: 'Account not found.' });

    setTwAccounts(db, guildId, accounts.filter(a => a.userId !== userId));
    db.delete(`twitch-live-${guildId}-${userId}`);

    // Periksa apakah userId ini masih dipantau di guild lain sebelum unsubscribe
    const stillNeeded = [...req.discordClient.guilds.cache.values()].some(g => {
        if (g.id === guildId) return false;
        const accs = getTwAccounts(db, g.id);
        return accs.some(a => a.userId === userId);
    });

    if (!stillNeeded) {
        const notifier = req.discordClient?.twitchNotifier;
        if (notifier?.isConfigured) {
            notifier.unsubscribeUser(userId).catch(err => console.warn('[Twitch] unsubscribe error:', err.message));
        }
    }

    res.json({ success: true, message: `Account "${account.displayName || account.login}" deleted successfully.` });
});

// ════════════════════════════════════════════════════════════════════════════════
// GIVEAWAY
// ════════════════════════════════════════════════════════════════════════════════

// POST /api/guild/:guildId/giveaway — buat giveaway baru
router.post('/guild/:guildId/giveaway', requireLogin, requireManageGuild, async (req, res) => {
    const guildId = req.params.guildId;
    const manager = req.discordClient?.giveawayManager;
    if (!manager) return res.status(500).json({ success: false, message: 'GiveawayManager is not available.' });

    const { channelId, prize, durationMs, winnerCount, requiredRoleId } = req.body;

    if (!channelId)          return res.json({ success: false, message: 'Please select a channel first.' });
    if (!prize?.trim())      return res.json({ success: false, message: 'Prize cannot be empty.' });
    if (!durationMs || durationMs < 10_000)
        return res.json({ success: false, message: 'Minimum duration is 10 seconds.' });
    if (!winnerCount || winnerCount < 1 || winnerCount > 20)
        return res.json({ success: false, message: 'Winner count must be between 1–20.' });

    try {
        const gw = await manager.createGiveaway({
            guildId,
            channelId,
            prize:          prize.trim(),
            durationMs:     Number(durationMs),
            winnerCount:    Number(winnerCount),
            hostId:         req.user?.id || null,
            requiredRoleId: requiredRoleId || null,
        });
        res.json({ success: true, message: `Giveaway "${gw.prize}" created successfully!`, id: gw.id });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// POST /api/guild/:guildId/giveaway/:id/end — end giveaway sekarang
router.post('/guild/:guildId/giveaway/:id/end', requireLogin, requireManageGuild, async (req, res) => {
    const manager = req.discordClient?.giveawayManager;
    if (!manager) return res.status(500).json({ success: false, message: 'GiveawayManager is not available.' });

    const gw = manager._get(req.params.id);
    if (!gw || gw.guildId !== req.params.guildId)
        return res.json({ success: false, message: 'Giveaway not found.' });
    if (gw.ended) return res.json({ success: false, message: 'Giveaway has already ended.' });

    try {
        await manager.endGiveaway(req.params.id);
        res.json({ success: true, message: 'Giveaway ended successfully.' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// POST /api/guild/:guildId/giveaway/:id/reroll — reroll pemenang
router.post('/guild/:guildId/giveaway/:id/reroll', requireLogin, requireManageGuild, async (req, res) => {
    const manager = req.discordClient?.giveawayManager;
    if (!manager) return res.status(500).json({ success: false, message: 'GiveawayManager is not available.' });

    const gw = manager._get(req.params.id);
    if (!gw || gw.guildId !== req.params.guildId)
        return res.json({ success: false, message: 'Giveaway not found.' });

    try {
        const winners = await manager.rerollGiveaway(req.params.id);
        res.json({ success: true, message: `Reroll complete! ${winners.length} new winner(s) selected.` });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// POST /api/guild/:guildId/giveaway/:id/remove — hapus permanen dari riwayat
router.post('/guild/:guildId/giveaway/:id/remove', requireLogin, requireManageGuild, async (req, res) => {
    const manager = req.discordClient?.giveawayManager;
    if (!manager) return res.status(500).json({ success: false, message: 'GiveawayManager is not available.' });

    const gw = manager._get(req.params.id);
    if (!gw || gw.guildId !== req.params.guildId)
        return res.json({ success: false, message: 'Giveaway not found.' });

    try {
        manager.deleteGiveaway(req.params.id);
        res.json({ success: true, message: 'Giveaway deleted from history successfully.' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// DELETE /api/guild/:guildId/giveaway/:id — cancel giveaway
router.delete('/guild/:guildId/giveaway/:id', requireLogin, requireManageGuild, async (req, res) => {
    const manager = req.discordClient?.giveawayManager;
    if (!manager) return res.status(500).json({ success: false, message: 'GiveawayManager is not available.' });

    const gw = manager._get(req.params.id);
    if (!gw || gw.guildId !== req.params.guildId)
        return res.json({ success: false, message: 'Giveaway not found.' });

    try {
        await manager.cancelGiveaway(req.params.id);
        res.json({ success: true, message: 'Giveaway cancelled successfully.' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// KICK NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════════════════

const MAX_KICK_ACCOUNTS = 10;

function getKickAccounts(db, guildId) {
    try { return JSON.parse(db.get(`kick-accounts-${guildId}`) || '[]'); } catch { return []; }
}
function setKickAccounts(db, guildId, accounts) {
    db.set(`kick-accounts-${guildId}`, JSON.stringify(accounts));
}

// POST /api/guild/:guildId/kick/lookup — cari channel Kick
router.post('/guild/:guildId/kick/lookup', requireLogin, requireManageGuild, async (req, res) => {
    const { input } = req.body;
    if (!input?.trim()) return res.json({ success: false, message: 'Input cannot be empty.' });

    const notifier = req.discordClient?.kickNotifier;
    if (!notifier) return res.status(500).json({ success: false, message: 'KickNotifier is not available.' });

    try {
        const channel = await notifier.lookupChannel(input.trim());
        res.json({ success: true, channel });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// POST /api/guild/:guildId/kick/accounts — tambah akun
router.post('/guild/:guildId/kick/accounts', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { slug, displayName, thumbnail, userId } = req.body;
    if (!slug) return res.json({ success: false, message: 'Slug cannot be empty.' });

    const accounts = getKickAccounts(db, guildId);
    if (accounts.length >= MAX_KICK_ACCOUNTS)
        return res.json({ success: false, message: `Maximum ${MAX_KICK_ACCOUNTS} Kick accounts per server.` });
    if (accounts.find(a => a.slug === slug))
        return res.json({ success: false, message: 'This account has already been added.' });

    accounts.push({
        slug,
        userId:      userId      || null,
        displayName: displayName || slug,
        thumbnail:   thumbnail   || null,
        enabled:     false,
        channelId:   '',
        message:     '',
        addedAt:     Date.now(),
    });
    setKickAccounts(db, guildId, accounts);
    res.json({ success: true, message: `Channel "${slug}" added successfully.` });
});

// PUT /api/guild/:guildId/kick/accounts/:slug — update settings
router.put('/guild/:guildId/kick/accounts/:slug', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const slug    = decodeURIComponent(req.params.slug);
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const accounts = getKickAccounts(db, guildId);
    const idx      = accounts.findIndex(a => a.slug === slug);
    if (idx === -1) return res.json({ success: false, message: 'Account not found.' });

    const { enabled, channelId, message } = req.body;
    const guild = req.botGuild;

    if (enabled && !channelId)
        return res.json({ success: false, message: 'Notification is enabled but no Discord channel has been selected.' });
    if (enabled && channelId && !guild.channels.cache.get(channelId))
        return res.json({ success: false, message: 'Discord channel not found.' });

    if (enabled && channelId) {
        const missing = missingChannelPerms(guild, channelId, [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.EmbedLinks,
        ]);
        if (missing.length)
            return res.json({ success: false, message: `Bot lacks permission:\n${missing.map(p => `• ${p}`).join('\n')}` });
    }

    accounts[idx] = { ...accounts[idx], enabled: !!enabled, channelId: channelId || '', message: message || '' };
    setKickAccounts(db, guildId, accounts);

    // Auto-refresh thumbnail di background
    const notifier = req.discordClient?.kickNotifier;
    if (notifier) {
        notifier.lookupChannel(slug).then(info => {
            const accs = getKickAccounts(db, guildId);
            const i = accs.findIndex(a => a.slug === slug);
            if (i !== -1) {
                accs[i] = {
                    ...accs[i],
                    userId:      info.userId      || accs[i].userId,
                    displayName: info.displayName || accs[i].displayName,
                    thumbnail:   info.thumbnail   || accs[i].thumbnail,
                };
                setKickAccounts(db, guildId, accs);
            }
        }).catch(() => {});
    }

    res.json({ success: true, message: 'Settings saved successfully.' });
});

// POST /api/guild/:guildId/kick/accounts/:slug/test — kirim test notifikasi
router.post('/guild/:guildId/kick/accounts/:slug/test', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const slug    = decodeURIComponent(req.params.slug);
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const notifier = req.discordClient?.kickNotifier;
    if (!notifier) return res.status(500).json({ success: false, message: 'KickNotifier is not available.' });

    const accounts = getKickAccounts(db, guildId);
    const account  = accounts.find(a => a.slug === slug);
    if (!account) return res.json({ success: false, message: 'Account not found.' });
    if (!account.channelId) return res.json({ success: false, message: 'Discord channel has not been selected.' });

    const guild = req.botGuild;
    try {
        await notifier.sendTestNotification(guild, account);
        res.json({ success: true, message: 'Test notification successfully sent!' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// DELETE /api/guild/:guildId/kick/accounts/:slug — hapus akun
router.delete('/guild/:guildId/kick/accounts/:slug', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const slug    = decodeURIComponent(req.params.slug);
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const accounts = getKickAccounts(db, guildId);
    const account  = accounts.find(a => a.slug === slug);
    if (!account) return res.json({ success: false, message: 'Account not found.' });

    const notifier = req.discordClient?.kickNotifier;
    if (notifier) {
        db.delete(`kick-live-${guildId}-${slug}`);
        notifier._liveSessions?.delete(`${guildId}:${slug}`);
    }

    setKickAccounts(db, guildId, accounts.filter(a => a.slug !== slug));
    res.json({ success: true, message: `Channel "${slug}" deleted successfully.` });
});

// ════════════════════════════════════════════════════════════════════════════
// AUTOMOD
// Key database sama persis dengan slashcommand-automod.js
// ════════════════════════════════════════════════════════════════════════════

function getAutomodJSON(db, key, def) {
    const raw = db?.get(key);
    if (!raw) return def;
    try { return JSON.parse(raw); } catch { return def; }
}

// ── POST /api/guild/:guildId/automod/general ──────────────────────────────────
router.post('/guild/:guildId/automod/general', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { action, muteDuration, auditLogId } = req.body;

    const validActions = ['delete', 'warn', 'mute', 'kick', 'ban'];
    if (action && !validActions.includes(action)) {
        return res.status(400).json({ success: false, message: 'Invalid action.' });
    }

    const validDurations = [60000, 300000, 600000, 1800000, 3600000, 86400000];
    if (muteDuration !== undefined && !validDurations.includes(Number(muteDuration))) {
        return res.status(400).json({ success: false, message: 'Invalid timeout duration.' });
    }

    if (auditLogId) {
        if (!req.botGuild.channels.cache.get(auditLogId)) {
            return res.status(400).json({ success: false, message: 'Log channel not found.' });
        }
        const missing = missingChannelPerms(req.botGuild, auditLogId, [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.EmbedLinks,
        ]);
        if (missing.length) {
            return res.status(400).json({ success: false, message: `Bot butuh permission di channel log:\n${missing.map(p => `• ${p}`).join('\n')}` });
        }
    }

    if (action)        db.set(`automod-action-${guildId}`,        action);
    if (muteDuration)  db.set(`automod-mute-duration-${guildId}`, String(muteDuration));
    if (auditLogId)    db.set(`automod-auditlog-${guildId}`,      auditLogId);
    else               db.delete(`automod-auditlog-${guildId}`);

    res.json({ success: true, message: 'General configuration saved successfully.' });
});

// ── POST /api/guild/:guildId/automod/antilink ─────────────────────────────────
router.post('/guild/:guildId/automod/antilink', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });
    setDbBool(db, `automod-antilink-${guildId}`, !!req.body.enabled);
    res.json({ success: true, message: `Anti-Link ${req.body.enabled ? 'enabled' : 'disabled'}.` });
});

// ── POST /api/guild/:guildId/automod/antiinvite ───────────────────────────────
router.post('/guild/:guildId/automod/antiinvite', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });
    setDbBool(db, `automod-antiinvite-${guildId}`, !!req.body.enabled);
    res.json({ success: true, message: `Anti-Invite ${req.body.enabled ? 'enabled' : 'disabled'}.` });
});

// ── POST /api/guild/:guildId/automod/attachments ──────────────────────────────
router.post('/guild/:guildId/automod/attachments', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });
    setDbBool(db, `automod-attachments-${guildId}`, !!req.body.enabled);
    res.json({ success: true, message: `Anti-Attachment ${req.body.enabled ? 'enabled' : 'disabled'}.` });
});

// ── POST /api/guild/:guildId/automod/spam ─────────────────────────────────────
router.post('/guild/:guildId/automod/spam', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const enabled  = !!req.body.enabled;
    const limit    = Math.min(20, Math.max(2, parseInt(req.body.limit)    || 5));
    const interval = Math.min(30, Math.max(1, parseInt(req.body.interval) || 5));

    const existing = getAutomodJSON(db, `automod-spam-${guildId}`, { enabled: false, limit: 5, interval: 5 });
    db.set(`automod-spam-${guildId}`, JSON.stringify({
        enabled,
        limit:    enabled ? limit    : existing.limit,
        interval: enabled ? interval : existing.interval,
    }));
    res.json({ success: true, message: `Anti-Spam ${enabled ? `enabled (max. ${limit} msg/${interval}s)` : 'disabled'}.` });
});

// ── POST /api/guild/:guildId/automod/massmention ──────────────────────────────
router.post('/guild/:guildId/automod/massmention', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const enabled = !!req.body.enabled;
    const limit   = Math.min(20, Math.max(2, parseInt(req.body.limit) || 5));

    const existing = getAutomodJSON(db, `automod-massmention-${guildId}`, { enabled: false, limit: 5 });
    db.set(`automod-massmention-${guildId}`, JSON.stringify({
        enabled,
        limit: enabled ? limit : existing.limit,
    }));
    res.json({ success: true, message: `Anti Mass-Mention ${enabled ? `enabled (max. ${limit} mention/msg)` : 'disabled'}.` });
});

// ── POST /api/guild/:guildId/automod/antiraid ─────────────────────────────────
router.post('/guild/:guildId/automod/antiraid', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const enabled   = !!req.body.enabled;
    const joinLimit = Math.min(50, Math.max(2,  parseInt(req.body.joinLimit) || 10));
    const interval  = Math.min(60, Math.max(5,  parseInt(req.body.interval)  || 10));

    const existing = getAutomodJSON(db, `automod-antiraid-${guildId}`, { enabled: false, joinLimit: 10, interval: 10 });
    db.set(`automod-antiraid-${guildId}`, JSON.stringify({
        enabled,
        joinLimit: enabled ? joinLimit : existing.joinLimit,
        interval:  enabled ? interval  : existing.interval,
    }));
    res.json({ success: true, message: `Anti-Raid ${enabled ? `enabled (max. ${joinLimit} join/${interval}s)` : 'disabled'}.` });
});

// ── POST /api/guild/:guildId/automod/words ────────────────────────────────────
router.post('/guild/:guildId/automod/words', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const word  = (req.body.word || '').toLowerCase().trim();
    if (!word)  return res.status(400).json({ success: false, message: 'Word cannot be empty.' });
    if (word.length > 50) return res.status(400).json({ success: false, message: 'Kata terlalu panjang (maks. 50 karakter).' });

    const words = getAutomodJSON(db, `automod-words-${guildId}`, []);
    if (words.includes(word)) return res.json({ success: false, message: `Word "${word}" is already in the list.` });
    if (words.length >= 100) return res.status(400).json({ success: false, message: 'List is full (max. 100 words).' });

    words.push(word);
    db.set(`automod-words-${guildId}`, JSON.stringify(words));
    res.json({ success: true, message: `Kata "${word}" ditambahkan.`, word, total: words.length });
});

// ── DELETE /api/guild/:guildId/automod/words/:word ────────────────────────────
router.delete('/guild/:guildId/automod/words/:word', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const word  = decodeURIComponent(req.params.word).toLowerCase().trim();
    const words = getAutomodJSON(db, `automod-words-${guildId}`, []);
    const idx   = words.indexOf(word);
    if (idx === -1) return res.status(404).json({ success: false, message: `Word "${word}" not found.` });

    words.splice(idx, 1);
    db.set(`automod-words-${guildId}`, JSON.stringify(words));
    res.json({ success: true, message: `Word "${word}" removed.`, total: words.length });
});

// ── POST /api/guild/:guildId/automod/whitelist ────────────────────────────────
router.post('/guild/:guildId/automod/whitelist', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { type, id } = req.body;
    if (!type || !id) return res.status(400).json({ success: false, message: 'type dan id diperlukan.' });

    if (type === 'channel') {
        if (!req.botGuild.channels.cache.get(id)) {
            return res.status(400).json({ success: false, message: 'Channel not found.' });
        }
        const list = getAutomodJSON(db, `automod-wl-channels-${guildId}`, []);
        if (list.includes(id)) return res.json({ success: false, message: 'Channel is already in the whitelist.' });
        list.push(id);
        db.set(`automod-wl-channels-${guildId}`, JSON.stringify(list));
        const ch = req.botGuild.channels.cache.get(id);
        return res.json({ success: true, message: `#${ch.name} ditambahkan ke whitelist.`, id, name: ch.name });
    }

    if (type === 'role') {
        if (!req.botGuild.roles.cache.get(id)) {
            return res.status(400).json({ success: false, message: 'Role not found.' });
        }
        const list = getAutomodJSON(db, `automod-wl-roles-${guildId}`, []);
        if (list.includes(id)) return res.json({ success: false, message: 'Role is already in the whitelist.' });
        list.push(id);
        db.set(`automod-wl-roles-${guildId}`, JSON.stringify(list));
        const role = req.botGuild.roles.cache.get(id);
        return res.json({ success: true, message: `@${role.name} ditambahkan ke whitelist.`, id, name: role.name, color: role.hexColor !== '#000000' ? role.hexColor : null });
    }

    res.status(400).json({ success: false, message: 'Invalid type. Use "channel" or "role".' });
});

// ── DELETE /api/guild/:guildId/automod/whitelist/:type/:id ────────────────────
router.delete('/guild/:guildId/automod/whitelist/:type/:id', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { type, id } = req.params;

    if (type === 'channel') {
        const list = getAutomodJSON(db, `automod-wl-channels-${guildId}`, []);
        const idx  = list.indexOf(id);
        if (idx === -1) return res.status(404).json({ success: false, message: 'Channel is not in the whitelist.' });
        list.splice(idx, 1);
        db.set(`automod-wl-channels-${guildId}`, JSON.stringify(list));
        return res.json({ success: true, message: 'Channel removed from whitelist.' });
    }

    if (type === 'role') {
        const list = getAutomodJSON(db, `automod-wl-roles-${guildId}`, []);
        const idx  = list.indexOf(id);
        if (idx === -1) return res.status(404).json({ success: false, message: 'Role is not in the whitelist.' });
        list.splice(idx, 1);
        db.set(`automod-wl-roles-${guildId}`, JSON.stringify(list));
        return res.json({ success: true, message: 'Role removed from whitelist.' });
    }

    res.status(400).json({ success: false, message: 'Invalid type.' });
});

// ════════════════════════════════════════════════════════════════════════════
// WARNING SYSTEM
// ════════════════════════════════════════════════════════════════════════════

function getWarnJSON(db, key, def) {
    const raw = db.get(key);
    if (!raw) return def;
    try { return JSON.parse(raw); } catch { return def; }
}

// ── POST /api/guild/:guildId/warnings/config ──────────────────────────────────
router.post('/guild/:guildId/warnings/config', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { t1, t2 } = req.body;
    const validActions   = ['none', 'mute', 'kick', 'ban'];
    const validDurations = [60000, 300000, 600000, 1800000, 3600000, 86400000];
    const thresholds     = [];

    for (const [label, t] of [['Threshold 1', t1], ['Threshold 2', t2]]) {
        if (!t || !t.action || t.action === 'none') continue;
        const count = parseInt(t.count);
        if (!count || count < 1 || count > 20)
            return res.status(400).json({ success: false, message: `${label}: warn count must be between 1–20.` });
        if (!validActions.includes(t.action))
            return res.status(400).json({ success: false, message: `${label}: invalid action.` });
        const entry = { count, action: t.action };
        if (t.action === 'mute') {
            const dur = parseInt(t.duration);
            if (!validDurations.includes(dur))
                return res.status(400).json({ success: false, message: `${label}: invalid timeout duration.` });
            entry.duration = dur;
        }
        thresholds.push(entry);
    }

    const counts = thresholds.map(t => t.count);
    if (new Set(counts).size !== counts.length)
        return res.status(400).json({ success: false, message: 'The two threshold warn counts cannot be the same.' });

    db.set(`warn-config-${guildId}`, JSON.stringify({ thresholds }));
    res.json({ success: true, message: 'Threshold configuration saved successfully.' });
});

// ── GET /api/guild/:guildId/warnings/user/:userId ─────────────────────────────
router.get('/guild/:guildId/warnings/user/:userId', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const userId  = req.params.userId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const warns  = getWarnJSON(db, `warn-${guildId}-${userId}`, []);
    const member = req.botGuild.members.cache.get(userId);
    const tag    = member?.user.tag ?? warns[0]?.targetTag ?? `ID: ${userId}`;
    const avatar = member?.user.displayAvatarURL({ size: 64 }) ?? null;

    res.json({ success: true, warns, tag, avatar, total: warns.length });
});

// ── DELETE /api/guild/:guildId/warnings/user/:userId ──────────────────────────
router.delete('/guild/:guildId/warnings/user/:userId', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const userId  = req.params.userId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const warns = getWarnJSON(db, `warn-${guildId}-${userId}`, []);
    if (warns.length === 0)
        return res.status(404).json({ success: false, message: 'This user has no warnings.' });

    db.delete(`warn-${guildId}-${userId}`);
    res.json({ success: true, message: `All ${warns.length} warnings deleted.`, total: 0 });
});

// ── DELETE /api/guild/:guildId/warnings/user/:userId/:warnId ─────────────────
router.delete('/guild/:guildId/warnings/user/:userId/:warnId', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const userId  = req.params.userId;
    const warnId  = req.params.warnId.toUpperCase();
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const warns = getWarnJSON(db, `warn-${guildId}-${userId}`, []);
    const idx   = warns.findIndex(w => w.id === warnId);
    if (idx === -1)
        return res.status(404).json({ success: false, message: `Warning \`${warnId}\` not found.` });

    warns.splice(idx, 1);
    if (warns.length === 0) {
        db.delete(`warn-${guildId}-${userId}`);
    } else {
        db.set(`warn-${guildId}-${userId}`, JSON.stringify(warns));
    }
    res.json({ success: true, message: `Warning \`${warnId}\` deleted.`, total: warns.length });
});

// ════════════════════════════════════════════════════════════════════════════
// MOD LOG
// ════════════════════════════════════════════════════════════════════════════

// ── POST /api/guild/:guildId/modlog/config ────────────────────────────────────
router.post('/guild/:guildId/modlog/config', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { channelId, events } = req.body;

    if (channelId) {
        if (!req.botGuild.channels.cache.get(channelId))
            return res.status(400).json({ success: false, message: 'Channel not found.' });

        const missing = missingChannelPerms(req.botGuild, channelId, [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.EmbedLinks,
        ]);
        if (missing.length)
            return res.status(400).json({ success: false, message: `Bot lacks permission in the channel:\n${missing.map(p => `• ${p}`).join('\n')}` });

        db.set(`modlog-channel-${guildId}`, channelId);
    } else {
        db.delete(`modlog-channel-${guildId}`);
    }

    const VALID_EVENTS = ['ban', 'unban', 'kick', 'timeout', 'warn'];
    const evtObj = {};
    for (const k of VALID_EVENTS) {
        evtObj[k] = events && events[k] !== undefined ? !!events[k] : true;
    }
    db.set(`modlog-events-${guildId}`, JSON.stringify(evtObj));

    res.json({ success: true, message: 'Mod Log configuration saved successfully.' });
});

// ══════════════════════════════════════════════════════════════════════════════
// SERVER-SENT EVENTS — live guild stats
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/guild/:guildId/stats/stream
// Streams memberCount, bot ping, and active ticket count every 30 seconds.
router.get('/guild/:guildId/stats/stream', requireLogin, requireManageGuild, (req, res) => {
    const guild  = req.botGuild;
    const client = req.discordClient;
    const db     = client?.database;

    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    function getStats() {
        let activeTickets = 0;
        try {
            const raw = db?.get(`ticket-open-list-${guild.id}`);
            activeTickets = raw ? JSON.parse(raw).length : 0;
        } catch { /* ignore parse error */ }
        return {
            memberCount:   guild.memberCount,
            ping:          client?.ws?.ping ?? -1,
            activeTickets,
        };
    }

    function send(data) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    send(getStats());
    const timer = setInterval(() => send(getStats()), 30_000);
    req.on('close', () => clearInterval(timer));
});

// ── POST /api/guild/:guildId/level ────────────────────────────────────────────
router.post('/guild/:guildId/level', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { enabled, channelId, message, xpMin, xpMax, cooldown, roleRewards } = req.body;

    if (channelId && !req.botGuild.channels.cache.get(channelId))
        return res.status(400).json({ success: false, message: 'Channel not found.' });

    setDbBool(db, `level-enabled-${guildId}`, !!enabled);
    if (channelId) db.set(`level-channel-${guildId}`, channelId); else db.delete(`level-channel-${guildId}`);
    db.set(`level-message-${guildId}`,  (message  || 'Congratulations {member}, you leveled up to Level **{level}**! 🎉').slice(0, 500));
    db.set(`level-xpMin-${guildId}`,    String(Math.max(1, Math.min(100,  parseInt(xpMin)    || 15))));
    db.set(`level-xpMax-${guildId}`,    String(Math.max(1, Math.min(100,  parseInt(xpMax)    || 25))));
    db.set(`level-cooldown-${guildId}`, String(Math.max(0, Math.min(3600, parseInt(cooldown)  || 60))));

    if (Array.isArray(roleRewards)) {
        const clean = roleRewards
            .filter(r => r.roleId && /^\d{17,20}$/.test(r.roleId))
            .map(r => ({ level: Math.max(1, parseInt(r.level) || 1), roleId: r.roleId }));
        db.set(`level-roles-${guildId}`, JSON.stringify(clean));
    }

    guildCache.del(`level-cfg-${guildId}`);
    res.json({ success: true, message: 'Level settings saved successfully.' });
});

// ── POST /api/guild/:guildId/starboard ────────────────────────────────────────
router.post('/guild/:guildId/starboard', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { enabled, channelId, emoji, threshold } = req.body;

    if (!channelId) return res.status(400).json({ success: false, message: 'A channel must be selected.' });
    if (!req.botGuild.channels.cache.get(channelId))
        return res.status(400).json({ success: false, message: 'Channel not found.' });

    setDbBool(db, `starboard-enabled-${guildId}`, !!enabled);
    db.set(`starboard-channel-${guildId}`,   channelId);
    db.set(`starboard-emoji-${guildId}`,     (emoji || '⭐').slice(0, 10));
    db.set(`starboard-threshold-${guildId}`, String(Math.max(1, Math.min(50, parseInt(threshold) || 3))));

    res.json({ success: true, message: 'Starboard settings saved successfully.' });
});

// ── POST /api/guild/:guildId/custom-commands ──────────────────────────────────
router.post('/guild/:guildId/custom-commands', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { commands } = req.body;
    if (!Array.isArray(commands))
        return res.status(400).json({ success: false, message: 'Invalid commands format.' });

    const clean = commands.filter(c => c.trigger && typeof c.trigger === 'string').map(c => ({
        trigger:      String(c.trigger).trim().slice(0, 50),
        mode:         ['prefix', 'exact'].includes(c.mode) ? c.mode : 'prefix',
        responseType: ['plain', 'embed', 'both'].includes(c.responseType) ? c.responseType : 'plain',
        response:     c.response || {},
        enabled:      c.enabled !== false,
    }));

    if (clean.length > 10)
        return res.status(400).json({ success: false, message: 'Maximum 10 custom commands per server.' });

    db.set(`customcmd-list-${guildId}`, JSON.stringify(clean));
    guildCache.del(`customcmd-list-${guildId}`);

    res.json({ success: true, message: 'Custom commands saved successfully.' });
});

// ── POST /api/guild/:guildId/extlog ───────────────────────────────────────────
router.post('/guild/:guildId/extlog', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    if (!db) return res.status(500).json({ success: false, message: 'Database not available.' });

    const { enabled, channelId, events } = req.body;

    if (enabled && !channelId)
        return res.status(400).json({ success: false, message: 'A log channel must be selected when logging is enabled.' });
    if (channelId && !req.botGuild.channels.cache.get(channelId))
        return res.status(400).json({ success: false, message: 'Channel not found.' });

    setDbBool(db, `extlog-enabled-${guildId}`, !!enabled);
    if (channelId) db.set(`extlog-channel-${guildId}`, channelId); else db.delete(`extlog-channel-${guildId}`);

    if (events && typeof events === 'object') {
        const safe = {
            messageEdit:    !!events.messageEdit,
            messageDelete:  !!events.messageDelete,
            voiceActivity:  !!events.voiceActivity,
            nicknameChange: !!events.nicknameChange,
            roleChange:     !!events.roleChange,
        };
        db.set(`extlog-events-${guildId}`, JSON.stringify(safe));
    }

    res.json({ success: true, message: 'Extended logging settings saved successfully.' });
});

module.exports = router;

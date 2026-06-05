/**
 * routes/api.js
 * REST API untuk menyimpan settings dari dashboard ke database bot.
 * Key database disesuaikan dengan yang dipakai slashcommand-welcome.js & slashcommand-goodbye.js
 * Semua endpoint return JSON.
 */

const express              = require('express');
const { PermissionsBitField } = require('discord.js');
const router  = express.Router();

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

    // Channel wajib diisi
    if (!channelId) return res.status(400).json({ success: false, message: 'Channel tujuan wajib dipilih.' });
    if (!req.botGuild.channels.cache.get(channelId)) return res.status(400).json({ success: false, message: 'Channel tidak ditemukan.' });

    // Cek permission bot di channel welcome
    const wpMissing = missingChannelPerms(req.botGuild, channelId, [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.AttachFiles,
    ]);
    if (wpMissing.length) return res.status(400).json({ success: false, message: `Bot tidak punya permission di channel ini:\n${wpMissing.map(p => `• ${p}`).join('\n')}` });

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

    // Channel wajib diisi
    if (!channelId) return res.status(400).json({ success: false, message: 'Channel tujuan wajib dipilih.' });
    if (!req.botGuild.channels.cache.get(channelId)) return res.status(400).json({ success: false, message: 'Channel tidak ditemukan.' });

    // Cek permission bot di channel goodbye
    const gbMissing = missingChannelPerms(req.botGuild, channelId, [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.AttachFiles,
    ]);
    if (gbMissing.length) return res.status(400).json({ success: false, message: `Bot tidak punya permission di channel ini:\n${gbMissing.map(p => `• ${p}`).join('\n')}` });

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

    const arjMissing = missingGlobalPerms(req.botGuild, [PermissionsBitField.Flags.ManageRoles]);
    if (arjMissing.length) return res.json({ success: false, message: `Bot tidak punya permission:\n${arjMissing.map(p => `• ${p}`).join('\n')}` });

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

    if (!channelId) return res.json({ success: false, message: 'Channel tujuan wajib dipilih.' });
    if (!req.botGuild.channels.cache.get(channelId)) return res.json({ success: false, message: 'Channel tidak ditemukan.' });

    const boostMissing = missingChannelPerms(req.botGuild, channelId, [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.AttachFiles,
    ]);
    if (boostMissing.length) return res.json({ success: false, message: `Bot tidak punya permission di channel ini:\n${boostMissing.map(p => `• ${p}`).join('\n')}` });

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

    if (!channelId) return res.json({ success: false, message: 'Channel tujuan wajib dipilih.' });
    if (!req.botGuild.channels.cache.get(channelId)) return res.json({ success: false, message: 'Channel tidak ditemukan.' });

    const unboostMissing = missingChannelPerms(req.botGuild, channelId, [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.AttachFiles,
    ]);
    if (unboostMissing.length) return res.json({ success: false, message: `Bot tidak punya permission di channel ini:\n${unboostMissing.map(p => `• ${p}`).join('\n')}` });

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

    const arbMissing = missingGlobalPerms(req.botGuild, [PermissionsBitField.Flags.ManageRoles]);
    if (arbMissing.length) return res.json({ success: false, message: `Bot tidak punya permission:\n${arbMissing.map(p => `• ${p}`).join('\n')}` });

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
    if (tkMissing.length) return res.json({ success: false, message: `Bot tidak punya permission untuk ticket:\n${tkMissing.map(p => `• ${p}`).join('\n')}` });

    if (enabled) db.set(`ticket-enabled-${guildId}`, '1');
    else         db.delete(`ticket-enabled-${guildId}`);

    if (categoryId)   db.set(`ticket-category-${guildId}`, categoryId);
    else              db.delete(`ticket-category-${guildId}`);

    if (logChannelId) db.set(`ticket-log-channel-${guildId}`, logChannelId);
    else              db.delete(`ticket-log-channel-${guildId}`);

    db.set(`ticket-staff-roles-${guildId}`, JSON.stringify(Array.isArray(staffRoles) ? staffRoles : []));

    res.json({ success: true, message: 'Konfigurasi tiket berhasil disimpan.' });
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

    res.json({ success: true, message: 'Tampilan panel berhasil disimpan.' });
});

// ── POST /api/guild/:guildId/ticket/send-panel ────────────────────────────
router.post('/guild/:guildId/ticket/send-panel', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const client  = req.discordClient;
    const guildId = req.params.guildId;
    const { channelId } = req.body;

    if (!channelId) return res.json({ success: false, message: 'Channel tidak dipilih.' });

    try {
        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const guild   = client?.guilds.cache.get(guildId);
        const channel = await guild?.channels.fetch(channelId).catch(() => null);
        if (!channel) return res.json({ success: false, message: 'Channel tidak ditemukan.' });

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
        const desc     = db?.get(`ticket-embed-desc-${guildId}`)      || 'Klik tombol di bawah untuk membuat tiket.';
        const colorRaw = db?.get(`ticket-embed-color-${guildId}`)     || '#5865F2';
        const btnLabel = db?.get(`ticket-embed-btn-label-${guildId}`) || '📩 Buat Ticket';
        const color    = colorRaw.startsWith('#') ? colorRaw : `#${colorRaw}`;

        const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc);
        const row   = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket-open').setLabel(btnLabel).setStyle(ButtonStyle.Primary)
        );

        const sent = await channel.send({ embeds: [embed], components: [row] });
        db?.set(`ticket-panel-msg-${guildId}`, JSON.stringify({ messageId: sent.id, channelId: channel.id }));
        db?.set(`ticket-panel-channel-${guildId}`, channel.id);

        res.json({ success: true, message: `Panel berhasil dikirim ke #${channel.name}!` });
    } catch (err) {
        console.error('[ticket/send-panel]', err);
        res.json({ success: false, message: 'Gagal mengirim panel. Cek permission bot.' });
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

    const ssMissing = missingGlobalPerms(guild, [PermissionsBitField.Flags.ManageChannels]);
    if (ssMissing.length) return res.json({ success: false, message: `Bot tidak punya permission untuk membuat channel statistik:\n${ssMissing.map(p => `• ${p}`).join('\n')}` });

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
    if (!input?.trim()) return res.json({ success: false, message: 'Input tidak boleh kosong.' });

    const notifier = req.discordClient?.youtubeNotifier;
    if (!notifier) return res.json({ success: false, message: 'YouTubeNotifier tidak tersedia. Pastikan bot sudah terhubung ke Discord.' });

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
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const { id, name, thumbnail, handle } = req.body;
    if (!id || !name) return res.json({ success: false, message: 'Data channel tidak lengkap.' });

    const channels = getYtChannels(db, guildId);
    if (channels.length >= MAX_YT_CHANNELS)
        return res.json({ success: false, message: `Maksimal ${MAX_YT_CHANNELS} channel YouTube per server.` });
    if (channels.find(c => c.id === id))
        return res.json({ success: false, message: 'Channel ini sudah ditambahkan.' });

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
    if (notifier) notifier.subscribe(id).catch(() => {});

    res.json({ success: true, message: `Channel "${name}" berhasil ditambahkan.` });
});

// PUT /api/guild/:guildId/youtube/channels/:ytChannelId — update settings notif
router.put('/guild/:guildId/youtube/channels/:ytChannelId', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const ytId    = req.params.ytChannelId;
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const channels = getYtChannels(db, guildId);
    const idx      = channels.findIndex(c => c.id === ytId);
    if (idx === -1) return res.json({ success: false, message: 'Channel tidak ditemukan.' });

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
            return res.json({ success: false, message: `Notifikasi ${label} diaktifkan tapi channel Discord belum dipilih.` });
        }

        // Cek channel ada di server
        if (!guild.channels.cache.get(chId)) {
            return res.json({ success: false, message: `Channel Discord untuk notifikasi ${label} tidak ditemukan.` });
        }

        // Cek permission bot di channel tersebut
        const missing = missingChannelPerms(guild, chId, REQUIRED_PERMS);
        if (missing.length) {
            return res.json({
                success: false,
                message: `Bot tidak punya permission di channel notifikasi ${label}:\n${missing.map(p => `• ${p}`).join('\n')}`,
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
    res.json({ success: true, message: 'Pengaturan notifikasi berhasil disimpan.' });
});

// POST /api/guild/:guildId/youtube/channels/:ytChannelId/test — kirim test notif
router.post('/guild/:guildId/youtube/channels/:ytChannelId/test', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const ytId    = req.params.ytChannelId;
    const { type } = req.body;

    if (!['video', 'short', 'live'].includes(type)) {
        return res.json({ success: false, message: 'Tipe tidak valid.' });
    }

    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const channels = getYtChannels(db, guildId);
    const ytCh     = channels.find(c => c.id === ytId);
    if (!ytCh) return res.json({ success: false, message: 'Channel tidak ditemukan.' });

    const notifier = req.discordClient?.youtubeNotifier;
    if (!notifier) return res.json({ success: false, message: 'YouTubeNotifier tidak tersedia.' });

    const typeLabels = { video: 'Video', short: 'Short', live: 'Live' };
    const chIdKey    = { video: 'videoChannelId', short: 'shortChannelId', live: 'liveChannelId' };
    const enabledKey = { video: 'videoEnabled',   short: 'shortEnabled',   live: 'liveEnabled'   };

    if (!ytCh[enabledKey[type]]) {
        return res.json({ success: false, message: `Notifikasi ${typeLabels[type]} belum diaktifkan.` });
    }
    if (!ytCh[chIdKey[type]]) {
        return res.json({ success: false, message: `Channel Discord untuk ${typeLabels[type]} belum dipilih.` });
    }

    try {
        await notifier._sendNotification(req.botGuild, ytCh, type, {
            videoId:   'dQw4w9WgXcQ',
            url:       'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            title:     `[TEST] Contoh Notifikasi ${typeLabels[type]} dari ${ytCh.name}`,
            channel:   ytCh.name,
            thumbnail: null,
        });
        res.json({ success: true, message: `Test notifikasi ${typeLabels[type]} berhasil dikirim ke Discord!` });
    } catch (err) {
        res.json({ success: false, message: `Gagal kirim: ${err.message}` });
    }
});

// POST /api/guild/:guildId/youtube/force-poll — paksa poll sekarang
router.post('/guild/:guildId/youtube/force-poll', requireLogin, requireManageGuild, async (req, res) => {
    const notifier = req.discordClient?.youtubeNotifier;
    if (!notifier) return res.json({ success: false, message: 'YouTubeNotifier tidak tersedia.' });
    try {
        await notifier.pollGuild(req.params.guildId);
        res.json({ success: true, message: 'Poll selesai. Cek console bot untuk detailnya.' });
    } catch (err) {
        res.json({ success: false, message: `Gagal: ${err.message}` });
    }
});

// POST /api/guild/:guildId/youtube/channels/:ytChannelId/reset — reset last video ID
router.post('/guild/:guildId/youtube/channels/:ytChannelId/reset', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const ytId    = req.params.ytChannelId;
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const channels = getYtChannels(db, guildId);
    const ytCh     = channels.find(c => c.id === ytId);
    if (!ytCh) return res.json({ success: false, message: 'Channel tidak ditemukan.' });

    db.delete(`youtube-lastVideo-${guildId}-${ytId}`);
    res.json({ success: true, message: `Reset berhasil. Poll berikutnya akan inisialisasi ulang dari video terbaru "${ytCh.name}".` });
});

// DELETE /api/guild/:guildId/youtube/channels/:ytChannelId — hapus channel
router.delete('/guild/:guildId/youtube/channels/:ytChannelId', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const ytId    = req.params.ytChannelId;
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const channels = getYtChannels(db, guildId);
    const ch       = channels.find(c => c.id === ytId);
    if (!ch) return res.json({ success: false, message: 'Channel tidak ditemukan.' });

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

    res.json({ success: true, message: `Channel "${ch.name}" berhasil dihapus.` });
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
    if (!input?.trim()) return res.json({ success: false, message: 'Input tidak boleh kosong.' });

    const notifier = req.discordClient?.tiktokNotifier;
    if (!notifier) return res.json({ success: false, message: 'TikTokNotifier tidak tersedia.' });

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
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const { username, name, thumbnail } = req.body;
    if (!username) return res.json({ success: false, message: 'Username tidak boleh kosong.' });

    const accounts = getTtAccounts(db, guildId);
    if (accounts.length >= MAX_TT_ACCOUNTS)
        return res.json({ success: false, message: `Maksimal ${MAX_TT_ACCOUNTS} akun TikTok per server.` });
    if (accounts.find(a => a.username === username))
        return res.json({ success: false, message: 'Akun ini sudah ditambahkan.' });

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
    res.json({ success: true, message: `Akun "${username}" berhasil ditambahkan.` });
});

// PUT /api/guild/:guildId/tiktok/accounts/:username — update settings notifikasi
router.put('/guild/:guildId/tiktok/accounts/:username', requireLogin, requireManageGuild, (req, res) => {
    const db       = req.discordClient?.database;
    const guildId  = req.params.guildId;
    const username = decodeURIComponent(req.params.username);
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const accounts = getTtAccounts(db, guildId);
    const idx      = accounts.findIndex(a => a.username === username);
    if (idx === -1) return res.json({ success: false, message: 'Akun tidak ditemukan.' });

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
            return res.json({ success: false, message: `Notifikasi ${label} diaktifkan tapi channel Discord belum dipilih.` });
        if (!guild.channels.cache.get(chId))
            return res.json({ success: false, message: `Channel Discord untuk ${label} tidak ditemukan.` });
        const missing = missingChannelPerms(guild, chId, REQUIRED_PERMS);
        if (missing.length)
            return res.json({ success: false, message: `Bot tidak punya permission di channel ${label}:\n${missing.map(p => `• ${p}`).join('\n')}` });
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
    res.json({ success: true, message: 'Pengaturan berhasil disimpan.' });
});

// POST /api/guild/:guildId/tiktok/accounts/:username/test — kirim test notifikasi
router.post('/guild/:guildId/tiktok/accounts/:username/test', requireLogin, requireManageGuild, async (req, res) => {
    const db       = req.discordClient?.database;
    const guildId  = req.params.guildId;
    const username = decodeURIComponent(req.params.username);
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const { type = 'video' } = req.body;
    if (!['video', 'live'].includes(type))
        return res.json({ success: false, message: 'Tipe tidak valid.' });

    const accounts = getTtAccounts(db, guildId);
    const account  = accounts.find(a => a.username === username);
    if (!account) return res.json({ success: false, message: 'Akun tidak ditemukan.' });

    if (type === 'video') {
        if (!account.videoEnabled)   return res.json({ success: false, message: 'Notifikasi Video belum diaktifkan.' });
        if (!account.videoChannelId) return res.json({ success: false, message: 'Channel Discord untuk Video belum dipilih.' });
    } else {
        if (!account.liveEnabled)    return res.json({ success: false, message: 'Notifikasi Live belum diaktifkan.' });
        if (!account.liveChannelId)  return res.json({ success: false, message: 'Channel Discord untuk Live belum dipilih.' });
        const notifier = req.discordClient?.tiktokNotifier;
        if (!notifier?.liveSupported) return res.json({ success: false, message: 'Live detection tidak aktif. Jalankan: npm install tiktok-live-connector' });
    }

    const notifier = req.discordClient?.tiktokNotifier;
    if (!notifier) return res.json({ success: false, message: 'TikTokNotifier tidak tersedia.' });

    try {
        await notifier._sendNotification(req.botGuild, account, type, {
            id:    '0000000000000000000',
            url:   `https://www.tiktok.com/${username}/video/0000000000000000000`,
            title: `[TEST] Contoh Notifikasi ${type === 'live' ? 'Live' : 'Video'} dari ${account.name || username}`,
        });
        res.json({ success: true, message: `Test notifikasi ${type === 'live' ? 'Live' : 'Video'} berhasil dikirim!` });
    } catch (err) {
        res.json({ success: false, message: `Gagal kirim: ${err.message}` });
    }
});

// POST /api/guild/:guildId/tiktok/force-poll — paksa poll sekarang
router.post('/guild/:guildId/tiktok/force-poll', requireLogin, requireManageGuild, async (req, res) => {
    const notifier = req.discordClient?.tiktokNotifier;
    if (!notifier) return res.json({ success: false, message: 'TikTokNotifier tidak tersedia.' });
    try {
        await notifier.pollGuild(req.params.guildId);
        res.json({ success: true, message: 'Poll selesai.' });
    } catch (err) {
        res.json({ success: false, message: `Gagal: ${err.message}` });
    }
});

// POST /api/guild/:guildId/tiktok/accounts/:username/reset — reset last video
router.post('/guild/:guildId/tiktok/accounts/:username/reset', requireLogin, requireManageGuild, (req, res) => {
    const db       = req.discordClient?.database;
    const guildId  = req.params.guildId;
    const username = decodeURIComponent(req.params.username);
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const accounts = getTtAccounts(db, guildId);
    if (!accounts.find(a => a.username === username))
        return res.json({ success: false, message: 'Akun tidak ditemukan.' });

    db.delete(`tiktok-lastVideo-${guildId}-${username}`);
    res.json({ success: true, message: `Reset berhasil untuk ${username}.` });
});

// POST /api/guild/:guildId/tiktok/accounts/:username/refresh-thumbnail — perbarui thumbnail
router.post('/guild/:guildId/tiktok/accounts/:username/refresh-thumbnail', requireLogin, requireManageGuild, async (req, res) => {
    const db       = req.discordClient?.database;
    const guildId  = req.params.guildId;
    const username = decodeURIComponent(req.params.username);
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const accounts = getTtAccounts(db, guildId);
    const idx      = accounts.findIndex(a => a.username === username);
    if (idx === -1) return res.json({ success: false, message: 'Akun tidak ditemukan.' });

    const notifier = req.discordClient?.tiktokNotifier;
    if (!notifier) return res.status(500).json({ success: false, message: 'TikTokNotifier tidak tersedia.' });

    try {
        const info = await notifier.lookupAccount(username);
        accounts[idx] = { ...accounts[idx], thumbnail: info.thumbnail || accounts[idx].thumbnail };
        setTtAccounts(db, guildId, accounts);
        res.json({ success: true, message: 'Thumbnail berhasil diperbarui.', thumbnail: accounts[idx].thumbnail });
    } catch (err) {
        res.json({ success: false, message: `Gagal refresh thumbnail: ${err.message}` });
    }
});

// DELETE /api/guild/:guildId/tiktok/accounts/:username — hapus akun
router.delete('/guild/:guildId/tiktok/accounts/:username', requireLogin, requireManageGuild, (req, res) => {
    const db       = req.discordClient?.database;
    const guildId  = req.params.guildId;
    const username = decodeURIComponent(req.params.username);
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const accounts = getTtAccounts(db, guildId);
    const account  = accounts.find(a => a.username === username);
    if (!account) return res.json({ success: false, message: 'Akun tidak ditemukan.' });

    setTtAccounts(db, guildId, accounts.filter(a => a.username !== username));
    db.delete(`tiktok-lastVideo-${guildId}-${username}`);
    res.json({ success: true, message: `Akun "${username}" berhasil dihapus.` });
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
    if (!input?.trim()) return res.json({ success: false, message: 'Input tidak boleh kosong.' });

    const notifier = req.discordClient?.twitchNotifier;
    if (!notifier) return res.json({ success: false, message: 'TwitchNotifier tidak tersedia.' });
    if (!notifier.isConfigured) return res.json({ success: false, message: 'Twitch belum dikonfigurasi. Set TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, dan BASE_URL di .env.' });

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
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const { userId, login, displayName, thumbnail } = req.body;
    if (!userId || !login) return res.json({ success: false, message: 'Data akun tidak valid.' });

    const accounts = getTwAccounts(db, guildId);
    if (accounts.length >= MAX_TWITCH_ACCOUNTS)
        return res.json({ success: false, message: `Batas maksimal ${MAX_TWITCH_ACCOUNTS} akun Twitch per server.` });
    if (accounts.find(a => a.userId === userId))
        return res.json({ success: false, message: `Akun "${login}" sudah ditambahkan.` });

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

    res.json({ success: true, message: `Akun "${displayName || login}" berhasil ditambahkan.` });
});

// PUT /api/guild/:guildId/twitch/accounts/:userId — update settings
router.put('/guild/:guildId/twitch/accounts/:userId', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const userId  = req.params.userId;
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const { enabled, channelId, message } = req.body;
    const accounts = getTwAccounts(db, guildId);
    const idx = accounts.findIndex(a => a.userId === userId);
    if (idx === -1) return res.json({ success: false, message: 'Akun tidak ditemukan.' });

    if (enabled && !channelId)
        return res.json({ success: false, message: 'Notifikasi diaktifkan tapi channel Discord belum dipilih.' });

    accounts[idx] = {
        ...accounts[idx],
        enabled:   !!enabled,
        channelId: channelId || '',
        message:   (message || '').trim(),
    };
    setTwAccounts(db, guildId, accounts);
    res.json({ success: true, message: 'Pengaturan berhasil disimpan.' });
});

// POST /api/guild/:guildId/twitch/accounts/:userId/test — test notifikasi
router.post('/guild/:guildId/twitch/accounts/:userId/test', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const userId  = req.params.userId;
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const accounts = getTwAccounts(db, guildId);
    const account  = accounts.find(a => a.userId === userId);
    if (!account)         return res.json({ success: false, message: 'Akun tidak ditemukan.' });
    if (!account.enabled) return res.json({ success: false, message: 'Notifikasi belum diaktifkan.' });
    if (!account.channelId) return res.json({ success: false, message: 'Channel Discord belum dipilih.' });

    const notifier = req.discordClient?.twitchNotifier;
    if (!notifier) return res.json({ success: false, message: 'TwitchNotifier tidak tersedia.' });

    try {
        await notifier.sendTestNotification(req.botGuild, account);
        res.json({ success: true, message: 'Test notifikasi berhasil dikirim!' });
    } catch (err) {
        res.json({ success: false, message: `Gagal: ${err.message}` });
    }
});

// DELETE /api/guild/:guildId/twitch/accounts/:userId — hapus akun
router.delete('/guild/:guildId/twitch/accounts/:userId', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const userId  = req.params.userId;
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const accounts = getTwAccounts(db, guildId);
    const account  = accounts.find(a => a.userId === userId);
    if (!account) return res.json({ success: false, message: 'Akun tidak ditemukan.' });

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

    res.json({ success: true, message: `Akun "${account.displayName || account.login}" berhasil dihapus.` });
});

// ════════════════════════════════════════════════════════════════════════════════
// GIVEAWAY
// ════════════════════════════════════════════════════════════════════════════════

// POST /api/guild/:guildId/giveaway — buat giveaway baru
router.post('/guild/:guildId/giveaway', requireLogin, requireManageGuild, async (req, res) => {
    const guildId = req.params.guildId;
    const manager = req.discordClient?.giveawayManager;
    if (!manager) return res.status(500).json({ success: false, message: 'GiveawayManager tidak tersedia.' });

    const { channelId, prize, durationMs, winnerCount, requiredRoleId } = req.body;

    if (!channelId)          return res.json({ success: false, message: 'Pilih channel terlebih dahulu.' });
    if (!prize?.trim())      return res.json({ success: false, message: 'Hadiah tidak boleh kosong.' });
    if (!durationMs || durationMs < 10_000)
        return res.json({ success: false, message: 'Durasi minimal 10 detik.' });
    if (!winnerCount || winnerCount < 1 || winnerCount > 20)
        return res.json({ success: false, message: 'Jumlah pemenang harus antara 1–20.' });

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
        res.json({ success: true, message: `Giveaway "${gw.prize}" berhasil dibuat!`, id: gw.id });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// POST /api/guild/:guildId/giveaway/:id/end — end giveaway sekarang
router.post('/guild/:guildId/giveaway/:id/end', requireLogin, requireManageGuild, async (req, res) => {
    const manager = req.discordClient?.giveawayManager;
    if (!manager) return res.status(500).json({ success: false, message: 'GiveawayManager tidak tersedia.' });

    const gw = manager._get(req.params.id);
    if (!gw || gw.guildId !== req.params.guildId)
        return res.json({ success: false, message: 'Giveaway tidak ditemukan.' });
    if (gw.ended) return res.json({ success: false, message: 'Giveaway sudah selesai.' });

    try {
        await manager.endGiveaway(req.params.id);
        res.json({ success: true, message: 'Giveaway berhasil diakhiri.' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// POST /api/guild/:guildId/giveaway/:id/reroll — reroll pemenang
router.post('/guild/:guildId/giveaway/:id/reroll', requireLogin, requireManageGuild, async (req, res) => {
    const manager = req.discordClient?.giveawayManager;
    if (!manager) return res.status(500).json({ success: false, message: 'GiveawayManager tidak tersedia.' });

    const gw = manager._get(req.params.id);
    if (!gw || gw.guildId !== req.params.guildId)
        return res.json({ success: false, message: 'Giveaway tidak ditemukan.' });

    try {
        const winners = await manager.rerollGiveaway(req.params.id);
        res.json({ success: true, message: `Reroll selesai! ${winners.length} pemenang baru dipilih.` });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// POST /api/guild/:guildId/giveaway/:id/remove — hapus permanen dari riwayat
router.post('/guild/:guildId/giveaway/:id/remove', requireLogin, requireManageGuild, async (req, res) => {
    const manager = req.discordClient?.giveawayManager;
    if (!manager) return res.status(500).json({ success: false, message: 'GiveawayManager tidak tersedia.' });

    const gw = manager._get(req.params.id);
    if (!gw || gw.guildId !== req.params.guildId)
        return res.json({ success: false, message: 'Giveaway tidak ditemukan.' });

    try {
        manager.deleteGiveaway(req.params.id);
        res.json({ success: true, message: 'Giveaway berhasil dihapus dari riwayat.' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// DELETE /api/guild/:guildId/giveaway/:id — cancel giveaway
router.delete('/guild/:guildId/giveaway/:id', requireLogin, requireManageGuild, async (req, res) => {
    const manager = req.discordClient?.giveawayManager;
    if (!manager) return res.status(500).json({ success: false, message: 'GiveawayManager tidak tersedia.' });

    const gw = manager._get(req.params.id);
    if (!gw || gw.guildId !== req.params.guildId)
        return res.json({ success: false, message: 'Giveaway tidak ditemukan.' });

    try {
        await manager.cancelGiveaway(req.params.id);
        res.json({ success: true, message: 'Giveaway berhasil dibatalkan.' });
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
    if (!input?.trim()) return res.json({ success: false, message: 'Input tidak boleh kosong.' });

    const notifier = req.discordClient?.kickNotifier;
    if (!notifier) return res.status(500).json({ success: false, message: 'KickNotifier tidak tersedia.' });

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
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const { slug, displayName, thumbnail, userId } = req.body;
    if (!slug) return res.json({ success: false, message: 'Slug tidak boleh kosong.' });

    const accounts = getKickAccounts(db, guildId);
    if (accounts.length >= MAX_KICK_ACCOUNTS)
        return res.json({ success: false, message: `Maksimal ${MAX_KICK_ACCOUNTS} akun Kick per server.` });
    if (accounts.find(a => a.slug === slug))
        return res.json({ success: false, message: 'Akun ini sudah ditambahkan.' });

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
    res.json({ success: true, message: `Channel "${slug}" berhasil ditambahkan.` });
});

// PUT /api/guild/:guildId/kick/accounts/:slug — update settings
router.put('/guild/:guildId/kick/accounts/:slug', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const slug    = decodeURIComponent(req.params.slug);
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const accounts = getKickAccounts(db, guildId);
    const idx      = accounts.findIndex(a => a.slug === slug);
    if (idx === -1) return res.json({ success: false, message: 'Akun tidak ditemukan.' });

    const { enabled, channelId, message } = req.body;
    const guild = req.botGuild;

    if (enabled && !channelId)
        return res.json({ success: false, message: 'Notifikasi diaktifkan tapi channel Discord belum dipilih.' });
    if (enabled && channelId && !guild.channels.cache.get(channelId))
        return res.json({ success: false, message: 'Channel Discord tidak ditemukan.' });

    if (enabled && channelId) {
        const missing = missingChannelPerms(guild, channelId, [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.EmbedLinks,
        ]);
        if (missing.length)
            return res.json({ success: false, message: `Bot tidak punya permission:\n${missing.map(p => `• ${p}`).join('\n')}` });
    }

    accounts[idx] = { ...accounts[idx], enabled: !!enabled, channelId: channelId || '', message: message || '' };
    setKickAccounts(db, guildId, accounts);
    res.json({ success: true, message: 'Pengaturan berhasil disimpan.' });
});

// POST /api/guild/:guildId/kick/accounts/:slug/test — kirim test notifikasi
router.post('/guild/:guildId/kick/accounts/:slug/test', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const slug    = decodeURIComponent(req.params.slug);
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const notifier = req.discordClient?.kickNotifier;
    if (!notifier) return res.status(500).json({ success: false, message: 'KickNotifier tidak tersedia.' });

    const accounts = getKickAccounts(db, guildId);
    const account  = accounts.find(a => a.slug === slug);
    if (!account) return res.json({ success: false, message: 'Akun tidak ditemukan.' });
    if (!account.channelId) return res.json({ success: false, message: 'Channel Discord belum dipilih.' });

    const guild = req.botGuild;
    try {
        await notifier.sendTestNotification(guild, account);
        res.json({ success: true, message: 'Test notifikasi berhasil dikirim!' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// POST /api/guild/:guildId/kick/accounts/:slug/refresh-thumbnail — perbarui thumbnail
router.post('/guild/:guildId/kick/accounts/:slug/refresh-thumbnail', requireLogin, requireManageGuild, async (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const slug    = decodeURIComponent(req.params.slug);
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const notifier = req.discordClient?.kickNotifier;
    if (!notifier) return res.status(500).json({ success: false, message: 'KickNotifier tidak tersedia.' });

    const accounts = getKickAccounts(db, guildId);
    const idx      = accounts.findIndex(a => a.slug === slug);
    if (idx === -1) return res.json({ success: false, message: 'Akun tidak ditemukan.' });

    try {
        const info = await notifier.lookupChannel(slug);
        accounts[idx] = {
            ...accounts[idx],
            userId:      info.userId      || accounts[idx].userId,
            displayName: info.displayName || accounts[idx].displayName,
            thumbnail:   info.thumbnail   || accounts[idx].thumbnail,
        };
        setKickAccounts(db, guildId, accounts);
        res.json({ success: true, message: 'Thumbnail & nama berhasil diperbarui.', thumbnail: accounts[idx].thumbnail, displayName: accounts[idx].displayName });
    } catch (err) {
        res.json({ success: false, message: `Gagal refresh: ${err.message}` });
    }
});

// DELETE /api/guild/:guildId/kick/accounts/:slug — hapus akun
router.delete('/guild/:guildId/kick/accounts/:slug', requireLogin, requireManageGuild, (req, res) => {
    const db      = req.discordClient?.database;
    const guildId = req.params.guildId;
    const slug    = decodeURIComponent(req.params.slug);
    if (!db) return res.status(500).json({ success: false, message: 'Database tidak tersedia.' });

    const accounts = getKickAccounts(db, guildId);
    const account  = accounts.find(a => a.slug === slug);
    if (!account) return res.json({ success: false, message: 'Akun tidak ditemukan.' });

    const notifier = req.discordClient?.kickNotifier;
    if (notifier) {
        db.delete(`kick-live-${guildId}-${slug}`);
        notifier._liveSessions?.delete(`${guildId}:${slug}`);
    }

    setKickAccounts(db, guildId, accounts.filter(a => a.slug !== slug));
    res.json({ success: true, message: `Channel "${slug}" berhasil dihapus.` });
});

module.exports = router;

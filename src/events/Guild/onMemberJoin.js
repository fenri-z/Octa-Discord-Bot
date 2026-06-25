const { EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { generateCardAsync } = require("../../utils/generateCard");
const { logError, safeRun } = require("../../utils/logError");
const cache = require("../../utils/GuildCache");
const Event = require("../../structure/Event");

function bool(db, key, def = false) {
    const v = db.get(key);
    return (v === null || v === undefined) ? def : (v !== 'false' && v !== false && v !== 0);
}

function readWelcomeConfig(db, guildId) {
    const g = guildId;
    const cardTextColor = db.get(`welcome-cardTextColor-${g}`) ?? '#ffffff';
    const cardAccent    = db.get(`welcome-cardAccent-${g}`)    ?? '#5865F2';
    return {
        enabled:            bool(db, `welcome-enabled-${g}`, false),
        channelId:          db.get(`welcome-channel-${g}`)          ?? null,
        title:              db.get(`welcome-title-${g}`)            ?? '',
        description:        db.get(`welcome-description-${g}`)      ?? '',
        color:              db.get(`welcome-color-${g}`)            ?? '#5865F2',
        footerText:         db.get(`welcome-footer-${g}`)           ?? null,
        messageType:        db.get(`welcome-messageType-${g}`)      ?? 'embed',
        cardEnabled:        bool(db, `welcome-cardEnabled-${g}`, false),
        cardBgColor:        db.get(`welcome-cardBgColor-${g}`)      ?? '#1a1a2e',
        cardBgColor2:       db.get(`welcome-cardBgColor2-${g}`)     ?? '#16213e',
        cardAccent,
        cardTextColor,
        cardWelcomeText:    db.get(`welcome-cardWelcomeText-${g}`)  ?? 'WELCOME',
        cardUserPrefix:     db.get(`welcome-cardUserPrefix-${g}`)   ?? '.',
        cardSubText:        db.get(`welcome-cardSubText-${g}`)      ?? 'TO {server}',
        cardAvatarShape:    db.get(`welcome-cardAvatarShape-${g}`)  ?? 'circle',
        cardBgType:         db.get(`welcome-cardBgType-${g}`)       ?? 'gradient',
        cardBgImageUrl:     db.get(`welcome-cardBgImageUrl-${g}`)   ?? '',
        cardOverlayColor:   db.get(`welcome-cardOverlayColor-${g}`) ?? '#000000',
        cardOverlayOpacity: parseInt(db.get(`welcome-cardOverlayOpacity-${g}`) || '0'),
        cardTitleColor:     db.get(`welcome-cardTitleColor-${g}`)   ?? cardTextColor,
        cardUsernameColor:  db.get(`welcome-cardUsernameColor-${g}`)|| cardAccent,
        cardMsgColor:       db.get(`welcome-cardMsgColor-${g}`)     ?? '#cccccc',
        cardFont:           db.get(`welcome-cardFont-${g}`)         ?? 'impact',
        cardLayout:         db.get(`welcome-cardLayout-${g}`)       ?? 'banner',
        plainText:          db.get(`welcome-plainText-${g}`)        ?? '',
        thumbnail:          bool(db, `welcome-thumbnail-${g}`, false),
        embedImageUrl:      db.get(`welcome-embedImageUrl-${g}`)    ?? '',
        showDiundangOleh:   bool(db, `welcome-showDiundangOleh-${g}`,  false),
        showKodeInvite:     bool(db, `welcome-showKodeInvite-${g}`,    false),
        showTotalUndangan:  bool(db, `welcome-showTotalUndangan-${g}`, false),
    };
}

module.exports = new Event({
    event: 'guildMemberAdd',
    once: false,
    run: safeRun('[onMemberJoin]', async (__client__, member) => {
        const { guild } = member;
        const guildId = guild.id;

        const cfgKey = `welcome-cfg-${guildId}`;
        let cfg = cache.get(cfgKey);
        if (!cfg) {
            cfg = readWelcomeConfig(__client__.database, guildId);
            cache.set(cfgKey, cfg);
        }

        if (!cfg.enabled) return;

        const {
            channelId, title, description, color, footerText, messageType,
            cardEnabled, cardBgColor, cardBgColor2, cardAccent, cardTextColor,
            cardWelcomeText, cardSubText, cardAvatarShape,
            cardBgType, cardBgImageUrl, cardOverlayColor, cardOverlayOpacity,
            cardTitleColor, cardUsernameColor, cardMsgColor, cardFont, cardLayout,
            plainText, thumbnail, embedImageUrl,
            showDiundangOleh, showKodeInvite, showTotalUndangan,
        } = cfg;

        // ── Cari channel sambutan ─────────────────────────────────────────
        const welcomeChannel =
            (channelId && guild.channels.cache.get(channelId)) ||
            guild.channels.cache.find(ch => ch.name === 'welcome') ||
            guild.channels.cache.find(ch => ch.name === 'general') ||
            guild.systemChannel;

        if (!welcomeChannel || !welcomeChannel.isTextBased()) return;

        // ── Deteksi invite yang digunakan ─────────────────────────────────
        let fetchedInvites = null;
        try { fetchedInvites = await guild.invites.fetch(); } catch { /* no MANAGE_GUILD */ }

        const cachedInvites = __client__.inviteCache?.get(guild.id) ?? new Map();
        let usedInvite = null;
        let inviter    = null;

        if (fetchedInvites) {
            usedInvite = fetchedInvites.find(inv => {
                const cached = cachedInvites.get(inv.code);
                return cached !== undefined && inv.uses > cached;
            }) || null;

            if (usedInvite) inviter = usedInvite.inviter ?? null;

            if (!__client__.inviteCache) __client__.inviteCache = new Map();
            __client__.inviteCache.set(guild.id, new Map(fetchedInvites.map(inv => [inv.code, inv.uses])));
        }

        let inviterTotalUses = 0;
        if (inviter && fetchedInvites) {
            inviterTotalUses = fetchedInvites
                .filter(inv => inv.inviter?.id === inviter.id)
                .reduce((sum, inv) => sum + (inv.uses ?? 0), 0);
        }

        // ── Placeholder replacer ──────────────────────────────────────────
        const totalMembers    = guild.memberCount;
        const displayName     = member.displayName || member.user.username;
        const createdRelative = `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`;

        const parseTitle = (str) => str
            .replace(/{member}/g,          `@${displayName}`)
            .replace(/{username}/g,        member.user.username)
            .replace(/{tag}/g,             member.user.tag)
            .replace(/{server}/g,          guild.name)
            .replace(/{count}/g,           String(totalMembers))
            .replace(/{inviter}/g,         inviter ? inviter.tag : 'Unknown')
            .replace(/{invite\.code}/g,    usedInvite ? usedInvite.code : 'Unknown')
            .replace(/{total\.invites}/g,  inviter ? String(inviterTotalUses) : '-')
            .replace(/{account\.created}/g,createdRelative);

        const parse = (str) => str
            .replace(/{member}/g,          `<@${member.id}>`)
            .replace(/{username}/g,        member.user.username)
            .replace(/{tag}/g,             member.user.tag)
            .replace(/{server}/g,          guild.name)
            .replace(/{count}/g,           String(totalMembers))
            .replace(/{inviter}/g,         inviter ? inviter.tag : 'Unknown')
            .replace(/{invite\.code}/g,    usedInvite ? usedInvite.code : 'Unknown')
            .replace(/{total\.invites}/g,  inviter ? String(inviterTotalUses) : '-')
            .replace(/{account\.created}/g,createdRelative);

        // ── Generate welcome card (jika aktif) ───────────────────────────
        let cardAttachment = null;
        if (cardEnabled) {
            try {
                const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
                const cardBuf   = await generateCardAsync({
                    avatarUrl,
                    username:       member.user.username,
                    serverName:     guild.name,
                    welcomeText:    cardWelcomeText,
                    subText:        cardSubText,
                    bgColor:        cardBgColor,
                    bgColor2:       cardBgColor2,
                    accentColor:    cardAccent,
                    avatarShape:    cardAvatarShape,
                    bgType:         cardBgType,
                    bgImageUrl:     cardBgImageUrl,
                    overlayColor:   cardOverlayColor,
                    overlayOpacity: cardOverlayOpacity,
                    titleColor:     cardTitleColor,
                    usernameColor:  cardUsernameColor,
                    messageColor:   cardMsgColor,
                    fontFamily:     cardFont,
                    cardLayout:     cardLayout,
                });
                cardAttachment = new AttachmentBuilder(Buffer.from(cardBuf), { name: 'welcome-card.png' });
                console.log('[onMemberJoin] Card generated OK, size:', cardBuf.length);
            } catch (err) {
                logError('[onMemberJoin] Welcome card generation failed:', err);
            }
        }
        console.log('[onMemberJoin] cardAttachment:', cardAttachment ? 'set' : 'null', '| messageType:', messageType);

        // ── Kirim pesan sesuai tipe ───────────────────────────────────────
        const _sendErr = (label, err) => logError(`[onMemberJoin] ${label}:`, err);
        if (messageType === 'plain') {
            let content = parse(plainText).trim();
            if (content) {
                const plainPayload = { content, allowedMentions: { users: [member.id] } };
                if (cardAttachment) plainPayload.files = [cardAttachment];
                await welcomeChannel.send(plainPayload).catch(e => _sendErr('plain send failed', e));
            } else if (cardAttachment) {
                await welcomeChannel.send({ files: [cardAttachment] }).catch(e => _sendErr('card-only plain send failed', e));
            }
        } else {
            const colorHex = color.startsWith('#') ? color : `#${color}`;
            const hasText   = title.trim() || description.trim();

            const embedFields = [];
            if (showDiundangOleh) embedFields.push({ name: 'Invited By',      value: inviter ? inviter.tag : 'Unknown',                 inline: true });
            if (showKodeInvite)   embedFields.push({ name: 'Invite Code',     value: usedInvite ? usedInvite.code : 'Unknown',          inline: true });
            if (showTotalUndangan)embedFields.push({ name: 'Total Invites',   value: inviter ? String(inviterTotalUses) : '-',          inline: true });
            const hasFields = embedFields.length > 0;

            if (!hasText && !hasFields) {
                if (cardAttachment) {
                    const cardOnlyEmbed = new EmbedBuilder().setColor(colorHex).setImage('attachment://welcome-card.png');
                    await welcomeChannel.send({ embeds: [cardOnlyEmbed], files: [cardAttachment] }).catch(e => _sendErr('card-only embed send failed', e));
                }
                return;
            }

            const embed = new EmbedBuilder().setColor(colorHex);
            if (parseTitle(title))  embed.setTitle(parseTitle(title));
            if (parse(description)) embed.setDescription(parse(description));
            if (hasFields)          embed.addFields(embedFields);

            if (footerText) embed.setFooter({ text: parseTitle(footerText) });
            if (thumbnail)  embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));
            if (embedImageUrl) embed.setImage(embedImageUrl);
            else if (cardAttachment) embed.setImage('attachment://welcome-card.png');

            const embedPayload = { embeds: [embed] };
            if (cardAttachment) embedPayload.files = [cardAttachment];
            await welcomeChannel.send(embedPayload).catch(async (err) => {
                if (cardAttachment) {
                    _sendErr('embed+card send failed (retrying without card)', err);
                    if (embed.data.image) delete embed.data.image;
                    await welcomeChannel.send({ embeds: [embed] }).catch(e => _sendErr('embed send failed', e));
                } else {
                    _sendErr('embed send failed', err);
                }
            });
        }
    })
}).toJSON();

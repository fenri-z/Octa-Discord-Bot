const { EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { generateCardAsync } = require("../../utils/generateCard");
const { logError, safeRun } = require("../../utils/logError");
const cache = require("../../utils/GuildCache");
const Event = require("../../structure/Event");

function bool(db, key, def = false) {
    const v = db.get(key);
    return (v === null || v === undefined) ? def : (v !== 'false' && v !== false && v !== 0);
}

function readGoodbyeConfig(db, guildId) {
    const g = guildId;
    const cardTextColor    = db.get(`goodbye-cardTextColor-${g}`)    ?? '#ffffff';
    const cardAccentColor  = db.get(`goodbye-cardAccent-${g}`)       ?? '#ED4245';
    return {
        enabled:             bool(db, `goodbye-enabled-${g}`, false),
        channelId:           db.get(`goodbye-channel-${g}`)          ?? null,
        messageType:         db.get(`goodbye-messageType-${g}`)      ?? 'embed',
        plainText:           db.get(`goodbye-plainText-${g}`)        ?? '',
        title:               db.get(`goodbye-title-${g}`)            ?? '👋 Goodbye!',
        description:         db.get(`goodbye-description-${g}`)      ?? '{member} has left the server.',
        color:               db.get(`goodbye-color-${g}`)            ?? '#ED4245',
        footerText:          db.get(`goodbye-footer-${g}`)           ?? null,
        thumbnail:           bool(db, `goodbye-thumbnail-${g}`, false),
        cardEnabled:         bool(db, `goodbye-cardEnabled-${g}`, false),
        cardBgColor:         db.get(`goodbye-cardBgColor-${g}`)      ?? '#1a0a0a',
        cardBgColor2:        db.get(`goodbye-cardBgColor2-${g}`)     ?? '#2e0a0a',
        cardAccentColor,
        cardTextColor,
        cardWelcomeText:     db.get(`goodbye-cardWelcomeText-${g}`)  ?? 'GOODBYE',
        cardSubText:         db.get(`goodbye-cardSubText-${g}`)      ?? 'FROM {server}',
        cardAvatarShape:     db.get(`goodbye-cardAvatarShape-${g}`)  ?? 'circle',
        cardBgType:          db.get(`goodbye-cardBgType-${g}`)       ?? 'gradient',
        cardBgImageUrl:      db.get(`goodbye-cardBgImageUrl-${g}`)   ?? '',
        cardOverlayColor:    db.get(`goodbye-cardOverlayColor-${g}`) ?? '#000000',
        cardOverlayOpacity:  parseInt(db.get(`goodbye-cardOverlayOpacity-${g}`) || '0'),
        cardTitleColor:      db.get(`goodbye-cardTitleColor-${g}`)   ?? '#ffffff',
        cardUsernameColor:   db.get(`goodbye-cardUsernameColor-${g}`)|| cardAccentColor,
        cardMsgColor:        db.get(`goodbye-cardMsgColor-${g}`)     ?? '#cccccc',
        cardFont:            db.get(`goodbye-cardFont-${g}`)         ?? 'impact',
        cardLayout:          db.get(`goodbye-cardLayout-${g}`)       ?? 'classic',
        embedImageUrl:       db.get(`goodbye-embedImageUrl-${g}`)    ?? '',
    };
}

module.exports = new Event({
    event: 'guildMemberRemove',
    once: false,
    run: safeRun('[onMemberLeave]', async (__client__, member) => {
        const { guild } = member;
        const guildId = guild.id;

        const cfgKey = `goodbye-cfg-${guildId}`;
        let cfg = cache.get(cfgKey);
        if (!cfg) {
            cfg = readGoodbyeConfig(__client__.database, guildId);
            cache.set(cfgKey, cfg);
        }

        if (!cfg.enabled) return;

        const {
            channelId, messageType, plainText, title, description, color, footerText, thumbnail,
            cardEnabled, cardBgColor, cardBgColor2, cardAccentColor, cardTextColor,
            cardWelcomeText, cardSubText, cardAvatarShape, cardBgType, cardBgImageUrl,
            cardOverlayColor, cardOverlayOpacity, cardTitleColor, cardUsernameColor,
            cardMsgColor, cardFont, cardLayout, embedImageUrl,
        } = cfg;

        // ── Cari channel tujuan ───────────────────────────────────────────
        const goodbyeChannel =
            (channelId && guild.channels.cache.get(channelId)) ||
            guild.channels.cache.find(ch => ch.name === 'goodbye') ||
            guild.channels.cache.find(ch => ch.name === 'general') ||
            guild.systemChannel;

        if (!goodbyeChannel || !goodbyeChannel.isTextBased()) return;

        // ── Placeholder replacer ──────────────────────────────────────────
        const totalMembers    = guild.memberCount;
        const displayName     = member.displayName || member.user.username;
        const createdRelative = `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`;

        const parseTitle = (str) => str
            .replace(/{member}/g,           `@${displayName}`)
            .replace(/{username}/g,         member.user.username)
            .replace(/{tag}/g,              member.user.tag)
            .replace(/{server}/g,           guild.name)
            .replace(/{count}/g,            String(totalMembers))
            .replace(/{account\.created}/g, createdRelative);

        const parse = (str) => str
            .replace(/{member}/g,           `<@${member.id}>`)
            .replace(/{username}/g,         member.user.username)
            .replace(/{tag}/g,              member.user.tag)
            .replace(/{server}/g,           guild.name)
            .replace(/{count}/g,            String(totalMembers))
            .replace(/{account\.created}/g, createdRelative);

        // ── Generate goodbye card ─────────────────────────────────────────
        let cardAttachment = null;
        if (cardEnabled) {
            try {
                const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
                const cardBuf = await generateCardAsync({
                    avatarUrl,
                    username:       member.user.username,
                    serverName:     guild.name,
                    welcomeText:    cardWelcomeText,
                    subText:        cardSubText,
                    bgColor:        cardBgColor,
                    bgColor2:       cardBgColor2,
                    accentColor:    cardAccentColor,
                    avatarShape:    cardAvatarShape,
                    bgType:         cardBgType,
                    bgImageUrl:     cardBgImageUrl,
                    overlayColor:   cardOverlayColor,
                    overlayOpacity: cardOverlayOpacity,
                    titleColor:     cardTitleColor || cardTextColor,
                    usernameColor:  cardUsernameColor || cardAccentColor,
                    messageColor:   cardMsgColor,
                    fontFamily:     cardFont,
                    cardLayout:     cardLayout,
                });
                cardAttachment = new AttachmentBuilder(Buffer.from(cardBuf), { name: 'goodbye-card.png' });
                console.log('[onMemberLeave] Card generated OK, size:', cardBuf.length);
            } catch (err) {
                logError('[onMemberLeave] Goodbye card generation failed:', err);
            }
        }
        console.log('[onMemberLeave] cardAttachment:', cardAttachment ? 'set' : 'null', '| messageType:', messageType);

        const _sendErr = (label, err) => logError(`[onMemberLeave] ${label}:`, err);

        // ── Mode teks biasa ───────────────────────────────────────────────
        if (messageType === 'plain') {
            const content = parse(plainText).trim();
            if (content || cardAttachment) {
                const payload = {};
                if (content) { payload.content = content; payload.allowedMentions = { users: [member.id] }; }
                if (cardAttachment) payload.files = [cardAttachment];
                await goodbyeChannel.send(payload).catch(e => _sendErr('plain send failed', e));
            }
            return;
        }

        // ── Mode embed ────────────────────────────────────────────────────
        const colorHex = color.startsWith('#') ? color : `#${color}`;
        const embed = new EmbedBuilder().setColor(colorHex);
        const parsedTitle = parseTitle(title);
        if (parsedTitle) embed.setTitle(parsedTitle);
        const parsedDesc = parse(description);
        if (parsedDesc) embed.setDescription(parsedDesc);

        if (footerText) embed.setFooter({ text: parseTitle(footerText) });
        if (thumbnail)  embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));
        if (embedImageUrl) embed.setImage(embedImageUrl);
        else if (cardAttachment) embed.setImage('attachment://goodbye-card.png');

        const payload = { embeds: [embed] };
        if (cardAttachment) payload.files = [cardAttachment];
        await goodbyeChannel.send(payload).catch(async (err) => {
            if (cardAttachment) {
                _sendErr('embed+card send failed (retrying without card)', err);
                if (embed.data.image) delete embed.data.image;
                await goodbyeChannel.send({ embeds: [embed] }).catch(e => _sendErr('embed send failed', e));
            } else {
                _sendErr('embed send failed', err);
            }
        });
    })
}).toJSON();

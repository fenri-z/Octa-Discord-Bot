const { EmbedBuilder, AttachmentBuilder } = require("discord.js");
const Event = require("../../structure/Event");
const { generateWelcomeCard } = require('../../utils/generateWelcomeCard');

function getBool(client, key, defaultVal) {
    const raw = client.database.get(key);
    if (raw === null || raw === undefined) return defaultVal;
    if (raw === 'false' || raw === false || raw === 0) return false;
    return true;
}

module.exports = new Event({
    event: 'guildMemberRemove',
    once: false,

    /**
     * @param {import("../../client/DiscordBot")} __client__
     * @param {import("discord.js").GuildMember} member
     */
    run: async (__client__, member) => {
        const { guild } = member;

        const enabled = getBool(__client__, `goodbye-enabled-${guild.id}`, false);
        if (!enabled) return;

        const channelId      = __client__.database.get(`goodbye-channel-${guild.id}`)      ?? null;
        const messageType    = __client__.database.get(`goodbye-messageType-${guild.id}`)   ?? 'embed';
        const plainText      = __client__.database.get(`goodbye-plainText-${guild.id}`)     ?? '';
        const title          = __client__.database.get(`goodbye-title-${guild.id}`)         ?? '👋 Goodbye!';
        const description    = __client__.database.get(`goodbye-description-${guild.id}`)   ?? '{member} has left the server.';
        const color          = __client__.database.get(`goodbye-color-${guild.id}`)         ?? '#ED4245';
        const footerText     = __client__.database.get(`goodbye-footer-${guild.id}`)        ?? null;
        const thumbnail      = getBool(__client__, `goodbye-thumbnail-${guild.id}`,          false);
        // ── Goodbye Card ─────────────────────────────────────────────────────
        const cardEnabled        = getBool(__client__, `goodbye-cardEnabled-${guild.id}`,   false);
        const cardBgColor        = __client__.database.get(`goodbye-cardBgColor-${guild.id}`)        ?? '#1a0a0a';
        const cardBgColor2       = __client__.database.get(`goodbye-cardBgColor2-${guild.id}`)       ?? '#2e0a0a';
        const cardAccentColor    = __client__.database.get(`goodbye-cardAccent-${guild.id}`)         ?? '#ED4245';
        const cardTextColor      = __client__.database.get(`goodbye-cardTextColor-${guild.id}`)      ?? '#ffffff';
        const cardWelcomeText    = __client__.database.get(`goodbye-cardWelcomeText-${guild.id}`)    ?? 'GOODBYE';
        const cardSubText        = __client__.database.get(`goodbye-cardSubText-${guild.id}`)        ?? 'FROM {server}';
        const cardAvatarShape    = __client__.database.get(`goodbye-cardAvatarShape-${guild.id}`)    ?? 'circle';
        const cardBgType         = __client__.database.get(`goodbye-cardBgType-${guild.id}`)         ?? 'gradient';
        const cardBgImageUrl     = __client__.database.get(`goodbye-cardBgImageUrl-${guild.id}`)     ?? '';
        const cardOverlayColor   = __client__.database.get(`goodbye-cardOverlayColor-${guild.id}`)   ?? '#000000';
        const cardOverlayOpacity = parseInt(__client__.database.get(`goodbye-cardOverlayOpacity-${guild.id}`) || '0');
        const cardTitleColor     = __client__.database.get(`goodbye-cardTitleColor-${guild.id}`)     ?? '#ffffff';
        const cardUsernameColor  = __client__.database.get(`goodbye-cardUsernameColor-${guild.id}`)  ?? '';
        const cardMsgColor       = __client__.database.get(`goodbye-cardMsgColor-${guild.id}`)       ?? '#cccccc';
        const cardFont           = __client__.database.get(`goodbye-cardFont-${guild.id}`)           ?? 'impact';
        // ── Cari channel tujuan ───────────────────────────────────────────
        const goodbyeChannel =
            (channelId && guild.channels.cache.get(channelId)) ||
            guild.channels.cache.find(ch => ch.name === 'goodbye') ||
            guild.channels.cache.find(ch => ch.name === 'general') ||
            guild.systemChannel;

        if (!goodbyeChannel || !goodbyeChannel.isTextBased()) return;

        // ── Placeholder replacer ──────────────────────────────────────────
        const totalMembers   = guild.memberCount;
        const displayName    = member.displayName || member.user.username;
        const createdRelative = `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`;

        // Untuk title & footer: {member} → @displayName (mention tidak render di embed title)
        const parseTitle = (str) => str
            .replace(/{member}/g,       `@${displayName}`)
            .replace(/{username}/g,     member.user.username)
            .replace(/{tag}/g,          member.user.tag)
            .replace(/{server}/g,       guild.name)
            .replace(/{count}/g,        String(totalMembers))
            .replace(/{account\.created}/g, createdRelative);

        // Untuk description & plain text: {member} → mention <@ID>
        const parse = (str) => str
            .replace(/{member}/g,          `<@${member.id}>`)
            .replace(/{username}/g,        member.user.username)
            .replace(/{tag}/g,             member.user.tag)
            .replace(/{server}/g,          guild.name)
            .replace(/{count}/g,           String(totalMembers))
            .replace(/{account\.created}/g,createdRelative);

        // ── Generate goodbye card ─────────────────────────────────────────
        let cardAttachment = null;
        if (cardEnabled) {
            try {
                const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
                const cardBuf = await generateWelcomeCard({
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
                });
                cardAttachment = new AttachmentBuilder(cardBuf, { name: 'goodbye-card.png' });
            } catch (err) {
                console.error('[goodbye] Card generation failed:', err.message);
            }
        }

        // ── Mode teks biasa ───────────────────────────────────────────────
        if (messageType === 'plain') {
            const content = parse(plainText).trim();
            if (content || cardAttachment) {
                const payload = {};
                if (content) { payload.content = content; payload.allowedMentions = { users: [member.id] }; }
                if (cardAttachment) payload.files = [cardAttachment];
                await goodbyeChannel.send(payload).catch(() => null);
            }
            return;
        }

        // ── Mode embed ────────────────────────────────────────────────────
        const colorHex = color.startsWith('#') ? color : `#${color}`;
        const embed = new EmbedBuilder()
            .setColor(colorHex);
        const parsedTitle = parseTitle(title);
        if (parsedTitle) embed.setTitle(parsedTitle);
        const parsedDesc = parse(description);
        if (parsedDesc) embed.setDescription(parsedDesc);

        if (footerText) embed.setFooter({ text: parseTitle(footerText) });
        if (thumbnail)  embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));
        if (cardAttachment) embed.setImage('attachment://goodbye-card.png');

        const payload = { embeds: [embed] };
        if (cardAttachment) payload.files = [cardAttachment];
        await goodbyeChannel.send(payload).catch(() => null);
    }
}).toJSON();

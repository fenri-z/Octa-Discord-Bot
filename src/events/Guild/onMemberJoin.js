const { EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { generateWelcomeCard } = require("../../utils/generateWelcomeCard");
const Event = require("../../structure/Event");

function getBool(client, key, defaultVal) {
    const raw = client.database.get(key);
    if (raw === null || raw === undefined) return defaultVal;
    if (raw === 'false' || raw === false || raw === 0) return false;
    return true;
}

module.exports = new Event({
    event: 'guildMemberAdd',
    once: false,

    /**
     * @param {import("../../client/DiscordBot")} __client__
     * @param {import("discord.js").GuildMember} member
     */
    run: async (__client__, member) => {
        const { guild } = member;

        const enabled          = getBool(__client__, `welcome-enabled-${guild.id}`,           false);
        if (!enabled) return;

        const channelId        = __client__.database.get(`welcome-channel-${guild.id}`)       ?? null;
        const title            = __client__.database.get(`welcome-title-${guild.id}`)         ?? '';
        const description      = __client__.database.get(`welcome-description-${guild.id}`)   ?? '';
        const color            = __client__.database.get(`welcome-color-${guild.id}`)         ?? '#5865F2';
        const footerText       = __client__.database.get(`welcome-footer-${guild.id}`)        ?? null;
        const messageType      = __client__.database.get(`welcome-messageType-${guild.id}`)   ?? 'embed';
        // ── Welcome card config ───────────────────────────────────────────
        const cardEnabled    = (() => {
            const r = __client__.database.get(`welcome-cardEnabled-${guild.id}`);
            if (r === null || r === undefined) return false;
            if (r === 'false' || r === false || r === 0) return false;
            return true;
        })();
        const cardBgColor      = __client__.database.get(`welcome-cardBgColor-${guild.id}`)      ?? '#1a1a2e';
        const cardBgColor2     = __client__.database.get(`welcome-cardBgColor2-${guild.id}`)     ?? '#16213e';
        const cardAccent       = __client__.database.get(`welcome-cardAccent-${guild.id}`)       ?? '#5865F2';
        const cardTextColor    = __client__.database.get(`welcome-cardTextColor-${guild.id}`)    ?? '#ffffff';
        const cardWelcomeText  = __client__.database.get(`welcome-cardWelcomeText-${guild.id}`)  ?? 'WELCOME';
        const cardUserPrefix   = __client__.database.get(`welcome-cardUserPrefix-${guild.id}`)   ?? '.';
        const cardSubText      = __client__.database.get(`welcome-cardSubText-${guild.id}`)      ?? 'TO {server}';
        const cardAvatarShape  = __client__.database.get(`welcome-cardAvatarShape-${guild.id}`)  ?? 'circle';
        const cardBgType       = __client__.database.get(`welcome-cardBgType-${guild.id}`)       ?? 'gradient';
        const cardBgImageUrl   = __client__.database.get(`welcome-cardBgImageUrl-${guild.id}`)   ?? '';
        const cardOverlayColor = __client__.database.get(`welcome-cardOverlayColor-${guild.id}`) ?? '#000000';
        const cardOverlayOpacity = parseInt(__client__.database.get(`welcome-cardOverlayOpacity-${guild.id}`) || '0');
        const cardTitleColor   = __client__.database.get(`welcome-cardTitleColor-${guild.id}`)   ?? cardTextColor;
        const cardUsernameColor= __client__.database.get(`welcome-cardUsernameColor-${guild.id}`)|| cardAccent;
        const cardMsgColor     = __client__.database.get(`welcome-cardMsgColor-${guild.id}`)     ?? '#cccccc';
        const cardFont         = __client__.database.get(`welcome-cardFont-${guild.id}`)         ?? 'impact';
        const plainText        = __client__.database.get(`welcome-plainText-${guild.id}`)     ?? '';
        const thumbnail        = getBool(__client__, `welcome-thumbnail-${guild.id}`,          false);
        // ── Toggle per-field ─────────────────────────────────────────────
        const showMemberNew    = getBool(__client__, `welcome-showMemberNew-${guild.id}`,      false);
        const showAkunDibuat   = getBool(__client__, `welcome-showAkunDibuat-${guild.id}`,     false);
        const showTotalMember  = getBool(__client__, `welcome-showTotalMember-${guild.id}`,    false);
        const showDiundangOleh = getBool(__client__, `welcome-showDiundangOleh-${guild.id}`,   false);
        const showKodeInvite   = getBool(__client__, `welcome-showKodeInvite-${guild.id}`,     false);
        const showTotalUndangan= getBool(__client__, `welcome-showTotalUndangan-${guild.id}`,  false);

        // ── Cari channel sambutan ─────────────────────────────────────────
        const welcomeChannel =
            (channelId && guild.channels.cache.get(channelId)) ||
            guild.channels.cache.find(ch => ch.name === 'welcome') ||
            guild.channels.cache.find(ch => ch.name === 'general') ||
            guild.systemChannel;

        if (!welcomeChannel || !welcomeChannel.isTextBased()) {
            console.warn(`[welcome] Channel tidak ditemukan untuk guild: ${guild.name} (${guild.id}), channelId: ${channelId}`);
            return;
        }


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

        // Untuk title & footer: {member} → @displayName (mention tidak render di embed title)
        const parseTitle = (str) => str
            .replace(/{member}/g,          `@${displayName}`)
            .replace(/{username}/g,        member.user.username)
            .replace(/{tag}/g,             member.user.tag)
            .replace(/{server}/g,          guild.name)
            .replace(/{count}/g,           String(totalMembers))
            .replace(/{inviter}/g,         inviter ? inviter.tag : 'Tidak diketahui')
            .replace(/{kode\.invite}/g,    usedInvite ? usedInvite.code : 'Tidak diketahui')
            .replace(/{total\.undangan}/g, inviter ? String(inviterTotalUses) : '-')
            .replace(/{akun\.dibuat}/g,    createdRelative);

        // Untuk description & plain text: {member} → mention <@ID>
        const parse = (str) => str
            .replace(/{member}/g,          `<@${member.id}>`)
            .replace(/{username}/g,        member.user.username)
            .replace(/{tag}/g,             member.user.tag)
            .replace(/{server}/g,          guild.name)
            .replace(/{count}/g,           String(totalMembers))
            .replace(/{inviter}/g,         inviter ? inviter.tag : 'Tidak diketahui')
            .replace(/{kode\.invite}/g,    usedInvite ? usedInvite.code : 'Tidak diketahui')
            .replace(/{total\.undangan}/g, inviter ? String(inviterTotalUses) : '-')
            .replace(/{akun\.dibuat}/g,    createdRelative);

        // ── Generate welcome card (jika aktif) ───────────────────────────
        let cardAttachment = null;
        if (cardEnabled) {
            try {
                const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
                const cardBuf   = await generateWelcomeCard({
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
                });
                cardAttachment = new AttachmentBuilder(cardBuf, { name: 'welcome-card.png' });
            } catch (err) {
                console.error('[onMemberJoin] Welcome card generation failed:', err.message);
            }
        }

        // ── Kirim pesan sesuai tipe ───────────────────────────────────────
        if (messageType === 'plain') {
            // Mode teks biasa — field info ditulis sebagai baris teks di bawah pesan
            let content = parse(plainText).trim();
            const infoLines = [];
            if (showMemberNew)     infoLines.push(`👤 **Member Baru:** ${member.user.tag}`);
            if (showAkunDibuat)    infoLines.push(`📅 **Akun Dibuat:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`);
            if (showTotalMember)   infoLines.push(`👥 **Total Member:** ${totalMembers} member`);
            if (showDiundangOleh)  infoLines.push(`📨 **Diundang Oleh:** ${inviter ? inviter.tag : 'Tidak diketahui'}`);
            if (showKodeInvite)    infoLines.push(`🔗 **Kode Invite:** ${usedInvite ? `\`${usedInvite.code}\`` : 'Tidak diketahui'}`);
            if (showTotalUndangan) infoLines.push(`📊 **Total Undangan:** ${inviter ? `${inviterTotalUses} undangan` : '-'}`);
            if (infoLines.length > 0) content += (content ? '\n' : '') + infoLines.join('\n');

            if (content) {
                const plainPayload = { content, allowedMentions: { users: [member.id] } };
                if (cardAttachment) plainPayload.files = [cardAttachment];
                await welcomeChannel.send(plainPayload).catch(err => console.error(`[welcome:plain] Gagal kirim di ${guild.name}:`, err.message));
            } else if (cardAttachment) {
                await welcomeChannel.send({ files: [cardAttachment] }).catch(err => console.error(`[welcome:plain:card] Gagal kirim di ${guild.name}:`, err.message));
            }
        } else {
            // Mode embed (default)
            const colorHex = color.startsWith('#') ? color : `#${color}`;
            const hasText   = title.trim() || description.trim();
            const hasFields = showMemberNew || showAkunDibuat || showTotalMember || showDiundangOleh || showKodeInvite || showTotalUndangan;

            if (!hasText && !hasFields) {
                if (cardAttachment) {
                    const cardOnlyEmbed = new EmbedBuilder().setColor(colorHex).setImage('attachment://welcome-card.png');
                    await welcomeChannel.send({ embeds: [cardOnlyEmbed], files: [cardAttachment] }).catch(() => null);
                }
                return;
            }

            const embed = new EmbedBuilder().setColor(colorHex);
            if (parseTitle(title))  embed.setTitle(parseTitle(title));
            if (parse(description)) embed.setDescription(parse(description));

            if (footerText) embed.setFooter({ text: parseTitle(footerText) });
            if (thumbnail)  embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));

            // ── Tambahkan field secara kondisional ────────────────────────
            const fields = [];
            if (showMemberNew)     fields.push({ name: '👤 Member Baru',    value: member.user.tag, inline: true });
            if (showAkunDibuat)    fields.push({ name: '📅 Akun Dibuat',    value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true });
            if (showTotalMember)   fields.push({ name: '👥 Total Member',   value: `**${totalMembers}** member`, inline: true });
            if (showDiundangOleh)  fields.push({ name: '📨 Diundang Oleh',  value: inviter ? inviter.tag : '`Tidak diketahui`', inline: true });
            if (showKodeInvite)    fields.push({ name: '🔗 Kode Invite',    value: usedInvite ? `\`${usedInvite.code}\`` : '`Tidak diketahui`', inline: true });
            if (showTotalUndangan) fields.push({ name: '📊 Total Undangan', value: inviter ? `**${inviterTotalUses}** undangan` : '`-`', inline: true });
            if (fields.length > 0) embed.addFields(...fields);
            if (cardAttachment) embed.setImage('attachment://welcome-card.png');

            const embedPayload = { embeds: [embed] };
            if (cardAttachment) embedPayload.files = [cardAttachment];
            await welcomeChannel.send(embedPayload).catch(err => console.error(`[welcome:embed] Gagal kirim di ${guild.name}:`, err.message));
        }
    }
}).toJSON();

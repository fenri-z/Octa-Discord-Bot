const { EmbedBuilder, AttachmentBuilder } = require("discord.js");
const Event = require("../../structure/Event");
const { generateCardAsync } = require('../../utils/generateWelcomeCard');
const { logError, safeRun } = require('../../utils/logError');
const cache = require('../../utils/GuildCache');

// ── Helpers ────────────────────────────────────────────────────────────────
function getBool(client, key, defaultVal) {
    const raw = client.database.get(key);
    if (raw === null || raw === undefined) return defaultVal;
    if (raw === 'false' || raw === false || raw === 0) return false;
    return true;
}

function getConfig(client, guildId) {
    const cfgKey = `booster-cfg-${guildId}`;
    const cached = cache.get(cfgKey);
    if (cached) return cached;
    const cfg = _buildBoosterConfig(client, guildId);
    cache.set(cfgKey, cfg);
    return cfg;
}

function _buildBoosterConfig(client, guildId) {
    return {
        boostEnabled:       getBool(client, `booster-boost-enabled-${guildId}`,      false),
        boostChannelId:     client.database.get(`booster-boost-channel-${guildId}`)  ?? null,
        boostMessageType:   client.database.get(`booster-boost-messageType-${guildId}`) ?? 'embed',
        boostPlainText:     client.database.get(`booster-boost-plainText-${guildId}`)   ?? '',
        boostTitle:         client.database.get(`booster-boost-title-${guildId}`)    ?? '🚀 New Server Boost!',
        boostDescription:   client.database.get(`booster-boost-desc-${guildId}`)    ?? 'Thank you {member} for boosting this server! 💖\nTotal boosts now: **{boosts}**.',
        boostColor:         client.database.get(`booster-boost-color-${guildId}`)    ?? '#FF73FA',
        boostFooter:            client.database.get(`booster-boost-footer-${guildId}`)           ?? '',
        boostShowMember:        getBool(client, `booster-boost-showMember-${guildId}`,          true),
        boostShowMulaiBoost:    getBool(client, `booster-boost-showMulaiBoost-${guildId}`,   true),
        boostShowTotalBoost:    getBool(client, `booster-boost-showTotalBoost-${guildId}`,   true),
        boostShowLevelServer:   getBool(client, `booster-boost-showLevelServer-${guildId}`,  true),
        boostShowThumbnail:     getBool(client, `booster-boost-showThumbnail-${guildId}`,    true),
        boostCardEnabled:       getBool(client, `booster-boost-cardEnabled-${guildId}`,      false),
        boostCardWelcomeText:   client.database.get(`booster-boost-cardWelcomeText-${guildId}`)   ?? 'BOOST!',
        boostCardSubText:       client.database.get(`booster-boost-cardSubText-${guildId}`)       ?? 'Thank you for boosting!',
        boostCardBgColor:       client.database.get(`booster-boost-cardBgColor-${guildId}`)       ?? '#0a0a1e',
        boostCardBgColor2:      client.database.get(`booster-boost-cardBgColor2-${guildId}`)      ?? '#1e0a2e',
        boostCardAccentColor:   client.database.get(`booster-boost-cardAccent-${guildId}`)        ?? '#FF73FA',
        boostCardAvatarShape:   client.database.get(`booster-boost-cardAvatarShape-${guildId}`)   ?? 'circle',
        boostCardBgType:        client.database.get(`booster-boost-cardBgType-${guildId}`)        ?? 'gradient',
        boostCardBgImageUrl:    client.database.get(`booster-boost-cardBgImageUrl-${guildId}`)    ?? '',
        boostCardOverlayColor:  client.database.get(`booster-boost-cardOverlayColor-${guildId}`)  ?? '#000000',
        boostCardOverlayOpacity:parseInt(client.database.get(`booster-boost-cardOverlayOpacity-${guildId}`) || '0'),
        boostCardTitleColor:    client.database.get(`booster-boost-cardTitleColor-${guildId}`)    ?? '#ffffff',
        boostCardUsernameColor: client.database.get(`booster-boost-cardUsernameColor-${guildId}`) ?? '#FF73FA',
        boostCardMsgColor:      client.database.get(`booster-boost-cardMsgColor-${guildId}`)      ?? '#cccccc',
        boostCardFont:          client.database.get(`booster-boost-cardFont-${guildId}`)          ?? 'impact',

        unboostEnabled:         getBool(client, `booster-unboost-enabled-${guildId}`,        false),
        unboostChannelId:       client.database.get(`booster-unboost-channel-${guildId}`)    ?? null,
        unboostMessageType:     client.database.get(`booster-unboost-messageType-${guildId}`) ?? 'embed',
        unboostPlainText:       client.database.get(`booster-unboost-plainText-${guildId}`)   ?? '',
        unboostTitle:           client.database.get(`booster-unboost-title-${guildId}`)      ?? '💔 Boost Ended',
        unboostDescription:     client.database.get(`booster-unboost-desc-${guildId}`)      ?? '{member} has removed their boost from the server.\nTotal boosts now: **{boosts}**.',
        unboostColor:           client.database.get(`booster-unboost-color-${guildId}`)      ?? '#ED4245',
        unboostFooter:          client.database.get(`booster-unboost-footer-${guildId}`)     ?? '',
        unboostShowMember:      getBool(client, `booster-unboost-showMember-${guildId}`,     true),
        unboostShowTotalBoost:  getBool(client, `booster-unboost-showTotalBoost-${guildId}`, true),
        unboostShowLevelServer:  getBool(client, `booster-unboost-showLevelServer-${guildId}`, true),
        unboostShowThumbnail:   getBool(client, `booster-unboost-showThumbnail-${guildId}`,  true),
        unboostCardEnabled:      getBool(client, `booster-unboost-cardEnabled-${guildId}`,    false),
        unboostCardWelcomeText:  client.database.get(`booster-unboost-cardWelcomeText-${guildId}`)   ?? 'GOODBYE',
        unboostCardSubText:      client.database.get(`booster-unboost-cardSubText-${guildId}`)       ?? 'Boost ended...',
        unboostCardBgColor:      client.database.get(`booster-unboost-cardBgColor-${guildId}`)       ?? '#1e0a0a',
        unboostCardBgColor2:     client.database.get(`booster-unboost-cardBgColor2-${guildId}`)      ?? '#2e0a0a',
        unboostCardAccentColor:  client.database.get(`booster-unboost-cardAccent-${guildId}`)        ?? '#ED4245',
        unboostCardAvatarShape:  client.database.get(`booster-unboost-cardAvatarShape-${guildId}`)   ?? 'circle',
        unboostCardBgType:       client.database.get(`booster-unboost-cardBgType-${guildId}`)        ?? 'gradient',
        unboostCardBgImageUrl:   client.database.get(`booster-unboost-cardBgImageUrl-${guildId}`)    ?? '',
        unboostCardOverlayColor: client.database.get(`booster-unboost-cardOverlayColor-${guildId}`)  ?? '#000000',
        unboostCardOverlayOpacity:parseInt(client.database.get(`booster-unboost-cardOverlayOpacity-${guildId}`) || '0'),
        unboostCardTitleColor:   client.database.get(`booster-unboost-cardTitleColor-${guildId}`)    ?? '#ffffff',
        unboostCardUsernameColor:client.database.get(`booster-unboost-cardUsernameColor-${guildId}`) ?? '#ED4245',
        unboostCardMsgColor:     client.database.get(`booster-unboost-cardMsgColor-${guildId}`)      ?? '#cccccc',
        unboostCardFont:         client.database.get(`booster-unboost-cardFont-${guildId}`)          ?? 'impact',

        autoroleEnabled:    getBool(client, `booster-autorole-enabled-${guildId}`,   false),
        autoroleRoleId:     client.database.get(`booster-autorole-role-${guildId}`)  ?? null,
        autoremoveEnabled:  getBool(client, `booster-autoremove-enabled-${guildId}`, false),
    };
}

// ── Placeholder parsers ────────────────────────────────────────────────────
// Untuk description & plain text: {member} → mention <@ID>
function parse(str, member, guild) {
    return str
        .replace(/{member}/g,   `<@${member.id}>`)
        .replace(/{username}/g, member.user.username)
        .replace(/{tag}/g,      member.user.tag)
        .replace(/{server}/g,   guild.name)
        .replace(/{boosts}/g,   String(guild.premiumSubscriptionCount ?? 0))
        .replace(/{level}/g,    String(guild.premiumTier));
}

// Untuk title & footer: {member} → @displayName (mention tidak render di embed title/footer)
function parseTitle(str, member, guild) {
    const displayName = member.displayName || member.user.username;
    return str
        .replace(/{member}/g,   `@${displayName}`)
        .replace(/{username}/g, member.user.username)
        .replace(/{tag}/g,      member.user.tag)
        .replace(/{server}/g,   guild.name)
        .replace(/{boosts}/g,   String(guild.premiumSubscriptionCount ?? 0))
        .replace(/{level}/g,    String(guild.premiumTier));
}

// ── Event ──────────────────────────────────────────────────────────────────
module.exports = new Event({
    event: 'guildMemberUpdate',
    once: false,

    /**
     * @param {import("../../client/DiscordBot")} client
     * @param {import("discord.js").GuildMember} oldMember
     * @param {import("discord.js").GuildMember} newMember
     */
    run: safeRun('[onBoosterUpdate]', async (client, oldMember, newMember) => {
        const { guild } = newMember;
        const cfg = getConfig(client, guild.id);

        const wasBooster = oldMember.premiumSince !== null;
        const isBooster  = newMember.premiumSince !== null;

        const justBoosted   = !wasBooster && isBooster;
        const justUnboosted = wasBooster  && !isBooster;

        // Detect extra boost from member who is already boosting (premiumSince unchanged but count went up)
        let isExtraBoost = false;
        if (wasBooster && isBooster) {
            const countBefore = guild.premiumSubscriptionCount ?? 0;
            await guild.fetch().catch(() => null);
            const countAfter = guild.premiumSubscriptionCount ?? 0;
            isExtraBoost = countAfter > countBefore;
        }

        if (!justBoosted && !justUnboosted && !isExtraBoost) return;

        // ══════════════════════════════════════════════════════════════════
        // ── BOOST ─────────────────────────────────────────────────────────
        // ══════════════════════════════════════════════════════════════════
        if (justBoosted || isExtraBoost) {

            // Fetch fresh guild data so premiumSubscriptionCount reflects the new boost
            // (for isExtraBoost the fetch was already done above)
            if (justBoosted) await guild.fetch().catch(() => null);

            // ── Autorole: berikan role booster ─────────────────────────────
            if (justBoosted && cfg.autoroleEnabled && cfg.autoroleRoleId) {
                const role     = guild.roles.cache.get(cfg.autoroleRoleId);
                const botMember = guild.members.me;

                if (
                    role &&
                    botMember &&
                    botMember.permissions.has('ManageRoles') &&
                    botMember.roles.highest.comparePositionTo(role) > 0
                ) {
                    await newMember.roles.add(role, 'Autorole Booster').catch(err => logError('[onBoosterUpdate][boost] autorole add failed:', err));
                }
            }

            // ── Notifikasi boost ───────────────────────────────────────────
            if (!cfg.boostEnabled || !cfg.boostChannelId) return;

            const channel = guild.channels.cache.get(cfg.boostChannelId);
            if (!channel || !channel.isTextBased()) return;

            // Generate boost card
            let boostCard = null;
            if (cfg.boostCardEnabled) {
                try {
                    const buf = await generateCardAsync({
                        avatarUrl:      newMember.user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
                        username:       newMember.user.username,
                        serverName:     guild.name,
                        welcomeText:    cfg.boostCardWelcomeText,
                        subText:        cfg.boostCardSubText
                            .replace(/{server}/gi, guild.name)
                            .replace(/{boosts}/gi, String(guild.premiumSubscriptionCount ?? 0))
                            .replace(/{level}/gi,  String(guild.premiumTier)),
                        bgColor:        cfg.boostCardBgColor,
                        bgColor2:       cfg.boostCardBgColor2,
                        accentColor:    cfg.boostCardAccentColor,
                        avatarShape:    cfg.boostCardAvatarShape,
                        bgType:         cfg.boostCardBgType,
                        bgImageUrl:     cfg.boostCardBgImageUrl,
                        overlayColor:   cfg.boostCardOverlayColor,
                        overlayOpacity: cfg.boostCardOverlayOpacity,
                        titleColor:     cfg.boostCardTitleColor,
                        usernameColor:  cfg.boostCardUsernameColor,
                        messageColor:   cfg.boostCardMsgColor,
                        fontFamily:     cfg.boostCardFont,
                    });
                    boostCard = new AttachmentBuilder(Buffer.from(buf), { name: 'boost-card.png' });
                } catch (err) { logError('[onBoosterUpdate][boost] Card generation failed:', err); }
            }

            if (cfg.boostMessageType === 'plain') {
                const text = cfg.boostPlainText ? parse(cfg.boostPlainText, newMember, guild) : '';
                const payload = {};
                if (text) { payload.content = text; payload.allowedMentions = { users: [newMember.id] }; }
                if (boostCard) payload.files = [boostCard];
                if (payload.content || payload.files) await channel.send(payload).catch(e => logError('[onBoosterUpdate][boost] plain send failed:', e));
            } else {
                const embed = new EmbedBuilder()
                    .setColor(cfg.boostColor)
                    .setTimestamp();
                const parsedBoostTitle = parseTitle(cfg.boostTitle, newMember, guild);
                if (parsedBoostTitle) embed.setTitle(parsedBoostTitle);
                const parsedBoostDesc = parse(cfg.boostDescription, newMember, guild);
                if (parsedBoostDesc) embed.setDescription(parsedBoostDesc);
                if (cfg.boostShowThumbnail) embed.setThumbnail(newMember.user.displayAvatarURL({ dynamic: true, size: 256 }));
                const boostFields = [];
                if (cfg.boostShowMember)      boostFields.push({ name: '👤 Member',       value: newMember.user.tag,                                             inline: true });
                if (cfg.boostShowMulaiBoost)  boostFields.push({ name: '🚀 Boosting Since', value: `<t:${Math.floor(newMember.premiumSinceTimestamp / 1000)}:R>`, inline: true });
                if (cfg.boostShowTotalBoost)  boostFields.push({ name: '✨ Total Boost',  value: `**${guild.premiumSubscriptionCount ?? 0}** boost`,             inline: true });
                if (cfg.boostShowLevelServer) boostFields.push({ name: '🏅 Level Server', value: `Level **${guild.premiumTier}**`,                              inline: true });
                if (boostFields.length) embed.addFields(...boostFields);
                if (cfg.boostFooter) embed.setFooter({ text: parseTitle(cfg.boostFooter, newMember, guild) });
                if (boostCard) embed.setImage('attachment://boost-card.png');
                const payload = { embeds: [embed] };
                if (boostCard) payload.files = [boostCard];
                await channel.send(payload).catch(async (err) => {
                    if (boostCard) {
                        logError('[onBoosterUpdate][boost] embed+card send failed (retrying without card):', err);
                        if (embed.data.image) delete embed.data.image;
                        await channel.send({ embeds: [embed] }).catch(e => logError('[onBoosterUpdate][boost] embed send failed:', e));
                    } else {
                        logError('[onBoosterUpdate][boost] embed send failed:', err);
                    }
                });
            }
        }

        // ══════════════════════════════════════════════════════════════════
        // ── UNBOOST ───────────────────────────────────────────────────────
        // ══════════════════════════════════════════════════════════════════
        if (justUnboosted) {

            // Fetch fresh guild data so premiumSubscriptionCount reflects the removed boost
            await guild.fetch().catch(() => null);

            // ── Autorole: cabut role booster ───────────────────────────────
            if (cfg.autoremoveEnabled && cfg.autoroleRoleId) {
                const role     = guild.roles.cache.get(cfg.autoroleRoleId);
                const botMember = guild.members.me;

                if (
                    role &&
                    botMember &&
                    botMember.permissions.has('ManageRoles') &&
                    botMember.roles.highest.comparePositionTo(role) > 0 &&
                    newMember.roles.cache.has(role.id)
                ) {
                    await newMember.roles.remove(role, 'Unboost — Remove Booster Autorole').catch(err => logError('[onBoosterUpdate][unboost] autorole remove failed:', err));
                }
            }

            // ── Notifikasi unboost ─────────────────────────────────────────
            if (!cfg.unboostEnabled || !cfg.unboostChannelId) return;

            const channel = guild.channels.cache.get(cfg.unboostChannelId);
            if (!channel || !channel.isTextBased()) return;

            // Generate unboost card
            let unboostCard = null;
            if (cfg.unboostCardEnabled) {
                try {
                    const buf = await generateCardAsync({
                        avatarUrl:      newMember.user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
                        username:       newMember.user.username,
                        serverName:     guild.name,
                        welcomeText:    cfg.unboostCardWelcomeText,
                        subText:        cfg.unboostCardSubText
                            .replace(/{server}/gi, guild.name)
                            .replace(/{boosts}/gi, String(guild.premiumSubscriptionCount ?? 0))
                            .replace(/{level}/gi,  String(guild.premiumTier)),
                        bgColor:        cfg.unboostCardBgColor,
                        bgColor2:       cfg.unboostCardBgColor2,
                        accentColor:    cfg.unboostCardAccentColor,
                        avatarShape:    cfg.unboostCardAvatarShape,
                        bgType:         cfg.unboostCardBgType,
                        bgImageUrl:     cfg.unboostCardBgImageUrl,
                        overlayColor:   cfg.unboostCardOverlayColor,
                        overlayOpacity: cfg.unboostCardOverlayOpacity,
                        titleColor:     cfg.unboostCardTitleColor,
                        usernameColor:  cfg.unboostCardUsernameColor,
                        messageColor:   cfg.unboostCardMsgColor,
                        fontFamily:     cfg.unboostCardFont,
                    });
                    unboostCard = new AttachmentBuilder(Buffer.from(buf), { name: 'unboost-card.png' });
                } catch (err) { logError('[onBoosterUpdate][unboost] Card generation failed:', err); }
            }

            if (cfg.unboostMessageType === 'plain') {
                const text = cfg.unboostPlainText ? parse(cfg.unboostPlainText, newMember, guild) : '';
                const payload = {};
                if (text) { payload.content = text; payload.allowedMentions = { users: [newMember.id] }; }
                if (unboostCard) payload.files = [unboostCard];
                if (payload.content || payload.files) await channel.send(payload).catch(e => logError('[onBoosterUpdate][unboost] plain send failed:', e));
            } else {
                const embed = new EmbedBuilder()
                    .setColor(cfg.unboostColor)
                    .setTimestamp();
                const parsedUnboostTitle = parseTitle(cfg.unboostTitle, newMember, guild);
                if (parsedUnboostTitle) embed.setTitle(parsedUnboostTitle);
                const parsedUnboostDesc = parse(cfg.unboostDescription, newMember, guild);
                if (parsedUnboostDesc) embed.setDescription(parsedUnboostDesc);
                if (cfg.unboostShowThumbnail) embed.setThumbnail(newMember.user.displayAvatarURL({ dynamic: true, size: 256 }));
                const unboostFields = [];
                if (cfg.unboostShowMember)      unboostFields.push({ name: '👤 Member',       value: newMember.user.tag,                                 inline: true });
                if (cfg.unboostShowTotalBoost)  unboostFields.push({ name: '✨ Total Boost',  value: `**${guild.premiumSubscriptionCount ?? 0}** boost`, inline: true });
                if (cfg.unboostShowLevelServer) unboostFields.push({ name: '🏅 Level Server', value: `Level **${guild.premiumTier}**`,                    inline: true });
                if (unboostFields.length) embed.addFields(...unboostFields);
                if (cfg.unboostFooter) embed.setFooter({ text: parseTitle(cfg.unboostFooter, newMember, guild) });
                if (unboostCard) embed.setImage('attachment://unboost-card.png');
                const payload = { embeds: [embed] };
                if (unboostCard) payload.files = [unboostCard];
                await channel.send(payload).catch(async (err) => {
                    if (unboostCard) {
                        logError('[onBoosterUpdate][unboost] embed+card send failed (retrying without card):', err);
                        if (embed.data.image) delete embed.data.image;
                        await channel.send({ embeds: [embed] }).catch(e => logError('[onBoosterUpdate][unboost] embed send failed:', e));
                    } else {
                        logError('[onBoosterUpdate][unboost] embed send failed:', err);
                    }
                });
            }
        }
    })
}).toJSON();

const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const Event = require("../../structure/Event");

// In-memory spam tracker: Map<guildId, Map<userId, { count, firstAt }>>
const spamTracker = new Map();

const URL_REGEX    = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/gi;
const INVITE_REGEX = /discord(?:\.gg|app\.com\/invite|\.com\/invite)\/[a-zA-Z0-9-]+/gi;

function getBool(client, key, def = false) {
    const raw = client.database.get(key);
    if (raw === null || raw === undefined) return def;
    return raw !== 'false' && raw !== false && raw !== 0;
}

function getJSON(client, key, def = null) {
    const raw = client.database.get(key);
    if (!raw) return def;
    try { return JSON.parse(raw); } catch { return def; }
}

function formatDuration(ms) {
    if (ms >= 3_600_000) return `${ms / 3_600_000} jam`;
    if (ms >= 60_000)    return `${ms / 60_000} menit`;
    return `${ms / 1_000} detik`;
}

async function applyAction(client, message, member, action, reason, muteDuration, logChannel) {
    // Cek permission Manage Messages sebelum mencoba hapus
    const botMember = message.guild.members.me;
    const canDelete = botMember
        ? message.channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageMessages)
        : false;

    if (!canDelete) {
        console.warn(`[Automod] Bot tidak punya ManageMessages di #${message.channel.name} (${message.guild.name}). Pesan tidak bisa dihapus.`);
        if (logChannel?.isTextBased()) {
            await logChannel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#FEE75C')
                        .setTitle('⚠️ Automod — Gagal Hapus Pesan')
                        .setDescription(
                            `Bot tidak punya izin **Manage Messages** di ${message.channel}.\n` +
                            `Pelanggaran terdeteksi tapi pesan tidak bisa dihapus.\n` +
                            `**Alasan:** ${reason}\n**Member:** ${member}`
                        )
                        .setTimestamp()
                ]
            }).catch(() => null);
        }
        return;
    }

    const logEmbed = new EmbedBuilder()
        .setColor('#ED4245')
        .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
        .setDescription(`**Alasan:** ${reason}`)
        .addFields(
            { name: '👤 Member',    value: `${member} (${member.user.tag})`, inline: true },
            { name: '📌 Channel',   value: `${message.channel}`,             inline: true },
            { name: '⚔️ Tindakan', value: action.toUpperCase(),             inline: true },
            { name: '📝 Pesan',     value: message.content
                ? `\`\`\`${message.content.slice(0, 300)}\`\`\``
                : '*[Tidak ada teks]*' }
        )
        .setTimestamp();

    // Hapus pesan terlebih dahulu
    await message.delete().catch(() => null);

    switch (action) {
        case 'warn':
            await member.user.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#FEE75C')
                        .setTitle('⚠️ Peringatan Automod')
                        .setDescription(`Pesanmu di **${message.guild.name}** telah dihapus.\n**Alasan:** ${reason}`)
                        .setTimestamp()
                ]
            }).catch(() => null);
            logEmbed.setTitle('⚠️ Automod — Warn');
            break;

        case 'mute': {
            const canTimeout = botMember?.permissions.has(PermissionFlagsBits.ModerateMembers) ?? false;
            if (canTimeout) {
                const durationMs = muteDuration ?? 600_000; // default 10 menit
                await member.timeout(durationMs, `Automod: ${reason}`).catch(() => null);
                await member.user.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#ED4245')
                            .setTitle('🔇 Kamu di-Timeout (Automod)')
                            .setDescription(
                                `Kamu di-timeout di **${message.guild.name}** selama **${formatDuration(durationMs)}**.\n` +
                                `**Alasan:** ${reason}`
                            )
                            .setTimestamp()
                    ]
                }).catch(() => null);
                logEmbed.setTitle(`🔇 Automod — Timeout (${formatDuration(durationMs)})`);
            } else {
                console.warn(`[Automod] Bot tidak punya ModerateMembers di ${message.guild.name}. Timeout tidak bisa dilakukan.`);
                logEmbed.setTitle('🔇 Automod — Timeout Gagal (Kurang Permission)');
                logEmbed.setColor('#FEE75C');
            }
            break;
        }

        case 'kick':
            await member.user.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('👢 Kamu di-Kick (Automod)')
                        .setDescription(`Kamu di-kick dari **${message.guild.name}**.\n**Alasan:** ${reason}`)
                        .setTimestamp()
                ]
            }).catch(() => null);
            await member.kick(`Automod: ${reason}`).catch(() => null);
            logEmbed.setTitle('👢 Automod — Kick');
            break;

        case 'ban':
            await member.user.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('🔨 Kamu di-Ban (Automod)')
                        .setDescription(`Kamu di-ban dari **${message.guild.name}**.\n**Alasan:** ${reason}`)
                        .setTimestamp()
                ]
            }).catch(() => null);
            await member.ban({ deleteMessageSeconds: 86400, reason: `Automod: ${reason}` }).catch(() => null);
            logEmbed.setTitle('🔨 Automod — Ban');
            break;

        default: // 'delete'
            logEmbed.setTitle('🗑️ Automod — Pesan Dihapus');
            break;
    }

    if (logChannel?.isTextBased()) {
        await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
    }
}

module.exports = new Event({
    event: 'messageCreate',
    once: false,

    /**
     * @param {import("../../client/DiscordBot")} __client__
     * @param {import("discord.js").Message} message
     */
    run: async (__client__, message) => {
        if (!message.guild || message.author.bot || !message.member) return;

        const { guild, member, channel } = message;
        const guildId = guild.id;

        // Abaikan administrator
        if (member.permissions.has('Administrator')) return;

        // Cek whitelist channel
        const wlChannels = getJSON(__client__, `automod-wl-channels-${guildId}`, []);
        if (wlChannels.includes(channel.id)) return;

        // Cek whitelist role
        const wlRoles = getJSON(__client__, `automod-wl-roles-${guildId}`, []);
        if (member.roles.cache.some(r => wlRoles.includes(r.id))) return;

        const action      = __client__.database.get(`automod-action-${guildId}`)          ?? 'delete';
        const durationRaw = __client__.database.get(`automod-mute-duration-${guildId}`);
        const muteDuration = durationRaw ? parseInt(durationRaw) : 600_000;
        const logChId     = __client__.database.get(`automod-auditlog-${guildId}`)         ?? null;
        const logChannel  = logChId ? guild.channels.cache.get(logChId) : null;

        const content = message.content || '';

        // ── Anti-Spam ───────────────────────────────────────────────────────
        const spamCfg = getJSON(__client__, `automod-spam-${guildId}`, { enabled: false, limit: 5, interval: 5 });
        if (spamCfg.enabled) {
            if (!spamTracker.has(guildId)) spamTracker.set(guildId, new Map());
            const guildMap = spamTracker.get(guildId);
            const userId   = member.id;
            const now      = Date.now();
            const window   = spamCfg.interval * 1000;
            const existing = guildMap.get(userId);

            if (!existing || now - existing.firstAt > window) {
                guildMap.set(userId, { count: 1, firstAt: now });
            } else {
                existing.count++;
                if (existing.count >= spamCfg.limit) {
                    guildMap.delete(userId);
                    return applyAction(__client__, message, member, action, 'Spam pesan terdeteksi', muteDuration, logChannel);
                }
            }
        }

        // ── Anti-Link ───────────────────────────────────────────────────────
        if (getBool(__client__, `automod-antilink-${guildId}`)) {
            URL_REGEX.lastIndex = 0;
            if (URL_REGEX.test(content)) {
                return applyAction(__client__, message, member, action, 'Pesan mengandung link', muteDuration, logChannel);
            }
        }

        // ── Anti-Invite ─────────────────────────────────────────────────────
        if (getBool(__client__, `automod-antiinvite-${guildId}`)) {
            INVITE_REGEX.lastIndex = 0;
            if (INVITE_REGEX.test(content)) {
                return applyAction(__client__, message, member, action, 'Pesan mengandung invite Discord', muteDuration, logChannel);
            }
        }

        // ── Anti Mass-Mention ───────────────────────────────────────────────
        const mentionCfg = getJSON(__client__, `automod-massmention-${guildId}`, { enabled: false, limit: 5 });
        if (mentionCfg.enabled) {
            const mentionCount = message.mentions.users.size + message.mentions.roles.size;
            if (mentionCount >= mentionCfg.limit) {
                return applyAction(__client__, message, member, action,
                    `Mass mention terdeteksi (${mentionCount} mention)`, muteDuration, logChannel);
            }
        }

        // ── Anti-Attachment ─────────────────────────────────────────────────
        if (getBool(__client__, `automod-attachments-${guildId}`)) {
            if (message.attachments.size > 0) {
                return applyAction(__client__, message, member, action, 'Pesan mengandung file/attachment', muteDuration, logChannel);
            }
        }

        // ── Banned Words ────────────────────────────────────────────────────
        const words = getJSON(__client__, `automod-words-${guildId}`, []);
        if (words.length > 0) {
            const lower = content.toLowerCase();
            const found = words.find(w => lower.includes(w));
            if (found) {
                return applyAction(__client__, message, member, action,
                    `Pesan mengandung kata terlarang: \`${found}\``, muteDuration, logChannel);
            }
        }
    }
}).toJSON();

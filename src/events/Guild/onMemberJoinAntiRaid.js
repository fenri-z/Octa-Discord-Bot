const { EmbedBuilder } = require("discord.js");
const Event = require("../../structure/Event");

// In-memory raid tracker: Map<guildId, { joins: number[], locked: boolean }>
const raidTracker = new Map();

function getJSON(client, key, def = null) {
    const raw = client.database.get(key);
    if (!raw) return def;
    try { return JSON.parse(raw); } catch { return def; }
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
        const guildId = guild.id;

        const cfg = getJSON(__client__, `automod-antiraid-${guildId}`, { enabled: false, joinLimit: 10, interval: 10 });
        if (!cfg.enabled) return;

        if (!raidTracker.has(guildId)) raidTracker.set(guildId, { joins: [], locked: false });
        const tracker = raidTracker.get(guildId);
        const now     = Date.now();
        const window  = cfg.interval * 1000;

        // Bersihkan join di luar time window
        tracker.joins = tracker.joins.filter(t => now - t < window);
        tracker.joins.push(now);

        if (!tracker.locked && tracker.joins.length >= cfg.joinLimit) {
            tracker.locked = true;

            const logChId    = __client__.database.get(`automod-auditlog-${guildId}`) ?? null;
            const logChannel = logChId ? guild.channels.cache.get(logChId) : null;

            // Tingkatkan verifikasi server ke level tertinggi
            try {
                await guild.setVerificationLevel(4, 'Automod Anti-Raid diaktifkan');
            } catch { /* tidak ada izin */ }

            if (logChannel?.isTextBased()) {
                await logChannel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#ED4245')
                            .setTitle('🚨 Anti-Raid — Serangan Terdeteksi!')
                            .setDescription([
                                `**${tracker.joins.length}** member bergabung dalam **${cfg.interval}** detik terakhir.`,
                                '',
                                '**Tindakan Diambil:**',
                                '🔒 Verifikasi server ditingkatkan ke level **Highest**',
                                '⏳ Mode darurat berlangsung selama **5 menit**',
                                '',
                                '> Tinjau daftar member terbaru dan kick yang mencurigakan.'
                            ].join('\n'))
                            .setTimestamp()
                    ]
                }).catch(() => null);
            }

            // Kembalikan verifikasi ke normal setelah 5 menit
            setTimeout(async () => {
                tracker.locked = false;
                tracker.joins  = [];
                try {
                    await guild.setVerificationLevel(1, 'Automod Anti-Raid selesai');
                } catch { /* tidak ada izin */ }

                if (logChannel?.isTextBased()) {
                    await logChannel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#57F287')
                                .setTitle('✅ Anti-Raid — Mode Darurat Selesai')
                                .setDescription('Verifikasi server dikembalikan ke level normal.\nPantau server jika serangan berlanjut.')
                                .setTimestamp()
                        ]
                    }).catch(() => null);
                }
            }, 5 * 60 * 1000);
        }
    }
}).toJSON();

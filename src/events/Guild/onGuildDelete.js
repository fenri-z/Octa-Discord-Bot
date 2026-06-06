const { warn, success } = require('../../utils/Console');
const Event = require('../../structure/Event');

module.exports = new Event({
    event: 'guildDelete',
    once: false,

    run: async (client, guild) => {
        const guildId = guild.id;

        warn(`[guildDelete] Bot left server: ${guild.name} (${guildId}). Data retained for 14 days.`);

        try {
            // Bersihkan invite cache di memori (bukan database)
            if (client.inviteCache && client.inviteCache.has(guildId)) {
                client.inviteCache.delete(guildId);
            }

            // Tandai guild ini untuk penghapusan jika bot tidak kembali dalam 14 hari
            if (client.guildRetentionManager) {
                client.guildRetentionManager.markGuildLeft(guildId);
            }

            success(`[guildDelete] ${guild.name} — invite cache cleared. Data will be purged in 14 days if bot doesn't rejoin ✓`);
        } catch (err) {
            warn(`[guildDelete] ${guild.name} — error saat guildDelete: ${err.message}`);
        }
    }
}).toJSON();

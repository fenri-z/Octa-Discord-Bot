const { warn, success } = require('../../utils/Console');
const Event = require('../../structure/Event');

module.exports = new Event({
    event: 'guildDelete',
    once: false,

    run: async (client, guild) => {
        const guildId = guild.id;

        warn(`[guildDelete] Bot left server: ${guild.name} (${guildId}). Settings data preserved.`);

        try {
            // Bersihkan invite cache di memori (bukan database)
            if (client.inviteCache && client.inviteCache.has(guildId)) {
                client.inviteCache.delete(guildId);
            }

            success(`[guildDelete] ${guild.name} — invite cache cleared. All database settings preserved ✓`);
        } catch (err) {
            warn(`[guildDelete] ${guild.name} — error saat guildDelete: ${err.message}`);
        }
    }
}).toJSON();

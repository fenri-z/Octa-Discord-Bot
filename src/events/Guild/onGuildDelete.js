const { warn, success } = require('../../utils/Console');
const Event = require('../../structure/Event');

module.exports = new Event({
    event: 'guildDelete',
    once: false,

    run: async (client, guild) => {
        const guildId = guild.id;

        warn(`[guildDelete] Bot keluar dari server: ${guild.name} (${guildId}). Data pengaturan dipertahankan.`);

        try {
            // Bersihkan invite cache di memori (bukan database)
            if (client.inviteCache && client.inviteCache.has(guildId)) {
                client.inviteCache.delete(guildId);
            }

            success(`[guildDelete] ${guild.name} — invite cache dibersihkan. Semua pengaturan database dipertahankan ✓`);
        } catch (err) {
            warn(`[guildDelete] ${guild.name} — error saat guildDelete: ${err.message}`);
        }
    }
}).toJSON();

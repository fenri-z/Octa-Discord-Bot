const Event = require('../../structure/Event');
const { getServerStatsConfig, parseLabel } = require('../../utils/serverStatsHelper');

/**
 * Ekstrak template dari nama channel yang sudah ter-render.
 *
 * Cara kerja:
 *   template lama : "👥 Total Member: {count}"
 *   nama lama     : "👥 Total Member: 42"
 *   nama baru     : "👥 Anggota: 42"
 *   template baru : "👥 Anggota: {count}"
 *
 * Logika: cari substring angka dari nama lama (hasil parseLabel),
 * lalu ganti substring tersebut di nama BARU dengan "{count}".
 * Kalau angka tidak ditemukan di nama baru, simpan nama baru apa adanya
 * tanpa {count} (user sengaja hapus angka → ikuti saja).
 *
 * @param {string} oldTemplate - template yang tersimpan di database
 * @param {number} count       - angka member saat ini
 * @param {string} newName     - nama channel baru dari Discord
 * @returns {string}           - template baru untuk disimpan ke database
 */
function deriveTemplate(oldTemplate, count, newName) {
    if (count === null || count === undefined) return newName;

    const countStr = String(count);

    // Kalau nama baru masih mengandung angka yang sama → ganti dengan {count}
    const idx = newName.indexOf(countStr);
    if (idx !== -1) {
        return newName.slice(0, idx) + '{count}' + newName.slice(idx + countStr.length);
    }

    // Angka tidak ada di nama baru → user sengaja hilangkan, simpan apa adanya
    return newName;
}

module.exports = new Event({
    event: 'channelUpdate',
    once: false,

    /**
     * @param {import('../../client/DiscordBot')} client
     * @param {import('discord.js').GuildChannel} oldChannel
     * @param {import('discord.js').GuildChannel} newChannel
     */
    run: async (client, oldChannel, newChannel) => {
        // Hanya proses kalau nama berubah
        if (oldChannel.name === newChannel.name) return;

        const guild   = newChannel.guild;
        const guildId = guild.id;
        const cfg     = getServerStatsConfig(client, guildId);

        // Tentukan channel mana yang di-rename
        const channelId = newChannel.id;
        let labelKey, count;

        if (channelId === cfg.totalId) {
            // Hitung total member untuk derive template
            await guild.members.fetch().catch(() => null);
            const all = guild.members.cache;
            count    = all.size;
            labelKey = `serverstats-total-label-${guildId}`;

        } else if (channelId === cfg.humanId) {
            await guild.members.fetch().catch(() => null);
            const all = guild.members.cache;
            count    = all.filter(m => !m.user.bot).size;
            labelKey = `serverstats-human-label-${guildId}`;

        } else if (channelId === cfg.botId) {
            await guild.members.fetch().catch(() => null);
            const all = guild.members.cache;
            count    = all.filter(m => m.user.bot).size;
            labelKey = `serverstats-bot-label-${guildId}`;

        } else if (channelId === cfg.categoryId) {
            // Category tidak punya count — simpan nama baru langsung sebagai label
            client.database.set(`serverstats-category-label-${guildId}`, newChannel.name);
            return;

        } else {
            // Bukan channel serverstats, abaikan
            return;
        }

        // Derive template baru dari nama baru
        const oldTemplate = client.database.get(labelKey)
            ?? parseLabel(cfg[labelKey.includes('total') ? 'totalLabel' : labelKey.includes('human') ? 'humanLabel' : 'botLabel'], count);

        const newTemplate = deriveTemplate(oldTemplate, count, newChannel.name);

        // Simpan template baru ke database
        client.database.set(labelKey, newTemplate);
    }
}).toJSON();

const { warn } = require('./Console');

/**
 * Utility untuk fitur Server Stats.
 * Dipisahkan agar bisa di-import dari command maupun event
 * tanpa konflik module.exports.
 */

/**
 * Format label dengan mengganti placeholder {count} dengan angka.
 * @param {string} template
 * @param {number} count
 * @returns {string}
 */
function parseLabel(template, count) {
    return template.replace(/\{count\}/g, String(count));
}

/**
 * Update nama voice channel jika teks berbeda (hindari rate limit Discord).
 * @param {import('discord.js').VoiceChannel|null} channel
 * @param {string} newName
 */
async function safeRename(channel, newName) {
    if (!channel || channel.name === newName) return;
    await channel.setName(newName).catch(err => warn(`[ServerStats] setName failed for #${channel.name}: ${err.message}`));
}

/**
 * Ambil konfigurasi serverstats dari database untuk guild tertentu.
 * @param {import('../client/DiscordBot')} client
 * @param {string} guildId
 */
function getServerStatsConfig(client, guildId) {
    const raw = (key) => client.database.get(key);
    const getBool = (key, def) => {
        const v = raw(key);
        if (v === null || v === undefined) return def;
        if (v === 'false' || v === false || v === 0) return false;
        return true;
    };

    return {
        enabled:       getBool(`serverstats-enabled-${guildId}`, false),
        categoryId:    raw(`serverstats-category-${guildId}`)        ?? null,
        totalId:       raw(`serverstats-total-channel-${guildId}`)   ?? null,
        humanId:       raw(`serverstats-human-channel-${guildId}`)   ?? null,
        botId:         raw(`serverstats-bot-channel-${guildId}`)     ?? null,
        totalLabel:    raw(`serverstats-total-label-${guildId}`)     ?? '👥 Total Member: {count}',
        humanLabel:    raw(`serverstats-human-label-${guildId}`)     ?? '👤 User: {count}',
        botLabel:      raw(`serverstats-bot-label-${guildId}`)       ?? '🤖 Bot: {count}',
        categoryLabel: raw(`serverstats-category-label-${guildId}`)  ?? '📊 Server Stats',
    };
}

/**
 * Hitung member dan perbarui semua channel stats di satu guild.
 * Dipanggil dari event guildMemberAdd / guildMemberRemove.
 * @param {import('../client/DiscordBot')} client
 * @param {import('discord.js').Guild} guild
 */
async function updateStats(client, guild) {
    const cfg = getServerStatsConfig(client, guild.id);
    if (!cfg.enabled) return;

    // Pastikan member cache fresh
    await guild.members.fetch().catch(() => null);

    const allMembers = guild.members.cache;
    const totalCount = allMembers.size;
    const botCount   = allMembers.filter(m => m.user.bot).size;
    const humanCount = totalCount - botCount;

    const totalCh = cfg.totalId ? guild.channels.cache.get(cfg.totalId) : null;
    const humanCh = cfg.humanId ? guild.channels.cache.get(cfg.humanId) : null;
    const botCh   = cfg.botId   ? guild.channels.cache.get(cfg.botId)   : null;

    await Promise.all([
        safeRename(totalCh, parseLabel(cfg.totalLabel, totalCount)),
        safeRename(humanCh, parseLabel(cfg.humanLabel, humanCount)),
        safeRename(botCh,   parseLabel(cfg.botLabel,   botCount)),
    ]);
}

module.exports = { updateStats, getServerStatsConfig, parseLabel, safeRename };

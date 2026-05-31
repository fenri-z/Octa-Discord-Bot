/**
 * resolveGuildOption.js
 * 
 * Helper untuk me-resolve input channel/role dari string (type: 3)
 * yang bisa berupa mention (#channel, @role, <#id>, <@&id>) atau ID murni.
 * 
 * Dibutuhkan karena type: 7 (CHANNEL) dan type: 8 (ROLE) tidak muncul
 * di DM, sehingga semua opsi channel/role diganti ke type: 3 (STRING).
 */

/**
 * Resolve channel dari input string.
 * Input yang didukung: #channel, <#123>, 123456789
 * 
 * @param {import("discord.js").Guild} guild
 * @param {string|null|undefined} input
 * @returns {import("discord.js").GuildBasedChannel|null}
 */
function resolveChannel(guild, input) {
    if (!input || !guild) return null;
    // Hapus semua karakter mention: <#123> → 123
    const id = input.replace(/[<#>]/g, '').trim();
    if (!id) return null;
    return guild.channels.cache.get(id) ?? null;
}

/**
 * Resolve role dari input string.
 * Input yang didukung: @role, <@&123>, 123456789
 * 
 * @param {import("discord.js").Guild} guild
 * @param {string|null|undefined} input
 * @returns {import("discord.js").Role|null}
 */
function resolveRole(guild, input) {
    if (!input || !guild) return null;
    // Hapus semua karakter mention: <@&123> → 123
    const id = input.replace(/[<@&>]/g, '').trim();
    if (!id) return null;
    return guild.roles.cache.get(id) ?? null;
}

module.exports = { resolveChannel, resolveRole };

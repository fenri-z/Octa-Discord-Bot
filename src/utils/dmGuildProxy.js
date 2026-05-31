const config = require("../config");

/**
 * Cek apakah user adalah owner atau developer bot.
 * @param {string} userId
 * @returns {boolean}
 */
function isDeveloper(userId) {
    if (userId === config.users.ownerId) return true;
    if (Array.isArray(config.users.developers) && config.users.developers.includes(userId)) return true;
    return false;
}

/**
 * Buat Proxy di atas interaction agar interaction.guild, interaction.guildId,
 * dan interaction.member mengarah ke selectedGuild.
 * Juga override options.getRole() dan options.getChannel() agar bisa resolve
 * dari string ID saat command dipakai lewat DM.
 *
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 * @param {import("discord.js").Guild} selectedGuild
 * @returns {import("discord.js").ChatInputCommandInteraction}
 */
function createDMProxy(interaction, selectedGuild) {

    // ── Buat options proxy yang menggantikan getRole/getChannel ──────────
    const proxiedOptions = new Proxy(interaction.options, {
        get(target, prop) {

            // ── getRole: coba native dulu (selalu null di DM), fallback ke string ID
            if (prop === 'getRole') {
                return (name, required) => {
                    // Di DM tidak ada role picker → user memasukkan string ID
                    const rawId = target.getString(name, required);
                    if (!rawId) return null;
                    const cleanId = rawId.replace(/[<@&>]/g, '').trim();
                    const role = selectedGuild.roles.cache.get(cleanId);
                    if (!role && required) return null;
                    return role ?? null;
                };
            }

            // ── getChannel: coba native dulu, fallback ke string ID
            if (prop === 'getChannel') {
                return (name, required) => {
                    const rawId = target.getString(name, required);
                    if (!rawId) return null;
                    const cleanId = rawId.replace(/[<#>]/g, '').trim();
                    const ch = selectedGuild.channels.cache.get(cleanId);
                    if (!ch && required) return null;
                    return ch ?? null;
                };
            }

            const val = target[prop];
            return typeof val === 'function' ? val.bind(target) : val;
        }
    });

    // ── Buat interaction proxy utama ─────────────────────────────────────
    return new Proxy(interaction, {
        get(target, prop) {
            if (prop === 'guild')    return selectedGuild;
            if (prop === 'guildId')  return selectedGuild.id;
            if (prop === 'inGuild')  return () => true;
            if (prop === 'options')  return proxiedOptions;

            if (prop === 'member') {
                return selectedGuild.members.cache.get(target.user.id) ?? null;
            }

            const val = target[prop];
            return typeof val === 'function' ? val.bind(target) : val;
        }
    });
}

module.exports = { isDeveloper, createDMProxy };

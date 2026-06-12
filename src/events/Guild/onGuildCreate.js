const { success, warn } = require('../../utils/Console');
const Event = require('../../structure/Event');
const { safeRun } = require('../../utils/logError');

const DEV_ONLY_COMMANDS = new Set(['server', 'eval', 'reload', 'components', 'show-modal', 'autocomplete', 'restart', 'offline']);

module.exports = new Event({
    event: 'guildCreate',
    once: false,

    run: safeRun('[onGuildCreate]', async (client, guild) => {
        // 1. Fetch cache
        await Promise.all([
            guild.channels.fetch().catch(() => null),
            guild.roles.fetch().catch(() => null),
            guild.members.fetch().catch(() => null),
        ]);

        // 2. Invite cache
        try {
            const invites = await guild.invites.fetch();
            if (!client.inviteCache) client.inviteCache = new Map();
            client.inviteCache.set(
                guild.id,
                new Map(invites.map(inv => [inv.code, inv.uses]))
            );
        } catch { /* tidak punya izin */ }

        // 3. Deploy — server baru tidak pernah dapat dev-only commands
        try {
            const { _loadCommands, _deployToGuild } = require('../Client/onReady');
            const { publicCmds, devCmds } = _loadCommands();

            const devGuildId   = process.env.DEV_GUILD_ID;
            const isDevGuild   = devGuildId && guild.id === devGuildId;
            const cmdsToDeploy = isDevGuild
                ? [...publicCmds, ...devCmds]
                : publicCmds;

            const registered = await _deployToGuild(client.user.id, guild.id, cmdsToDeploy);
            const tag = isDevGuild ? ' [dev guild]' : '';
            success(`[guildCreate] ${guild.name}${tag} — ${registered.length} command(s) registered ✓`);
        } catch (err) {
            warn(`[guildCreate] ${guild.name} — deploy failed: ${err.message}`);
        }

        // Batalkan penghapusan data jika bot bergabung kembali dalam masa retensi
        if (client.guildRetentionManager) {
            client.guildRetentionManager.cancelRetention(guild.id);
        }

        success(`Joined new guild: ${guild.name} (${guild.id})`);
    })
}).toJSON();

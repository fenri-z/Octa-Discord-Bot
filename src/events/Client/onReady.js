const { success, warn, info } = require('../../utils/Console');
const Event = require('../../structure/Event');
const { readdirSync } = require('fs');
const path = require('path');

// Command yang HANYA muncul di dev guild
const DEV_ONLY_COMMANDS = new Set(['server', 'eval', 'reload', 'components', 'show-modal', 'autocomplete', 'restart', 'offline']);

// ── Load dan pisahkan commands ─────────────────────────────────────────────
function loadCommands() {
    const publicCmds = [];
    const devCmds    = [];
    const commandsPath = path.join(__dirname, '../../commands');

    for (const dir of readdirSync(commandsPath)) {
        const dirPath = path.join(commandsPath, dir);
        let files;
        try { files = readdirSync(dirPath).filter(f => f.endsWith('.js')); }
        catch { continue; }

        for (const file of files) {
            try {
                const mod = require(path.join(dirPath, file));
                if (mod?.__type__ === 1 && mod?.command) {
                    const { aliases, ...cleanCmd } = mod.command;
                    const cmd = { ...cleanCmd, integration_types: [0], contexts: [0] };

                    if (DEV_ONLY_COMMANDS.has(cleanCmd.name)) {
                        devCmds.push(cmd);
                    } else {
                        publicCmds.push(cmd);
                    }
                }
            } catch { /* skip */ }
        }
    }

    return { publicCmds, devCmds };
}

// ── Deploy ke satu guild ───────────────────────────────────────────────────
async function deployToGuild(botUserId, guildId, commands) {
    const res = await fetch(
        `https://discord.com/api/v10/applications/${botUserId}/guilds/${guildId}/commands`,
        {
            method: 'PUT',
            headers: {
                'Authorization': `Bot ${process.env.CLIENT_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(commands),
            signal: AbortSignal.timeout(15_000),
        }
    );

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
    }

    return await res.json();
}

module.exports = new Event({
    event: 'clientReady',
    once: true,

    run: async (__client__, client) => {
        success(
            'Logged in as ' + client.user.displayName +
            ', took ' + ((Date.now() - __client__.login_timestamp) / 1000) + 's.'
        );

        const guilds     = [...client.guilds.cache.values()];
        const devGuildId = process.env.DEV_GUILD_ID;
        const { publicCmds, devCmds } = loadCommands();

        info(`Terdaftar di ${guilds.length} server.`);
        info(`${publicCmds.length} public commands, ${devCmds.length} dev-only commands.`);

        if (!__client__.inviteCache) __client__.inviteCache = new Map();

        const results = await Promise.allSettled(
            guilds.map(async (guild) => {
                // 1. Fetch cache
                await Promise.all([
                    guild.channels.fetch().catch(() => null),
                    guild.roles.fetch().catch(() => null),
                    guild.members.fetch().catch(() => null),
                ]);

                // 2. Invite cache
                try {
                    const invites = await guild.invites.fetch();
                    __client__.inviteCache.set(
                        guild.id,
                        new Map(invites.map(inv => [inv.code, inv.uses]))
                    );
                } catch { /* tidak punya izin */ }

                // 3. Deploy: dev guild dapat semua commands, server lain hanya public
                const isDevGuild = devGuildId && guild.id === devGuildId;
                const cmdsToDeploy = isDevGuild
                    ? [...publicCmds, ...devCmds]
                    : publicCmds;

                const registered = await deployToGuild(client.user.id, guild.id, cmdsToDeploy);
                return { name: guild.name, count: registered.length, dev: isDevGuild };
            })
        );

        let ok = 0, fail = 0;
        for (const result of results) {
            if (result.status === 'fulfilled') {
                ok++;
                const tag = result.value.dev ? ' [dev guild]' : '';
                success(`[deploy] ${result.value.name}${tag} — ${result.value.count} commands ✓`);
            } else {
                fail++;
                warn(`[deploy] Gagal: ${result.reason?.message}`);
            }
        }

        success(`\nInisialisasi selesai: ${ok} server berhasil${fail > 0 ? `, ${fail} gagal` : ''}.`);
        success('Bot siap digunakan!');

        client.user.setPresence({ status: 'online', activities: [{ name: '/help', type: 4 }] });
    }
}).toJSON();

// Ekspor helper agar onGuildCreate bisa pakai tanpa duplikasi kode
module.exports._loadCommands  = loadCommands;
module.exports._deployToGuild = deployToGuild;

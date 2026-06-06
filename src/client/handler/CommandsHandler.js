const { REST, Routes } = require('discord.js');
const { info, error, success } = require('../../utils/Console');
const { readdirSync } = require('fs');
const DiscordBot = require('../DiscordBot');
const ApplicationCommand = require('../../structure/ApplicationCommand');
const MessageCommand = require('../../structure/MessageCommand');

// ─────────────────────────────────────────────────────────────────────────────
// KONFIGURASI VISIBILITAS COMMAND
//
// contexts: [0]   = Guild only  → TIDAK muncul di DM sama sekali
// contexts: [0,1] = Guild + DM
// contexts: [1]   = DM only
//
// Strategi:
//   PUBLIC_COMMANDS  → guild install [0], contexts [0,1] — server + DM semua orang
//   DM_ONLY_COMMANDS → user install [1], contexts [1]    — DM saja (owner/dev)
//   Management       → guild+user install [0,1], contexts [0] — server only,
//                      tidak muncul di DM siapapun
// ─────────────────────────────────────────────────────────────────────────────

// Muncul di server & DM untuk semua orang
const PUBLIC_COMMANDS = new Set(['help', 'ping', 'invites']);

// Hanya muncul di dev guild — tidak pernah didaftarkan secara global
const PRIVATE_COMMANDS = new Set(['server']);

class CommandsHandler {
    client;

    /**
     * @param {DiscordBot} client
     */
    constructor(client) {
        this.client = client;
    }

    load = () => {
        for (const directory of readdirSync('./src/commands/')) {
            for (const file of readdirSync('./src/commands/' + directory).filter((f) => f.endsWith('.js'))) {
                try {
                    /**
                     * @type {ApplicationCommand['data'] | MessageCommand['data']}
                     */
                    const module = require('../../commands/' + directory + '/' + file);

                    if (!module) continue;

                    if (module.__type__ === 2) {
                        if (!module.command || !module.run) {
                            error('Unable to load the message command ' + file);
                            continue;
                        }

                        this.client.collection.message_commands.set(module.command.name, module);

                        if (module.command.aliases && Array.isArray(module.command.aliases)) {
                            module.command.aliases.forEach((alias) => {
                                this.client.collection.message_commands_aliases.set(alias, module.command.name);
                            });
                        }

                        info('Loaded new message command: ' + file);
                    } else if (module.__type__ === 1) {
                        if (!module.command || !module.run) {
                            error('Unable to load the application command ' + file);
                            continue;
                        }

                        this.client.collection.application_commands.set(module.command.name, module);
                        this.client.rest_application_commands_array.push(module.command);

                        info('Loaded new application command: ' + file);
                    } else {
                        error('Invalid command type ' + module.__type__ + ' from command file ' + file);
                    }
                } catch {
                    error('Unable to load a command from the path: ' + 'src/commands/' + directory + '/' + file);
                }
            }
        }

        success(`Successfully loaded ${this.client.collection.application_commands.size} application commands and ${this.client.collection.message_commands.size} message commands.`);
    }

    reload = () => {
        this.client.collection.message_commands.clear();
        this.client.collection.message_commands_aliases.clear();
        this.client.collection.application_commands.clear();
        this.client.rest_application_commands_array = [];

        this.load();
    }

    /**
     * @param {{ enabled: boolean, guildId: string }} development
     * @param {Partial<import('discord.js').RESTOptions>} restOptions
     */
    registerApplicationCommands = async (development, restOptions = null) => {
        const rest = new REST(restOptions ? restOptions : { version: '10' }).setToken(this.client.token);

        // Pisahkan command private (dev-only) dari command publik
        const publicCmds  = [];
        const devOnlyCmds = [];

        for (const cmd of this.client.rest_application_commands_array) {
            if (PRIVATE_COMMANDS.has(cmd.name)) {
                // Hanya didaftarkan ke dev guild — tidak pernah global
                devOnlyCmds.push({
                    ...cmd,
                    integration_types: [0],
                    contexts: [0],
                });
            } else if (PUBLIC_COMMANDS.has(cmd.name)) {
                publicCmds.push({
                    ...cmd,
                    integration_types: [0],
                    contexts: [0, 1],
                });
            } else {
                // Command management (autorole, welcome, pesan, dll):
                // Hanya guild install [0] — bot harus join server terlebih dahulu.
                // User install [1] tidak didukung karena autocomplete butuh guild cache.
                publicCmds.push({
                    ...cmd,
                    integration_types: [0],
                    contexts: [0],
                });
            }
        }

        if (development.enabled) {
            // Mode development: semua command (termasuk dev-only) ke dev guild
            await rest.put(
                Routes.applicationGuildCommands(this.client.user.id, development.guildId),
                { body: [...publicCmds, ...devOnlyCmds] }
            );
        } else {
            // Mode production:
            // 1. Command publik → global
            await rest.put(
                Routes.applicationCommands(this.client.user.id),
                { body: publicCmds }
            );

            // 2. Command dev-only → dev guild saja (wajib isi devGuildId di config)
            if (devOnlyCmds.length > 0) {
                if (!development.devGuildId) {
                    error('[CommandsHandler] PRIVATE_COMMANDS is set but development.devGuildId is not filled in config.js — dev-only commands will not be registered.');
                } else {
                    await rest.put(
                        Routes.applicationGuildCommands(this.client.user.id, development.devGuildId),
                        { body: devOnlyCmds }
                    );
                }
            }
        }
    }
}

module.exports = CommandsHandler;

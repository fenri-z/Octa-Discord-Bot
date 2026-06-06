const { PermissionsBitField, ChannelType, MessageFlags, PermissionFlagsBits } = require("discord.js");
const DiscordBot = require("../DiscordBot");
const config = require("../../config");
const MessageCommand = require("../../structure/MessageCommand");
const { handleMessageCommandOptions, handleApplicationCommandOptions } = require("./CommandOptions");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { error } = require("../../utils/Console");
const { isDeveloper, createDMProxy } = require("../../utils/dmGuildProxy");

// ── Command yang boleh dipakai SEMUA orang (tidak perlu ManageGuild / developer) ──
const PUBLIC_COMMANDS = new Set(['help', 'ping']);

class CommandsListener {
    /**
     * @param {DiscordBot} client
     */
    constructor(client) {

        // ══════════════════════════════════════════════════════════════════
        // MESSAGE COMMANDS
        // ══════════════════════════════════════════════════════════════════
        client.on('messageCreate', async (message) => {
            if (message.author.bot) return;
            if (!config.commands.message_commands) return;

            const isDM = message.channel.type === ChannelType.DM;

            // Di DM: hanya owner/developer atau public commands yang bisa berjalan
            if (isDM) {
                // Abaikan semua pesan DM dari bukan developer dulu,
                // pengecekan per-command dilakukan di bawah setelah parse
            }

            let prefix = config.commands.prefix;
            if (!isDM && client.database.has('prefix-' + message.guild.id)) {
                prefix = client.database.get('prefix-' + message.guild.id);
            }

            if (!message.content.startsWith(prefix)) return;

            const args = message.content.slice(prefix.length).trim().split(/\s+/g);
            const commandInput = args.shift().toLowerCase();
            if (!commandInput.length) return;

            /** @type {MessageCommand['data']} */
            const command =
                client.collection.message_commands.get(commandInput) ||
                client.collection.message_commands.get(
                    client.collection.message_commands_aliases.get(commandInput)
                );

            if (!command) return;

            const cmdName = command.command.name;

            // ── ENFORCE: command non-public di DM hanya untuk developer ──
            if (isDM && !PUBLIC_COMMANDS.has(cmdName) && !isDeveloper(message.author.id)) {
                return; // diam — jangan tampilkan error agar tidak spoil command
            }

            // ── ENFORCE: command non-public di server hanya untuk member
            //    yang punya ManageGuild atau lebih ─────────────────────────
            if (!isDM && !PUBLIC_COMMANDS.has(cmdName)) {
                const hasManageGuild = message.member?.permissions.has(PermissionsBitField.Flags.ManageGuild);
                if (!hasManageGuild) return;
            }

            try {
                if (command.options) {
                    const ok = await handleMessageCommandOptions(message, command.options, command.command);
                    if (!ok) return;
                }

                // Cek permissions tambahan yang didefinisikan di command (misal: ManageRoles, dll)
                if (!isDM && command.command?.permissions &&
                    !message.member.permissions.has(PermissionsBitField.resolve(command.command.permissions))) {
                    await message.reply({
                        content: config.messages.MISSING_PERMISSIONS
                    });
                    return;
                }

                command.run(client, message, args);
            } catch (err) {
                error(err);
            }
        });


        // ══════════════════════════════════════════════════════════════════
        // APPLICATION COMMANDS (SLASH / CONTEXT MENU)
        // ══════════════════════════════════════════════════════════════════
        client.on('interactionCreate', async (interaction) => {
            if (!interaction.isCommand()) return;

            if (!config.commands.application_commands.chat_input    && interaction.isChatInputCommand())           return;
            if (!config.commands.application_commands.user_context  && interaction.isUserContextMenuCommand())     return;
            if (!config.commands.application_commands.message_context && interaction.isMessageContextMenuCommand()) return;

            /** @type {ApplicationCommand['data']} */
            const command = client.collection.application_commands.get(interaction.commandName);
            if (!command) return;

            const cmdName  = command.command.name;

            // interaction.context: 0 = GUILD, 1 = BOT_DM, 2 = PRIVATE_CHANNEL
            // Untuk command integration_types:[1] (user-install), interaction.guild
            // bisa null meski dipakai di server — gunakan context untuk membedakan
            const interactionContext = interaction.context ?? (interaction.guild ? 0 : 1);
            const isFromDM = interactionContext === 1 || interactionContext === 2;

            // ── ENFORCE DM ────────────────────────────────────────────────
            if (isFromDM) {
                if (!PUBLIC_COMMANDS.has(cmdName) && !isDeveloper(interaction.user.id)) {
                    // Tolak diam-diam — command tidak seharusnya muncul di DM user biasa
                    // karena dm_permission: false sudah dipasang, tapi jaga-jaga
                    await interaction.reply({
                        content: '❌ This command is not available.',
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                // Command /server tidak perlu proxy guild
                if (cmdName === 'server' || PUBLIC_COMMANDS.has(cmdName)) {
                    try {
                        if (command.options) {
                            const ok = await handleApplicationCommandOptions(interaction, command.options, command.command);
                            if (!ok) return;
                        }
                        await command.run(client, interaction);
                    } catch (err) {
                        error(err);
                    }
                    return;
                }

                // Command lain di DM → butuh server yang dipilih via /server pilih
                const selectedGuildId = client.database.get(`dm-guild-${interaction.user.id}`);

                if (!selectedGuildId) {
                    await interaction.reply({
                        content: [
                            '⚠️ **No server selected.**',
                            'Use `/server select <id>` to select a server first.',
                            'Use `/server list` to see the list of available servers.'
                        ].join('\n'),
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                // Pastikan guild masih tersedia
                await interaction.guild?.members?.fetch?.().catch(() => null);
                const selectedGuild = client.guilds.cache.get(selectedGuildId);

                if (!selectedGuild) {
                    await interaction.reply({
                        content: '❌ Server not found. The bot may have left that server.\nUse `/server select` to choose a different server.',
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                // Fetch roles & channels agar resolver bisa bekerja
                await Promise.all([
                    selectedGuild.roles.fetch(),
                    selectedGuild.channels.fetch(),
                    selectedGuild.members.fetch().catch(() => null)
                ]);

                const proxiedInteraction = createDMProxy(interaction, selectedGuild);

                try {
                    if (command.options) {
                        const ok = await handleApplicationCommandOptions(proxiedInteraction, command.options, command.command);
                        if (!ok) return;
                    }
                    await command.run(client, proxiedInteraction);
                } catch (err) {
                    error(err);
                }
                return;
            }

            // ── ENFORCE SERVER: non-public hanya untuk ManageGuild+ ───────
            if (!PUBLIC_COMMANDS.has(cmdName)) {
                // Untuk user-install command di server, interaction.guild dan
                // interaction.member bisa null — fetch manual dari cache
                const guild  = interaction.guild ?? client.guilds.cache.get(interaction.guildId);
                const member = interaction.member ?? await guild?.members.fetch(interaction.user.id).catch(() => null);
                const perms  = member?.permissions;
                const hasManageGuild = perms instanceof PermissionsBitField
                    ? perms.has(PermissionFlagsBits.ManageGuild)
                    : false;
                const isOwnerOrDev = isDeveloper(interaction.user.id) || member?.id === guild?.ownerId;

                if (!isOwnerOrDev && !hasManageGuild) {
                    await interaction.reply({
                        content: '❌ You do not have permission to use this command.',
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                // Jika guild tidak ditemukan sama sekali, tolak
                if (!guild) {
                    await interaction.reply({
                        content: '❌ This command can only be used in a server.',
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                // Jika interaction.guild null (user-install di server), buat proxy
                if (!interaction.guild && guild) {
                    await Promise.all([
                        guild.roles.fetch(),
                        guild.channels.fetch(),
                        guild.members.fetch().catch(() => null)
                    ]);
                    const proxied = createDMProxy(interaction, guild);
                    try {
                        if (command.options) {
                            const ok = await handleApplicationCommandOptions(proxied, command.options, command.command);
                            if (!ok) return;
                        }
                        await command.run(client, proxied);
                    } catch (err) {
                        error(err);
                    }
                    return;
                }
            }

            // ── Interaksi biasa dari guild ────────────────────────────────
            try {
                if (command.options) {
                    const ok = await handleApplicationCommandOptions(interaction, command.options, command.command);
                    if (!ok) return;
                }
                await command.run(client, interaction);
            } catch (err) {
                error(err);
                // Coba kirim pesan error jika interaksi belum dibalas
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ An error occurred while running the command.',
                        flags: MessageFlags.Ephemeral
                    }).catch(() => null);
                }
            }
        });
    }
}

module.exports = CommandsListener;

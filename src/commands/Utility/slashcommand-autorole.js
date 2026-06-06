const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { resolveRole } = require('../../utils/resolveGuildOption');
const { checkBotPermissions } = require('../../utils/checkBotPermissions');

// ── Helpers ────────────────────────────────────────────────────────────────
function setBool(client, key, val) {
    client.database.set(key, val ? 'true' : 'false');
}

function getBool(client, key, defaultVal) {
    const raw = client.database.get(key);
    if (raw === null || raw === undefined) return defaultVal;
    if (raw === 'false' || raw === false || raw === 0) return false;
    return true;
}

function getConfig(client, guildId) {
    return {
        memberEnabled: getBool(client, `autorole-member-enabled-${guildId}`, false),
        memberRoleId:  client.database.get(`autorole-member-role-${guildId}`) ?? null,
        botEnabled:   getBool(client, `autorole-bot-enabled-${guildId}`,   false),
        botRoleId:    client.database.get(`autorole-bot-role-${guildId}`)   ?? null,
    };
}

// Validate role — return error message or null if valid
function validateRole(guild, role, interaction) {
    if (!role) {
        interaction.reply({ content: '❌ Role not found. Use a mention `@role` or a role ID.', flags: MessageFlags.Ephemeral });
        return false;
    }
    if (role.managed) {
        interaction.reply({ content: '❌ Roles managed by external integrations cannot be used as autoroles.', flags: MessageFlags.Ephemeral });
        return false;
    }
    if (role.id === guild.id) {
        interaction.reply({ content: '❌ The `@everyone` role cannot be used as an autorole.', flags: MessageFlags.Ephemeral });
        return false;
    }
    return true;
}

// ── Command ────────────────────────────────────────────────────────────────
module.exports = new ApplicationCommand({
    command: {
        name: 'autorole',
        description: 'Configure automatic roles when a member or bot joins the server.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            // ── status ────────────────────────────────────────────────────
            {
                name: 'status',
                description: 'View the current autorole configuration.',
                type: 1
            },

            // ── join ──────────────────────────────────────────────────────
            {
                name: 'join',
                description: 'Configure autorole when a member or bot joins.',
                type: 2, // SUB_COMMAND_GROUP
                options: [
                    {
                        name: 'set',
                        description: 'Set the role automatically assigned on join.',
                        type: 1,
                        options: [
                            {
                                name: 'type',
                                description: 'Select target: member, bot, or all (both).',
                                type: 3, // STRING
                                required: true,
                                choices: [
                                    { name: 'Member',     value: 'member' },
                                    { name: 'Bot',        value: 'bot'    },
                                    { name: 'All (Both)', value: 'all'    }
                                ]
                            },
                            {
                                name: 'role',
                                description: 'Role to be automatically assigned.',
                                type: 3, // STRING — resolved by resolveRole
                                autocomplete: true,
                                required: true
                            },
                            {
                                name: 'role_bot',
                                description: '(Only for type=all) Specific role for bots. Leave empty = use the same role.',
                                type: 3,
                                autocomplete: true,
                                required: false
                            }
                        ]
                    },
                    {
                        name: 'toggle',
                        description: 'Enable or disable autorole on join.',
                        type: 1,
                        options: [
                            {
                                name: 'type',
                                description: 'Select target: member, bot, or all.',
                                type: 3,
                                required: true,
                                choices: [
                                    { name: 'Member',     value: 'member' },
                                    { name: 'Bot',        value: 'bot'    },
                                    { name: 'All (Both)', value: 'all'    }
                                ]
                            },
                            {
                                name: 'active',
                                description: 'true = enable, false = disable.',
                                type: 5, // BOOLEAN
                                required: true
                            }
                        ]
                    },
                    {
                        name: 'remove',
                        description: 'Remove the autorole join configuration.',
                        type: 1,
                        options: [
                            {
                                name: 'type',
                                description: 'Select the target to remove: member, bot, or all.',
                                type: 3,
                                required: true,
                                choices: [
                                    { name: 'Member',     value: 'member' },
                                    { name: 'Bot',        value: 'bot'    },
                                    { name: 'All (Both)', value: 'all'    }
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    },

    options: {
        botOwner: false
    },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const { guild, options } = interaction;
        const subGroup = options.getSubcommandGroup(false);
        const sub      = options.getSubcommand();
        const cfg      = getConfig(client, guild.id);

        // ── Cek permission bot ────────────────────────────────────────
        const ok = await checkBotPermissions(interaction, [
            PermissionFlagsBits.ManageRoles,
        ]);
        if (!ok) return;

        // ── /autorole status ───────────────────────────────────────────────
        if (!subGroup && sub === 'status') {
            const memberRole = cfg.memberRoleId ? guild.roles.cache.get(cfg.memberRoleId) : null;
            const botRole   = cfg.botRoleId   ? guild.roles.cache.get(cfg.botRoleId)   : null;

            const embed = new EmbedBuilder()
                .setTitle('⚙️ Autorole Join Configuration')
                .setColor('#5865F2')
                .addFields(
                    {
                        name: '👤 Member Autorole',
                        value: [
                            `**Status:** ${cfg.memberEnabled ? '✅ Enabled' : '❌ Disabled'}`,
                            `**Role:** ${memberRole ? `${memberRole}` : '`Not set`'}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '🤖 Bot Autorole',
                        value: [
                            `**Status:** ${cfg.botEnabled ? '✅ Enabled' : '❌ Disabled'}`,
                            `**Role:** ${botRole ? `${botRole}` : '`Not set`'}`
                        ].join('\n'),
                        inline: true
                    }
                )
                .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) ?? undefined })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── /autorole join set ─────────────────────────────────────────────
        if (subGroup === 'join' && sub === 'set') {
            const type    = options.getString('type');
            const roleStr = options.getString('role');
            const role    = resolveRole(guild, roleStr);

            if (!validateRole(guild, role, interaction)) return;

            // For type=all, check role_bot (optional — falls back to main role)
            let botRole = role;
            if (type === 'all') {
                const botRoleStr = options.getString('role_bot');
                if (botRoleStr) {
                    botRole = resolveRole(guild, botRoleStr);
                    if (!validateRole(guild, botRole, interaction)) return;
                }
            }

            const lines = [];

            if (type === 'member' || type === 'all') {
                client.database.set(`autorole-member-role-${guild.id}`, role.id);
                setBool(client, `autorole-member-enabled-${guild.id}`, true);
                lines.push(`👤 Autorole **Member** → ${role} ✅`);
            }

            if (type === 'bot' || type === 'all') {
                client.database.set(`autorole-bot-role-${guild.id}`, botRole.id);
                setBool(client, `autorole-bot-enabled-${guild.id}`, true);
                lines.push(`🤖 Autorole **Bot** → ${botRole} ✅`);
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('✅ Autorole Join Set')
                        .setDescription(lines.join('\n') + '\n\nStatus automatically **enabled**.')
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole join toggle ──────────────────────────────────────────
        if (subGroup === 'join' && sub === 'toggle') {
            const type   = options.getString('type');
            const active = options.getBoolean('active');

            // Validate if enabling but role is not yet set
            if (active) {
                if ((type === 'member' || type === 'all') && !cfg.memberRoleId) {
                    return interaction.reply({
                        content: '❌ Member role is not set. Use `/autorole join set` first.',
                        flags: MessageFlags.Ephemeral
                    });
                }
                if ((type === 'bot' || type === 'all') && !cfg.botRoleId) {
                    return interaction.reply({
                        content: '❌ Bot role is not set. Use `/autorole join set` first.',
                        flags: MessageFlags.Ephemeral
                    });
                }
            }

            const lines = [];

            if (type === 'member' || type === 'all') {
                setBool(client, `autorole-member-enabled-${guild.id}`, active);
                lines.push(`👤 Autorole **Member** ${active ? '✅ enabled' : '❌ disabled'}`);
            }

            if (type === 'bot' || type === 'all') {
                setBool(client, `autorole-bot-enabled-${guild.id}`, active);
                lines.push(`🤖 Autorole **Bot** ${active ? '✅ enabled' : '❌ disabled'}`);
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(active ? '#57F287' : '#ED4245')
                        .setTitle(`${active ? '✅' : '❌'} Autorole Join Toggle`)
                        .setDescription(lines.join('\n'))
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole join remove ──────────────────────────────────────────
        if (subGroup === 'join' && sub === 'remove') {
            const type  = options.getString('type');
            const lines = [];

            if (type === 'member' || type === 'all') {
                client.database.delete(`autorole-member-role-${guild.id}`);
                setBool(client, `autorole-member-enabled-${guild.id}`, false);
                lines.push('👤 Autorole **Member** configuration removed.');
            }

            if (type === 'bot' || type === 'all') {
                client.database.delete(`autorole-bot-role-${guild.id}`);
                setBool(client, `autorole-bot-enabled-${guild.id}`, false);
                lines.push('🤖 Autorole **Bot** configuration removed.');
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('🗑️ Autorole Join Removed')
                        .setDescription(lines.join('\n'))
                ],
                flags: MessageFlags.Ephemeral
            });
        }
    }
}).toJSON();

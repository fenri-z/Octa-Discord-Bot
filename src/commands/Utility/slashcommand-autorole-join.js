const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { getLang, getStrings } = require('../../utils/BotLang');
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
        botEnabled:    getBool(client, `autorole-bot-enabled-${guildId}`,    false),
        botRoleId:     client.database.get(`autorole-bot-role-${guildId}`)   ?? null,
    };
}

function validateRole(guild, role, interaction, s) {
    if (!role)             { interaction.reply({ content: s.role_not_found, flags: MessageFlags.Ephemeral }); return false; }
    if (role.managed)      { interaction.reply({ content: s.role_managed,   flags: MessageFlags.Ephemeral }); return false; }
    if (role.id === guild.id) { interaction.reply({ content: s.role_everyone, flags: MessageFlags.Ephemeral }); return false; }
    return true;
}

// ── Command ────────────────────────────────────────────────────────────────
module.exports = new ApplicationCommand({
    command: {
        name: 'autorole-join',
        description: 'Configure automatic roles when a member or bot joins the server.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            {
                name: 'status',
                description: 'View the current autorole join configuration.',
                type: 1
            },
            {
                name: 'set',
                description: 'Set the role automatically assigned on join.',
                type: 1,
                options: [
                    {
                        name: 'type',
                        description: 'Select target: member, bot, or all (both).',
                        type: 3,
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
                        type: 3,
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
                        type: 5,
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
    },

    options: {
        botOwner: false
    },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const strings  = getStrings(getLang(client.database, interaction.guild?.id));
        const s        = strings.autorole;
        const c        = strings.common;
        const { guild, options } = interaction;
        const sub      = options.getSubcommand();
        const cfg      = getConfig(client, guild.id);

        const ok = await checkBotPermissions(interaction, [PermissionFlagsBits.ManageRoles]);
        if (!ok) return;

        // ── /autorole-join status ──────────────────────────────────────────
        if (sub === 'status') {
            const memberRole = cfg.memberRoleId ? guild.roles.cache.get(cfg.memberRoleId) : null;
            const botRole    = cfg.botRoleId    ? guild.roles.cache.get(cfg.botRoleId)    : null;

            const embed = new EmbedBuilder()
                .setTitle(s.status_title)
                .setColor('#5865F2')
                .addFields(
                    {
                        name: s.field_member,
                        value: [
                            `${s.field_status} ${cfg.memberEnabled ? c.enabled : c.disabled}`,
                            `${s.field_role} ${memberRole ? `${memberRole}` : c.not_set}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: s.field_bot,
                        value: [
                            `${s.field_status} ${cfg.botEnabled ? c.enabled : c.disabled}`,
                            `${s.field_role} ${botRole ? `${botRole}` : c.not_set}`
                        ].join('\n'),
                        inline: true
                    }
                )
                .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) ?? undefined })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── /autorole-join set ─────────────────────────────────────────────
        if (sub === 'set') {
            const type    = options.getString('type');
            const roleStr = options.getString('role');
            const role    = resolveRole(guild, roleStr);

            if (!validateRole(guild, role, interaction, s)) return;

            let botRole = role;
            if (type === 'all') {
                const botRoleStr = options.getString('role_bot');
                if (botRoleStr) {
                    botRole = resolveRole(guild, botRoleStr);
                    if (!validateRole(guild, botRole, interaction, s)) return;
                }
            }

            const lines = [];

            if (type === 'member' || type === 'all') {
                client.database.set(`autorole-member-role-${guild.id}`, role.id);
                setBool(client, `autorole-member-enabled-${guild.id}`, true);
                lines.push(s.member_set(role));
            }

            if (type === 'bot' || type === 'all') {
                client.database.set(`autorole-bot-role-${guild.id}`, botRole.id);
                setBool(client, `autorole-bot-enabled-${guild.id}`, true);
                lines.push(s.bot_set(botRole));
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle(s.set_title)
                        .setDescription(lines.join('\n') + '\n\n' + s.set_auto_enabled)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-join toggle ──────────────────────────────────────────
        if (sub === 'toggle') {
            const type   = options.getString('type');
            const active = options.getBoolean('active');

            if (active) {
                if ((type === 'member' || type === 'all') && !cfg.memberRoleId)
                    return interaction.reply({ content: s.member_role_unset, flags: MessageFlags.Ephemeral });
                if ((type === 'bot' || type === 'all') && !cfg.botRoleId)
                    return interaction.reply({ content: s.bot_role_unset, flags: MessageFlags.Ephemeral });
            }

            const lines = [];

            if (type === 'member' || type === 'all') {
                setBool(client, `autorole-member-enabled-${guild.id}`, active);
                lines.push(active ? s.member_enabled : s.member_disabled);
            }

            if (type === 'bot' || type === 'all') {
                setBool(client, `autorole-bot-enabled-${guild.id}`, active);
                lines.push(active ? s.bot_enabled_str : s.bot_disabled);
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(active ? '#57F287' : '#ED4245')
                        .setTitle(active ? s.toggle_title_on : s.toggle_title_off)
                        .setDescription(lines.join('\n'))
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole-join remove ──────────────────────────────────────────
        if (sub === 'remove') {
            const type  = options.getString('type');
            const lines = [];

            if (type === 'member' || type === 'all') {
                client.database.delete(`autorole-member-role-${guild.id}`);
                setBool(client, `autorole-member-enabled-${guild.id}`, false);
                lines.push(s.removed_member);
            }

            if (type === 'bot' || type === 'all') {
                client.database.delete(`autorole-bot-role-${guild.id}`);
                setBool(client, `autorole-bot-enabled-${guild.id}`, false);
                lines.push(s.removed_bot);
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle(s.remove_title)
                        .setDescription(lines.join('\n'))
                ],
                flags: MessageFlags.Ephemeral
            });
        }
    }
}).toJSON();

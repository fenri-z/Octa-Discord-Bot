const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");

function getBool(client, key, def = false) {
    const raw = client.database.get(key);
    if (raw === null || raw === undefined) return def;
    return raw !== 'false' && raw !== false && raw !== 0;
}

function getJSON(client, key, def = null) {
    const raw = client.database.get(key);
    if (!raw) return def;
    try { return JSON.parse(raw); } catch { return def; }
}

function getConfig(client, guildId) {
    const spam        = getJSON(client, `automod-spam-${guildId}`,        { enabled: false, limit: 5, interval: 5 });
    const massmention = getJSON(client, `automod-massmention-${guildId}`, { enabled: false, limit: 5 });
    const antiraid    = getJSON(client, `automod-antiraid-${guildId}`,    { enabled: false, joinLimit: 10, interval: 10 });
    return {
        antilink:    getBool(client, `automod-antilink-${guildId}`),
        antiinvite:  getBool(client, `automod-antiinvite-${guildId}`),
        attachments: getBool(client, `automod-attachments-${guildId}`),
        spam,
        massmention,
        antiraid,
        muteDuration: parseInt(client.database.get(`automod-mute-duration-${guildId}`) || '600000'),
        auditLog:    client.database.get(`automod-auditlog-${guildId}`)  ?? null,
        action:      client.database.get(`automod-action-${guildId}`)   ?? 'delete',
        words:       getJSON(client, `automod-words-${guildId}`,        []),
        wlChannels:  getJSON(client, `automod-wl-channels-${guildId}`,  []),
        wlRoles:     getJSON(client, `automod-wl-roles-${guildId}`,     []),
    };
}

module.exports = new ApplicationCommand({
    command: {
        name: 'automod',
        description: 'Automatic moderation system to protect the server from spam, links, and other violations.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            {
                type: 1,
                name: 'config',
                description: 'View the current automod configuration.'
            },
            {
                type: 1,
                name: 'guide',
                description: 'Full guide on how to set up the automod system.'
            },
            {
                type: 1,
                name: 'muteperms',
                description: 'Guide for setting up mute permissions for the bot.'
            },
            {
                type: 1,
                name: 'action',
                description: 'Set the action taken when a violation is detected.',
                options: [
                    {
                        type: 3,
                        name: 'type',
                        description: 'Action to take when a violation is detected.',
                        required: true,
                        choices: [
                            { name: 'Delete — Delete message only',            value: 'delete' },
                            { name: 'Warn — Delete message + DM warning',      value: 'warn'   },
                            { name: 'Mute — Delete message + temporary mute',  value: 'mute'   },
                            { name: 'Kick — Delete message + kick member',      value: 'kick'   },
                            { name: 'Ban  — Delete message + ban member',       value: 'ban'    },
                        ]
                    }
                ]
            },
            {
                type: 1,
                name: 'antilink',
                description: 'Enable/disable anti-link protection (all URLs).',
                options: [
                    { type: 5, name: 'active', description: 'Enable or disable.', required: true }
                ]
            },
            {
                type: 1,
                name: 'antiinvite',
                description: 'Enable/disable anti Discord invite protection.',
                options: [
                    { type: 5, name: 'active', description: 'Enable or disable.', required: true }
                ]
            },
            {
                type: 1,
                name: 'spam',
                description: 'Configure anti-spam protection.',
                options: [
                    { type: 5, name: 'active',   description: 'Enable or disable.',                                    required: true  },
                    { type: 4, name: 'limit',    description: 'Max messages per interval (default: 5).',               required: false, min_value: 2, max_value: 20 },
                    { type: 4, name: 'interval', description: 'Check interval in seconds (default: 5).',               required: false, min_value: 1, max_value: 30 }
                ]
            },
            {
                type: 1,
                name: 'massmention',
                description: 'Configure anti mass-mention protection.',
                options: [
                    { type: 5, name: 'active', description: 'Enable or disable.',                                      required: true  },
                    { type: 4, name: 'limit',  description: 'Max mentions in one message (default: 5).',               required: false, min_value: 2, max_value: 20 }
                ]
            },
            {
                type: 1,
                name: 'attachments',
                description: 'Enable/disable attachment/file filter in messages.',
                options: [
                    { type: 5, name: 'active', description: 'Enable or disable.', required: true }
                ]
            },
            {
                type: 1,
                name: 'mute',
                description: 'Set the timeout duration for mute action (uses Discord native Timeout).',
                options: [
                    {
                        type: 3,
                        name: 'duration',
                        description: 'How long the member is timed out.',
                        required: true,
                        choices: [
                            { name: '1 minute',   value: '60000'     },
                            { name: '5 minutes',  value: '300000'    },
                            { name: '10 minutes', value: '600000'    },
                            { name: '30 minutes', value: '1800000'   },
                            { name: '1 hour',     value: '3600000'   },
                            { name: '1 day',      value: '86400000'  },
                        ]
                    }
                ]
            },
            {
                type: 1,
                name: 'auditlog',
                description: 'Set the channel for automod activity logs.',
                options: [
                    { type: 7, name: 'channel', description: 'Text channel for automod log.', required: true, channel_types: [0] }
                ]
            },
            {
                type: 1,
                name: 'antiraid',
                description: 'Configure anti-raid protection (mass joins in a short time).',
                options: [
                    { type: 5, name: 'active',      description: 'Enable or disable.',                                  required: true  },
                    { type: 4, name: 'join_limit',  description: 'Joins per interval considered a raid (default: 10)', required: false, min_value: 2,  max_value: 50 },
                    { type: 4, name: 'interval',    description: 'Interval in seconds (default: 10).',                  required: false, min_value: 5,  max_value: 60 }
                ]
            },
            {
                type: 2,
                name: 'words',
                description: 'Manage the banned words list.',
                options: [
                    {
                        type: 1,
                        name: 'add',
                        description: 'Add a word to the banned list.',
                        options: [
                            { type: 3, name: 'word', description: 'Word to ban.', required: true }
                        ]
                    },
                    {
                        type: 1,
                        name: 'list',
                        description: 'View all banned words.'
                    },
                    {
                        type: 1,
                        name: 'delete',
                        description: 'Remove a word from the banned list.',
                        options: [
                            { type: 3, name: 'word', description: 'Word to remove.', required: true }
                        ]
                    }
                ]
            },
            {
                type: 2,
                name: 'whitelist',
                description: 'Manage channels/roles exempt from automod.',
                options: [
                    {
                        type: 1,
                        name: 'add',
                        description: 'Add a channel or role to the whitelist.',
                        options: [
                            { type: 7, name: 'channel', description: 'Channel to whitelist.',         required: false, channel_types: [0] },
                            { type: 8, name: 'role',    description: 'Role to whitelist.',             required: false }
                        ]
                    },
                    {
                        type: 1,
                        name: 'remove',
                        description: 'Remove a channel or role from the whitelist.',
                        options: [
                            { type: 7, name: 'channel', description: 'Channel to remove from whitelist.', required: false, channel_types: [0] },
                            { type: 8, name: 'role',    description: 'Role to remove from whitelist.',     required: false }
                        ]
                    },
                    {
                        type: 1,
                        name: 'list',
                        description: 'View all whitelisted channels and roles.'
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
        const guildId  = guild.id;

        // ── /automod config ────────────────────────────────────────────────
        if (!subGroup && sub === 'config') {
            const cfg = getConfig(client, guildId);
            const auditCh   = cfg.auditLog ? guild.channels.cache.get(cfg.auditLog) : null;
            const actionMap = { delete: '🗑️ Delete', warn: '⚠️ Warn', mute: '🔇 Mute', kick: '👢 Kick', ban: '🔨 Ban' };
            const durationLabel = {
                60000: '1 minute', 300000: '5 minutes', 600000: '10 minutes',
                1800000: '30 minutes', 3600000: '1 hour', 86400000: '1 day'
            };

            const wordsPreview = cfg.words.length > 0
                ? cfg.words.slice(0, 15).map(w => `\`${w}\``).join(', ') + (cfg.words.length > 15 ? ` *(+${cfg.words.length - 15} more)*` : '')
                : '`None`';

            const wlCh = cfg.wlChannels.map(id => `<#${id}>`).join(', ')   || '`None`';
            const wlRl = cfg.wlRoles.map(id => `<@&${id}>`).join(', ')     || '`None`';

            const embed = new EmbedBuilder()
                .setTitle('🛡️ Automod Configuration')
                .setColor('#5865F2')
                .addFields(
                    { name: '⚔️ Violation Action', value: actionMap[cfg.action] ?? cfg.action,                                      inline: true },
                    { name: '🔇 Timeout Duration',  value: durationLabel[cfg.muteDuration] ?? `${cfg.muteDuration / 60000} minutes`, inline: true },
                    { name: '📋 Log Channel',       value: auditCh ? `${auditCh}` : '`Not set`',                                    inline: true },
                    { name: '🔗 Anti-Link',         value: cfg.antilink    ? '✅ Enabled' : '❌ Disabled', inline: true },
                    { name: '📨 Anti-Invite',       value: cfg.antiinvite  ? '✅ Enabled' : '❌ Disabled', inline: true },
                    { name: '📎 Anti-Attachment',   value: cfg.attachments ? '✅ Enabled' : '❌ Disabled', inline: true },
                    {
                        name: '🔁 Anti-Spam',
                        value: cfg.spam.enabled
                            ? `✅ Enabled — max **${cfg.spam.limit}** messages / **${cfg.spam.interval}** second(s)`
                            : '❌ Disabled',
                        inline: false
                    },
                    {
                        name: '📢 Anti Mass-Mention',
                        value: cfg.massmention.enabled
                            ? `✅ Enabled — max **${cfg.massmention.limit}** mentions per message`
                            : '❌ Disabled',
                        inline: false
                    },
                    {
                        name: '🚨 Anti-Raid',
                        value: cfg.antiraid.enabled
                            ? `✅ Enabled — max **${cfg.antiraid.joinLimit}** joins / **${cfg.antiraid.interval}** second(s)`
                            : '❌ Disabled',
                        inline: false
                    },
                    { name: '🚫 Banned Words',        value: wordsPreview, inline: false },
                    { name: '✅ Whitelist Channel',   value: wlCh,         inline: true  },
                    { name: '✅ Whitelist Role',      value: wlRl,         inline: true  }
                )
                .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) ?? undefined })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── /automod guide ─────────────────────────────────────────────────
        if (!subGroup && sub === 'guide') {
            const embed = new EmbedBuilder()
                .setTitle('📖 Automod Guide')
                .setColor('#5865F2')
                .setDescription([
                    '**The Automod system** automatically protects the server from various threats.',
                    '',
                    '**Setup Steps:**',
                    '1. Set the action: `/automod action`',
                    '2. (Optional) Set mute duration: `/automod mute`',
                    '3. (Optional) Set log channel: `/automod auditlog`',
                    '4. Enable the desired protections:',
                    '   • `/automod antilink active:true`',
                    '   • `/automod antiinvite active:true`',
                    '   • `/automod spam active:true`',
                    '   • `/automod massmention active:true`',
                    '   • `/automod attachments active:true`',
                    '   • `/automod antiraid active:true`',
                    '5. Add banned words: `/automod words add`',
                    '6. Whitelist channels/roles: `/automod whitelist add`',
                    '',
                    '**Available Actions:**',
                    '🗑️ `delete` — Delete violating message only',
                    '⚠️ `warn` — Delete message + send DM warning',
                    '🔇 `mute` — Delete message + temporary mute',
                    '👢 `kick` — Delete message + kick member',
                    '🔨 `ban` — Delete message + ban member',
                    '',
                    '💡 Use `/automod config` to view the full status.'
                ].join('\n'))
                .setFooter({ text: 'Use /automod muteperms for the mute permissions setup guide.' });

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── /automod muteperms ─────────────────────────────────────────────
        if (!subGroup && sub === 'muteperms') {
            const embed = new EmbedBuilder()
                .setTitle('🔇 Timeout (Mute) Permission Setup Guide')
                .setColor('#FEE75C')
                .setDescription([
                    'The **Mute** feature now uses **Discord native Timeout**.',
                    'No mute role needed! Much simpler and cannot be bypassed.',
                    '',
                    '**Requirements:**',
                    '',
                    '**1. Bot Permission: Moderate Members**',
                    '• Go to **Server Settings → Roles → [Bot Role]**',
                    '• Check ✅ **Moderate Members** (or **Timeout Members**)',
                    '',
                    '**2. Set Timeout Duration**',
                    '• Use `/automod mute duration:10 minutes`',
                    '• Options: 1 minute / 5 minutes / 10 minutes / 30 minutes / 1 hour / 1 day',
                    '',
                    '**3. Set Action to Mute**',
                    '• Use `/automod action type:Mute`',
                    '',
                    '**How Discord Timeout works:**',
                    '• Member cannot send messages, reply, or react',
                    '• Applies to **all channels** without per-channel configuration',
                    '• Timeout automatically expires after the duration ends',
                    '• Cannot be bypassed with other roles',
                    '',
                    '> ✅ More reliable than a mute role because it is managed directly by Discord.'
                ].join('\n'));

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── /automod action ────────────────────────────────────────────────
        if (!subGroup && sub === 'action') {
            const type = options.getString('type');
            client.database.set(`automod-action-${guildId}`, type);
            const actionMap = { delete: '🗑️ Delete', warn: '⚠️ Warn', mute: '🔇 Mute', kick: '👢 Kick', ban: '🔨 Ban' };
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('✅ Automod Action Set')
                        .setDescription(`Violation action changed to: **${actionMap[type]}**`)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod antilink ──────────────────────────────────────────────
        if (!subGroup && sub === 'antilink') {
            const active = options.getBoolean('active');
            client.database.set(`automod-antilink-${guildId}`, active ? 'true' : 'false');
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(active ? '#57F287' : '#ED4245')
                        .setTitle(`${active ? '✅' : '❌'} Anti-Link ${active ? 'Enabled' : 'Disabled'}`)
                        .setDescription(`Anti-link protection is now **${active ? 'active' : 'inactive'}**.\nAll URLs sent by members will be deleted.`)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod antiinvite ────────────────────────────────────────────
        if (!subGroup && sub === 'antiinvite') {
            const active = options.getBoolean('active');
            client.database.set(`automod-antiinvite-${guildId}`, active ? 'true' : 'false');
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(active ? '#57F287' : '#ED4245')
                        .setTitle(`${active ? '✅' : '❌'} Anti-Invite ${active ? 'Enabled' : 'Disabled'}`)
                        .setDescription(`Anti Discord invite protection is now **${active ? 'active' : 'inactive'}**.`)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod spam ──────────────────────────────────────────────────
        if (!subGroup && sub === 'spam') {
            const active   = options.getBoolean('active');
            const limit    = options.getInteger('limit')    ?? 5;
            const interval = options.getInteger('interval') ?? 5;
            const existing = getJSON(client, `automod-spam-${guildId}`, { enabled: false, limit: 5, interval: 5 });
            const newCfg   = { enabled: active, limit: active ? limit : existing.limit, interval: active ? interval : existing.interval };
            client.database.set(`automod-spam-${guildId}`, JSON.stringify(newCfg));
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(active ? '#57F287' : '#ED4245')
                        .setTitle(`${active ? '✅' : '❌'} Anti-Spam ${active ? 'Enabled' : 'Disabled'}`)
                        .setDescription(active
                            ? `Limit: **${limit}** messages every **${interval}** second(s).`
                            : 'Anti-spam protection disabled.')
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod massmention ───────────────────────────────────────────
        if (!subGroup && sub === 'massmention') {
            const active   = options.getBoolean('active');
            const limit    = options.getInteger('limit') ?? 5;
            const existing = getJSON(client, `automod-massmention-${guildId}`, { enabled: false, limit: 5 });
            const newCfg   = { enabled: active, limit: active ? limit : existing.limit };
            client.database.set(`automod-massmention-${guildId}`, JSON.stringify(newCfg));
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(active ? '#57F287' : '#ED4245')
                        .setTitle(`${active ? '✅' : '❌'} Anti Mass-Mention ${active ? 'Enabled' : 'Disabled'}`)
                        .setDescription(active
                            ? `Limit: **${limit}** mentions per message.`
                            : 'Anti mass-mention protection disabled.')
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod attachments ───────────────────────────────────────────
        if (!subGroup && sub === 'attachments') {
            const active = options.getBoolean('active');
            client.database.set(`automod-attachments-${guildId}`, active ? 'true' : 'false');
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(active ? '#57F287' : '#ED4245')
                        .setTitle(`${active ? '✅' : '❌'} Anti-Attachment ${active ? 'Enabled' : 'Disabled'}`)
                        .setDescription(`File/attachment filter is now **${active ? 'active' : 'inactive'}**.`)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod mute ──────────────────────────────────────────────────
        if (!subGroup && sub === 'mute') {
            const durasi     = options.getString('duration');
            const durationMs = parseInt(durasi);
            const durationLabel = {
                60000: '1 minute', 300000: '5 minutes', 600000: '10 minutes',
                1800000: '30 minutes', 3600000: '1 hour', 86400000: '1 day'
            };
            client.database.set(`automod-mute-duration-${guildId}`, String(durationMs));
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('✅ Timeout Duration Set')
                        .setDescription(
                            `Timeout duration set to: **${durationLabel[durationMs] ?? durasi}**\n\n` +
                            `Bot uses **Discord native Timeout** — no mute role needed.\n` +
                            `Make sure the bot has **Moderate Members** permission. See \`/automod muteperms\`.`
                        )
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod auditlog ──────────────────────────────────────────────
        if (!subGroup && sub === 'auditlog') {
            const channel = options.getChannel('channel');
            client.database.set(`automod-auditlog-${guildId}`, channel.id);
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('✅ Automod Log Channel Set')
                        .setDescription(`All automod activity will be logged in: ${channel}`)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod antiraid ──────────────────────────────────────────────
        if (!subGroup && sub === 'antiraid') {
            const active    = options.getBoolean('active');
            const joinLimit = options.getInteger('join_limit') ?? 10;
            const interval  = options.getInteger('interval')   ?? 10;
            const existing  = getJSON(client, `automod-antiraid-${guildId}`, { enabled: false, joinLimit: 10, interval: 10 });
            const newCfg    = { enabled: active, joinLimit: active ? joinLimit : existing.joinLimit, interval: active ? interval : existing.interval };
            client.database.set(`automod-antiraid-${guildId}`, JSON.stringify(newCfg));
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(active ? '#57F287' : '#ED4245')
                        .setTitle(`${active ? '✅' : '❌'} Anti-Raid ${active ? 'Enabled' : 'Disabled'}`)
                        .setDescription(active
                            ? `Triggers when **${joinLimit}** or more members join within **${interval}** second(s).\nServer verification will be automatically increased for 5 minutes.`
                            : 'Anti-raid protection disabled.')
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod words add ─────────────────────────────────────────────
        if (subGroup === 'words' && sub === 'add') {
            const word  = options.getString('word').toLowerCase().trim();
            const words = getJSON(client, `automod-words-${guildId}`, []);
            if (words.includes(word)) {
                return interaction.reply({ content: `❌ The word \`${word}\` is already in the banned list.`, flags: MessageFlags.Ephemeral });
            }
            if (words.length >= 100) {
                return interaction.reply({ content: '❌ The banned words list has reached the maximum limit (100 words).', flags: MessageFlags.Ephemeral });
            }
            words.push(word);
            client.database.set(`automod-words-${guildId}`, JSON.stringify(words));
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('✅ Banned Word Added')
                        .setDescription(`Word \`${word}\` has been added to the banned list.\nTotal: **${words.length}** / 100 words`)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod words list ────────────────────────────────────────────
        if (subGroup === 'words' && sub === 'list') {
            const words = getJSON(client, `automod-words-${guildId}`, []);
            if (words.length === 0) {
                return interaction.reply({
                    content: '📭 No banned words have been added yet. Use `/automod words add` to add one.',
                    flags: MessageFlags.Ephemeral
                });
            }
            const embed = new EmbedBuilder()
                .setTitle(`🚫 Banned Words List (${words.length} / 100)`)
                .setColor('#ED4245')
                .setDescription(words.map((w, i) => `\`${String(i + 1).padStart(2, '0')}.\` ${w}`).join('\n'));
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ── /automod words delete ──────────────────────────────────────────
        if (subGroup === 'words' && sub === 'delete') {
            const word  = options.getString('word').toLowerCase().trim();
            const words = getJSON(client, `automod-words-${guildId}`, []);
            const idx   = words.indexOf(word);
            if (idx === -1) {
                return interaction.reply({ content: `❌ The word \`${word}\` was not found in the banned list.`, flags: MessageFlags.Ephemeral });
            }
            words.splice(idx, 1);
            client.database.set(`automod-words-${guildId}`, JSON.stringify(words));
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('✅ Banned Word Removed')
                        .setDescription(`Word \`${word}\` has been removed.\nRemaining: **${words.length}** / 100 words`)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod whitelist add ─────────────────────────────────────────
        if (subGroup === 'whitelist' && sub === 'add') {
            const channel = options.getChannel('channel');
            const role    = options.getRole('role');
            if (!channel && !role) {
                return interaction.reply({ content: '❌ Please provide at least one channel or role.', flags: MessageFlags.Ephemeral });
            }
            const lines = [];
            if (channel) {
                const chs = getJSON(client, `automod-wl-channels-${guildId}`, []);
                if (!chs.includes(channel.id)) {
                    chs.push(channel.id);
                    client.database.set(`automod-wl-channels-${guildId}`, JSON.stringify(chs));
                    lines.push(`📌 Channel ${channel} added to whitelist.`);
                } else {
                    lines.push(`⚠️ Channel ${channel} is already in the whitelist.`);
                }
            }
            if (role) {
                const rls = getJSON(client, `automod-wl-roles-${guildId}`, []);
                if (!rls.includes(role.id)) {
                    rls.push(role.id);
                    client.database.set(`automod-wl-roles-${guildId}`, JSON.stringify(rls));
                    lines.push(`🎭 Role ${role} added to whitelist.`);
                } else {
                    lines.push(`⚠️ Role ${role} is already in the whitelist.`);
                }
            }
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('✅ Whitelist Updated')
                        .setDescription(lines.join('\n'))
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod whitelist remove ──────────────────────────────────────
        if (subGroup === 'whitelist' && sub === 'remove') {
            const channel = options.getChannel('channel');
            const role    = options.getRole('role');
            if (!channel && !role) {
                return interaction.reply({ content: '❌ Please provide at least one channel or role.', flags: MessageFlags.Ephemeral });
            }
            const lines = [];
            if (channel) {
                const chs = getJSON(client, `automod-wl-channels-${guildId}`, []);
                const idx = chs.indexOf(channel.id);
                if (idx !== -1) {
                    chs.splice(idx, 1);
                    client.database.set(`automod-wl-channels-${guildId}`, JSON.stringify(chs));
                    lines.push(`📌 Channel ${channel} removed from whitelist.`);
                } else {
                    lines.push(`⚠️ Channel ${channel} is not in the whitelist.`);
                }
            }
            if (role) {
                const rls = getJSON(client, `automod-wl-roles-${guildId}`, []);
                const idx = rls.indexOf(role.id);
                if (idx !== -1) {
                    rls.splice(idx, 1);
                    client.database.set(`automod-wl-roles-${guildId}`, JSON.stringify(rls));
                    lines.push(`🎭 Role ${role} removed from whitelist.`);
                } else {
                    lines.push(`⚠️ Role ${role} is not in the whitelist.`);
                }
            }
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('✅ Whitelist Updated')
                        .setDescription(lines.join('\n'))
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /automod whitelist list ────────────────────────────────────────
        if (subGroup === 'whitelist' && sub === 'list') {
            const chs = getJSON(client, `automod-wl-channels-${guildId}`, []);
            const rls = getJSON(client, `automod-wl-roles-${guildId}`, []);
            const embed = new EmbedBuilder()
                .setTitle('✅ Automod Whitelist')
                .setColor('#5865F2')
                .setDescription('The following channels and roles are **exempt** from automod.')
                .addFields(
                    { name: '📌 Channel', value: chs.length > 0 ? chs.map(id => `<#${id}>`).join('\n')   : '`None`', inline: true },
                    { name: '🎭 Role',    value: rls.length > 0 ? rls.map(id => `<@&${id}>`).join('\n')  : '`None`', inline: true }
                )
                .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) ?? undefined });
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
    }
}).toJSON();

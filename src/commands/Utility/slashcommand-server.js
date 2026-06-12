const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    ChannelType,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { isDeveloper } = require("../../utils/dmGuildProxy");
const config = require("../../config");

// ── Channel type labels ────────────────────────────────────────────────────
const CHANNEL_TYPE_LABEL = {
    [ChannelType.GuildText]:          '💬 Text',
    [ChannelType.GuildVoice]:         '🔊 Voice',
    [ChannelType.GuildCategory]:      '📁 Category',
    [ChannelType.GuildAnnouncement]:  '📢 Announcement',
    [ChannelType.GuildStageVoice]:    '🎙️ Stage',
    [ChannelType.GuildForum]:         '🗂️ Forum',
    [ChannelType.GuildMedia]:         '🖼️ Media',
    [ChannelType.AnnouncementThread]: '🔁 Announcement Thread',
    [ChannelType.PublicThread]:       '🔁 Public Thread',
    [ChannelType.PrivateThread]:      '🔒 Private Thread',
};
function typeLabel(type) {
    return CHANNEL_TYPE_LABEL[type] ?? `❓ Type ${type}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

async function sendChunked(interaction, embeds) {
    await interaction.reply({ embeds: [embeds[0]], flags: MessageFlags.Ephemeral });
    for (let i = 1; i < embeds.length; i++) {
        await interaction.followUp({ embeds: [embeds[i]], flags: MessageFlags.Ephemeral });
    }
}

// ── Ambil guild aktif yang sudah dipilih ──────────────────────────────────
function getActiveGuild(client, userId, interaction) {
    // Jika dipanggil dari server langsung (bukan DM), pakai guild tersebut
    if (interaction.guild) return interaction.guild;
    // DM → use the one selected via /server select
    const selectedGuildId = client.database.get(`dm-guild-${userId}`);
    if (!selectedGuildId) return null;
    return client.guilds.cache.get(selectedGuildId) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
module.exports = new ApplicationCommand({
    command: {
        name: 'server',
        description: 'Manage the active server for bot control via DM. (Owner/developer only)',
        type: 1,
        options: [
            // ── list ──────────────────────────────────────────────────
            {
                name: 'list',
                description: 'Show all servers the bot is in.',
                type: 1
            },
            // ── pilih ─────────────────────────────────────────────────
            {
                name: 'select',
                description: 'Select the active server to control via DM.',
                type: 1,
                options: [
                    {
                        name: 'id',
                        description: 'Select or type a server name',
                        type: 3,
                        required: true,
                        autocomplete: true
                    }
                ]
            },
            // ── info ──────────────────────────────────────────────────
            {
                name: 'info',
                description: 'View the currently selected active server.',
                type: 1
            },
            // ── channels ──────────────────────────────────────────────
            {
                name: 'channels',
                description: 'Show all channels in the active server with their IDs.',
                type: 1,
                options: [
                    {
                        name: 'type',
                        description: 'Filter by channel type (leave empty = all)',
                        type: 3,
                        required: false,
                        choices: [
                            { name: '💬 Text',         value: 'text'     },
                            { name: '🔊 Voice',        value: 'voice'    },
                            { name: '📁 Category',     value: 'category' },
                            { name: '📢 Announcement', value: 'news'     },
                            { name: '🎙️ Stage',      value: 'stage'    },
                            { name: '🗂️ Forum',      value: 'forum'    },
                        ]
                    }
                ]
            },
            // ── roles ─────────────────────────────────────────────────
            {
                name: 'roles',
                description: 'Show all roles in the active server with their IDs.',
                type: 1,
                options: [
                    {
                        name: 'filter',
                        description: 'Filter roles shown (leave empty = all)',
                        type: 3,
                        required: false,
                        choices: [
                            { name: '🤖 Bot / Managed',     value: 'bot'     },
                            { name: '👤 Manual (not bot)',   value: 'manual'  },
                            { name: '💎 Booster',             value: 'booster' },
                        ]
                    }
                ]
            },
            // ── commands ──────────────────────────────────────────────
            {
                name: 'commands',
                description: 'Show all server commands with their configuration status.',
                type: 1,
                options: [
                    {
                        name: 'category',
                        description: 'Filter by command category (leave empty = all)',
                        type: 3,
                        required: false,
                        choices: [
                            { name: '👋 Member (welcome, goodbye)',       value: 'member'  },
                            { name: '🎭 Role (autorole)',                   value: 'role'    },
                            { name: '💎 Booster',                           value: 'booster' },
                            { name: '📨 Messages & Embed',               value: 'pesan'   },
                            { name: '🔧 Utilities (ping, prefix, invites)', value: 'utility' },
                        ]
                    }
                ]
            },
            // ── batalkan ──────────────────────────────────────────────
            {
                name: 'cancel',
                description: 'Cancel the active server selection.',
                type: 1
            }
        ]
    },

    options: { cooldown: 2000 },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const sub    = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        // ── Hanya owner/developer ─────────────────────────────────────
        if (!isDeveloper(userId)) {
            return interaction.reply({
                content: '❌ This command can only be used by the bot owner or developer.',
                flags: MessageFlags.Ephemeral
            });
        }

        const isFromGuild = !!interaction.guild;

        // ══════════════════════════════════════════════════════════════
        // LIST
        // ══════════════════════════════════════════════════════════════
        if (sub === 'list') {
            const guilds = [...client.guilds.cache.values()];

            if (guilds.length === 0) {
                return interaction.reply({
                    content: '📭 The bot is not in any server at the moment.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const selectedGuildId = client.database.get(`dm-guild-${userId}`);

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle(`🌐 Daftar Server Bot (${guilds.length})`)
                .setDescription(
                    guilds.map((g, i) => {
                        const isActive = g.id === selectedGuildId;
                        const num = String(i + 1).padStart(2, '0');
                        return `\`${num}.\` ${isActive ? '**▶ ' : ''}${g.name}${isActive ? '** *(active)*' : ''}\n` +
                               `      ID: \`${g.id}\` · ${g.memberCount} member`;
                    }).join('\n\n')
                )
                .setFooter({ text: 'Use /server select <id> to select a server.' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ══════════════════════════════════════════════════════════════
        // PILIH
        // ══════════════════════════════════════════════════════════════
        if (sub === 'select') {
            const guildId = interaction.options.getString('id').trim();
            const guild   = client.guilds.cache.get(guildId);

            if (!guild) {
                return interaction.reply({
                    content: `❌ Server with ID \`${guildId}\` not found.\nMake sure the bot is already in that server. Use \`/server list\` to view the list.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            client.database.set(`dm-guild-${userId}`, guildId);

            // Langsung fetch channel & role setelah server dipilih
            await Promise.all([
                guild.channels.fetch().catch(() => null),
                guild.roles.fetch().catch(() => null),
                guild.members.fetch().catch(() => null),
            ]);

            const channelCount = guild.channels.cache.size;
            const roleCount    = guild.roles.cache.size - 1; // exclude @everyone

            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('✅ Active Server Selected')
                .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
                .addFields(
                    { name: '🏠 Server',       value: guild.name,             inline: true },
                    { name: '🆔 ID',           value: `\`${guild.id}\``,      inline: true },
                    { name: '👥 Member',        value: `${guild.memberCount}`, inline: true },
                    { name: '📋 Channel',       value: `${channelCount}`,      inline: true },
                    { name: '🎭 Role',          value: `${roleCount}`,         inline: true },
                    { name: '\u200b',           value: '\u200b',               inline: true },
                )
                .setDescription(
                    (isFromGuild
                        ? '> ⚠️ You are using this command from inside a server. For full control, use it via **bot DM**.\n'
                        : '') +
                    '> Use `/server channels` or `/server roles` to view the list.'
                )
                .setFooter({ text: 'Use /server cancel to cancel the selection.' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ══════════════════════════════════════════════════════════════
        // INFO
        // ══════════════════════════════════════════════════════════════
        if (sub === 'info') {
            const selectedGuildId = client.database.get(`dm-guild-${userId}`);

            if (!selectedGuildId && !isFromGuild) {
                return interaction.reply({
                    content: '📭 No server has been selected.\nUse `/server select <id>` to select a server.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const guild = isFromGuild
                ? interaction.guild
                : client.guilds.cache.get(selectedGuildId);

            if (!guild) {
                client.database.delete(`dm-guild-${userId}`);
                return interaction.reply({
                    content: '❌ The selected server no longer exists. The selection has been automatically removed.\nUse `/server select` to select another server.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const botMember   = guild.members.me;
            const botPerms    = botMember?.permissions.toArray() ?? [];
            const hasAdmin    = botPerms.includes('Administrator');
            const hasMsgPerm  = hasAdmin || botPerms.includes('SendMessages');
            const hasRolePerm = hasAdmin || botPerms.includes('ManageRoles');

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('🏠 Currently Active Server')
                .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
                .addFields(
                    { name: '🏠 Server Name',  value: guild.name,                                                    inline: true },
                    { name: '🆔 ID',           value: `\`${guild.id}\``,                                              inline: true },
                    { name: '👥 Total Members', value: `${guild.memberCount}`,                                         inline: true },
                    { name: '👑 Server Owner', value: `<@${guild.ownerId}>`,                                          inline: true },
                    { name: '📅 Created',       value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,           inline: true },
                    { name: '\u200b',          value: '\u200b',                                                       inline: true },
                    { name: '🔑 Bot Permissions',
                      value: [
                        `Send Messages: ${hasMsgPerm  ? '✅' : '❌'}`,
                        `Manage Roles: ${hasRolePerm ? '✅' : '❌'}`,
                        `Administrator: ${hasAdmin   ? '✅' : '❌'}`,
                      ].join('\n'),
                      inline: false
                    }
                )
                .setFooter({ text: 'All commands will be executed in this server.' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // ══════════════════════════════════════════════════════════════
        // CHANNELS
        // ══════════════════════════════════════════════════════════════
        if (sub === 'channels') {
            // Ambil guild aktif (dari server langsung atau dari pilihan DM)
            const guild = getActiveGuild(client, userId, interaction);

            if (!guild) {
                return interaction.reply({
                    content: [
                        '⚠️ **No server has been selected.**',
                        'Use `/server select <id>` to select a server first.',
                        'Use `/server list` to view available servers.'
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            await guild.channels.fetch().catch(() => null);

            const tipeFilter = interaction.options.getString('type');
            const TIPE_MAP = {
                text:     [ChannelType.GuildText],
                voice:    [ChannelType.GuildVoice],
                category: [ChannelType.GuildCategory],
                news:     [ChannelType.GuildAnnouncement, ChannelType.AnnouncementThread],
                stage:    [ChannelType.GuildStageVoice],
                forum:    [ChannelType.GuildForum, ChannelType.GuildMedia],
            };

            let channels = [...guild.channels.cache.values()];
            if (tipeFilter && TIPE_MAP[tipeFilter]) {
                channels = channels.filter(c => TIPE_MAP[tipeFilter].includes(c.type));
            }

            // Sort: categories first, then by name
            channels.sort((a, b) => {
                if (a.type === ChannelType.GuildCategory && b.type !== ChannelType.GuildCategory) return -1;
                if (b.type === ChannelType.GuildCategory && a.type !== ChannelType.GuildCategory) return 1;
                return a.name.localeCompare(b.name);
            });

            if (channels.length === 0) {
                return interaction.reply({
                    content: `📭 No channels${tipeFilter ? ` with type **${tipeFilter}**` : ''} found in this server.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const lines  = channels.map(c =>
                `${typeLabel(c.type)} **${c.name}**\n> ID: \`${c.id}\``
            );
            const pages  = chunk(lines, 20);
            const total  = channels.length;
            const embeds = pages.map((page, i) =>
                new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle(
                        i === 0
                            ? `📋 Channels — ${guild.name}${tipeFilter ? ` (${tipeFilter})` : ''}`
                            : `📋 Channels (continued ${i + 1}/${pages.length})`
                    )
                    .setDescription(page.join('\n'))
                    .setFooter({
                        text: `Total: ${total} channel(s) · Server: ${guild.name}${tipeFilter ? ` · Filter: ${tipeFilter}` : ''}`
                    })
                    .setTimestamp()
            );

            return sendChunked(interaction, embeds);
        }

        // ══════════════════════════════════════════════════════════════
        // ROLES
        // ══════════════════════════════════════════════════════════════
        if (sub === 'roles') {
            const guild = getActiveGuild(client, userId, interaction);

            if (!guild) {
                return interaction.reply({
                    content: [
                        '⚠️ **No server selected.**',
                        'Use `/server select <id>` to select a server first.',
                        'Use `/server list` to see the list of available servers.'
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            await guild.roles.fetch().catch(() => null);

            const filter = interaction.options.getString('filter');

            let roles = [...guild.roles.cache.values()]
                .filter(r => r.id !== guild.id); // hapus @everyone

            if (filter === 'bot')     roles = roles.filter(r => r.managed);
            if (filter === 'manual')  roles = roles.filter(r => !r.managed);
            if (filter === 'booster') roles = roles.filter(r => r.tags?.premiumSubscriberRole);

            // Sort from highest to lowest position
            roles.sort((a, b) => b.position - a.position);

            if (roles.length === 0) {
                return interaction.reply({
                    content: `📭 Tidak ada role${filter ? ` with filter **${filter}**` : ''} in this server.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const lines = roles.map(r => {
                // 🛡️ = role administrator/managed (bot/integration)
                // 🎭 = role custom biasa
                const isAdmin = r.managed || r.permissions?.has?.('Administrator');
                const emoji   = isAdmin ? '🛡️' : '🎭';
                return `${emoji} <@&${r.id}> **${r.name}**\n> ID: \`${r.id}\``;
            });

            const pages  = chunk(lines, 15);
            const total  = roles.length;
            const embeds = pages.map((page, i) =>
                new EmbedBuilder()
                    .setColor('#FF73FA')
                    .setTitle(
                        i === 0
                            ? `🎭 Roles — ${guild.name}${filter ? ` (${filter})` : ''}`
                            : `🎭 Roles (continued ${i + 1}/${pages.length})`
                    )
                    .setDescription(page.join('\n'))
                    .setFooter({
                        text: `Total: ${total} role(s) · Server: ${guild.name}${filter ? ` · Filter: ${filter}` : ''} · Urutan: tertinggi → terendah`
                    })
                    .setTimestamp()
            );

            return sendChunked(interaction, embeds);
        }

        // ══════════════════════════════════════════════════════════════
        // COMMANDS
        // ══════════════════════════════════════════════════════════════
        if (sub === 'commands') {
            const guild = getActiveGuild(client, userId, interaction);

            if (!guild) {
                return interaction.reply({
                    content: [
                        '⚠️ **No server selected.**',
                        'Use `/server select <id>` to select a server first.',
                        'Use `/server list` to see the list of available servers.'
                    ].join('\n'),
                    flags: MessageFlags.Ephemeral
                });
            }

            const guildId   = guild.id;
            const category  = interaction.options.getString('category');

            // ── Helper baca db ────────────────────────────────────────
            const db = client.database;
            const getBoolCmd = (key, def) => {
                const raw = db.get(key);
                if (raw === null || raw === undefined) return def;
                if (raw === 'false' || raw === false || raw === 0) return false;
                return true;
            };
            const getStr = (key, fallback = null) => db.get(key) ?? fallback;
            const channelMention = (id) => id ? `<#${id}>` : '`not set`';
            const roleMention    = (id) => id ? `<@&${id}>` : '`not set`';
            const tick = (val) => val ? '✅ Enabled' : '❌ Disabled';

            // ── Definisi semua command beserta status ─────────────────
            const ALL_CATEGORIES = {

                member: {
                    label: '👋 Member',
                    commands: [
                        {
                            name: '`/welcome`',
                            desc: 'New member welcome message.',
                            fields: [
                                { name: 'Status',   value: tick(getBoolCmd(`welcome-enabled-${guildId}`, true)),          inline: true },
                                { name: 'Channel',  value: channelMention(getStr(`welcome-channel-${guildId}`)),           inline: true },
                                { name: 'Thumbnail',value: tick(getBoolCmd(`welcome-thumbnail-${guildId}`, true)),         inline: true },
                                { name: 'Title',    value: `\`${getStr(`welcome-title-${guildId}`, '👋 Welcome to {server}!')}\``, inline: false },
                            ]
                        },
                        {
                            name: '`/goodbye`',
                            desc: 'Member leave farewell message.',
                            fields: [
                                { name: 'Status',   value: tick(getBoolCmd(`goodbye-enabled-${guildId}`, true)),           inline: true },
                                { name: 'Channel',  value: channelMention(getStr(`goodbye-channel-${guildId}`)),           inline: true },
                                { name: 'Thumbnail',value: tick(getBoolCmd(`goodbye-thumbnail-${guildId}`, true)),         inline: true },
                                { name: 'Title',    value: `\`${getStr(`goodbye-title-${guildId}`, '👋 Goodbye!')}\``, inline: false },
                            ]
                        },
                    ]
                },

                role: {
                    label: '🎭 Role',
                    commands: [
                        {
                            name: '`/autorole`',
                            desc: 'Automatic role when member/bot joins.',
                            fields: [
                                { name: 'Human — Status', value: tick(getBoolCmd(`autorole-human-enabled-${guildId}`, false)), inline: true },
                                { name: 'Human — Role',   value: roleMention(getStr(`autorole-human-role-${guildId}`)),        inline: true },
                                { name: '\u200b',          value: '\u200b',                                                     inline: true },
                                { name: 'Bot — Status',   value: tick(getBoolCmd(`autorole-bot-enabled-${guildId}`, false)),   inline: true },
                                { name: 'Bot — Role',     value: roleMention(getStr(`autorole-bot-role-${guildId}`)),          inline: true },
                                { name: '\u200b',          value: '\u200b',                                                     inline: true },
                            ]
                        },
                    ]
                },

                booster: {
                    label: '💎 Booster',
                    commands: [
                        {
                            name: '`/booster`',
                            desc: 'Notifications & autorole for server boosters.',
                            fields: [
                                { name: '🚀 Boost — Status',   value: tick(getBoolCmd(`booster-boost-enabled-${guildId}`, false)),      inline: true },
                                { name: '🚀 Boost — Channel',  value: channelMention(getStr(`booster-boost-channel-${guildId}`)),       inline: true },
                                { name: '\u200b',               value: '\u200b',                                                         inline: true },
                                { name: '💔 Unboost — Status', value: tick(getBoolCmd(`booster-unboost-enabled-${guildId}`, false)),    inline: true },
                                { name: '💔 Unboost — Channel',value: channelMention(getStr(`booster-unboost-channel-${guildId}`)),     inline: true },
                                { name: '\u200b',               value: '\u200b',                                                         inline: true },
                                { name: '🎭 Autorole — Status',value: tick(getBoolCmd(`booster-autorole-enabled-${guildId}`, false)),   inline: true },
                                { name: '🎭 Autorole — Role',  value: roleMention(getStr(`booster-autorole-role-${guildId}`)),          inline: true },
                                { name: '🗑️ Auto-remove',      value: tick(getBoolCmd(`booster-autoremove-enabled-${guildId}`, false)), inline: true },
                            ]
                        },
                    ]
                },

                pesan: {
                    label: '📨 Messages & Embed',
                    commands: [
                        {
                            name: '`/message`',
                            desc: 'Saved message templates that can be sent to any channel.',
                            fields: (() => {
                                const raw  = db.get(`pesan-list-${guildId}`);
                                let list   = [];
                                try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
                                return [
                                    {
                                        name:  'Saved Templates',
                                        value: list.length
                                            ? list.map(n => `\`${n}\``).join(', ')
                                            : '`(no templates)`',
                                        inline: false
                                    }
                                ];
                            })()
                        },
                        {
                            name: '`/embed`',
                            desc: 'Create & send a custom embed to a server channel.',
                            fields: [
                                { name: 'How to use', value: '`/embed buat` → edit → `/embed kirim`', inline: false }
                            ]
                        },
                    ]
                },

                utility: {
                    label: '🔧 Utilities',
                    commands: [
                        {
                            name: '`/ping`',
                            desc: 'Check bot latency to the Discord API.',
                            fields: [
                                { name: 'How to use', value: '`/ping`', inline: false }
                            ]
                        },
                        {
                            name: '`!setprefix`',
                            desc: 'Change the message command prefix for this server.',
                            fields: [
                                { name: 'Current Prefix', value: `\`${getStr(`prefix-${guildId}`, config.commands.prefix)}\``, inline: false }
                            ]
                        },
                        {
                            name: '`/invites`',
                            desc: 'View the total invitations of a member.',
                            fields: [
                                { name: 'How to use', value: '`/invites [member]`', inline: false }
                            ]
                        },
                        {
                            name: '`/serverstats`',
                            desc: 'Automatic voice channels showing member, user, and bot counts.',
                            fields: (() => {
                                const getBoolCmd = (key, def) => {
                                    const raw = db.get(key);
                                    if (raw === null || raw === undefined) return def;
                                    if (raw === 'false' || raw === false || raw === 0) return false;
                                    return true;
                                };
                                const enabled    = getBoolCmd(`serverstats-enabled-${guildId}`, false);
                                const categoryId = getStr(`serverstats-category-${guildId}`);
                                const totalId    = getStr(`serverstats-total-channel-${guildId}`);
                                const humanId    = getStr(`serverstats-human-channel-${guildId}`);
                                const botId      = getStr(`serverstats-bot-channel-${guildId}`);
                                const totalLabel = getStr(`serverstats-total-label-${guildId}`, '👥 Total Member: {count}');
                                const humanLabel = getStr(`serverstats-human-label-${guildId}`, '👤 User: {count}');
                                const botLabel   = getStr(`serverstats-bot-label-${guildId}`,   '🤖 Bot: {count}');
                                return [
                                    { name: 'Status',    value: enabled ? '✅ Enabled' : '❌ Disabled', inline: true  },
                                    { name: 'Category',  value: categoryId ? `<#${categoryId}>` : '`not set`', inline: true },
                                    { name: '\u200b',           value: '\u200b', inline: true },
                                    { name: 'Total Channel',  value: totalId  ? `<#${totalId}>` : '`not set`', inline: true  },
                                    { name: 'User Channel',   value: humanId  ? `<#${humanId}>` : '`not set`', inline: true  },
                                    { name: 'Bot Channel',    value: botId    ? `<#${botId}>` : '`not set`',   inline: true  },
                                    { name: 'Total Format',   value: `\`${totalLabel}\``, inline: false },
                                    { name: 'User Format',    value: `\`${humanLabel}\``, inline: true  },
                                    { name: 'Bot Format',     value: `\`${botLabel}\``,   inline: true  },
                                ];
                            })()
                        },
                    ]
                },
            };

            // ── Tentukan kategori yang akan ditampilkan ────────────────
            const selectedCats = category
                ? (ALL_CATEGORIES[category] ? [ALL_CATEGORIES[category]] : [])
                : Object.values(ALL_CATEGORIES);

            if (selectedCats.length === 0) {
                return interaction.reply({
                    content: `❌ Category **${category}** not recognized.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // ── Bangun embed per-kategori ──────────────────────────────
            const COLOR_MAP = {
                member:  '#57F287',
                role:    '#FF73FA',
                booster: '#FEE75C',
                pesan:   '#5865F2',
                utility: '#EB459E',
            };
            const catKey = kategori ?? 'semua';
            const baseColor = COLOR_MAP[kategori] ?? '#5865F2';

            const embeds = [];

            for (const cat of selectedCats) {
                for (const cmd of cat.commands) {
                    const embed = new EmbedBuilder()
                        .setColor(baseColor)
                        .setAuthor({ name: `${cat.label} · ${guild.name}` })
                        .setTitle(cmd.name)
                        .setDescription(`> ${cmd.desc}`)
                        .addFields(cmd.fields)
                        .setTimestamp();
                    embeds.push(embed);
                }
            }

            // Tambah embed ringkasan di awal
            const summaryEmbed = new EmbedBuilder()
                .setColor(baseColor)
                .setTitle(`🗂️ Command List — ${guild.name}`)
                .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
                .setDescription(
                    selectedCats.map(cat =>
                        `**${cat.label}**\n` +
                        cat.commands.map(c => `• ${c.name} — ${c.desc}`).join('\n')
                    ).join('\n\n') +
                    '\n\n> Use `/server commands category:<name>` to view details per category.'
                )
                .setFooter({
                    text: `Server: ${guild.name}${category ? ` · Category: ${category}` : ' · All categories'}`
                })
                .setTimestamp();

            // Gabung: summary + detail per command
            const allEmbeds = [summaryEmbed, ...embeds];

            // Discord max 10 embeds per message — kirim bertahap jika > 10
            const BATCH = 10;
            await interaction.reply({
                embeds: allEmbeds.slice(0, BATCH),
                flags: MessageFlags.Ephemeral
            });
            for (let i = BATCH; i < allEmbeds.length; i += BATCH) {
                await interaction.followUp({
                    embeds: allEmbeds.slice(i, i + BATCH),
                    flags: MessageFlags.Ephemeral
                });
            }
            return;
        }

        // ══════════════════════════════════════════════════════════════
        // BATALKAN
        // ══════════════════════════════════════════════════════════════
        if (sub === 'cancel') {
            const existing = client.database.get(`dm-guild-${userId}`);

            if (!existing) {
                return interaction.reply({
                    content: '⚠️ No active server is currently selected.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const guild = client.guilds.cache.get(existing);
            client.database.delete(`dm-guild-${userId}`);

            return interaction.reply({
                content: `✅ Server selection **${guild?.name ?? existing}** has been cancelled.\nCommands from DM will not be forwarded to any server until you select one again.`,
                flags: MessageFlags.Ephemeral
            });
        }
    }
}).toJSON();

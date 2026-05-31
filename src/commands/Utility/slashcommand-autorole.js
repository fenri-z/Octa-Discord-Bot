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

// Validasi role umum — kembalikan pesan error atau null jika valid
function validateRole(guild, role, interaction) {
    if (!role) {
        interaction.reply({ content: '❌ Role tidak ditemukan. Gunakan mention `@role` atau ID role.', flags: MessageFlags.Ephemeral });
        return false;
    }
    if (role.managed) {
        interaction.reply({ content: '❌ Role yang dikelola integrasi eksternal tidak bisa digunakan sebagai autorole.', flags: MessageFlags.Ephemeral });
        return false;
    }
    if (role.id === guild.id) {
        interaction.reply({ content: '❌ Role `@everyone` tidak bisa digunakan sebagai autorole.', flags: MessageFlags.Ephemeral });
        return false;
    }
    return true;
}

// ── Command ────────────────────────────────────────────────────────────────
module.exports = new ApplicationCommand({
    command: {
        name: 'autorole',
        description: 'Konfigurasi role otomatis saat member/bot bergabung ke server.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            // ── status ────────────────────────────────────────────────────
            {
                name: 'status',
                description: 'Lihat konfigurasi autorole saat ini.',
                type: 1
            },

            // ── join ──────────────────────────────────────────────────────
            {
                name: 'join',
                description: 'Atur autorole saat member atau bot bergabung.',
                type: 2, // SUB_COMMAND_GROUP
                options: [
                    {
                        name: 'set',
                        description: 'Tetapkan role yang diberikan otomatis saat join.',
                        type: 1,
                        options: [
                            {
                                name: 'type',
                                description: 'Pilih target: member, bot, atau all (keduanya).',
                                type: 3, // STRING
                                required: true,
                                choices: [
                                    { name: 'Member', value: 'member' },
                                    { name: 'Bot',             value: 'bot'   },
                                    { name: 'All (Semua)',     value: 'all'   }
                                ]
                            },
                            {
                                name: 'role',
                                description: 'Role yang akan diberikan otomatis.',
                                type: 3, // STRING — di-resolve oleh resolveRole
                                autocomplete: true,
                                required: true
                            },
                            {
                                name: 'role_bot',
                                description: '(Hanya untuk type=all) Role khusus untuk bot. Kosongkan = pakai role yang sama.',
                                type: 3,
                                autocomplete: true,
                                required: false
                            }
                        ]
                    },
                    {
                        name: 'toggle',
                        description: 'Aktifkan atau nonaktifkan autorole join.',
                        type: 1,
                        options: [
                            {
                                name: 'type',
                                description: 'Pilih target: member, bot, atau all.',
                                type: 3,
                                required: true,
                                choices: [
                                    { name: 'Member', value: 'member' },
                                    { name: 'Bot',             value: 'bot'   },
                                    { name: 'All (Semua)',     value: 'all'   }
                                ]
                            },
                            {
                                name: 'aktif',
                                description: 'true = nyalakan, false = matikan.',
                                type: 5, // BOOLEAN
                                required: true
                            }
                        ]
                    },
                    {
                        name: 'remove',
                        description: 'Hapus konfigurasi autorole join.',
                        type: 1,
                        options: [
                            {
                                name: 'type',
                                description: 'Pilih target yang ingin dihapus: member, bot, atau all.',
                                type: 3,
                                required: true,
                                choices: [
                                    { name: 'Member', value: 'member' },
                                    { name: 'Bot',             value: 'bot'   },
                                    { name: 'All (Semua)',     value: 'all'   }
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
                .setTitle('⚙️ Konfigurasi Autorole Join')
                .setColor('#5865F2')
                .addFields(
                    {
                        name: '👤 Autorole Member',
                        value: [
                            `**Status:** ${cfg.memberEnabled ? '✅ Aktif' : '❌ Nonaktif'}`,
                            `**Role:** ${memberRole ? `${memberRole}` : '`Belum diatur`'}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '🤖 Autorole Bot',
                        value: [
                            `**Status:** ${cfg.botEnabled ? '✅ Aktif' : '❌ Nonaktif'}`,
                            `**Role:** ${botRole ? `${botRole}` : '`Belum diatur`'}`
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

            // Untuk type=all, cek role_bot (opsional — fallback ke role utama)
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
                        .setTitle('✅ Autorole Join Diatur')
                        .setDescription(lines.join('\n') + '\n\nStatus otomatis **diaktifkan**.')
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /autorole join toggle ──────────────────────────────────────────
        if (subGroup === 'join' && sub === 'toggle') {
            const type  = options.getString('type');
            const aktif = options.getBoolean('aktif');

            // Validasi jika diaktifkan tapi role belum diset
            if (aktif) {
                if ((type === 'member' || type === 'all') && !cfg.memberRoleId) {
                    return interaction.reply({
                        content: '❌ Role member belum diatur. Gunakan `/autorole join set` terlebih dahulu.',
                        flags: MessageFlags.Ephemeral
                    });
                }
                if ((type === 'bot' || type === 'all') && !cfg.botRoleId) {
                    return interaction.reply({
                        content: '❌ Role bot belum diatur. Gunakan `/autorole join set` terlebih dahulu.',
                        flags: MessageFlags.Ephemeral
                    });
                }
            }

            const lines = [];

            if (type === 'member' || type === 'all') {
                setBool(client, `autorole-member-enabled-${guild.id}`, aktif);
                lines.push(`👤 Autorole **Member** ${aktif ? '✅ diaktifkan' : '❌ dinonaktifkan'}`);
            }

            if (type === 'bot' || type === 'all') {
                setBool(client, `autorole-bot-enabled-${guild.id}`, aktif);
                lines.push(`🤖 Autorole **Bot** ${aktif ? '✅ diaktifkan' : '❌ dinonaktifkan'}`);
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(aktif ? '#57F287' : '#ED4245')
                        .setTitle(`${aktif ? '✅' : '❌'} Toggle Autorole Join`)
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
                lines.push('👤 Konfigurasi autorole **Member** dihapus.');
            }

            if (type === 'bot' || type === 'all') {
                client.database.delete(`autorole-bot-role-${guild.id}`);
                setBool(client, `autorole-bot-enabled-${guild.id}`, false);
                lines.push('🤖 Konfigurasi autorole **Bot** dihapus.');
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('🗑️ Autorole Join Dihapus')
                        .setDescription(lines.join('\n'))
                ],
                flags: MessageFlags.Ephemeral
            });
        }
    }
}).toJSON();

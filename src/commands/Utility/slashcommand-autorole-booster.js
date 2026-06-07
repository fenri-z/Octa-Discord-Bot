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

function setBool(client, key, val) {
    client.database.set(key, val ? 'true' : 'false');
}

function getBool(client, key, defaultVal) {
    const raw = client.database.get(key);
    if (raw === null || raw === undefined) return defaultVal;
    if (raw === 'false' || raw === false || raw === 0) return false;
    return true;
}

module.exports = new ApplicationCommand({
    command: {
        name: 'autorole-booster',
        description: 'Configure automatic role assignment for server boosters.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            {
                name: 'status',
                description: 'View the current booster autorole configuration.',
                type: 1
            },
            {
                name: 'set',
                description: 'Set the role automatically given when someone boosts the server.',
                type: 1,
                options: [{
                    name: 'role', description: 'Booster role (mention @role or ID)', type: 3, autocomplete: true,
required: true
                }]
            },
            {
                name: 'toggle',
                description: 'Enable / disable booster autorole.',
                type: 1,
                options: [{ name: 'active', description: 'true = enable', type: 5, required: true }]
            },
            {
                name: 'autoremove',
                description: 'Automatically remove the booster role when someone stops boosting.',
                type: 1,
                options: [{ name: 'active', description: 'true = enable auto-removal', type: 5, required: true }]
            },
            {
                name: 'remove',
                description: 'Remove the booster autorole configuration.',
                type: 1
            }
        ]
    },

    options: { cooldown: 3000 },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const s       = getStrings(getLang(client.database, interaction.guild?.id)).booster;
        const { guild, options } = interaction;
        const sub     = options.getSubcommand();
        const guildId = guild.id;

        const ok = await checkBotPermissions(interaction, [PermissionFlagsBits.ManageRoles]);
        if (!ok) return;

        // ── /autorole-booster status ───────────────────────────────────────
        if (sub === 'status') {
            const autoroleRoleId    = client.database.get(`booster-autorole-role-${guildId}`) ?? null;
            const autoroleEnabled   = getBool(client, `booster-autorole-enabled-${guildId}`,  false);
            const autoremoveEnabled = getBool(client, `booster-autoremove-enabled-${guildId}`, false);
            const arRole            = autoroleRoleId ? guild.roles.cache.get(autoroleRoleId) : null;

            const embed = new EmbedBuilder()
                .setTitle(s.autorole_status_title)
                .setColor('#FF73FA')
                .addFields({
                    name: s.field_autorole,
                    value: [
                        `**Status:** ${autoroleEnabled ? '✅ Enabled' : '❌ Disabled'}`,
                        `**Role:** ${arRole ? `${arRole}` : '`Not set`'}`,
                        `**Remove on unboost:** ${autoremoveEnabled ? '✅ Yes' : '❌ No'}`
                    ].join('\n'),
                    inline: false
                })
                .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) ?? undefined })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (sub === 'set') {
            const role = resolveRole(interaction.guild, options.getString('role'));
            if (!role)             return interaction.reply({ content: s.role_not_found, flags: MessageFlags.Ephemeral });
            if (role.managed)      return interaction.reply({ content: s.role_managed,   flags: MessageFlags.Ephemeral });
            if (role.id === guildId) return interaction.reply({ content: s.role_everyone, flags: MessageFlags.Ephemeral });

            client.database.set(`booster-autorole-role-${guildId}`, role.id);
            setBool(client, `booster-autorole-enabled-${guildId}`, true);

            return interaction.reply({
                embeds: [new EmbedBuilder().setColor('#57F287').setDescription(s.autorole_set(role))],
                flags: MessageFlags.Ephemeral
            });
        }

        if (sub === 'toggle') {
            const active      = options.getBoolean('active');
            const autoroleId  = client.database.get(`booster-autorole-role-${guildId}`);
            if (active && !autoroleId) return interaction.reply({ content: s.autorole_unset, flags: MessageFlags.Ephemeral });
            setBool(client, `booster-autorole-enabled-${guildId}`, active);
            return interaction.reply({ content: active ? s.autorole_enabled : s.autorole_disabled, flags: MessageFlags.Ephemeral });
        }

        if (sub === 'autoremove') {
            const active = options.getBoolean('active');
            setBool(client, `booster-autoremove-enabled-${guildId}`, active);
            return interaction.reply({ content: active ? s.autoremove_on : s.autoremove_off, flags: MessageFlags.Ephemeral });
        }

        if (sub === 'remove') {
            client.database.delete(`booster-autorole-role-${guildId}`);
            setBool(client, `booster-autorole-enabled-${guildId}`, false);
            setBool(client, `booster-autoremove-enabled-${guildId}`, false);
            return interaction.reply({
                embeds: [new EmbedBuilder().setColor('#ED4245').setDescription(s.autorole_removed)],
                flags: MessageFlags.Ephemeral
            });
        }
    }
}).toJSON();

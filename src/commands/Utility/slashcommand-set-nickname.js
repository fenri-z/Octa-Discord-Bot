const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { getLang, getStrings } = require('../../utils/BotLang');

module.exports = new ApplicationCommand({
    command: {
        name: 'set-nickname',
        description: 'Change or reset the bot nickname in this server.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageNicknames),
        options: [
            {
                name: 'name',
                description: 'New nickname for the bot (leave empty to reset to original name)',
                type: 3,
                required: false,
                max_length: 32
            }
        ]
    },

    options: { botOwner: false },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const s           = getStrings(getLang(client.database, interaction.guild?.id)).set_nickname;
        const { guild } = interaction;
        const newNickname = interaction.options.getString('name')?.trim() || null;

        // Fetch bot member in this guild
        const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        if (!botMember) {
            return interaction.reply({
                content: s.fetch_failed,
                flags: MessageFlags.Ephemeral
            });
        }

        // Check if bot has ChangeNickname permission (for itself)
        if (!botMember.permissions.has(PermissionFlagsBits.ChangeNickname)) {
            return interaction.reply({
                content: s.no_perm,
                flags: MessageFlags.Ephemeral
            });
        }

        const oldNickname = botMember.nickname ?? botMember.user.username;

        try {
            await botMember.setNickname(
                newNickname,
                `Changed by ${interaction.user.tag} via /set-nickname`
            );
        } catch (err) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle(s.fail_title)
                        .setDescription(s.fail_desc(err.message))
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Success
        const isReset = newNickname === null;
        const currentName = newNickname ?? botMember.user.username;

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(isReset ? '#5865F2' : '#57F287')
                    .setTitle(isReset ? s.reset_title : s.changed_title)
                    .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
                    .addFields(
                        {
                            name: s.field_before,
                            value: `\`${oldNickname}\``,
                            inline: true
                        },
                        {
                            name: isReset ? s.field_after_reset : s.field_after,
                            value: `\`${currentName}\``,
                            inline: true
                        },
                        {
                            name: s.field_changed_by,
                            value: `${interaction.user}`,
                            inline: false
                        }
                    )
                    .setFooter({ text: isReset ? s.footer_reset : s.footer_changed })
                    .setTimestamp()
            ],
            flags: MessageFlags.Ephemeral
        });
    }
}).toJSON();

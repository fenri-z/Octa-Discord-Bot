const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");

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
        const { guild } = interaction;
        const newNickname = interaction.options.getString('name')?.trim() || null;

        // Fetch bot member in this guild
        const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        if (!botMember) {
            return interaction.reply({
                content: '❌ Failed to fetch bot data from the server. Please try again.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Check if bot has ChangeNickname permission (for itself)
        if (!botMember.permissions.has(PermissionFlagsBits.ChangeNickname)) {
            return interaction.reply({
                content: '❌ Bot does not have **Change Nickname** permission in this server.',
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
            // Bot cannot change its nickname if its role is below the highest admin/owner
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('❌ Failed to Change Nickname')
                        .setDescription(
                            'The bot cannot change its own nickname in this server.\n\n' +
                            '**Possible reasons:**\n' +
                            '• Bot role is below the Administrator/Owner role\n' +
                            '• The server owner cannot be nicknamed by the bot\n\n' +
                            `**Error details:** \`${err.message}\``
                        )
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
                    .setTitle(isReset ? '🔄 Bot Nickname Reset' : '✏️ Bot Nickname Changed')
                    .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
                    .addFields(
                        {
                            name: '📛 Before',
                            value: `\`${oldNickname}\``,
                            inline: true
                        },
                        {
                            name: isReset ? '🔄 After (Reset)' : '✅ After',
                            value: `\`${currentName}\``,
                            inline: true
                        },
                        {
                            name: '👤 Changed by',
                            value: `${interaction.user}`,
                            inline: false
                        }
                    )
                    .setFooter({ text: isReset ? 'Nickname successfully reset to the bot\'s original name.' : 'Use /set-nickname without filling in a name to reset.' })
                    .setTimestamp()
            ],
            flags: MessageFlags.Ephemeral
        });
    }
}).toJSON();

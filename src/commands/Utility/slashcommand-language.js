const { ChatInputCommandInteraction, PermissionFlagsBits, MessageFlags } = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { getLang, setLang, getStrings } = require("../../utils/BotLang");

const LANG_NAMES = { en: 'English', id: 'Indonesia' };

module.exports = new ApplicationCommand({
    command: {
        name: 'language',
        description: 'Change the bot language for this server.',
        type: 1,
        options: [
            {
                type: 3,
                name: 'language',
                description: 'Select a language.',
                required: true,
                choices: [
                    { name: 'English',   value: 'en' },
                    { name: 'Indonesia', value: 'id' },
                ]
            }
        ]
    },
    options: {
        cooldown: 5
    },
    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const currentLang = getLang(client.database, interaction.guild.id);
        const s           = getStrings(currentLang).language;

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: s.no_permission, flags: MessageFlags.Ephemeral });
        }

        const selected = interaction.options.getString('language');

        if (selected === currentLang) {
            return interaction.reply({ content: s.already(LANG_NAMES[selected]), flags: MessageFlags.Ephemeral });
        }

        setLang(client.database, interaction.guild.id, selected);

        return interaction.reply({ content: getStrings(selected).language.changed(LANG_NAMES[selected]) });
    }
}).toJSON();

const {
    ButtonInteraction,
    EmbedBuilder,
} = require('discord.js');
const DiscordBot  = require('../../client/DiscordBot');
const Component   = require('../../structure/Component');
const { getLang, getStrings } = require('../../utils/BotLang');

module.exports = new Component({
    customId: 'serverstats-reset-cancel',
    type: 'button',
    /**
     * @param {DiscordBot} client
     * @param {ButtonInteraction} interaction
     */
    run: async (client, interaction) => {
        const s = getStrings(getLang(client.database, interaction.guild?.id)).serverstats;
        const embed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle(s.reset_cancel_title)
            .setDescription(s.reset_cancel_desc)
            .setTimestamp();

        return interaction.update({ embeds: [embed], components: [] });
    }
}).toJSON();

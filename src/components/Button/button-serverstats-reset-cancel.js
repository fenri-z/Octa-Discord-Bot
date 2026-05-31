const {
    ButtonInteraction,
    EmbedBuilder,
} = require('discord.js');
const DiscordBot  = require('../../client/DiscordBot');
const Component   = require('../../structure/Component');

module.exports = new Component({
    customId: 'serverstats-reset-cancel',
    type: 'button',
    /**
     * @param {DiscordBot} client
     * @param {ButtonInteraction} interaction
     */
    run: async (client, interaction) => {
        const embed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ Reset Dibatalkan')
            .setDescription('> Reset Server Stats dibatalkan. Tidak ada perubahan yang dilakukan.')
            .setTimestamp();

        return interaction.update({ embeds: [embed], components: [] });
    }
}).toJSON();

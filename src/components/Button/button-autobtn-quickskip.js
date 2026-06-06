const { ButtonInteraction, EmbedBuilder, MessageFlags } = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");
const { getLang, getStrings } = require('../../utils/BotLang');

// ── Handler: ⏭️ Skip ─────────────────────────────────────────────────────────
// customId format: autobtn-quickskip:<panelName>

module.exports = new Component({
    customId: 'autobtn-quickskip',
    type: 'button',

    /**
     * @param {DiscordBot} client
     * @param {ButtonInteraction} interaction
     */
    run: async (client, interaction) => {
        const panelName = interaction.customId.split(':').slice(1).join(':');
        const s = getStrings(getLang(client.database, interaction.guild?.id)).autorole_button;

        return interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle(s.qs_ready_title(panelName))
                    .setDescription(s.qs_ready_desc(panelName))
                    .setTimestamp()
            ],
            components: []
        });
    }
}).toJSON();

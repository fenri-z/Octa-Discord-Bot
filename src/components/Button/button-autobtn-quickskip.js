const { ButtonInteraction, EmbedBuilder, MessageFlags } = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");

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

        return interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle(`✅ Panel \`${panelName}\` Ready`)
                    .setDescription(
                        `Panel created successfully. Add buttons at any time with the following commands:\n\n` +
                        `• \`/autorole-button add-button\` — add buttons one at a time\n` +
                        `• \`/autorole-button add-bulk\` — add multiple buttons at once\n` +
                        `• \`/autorole-button send ${panelName}\` — send the panel to a channel when ready`
                    )
                    .setTimestamp()
            ],
            components: []
        });
    }
}).toJSON();

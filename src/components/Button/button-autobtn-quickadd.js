const { ButtonInteraction, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");

// ── Handler: ➕ Add Button Now ────────────────────────────────────────────────
// customId format: autobtn-quickadd:<panelName>

module.exports = new Component({
    customId: 'autobtn-quickadd',
    type: 'button',

    /**
     * @param {DiscordBot} client
     * @param {ButtonInteraction} interaction
     */
    run: async (client, interaction) => {
        const panelName = interaction.customId.split(':').slice(1).join(':');

        // Save pending quickadd so the modal handler knows which panel is targeted
        client.database.set(
            `autobtn-quickadd-${interaction.guild.id}-${interaction.user.id}`,
            panelName
        );

        // Open modal to fill in first button data
        await interaction.showModal({
            custom_id: `autobtn-quickadd-modal:${panelName}`,
            title: `Add Button — ${panelName}`.slice(0, 45),
            components: [
                {
                    type: 1,
                    components: [{
                        type: 4,
                        custom_id: 'quickadd-role',
                        label: 'Role (mention or ID, e.g.: @Gaming)',
                        style: 1,
                        placeholder: '@RoleName or 123456789012345678',
                        required: true,
                        max_length: 100
                    }]
                },
                {
                    type: 1,
                    components: [{
                        type: 4,
                        custom_id: 'quickadd-label',
                        label: 'Button Label (max 80 characters)',
                        style: 1,
                        placeholder: 'Example: 🎮 Gaming',
                        required: true,
                        max_length: 80
                    }]
                },
                {
                    type: 1,
                    components: [{
                        type: 4,
                        custom_id: 'quickadd-warna',
                        label: 'Button Color (optional)',
                        style: 1,
                        placeholder: 'primary / success / danger / secondary  (default: primary)',
                        required: false,
                        max_length: 10
                    }]
                }
            ]
        });
    }
}).toJSON();

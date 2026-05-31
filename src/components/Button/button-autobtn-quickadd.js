const { ButtonInteraction, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");

// ── Handler: ➕ Tambah Button Sekarang ────────────────────────────────────────
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

        // Simpan pending quickadd agar modal handler tahu panel mana yang dituju
        client.database.set(
            `autobtn-quickadd-${interaction.guild.id}-${interaction.user.id}`,
            panelName
        );

        // Buka modal isi data button pertama
        await interaction.showModal({
            custom_id: `autobtn-quickadd-modal:${panelName}`,
            title: `Tambah Button — ${panelName}`.slice(0, 45),
            components: [
                {
                    type: 1,
                    components: [{
                        type: 4,
                        custom_id: 'quickadd-role',
                        label: 'Role (mention atau ID, contoh: @Gaming)',
                        style: 1,
                        placeholder: '@NamaRole atau 123456789012345678',
                        required: true,
                        max_length: 100
                    }]
                },
                {
                    type: 1,
                    components: [{
                        type: 4,
                        custom_id: 'quickadd-label',
                        label: 'Label Tombol (maks 80 karakter)',
                        style: 1,
                        placeholder: 'Contoh: 🎮 Gaming',
                        required: true,
                        max_length: 80
                    }]
                },
                {
                    type: 1,
                    components: [{
                        type: 4,
                        custom_id: 'quickadd-warna',
                        label: 'Warna Tombol (opsional)',
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

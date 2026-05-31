const { ButtonInteraction, EmbedBuilder, MessageFlags } = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");

// ── Handler: ⏭️ Lewati ────────────────────────────────────────────────────────
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
                    .setTitle(`✅ Panel \`${panelName}\` Siap`)
                    .setDescription(
                        `Panel berhasil dibuat. Tambahkan tombol kapan saja dengan perintah berikut:\n\n` +
                        `• \`/autorole-button tambah-button\` — tambah tombol satu per satu\n` +
                        `• \`/autorole-button tambah-bulk\` — tambah banyak tombol sekaligus\n` +
                        `• \`/autorole-button kirim ${panelName}\` — kirim panel ke channel setelah selesai`
                    )
                    .setTimestamp()
            ],
            components: []
        });
    }
}).toJSON();

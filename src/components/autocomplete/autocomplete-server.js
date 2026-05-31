const AutocompleteComponent = require("../../structure/AutocompleteComponent");
const { isDeveloper } = require("../../utils/dmGuildProxy");

module.exports = new AutocompleteComponent({
    commandName: 'server',

    /**
     * @param {import("../../client/DiscordBot")} client
     * @param {import("discord.js").AutocompleteInteraction} interaction
     */
    run: async (client, interaction) => {
        // Hanya owner/developer yang boleh melihat daftar server
        if (!isDeveloper(interaction.user.id)) {
            return interaction.respond([]).catch(() => null);
        }

        const focused         = interaction.options.getFocused().toLowerCase().trim();
        const selectedGuildId = client.database.get(`dm-guild-${interaction.user.id}`);
        const guilds          = [...client.guilds.cache.values()];

        const choices = guilds
            // Filter berdasarkan input user (nama atau ID)
            .filter(g =>
                !focused ||
                g.name.toLowerCase().includes(focused) ||
                g.id.includes(focused)
            )
            // Server aktif tampil paling atas, sisanya alfabetis
            .sort((a, b) => {
                if (a.id === selectedGuildId) return -1;
                if (b.id === selectedGuildId) return  1;
                return a.name.localeCompare(b.name);
            })
            .slice(0, 25)
            .map(g => {
                const isActive = g.id === selectedGuildId;
                return {
                    name:  `${isActive ? '▶ ' : ''}${g.name} · ${g.memberCount} member`.slice(0, 100),
                    value: g.id
                };
            });

        await interaction.respond(choices).catch(() => null);
    }
}).toJSON();

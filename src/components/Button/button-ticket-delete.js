const {
    ButtonInteraction, PermissionFlagsBits, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");
const { getLang, getStrings } = require('../../utils/BotLang');

function isStaff(member, guildId, client) {
    if (member.id === member.guild.ownerId) return true;
    const raw = client.database.get(`ticket-staff-roles-${guildId}`);
    let roles = [];
    try { roles = raw ? JSON.parse(raw) : []; } catch {}
    return roles.some(id => member.roles.cache.has(id));
}

module.exports = new Component({
    customId: 'ticket-delete',
    type: 'button',

    /**
     * @param {DiscordBot} client
     * @param {ButtonInteraction} interaction
     */
    run: async (client, interaction) => {
        const { guild, member, channel } = interaction;
        const guildId = guild.id;
        const s = getStrings(getLang(client.database, guildId)).ticket;

        if (!isStaff(member, guildId, client)) {
            return interaction.reply({ content: s.delete_no_perm, flags: MessageFlags.Ephemeral });
        }

        const confirmEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle(s.delete_confirm_title)
            .setDescription(s.delete_confirm_desc);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket-delete-confirm')
                .setLabel(s.delete_yes_btn)
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('ticket-delete-cancel')
                .setLabel(s.delete_cancel_btn)
                .setStyle(ButtonStyle.Secondary),
        );

        await interaction.reply({ embeds: [confirmEmbed], components: [row], flags: MessageFlags.Ephemeral });

        // Auto-delete channel if no response within 30 seconds
        const collector = channel.createMessageComponentCollector({
            filter: i => i.user.id === member.id && ['ticket-delete-confirm', 'ticket-delete-cancel'].includes(i.customId),
            max: 1, time: 30_000
        });

        collector.on('collect', async i => {
            if (i.customId === 'ticket-delete-cancel') {
                await i.reply({ content: s.delete_cancelled, flags: MessageFlags.Ephemeral });
                return;
            }

            // Delete data from database
            const raw = client.database.get(`ticket-info-${guildId}-${channel.id}`);
            if (raw) {
                try {
                    const info = JSON.parse(raw);
                    client.database.delete(`ticket-user-${guildId}-${info.userId}`);
                } catch {}
                client.database.delete(`ticket-info-${guildId}-${channel.id}`);
            }

            await i.reply({ content: s.delete_deleting, flags: MessageFlags.Ephemeral }).catch(() => null);

            // Delay 3 seconds then delete
            setTimeout(async () => {
                await channel.delete(`Ticket deleted by ${member.user.tag}`).catch(() => null);
            }, 3000);
        });
    }
}).toJSON();

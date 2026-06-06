const {
    ButtonInteraction, PermissionFlagsBits, ChannelType,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require("discord.js");
const DiscordBot  = require("../../client/DiscordBot");
const Component   = require("../../structure/Component");
const { getLang, getStrings } = require('../../utils/BotLang');

// ── Helpers ──────────────────────────────────────────────────────────────────

function getStaffRoles(client, guildId) {
    const raw = client.database.get(`ticket-staff-roles-${guildId}`);
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

function getOpenList(client, guildId) {
    const raw = client.database.get(`ticket-open-list-${guildId}`);
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

// ── Component ─────────────────────────────────────────────────────────────────

module.exports = new Component({
    customId: 'ticket-open',
    type: 'button',

    /**
     * @param {DiscordBot} client
     * @param {ButtonInteraction} interaction
     */
    run: async (client, interaction) => {
        const { guild, member } = interaction;
        const guildId = guild.id;
        const s = getStrings(getLang(client.database, guildId)).ticket;

        // Check if the ticket system is active
        if (!client.database.get(`ticket-enabled-${guildId}`)) {
            return interaction.reply({ content: s.system_inactive, flags: MessageFlags.Ephemeral });
        }

        // Check if the user already has an open ticket
        const existingId = client.database.get(`ticket-user-${guildId}-${member.id}`);
        if (existingId) {
            const existingCh = guild.channels.cache.get(existingId);
            if (existingCh) {
                return interaction.reply({
                    content: s.already_open(existingCh),
                    flags: MessageFlags.Ephemeral
                });
            }
            client.database.delete(`ticket-user-${guildId}-${member.id}`);
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const categoryId  = client.database.get(`ticket-category-${guildId}`) || null;
            const staffRoles  = getStaffRoles(client, guildId);
            const embedColor  = client.database.get(`ticket-embed-color-${guildId}`) || '#5865F2';

            // Nomor tiket
            const count    = parseInt(client.database.get(`ticket-count-${guildId}`) || '0') + 1;
            client.database.set(`ticket-count-${guildId}`, String(count));

            const safeUsername = member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'user';
            const channelName  = `ticket-${String(count).padStart(4, '0')}-${safeUsername}`;

            // ── Permission overwrites ─────────────────────────────────────
            const overwrites = [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                {
                    id: guild.members.me.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels,
                        PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks,
                    ]
                },
                {
                    id: member.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks,
                    ]
                },
            ];

            // Owner server
            if (guild.ownerId && guild.ownerId !== member.id) {
                overwrites.push({
                    id: guild.ownerId,
                    allow: [
                        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages,
                        PermissionFlagsBits.AttachFiles,
                    ]
                });
            }

            // Staff roles
            for (const roleId of staffRoles) {
                if (guild.roles.cache.has(roleId)) {
                    overwrites.push({
                        id: roleId,
                        allow: [
                            PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages,
                            PermissionFlagsBits.AttachFiles,
                        ]
                    });
                }
            }

            // ── Create ticket channel ─────────────────────────────────────
            const createOpts = {
                name: channelName,
                type: ChannelType.GuildText,
                permissionOverwrites: overwrites,
                topic: `Ticket #${String(count).padStart(4,'0')} — ${member.user.tag}`,
                reason: `Ticket created by ${member.user.tag}`,
            };
            if (categoryId && guild.channels.cache.has(categoryId)) {
                createOpts.parent = categoryId;
            }

            const ticketChannel = await guild.channels.create(createOpts);

            // ── Save ticket data ──────────────────────────────────────────
            client.database.set(`ticket-user-${guildId}-${member.id}`, ticketChannel.id);
            client.database.set(`ticket-info-${guildId}-${ticketChannel.id}`, JSON.stringify({
                ticketNumber: count,
                userId:       member.id,
                username:     member.user.tag,
                openedAt:     Date.now(),
                status:       'open',
            }));

            const openList = getOpenList(client, guildId);
            openList.push(ticketChannel.id);
            client.database.set(`ticket-open-list-${guildId}`, JSON.stringify(openList));

            // ── Welcome message in the ticket channel ─────────────────────
            const colorHex = embedColor.startsWith('#') ? embedColor : `#${embedColor}`;
            const welcomeEmbed = new EmbedBuilder()
                .setColor(colorHex)
                .setTitle(s.open_welcome_title(String(count).padStart(4, '0')))
                .setDescription(s.open_welcome_desc(member))
                .addFields(
                    { name: s.open_field_by, value: `${member} (${member.user.tag})`, inline: true },
                    { name: s.open_field_at, value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                )
                .setTimestamp();

            const staffMentions = staffRoles.map(id => `<@&${id}>`).join(' ');
            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket-close')
                    .setLabel(s.open_close_btn)
                    .setStyle(ButtonStyle.Danger),
            );

            await ticketChannel.send({
                content: `${member}${staffMentions ? ' ' + staffMentions : ''}`,
                embeds:  [welcomeEmbed],
                components: [actionRow],
            });

            await interaction.editReply({ content: s.open_success(ticketChannel) });

        } catch (err) {
            console.error('[ticket-open]', err);
            await interaction.editReply({ content: s.open_failed }).catch(() => null);
        }
    }
}).toJSON();

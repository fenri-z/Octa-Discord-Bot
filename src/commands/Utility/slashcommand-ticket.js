const {
    ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require("discord.js");
const DiscordBot       = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { getLang, getStrings } = require('../../utils/BotLang');
const { resolveRole, resolveChannel } = require('../../utils/resolveGuildOption');
const { checkBotPermissions } = require('../../utils/checkBotPermissions');

// ── Helpers ──────────────────────────────────────────────────────────────────

function getStaffRoles(client, guildId) {
    const raw = client.database.get(`ticket-staff-roles-${guildId}`);
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

function getOpenList(client, guildId) {
    const raw = client.database.get(`ticket-open-list-${guildId}`);
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

function buildPanelEmbed(client, guildId) {
    const title    = client.database.get(`ticket-embed-title-${guildId}`) || '🎫 Support Ticket';
    const desc     = client.database.get(`ticket-embed-desc-${guildId}`)  || 'Klik tombol di bawah untuk membuat tiket dan mendapatkan bantuan dari tim staff.';
    const colorRaw = client.database.get(`ticket-embed-color-${guildId}`) || '#5865F2';
    const color    = colorRaw.startsWith('#') ? colorRaw : `#${colorRaw}`;
    return new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc);
}

function buildPanelRow(client, guildId) {
    const btnLabel = client.database.get(`ticket-embed-btn-label-${guildId}`) || '📩 Buat Ticket';
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket-open')
            .setLabel(btnLabel)
            .setStyle(ButtonStyle.Primary)
    );
}

// ── Command ───────────────────────────────────────────────────────────────────

module.exports = new ApplicationCommand({
    command: {
        name: 'ticket',
        description: 'Manage the server ticket system.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            // ── send-panel ────────────────────────────────────────────────
            {
                name: 'send-panel',
                description: 'Send the ticket panel to a specific channel.',
                type: 1,
                options: [
                    {
                        name: 'channel',
                        description: 'Target channel for the panel (empty = current channel)',
                        type: 3, required: false, autocomplete: true
                    }
                ]
            },
            // ── close ─────────────────────────────────────────────────────
            {
                name: 'close',
                description: 'Close the ticket in this channel (only usable inside a ticket channel).',
                type: 1
            },
            // ── add ───────────────────────────────────────────────────────
            {
                name: 'add',
                description: 'Add a user to the current ticket.',
                type: 1,
                options: [
                    { name: 'user', description: 'User to add to the ticket', type: 6, required: true }
                ]
            },
            // ── remove ───────────────────────────────────────────────────
            {
                name: 'remove',
                description: 'Remove a user\'s access from the current ticket.',
                type: 1,
                options: [
                    { name: 'user', description: 'User to remove from the ticket', type: 6, required: true }
                ]
            },
            // ── list ─────────────────────────────────────────────────────
            {
                name: 'list',
                description: 'View the list of currently open tickets.',
                type: 1
            },
        ]
    },

    options: { botOwner: false },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const s       = getStrings(getLang(client.database, interaction.guild?.id)).ticket;
        const { guild, options } = interaction;
        const sub     = options.getSubcommand();
        const guildId = guild.id;

        const ok = await checkBotPermissions(interaction, [
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageRoles,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
        ]);
        if (!ok) return;

        // ── /ticket send-panel ───────────────────────────────────────────
        if (sub === 'send-panel') {
            if (!client.database.get(`ticket-enabled-${guildId}`)) {
                return interaction.reply({
                    content: s.not_enabled,
                    flags: MessageFlags.Ephemeral
                });
            }

            const channelStr    = options.getString('channel');
            let   targetChannel = interaction.channel;

            if (channelStr) {
                const resolved = resolveChannel(guild, channelStr);
                if (!resolved) return interaction.reply({ content: s.channel_not_found, flags: MessageFlags.Ephemeral });
                targetChannel = resolved;
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            // Delete old panel if it exists
            const oldPanelRaw = client.database.get(`ticket-panel-msg-${guildId}`);
            if (oldPanelRaw) {
                try {
                    const old = JSON.parse(oldPanelRaw);
                    const oldCh = guild.channels.cache.get(old.channelId);
                    if (oldCh) {
                        const oldMsg = await oldCh.messages.fetch(old.messageId).catch(() => null);
                        if (oldMsg) await oldMsg.delete().catch(() => null);
                    }
                } catch {}
            }

            const sentMsg = await targetChannel.send({
                embeds:     [buildPanelEmbed(client, guildId)],
                components: [buildPanelRow(client, guildId)],
            });

            client.database.set(`ticket-panel-msg-${guildId}`, JSON.stringify({
                messageId: sentMsg.id, channelId: targetChannel.id
            }));
            client.database.set(`ticket-panel-channel-${guildId}`, targetChannel.id);

            return interaction.editReply({ content: s.panel_sent(targetChannel) });
        }

        // ── /ticket close ─────────────────────────────────────────────────
        if (sub === 'close') {
            const raw = client.database.get(`ticket-info-${guildId}-${interaction.channel.id}`);
            if (!raw) {
                return interaction.reply({ content: s.not_ticket_ch, flags: MessageFlags.Ephemeral });
            }

            // Trigger close button programmatically
            const fakeInteraction = { ...interaction, customId: 'ticket-close' };
            const closeHandler = require('../Button/button-ticket-close');
            return closeHandler.run(client, interaction);
        }

        // ── /ticket add ───────────────────────────────────────────────────
        if (sub === 'add') {
            const raw = client.database.get(`ticket-info-${guildId}-${interaction.channel.id}`);
            if (!raw) {
                return interaction.reply({ content: s.not_ticket_ch, flags: MessageFlags.Ephemeral });
            }

            const target = options.getUser('user');
            const member = await guild.members.fetch(target.id).catch(() => null);
            if (!member) return interaction.reply({ content: s.user_not_found, flags: MessageFlags.Ephemeral });

            await interaction.channel.permissionOverwrites.edit(member.id, {
                [PermissionFlagsBits.ViewChannel]:     true,
                [PermissionFlagsBits.SendMessages]:    true,
                [PermissionFlagsBits.ReadMessageHistory]: true,
            });

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setDescription(s.user_added(member))
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /ticket remove ────────────────────────────────────────────────
        if (sub === 'remove') {
            const raw = client.database.get(`ticket-info-${guildId}-${interaction.channel.id}`);
            if (!raw) {
                return interaction.reply({ content: s.not_ticket_ch, flags: MessageFlags.Ephemeral });
            }

            const target = options.getUser('user');
            await interaction.channel.permissionOverwrites.edit(target.id, {
                [PermissionFlagsBits.ViewChannel]: false,
            });

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setDescription(s.user_removed(target.id))
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /ticket list ──────────────────────────────────────────────────
        if (sub === 'list') {
            const openList = getOpenList(client, guildId);

            if (openList.length === 0) {
                return interaction.reply({
                    embeds: [new EmbedBuilder().setColor('#5865F2').setDescription(s.no_open_tickets)],
                    flags: MessageFlags.Ephemeral
                });
            }

            const fields = openList.slice(0, 25).map(channelId => {
                const ch   = guild.channels.cache.get(channelId);
                const info = (() => {
                    try { return JSON.parse(client.database.get(`ticket-info-${guildId}-${channelId}`) || '{}'); } catch { return {}; }
                })();
                const chName  = ch ? `<#${channelId}>` : `#${channelId} (deleted)`;
                const openAt  = info.openedAt ? `<t:${Math.floor(info.openedAt/1000)}:R>` : '-';
                const creator = info.userId ? `<@${info.userId}>` : '-';
                return { name: `🎫 Ticket #${String(info.ticketNumber||0).padStart(4,'0')}`, value: `${chName}\nCreated by: ${creator} ${openAt}`, inline: true };
            });

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#5865F2')
                        .setTitle(s.list_title(openList.length))
                        .addFields(fields)
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }
    }
}).toJSON();

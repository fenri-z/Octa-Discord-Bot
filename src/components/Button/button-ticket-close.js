const {
    ButtonInteraction, PermissionFlagsBits, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, AttachmentBuilder
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");
const { getLang, getStrings } = require('../../utils/BotLang');

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTicketInfo(client, guildId, channelId) {
    const raw = client.database.get(`ticket-info-${guildId}-${channelId}`);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function getStaffRoles(client, guildId) {
    const raw = client.database.get(`ticket-staff-roles-${guildId}`);
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

function isStaff(member, guildId, client) {
    if (member.id === member.guild.ownerId) return true;
    const staffRoles = getStaffRoles(client, guildId);
    return staffRoles.some(roleId => member.roles.cache.has(roleId));
}

// Fetch all messages from the channel (paginated)
async function fetchAllMessages(channel) {
    const messages = [];
    let lastId     = null;

    while (true) {
        const opts    = { limit: 100 };
        if (lastId) opts.before = lastId;
        const fetched = await channel.messages.fetch(opts);
        if (fetched.size === 0) break;
        messages.push(...fetched.values());
        lastId = fetched.last()?.id;
        if (fetched.size < 100) break;
    }

    return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

// Format messages to text
function formatTranscript(messages, channel, ticketInfo) {
    const lines = [
        `═══════════════════════════════════════`,
        ` TICKET TRANSCRIPT`,
        `═══════════════════════════════════════`,
        ` Channel : #${channel.name}`,
        ` Ticket  : #${String(ticketInfo?.ticketNumber || 0).padStart(4, '0')}`,
        ` Created : ${ticketInfo?.username || 'Unknown'}`,
        ` Opened  : ${ticketInfo?.openedAt ? new Date(ticketInfo.openedAt).toLocaleString('en-US') : '-'}`,
        ` Closed  : ${new Date().toLocaleString('en-US')}`,
        `═══════════════════════════════════════`,
        '',
    ];

    for (const msg of messages) {
        if (msg.author.bot && msg.embeds.length > 0 && !msg.content) continue;
        const time    = new Date(msg.createdTimestamp).toLocaleString('en-US');
        const author  = `${msg.author.username}${msg.author.bot ? ' [BOT]' : ''}`;
        const content = msg.content || (msg.embeds.length ? '[Embed]' : '[Attachment]');
        lines.push(`[${time}] ${author}: ${content}`);
        if (msg.attachments.size > 0) {
            msg.attachments.forEach(a => lines.push(`   📎 ${a.url}`));
        }
    }

    lines.push('', `═══════════════════════════════════════`);
    return lines.join('\n');
}

// ── Component ─────────────────────────────────────────────────────────────────

module.exports = new Component({
    customId: 'ticket-close',
    type: 'button',

    /**
     * @param {DiscordBot} client
     * @param {ButtonInteraction} interaction
     */
    run: async (client, interaction) => {
        const { guild, member, channel } = interaction;
        const guildId   = guild.id;
        const channelId = channel.id;
        const s = getStrings(getLang(client.database, guildId)).ticket;

        const ticketInfo = getTicketInfo(client, guildId, channelId);
        if (!ticketInfo) {
            return interaction.reply({ content: s.not_a_ticket, flags: MessageFlags.Ephemeral });
        }

        // Check if already closed
        if (ticketInfo.status === 'closed') {
            return interaction.reply({ content: s.already_closed, flags: MessageFlags.Ephemeral });
        }

        // Only the creator or staff can close
        const canClose = member.id === ticketInfo.userId || isStaff(member, guildId, client);
        if (!canClose) {
            return interaction.reply({ content: s.no_close_perm, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // ── Generate & send transcript ────────────────────────────────
            const logChannelId = client.database.get(`ticket-log-channel-${guildId}`);
            const logChannel   = logChannelId ? guild.channels.cache.get(logChannelId) : null;

            const messages    = await fetchAllMessages(channel);
            const transcriptText = formatTranscript(messages, channel, ticketInfo);
            const transcriptBuf  = Buffer.from(transcriptText, 'utf-8');
            const fileName       = `transcript-ticket-${String(ticketInfo.ticketNumber).padStart(4,'0')}.txt`;
            const attachment     = new AttachmentBuilder(transcriptBuf, { name: fileName });

            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle(s.log_title(String(ticketInfo.ticketNumber).padStart(4,'0')))
                    .addFields(
                        { name: s.log_field_by,       value: `<@${ticketInfo.userId}> (${ticketInfo.username})`, inline: true },
                        { name: s.log_field_closed,   value: `${member} (${member.user.tag})`, inline: true },
                        { name: s.log_field_duration, value: `<t:${Math.floor(ticketInfo.openedAt / 1000)}:R>`, inline: true },
                        { name: s.log_field_msgs,     value: s.log_msgs_val(messages.length), inline: true },
                    )
                    .setTimestamp();

                await logChannel.send({ embeds: [logEmbed], files: [attachment] }).catch(() => null);
            }

            // ── Update ticket status ──────────────────────────────────────
            ticketInfo.status   = 'closed';
            ticketInfo.closedBy = member.id;
            ticketInfo.closedAt = Date.now();
            client.database.set(`ticket-info-${guildId}-${channelId}`, JSON.stringify(ticketInfo));

            // Remove from the open ticket list
            const openRaw  = client.database.get(`ticket-open-list-${guildId}`);
            let   openList = [];
            try { openList = openRaw ? JSON.parse(openRaw) : []; } catch {}
            client.database.set(`ticket-open-list-${guildId}`, JSON.stringify(openList.filter(id => id !== channelId)));

            // Remove creator access
            const creator = await guild.members.fetch(ticketInfo.userId).catch(() => null);
            if (creator) {
                await channel.permissionOverwrites.edit(creator.id, {
                    [PermissionFlagsBits.ViewChannel]: false
                }).catch(() => null);
            }
            client.database.delete(`ticket-user-${guildId}-${ticketInfo.userId}`);

            // ── Send closing message in the ticket channel ────────────────
            const closedEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle(s.close_title)
                .setDescription(s.close_desc(member, logChannel))
                .setTimestamp();

            const staffRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket-transcript')
                    .setLabel(s.close_transcript_btn)
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('ticket-delete')
                    .setLabel(s.close_delete_btn)
                    .setStyle(ButtonStyle.Danger),
            );

            // Disable old buttons on the welcome message
            try {
                const welcomeMsg = await channel.messages.fetch({ limit: 10 });
                const botWelcome = welcomeMsg.find(m => m.author.id === guild.members.me.id && m.components.length > 0);
                if (botWelcome) {
                    const disabledRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('ticket-transcript').setLabel(s.close_transcript_btn).setStyle(ButtonStyle.Secondary).setDisabled(true),
                        new ButtonBuilder().setCustomId('ticket-close').setLabel(s.close_closed_label).setStyle(ButtonStyle.Danger).setDisabled(true),
                    );
                    await botWelcome.edit({ components: [disabledRow] }).catch(() => null);
                }
            } catch {}

            await channel.send({ embeds: [closedEmbed], components: [staffRow] });
            await interaction.editReply({ content: s.close_success });

        } catch (err) {
            console.error('[ticket-close]', err);
            await interaction.editReply({ content: s.close_failed }).catch(() => null);
        }
    }
}).toJSON();

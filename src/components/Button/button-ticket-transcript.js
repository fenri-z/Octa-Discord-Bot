const {
    ButtonInteraction, EmbedBuilder, MessageFlags, AttachmentBuilder
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");

async function fetchAllMessages(channel) {
    const messages = [];
    let lastId     = null;
    while (true) {
        const opts = { limit: 100 };
        if (lastId) opts.before = lastId;
        const fetched = await channel.messages.fetch(opts);
        if (fetched.size === 0) break;
        messages.push(...fetched.values());
        lastId = fetched.last()?.id;
        if (fetched.size < 100) break;
    }
    return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function formatTranscript(messages, channel, ticketInfo) {
    const lines = [
        `═══════════════════════════════════════`,
        ` TICKET TRANSCRIPT`,
        `═══════════════════════════════════════`,
        ` Channel : #${channel.name}`,
        ` Ticket  : #${String(ticketInfo?.ticketNumber || 0).padStart(4, '0')}`,
        ` Created : ${ticketInfo?.username || 'Unknown'}`,
        ` Opened  : ${ticketInfo?.openedAt ? new Date(ticketInfo.openedAt).toLocaleString('en-US') : '-'}`,
        ` Saved   : ${new Date().toLocaleString('en-US')}`,
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

module.exports = new Component({
    customId: 'ticket-transcript',
    type: 'button',

    /**
     * @param {DiscordBot} client
     * @param {ButtonInteraction} interaction
     */
    run: async (client, interaction) => {
        const { guild, channel } = interaction;
        const guildId = guild.id;

        const raw = client.database.get(`ticket-info-${guildId}-${channel.id}`);
        if (!raw) {
            return interaction.reply({ content: '❌ This channel is not a valid ticket.', flags: MessageFlags.Ephemeral });
        }

        let ticketInfo;
        try { ticketInfo = JSON.parse(raw); } catch {
            return interaction.reply({ content: '❌ Ticket data is corrupted.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const messages       = await fetchAllMessages(channel);
            const transcriptText = formatTranscript(messages, channel, ticketInfo);
            const fileName       = `transcript-ticket-${String(ticketInfo.ticketNumber).padStart(4,'0')}.txt`;
            const attachment     = new AttachmentBuilder(Buffer.from(transcriptText, 'utf-8'), { name: fileName });

            // Send to log channel if available
            const logChannelId = client.database.get(`ticket-log-channel-${guildId}`);
            const logChannel   = logChannelId ? guild.channels.cache.get(logChannelId) : null;

            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle(`📋 Ticket Transcript #${String(ticketInfo.ticketNumber).padStart(4,'0')}`)
                    .setDescription(`Transcript saved by ${interaction.member}.`)
                    .addFields({ name: '💬 Message Count', value: `${messages.length} messages`, inline: true })
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed], files: [attachment] }).catch(() => null);
                await interaction.editReply({ content: `✅ Transcript successfully saved to ${logChannel}!` });
            } else {
                // Send directly to the user if there is no log channel
                const attachCopy = new AttachmentBuilder(Buffer.from(transcriptText, 'utf-8'), { name: fileName });
                await interaction.editReply({ content: '✅ Transcript successfully created!', files: [attachCopy] });
            }
        } catch (err) {
            console.error('[ticket-transcript]', err);
            await interaction.editReply({ content: '❌ Failed to create transcript.' }).catch(() => null);
        }
    }
}).toJSON();

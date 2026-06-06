const {
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const ApplicationCommand = require('../../structure/ApplicationCommand');

const DEFAULT_EVENTS = { ban: true, unban: true, kick: true, timeout: true, warn: true };

function getEvents(client, guildId) {
    const raw = client.database.get(`modlog-events-${guildId}`);
    if (!raw) return { ...DEFAULT_EVENTS };
    try { return { ...DEFAULT_EVENTS, ...JSON.parse(raw) }; } catch { return { ...DEFAULT_EVENTS }; }
}

module.exports = new ApplicationCommand({
    command: {
        name: 'modlog',
        description: 'Configure the moderation action log channel',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            {
                type: 1,
                name: 'set',
                description: 'Set the channel for mod log',
                options: [
                    { type: 7, name: 'channel', description: 'Text channel for the log', required: true },
                ],
            },
            {
                type: 1,
                name: 'disable',
                description: 'Disable mod log',
            },
            {
                type: 1,
                name: 'test',
                description: 'Send a test embed to the mod log channel',
            },
        ],
    },

    run: async (client, interaction) => {
        const sub     = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (sub === 'set') {
            const channel = interaction.options.getChannel('channel');
            if (channel.type !== 0)
                return interaction.reply({ content: '❌ Please select a text channel (not voice/category).', flags: MessageFlags.Ephemeral });

            client.database.set(`modlog-channel-${guildId}`, channel.id);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle('✅ Mod Log Configured')
                    .setDescription(`All moderation actions will be logged in ${channel}.\nUse \`/modlog test\` to verify.`)
                    .setTimestamp()],
                flags: MessageFlags.Ephemeral,
            });
        }

        if (sub === 'disable') {
            client.database.delete(`modlog-channel-${guildId}`);
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('❌ Mod Log Disabled')
                    .setDescription('Moderation action logging has been turned off.')
                    .setTimestamp()],
                flags: MessageFlags.Ephemeral,
            });
        }

        if (sub === 'test') {
            const logChId = client.database.get(`modlog-channel-${guildId}`);
            if (!logChId)
                return interaction.reply({ content: '❌ Mod log has not been configured. Use `/modlog set` first.', flags: MessageFlags.Ephemeral });

            const logChannel = interaction.guild.channels.cache.get(logChId);
            if (!logChannel?.isTextBased())
                return interaction.reply({ content: '❌ Log channel not found or has been deleted.', flags: MessageFlags.Ephemeral });

            const events = getEvents(client, guildId);
            const eventList = Object.entries(events)
                .map(([k, v]) => `${v ? '✅' : '❌'} ${k}`)
                .join('\n');

            await logChannel.send({
                embeds: [new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle('🔔 Mod Log — Test')
                    .setDescription(`Mod log is working correctly in this channel.\n\n**Active events:**\n${eventList}`)
                    .setFooter({ text: `Configured by ${interaction.user.tag}` })
                    .setTimestamp()],
            });

            return interaction.reply({ content: `✅ Test embed sent to ${logChannel}.`, flags: MessageFlags.Ephemeral });
        }
    },
}).toJSON();

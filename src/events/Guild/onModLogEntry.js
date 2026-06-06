const { AuditLogEvent, EmbedBuilder } = require('discord.js');
const Event = require('../../structure/Event');

const DEFAULT_EVENTS = { ban: true, unban: true, kick: true, timeout: true, warn: true };

function getEvents(client, guildId) {
    const raw = client.database.get(`modlog-events-${guildId}`);
    if (!raw) return { ...DEFAULT_EVENTS };
    try { return { ...DEFAULT_EVENTS, ...JSON.parse(raw) }; } catch { return { ...DEFAULT_EVENTS }; }
}

module.exports = new Event({
    event: 'guildAuditLogEntryCreate',
    once: false,
    run: async (client, auditLogEntry, guild) => {
        const logChId = client.database.get(`modlog-channel-${guild.id}`);
        if (!logChId) return;

        const logChannel = guild.channels.cache.get(logChId);
        if (!logChannel?.isTextBased()) return;

        const events = getEvents(client, guild.id);
        const { action, executor, target, reason, changes } = auditLogEntry;

        let embed = null;

        switch (action) {
            case AuditLogEvent.MemberBanAdd: {
                if (!events.ban) return;
                embed = new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('🔨 Member Banned')
                    .addFields(
                        { name: '👤 Member',      value: target   ? `<@${target.id}> (${target.tag ?? target.id})` : 'Unknown', inline: true },
                        { name: '🛡️ Moderator',  value: executor ? `<@${executor.id}>`                             : 'Unknown', inline: true },
                        { name: '📝 Reason',      value: reason || 'No reason provided' },
                    )
                    .setTimestamp();
                break;
            }
            case AuditLogEvent.MemberBanRemove: {
                if (!events.unban) return;
                embed = new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle('✅ Member Unbanned')
                    .addFields(
                        { name: '👤 Member',     value: target   ? `<@${target.id}> (${target.tag ?? target.id})` : 'Unknown', inline: true },
                        { name: '🛡️ Moderator', value: executor ? `<@${executor.id}>`                             : 'Unknown', inline: true },
                        { name: '📝 Reason',     value: reason || 'No reason provided' },
                    )
                    .setTimestamp();
                break;
            }
            case AuditLogEvent.MemberKick: {
                if (!events.kick) return;
                embed = new EmbedBuilder()
                    .setColor('#FEE75C')
                    .setTitle('👢 Member Kicked')
                    .addFields(
                        { name: '👤 Member',     value: target   ? `<@${target.id}> (${target.tag ?? target.id})` : 'Unknown', inline: true },
                        { name: '🛡️ Moderator', value: executor ? `<@${executor.id}>`                             : 'Unknown', inline: true },
                        { name: '📝 Reason',     value: reason || 'No reason provided' },
                    )
                    .setTimestamp();
                break;
            }
            case AuditLogEvent.MemberUpdate: {
                if (!events.timeout) return;
                const timeoutChange = changes?.find(c => c.key === 'communication_disabled_until');
                if (!timeoutChange) return;

                if (timeoutChange.new) {
                    const until = new Date(timeoutChange.new);
                    embed = new EmbedBuilder()
                        .setColor('#EB459E')
                        .setTitle('🔇 Member Timed Out')
                        .addFields(
                            { name: '👤 Member',     value: target   ? `<@${target.id}>` : 'Unknown', inline: true },
                            { name: '🛡️ Moderator', value: executor ? `<@${executor.id}>` : 'Unknown', inline: true },
                            { name: '⏱️ Expires',  value: `<t:${Math.floor(until.getTime() / 1000)}:R>`, inline: true },
                            { name: '📝 Reason',     value: reason || 'No reason provided' },
                        )
                        .setTimestamp();
                } else {
                    embed = new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('🔊 Timeout Removed')
                        .addFields(
                            { name: '👤 Member',     value: target   ? `<@${target.id}>` : 'Unknown', inline: true },
                            { name: '🛡️ Moderator', value: executor ? `<@${executor.id}>` : 'Unknown', inline: true },
                        )
                        .setTimestamp();
                }
                break;
            }
        }

        if (embed) {
            await logChannel.send({ embeds: [embed] }).catch(() => null);
        }
    },
}).toJSON();

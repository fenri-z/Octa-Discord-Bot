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
                    .setTitle('🔨 Member Di-Ban')
                    .addFields(
                        { name: '👤 Member',      value: target   ? `<@${target.id}> (${target.tag ?? target.id})` : 'Tidak diketahui', inline: true },
                        { name: '🛡️ Moderator',  value: executor ? `<@${executor.id}>`                             : 'Tidak diketahui', inline: true },
                        { name: '📝 Alasan',      value: reason || 'Tidak ada alasan' },
                    )
                    .setTimestamp();
                break;
            }
            case AuditLogEvent.MemberBanRemove: {
                if (!events.unban) return;
                embed = new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle('✅ Member Di-Unban')
                    .addFields(
                        { name: '👤 Member',     value: target   ? `<@${target.id}> (${target.tag ?? target.id})` : 'Tidak diketahui', inline: true },
                        { name: '🛡️ Moderator', value: executor ? `<@${executor.id}>`                             : 'Tidak diketahui', inline: true },
                        { name: '📝 Alasan',     value: reason || 'Tidak ada alasan' },
                    )
                    .setTimestamp();
                break;
            }
            case AuditLogEvent.MemberKick: {
                if (!events.kick) return;
                embed = new EmbedBuilder()
                    .setColor('#FEE75C')
                    .setTitle('👢 Member Di-Kick')
                    .addFields(
                        { name: '👤 Member',     value: target   ? `<@${target.id}> (${target.tag ?? target.id})` : 'Tidak diketahui', inline: true },
                        { name: '🛡️ Moderator', value: executor ? `<@${executor.id}>`                             : 'Tidak diketahui', inline: true },
                        { name: '📝 Alasan',     value: reason || 'Tidak ada alasan' },
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
                        .setTitle('🔇 Member Di-Timeout')
                        .addFields(
                            { name: '👤 Member',     value: target   ? `<@${target.id}>` : 'Tidak diketahui', inline: true },
                            { name: '🛡️ Moderator', value: executor ? `<@${executor.id}>` : 'Tidak diketahui', inline: true },
                            { name: '⏱️ Berakhir',  value: `<t:${Math.floor(until.getTime() / 1000)}:R>`, inline: true },
                            { name: '📝 Alasan',     value: reason || 'Tidak ada alasan' },
                        )
                        .setTimestamp();
                } else {
                    embed = new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('🔊 Timeout Dihapus')
                        .addFields(
                            { name: '👤 Member',     value: target   ? `<@${target.id}>` : 'Tidak diketahui', inline: true },
                            { name: '🛡️ Moderator', value: executor ? `<@${executor.id}>` : 'Tidak diketahui', inline: true },
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

const {
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const ApplicationCommand = require('../../structure/ApplicationCommand');

async function sendModLog(client, guild, embed) {
    const logChId = client.database.get(`modlog-channel-${guild.id}`);
    if (!logChId) return;
    const logChannel = guild.channels.cache.get(logChId);
    if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] }).catch(() => null);
}

// Simpan overwrite channel saat ini ke database sebelum strict lock
function saveOverwrites(client, guildId, channel) {
    const data = [...channel.permissionOverwrites.cache.values()].map(ow => ({
        id:    ow.id,
        type:  ow.type,
        allow: ow.allow.bitfield.toString(),
        deny:  ow.deny.bitfield.toString(),
    }));
    client.database.set(`lock-saved-${guildId}-${channel.id}`, JSON.stringify(data));
}

// Pulihkan overwrite channel dari database setelah unlock
async function restoreOverwrites(client, guildId, channel) {
    const raw = client.database.get(`lock-saved-${guildId}-${channel.id}`);
    if (!raw) return false;
    try {
        const saved = JSON.parse(raw);
        for (const ow of saved) {
            await channel.permissionOverwrites.edit(ow.id, {
                allow: BigInt(ow.allow),
                deny:  BigInt(ow.deny),
            }).catch(() => null);
        }
        client.database.delete(`lock-saved-${guildId}-${channel.id}`);
        return true;
    } catch { return false; }
}

module.exports = new ApplicationCommand({
    command: {
        name: 'lock',
        description: 'Kunci atau buka kunci channel',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageChannels),
        options: [
            {
                type: 1,
                name: 'channel',
                description: 'Kunci channel agar member tidak bisa mengirim pesan',
                options: [
                    { type: 7, name: 'channel',     description: 'Channel yang dikunci (default: channel ini)',              required: false },
                    { type: 3, name: 'alasan',       description: 'Alasan penguncian',                                       required: false },
                    { type: 5, name: 'strict',       description: 'Blokir semua role termasuk yang punya izin eksplisit',    required: false },
                    { type: 8, name: 'role_bypass',  description: 'Role yang tetap bisa mengirim pesan saat strict mode',    required: false },
                ],
            },
            {
                type: 1,
                name: 'unlock',
                description: 'Buka kunci channel yang terkunci',
                options: [
                    { type: 7, name: 'channel', description: 'Channel yang dibuka (default: channel ini)', required: false },
                    { type: 3, name: 'alasan',  description: 'Alasan pembukaan',                           required: false },
                ],
            },
            {
                type: 1,
                name: 'status',
                description: 'Cek status kunci channel saat ini',
                options: [
                    { type: 7, name: 'channel', description: 'Channel yang dicek (default: channel ini)', required: false },
                ],
            },
        ],
    },

    run: async (client, interaction) => {
        const sub        = interaction.options.getSubcommand();
        const target     = interaction.options.getChannel('channel') ?? interaction.channel;
        const alasan     = interaction.options.getString('alasan') || 'Tidak ada alasan';
        const strict     = interaction.options.getBoolean('strict') ?? false;
        const roleBypass = interaction.options.getRole('role_bypass');
        const guild      = interaction.guild;

        if (target.type !== 0 && target.type !== 5) {
            return interaction.reply({ content: '❌ Hanya bisa mengunci channel teks.', flags: MessageFlags.Ephemeral });
        }

        const botPerms = target.permissionsFor(guild.members.me);
        if (!botPerms.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({
                content: `❌ Bot tidak punya permission **Manage Channels** di ${target}.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        const everyoneRole = guild.roles.everyone;

        // ── Status ──────────────────────────────────────────────────────────────
        if (sub === 'status') {
            const overwrite = target.permissionOverwrites.cache.get(everyoneRole.id);
            const denied    = overwrite?.deny?.has(PermissionFlagsBits.SendMessages);
            const isStrict  = !!client.database.get(`lock-saved-${guild.id}-${target.id}`);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor(denied ? '#ED4245' : '#57F287')
                    .setTitle(denied ? '🔒 Channel Terkunci' : '🔓 Channel Terbuka')
                    .setDescription(`${target} sedang dalam status **${denied ? 'terkunci' : 'terbuka'}**.`)
                    .addFields({ name: 'Mode', value: denied ? (isStrict ? '🔴 Strict' : '🟡 Normal') : '—', inline: true })
                    .setTimestamp()],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Lock ─────────────────────────────────────────────────────────────────
        if (sub === 'channel') {
            const existing = target.permissionOverwrites.cache.get(everyoneRole.id);
            if (existing?.deny?.has(PermissionFlagsBits.SendMessages)) {
                return interaction.reply({ content: `❌ ${target} sudah terkunci.`, flags: MessageFlags.Ephemeral });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            if (strict) {
                // Simpan semua overwrite yang ada sebelum diubah
                saveOverwrites(client, guild.id, target);

                // Kunci @everyone
                await target.permissionOverwrites.edit(everyoneRole, { SendMessages: false });

                // Untuk setiap role overwrite yang punya SendMessages Allow eksplisit,
                // hapus allow tersebut (set null = inherit dari @everyone = deny)
                for (const ow of target.permissionOverwrites.cache.values()) {
                    if (ow.id === everyoneRole.id) continue;
                    if (roleBypass && ow.id === roleBypass.id) continue;
                    if (ow.allow.has(PermissionFlagsBits.SendMessages)) {
                        await target.permissionOverwrites.edit(ow.id, { SendMessages: null }).catch(() => null);
                    }
                }

                // Pastikan role bypass tetap bisa kirim pesan
                if (roleBypass) {
                    await target.permissionOverwrites.edit(roleBypass, { SendMessages: true });
                }
            } else {
                // Normal lock: hanya kunci @everyone
                await target.permissionOverwrites.edit(everyoneRole, { SendMessages: false });
            }

            const modeText = strict
                ? `🔴 **Strict** — semua role diblokir${roleBypass ? `, kecuali @${roleBypass.name}` : ''}`
                : '🟡 **Normal** — role dengan izin eksplisit masih bisa mengirim pesan';

            const embed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('🔒 Channel Dikunci')
                .addFields(
                    { name: '📌 Channel',    value: `${target}`,           inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`, inline: true },
                    { name: '⚙️ Mode',       value: modeText },
                    { name: '📝 Alasan',     value: alasan },
                )
                .setTimestamp();

            await target.send({ embeds: [embed] }).catch(() => null);
            await sendModLog(client, guild, embed);

            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(`🔒 ${target} berhasil **dikunci** (${strict ? 'strict mode' : 'normal mode'}).`)],
            });
        }

        // ── Unlock ───────────────────────────────────────────────────────────────
        if (sub === 'unlock') {
            const existing = target.permissionOverwrites.cache.get(everyoneRole.id);
            if (!existing?.deny?.has(PermissionFlagsBits.SendMessages)) {
                return interaction.reply({ content: `❌ ${target} tidak dalam kondisi terkunci.`, flags: MessageFlags.Ephemeral });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const wasStrict = !!client.database.get(`lock-saved-${guild.id}-${target.id}`);

            if (wasStrict) {
                // Pulihkan semua overwrite ke kondisi sebelum strict lock
                await restoreOverwrites(client, guild.id, target);
            } else {
                // Normal unlock: hapus deny SendMessages dari @everyone
                await target.permissionOverwrites.edit(everyoneRole, { SendMessages: null });
            }

            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('🔓 Channel Dibuka')
                .addFields(
                    { name: '📌 Channel',    value: `${target}`,           inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`, inline: true },
                    { name: '📝 Alasan',     value: alasan },
                )
                .setTimestamp();

            await target.send({ embeds: [embed] }).catch(() => null);
            await sendModLog(client, guild, embed);

            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setDescription(`🔓 ${target} berhasil **dibuka**${wasStrict ? ' (permission dipulihkan)' : ''}.`)],
            });
        }
    },
}).toJSON();

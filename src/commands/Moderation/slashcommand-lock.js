const {
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const ApplicationCommand = require('../../structure/ApplicationCommand');
const { getLang, getStrings } = require('../../utils/BotLang');

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
        description: 'Lock or unlock a channel',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageChannels),
        options: [
            {
                type: 1,
                name: 'channel',
                description: 'Lock a channel so members cannot send messages',
                options: [
                    { type: 7, name: 'channel',     description: 'Channel to lock (default: current channel)',                    required: false },
                    { type: 3, name: 'reason',       description: 'Reason for locking',                                            required: false },
                    { type: 5, name: 'strict',       description: 'Block all roles including those with explicit permissions',      required: false },
                    { type: 8, name: 'role_bypass',  description: 'Role that can still send messages in strict mode',              required: false },
                ],
            },
            {
                type: 1,
                name: 'unlock',
                description: 'Unlock a locked channel',
                options: [
                    { type: 7, name: 'channel', description: 'Channel to unlock (default: current channel)', required: false },
                    { type: 3, name: 'reason',  description: 'Reason for unlocking',                          required: false },
                ],
            },
            {
                type: 1,
                name: 'status',
                description: 'Check the current lock status of a channel',
                options: [
                    { type: 7, name: 'channel', description: 'Channel to check (default: current channel)', required: false },
                ],
            },
        ],
    },

    run: async (client, interaction) => {
        const strings    = getStrings(getLang(client.database, interaction.guild?.id));
        const s          = strings.lock;
        const c          = strings.common;
        const sub        = interaction.options.getSubcommand();
        const target     = interaction.options.getChannel('channel') ?? interaction.channel;
        const alasan     = interaction.options.getString('reason') || c.no_reason;
        const strict     = interaction.options.getBoolean('strict') ?? false;
        const roleBypass = interaction.options.getRole('role_bypass');
        const guild      = interaction.guild;

        if (target.type !== 0 && target.type !== 5) {
            return interaction.reply({ content: s.text_only, flags: MessageFlags.Ephemeral });
        }

        const botPerms = target.permissionsFor(guild.members.me);
        if (!botPerms.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({ content: s.no_bot_perm(target), flags: MessageFlags.Ephemeral });
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
                    .setTitle(denied ? s.status_locked_title : s.status_unlocked_title)
                    .setDescription(denied ? s.status_locked_desc(target) : s.status_unlocked_desc(target))
                    .addFields({ name: s.mode_field, value: denied ? (isStrict ? '🔴 Strict' : '🟡 Normal') : s.mode_none, inline: true })
                    .setTimestamp()],
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Lock ─────────────────────────────────────────────────────────────────
        if (sub === 'channel') {
            const existing = target.permissionOverwrites.cache.get(everyoneRole.id);
            if (existing?.deny?.has(PermissionFlagsBits.SendMessages)) {
                return interaction.reply({ content: s.already_locked(target), flags: MessageFlags.Ephemeral });
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

            const modeText = strict ? s.mode_strict(roleBypass?.name) : s.mode_normal;

            const embed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle(s.log_locked_title)
                .addFields(
                    { name: c.field_channel,   value: `${target}`,           inline: true },
                    { name: c.field_moderator, value: `${interaction.user}`, inline: true },
                    { name: s.field_mode,      value: modeText },
                    { name: s.reason,          value: alasan },
                )
                .setTimestamp();

            await target.send({ embeds: [embed] }).catch(() => null);
            await sendModLog(client, guild, embed);

            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(s.locked(target))],
            });
        }

        // ── Unlock ───────────────────────────────────────────────────────────────
        if (sub === 'unlock') {
            const existing = target.permissionOverwrites.cache.get(everyoneRole.id);
            if (!existing?.deny?.has(PermissionFlagsBits.SendMessages)) {
                return interaction.reply({ content: s.already_unlocked(target), flags: MessageFlags.Ephemeral });
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
                .setTitle(s.log_unlocked_title)
                .addFields(
                    { name: c.field_channel,   value: `${target}`,           inline: true },
                    { name: c.field_moderator, value: `${interaction.user}`, inline: true },
                    { name: s.reason,          value: alasan },
                )
                .setTimestamp();

            await target.send({ embeds: [embed] }).catch(() => null);
            await sendModLog(client, guild, embed);

            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setDescription(s.unlocked(target))],
            });
        }
    },
}).toJSON();

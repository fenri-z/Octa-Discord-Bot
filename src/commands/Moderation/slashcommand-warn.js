const {
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const ApplicationCommand = require('../../structure/ApplicationCommand');

function getWarns(client, guildId, userId) {
    const raw = client.database.get(`warn-${guildId}-${userId}`);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
}

function setWarns(client, guildId, userId, warns) {
    if (warns.length === 0) {
        client.database.delete(`warn-${guildId}-${userId}`);
    } else {
        client.database.set(`warn-${guildId}-${userId}`, JSON.stringify(warns));
    }
}

function getWarnConfig(client, guildId) {
    const raw = client.database.get(`warn-config-${guildId}`);
    if (!raw) return { thresholds: [] };
    try { return JSON.parse(raw); } catch { return { thresholds: [] }; }
}

function pushWarnLog(client, guildId, entry) {
    const raw = client.database.get(`warn-log-${guildId}`);
    const log = raw ? JSON.parse(raw) : [];
    log.unshift(entry);
    if (log.length > 50) log.length = 50;
    client.database.set(`warn-log-${guildId}`, JSON.stringify(log));
}

function formatDuration(ms) {
    if (ms >= 3_600_000) return `${ms / 3_600_000} jam`;
    if (ms >= 60_000)    return `${ms / 60_000} menit`;
    return `${ms / 1_000} detik`;
}

async function applyThresholdAction(guild, member, warnCount, config) {
    const matched = config.thresholds.find(t => t.count === warnCount);
    if (!matched || matched.action === 'none') return null;

    const botMember = guild.members.me;

    switch (matched.action) {
        case 'mute': {
            if (!botMember?.permissions.has(PermissionFlagsBits.ModerateMembers)) return null;
            const dur = matched.duration ?? 600_000;
            await member.timeout(dur, `Warn threshold: ${warnCount} peringatan`).catch(() => null);
            await member.user.send({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('🔇 Kamu di-Timeout')
                    .setDescription(
                        `Kamu di-timeout di **${guild.name}** selama **${formatDuration(dur)}**\n` +
                        `karena telah mencapai **${warnCount} peringatan**.`
                    )
                    .setTimestamp()]
            }).catch(() => null);
            return `🔇 Timeout ${formatDuration(dur)}`;
        }
        case 'kick': {
            if (!botMember?.permissions.has(PermissionFlagsBits.KickMembers)) return null;
            await member.user.send({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('👢 Kamu di-Kick')
                    .setDescription(`Kamu di-kick dari **${guild.name}** karena telah mencapai **${warnCount} peringatan**.`)
                    .setTimestamp()]
            }).catch(() => null);
            await member.kick(`Warn threshold: ${warnCount} peringatan`).catch(() => null);
            return '👢 Kick';
        }
        case 'ban': {
            if (!botMember?.permissions.has(PermissionFlagsBits.BanMembers)) return null;
            await member.user.send({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('🔨 Kamu di-Ban')
                    .setDescription(`Kamu di-ban dari **${guild.name}** karena telah mencapai **${warnCount} peringatan**.`)
                    .setTimestamp()]
            }).catch(() => null);
            await member.ban({ reason: `Warn threshold: ${warnCount} peringatan` }).catch(() => null);
            return '🔨 Ban';
        }
    }
    return null;
}

module.exports = new ApplicationCommand({
    command: {
        name: 'warn',
        description: 'Sistem peringatan member server',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
        options: [
            {
                type: 1,
                name: 'add',
                description: 'Tambahkan peringatan ke member',
                options: [
                    { type: 6, name: 'member', description: 'Member yang akan diberi peringatan', required: true },
                    { type: 3, name: 'alasan',  description: 'Alasan peringatan', required: false },
                ],
            },
            {
                type: 1,
                name: 'remove',
                description: 'Hapus satu peringatan berdasarkan ID',
                options: [
                    { type: 6, name: 'member', description: 'Member target', required: true },
                    { type: 3, name: 'id',     description: 'ID peringatan (lihat dari /warn list)', required: true },
                ],
            },
            {
                type: 1,
                name: 'clear',
                description: 'Hapus semua peringatan member',
                options: [
                    { type: 6, name: 'member', description: 'Member target', required: true },
                ],
            },
            {
                type: 1,
                name: 'list',
                description: 'Lihat daftar peringatan member',
                options: [
                    { type: 6, name: 'member', description: 'Member target', required: true },
                ],
            },
        ],
    },

    run: async (client, interaction) => {
        const sub     = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        // ── /warn add ──────────────────────────────────────────────────────────
        if (sub === 'add') {
            const target = interaction.options.getMember('member');
            const alasan = interaction.options.getString('alasan') || 'Tidak ada alasan';

            if (!target)
                return interaction.reply({ content: '❌ Member tidak ditemukan.', flags: MessageFlags.Ephemeral });
            if (target.id === interaction.user.id)
                return interaction.reply({ content: '❌ Kamu tidak bisa warn diri sendiri.', flags: MessageFlags.Ephemeral });
            if (target.permissions.has(PermissionFlagsBits.Administrator))
                return interaction.reply({ content: '❌ Tidak bisa warn Administrator.', flags: MessageFlags.Ephemeral });

            const warns  = getWarns(client, guildId, target.id);
            const warnId = Date.now().toString(36).toUpperCase();
            const entry  = {
                id:           warnId,
                reason:       alasan,
                targetId:     target.id,
                targetTag:    target.user.tag,
                moderatorId:  interaction.user.id,
                moderatorTag: interaction.user.tag,
                timestamp:    Date.now(),
            };
            warns.push(entry);
            setWarns(client, guildId, target.id, warns);
            pushWarnLog(client, guildId, entry);

            // DM ke member
            await target.user.send({
                embeds: [new EmbedBuilder()
                    .setColor('#FEE75C')
                    .setTitle('⚠️ Kamu Mendapat Peringatan')
                    .setDescription(
                        `Kamu mendapat peringatan di **${interaction.guild.name}**.\n` +
                        `**Alasan:** ${alasan}\n**Total peringatan:** ${warns.length}`
                    )
                    .setTimestamp()]
            }).catch(() => null);

            // Cek threshold otomatis
            const config     = getWarnConfig(client, guildId);
            const actionDone = await applyThresholdAction(interaction.guild, target, warns.length, config);

            const embed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('⚠️ Peringatan Diberikan')
                .addFields(
                    { name: '👤 Member',     value: `${target} (${target.user.tag})`, inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`,            inline: true },
                    { name: '📊 Total',      value: `${warns.length} warn`,           inline: true },
                    { name: '📝 Alasan',     value: alasan },
                    { name: '🔖 ID Warn',    value: `\`${warnId}\`` },
                )
                .setTimestamp();

            if (actionDone) embed.addFields({ name: '⚡ Tindakan Otomatis', value: actionDone });

            // Kirim ke mod log channel jika dikonfigurasi
            const logChId = client.database.get(`modlog-channel-${guildId}`);
            if (logChId) {
                const logCh = interaction.guild.channels.cache.get(logChId);
                if (logCh?.isTextBased()) await logCh.send({ embeds: [embed] }).catch(() => null);
            }

            return interaction.reply({ embeds: [embed] });
        }

        // ── /warn remove ───────────────────────────────────────────────────────
        if (sub === 'remove') {
            const target = interaction.options.getMember('member');
            const warnId = interaction.options.getString('id').toUpperCase();

            if (!target)
                return interaction.reply({ content: '❌ Member tidak ditemukan.', flags: MessageFlags.Ephemeral });

            const warns = getWarns(client, guildId, target.id);
            const idx   = warns.findIndex(w => w.id === warnId);
            if (idx === -1)
                return interaction.reply({ content: `❌ Peringatan \`${warnId}\` tidak ditemukan.`, flags: MessageFlags.Ephemeral });

            warns.splice(idx, 1);
            setWarns(client, guildId, target.id, warns);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle('✅ Peringatan Dihapus')
                    .setDescription(`Peringatan \`${warnId}\` dari ${target} dihapus.\nSisa peringatan: **${warns.length}**`)
                    .setTimestamp()]
            });
        }

        // ── /warn clear ────────────────────────────────────────────────────────
        if (sub === 'clear') {
            const target = interaction.options.getMember('member');
            if (!target)
                return interaction.reply({ content: '❌ Member tidak ditemukan.', flags: MessageFlags.Ephemeral });

            const warns = getWarns(client, guildId, target.id);
            if (warns.length === 0)
                return interaction.reply({ content: `${target} tidak memiliki peringatan.`, flags: MessageFlags.Ephemeral });

            client.database.delete(`warn-${guildId}-${target.id}`);

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle('✅ Semua Peringatan Dihapus')
                    .setDescription(`Semua **${warns.length}** peringatan dari ${target} telah dihapus.`)
                    .setTimestamp()]
            });
        }

        // ── /warn list ─────────────────────────────────────────────────────────
        if (sub === 'list') {
            const target = interaction.options.getMember('member');
            if (!target)
                return interaction.reply({ content: '❌ Member tidak ditemukan.', flags: MessageFlags.Ephemeral });

            const warns = getWarns(client, guildId, target.id);

            if (warns.length === 0) {
                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#57F287')
                        .setTitle('📋 Daftar Peringatan')
                        .setDescription(`${target} tidak memiliki peringatan. ✅`)
                        .setTimestamp()],
                    flags: MessageFlags.Ephemeral,
                });
            }

            const list = warns.slice(-10).reverse().map((w, i) => {
                const date = new Date(w.timestamp).toLocaleDateString('id-ID', {
                    day: '2-digit', month: 'short', year: 'numeric',
                });
                return `**${i + 1}.** \`${w.id}\` — ${w.reason}\n↳ oleh <@${w.moderatorId}> • ${date}`;
            }).join('\n\n');

            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#FEE75C')
                    .setTitle(`⚠️ Peringatan — ${target.user.tag}`)
                    .setDescription(list)
                    .setFooter({ text: `Total: ${warns.length} peringatan${warns.length > 10 ? ' (10 terbaru)' : ''}` })
                    .setTimestamp()],
                flags: MessageFlags.Ephemeral,
            });
        }
    },
}).toJSON();

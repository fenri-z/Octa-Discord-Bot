'use strict';

const { ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const DiscordBot         = require('../../client/DiscordBot');
const ApplicationCommand = require('../../structure/ApplicationCommand');

// ── Duration parser ────────────────────────────────────────────────────────────
// Contoh: "1h30m", "2d", "30m", "1h", "7200" (detik)
function parseDuration(input) {
    const str = String(input).trim().toLowerCase();

    // Pure angka = menit
    if (/^\d+$/.test(str)) return parseInt(str) * 60_000;

    let ms = 0;
    const matches = str.matchAll(/(\d+(?:\.\d+)?)\s*(d|h|m|s)/g);
    for (const m of matches) {
        const val = parseFloat(m[1]);
        switch (m[2]) {
            case 'd': ms += val * 86_400_000; break;
            case 'h': ms += val * 3_600_000;  break;
            case 'm': ms += val * 60_000;     break;
            case 's': ms += val * 1_000;      break;
        }
    }
    return ms;
}

function formatDuration(ms) {
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const parts = [];
    if (d) parts.push(`${d} hari`);
    if (h) parts.push(`${h} jam`);
    if (m) parts.push(`${m} menit`);
    return parts.join(' ') || 'kurang dari 1 menit';
}

// ── Command ────────────────────────────────────────────────────────────────────

module.exports = new ApplicationCommand({
    command: {
        name: 'giveaway',
        description: 'Kelola giveaway server.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            // ── start ─────────────────────────────────────────────────────
            {
                name: 'start',
                description: 'Mulai giveaway baru.',
                type: 1,
                options: [
                    {
                        name: 'hadiah',
                        description: 'Hadiah yang akan diberikan (contoh: Discord Nitro 1 Bulan)',
                        type: 3, required: true,
                    },
                    {
                        name: 'durasi',
                        description: 'Durasi giveaway (contoh: 1h, 30m, 1d, 2h30m)',
                        type: 3, required: true,
                    },
                    {
                        name: 'channel',
                        description: 'Channel tempat embed giveaway dikirim (default: channel saat ini)',
                        type: 7, required: false,
                        channel_types: [0, 5],
                    },
                    {
                        name: 'pemenang',
                        description: 'Jumlah pemenang (default: 1, maks: 20)',
                        type: 4, required: false,
                        min_value: 1, max_value: 20,
                    },
                    {
                        name: 'role_wajib',
                        description: 'Role yang wajib dimiliki untuk ikut (opsional)',
                        type: 8, required: false,
                    },
                ],
            },
            // ── end ───────────────────────────────────────────────────────
            {
                name: 'end',
                description: 'Akhiri giveaway aktif sekarang dan pilih pemenang.',
                type: 1,
                options: [
                    {
                        name: 'giveaway',
                        description: 'Pilih giveaway yang ingin diakhiri',
                        type: 3, required: true, autocomplete: true,
                    },
                ],
            },
            // ── reroll ────────────────────────────────────────────────────
            {
                name: 'reroll',
                description: 'Pilih ulang pemenang giveaway yang sudah selesai.',
                type: 1,
                options: [
                    {
                        name: 'giveaway',
                        description: 'Pilih giveaway yang ingin di-reroll',
                        type: 3, required: true, autocomplete: true,
                    },
                ],
            },
            // ── list ──────────────────────────────────────────────────────
            {
                name: 'list',
                description: 'Tampilkan semua giveaway aktif di server ini.',
                type: 1,
            },
        ],
    },

    // ── Autocomplete ──────────────────────────────────────────────────────────
    /**
     * @param {import('discord.js').AutocompleteInteraction} interaction
     * @param {DiscordBot} client
     */
    autocomplete: async (client, interaction) => {
        const sub     = interaction.options.getSubcommand();
        const focused = interaction.options.getFocused().toLowerCase();
        const manager = client.giveawayManager;
        if (!manager) return interaction.respond([]);

        const all = manager.getAll(interaction.guildId);
        let list;

        if (sub === 'end') {
            list = all.filter(g => !g.ended && !g.cancelled);
        } else if (sub === 'reroll') {
            list = all.filter(g => g.ended && !g.cancelled);
        } else {
            list = all;
        }

        const choices = list
            .filter(g => g.prize.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(g => ({
                name: `${g.prize} (${g.ended ? 'Selesai' : 'Aktif'})`.slice(0, 100),
                value: g.id,
            }));

        await interaction.respond(choices);
    },

    // ── Run ───────────────────────────────────────────────────────────────────
    /**
     * @param {ChatInputCommandInteraction} interaction
     * @param {DiscordBot} client
     */
    run: async (client, interaction) => {
        const sub     = interaction.options.getSubcommand();
        const manager = client.giveawayManager;

        if (!manager) {
            return interaction.reply({
                content: '❌ GiveawayManager tidak tersedia.',
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── /giveaway start ───────────────────────────────────────────────
        if (sub === 'start') {
            const prize          = interaction.options.getString('hadiah');
            const durasiRaw      = interaction.options.getString('durasi');
            const channelOption  = interaction.options.getChannel('channel');
            const winnerCount    = interaction.options.getInteger('pemenang')  ?? 1;
            const requiredRole   = interaction.options.getRole('role_wajib');

            const targetChannel = channelOption || interaction.channel;

            const durationMs = parseDuration(durasiRaw);
            if (durationMs < 10_000) {
                return interaction.reply({
                    content: '❌ Durasi minimal 10 detik. Contoh format: `1h`, `30m`, `1d`, `2h30m`.',
                    flags: MessageFlags.Ephemeral,
                });
            }
            if (durationMs > 30 * 86_400_000) {
                return interaction.reply({
                    content: '❌ Durasi maksimal 30 hari.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const gw = await manager.createGiveaway({
                    guildId:        interaction.guildId,
                    channelId:      targetChannel.id,
                    prize,
                    durationMs,
                    winnerCount,
                    hostId:         interaction.user.id,
                    requiredRoleId: requiredRole?.id || null,
                });

                await interaction.editReply({
                    content: [
                        `✅ Giveaway **${gw.prize}** berhasil dimulai di ${targetChannel}!`,
                        `⏰ Berakhir dalam **${formatDuration(durationMs)}**`,
                        `🏆 **${winnerCount}** pemenang`,
                        requiredRole ? `🔒 Role wajib: ${requiredRole}` : '',
                    ].filter(Boolean).join('\n'),
                });
            } catch (err) {
                await interaction.editReply({ content: `❌ Gagal: ${err.message}` });
            }
            return;
        }

        // ── /giveaway end ─────────────────────────────────────────────────
        if (sub === 'end') {
            const id = interaction.options.getString('giveaway');
            const gw = manager._get(id);

            if (!gw || gw.guildId !== interaction.guildId) {
                return interaction.reply({ content: '❌ Giveaway tidak ditemukan.', flags: MessageFlags.Ephemeral });
            }
            if (gw.ended) {
                return interaction.reply({ content: '❌ Giveaway ini sudah selesai.', flags: MessageFlags.Ephemeral });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                await manager.endGiveaway(id);
                await interaction.editReply({ content: `✅ Giveaway **${gw.prize}** berhasil diakhiri!` });
            } catch (err) {
                await interaction.editReply({ content: `❌ Gagal: ${err.message}` });
            }
            return;
        }

        // ── /giveaway reroll ──────────────────────────────────────────────
        if (sub === 'reroll') {
            const id = interaction.options.getString('giveaway');
            const gw = manager._get(id);

            if (!gw || gw.guildId !== interaction.guildId) {
                return interaction.reply({ content: '❌ Giveaway tidak ditemukan.', flags: MessageFlags.Ephemeral });
            }
            if (!gw.ended) {
                return interaction.reply({ content: '❌ Giveaway belum selesai.', flags: MessageFlags.Ephemeral });
            }
            if (gw.cancelled) {
                return interaction.reply({ content: '❌ Giveaway ini sudah dibatalkan.', flags: MessageFlags.Ephemeral });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                const winners = await manager.rerollGiveaway(id);
                const mention = winners.map(u => `<@${u.id}>`).join(', ');
                await interaction.editReply({
                    content: winners.length
                        ? `✅ Reroll selesai! Pemenang baru: ${mention}`
                        : '⚠️ Tidak ada peserta yang memenuhi syarat.',
                });
            } catch (err) {
                await interaction.editReply({ content: `❌ Gagal: ${err.message}` });
            }
            return;
        }

        // ── /giveaway list ────────────────────────────────────────────────
        if (sub === 'list') {
            const all    = manager.getAll(interaction.guildId);
            const active = all.filter(g => !g.ended && !g.cancelled);

            if (!active.length) {
                return interaction.reply({
                    content: '📋 Tidak ada giveaway yang sedang berlangsung.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            const embed = new EmbedBuilder()
                .setColor(0xF0A032)
                .setTitle('🎉 Giveaway Aktif')
                .setTimestamp();

            for (const gw of active.slice(0, 10)) {
                const channel   = interaction.guild.channels.cache.get(gw.channelId);
                const remaining = gw.endsAt - Date.now();
                embed.addFields({
                    name: gw.prize,
                    value: [
                        `📢 ${channel ? channel.toString() : 'channel tidak ditemukan'}`,
                        `⏰ Berakhir <t:${Math.floor(gw.endsAt / 1000)}:R>`,
                        `🏆 ${gw.winnerCount} pemenang`,
                    ].join('\n'),
                    inline: false,
                });
            }

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
    },
}).toJSON();

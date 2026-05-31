const {
    ButtonInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
} = require('discord.js');
const DiscordBot  = require('../../client/DiscordBot');
const Component   = require('../../structure/Component');
const { getServerStatsConfig } = require('../../utils/serverStatsHelper');
const { warn } = require('../../utils/Console');

// ── Hapus channel langsung via REST API (lebih andal dari .delete() object) ──
async function deleteChannelById(token, channelId, reason) {
    if (!channelId) return { ok: true, skipped: true };

    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bot ${token}`,
            'X-Audit-Log-Reason': encodeURIComponent(reason),
        },
        signal: AbortSignal.timeout(10_000),
    }).catch(err => ({ ok: false, _fetchError: err.message }));

    if (res._fetchError) return { ok: false, error: res._fetchError };
    // 200 = berhasil dihapus, 404 = sudah tidak ada (anggap sukses)
    if (res.ok || res.status === 404) return { ok: true, status: res.status };

    const body = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, error: JSON.stringify(body) };
}

module.exports = new Component({
    customId: 'serverstats-reset-confirm',
    type: 'button',
    /**
     * @param {DiscordBot} client
     * @param {ButtonInteraction} interaction
     */
    run: async (client, interaction) => {
        await interaction.deferUpdate();

        const guild   = interaction.guild;
        const guildId = guild.id;

        // ── Cek izin user yang menekan tombol ─────────────────────────────
        const member = interaction.member ?? await guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.editReply({
                content: '❌ Kamu tidak memiliki izin **Manage Server** untuk melakukan reset.',
                embeds: [],
                components: [],
            });
        }

        // ── Cek permission bot sebelum mencoba hapus ───────────────────────
        const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.editReply({
                content: '❌ Bot tidak memiliki izin **Manage Channels** di server ini.\nBerikan izin tersebut lalu coba lagi, atau hapus channel stats secara manual.',
                embeds: [],
                components: [],
            });
        }

        const cfg = getServerStatsConfig(client, guildId);
        const { categoryId, totalId, humanId, botId } = cfg;

        const token  = process.env.CLIENT_TOKEN;
        const reason = `Reset server stats oleh ${interaction.user.tag}`;
        const label  = `[serverstats-reset] guild:${guildId}`;

        // ── Kirim feedback awal ke user ────────────────────────────────────
        const embedPending = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle('⏳ Sedang Mereset Server Stats...')
            .setDescription(
                '> Sedang menghapus channel dan category statistik dari Discord...\n\n' +
                '> Mohon tunggu sebentar.'
            )
            .setFooter({ text: `Direset oleh ${interaction.user.tag}` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embedPending], components: [] });

        // ── STEP 1: Hapus channel Discord dulu (sebelum hapus database) ────
        const failedChannels = [];

        for (const [name, id] of [['total', totalId], ['human', humanId], ['bot', botId]]) {
            if (!id) continue;

            // Cek permission bot di channel/category spesifik ini
            const discordChannel = guild.channels.cache.get(id);
            if (discordChannel) {
                const permsInChannel = botMember.permissionsIn(discordChannel);
                if (!permsInChannel.has(PermissionFlagsBits.ManageChannels)) {
                    warn(`${label} bot tidak punya ManageChannels di channel ${name} (${id}), skip.`);
                    failedChannels.push(`\`${name}\` — bot tidak punya izin di channel ini`);
                    continue;
                }
            }

            const result = await deleteChannelById(token, id, reason);
            if (!result.ok) {
                warn(`${label} gagal hapus channel ${name} (${id}): ${result.error}`);
                failedChannels.push(`\`${name}\` — ${result.error}`);
            }
        }

        // Hapus category terakhir setelah semua voice channel terhapus
        if (categoryId) {
            const result = await deleteChannelById(token, categoryId, reason);
            if (!result.ok) {
                warn(`${label} gagal hapus category (${categoryId}): ${result.error}`);
                failedChannels.push(`\`category\` — ${result.error}`);
            }
        }

        // ── STEP 2: Hapus database SETELAH channel Discord dihapus ────────
        const keysToDelete = [
            `serverstats-enabled-${guildId}`,
            `serverstats-category-${guildId}`,
            `serverstats-total-channel-${guildId}`,
            `serverstats-human-channel-${guildId}`,
            `serverstats-bot-channel-${guildId}`,
            `serverstats-total-label-${guildId}`,
            `serverstats-human-label-${guildId}`,
            `serverstats-bot-label-${guildId}`,
            `serverstats-category-label-${guildId}`,
        ];
        for (const key of keysToDelete) client.database.delete(key);

        // ── STEP 3: Balas interaksi dengan hasil akhir ─────────────────────
        if (failedChannels.length > 0) {
            // Ada channel yang gagal dihapus
            const embedPartial = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('⚠️ Reset Sebagian Berhasil')
                .setDescription(
                    '> Konfigurasi database telah dihapus.\n\n' +
                    '> Namun beberapa channel **gagal dihapus otomatis** dari Discord:\n' +
                    failedChannels.map(f => `> • ${f}`).join('\n') + '\n\n' +
                    '> **Silakan hapus channel tersebut secara manual.**\n\n' +
                    '> Gunakan `/serverstats setup` untuk memulai konfigurasi baru.'
                )
                .setFooter({ text: `Direset oleh ${interaction.user.tag}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embedPartial], components: [] });
        } else {
            // Semua berhasil
            const embedSuccess = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('✅ Server Stats Berhasil Direset')
                .setDescription(
                    '> Semua konfigurasi server stats telah dihapus.\n\n' +
                    '> Semua channel dan category statistik telah dihapus dari Discord.\n\n' +
                    '> Gunakan `/serverstats setup` untuk memulai konfigurasi baru.'
                )
                .setFooter({ text: `Direset oleh ${interaction.user.tag}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embedSuccess], components: [] });
        }
    }
}).toJSON();

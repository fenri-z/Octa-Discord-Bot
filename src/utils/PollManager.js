const { EmbedBuilder } = require('discord.js');
const { getStrings } = require('./BotLang');
const { logError } = require('./logError');

const EMOJIS = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

function progressBar(count, total, len = 10) {
    const filled = total > 0 ? Math.round((count / total) * len) : 0;
    return `\`[${'█'.repeat(filled)}${'░'.repeat(len - filled)}]\``;
}

/**
 * Tutup poll dan tampilkan hasil. Hapus dari DB setelah selesai.
 * @param {import('../client/DiscordBot')} client
 * @param {{ guildId, channelId, messageId, question, options, lang }} pollData
 */
async function closePoll(client, pollData) {
    const { channelId, messageId, question, options, lang } = pollData;

    const channel = client.channels.cache.get(channelId)
        || await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const updated = await channel.messages.fetch(messageId).catch(() => null);
    if (!updated) return;

    const s = getStrings(lang || 'en').poll;

    const results = options.map((opt, i) => {
        const count = (updated.reactions.cache.get(EMOJIS[i])?.count ?? 1) - 1;
        return { opt, emoji: EMOJIS[i], count };
    }).sort((a, b) => b.count - a.count);

    const total      = results.reduce((sum, r) => sum + r.count, 0);
    const resultDesc = results.map(r => {
        const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
        const bar = progressBar(r.count, total);
        return `${r.emoji} **${r.opt}**\n${bar} ${r.count} vote (${pct}%)`;
    }).join('\n\n');

    const resultEmbed = new EmbedBuilder()
        .setColor(0x3BA55D)
        .setTitle(s.result_title(question))
        .setDescription(resultDesc || s.no_votes)
        .setFooter({ text: s.footer_total(total) });

    await updated.edit({ embeds: [resultEmbed] }).catch(err => logError('[PollManager] edit result failed:', err));

    // Hapus dari DB setelah ditutup
    client.database.delete(`poll-active-${channelId}-${messageId}`);
}

/**
 * Jadwalkan penutupan poll. Gunakan di slashcommand-poll dan onReady.
 * @param {import('../client/DiscordBot')} client
 * @param {object} pollData
 * @param {number} delayMs  - Waktu hingga penutupan dalam ms
 */
function schedulePoll(client, pollData, delayMs) {
    setTimeout(async () => {
        await closePoll(client, pollData).catch(err =>
            logError('[PollManager]', err)
        );
    }, delayMs);
}

/**
 * Pulihkan semua poll aktif dari DB saat bot startup.
 * @param {import('../client/DiscordBot')} client
 */
async function restoreActivePolls(client) {
    const keys = client.database.keysLike('poll-active-%');
    if (!keys.length) return;

    let restored = 0;
    for (const key of keys) {
        try {
            const raw = client.database.get(key);
            if (!raw) continue;
            const data = JSON.parse(raw);
            const remaining = data.endsAt - Date.now();

            if (remaining <= 0) {
                // Poll sudah berakhir saat bot offline — tutup sekarang
                await closePoll(client, data).catch(err => logError('[PollRestore]', err));
            } else {
                schedulePoll(client, data, remaining);
                restored++;
            }
        } catch (err) {
            logError('[PollRestore]', err);
            // Data korup — hapus saja
            client.database.delete(key);
        }
    }

    if (restored > 0 || keys.length > 0) {
        const { success } = require('./Console');
        success(`[PollManager] Restored ${restored} active poll(s). ${keys.length - restored} closed.`);
    }
}

module.exports = { schedulePoll, closePoll, restoreActivePolls };

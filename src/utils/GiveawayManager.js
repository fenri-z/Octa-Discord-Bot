'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const crypto = require('crypto');
const { info, warn } = require('./Console');

class GiveawayManager {
    constructor(client) {
        this.client   = client;
        this._timers  = new Map(); // id → setTimeout handle
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    async start() {
        const db = this.client.database;
        if (!db) return;

        let restored = 0;
        for (const guild of this.client.guilds.cache.values()) {
            const active = this._getActive(guild.id);
            for (const id of active) {
                const gw = this._get(id);
                if (!gw || gw.ended || gw.cancelled) continue;

                const remaining = gw.endsAt - Date.now();
                if (remaining <= 0) {
                    // Sudah lewat waktu — end sekarang
                    this._endGiveaway(id).catch(err => warn(`[Giveaway] Auto-end error: ${err.message}`));
                } else {
                    this._scheduleEnd(id, remaining);
                    restored++;
                }
            }
        }
        if (restored > 0) info(`[Giveaway] ${restored} giveaway aktif dipulihkan.`);
    }

    stop() {
        for (const timer of this._timers.values()) clearTimeout(timer);
        this._timers.clear();
    }

    // ─── Create ────────────────────────────────────────────────────────────────

    async createGiveaway({ guildId, channelId, prize, durationMs, winnerCount, hostId, requiredRoleId }) {
        const guild   = this.client.guilds.cache.get(guildId);
        const channel = guild?.channels.cache.get(channelId);
        if (!channel) throw new Error('Channel not found.');

        const id     = crypto.randomUUID();
        const endsAt = Date.now() + durationMs;

        const embed = this._buildEmbed({ prize, endsAt, winnerCount, hostId, requiredRoleId, ended: false });
        const msg   = await channel.send({ embeds: [embed] });
        await msg.react('🎉').catch(() => {});

        const gw = {
            id, guildId, channelId,
            messageId: msg.id,
            prize, winnerCount, endsAt,
            hostId: hostId || null,
            requiredRoleId: requiredRoleId || null,
            ended: false, cancelled: false, winners: [],
        };

        this._save(id, gw);
        this._addActive(guildId, id);
        this._scheduleEnd(id, durationMs);

        info(`[Giveaway] Dibuat: "${prize}" di guild ${guildId}, berakhir dalam ${Math.round(durationMs / 60000)} menit.`);
        return gw;
    }

    // ─── End ───────────────────────────────────────────────────────────────────

    async endGiveaway(id) {
        return this._endGiveaway(id);
    }

    async _endGiveaway(id) {
        const gw = this._get(id);
        if (!gw || gw.ended || gw.cancelled) return;

        clearTimeout(this._timers.get(id));
        this._timers.delete(id);

        const winners = await this._pickWinners(gw);
        gw.ended       = true;
        gw.winners     = winners.map(u => u.id);
        gw.winnerNames = winners.map(u => u.displayName || u.username || u.id);
        this._save(id, gw);
        this._removeActive(gw.guildId, id);
        this._addEnded(gw.guildId, id);

        await this._updateMessage(gw, winners);
        await this._announceWinners(gw, winners);

        info(`[Giveaway] Selesai: "${gw.prize}" — ${winners.length} pemenang.`);
    }

    // ─── Reroll ────────────────────────────────────────────────────────────────

    async rerollGiveaway(id) {
        const gw = this._get(id);
        if (!gw) throw new Error('Giveaway not found.');
        if (!gw.ended) throw new Error('Giveaway has not ended yet.');
        if (gw.cancelled) throw new Error('Giveaway has been cancelled.');

        const winners  = await this._pickWinners(gw);
        gw.winners     = winners.map(u => u.id);
        gw.winnerNames = winners.map(u => u.displayName || u.username || u.id);
        this._save(id, gw);

        await this._updateMessage(gw, winners);
        await this._announceWinners(gw, winners, true);
        return winners;
    }

    // ─── Cancel ────────────────────────────────────────────────────────────────

    async cancelGiveaway(id) {
        const gw = this._get(id);
        if (!gw) throw new Error('Giveaway not found.');
        if (gw.ended) throw new Error('Giveaway has already ended.');
        if (gw.cancelled) throw new Error('Giveaway has been cancelled.');

        clearTimeout(this._timers.get(id));
        this._timers.delete(id);

        gw.cancelled = true;
        gw.ended     = true;
        this._save(id, gw);
        this._removeActive(gw.guildId, id);

        // Update embed jadi "dibatalkan"
        try {
            const guild   = this.client.guilds.cache.get(gw.guildId);
            const channel = guild?.channels.cache.get(gw.channelId);
            const msg     = await channel?.messages.fetch(gw.messageId).catch(() => null);
            if (msg) {
                const embed = new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle('🚫 Giveaway Dibatalkan')
                    .setDescription(`**${gw.prize}**`)
                    .setTimestamp();
                await msg.edit({ embeds: [embed] }).catch(() => {});
            }
        } catch { /* noop */ }

        info(`[Giveaway] Dibatalkan: "${gw.prize}"`);
    }

    // ─── Delete ────────────────────────────────────────────────────────────────

    deleteGiveaway(id) {
        const gw = this._get(id);
        if (!gw) throw new Error('Giveaway not found.');
        if (!gw.ended && !gw.cancelled) throw new Error('Only giveaways that have ended or been cancelled can be deleted.');

        const db = this.client.database;
        db?.delete(`giveaway-${id}`);

        // Hapus dari ended list
        const endedRaw = db?.get(`giveaway-ended-${gw.guildId}`);
        let endedList = [];
        try { endedList = endedRaw ? JSON.parse(endedRaw) : []; } catch {}
        endedList = endedList.filter(x => x !== id);
        db?.set(`giveaway-ended-${gw.guildId}`, JSON.stringify(endedList));

        // Hapus dari active list (seharusnya sudah tidak ada, tapi jaga-jaga)
        this._removeActive(gw.guildId, id);

        info(`[Giveaway] Dihapus: "${gw.prize}" (id: ${id})`);
    }

    // ─── Pick Winners ──────────────────────────────────────────────────────────

    async _pickWinners(gw) {
        try {
            const guild   = this.client.guilds.cache.get(gw.guildId);
            const channel = guild?.channels.cache.get(gw.channelId);
            const msg     = await channel?.messages.fetch(gw.messageId).catch(() => null);
            if (!msg) return [];

            // Ambil semua user yang react 🎉
            const reaction = msg.reactions.cache.get('🎉');
            if (!reaction) return [];

            const users = await reaction.users.fetch();
            let entrants = [...users.values()].filter(u => !u.bot);

            // Filter role jika ada
            if (gw.requiredRoleId && guild) {
                const withRole = [];
                for (const user of entrants) {
                    const member = guild.members.cache.get(user.id)
                        || await guild.members.fetch(user.id).catch(() => null);
                    if (member?.roles.cache.has(gw.requiredRoleId)) withRole.push(user);
                }
                entrants = withRole;
            }

            // Exclude host
            if (gw.hostId) entrants = entrants.filter(u => u.id !== gw.hostId);

            if (!entrants.length) return [];

            // Shuffle dan ambil sejumlah winnerCount
            const shuffled = entrants.sort(() => Math.random() - 0.5);
            return shuffled.slice(0, gw.winnerCount);
        } catch (err) {
            warn(`[Giveaway] Failed to pick winners: ${err.message}`);
            return [];
        }
    }

    // ─── Discord Messages ──────────────────────────────────────────────────────

    _buildEmbed({ prize, endsAt, winnerCount, hostId, requiredRoleId, ended, winners }) {
        const embed = new EmbedBuilder()
            .setColor(ended ? 0x5865F2 : 0xF0A032)
            .setTitle(ended ? '🎊 Giveaway Selesai!' : '🎉 GIVEAWAY')
            .setTimestamp(new Date(endsAt));

        if (ended) {
            embed.setDescription(`**${prize}**\n\n` +
                (winners?.length
                    ? `🏆 Pemenang: ${winners.map(id => `<@${id}>`).join(', ')}`
                    : '😢 Tidak ada peserta yang memenuhi syarat.')
            );
            embed.setFooter({ text: `Berakhir` });
        } else {
            embed.setDescription(
                `**${prize}**\n\nReaksi dengan 🎉 untuk ikut!\n\n` +
                `🏆 Jumlah pemenang: **${winnerCount}**\n` +
                `⏰ Berakhir: <t:${Math.floor(endsAt / 1000)}:R>` +
                (hostId ? `\n👤 Host: <@${hostId}>` : '') +
                (requiredRoleId ? `\n🔒 Wajib role: <@&${requiredRoleId}>` : '')
            );
            embed.setFooter({ text: `Berakhir pada` });
        }

        return embed;
    }

    async _updateMessage(gw, winners) {
        try {
            const guild   = this.client.guilds.cache.get(gw.guildId);
            const channel = guild?.channels.cache.get(gw.channelId);
            const msg     = await channel?.messages.fetch(gw.messageId).catch(() => null);
            if (!msg) return;

            const embed = this._buildEmbed({ ...gw, ended: true, winners: winners.map(u => u.id) });
            await msg.edit({ embeds: [embed] }).catch(err => warn(`[Giveaway] Failed to update message: ${err.message}`));
        } catch (err) { warn(`[Giveaway] _updateMessage error: ${err.message}`); }
    }

    async _announceWinners(gw, winners, isReroll = false) {
        try {
            const guild   = this.client.guilds.cache.get(gw.guildId);
            const channel = guild?.channels.cache.get(gw.channelId);
            if (!channel) return;

            if (!winners.length) {
                await channel.send(`😢 Tidak ada peserta yang memenuhi syarat untuk giveaway **${gw.prize}**.`).catch(err => warn(`[Giveaway] no-winner send failed: ${err.message}`));
                return;
            }

            const mention = winners.map(u => `<@${u.id}>`).join(', ');
            const prefix  = isReroll ? '🔄 **Reroll!**' : '🎊 **Congratulations!**';
            await channel.send(
                `${prefix} ${mention} memenangkan **${gw.prize}**! ` +
                `[View giveaway](https://discord.com/channels/${gw.guildId}/${gw.channelId}/${gw.messageId})`
            ).catch(err => warn(`[Giveaway] winner announce send failed: ${err.message}`));
        } catch (err) { warn(`[Giveaway] _announceWinners error: ${err.message}`); }
    }

    // ─── Timer ─────────────────────────────────────────────────────────────────

    _scheduleEnd(id, ms) {
        if (this._timers.has(id)) clearTimeout(this._timers.get(id));
        const handle = setTimeout(() => {
            this._endGiveaway(id).catch(err => warn(`[Giveaway] End error: ${err.message}`));
        }, Math.max(ms, 1000));
        this._timers.set(id, handle);
    }

    // ─── Database ──────────────────────────────────────────────────────────────

    _get(id) {
        const db  = this.client.database;
        const raw = db?.get(`giveaway-${id}`);
        try { return raw ? JSON.parse(raw) : null; } catch { return null; }
    }

    _save(id, gw) {
        this.client.database?.set(`giveaway-${id}`, JSON.stringify(gw));
    }

    _getActive(guildId) {
        const raw = this.client.database?.get(`giveaway-active-${guildId}`);
        try { return raw ? JSON.parse(raw) : []; } catch { return []; }
    }

    _addActive(guildId, id) {
        const list = this._getActive(guildId);
        if (!list.includes(id)) list.push(id);
        this.client.database?.set(`giveaway-active-${guildId}`, JSON.stringify(list));
    }

    _removeActive(guildId, id) {
        const list = this._getActive(guildId).filter(x => x !== id);
        this.client.database?.set(`giveaway-active-${guildId}`, JSON.stringify(list));
    }

    getAll(guildId) {
        const db     = this.client.database;
        const active = this._getActive(guildId);

        // Ambil semua giveaway yang pernah ada (active + ended)
        const all = [];
        const seen = new Set();

        // Dari active list
        for (const id of active) {
            const gw = this._get(id);
            if (gw && !seen.has(id)) { all.push(gw); seen.add(id); }
        }

        // Cari ended giveaways dari semua key
        // (Simpan ended list terpisah)
        const endedRaw = db?.get(`giveaway-ended-${guildId}`);
        let endedList  = [];
        try { endedList = endedRaw ? JSON.parse(endedRaw) : []; } catch {}

        for (const id of endedList.slice(-20)) { // max 20 terakhir
            const gw = this._get(id);
            if (gw && !seen.has(id)) { all.push(gw); seen.add(id); }
        }

        return all.sort((a, b) => b.endsAt - a.endsAt);
    }

    _addEnded(guildId, id) {
        const db      = this.client.database;
        const raw     = db?.get(`giveaway-ended-${guildId}`);
        let list = [];
        try { list = raw ? JSON.parse(raw) : []; } catch {}
        if (!list.includes(id)) list.push(id);
        // Keep only last 30
        if (list.length > 30) list = list.slice(-30);
        db?.set(`giveaway-ended-${guildId}`, JSON.stringify(list));
    }
}

module.exports = GiveawayManager;

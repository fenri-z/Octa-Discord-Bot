'use strict';

const { warn, info } = require('./Console');
const { EmbedBuilder } = require('discord.js');

// Graceful import — live detection opsional (butuh npm install tiktok-live-connector)
let WebcastPushConnection = null;
try {
    ({ WebcastPushConnection } = require('tiktok-live-connector'));
} catch {
    // Package tidak terinstall — hanya video polling yang aktif
}

const POLL_INTERVAL_MS      = 5 * 60 * 1000;  // Video: 5 menit via RSSHub
const LIVE_POLL_INTERVAL_MS = 3 * 60 * 1000;  // Live: 3 menit via WebSocket

const RSSHUB_BASE = (process.env.RSSHUB_BASE_URL || 'https://rsshub.app').replace(/\/$/, '');

class TikTokNotifier {
    constructor(client) {
        this.client     = client;
        this._pollTimer = null;
        this._liveTimer = null;
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    start() {
        info(`[TikTok] Video polling aktif (interval 5 menit). RSSHub: ${RSSHUB_BASE}`);
        setTimeout(() => {
            this._poll();
            this._pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
        }, 35_000);

        if (WebcastPushConnection) {
            info('[TikTok] Live polling aktif (interval 3 menit) via tiktok-live-connector.');
            this._liveTimer = setInterval(() => this._pollLive(), LIVE_POLL_INTERVAL_MS);
        } else {
            warn('[TikTok] tiktok-live-connector tidak ditemukan — live detection dinonaktifkan.');
            warn('[TikTok] Jalankan: npm install tiktok-live-connector');
        }
    }

    stop() {
        if (this._pollTimer) clearInterval(this._pollTimer);
        if (this._liveTimer) clearInterval(this._liveTimer);
        this._pollTimer = this._liveTimer = null;
    }

    get liveSupported() { return !!WebcastPushConnection; }

    async pollGuild(guildId) {
        const db    = this.client.database;
        const guild = this.client.guilds.cache.get(guildId);
        if (!db || !guild) return;
        await this._pollGuild(guild, db);
    }

    // ─── Account Lookup ────────────────────────────────────────────────────────

    async lookupAccount(input) {
        const username = this._resolveUsername(input);
        const feedUrl  = `${RSSHUB_BASE}/tiktok/user/${encodeURIComponent(username)}`;

        let res;
        try {
            res = await fetch(feedUrl, {
                signal:  AbortSignal.timeout(15_000),
                headers: { 'Cache-Control': 'no-cache' },
            });
        } catch (err) {
            throw new Error(`Tidak dapat menghubungi RSSHub (${RSSHUB_BASE}): ${err.message}`);
        }

        if (!res.ok) {
            if (res.status === 404) throw new Error(`Akun TikTok "${username}" tidak ditemukan di RSSHub.`);
            throw new Error(`RSSHub merespons HTTP ${res.status}. Coba lagi nanti.`);
        }

        const xml = await res.text();
        if (!xml.includes('<item>') && !xml.includes('<entry>')) {
            throw new Error(`Akun "${username}" tidak memiliki video publik atau tidak dikenali RSSHub.`);
        }

        const name      = this._parseChannelTitle(xml) || username;
        const thumbnail = this._parseChannelImage(xml);
        return { username, name, thumbnail };
    }

    _resolveUsername(input) {
        const s = input.trim();
        const urlMatch = s.match(/tiktok\.com\/@?([\w.]+)/i);
        if (urlMatch) return '@' + urlMatch[1];
        if (s.startsWith('@')) return s;
        return '@' + s;
    }

    // ─── Video Polling ─────────────────────────────────────────────────────────

    async _poll() {
        const db = this.client.database;
        if (!db) return;
        for (const guild of this.client.guilds.cache.values()) {
            this._pollGuild(guild, db).catch(err =>
                warn(`[TikTok] Poll error guild ${guild.id}: ${err.message}`)
            );
        }
    }

    async _pollGuild(guild, db) {
        const raw = db.get(`tiktok-accounts-${guild.id}`);
        if (!raw) return;
        let accounts;
        try { accounts = JSON.parse(raw); } catch { return; }
        if (!Array.isArray(accounts) || accounts.length === 0) return;

        for (const account of accounts) {
            await this._checkAccount(guild, db, account).catch(err =>
                warn(`[TikTok] Check error ${account.username}: ${err.message}`)
            );
        }
    }

    async _checkAccount(guild, db, account) {
        if (!account.videoEnabled || !account.videoChannelId) return;

        const feedUrl = `${RSSHUB_BASE}/tiktok/user/${encodeURIComponent(account.username)}`;
        let res;
        try {
            res = await fetch(feedUrl, {
                signal:  AbortSignal.timeout(12_000),
                headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
            });
        } catch (err) {
            warn(`[TikTok] Fetch error ${account.username}: ${err.message}`);
            return;
        }

        if (!res.ok) {
            warn(`[TikTok] Feed HTTP ${res.status} untuk ${account.username}`);
            return;
        }

        const entries = this._parseRssEntries(await res.text());
        if (entries.length === 0) return;

        const lastKey  = `tiktok-lastVideo-${guild.id}-${account.username}`;
        const lastId   = db.get(lastKey);
        const latestId = entries[0].id;

        if (!lastId) { db.set(lastKey, latestId); return; }
        if (lastId === latestId) return;

        const lastIdx   = entries.findIndex(e => e.id === lastId);
        const newEntries = lastIdx === -1 ? entries.slice(0, 3) : entries.slice(0, lastIdx);

        db.set(lastKey, latestId);
        for (const entry of [...newEntries].reverse()) {
            await this._sendVideoNotification(guild, account, entry).catch(err =>
                warn(`[TikTok] Kirim notif video error: ${err.message}`)
            );
        }
    }

    // ─── Live Polling ──────────────────────────────────────────────────────────

    async _pollLive() {
        const db = this.client.database;
        if (!db) return;
        for (const guild of this.client.guilds.cache.values()) {
            this._pollGuildLive(guild, db).catch(err =>
                warn(`[TikTok/Live] Poll error guild ${guild.id}: ${err.message}`)
            );
        }
    }

    async _pollGuildLive(guild, db) {
        const raw = db.get(`tiktok-accounts-${guild.id}`);
        if (!raw) return;
        let accounts;
        try { accounts = JSON.parse(raw); } catch { return; }

        const liveAccounts = accounts.filter(a => a.liveEnabled && a.liveChannelId);
        if (liveAccounts.length === 0) return;

        for (const account of liveAccounts) {
            await this._checkLive(guild, db, account).catch(err =>
                warn(`[TikTok/Live] Check error ${account.username}: ${err.message}`)
            );
        }
    }

    async _checkLive(guild, db, account) {
        const isLive  = await this._isLive(account.username);
        const liveKey = `tiktok-liveActive-${guild.id}-${account.username}`;
        const wasLive = !!db.get(liveKey);

        if (isLive && !wasLive) {
            db.set(liveKey, String(Date.now()));
            info(`[TikTok/Live] LIVE terdeteksi: ${account.username} → ${guild.name}`);
            await this._sendLiveNotification(guild, account).catch(err =>
                warn(`[TikTok/Live] Kirim notif gagal: ${err.message}`)
            );
        } else if (!isLive && wasLive) {
            db.delete(liveKey);
            info(`[TikTok/Live] Live berakhir: ${account.username}`);
        }
    }

    async _isLive(username) {
        if (!WebcastPushConnection) return false;
        return new Promise(resolve => {
            let resolved = false;
            const done = val => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                try { connection.disconnect(); } catch {}
                resolve(val);
            };

            const connection = new WebcastPushConnection(username, {
                processInitialData:      false,
                enableWebsocketUpgrade:  false,
                requestPollingIntervalMs: 1000,
            });

            const timer = setTimeout(() => done(false), 12_000);
            connection.connect().then(() => done(true)).catch(() => done(false));
        });
    }

    // ─── Video Notification ────────────────────────────────────────────────────

    async _sendVideoNotification(guild, account, entry) {
        const discordCh = guild.channels.cache.get(account.videoChannelId);
        if (!discordCh) return;

        const displayName = account.name || account.username;
        const fill = s => (s || '')
            .replace(/{account}/g,  displayName)
            .replace(/{username}/g, account.username)
            .replace(/{title}/g,    entry.title || '')
            .replace(/{url}/g,      entry.url)
            .replace(/{id}/g,       entry.id);

        const customMsg   = fill(account.videoMessage || '').trim();
        const description = customMsg
            || `**${displayName}** baru aja posting video baru di TikTok!\nJangan ketinggalan, tonton sekarang! 🎉`;

        const embed = new EmbedBuilder()
            .setColor(0x010101)
            .setTitle(`🎵 ${displayName} — Video Baru!`)
            .setURL(entry.url)
            .setDescription(description)
            .addFields(
                { name: '🎬 Judul',     value: entry.title || '(tanpa judul)', inline: false },
                { name: '🔗 Tonton di', value: `[Buka TikTok ▶](${entry.url})`, inline: false },
            );

        if (account.thumbnail) embed.setThumbnail(account.thumbnail);

        info(`[TikTok] Video notif: "${entry.title}" | ${account.username} → ${guild.name}`);
        await discordCh.send({ embeds: [embed] }).catch(err =>
            warn(`[TikTok] Kirim embed gagal: ${err.message}`)
        );
    }

    // ─── Live Notification ─────────────────────────────────────────────────────

    async _sendLiveNotification(guild, account) {
        const discordCh = guild.channels.cache.get(account.liveChannelId);
        if (!discordCh) return;

        const displayName = account.name || account.username;
        const liveUrl     = `https://www.tiktok.com/${account.username}/live`;

        const fill = s => (s || '')
            .replace(/{account}/g,  displayName)
            .replace(/{username}/g, account.username)
            .replace(/{url}/g,      liveUrl);

        const customMsg   = fill(account.liveMessage || '').trim();
        const description = customMsg
            || `Hey, **${displayName}** lagi **LIVE** di TikTok sekarang!\nYuk, join dan saksikan streamnya~ 🎉`;

        const embed = new EmbedBuilder()
            .setColor(0xFE2C55)
            .setTitle(`🔴 ${displayName} is Live Now!`)
            .setURL(liveUrl)
            .setDescription(description)
            .addFields(
                { name: '🔗 Tonton Live', value: `[Join sekarang ▶](${liveUrl})`, inline: false },
            );

        if (account.thumbnail) embed.setThumbnail(account.thumbnail);

        info(`[TikTok/Live] Live notif: ${account.username} → ${guild.name}`);
        await discordCh.send({ embeds: [embed] }).catch(err =>
            warn(`[TikTok/Live] Kirim embed gagal: ${err.message}`)
        );
    }

    // Untuk API test endpoint
    async _sendNotification(guild, account, type, entry) {
        if (type === 'live') return this._sendLiveNotification(guild, account);
        return this._sendVideoNotification(guild, account, entry);
    }

    // ─── RSS Parsing ───────────────────────────────────────────────────────────

    _parseChannelTitle(xml) {
        const channelBlock = xml.match(/<channel>([\s\S]*?)<item>/);
        if (!channelBlock) return '';
        const m = channelBlock[1].match(/<title>([\s\S]*?)<\/title>/);
        return m ? this._decodeXml(m[1])
            .replace(/^TikTok\s*[-–:]\s*/i, '')
            .replace(/\s+on\s+TikTok\s*$/i, '')
            .trim() : '';
    }

    _parseChannelImage(xml) {
        // <image><url>https://...</url></image> dari <channel> block
        const channelBlock = xml.match(/<channel>([\s\S]*?)<item>/);
        if (!channelBlock) return null;
        const m = channelBlock[1].match(/<image>\s*<url>([\s\S]*?)<\/url>/);
        return m ? this._decodeXml(m[1]).trim() : null;
    }

    _parseRssEntries(xml) {
        const entries = [];
        const itemRe  = /<item>([\s\S]*?)<\/item>/g;
        let m;
        while ((m = itemRe.exec(xml)) !== null) {
            const block  = m[1];
            const linkM  = block.match(/<link>([\s\S]*?)<\/link>/)
                        || block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/);
            const titleM = block.match(/<title>([\s\S]*?)<\/title>/);
            if (!linkM) continue;

            const url     = this._decodeXml(linkM[1]).trim();
            const videoId = this._extractVideoId(url);
            if (!videoId) continue;

            entries.push({
                id:    videoId,
                url,
                title: titleM ? this._decodeXml(titleM[1]) : '(tanpa judul)',
            });
        }
        return entries;
    }

    _extractVideoId(url) {
        const m = url.match(/\/video\/(\d+)/);
        return m ? m[1] : null;
    }

    _decodeXml(s) {
        return (s || '')
            .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
            .replace(/&amp;/g,  '&')
            .replace(/&lt;/g,   '<')
            .replace(/&gt;/g,   '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g,  "'")
            .trim();
    }
}

module.exports = TikTokNotifier;

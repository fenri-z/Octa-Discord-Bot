'use strict';

const { warn, info } = require('./Console');
const { EmbedBuilder } = require('discord.js');
const crypto = require('crypto');

const RSS_BASE   = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const HUB_URL    = 'https://pubsubhubbub.appspot.com/subscribe';
const TOPIC_BASE = 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=';

// WebSub aktif → RSS hanya fallback setiap 30 menit
// WebSub tidak aktif (BASE_URL kosong) → RSS primary setiap 5 menit
const POLL_INTERVAL_WEBSUB = 30 * 60 * 1000;
const POLL_INTERVAL_RSS    =  5 * 60 * 1000;

// Renewal check setiap 6 jam
const RENEW_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Lease 10 hari (maksimum YouTube)
const LEASE_SECONDS = 10 * 24 * 60 * 60;
// Perpanjang saat tersisa < 2 hari
const RENEW_BEFORE_MS = 2 * 24 * 60 * 60 * 1000;

const BROWSER_HEADERS = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

class YouTubeNotifier {
    constructor(client) {
        this.client      = client;
        this._pollTimer  = null;
        this._renewTimer = null;

        this._secret   = process.env.YOUTUBE_WEBSUB_SECRET || '';
        this._baseUrl  = (process.env.BASE_URL || '').replace(/\/$/, '');
        this._useWebSub = !!this._baseUrl;
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    start() {
        if (this._useWebSub) {
            info('[YouTube] Mode WebSub aktif — notifikasi instan. RSS polling sebagai fallback (30 menit).');
            // Subscribe semua channel yang belum aktif (tunda 5 detik biar bot ready)
            setTimeout(() => this._subscribeAll(), 5_000);
            // Perpanjang subscription yang mau expire setiap 6 jam
            this._renewTimer = setInterval(() => this._renewSubscriptions(), RENEW_INTERVAL_MS);
        } else {
            info('[YouTube] BASE_URL tidak di-set. Mode RSS polling (5 menit). Set BASE_URL di .env untuk aktifkan WebSub.');
        }

        // RSS fallback / primary
        const pollMs = this._useWebSub ? POLL_INTERVAL_WEBSUB : POLL_INTERVAL_RSS;
        setTimeout(() => {
            this._poll();
            this._pollTimer = setInterval(() => this._poll(), pollMs);
        }, 30_000);
    }

    stop() {
        if (this._pollTimer)  clearInterval(this._pollTimer);
        if (this._renewTimer) clearInterval(this._renewTimer);
        this._pollTimer = this._renewTimer = null;
    }

    // Force poll untuk satu guild (dipanggil dari API)
    async pollGuild(guildId) {
        const db    = this.client.database;
        const guild = this.client.guilds.cache.get(guildId);
        if (!db || !guild) return;
        await this._pollGuild(guild, db);
    }

    // ─── WebSub Public API ─────────────────────────────────────────────────────

    // Dipanggil saat channel ditambahkan via dashboard
    async subscribe(channelId) {
        if (!this._useWebSub) return false;
        return this._hubRequest(channelId, 'subscribe');
    }

    // Dipanggil saat channel dihapus (jika tidak ada guild lain yang pakai)
    async unsubscribe(channelId) {
        if (!this._useWebSub) return false;
        const ok = await this._hubRequest(channelId, 'unsubscribe');
        if (ok) {
            const db = this.client.database;
            db?.delete(`youtube-websub-${channelId}`);
        }
        return ok;
    }

    // Dipanggil webhook route saat YouTube verifikasi subscription berhasil
    onSubscribeVerified(channelId) {
        const db = this.client.database;
        if (!db) return;
        const meta = this._getSubMeta(db, channelId);
        meta.status     = 'active';
        meta.verifiedAt = Date.now();
        meta.expiresAt  = Date.now() + LEASE_SECONDS * 1000;
        db.set(`youtube-websub-${channelId}`, JSON.stringify(meta));
        info(`[WebSub] Subscription aktif: ${channelId}`);
    }

    // Dipanggil webhook route saat ada push notifikasi dari YouTube
    async handleWebhookPayload(xml) {
        const db = this.client.database;
        if (!db) return;

        // Parse semua entries dari Atom feed
        const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
        let em;
        while ((em = entryRe.exec(xml)) !== null) {
            await this._processWebSubEntry(db, em[1]).catch(err =>
                warn(`[WebSub] Error proses entry: ${err.message}`)
            );
        }
    }

    // Verify HMAC signature dari YouTube
    verifySignature(rawBody, signature) {
        if (!this._secret || !signature) return true; // skip jika tidak ada secret
        const expected = 'sha1=' + crypto.createHmac('sha1', this._secret).update(rawBody).digest('hex');
        return signature === expected;
    }

    // ─── WebSub Internal ───────────────────────────────────────────────────────

    async _processWebSubEntry(db, entryBlock) {
        const channelIdM  = entryBlock.match(/<yt:channelId>([\w-]+)<\/yt:channelId>/);
        const videoIdM    = entryBlock.match(/<yt:videoId>([\w-]+)<\/yt:videoId>/);
        const titleM      = entryBlock.match(/<title>([\s\S]*?)<\/title>/);
        const thumbM      = entryBlock.match(/url="(https:\/\/i\d*\.ytimg\.com\/vi\/[\w-]+\/[^"]+)"/);
        const channelNameM = entryBlock.match(/<name>([\s\S]*?)<\/name>/);

        if (!channelIdM || !videoIdM) return;

        const channelId   = channelIdM[1];
        const videoId     = videoIdM[1];
        const title       = titleM       ? this._decodeXml(titleM[1])       : 'Video Baru';
        const thumbnail   = thumbM       ? thumbM[1]
                           : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        const channelName = channelNameM ? this._decodeXml(channelNameM[1]) : channelId;
        const videoUrl    = `https://www.youtube.com/watch?v=${videoId}`;

        info(`[WebSub] Push diterima: "${title}" (${videoId}) ch=${channelId}`);

        // Cari semua guild yang memantau channel ini
        for (const guild of this.client.guilds.cache.values()) {
            const raw = db.get(`youtube-channels-${guild.id}`);
            if (!raw) continue;
            let channels;
            try { channels = JSON.parse(raw); } catch { continue; }

            const ytCh = channels.find(c => c.id === channelId);
            if (!ytCh) continue;

            const lastKey = `youtube-lastVideo-${guild.id}-${channelId}`;
            if (db.get(lastKey) === videoId) continue; // sudah diproses
            db.set(lastKey, videoId);

            let type = 'video';
            const isShort = await this._isShort(videoId);
            if (isShort) {
                type = 'short';
            } else if (ytCh.liveEnabled) {
                const isLive = await this._isLive(videoId);
                if (isLive) type = 'live';
            }

            info(`[WebSub] ${type.toUpperCase()} | ${title} → guild ${guild.name}`);

            await this._sendNotification(guild, ytCh, type, {
                videoId, url: videoUrl, title,
                channel:   ytCh.name || channelName,
                thumbnail,
            }).catch(err => warn(`[WebSub] Kirim notif gagal: ${err.message}`));
        }
    }

    async _hubRequest(channelId, mode) {
        const callbackUrl = `${this._baseUrl}/webhook/youtube`;
        const topic       = `${TOPIC_BASE}${channelId}`;

        const params = new URLSearchParams({
            'hub.callback':      callbackUrl,
            'hub.topic':         topic,
            'hub.mode':          mode,
            'hub.verify':        'async',
            'hub.lease_seconds': String(LEASE_SECONDS),
        });
        if (this._secret) params.set('hub.secret', this._secret);

        try {
            const res = await fetch(HUB_URL, {
                method:  'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body:    params.toString(),
                signal:  AbortSignal.timeout(15_000),
            });

            if (res.status === 202) {
                const db = this.client.database;
                if (db && mode === 'subscribe') {
                    const meta = this._getSubMeta(db, channelId);
                    meta.status      = 'pending';
                    meta.requestedAt = Date.now();
                    db.set(`youtube-websub-${channelId}`, JSON.stringify(meta));
                }
                info(`[WebSub] ${mode} request dikirim untuk channel ${channelId}`);
                return true;
            }
            warn(`[WebSub] Hub menolak ${mode} untuk ${channelId}: HTTP ${res.status}`);
            return false;
        } catch (err) {
            warn(`[WebSub] ${mode} gagal untuk ${channelId}: ${err.message}`);
            return false;
        }
    }

    async _subscribeAll() {
        const db = this.client.database;
        if (!db) return;

        const channelIds = this._getAllTrackedChannelIds(db);
        for (const id of channelIds) {
            const meta = this._getSubMeta(db, id);
            if (meta.status !== 'active' && meta.status !== 'pending') {
                await this.subscribe(id).catch(() => {});
                await new Promise(r => setTimeout(r, 500)); // hindari rate limit hub
            }
        }
    }

    async _renewSubscriptions() {
        const db = this.client.database;
        if (!db) return;

        const channelIds = this._getAllTrackedChannelIds(db);
        for (const id of channelIds) {
            const meta = this._getSubMeta(db, id);
            const needsRenew = meta.status !== 'active'
                || !meta.expiresAt
                || (meta.expiresAt - Date.now()) < RENEW_BEFORE_MS;

            if (needsRenew) {
                info(`[WebSub] Memperbarui subscription: ${id}`);
                await this.subscribe(id).catch(() => {});
                await new Promise(r => setTimeout(r, 500));
            }
        }
    }

    _getAllTrackedChannelIds(db) {
        const ids = new Set();
        for (const guild of this.client.guilds.cache.values()) {
            const raw = db.get(`youtube-channels-${guild.id}`);
            if (!raw) continue;
            try { JSON.parse(raw).forEach(c => ids.add(c.id)); } catch { /* noop */ }
        }
        return ids;
    }

    _getSubMeta(db, channelId) {
        if (!db) return { status: 'unknown' };
        try { return JSON.parse(db.get(`youtube-websub-${channelId}`) || '{}'); }
        catch { return { status: 'unknown' }; }
    }

    // ─── RSS Polling (fallback / primary tanpa WebSub) ─────────────────────────

    async _poll() {
        const db = this.client.database;
        if (!db) return;
        for (const guild of this.client.guilds.cache.values()) {
            this._pollGuild(guild, db).catch(err =>
                warn(`[YouTube] Poll error guild ${guild.id}: ${err.message}`)
            );
        }
    }

    async _pollGuild(guild, db) {
        const raw = db.get(`youtube-channels-${guild.id}`);
        if (!raw) return;
        let channels;
        try { channels = JSON.parse(raw); } catch { return; }
        if (!Array.isArray(channels) || channels.length === 0) return;
        for (const ytCh of channels) {
            await this._checkChannel(guild, db, ytCh).catch(err =>
                warn(`[YouTube] Check error ${ytCh.name}: ${err.message}`)
            );
        }
    }

    async _checkChannel(guild, db, ytCh) {
        const rssRes = await fetch(`${RSS_BASE}${ytCh.id}`, {
            signal:  AbortSignal.timeout(10_000),
            headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
        });
        if (!rssRes.ok) {
            warn(`[YouTube] RSS gagal untuk ${ytCh.name}: HTTP ${rssRes.status}`);
            return;
        }

        const entries = this._parseRssEntries(await rssRes.text());
        if (entries.length === 0) return;

        const lastKey  = `youtube-lastVideo-${guild.id}-${ytCh.id}`;
        const lastId   = db.get(lastKey);
        const latestId = entries[0].id;

        if (!lastId) { db.set(lastKey, latestId); return; }
        if (lastId === latestId) return;

        const lastIdx = entries.findIndex(e => e.id === lastId);
        const newEntries = lastIdx === -1 ? entries.slice(0, 3) : entries.slice(0, lastIdx);

        db.set(lastKey, latestId);
        for (const entry of [...newEntries].reverse()) {
            await this._processVideo(guild, ytCh, entry).catch(err =>
                warn(`[YouTube] Process error ${entry.id}: ${err.message}`)
            );
        }
    }

    async _processVideo(guild, ytCh, entry) {
        const title     = entry.title   || 'Video Baru';
        const channel   = entry.channel || ytCh.name;
        const videoUrl  = `https://www.youtube.com/watch?v=${entry.id}`;
        const thumbnail = entry.thumbnail || `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`;

        let type = 'video';
        const isShort = await this._isShort(entry.id);
        if (isShort) {
            type = 'short';
        } else if (ytCh.liveEnabled) {
            const isLive = await this._isLive(entry.id);
            if (isLive) type = 'live';
        }

        info(`[YouTube/RSS] ${type.toUpperCase()} | ${title} → guild ${guild.name}`);
        await this._sendNotification(guild, ytCh, type, {
            videoId: entry.id, url: videoUrl, title, channel, thumbnail,
        });
    }

    // ─── Detection helpers ─────────────────────────────────────────────────────

    async _isShort(videoId) {
        try {
            const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
                signal: AbortSignal.timeout(8_000), redirect: 'follow',
                headers: { 'User-Agent': 'Mozilla/5.0' },
            });
            return res.url.includes('/shorts/');
        } catch { return false; }
    }

    async _isLive(videoId) {
        try {
            const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
                signal: AbortSignal.timeout(8_000), headers: BROWSER_HEADERS,
            });
            if (!res.ok) return false;
            const html = await res.text();
            return html.includes('"isLiveContent":true')
                || html.includes('"isLive":true')
                || html.includes('"liveBroadcastDetails"');
        } catch { return false; }
    }

    // ─── Notification ──────────────────────────────────────────────────────────

    async _sendNotification(guild, ytCh, type, data) {
        const map = {
            video: { flag: 'videoEnabled', ch: 'videoChannelId', msg: 'videoMessage' },
            short: { flag: 'shortEnabled', ch: 'shortChannelId', msg: 'shortMessage' },
            live:  { flag: 'liveEnabled',  ch: 'liveChannelId',  msg: 'liveMessage'  },
        };
        const cfg = map[type];
        if (!ytCh[cfg.flag] || !ytCh[cfg.ch]) return;

        const discordCh = guild.channels.cache.get(ytCh[cfg.ch]);
        if (!discordCh) return;

        const fill = s => (s || '')
            .replace(/{channel}/g, data.channel)
            .replace(/{title}/g,   data.title)
            .replace(/{url}/g,     data.url)
            .replace(/{id}/g,      data.videoId);

        const titles = {
            video: `📹 ${data.channel} — Video Baru!`,
            short: `🎬 ${data.channel} — Short Baru!`,
            live:  `🔴 ${data.channel} is Live Now!`,
        };
        const fields = { video: 'Judul Video', short: 'Judul Short', live: 'Streaming Title' };
        const colors = { video: 0xFF0000, short: 0xFF6B35, live: 0xCC0000 };

        const customMsg = fill(ytCh[cfg.msg]).trim();

        const embed = new EmbedBuilder()
            .setColor(colors[type])
            .setTitle(titles[type])
            .setURL(`https://www.youtube.com/channel/${ytCh.id}`)
            .setTimestamp();

        if (customMsg)      embed.setDescription(customMsg);
        if (ytCh.thumbnail) embed.setThumbnail(ytCh.thumbnail);

        embed.addFields(
            { name: fields[type], value: `[${data.title}](${data.url})`, inline: false },
            { name: 'Link',       value: `[Tonton sekarang](${data.url})`, inline: false },
        );
        if (data.thumbnail) embed.setImage(data.thumbnail);

        await discordCh.send({ embeds: [embed] }).catch(err =>
            warn(`[YouTube] Kirim notif gagal: ${err.message}`)
        );
    }

    // ─── RSS Parsing ───────────────────────────────────────────────────────────

    _parseRssEntries(xml) {
        const entries = [];
        const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
        let em;
        while ((em = entryRe.exec(xml)) !== null) {
            const block  = em[1];
            const idM    = block.match(/<yt:videoId>([\w-]+)<\/yt:videoId>/);
            const titleM = block.match(/<media:title>([\s\S]*?)<\/media:title>/)
                        || block.match(/<title>([\s\S]*?)<\/title>/);
            const chM    = block.match(/<name>([\s\S]*?)<\/name>/);
            const thumbM = block.match(/url="(https:\/\/i\d*\.ytimg\.com\/vi\/[\w-]+\/[^"]+)"/);
            if (!idM) continue;
            entries.push({
                id:        idM[1],
                title:     titleM ? this._decodeXml(titleM[1]) : '',
                channel:   chM    ? this._decodeXml(chM[1])    : '',
                thumbnail: thumbM ? thumbM[1] : null,
            });
        }
        return entries;
    }

    _decodeXml(s) {
        return (s || '')
            .replace(/&amp;/g,  '&')
            .replace(/&lt;/g,   '<')
            .replace(/&gt;/g,   '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g,  "'")
            .trim();
    }
}

module.exports = YouTubeNotifier;

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

// Live stream poll terpisah setiap 3 menit (lebih andal dari WebSub untuk live)
const LIVE_POLL_INTERVAL_MS = 3 * 60 * 1000;

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
        this._liveTimer  = null;
        this._renewTimer = null;

        this._secret   = process.env.YOUTUBE_WEBSUB_SECRET || '';
        this._baseUrl  = (process.env.BASE_URL || '').replace(/\/$/, '');
        this._useWebSub = !!this._baseUrl;
        this._apiKey   = process.env.YOUTUBE_API_KEY || '';
        // Cache hasil _isLive() selama 2 menit — cegah duplikat call antar guild untuk videoId sama
        this._liveCache = new Map(); // videoId → { result, expiresAt }
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    start() {
        if (this._apiKey) {
            info('[YouTube] YouTube Data API v3 aktif — deteksi live lebih akurat.');
        } else {
            warn('[YouTube] YOUTUBE_API_KEY tidak di-set — menggunakan InnerTube (kurang akurat). Set YOUTUBE_API_KEY di .env.');
        }

        if (this._useWebSub) {
            info('[YouTube] WebSub aktif (notifikasi instan) + RSS fallback 30 menit + live poll 3 menit.');
            setTimeout(() => this._subscribeAll(), 5_000);
            this._renewTimer = setInterval(() => this._renewSubscriptions(), RENEW_INTERVAL_MS);
        } else {
            warn('[YouTube] BASE_URL tidak di-set — RSS polling 5 menit + live poll 3 menit. Set BASE_URL di .env untuk aktifkan WebSub.');
        }

        // RSS fallback / primary
        const pollMs = this._useWebSub ? POLL_INTERVAL_WEBSUB : POLL_INTERVAL_RSS;
        setTimeout(() => {
            this._poll();
            this._pollTimer = setInterval(() => this._poll(), pollMs);
        }, 30_000);

        // Seed segera di T+30s (dalam startup window) agar stream yang sudah live saat restart
        // langsung ter-mark, tidak perlu tunggu interval pertama di T+3 yang bisa terlewat window
        setTimeout(() => this._pollLive(), 30_000);
        this._liveTimer = setInterval(() => this._pollLive(), LIVE_POLL_INTERVAL_MS);
    }

    stop() {
        if (this._pollTimer)  clearInterval(this._pollTimer);
        if (this._liveTimer)  clearInterval(this._liveTimer);
        if (this._renewTimer) clearInterval(this._renewTimer);
        this._pollTimer = this._liveTimer = this._renewTimer = null;
    }

    // Force poll untuk satu guild (dipanggil dari API)
    async pollGuild(guildId) {
        const db    = this.client.database;
        const guild = this.client.guilds.cache.get(guildId);
        if (!db || !guild) return;
        await this._pollGuild(guild, db);
    }

    // ─── Channel Lookup ────────────────────────────────────────────────────────

    async lookupChannel(input) {
        const url = this._resolveChannelUrl(input);
        const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: BROWSER_HEADERS });
        if (!res.ok) throw new Error(`HTTP ${res.status} while fetching channel page`);
        const html = await res.text();

        // externalId selalu milik channel halaman ini — paling andal
        // "channelId" bisa muncul dari konten lain di halaman (rekomendasi, dsb.)
        const idMatch = html.match(/"externalId"\s*:\s*"(UC[\w-]+)"/)
                     || html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']*\/channel\/(UC[\w-]+)/i)
                     || html.match(/<link[^>]+href=["'][^"']*\/channel\/(UC[\w-]+)[^"']*["'][^>]+rel=["']canonical["']/i)
                     || html.match(/"channelId"\s*:\s*"(UC[\w-]+)"/)
                     || html.match(/channel\/(UC[\w-]{22})/);
        if (!idMatch) throw new Error('Channel not found. Try using the Channel ID (UCxxxxxx) directly.');
        const id = idMatch[1];

        const nameMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
                       || html.match(/<title>([^<]+)<\/title>/i);
        const name = nameMatch ? this._decodeXml(nameMatch[1]).replace(/\s*[-–|]\s*YouTube\s*$/i, '').trim() : input;

        const thumbMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
        const thumbnail  = thumbMatch ? thumbMatch[1] : null;

        // Coba ambil handle (@username) dari halaman
        const handleMatch = html.match(/"canonicalBaseUrl"\s*:\s*"\/\@([\w.-]+)"/)
                         || html.match(/youtube\.com\/@([\w.-]+)(?:\/|")/);
        const handle = handleMatch ? '@' + handleMatch[1] : null;

        return { id, name, thumbnail, handle };
    }

    _resolveChannelUrl(input) {
        const s = input.trim();
        if (/^UC[\w-]{22}$/.test(s))  return `https://www.youtube.com/channel/${s}`;
        if (/^https?:\/\//.test(s))   return s;
        if (/youtube\.com/.test(s))   return `https://${s}`;
        const handle = s.startsWith('@') ? s : `@${s}`;
        return `https://www.youtube.com/${handle}`;
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
        info(`[WebSub] Subscription active: ${channelId}`);
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
        const title       = titleM       ? this._decodeXml(titleM[1])       : 'New Video';
        const thumbnail   = thumbM       ? thumbM[1]
                           : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        const channelName = channelNameM ? this._decodeXml(channelNameM[1]) : channelId;
        const videoUrl    = `https://www.youtube.com/watch?v=${videoId}`;

        info(`[WebSub] Push received: "${title}" (${videoId}) ch=${channelId} — waiting 30 seconds for thumbnail to be ready...`);

        // YouTube butuh waktu generate thumbnail setelah upload.
        // WebSub push datang sangat cepat, tunggu sebentar agar thumbnail tersedia.
        await new Promise(r => setTimeout(r, 30_000));

        // Cek live LEBIH DULU agar live short tidak salah terdeteksi sebagai short biasa
        let type = 'video';
        const liveInfo = await this._isLive(videoId);
        if (liveInfo.isUpcoming) {
            info(`[WebSub] ${videoId} is still upcoming/waiting room, skipping`);
            return;
        }
        if (liveInfo.isLiveContent && !liveInfo.live) {
            info(`[WebSub] ${videoId} is live content but not yet live (API delay), skipping — live poll will handle`);
            return;
        }
        if (liveInfo.channelId && liveInfo.channelId !== channelId) {
            warn(`[WebSub] Video ${videoId} does not belong to channel ${channelId} (actual: ${liveInfo.channelId}), skipping`);
            return;
        }
        if (liveInfo.live) {
            type = 'live';
        } else {
            // Bukan live content — baru cek apakah short
            const isShort = await this._isShort(videoId);
            if (isShort) type = 'short';
        }

        // Untuk short, gunakan URL format /shorts/ agar terbuka di Shorts player
        const finalUrl = type === 'short'
            ? `https://www.youtube.com/shorts/${videoId}`
            : videoUrl;

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

            info(`[WebSub] ${type.toUpperCase()} | ${title} → guild ${guild.name}`);

            // Jika live, cek dulu apakah sudah pernah dikirim (cegah double dari live poll)
            if (type === 'live') {
                const notifKey = `youtube-liveNotified-${guild.id}-${videoId}`;
                if (db.get(notifKey)) continue;
                db.set(notifKey, String(Date.now()));
            }

            await this._sendNotification(guild, ytCh, type, {
                videoId, url: finalUrl, title,
                channel:   ytCh.name,
                thumbnail,
            }).catch(err => warn(`[WebSub] Failed to send notification: ${err.message}`));
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
                info(`[WebSub] ${mode} request sent for channel ${channelId}`);
                return true;
            }
            warn(`[WebSub] Hub rejected ${mode} for ${channelId}: HTTP ${res.status}`);
            return false;
        } catch (err) {
            warn(`[WebSub] ${mode} failed for ${channelId}: ${err.message}`);
            return false;
        }
    }

    async _subscribeAll() {
        const db = this.client.database;
        if (!db) return;

        const channelIds = this._getAllTrackedChannelIds(db);
        for (const id of channelIds) {
            const meta      = this._getSubMeta(db, id);
            const isExpired = meta.expiresAt && meta.expiresAt < Date.now();
            const needsSub  = (meta.status !== 'active' && meta.status !== 'pending') || isExpired;
            if (needsSub) {
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
            warn(`[YouTube] RSS failed for ${ytCh.name}: HTTP ${rssRes.status}`);
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
        const db        = this.client.database;

        // Cek live LEBIH DULU agar live short tidak salah terdeteksi sebagai short biasa
        let type = 'video';
        const liveInfo = await this._isLive(entry.id);
        if (liveInfo.isUpcoming) return;
        if (liveInfo.isLiveContent && !liveInfo.live) return;
        if (liveInfo.live) {
            type = 'live';
        } else {
            // Bukan live content — baru cek apakah short
            const isShort = await this._isShort(entry.id);
            if (isShort) type = 'short';
        }

        // Untuk short, gunakan URL format /shorts/
        const finalUrl = type === 'short'
            ? `https://www.youtube.com/shorts/${entry.id}`
            : videoUrl;

        // Cegah double notifikasi live dari _checkLive + RSS poll
        if (type === 'live' && db) {
            const notifKey = `youtube-liveNotified-${guild.id}-${entry.id}`;
            if (db.get(notifKey)) return;
            db.set(notifKey, String(Date.now()));
        }

        info(`[YouTube/RSS] ${type.toUpperCase()} | ${title} → guild ${guild.name}`);
        await this._sendNotification(guild, ytCh, type, {
            videoId: entry.id, url: finalUrl, title, channel, thumbnail,
        });
    }

    // ─── Detection helpers ─────────────────────────────────────────────────────

    async _isShort(videoId) {
        try {
            const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
                signal: AbortSignal.timeout(8_000), redirect: 'follow',
                headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] },
            });
            // YouTube redirect ke /watch?v= jika bukan Short
            return res.url.includes('/shorts/');
        } catch { return false; }
    }

    // Mengembalikan { live: boolean, isUpcoming: boolean, isLiveContent: boolean, channelId: string|null }
    async _isLive(videoId) {
        // Cek cache dulu — cegah duplikat call antar guild untuk videoId yang sama
        const cached = this._liveCache.get(videoId);
        if (cached && cached.expiresAt > Date.now()) return cached.result;

        let result;
        // Primary: YouTube Data API v3 (resmi, akurat, 1 unit quota per call)
        if (this._apiKey) {
            try {
                result = await this._isLiveViaAPI(videoId);
            } catch (err) {
                warn(`[YouTube] API v3 error untuk ${videoId}: ${err.message} — fallback ke InnerTube`);
            }
        }
        // Fallback: InnerTube (tidak resmi, tidak butuh key)
        if (!result) result = await this._isLiveViaInnerTube(videoId);

        // Simpan ke cache — TTL 2 menit (sedikit kurang dari interval live poll 3 menit)
        this._liveCache.set(videoId, { result, expiresAt: Date.now() + 2 * 60 * 1000 });
        // Bersihkan entry cache yang sudah expired agar tidak membengkak
        if (this._liveCache.size > 100) {
            const now = Date.now();
            for (const [key, val] of this._liveCache) {
                if (val.expiresAt <= now) this._liveCache.delete(key);
            }
        }
        return result;
    }

    async _isLiveViaAPI(videoId) {
        const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(this._apiKey)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

        if (res.status === 403) {
            const body = await res.json().catch(() => ({}));
            // Quota habis → throw agar fallback ke InnerTube, tapi warn lebih spesifik
            if (body?.error?.errors?.[0]?.reason === 'quotaExceeded') {
                warn('[YouTube] API v3 quota habis hari ini — fallback ke InnerTube sampai besok.');
            }
            throw new Error(`HTTP 403: ${body?.error?.message || 'Forbidden'}`);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (data.error) throw new Error(data.error.message);

        const item      = data.items?.[0];
        if (!item) return { live: false, isUpcoming: false, isLiveContent: false, channelId: null };

        const lbc            = item.snippet?.liveBroadcastContent; // "live" | "upcoming" | "none"
        const channelId      = item.snippet?.channelId || null;
        const hasActualStart = !!item.liveStreamingDetails?.actualStartTime;
        const hasActualEnd   = !!item.liveStreamingDetails?.actualEndTime;

        // "live" = sedang siaran sekarang
        if (lbc === 'live') {
            return { live: true, isUpcoming: false, isLiveContent: true, channelId };
        }
        // actualStartTime ada tapi lbc belum update = stream sudah dimulai
        // actualEndTime ada = stream sudah berakhir, jangan kirim notif
        if (hasActualStart && !hasActualEnd && lbc !== 'upcoming') {
            return { live: true, isUpcoming: false, isLiveContent: true, channelId };
        }
        // "upcoming" = waiting room / scheduled
        if (lbc === 'upcoming') {
            return { live: false, isUpcoming: true, isLiveContent: true, channelId };
        }
        // liveStreamingDetails ada tapi belum live = live content, API delay
        if (item.liveStreamingDetails) {
            return { live: false, isUpcoming: false, isLiveContent: true, channelId };
        }
        // Video biasa
        return { live: false, isUpcoming: false, isLiveContent: false, channelId };
    }

    async _isLiveViaInnerTube(videoId) {
        // InnerTube API — tidak resmi, tidak butuh key
        try {
            const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
                method: 'POST',
                headers: {
                    'Content-Type':             'application/json',
                    'User-Agent':               BROWSER_HEADERS['User-Agent'],
                    'X-Youtube-Client-Name':    '1',
                    'X-Youtube-Client-Version': '2.20231121.09.00',
                    'Origin':                   'https://www.youtube.com',
                },
                body: JSON.stringify({
                    videoId,
                    context: { client: { clientName: 'WEB', clientVersion: '2.20231121.09.00', hl: 'en', gl: 'US' } },
                }),
                signal: AbortSignal.timeout(10_000),
            });

            if (res.ok) {
                const data          = await res.json();
                const details       = data?.videoDetails;
                const channelId     = details?.channelId || null;
                const isLiveContent = details?.isLiveContent === true;
                const isUpcoming    = details?.isUpcoming === true;
                const hasDashUrl    = !!data?.streamingData?.dashManifestUrl;

                if (details?.isLive === true) {
                    return { live: true, isUpcoming: false, isLiveContent: true, channelId };
                }
                if (isLiveContent && hasDashUrl) {
                    return { live: true, isUpcoming: false, isLiveContent: true, channelId };
                }
                if (isUpcoming) {
                    return { live: false, isUpcoming: true, isLiveContent: true, channelId };
                }
                return { live: false, isUpcoming: false, isLiveContent, channelId };
            }
        } catch { /* jatuh ke scrape */ }

        // Last resort: scrape halaman watch
        try {
            const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
                signal: AbortSignal.timeout(10_000), headers: BROWSER_HEADERS,
            });
            if (!res.ok) return { live: false, isUpcoming: false, isLiveContent: false, channelId: null };
            const html = await res.text();

            if (html.includes('"isUpcoming":true'))     return { live: false, isUpcoming: true,  isLiveContent: true,  channelId: null };
            if (html.includes('"isLive":true'))         return { live: true,  isUpcoming: false, isLiveContent: true,  channelId: null };
            if (html.includes('"isLiveNow":true'))      return { live: true,  isUpcoming: false, isLiveContent: true,  channelId: null };
            if (html.includes('"isLiveContent":true'))  return { live: false, isUpcoming: false, isLiveContent: true,  channelId: null };
            return { live: false, isUpcoming: false, isLiveContent: false, channelId: null };
        } catch { return { live: false, isUpcoming: false, isLiveContent: false, channelId: null }; }
    }

    // ─── Live-stream dedicated poll ────────────────────────────────────────────

    async _pollLive() {
        const db = this.client.database;
        if (!db) return;
        for (const guild of this.client.guilds.cache.values()) {
            this._pollGuildLive(guild, db).catch(err =>
                warn(`[YouTube/Live] Poll error guild ${guild.id}: ${err.message}`)
            );
        }
    }

    async _pollGuildLive(guild, db) {
        const raw = db.get(`youtube-channels-${guild.id}`);
        if (!raw) return;
        let channels;
        try { channels = JSON.parse(raw); } catch { return; }

        // Hanya channel yang aktifkan notif live
        const liveChannels = channels.filter(c => c.liveEnabled && c.liveChannelId);
        if (liveChannels.length === 0) return;

        for (const ytCh of liveChannels) {
            await this._checkLive(guild, db, ytCh).catch(err =>
                warn(`[YouTube/Live] Check error ${ytCh.name}: ${err.message}`)
            );
        }
    }

    async _checkLive(guild, db, ytCh) {
        const rssRes = await fetch(`${RSS_BASE}${ytCh.id}`, {
            signal:  AbortSignal.timeout(10_000),
            headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
        });
        if (!rssRes.ok) return;

        const entries = this._parseRssEntries(await rssRes.text());
        // Cek 5 video terbaru — antisipasi jika ada beberapa video diupload setelah stream dimulai
        const recent = entries.slice(0, 5);

        for (const entry of recent) {
            const notifKey = `youtube-liveNotified-${guild.id}-${entry.id}`;
            if (db.get(notifKey)) continue; // sudah pernah kirim notif live untuk video ini

            const liveInfo = await this._isLive(entry.id);
            if (!liveInfo.live) continue;

            // Verifikasi video memang milik channel yang dipantau (cegah cross-channel notification)
            if (liveInfo.channelId && liveInfo.channelId !== ytCh.id) {
                warn(`[YouTube/Live] Video ${entry.id} does not belong to channel ${ytCh.id} (actual: ${liveInfo.channelId}), skipping`);
                continue;
            }

            // Tandai dulu sebelum kirim (hindari double-send jika poll overlap)
            db.set(notifKey, String(Date.now()));

            const videoUrl  = `https://www.youtube.com/watch?v=${entry.id}`;
            const thumbnail = entry.thumbnail || `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`;

            info(`[YouTube/Live] LIVE terdeteksi | ${entry.title} → guild ${guild.name}`);

            await this._sendNotification(guild, ytCh, 'live', {
                videoId:   entry.id,
                url:       videoUrl,
                title:     entry.title || 'Live Stream',
                channel:   ytCh.name,
                thumbnail,
            }).catch(err => warn(`[YouTube/Live] Failed to send notification: ${err.message}`));
        }

        // Bersihkan notifKey yang sudah > 48 jam untuk cegah bloat DB
        for (const entry of entries) {
            const notifKey = `youtube-liveNotified-${guild.id}-${entry.id}`;
            const ts = parseInt(db.get(notifKey) || '0', 10);
            if (ts && Date.now() - ts > 7 * 24 * 60 * 60 * 1000) {
                db.delete(notifKey);
            }
        }
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
            video: `📹 ${data.channel} — New Video!`,
            short: `🎬 ${data.channel} — New Short!`,
            live:  `🔴 ${data.channel} is Live Right Now!`,
        };
        const fields = { video: '🎬 Video Title', short: '🎬 Short Title', live: '🎙️ Stream Title' };
        const colors = { video: 0xFF0000, short: 0xFF6B35, live: 0xCC0000 };

        // Default description menarik jika user tidak isi pesan tambahan
        const defaultDescs = {
            video: `Hey, **${data.channel}** just uploaded a new video on YouTube!\nDon't miss it, watch now! 🎉`,
            short: `**${data.channel}** just posted a new Short!\nCheck out their quick video, don't miss out! ⚡`,
            live:  `Hey, **${data.channel}** is **LIVE** on YouTube right now!\nCome join and watch the stream~ 🎉`,
        };

        const customMsg = fill(ytCh[cfg.msg]).trim();
        const description = customMsg || defaultDescs[type];

        const embed = new EmbedBuilder()
            .setColor(colors[type])
            .setTitle(titles[type])
            .setURL(data.url)
            .setDescription(description);

        if (ytCh.thumbnail) embed.setThumbnail(ytCh.thumbnail);

        embed.addFields(
            { name: fields[type], value: `[${data.title}](${data.url})`, inline: false },
            { name: '🔗 Link',    value: `[Click Me ▶](${data.url})`, inline: false },
        );
        if (data.thumbnail) embed.setImage(data.thumbnail);

        await discordCh.send({ embeds: [embed] }).catch(err =>
            warn(`[YouTube] Failed to send notification: ${err.message}`)
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

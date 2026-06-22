'use strict';

const { warn, info } = require('./Console');
const { EmbedBuilder } = require('discord.js');
const { execFile } = require('child_process');

// Graceful import — live detection opsional (butuh npm install tiktok-live-connector)
let WebcastPushConnection = null;
try {
    ({ WebcastPushConnection } = require('tiktok-live-connector'));
} catch {
    // Package tidak terinstall — hanya video polling yang aktif
}

const POLL_INTERVAL_MS         = 5 * 60 * 1000;   // Video: 5 menit via yt-dlp
const LIVE_POLL_INTERVAL_MS    = 60 * 1000;        // Live: 1 menit via WebSocket
const LIVE_CACHE_MS            = 30 * 1000;        // Cache per-username antar guild (harus < LIVE_POLL_INTERVAL_MS)
const HEALTH_INTERVAL_MS       = 30 * 60 * 1000;  // Health check: 30 menit
const HEALTH_FAIL_THRESHOLD    = 3;               // Alert setelah 3x gagal berturut-turut
const LIVE_FAIL_THRESHOLD      = 10;              // ~10 menit offline sebelum live dianggap benar-benar berakhir
const LIVE_NOTIF_COOLDOWN_MS   = 2 * 60 * 60 * 1000; // Cooldown 2 jam antar notif live
const AVATAR_CHECK_INTERVAL_MS = 60 * 60 * 1000;     // Cek avatar basi tiap 1 jam
const AVATAR_STALE_MS          = 24 * 60 * 60 * 1000; // Avatar dianggap basi setelah 24 jam
const VALIDITY_CHECK_INTERVAL_MS = 15 * 60 * 1000;   // Cek validitas username tiap 15 menit
const ACCOUNT_FAIL_THRESHOLD     = 4;                // ~1 jam gagal berturut-turut → tandai bermasalah

const YTDLP_BIN        = process.env.YTDLP_BIN || 'yt-dlp';
const YTDLP_TIMEOUT_MS = 20_000;

class TikTokNotifier {
    constructor(client) {
        this.client        = client;
        this._pollTimer    = null;
        this._liveTimer    = null;
        this._healthTimer  = null;
        this._avatarTimer  = null;
        this._validityTimer = null;
        this._isLiveCache   = new Map(); // username → { result, expiresAt }
        this._tikwmBackoff  = null;      // timestamp sampai kapan tikwm di-skip
        this._pollErrorCache = new Map(); // username → expiresAt (skip sementara setelah poll gagal)
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    start() {
        if (WebcastPushConnection) {
            this._liveTimer = setInterval(() => this._pollLive(), LIVE_POLL_INTERVAL_MS);
        } else {
            warn('[TikTok] tiktok-live-connector not found — live detection disabled. Jalankan: npm install tiktok-live-connector');
        }

        setTimeout(() => {
            this._poll();
            this._pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
        }, 35_000);

        setTimeout(() => {
            this._checkHealth();
            this._healthTimer = setInterval(() => this._checkHealth(), HEALTH_INTERVAL_MS);
        }, 5 * 60 * 1000);

        // Avatar TikTok punya URL signed yang expired ~2 hari — refresh saat ada
        // video/live baru itu opportunistic (gratis), ini fallback supaya akun yang
        // jarang post/live tidak pernah broken image lebih dari 24 jam.
        setTimeout(() => {
            this._refreshStaleAvatars();
            this._avatarTimer = setInterval(() => this._refreshStaleAvatars(), AVATAR_CHECK_INTERVAL_MS);
        }, 10 * 60 * 1000);

        // Deteksi username yang sudah tidak valid (akun ganti nama/dihapus) —
        // setelah gagal berturut-turut, nonaktifkan otomatis + tandai "bermasalah"
        // di dashboard, supaya tidak silent-fail selamanya.
        setTimeout(() => {
            this._checkAccountValidity();
            this._validityTimer = setInterval(() => this._checkAccountValidity(), VALIDITY_CHECK_INTERVAL_MS);
        }, 2 * 60 * 1000);
    }

    stop() {
        if (this._pollTimer)     clearInterval(this._pollTimer);
        if (this._liveTimer)     clearInterval(this._liveTimer);
        if (this._healthTimer)   clearInterval(this._healthTimer);
        if (this._validityTimer) clearInterval(this._validityTimer);
        if (this._avatarTimer)   clearInterval(this._avatarTimer);
        this._pollTimer = this._liveTimer = this._healthTimer = this._avatarTimer = this._validityTimer = null;
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

        let data;
        try {
            data = await this._fetchVideos(username, 1);
        } catch (err) {
            throw new Error(this._humanizeYtdlpError(username, err.message));
        }

        if (data.entries.length === 0) {
            throw new Error(`Akun "${username}" tidak ditemukan atau tidak memiliki video publik.`);
        }

        let name      = data.channelName || username;
        let thumbnail = null; // hanya pakai avatar profil dari tikwm, bukan cover video

        // Coba dapat avatar + nama asli via tikwm.com — tidak fatal kalau gagal
        // Kalau gagal, thumbnail tetap null dan _refreshStaleAvatars akan isi dalam ~10 menit
        const profile = await this._fetchProfileTikwm(username).catch(() => null);
        if (profile?.avatar) thumbnail = profile.avatar;
        if (profile?.name)   name      = profile.name;

        return { username, name, thumbnail };
    }

    _resolveUsername(input) {
        const s = input.trim();
        const urlMatch = s.match(/tiktok\.com\/@?([\w.]+)/i);
        if (urlMatch) return '@' + urlMatch[1];
        if (s.startsWith('@')) return s;
        return '@' + s;
    }

    // Ambil avatar + nickname terbaru sekaligus dalam satu request (data sama,
    // tidak ada biaya tambahan untuk sertakan nama juga).
    async _fetchProfileTikwm(username) {
        const cleanUser = username.replace(/^@/, '');
        const res = await fetch(`https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(cleanUser)}`, {
            signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) return null;
        const json = await res.json();
        if (json.code !== 0) return null;
        const user = json.data?.user;
        if (!user) return null;
        return {
            avatar: user.avatarLarger || user.avatarMedium || null,
            name:   user.nickname || null,
        };
    }

    async _fetchVideosTikwm(username, limit = 5) {
        const cleanUser = username.replace(/^@/, '');
        const res = await fetch(
            `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(cleanUser)}&count=${limit}&cursor=0`,
            { signal: AbortSignal.timeout(8_000) }
        );
        if (!res.ok) throw new Error(`tikwm HTTP ${res.status}`);
        const json = await res.json();
        if (json.code !== 0) throw new Error(`tikwm: ${json.msg || json.code}`);
        const videos = json.data?.videos;
        if (!Array.isArray(videos)) throw new Error('tikwm: format tidak dikenal');

        return {
            entries: videos.slice(0, limit).map(v => ({
                id:        String(v.video_id || v.id || ''),
                url:       `https://www.tiktok.com/@${cleanUser}/video/${v.video_id || v.id}`,
                title:     v.title || '(tanpa judul)',
                thumbnail: v.origin_cover || v.cover || null,
            })).filter(e => e.id),
            channelName: null,
        };
    }

    _humanizeYtdlpError(username, rawMsg) {
        const msg = rawMsg || '';
        if (/Unable to extract secondary user ID/i.test(msg)) {
            return `Akun "${username}" tidak ditemukan, dinonaktifkan, atau private. Pastikan username benar dan akun bersifat publik.`;
        }
        if (/timed? ?out/i.test(msg)) {
            return `Timeout saat mengambil data "${username}" dari TikTok. Coba lagi beberapa saat.`;
        }
        if (/command not found|ENOENT/i.test(msg)) {
            return 'yt-dlp tidak ditemukan di server. Hubungi admin untuk install ulang (pip install -U yt-dlp).';
        }
        return `Gagal mengambil data TikTok untuk "${username}": ${msg.split('\n')[0].slice(0, 200)}`;
    }

    // ─── yt-dlp Helper ─────────────────────────────────────────────────────────

    _ytdlp(args) {
        return new Promise((resolve, reject) => {
            execFile(YTDLP_BIN, args, { timeout: YTDLP_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
                if (err) {
                    const msg = (stderr || err.message || '').replace(/^ERROR:\s*\[tiktok[^\]]*\]\s*/i, '').trim();
                    return reject(new Error(msg || 'yt-dlp gagal dijalankan'));
                }
                try { resolve(JSON.parse(stdout)); }
                catch { reject(new Error('Gagal parse output yt-dlp')); }
            });
        });
    }

    async _fetchVideos(username, limit = 5) {
        // Jika tikwm sedang dalam periode backoff (kena rate limit sebelumnya), langsung pakai yt-dlp
        if (this._tikwmBackoff && Date.now() < this._tikwmBackoff) {
            return this._fetchVideosYtdlp(username, limit);
        }
        try {
            const result = await this._fetchVideosTikwm(username, limit);
            this._tikwmBackoff = null; // sukses → reset backoff
            return result;
        } catch (err) {
            const isRateLimit = /rate|limit|429/i.test(err.message);
            if (isRateLimit && !this._tikwmBackoff) {
                // Backoff 10 menit setelah kena rate limit
                this._tikwmBackoff = Date.now() + 10 * 60 * 1000;
                warn(`[TikTok] tikwm rate limit, backoff 10 menit: ${err.message}`);
            }
            // Untuk error non-rate-limit (misal "unique_id is invalid" karena username berganti),
            // tidak perlu warn — cukup fallback ke yt-dlp, outer poll handler yang akan warn jika perlu.
            return this._fetchVideosYtdlp(username, limit);
        }
    }

    async _fetchVideosYtdlp(username, limit = 5) {
        const url  = `https://www.tiktok.com/${username}`;
        const data = await this._ytdlp(['--no-warnings', '--flat-playlist', '--playlist-end', String(limit), '-J', url]);
        const rawEntries = data.entries || [];

        const entries = rawEntries.map(e => ({
            id:        e.id,
            url:       e.url || `https://www.tiktok.com/${username}/video/${e.id}`,
            title:     e.title || e.description || '(tanpa judul)',
            thumbnail: this._bestThumbnail(e.thumbnails),
        }));

        return { entries, channelName: rawEntries[0]?.channel || null };
    }

    _bestThumbnail(thumbnails) {
        if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
        const pick = thumbnails.find(t => t.id === 'originCover')
                  || thumbnails.find(t => t.id === 'cover')
                  || thumbnails[0];
        return pick?.url || null;
    }

    // ─── Video Polling ─────────────────────────────────────────────────────────

    async _poll() {
        const db = this.client.database;
        if (!db) return;

        // Deduplikasi per username — jika 3 guild pantau akun yang sama,
        // hanya 1 request RSS dibuat, hasilnya di-share ke semua guild
        const usernameMap = new Map(); // username → [{ guild, account }]
        for (const guild of this.client.guilds.cache.values()) {
            const raw = db.get(`tiktok-accounts-${guild.id}`);
            if (!raw) continue;
            let accounts;
            try { accounts = JSON.parse(raw); } catch { continue; }
            for (const acc of accounts) {
                if (!acc.videoEnabled || !acc.videoChannelId) continue;
                if (!usernameMap.has(acc.username)) usernameMap.set(acc.username, []);
                usernameMap.get(acc.username).push({ guild, account: acc });
            }
        }

        let firstPoll = true;
        for (const [username, guildEntries] of usernameMap) {
            // Skip sementara jika username ini baru saja gagal poll (username diganti / akun invalid)
            const skipUntil = this._pollErrorCache.get(username);
            if (skipUntil) {
                if (Date.now() < skipUntil) continue;
                this._pollErrorCache.delete(username);
            }

            // Delay antar request agar tidak kena rate limit tikwm (1 req/detik)
            if (!firstPoll) await new Promise(r => setTimeout(r, 1200));
            firstPoll = false;
            try {
                const { entries } = await this._fetchVideos(username, 5);
                if (entries.length === 0) continue;

                // Proses untuk setiap guild yang pantau username ini
                let profileChecked = false;
                let freshProfile   = null;
                for (const { guild, account } of guildEntries) {
                    const hasNew = await this._processEntries(guild, db, account, entries).catch(err => {
                        warn(`[TikTok] Check error ${username} guild ${guild.id}: ${err.message}`);
                        return false;
                    });
                    if (hasNew) {
                        // Ada video baru → kesempatan gratis untuk refresh avatar + nama juga.
                        // Cuma fetch tikwm sekali per username per siklus poll, dipakai bersama semua guild.
                        if (!profileChecked) {
                            profileChecked = true;
                            freshProfile = await this._fetchProfileTikwm(username).catch(() => null);
                        }
                        if (freshProfile) {
                            this._updateAccountProfile(guild, db, username, {
                                thumbnail: freshProfile.avatar,
                                name:      freshProfile.name,
                            });
                        }
                    }
                }
            } catch (err) {
                warn(`[TikTok] Poll error ${username}: ${err.message}`);
                // Jika username tidak ditemukan (diganti/dihapus), skip 30 menit agar tidak spam
                const isInvalid = /invalid|not found|secondary user id/i.test(err.message);
                if (isInvalid) {
                    this._pollErrorCache.set(username, Date.now() + 30 * 60 * 1000);
                }
            }
        }
    }

    async _processEntries(guild, db, account, entries) {
        const lastKey   = `tiktok-lastVideo-${guild.id}-${account.username}`;
        const lastId    = db.get(lastKey);
        const latestId  = entries[0].id;

        if (!lastId) { db.set(lastKey, latestId); return false; }
        if (lastId === latestId) return false;

        // Jika latestId secara numerik ≤ lastId, urutan feed berubah tapi tidak ada video baru.
        // (TikTok video ID adalah snowflake — selalu meningkat untuk konten yang lebih baru.)
        // Try-catch untuk toleransi format ID non-numerik (e.g., ID RSS lama saat migrasi).
        try { if (BigInt(latestId) <= BigInt(lastId)) return false; } catch {}

        const lastIdx    = entries.findIndex(e => e.id === lastId);
        // Jika lastId tidak ada di top-5 (video dihapus/geser dari window), hanya kirim
        // video paling baru saja — jangan spam slice(0,3) yang bisa kirim video lama.
        const newEntries = lastIdx === -1 ? [entries[0]] : entries.slice(0, lastIdx);

        db.set(lastKey, latestId);
        for (const entry of [...newEntries].reverse()) {
            await this._sendVideoNotification(guild, account, entry).catch(err =>
                warn(`[TikTok] Kirim notif video error: ${err.message}`)
            );
        }
        return true;
    }

    // ─── Avatar Refresh ────────────────────────────────────────────────────────
    // URL avatar TikTok (tikwm.com maupun live-connector) memakai signed URL yang
    // expired ~2 hari. Dipanggil opportunistic saat ada video/live baru, plus
    // fallback _refreshStaleAvatars() tiap jam untuk akun yang jarang aktif.

    // Signature/token/CDN host di URL avatar TikTok selalu berubah tiap fetch
    // walau fotonya sama persis — yang stabil cuma hash konten di path-nya
    // (contoh: tos-alisg-avt-0068/801e5804f248b1028c863ff60dc4a874~tplv-...).
    // Bandingkan hash ini, bukan URL utuh, supaya tidak salah lapor "berubah".
    _avatarContentId(url) {
        if (!url) return null;
        const m = url.match(/\/([a-f0-9]{20,40})~/i);
        return m ? m[1] : url;
    }

    // newProfile: { thumbnail?, name? } — field yang tidak diisi/null tidak akan diubah
    _updateAccountProfile(guild, db, username, newProfile) {
        if (!newProfile || (!newProfile.thumbnail && !newProfile.name)) return;
        const key = `tiktok-accounts-${guild.id}`;
        const raw = db.get(key);
        if (!raw) return;
        let accounts;
        try { accounts = JSON.parse(raw); } catch { return; }
        const idx = accounts.findIndex(a => a.username === username);
        if (idx === -1) return;

        if (newProfile.thumbnail) {
            accounts[idx].thumbnail = newProfile.thumbnail; // selalu simpan URL terbaru (signed URL lama expired)
            accounts[idx].thumbnailUpdatedAt = Date.now();
        }
        if (newProfile.name) accounts[idx].name = newProfile.name;
        db.set(key, JSON.stringify(accounts));
    }

    async _refreshStaleAvatars() {
        const db = this.client.database;
        if (!db) return;
        const now = Date.now();

        for (const guild of this.client.guilds.cache.values()) {
            const key = `tiktok-accounts-${guild.id}`;
            const raw = db.get(key);
            if (!raw) continue;
            let accounts;
            try { accounts = JSON.parse(raw); } catch { continue; }
            if (!Array.isArray(accounts) || accounts.length === 0) continue;

            let touched = false;
            for (const acc of accounts) {
                const lastUpdate = parseInt(acc.thumbnailUpdatedAt || '0', 10);
                if (now - lastUpdate < AVATAR_STALE_MS) continue;

                const profile = await this._fetchProfileTikwm(acc.username).catch(() => null);
                acc.thumbnailUpdatedAt = now; // selalu update timestamp, walau gagal — cegah retry tiap jam kalau API down
                if (profile?.avatar) acc.thumbnail = profile.avatar; // selalu simpan URL terbaru, walau foto sama
                if (profile?.name)   acc.name      = profile.name;
                touched = true;
            }
            if (touched) db.set(key, JSON.stringify(accounts));
        }
    }

    // ─── Validitas Akun ────────────────────────────────────────────────────────
    // Kalau akun TikTok ganti username atau dihapus, tiap fetch akan terus gagal
    // selamanya tanpa pemberitahuan (silent fail). Setelah gagal berturut-turut
    // (~1 jam), tandai "bermasalah" + nonaktifkan video/live supaya tidak buang
    // resource, tapi config (channel, pesan custom, dll) tetap tersimpan supaya
    // admin tinggal hapus & tambah ulang dengan username baru kalau perlu.

    async _isUsernameValid(username) {
        const cleanUser = username.replace(/^@/, '');
        try {
            const res = await fetch(`https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(cleanUser)}`, {
                signal: AbortSignal.timeout(8_000),
            });
            // tikwm sendiri error/down → jangan asumsikan akun yang rusak, anggap valid
            if (!res.ok) return true;
            const json = await res.json();
            if (json.code !== 0) {
                // Rate limit atau error server tikwm → jangan hukum akun, anggap valid
                const msg = (json.msg || '').toLowerCase();
                if (msg.includes('limit') || msg.includes('rate') || !msg) return true;
                // Akun memang tidak ditemukan
                return false;
            }
            return true;
        } catch {
            return true; // network/timeout → jangan asumsikan akun yang rusak
        }
    }

    async _checkAccountValidity() {
        const db = this.client.database;
        if (!db) return;

        for (const guild of this.client.guilds.cache.values()) {
            const key = `tiktok-accounts-${guild.id}`;
            const raw = db.get(key);
            if (!raw) continue;
            let accounts;
            try { accounts = JSON.parse(raw); } catch { continue; }
            if (!Array.isArray(accounts) || accounts.length === 0) continue;

            let touched = false;
            let firstCheck = true;
            for (const acc of accounts) {
                if (acc.broken) continue; // sudah ditandai, jangan dicoba lagi terus-menerus
                if (!acc.videoEnabled && !acc.liveEnabled) continue; // tidak aktif, tidak perlu dicek

                // Delay antar request agar tidak kena rate limit tikwm (1 req/detik)
                if (!firstCheck) await new Promise(r => setTimeout(r, 1200));
                firstCheck = false;

                const valid = await this._isUsernameValid(acc.username);
                touched = true;

                if (valid) {
                    if (acc.failCount) acc.failCount = 0;
                    continue;
                }

                acc.failCount = (acc.failCount || 0) + 1;
                if (acc.failCount >= ACCOUNT_FAIL_THRESHOLD) {
                    acc.broken        = true;
                    acc.brokenAt      = Date.now();
                    acc.videoEnabled  = false;
                    acc.liveEnabled   = false;
                    warn(`[TikTok] Akun ditandai bermasalah & dinonaktifkan otomatis: ${acc.username} → ${guild.name}`);
                }
            }
            if (touched) db.set(key, JSON.stringify(accounts));
        }
    }

    // _pollGuild sudah tidak dipakai oleh _poll, tapi dipertahankan untuk pollGuild(guildId) API
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

        let entries;
        try {
            ({ entries } = await this._fetchVideos(account.username, 5));
        } catch (err) {
            warn(`[TikTok] Fetch error ${account.username}: ${err.message}`);
            return;
        }
        if (entries.length === 0) return;

        const lastKey  = `tiktok-lastVideo-${guild.id}-${account.username}`;
        const lastId   = db.get(lastKey);
        const latestId = entries[0].id;

        if (!lastId) { db.set(lastKey, latestId); return; }
        if (lastId === latestId) return;

        try { if (BigInt(latestId) <= BigInt(lastId)) return; } catch {}

        const lastIdx   = entries.findIndex(e => e.id === lastId);
        const newEntries = lastIdx === -1 ? [entries[0]] : entries.slice(0, lastIdx);

        db.set(lastKey, latestId);
        for (const entry of [...newEntries].reverse()) {
            await this._sendVideoNotification(guild, account, entry).catch(err =>
                warn(`[TikTok] Kirim notif video error: ${err.message}`)
            );
        }
    }

    // ─── Live Polling ──────────────────────────────────────────────────────────

    async _pollLive() {
        if (this._livePolling) return; // cegah tumpang tindih jika siklus sebelumnya belum selesai
        this._livePolling = true;
        try {
            const db = this.client.database;
            if (!db) return;
            const tasks = [];
            for (const guild of this.client.guilds.cache.values()) {
                tasks.push(
                    this._pollGuildLive(guild, db).catch(err =>
                        warn(`[TikTok/Live] Poll error guild ${guild.id}: ${err.message}`)
                    )
                );
            }
            await Promise.all(tasks);
        } finally {
            this._livePolling = false;
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
        const live       = await this._isLive(account.username);
        const isLive     = live.isLive;
        const liveKey    = `tiktok-liveActive-${guild.id}-${account.username}`;
        const failKey    = `tiktok-liveFail-${guild.id}-${account.username}`;
        const notifAtKey = `tiktok-liveNotifAt-${guild.id}-${account.username}`;
        const wasLive    = !!db.get(liveKey);

        if (isLive) {
            if (live.ownerAvatar || live.ownerName) {
                this._updateAccountProfile(guild, db, account.username, {
                    thumbnail: live.ownerAvatar,
                    name:      live.ownerName,
                });
            }
            if (!wasLive) {
                const lastNotif = parseInt(db.get(notifAtKey) || '0', 10);
                if (lastNotif) {
                    if (live.startTime) {
                        // Validasi via start time: jika live mulai sebelum notif terakhir → stream sama → skip
                        if (live.startTime < lastNotif) {
                            db.set(liveKey, String(Date.now()));
                            return;
                        }
                    } else {
                        // Fallback: jika TikTok tidak return create_time, pakai cooldown 2 jam
                        if (Date.now() - lastNotif < LIVE_NOTIF_COOLDOWN_MS) {
                            db.set(liveKey, String(Date.now()));
                            return;
                        }
                    }
                }
                db.set(liveKey, String(Date.now()));
                db.set(notifAtKey, String(Date.now()));
                await this._sendLiveNotification(guild, account, live).catch(err =>
                    warn(`[TikTok/Live] Failed to send notification: ${err.message}`)
                );
            } else {
                // Ongoing monitoring: live masih aktif → reset fail counter
                db.delete(failKey);
            }
        } else if (wasLive) {
            // Butuh LIVE_FAIL_THRESHOLD kali gagal berturut-turut sebelum live dianggap berakhir
            const fails = parseInt(db.get(failKey) || '0') + 1;
            if (fails >= LIVE_FAIL_THRESHOLD) {
                db.delete(liveKey);
                db.delete(failKey);
                // notifAtKey TIDAK dihapus — cooldown tetap aktif sehingga jika live
                // reconnect dalam 2 jam (sesi yang sama), notif kedua tidak terkirim.
                // Cooldown akan expired secara alami setelah 2 jam.
            } else {
                db.set(failKey, String(fails));
            }
        }
    }

    async _isLive(username) {
        // Cache hasil per username selama 2 menit — semua guild berbagi hasil yang sama
        // dan tidak perlu membuka koneksi WebSocket berulang-ulang
        const cached = this._isLiveCache.get(username);
        if (cached && cached.expiresAt > Date.now()) return cached.result;

        const result = await this._isLiveRaw(username);
        this._isLiveCache.set(username, { result, expiresAt: Date.now() + LIVE_CACHE_MS });

        // Bersihkan entry yang sudah expired agar Map tidak tumbuh tak terbatas
        if (this._isLiveCache.size > 200) {
            const now = Date.now();
            for (const [k, v] of this._isLiveCache) {
                if (v.expiresAt <= now) this._isLiveCache.delete(k);
            }
        }

        return result;
    }

    async _isLiveRaw(username) {
        if (!WebcastPushConnection) return { isLive: false };

        const tryConnect = () => new Promise(resolve => {
            let resolved = false;
            const done = val => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                try { connection.disconnect(); } catch {}
                resolve(val);
            };

            const connection = new WebcastPushConnection(username, {
                processInitialData:       false,
                enableWebsocketUpgrade:   false,
                requestPollingIntervalMs: 1000,
                fetchRoomInfoOnConnect:   true,
            });

            const timer = setTimeout(() => done(null), 10_000);
            connection.connect()
                .then(state => {
                    const roomData = state?.roomInfo?.data || {};
                    // [DEBUG] log status mentah untuk monitoring — hapus setelah status 3 terkonfirmasi
                    info(`[TikTok/Live] @${username} roomData.status = ${roomData.status ?? 'undefined'}`);
                    // status 1 = room dibuat, live belum dimulai → tidak live
                    // status 2 = live aktif
                    // status 3 = live transisi/ongoing (masih dianggap live)
                    // status 4 = live berakhir/offline → tidak live
                    const liveStatuses = new Set([2, 3]);
                    if (!liveStatuses.has(roomData.status)) return done({ isLive: false });
                    const owner    = roomData.owner || {};
                    const ownerAvatar = owner.avatar_large?.url_list?.[0]
                                     || owner.avatar_medium?.url_list?.[0]
                                     || owner.avatar_thumb?.url_list?.[0]
                                     || null;
                    done({
                        isLive:     true,
                        // create_time = Unix detik → konversi ke ms untuk perbandingan dengan Date.now()
                        startTime:  roomData.create_time ? roomData.create_time * 1000 : null,
                        cover:      roomData.cover?.url_list?.[0] || null,
                        title:      roomData.title || null,
                        ownerAvatar,
                        ownerName:  owner.nickname || null,
                    });
                })
                .catch(() => done(null)); // null = gagal, bukan "tidak live"
        });

        // Percobaan pertama
        const first = await tryConnect();
        if (first) return first;

        // Retry sekali setelah 3 detik jika percobaan pertama gagal
        await new Promise(r => setTimeout(r, 3_000));
        return await tryConnect() || { isLive: false };
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

        const plainContent = fill(account.videoPlainMessage || '').trim();
        const customMsg   = fill(account.videoMessage || '').trim();
        const description = customMsg
            || `**${displayName}** just posted a new video on TikTok!\nDon't miss it, watch now! 🎉`;

        const embed = new EmbedBuilder()
            .setColor(0x010101)
            .setTitle(`🎵 ${displayName} — New Video!`)
            .setURL(entry.url)
            .setDescription(description)
            .addFields(
                { name: '🎬 Title',     value: entry.title || '(no title)', inline: false },
                { name: '🔗 Link', value: `[Click Me ▶](${entry.url})`, inline: false },
            );

        // Thumbnail profil akun (kecil, pojok kanan)
        if (account.thumbnail) embed.setThumbnail(account.thumbnail);
        // Thumbnail video dari RSS feed (gambar besar di bawah embed)
        if (entry.thumbnail)   embed.setImage(entry.thumbnail);

        const _ttBase = (process.env.BASE_URL || '').replace(/\/$/, '');
        const _ttVideoFooter = { text: _ttBase ? 'TikTok Video' : '🎵 TikTok Video' };
        if (_ttBase) _ttVideoFooter.iconURL = `${_ttBase}/img/tiktok.png`;
        embed.setFooter(_ttVideoFooter).setTimestamp();

        await discordCh.send({ content: plainContent || undefined, embeds: [embed] }).catch(err =>
            warn(`[TikTok] Failed to send embed: ${err.message}`)
        );
    }

    // ─── Live Notification ─────────────────────────────────────────────────────

    async _sendLiveNotification(guild, account, live = {}) {
        const discordCh = guild.channels.cache.get(account.liveChannelId);
        if (!discordCh) return;

        const displayName = account.name || account.username;
        const liveUrl     = `https://www.tiktok.com/${account.username}/live`;

        const fill = s => (s || '')
            .replace(/{account}/g,  displayName)
            .replace(/{username}/g, account.username)
            .replace(/{url}/g,      liveUrl);

        const plainContent = fill(account.livePlainMessage || '').trim();
        const customMsg   = fill(account.liveMessage || '').trim();
        const description = customMsg
            || `Hey, **${displayName}** is **LIVE** on TikTok right now!\nCome join and watch the stream~ 🎉`;

        const embed = new EmbedBuilder()
            .setColor(0xFE2C55)
            .setTitle(`🔴 ${displayName} is Live Right Now!`)
            .setURL(liveUrl)
            .setDescription(description);

        if (live.title) embed.addFields({ name: '🎙️ Stream Title', value: live.title, inline: false });
        embed.addFields({ name: '🔗 Link', value: `[Click Me ▶](${liveUrl})`, inline: false });

        if (account.thumbnail) embed.setThumbnail(account.thumbnail);
        // Snapshot asli dari stream (kalau tersedia) — fallback ke avatar akun
        const liveImage = live.cover || account.thumbnail;
        if (liveImage) embed.setImage(liveImage);

        const _ttBase = (process.env.BASE_URL || '').replace(/\/$/, '');
        const _ttLiveFooter = { text: _ttBase ? 'TikTok LIVE' : '🔴 TikTok LIVE' };
        if (_ttBase) _ttLiveFooter.iconURL = `${_ttBase}/img/tiktok.png`;
        embed.setFooter(_ttLiveFooter).setTimestamp();

        await discordCh.send({ content: plainContent || undefined, embeds: [embed] }).catch(err =>
            warn(`[TikTok/Live] Failed to send embed: ${err.message}`)
        );
    }

    // Untuk API test endpoint
    async _sendNotification(guild, account, type, entry) {
        if (type === 'live') return this._sendLiveNotification(guild, account);
        return this._sendVideoNotification(guild, account, entry);
    }

    // ─── Cookie Health Monitor ─────────────────────────────────────────────────

    async _checkHealth() {
        const db = this.client.database;
        if (!db) return;

        // Ambil satu akun tracked dari guild mana saja untuk dijadikan test
        let testUsername = null;
        for (const guild of this.client.guilds.cache.values()) {
            const raw = db.get(`tiktok-accounts-${guild.id}`);
            if (!raw) continue;
            try {
                const accounts = JSON.parse(raw);
                if (accounts.length > 0) { testUsername = accounts[0].username; break; }
            } catch { /* noop */ }
        }
        if (!testUsername) return; // No accounts being monitored — skip

        let healthy = false;
        try {
            const { entries } = await this._fetchVideos(testUsername, 1);
            healthy = entries.length > 0;
        } catch { healthy = false; }

        const failKey    = 'tiktok-health-failures';
        const alertedKey = 'tiktok-health-alerted';

        if (healthy) {
            const wasAlerted = db.get(alertedKey) === 'true';
            db.set(failKey, '0');
            if (wasAlerted) {
                db.set(alertedKey, 'false');
                await this._sendHealthDM(true).catch(err => warn(`[TikTok/Health] Failed to send recovery DM: ${err.message}`));
            }
        } else {
            const failures = parseInt(db.get(failKey) || '0') + 1;
            db.set(failKey, String(failures));
            warn(`[TikTok/Health] Health check failed (${failures}/${HEALTH_FAIL_THRESHOLD})`);

            if (failures >= HEALTH_FAIL_THRESHOLD && db.get(alertedKey) !== 'true') {
                db.set(alertedKey, 'true');
                await this._sendHealthDM(false).catch(err => warn(`[TikTok/Health] Failed to send alert DM: ${err.message}`));
            }
        }
    }

    async _sendHealthDM(isRecovery) {
        const config = require('../config');
        const ownerId = config.users?.ownerId;
        if (!ownerId) return;

        let owner;
        try { owner = await this.client.users.fetch(ownerId); }
        catch { warn('[TikTok/Health] Failed to fetch owner user from Discord.'); return; }

        const embed = new EmbedBuilder()
            .setColor(isRecovery ? 0x57F287 : 0xED4245)
            .setTitle(isRecovery
                ? '✅ TikTok yt-dlp — Kembali Normal'
                : '⚠️ TikTok yt-dlp — Gagal Mengambil Data')
            .setTimestamp();

        if (isRecovery) {
            embed.setDescription('yt-dlp berhasil kembali mengambil feed TikTok. Semua notifikasi berjalan normal.');
        } else {
            embed.setDescription(
                `yt-dlp gagal merespon **${HEALTH_FAIL_THRESHOLD} kali berturut-turut**.\n` +
                'TikTok mungkin mengubah API mereka, sehingga extractor yt-dlp perlu diperbarui.'
            );
            embed.addFields({
                name: '📋 Cara Memperbaiki',
                value:
                    '1. SSH ke server\n' +
                    '2. Update yt-dlp: `pip install -U yt-dlp`\n' +
                    '3. Verifikasi: `yt-dlp --flat-playlist --playlist-end 1 -J "https://www.tiktok.com/@username"`\n' +
                    '4. Jika masih gagal, cek halaman GitHub yt-dlp untuk issue terbaru terkait TikTok',
                inline: false,
            });
        }

        try {
            await owner.send({ embeds: [embed] });
        } catch (err) {
            warn(`[TikTok/Health] Failed to send DM to owner: ${err.message}`);
        }
    }

}

module.exports = TikTokNotifier;

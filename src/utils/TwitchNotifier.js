'use strict';

/**
 * TwitchNotifier — polling via Twitch Helix API (official)
 *
 * Memerlukan TWITCH_CLIENT_ID dan TWITCH_CLIENT_SECRET di .env
 * Token diambil otomatis via Client Credentials flow dan di-refresh saat expired.
 *
 * Keunggulan vs GQL: resmi, stabil, tidak bisa diblokir Twitch, rate limit jelas (800 req/menit).
 * Efisiensi: semua login di-batch dalam 1 API call per poll cycle.
 */

const { EmbedBuilder } = require('discord.js');
const { warn }         = require('./Console');

const HELIX_BASE       = 'https://api.twitch.tv/helix';
const TOKEN_URL        = 'https://id.twitch.tv/oauth2/token';
const POLL_INTERVAL_MS = 2 * 60 * 1000; // cek tiap 2 menit

const AVATAR_CHECK_INTERVAL_MS = 60 * 60 * 1000;     // Cek profil basi tiap 1 jam
const AVATAR_STALE_MS          = 24 * 60 * 60 * 1000; // Profil dianggap basi setelah 24 jam tidak live
const HEALTH_FAIL_THRESHOLD    = 3;                   // DM owner setelah 3x poll gagal berturut-turut
const VALIDITY_CHECK_INTERVAL_MS = 15 * 60 * 1000;    // Cek validitas akun tiap 15 menit
const ACCOUNT_FAIL_THRESHOLD     = 4;                 // ~1 jam gagal berturut-turut → tandai bermasalah

class TwitchNotifier {
    constructor(client) {
        this.client          = client;
        this._pollTimer      = null;
        this._avatarTimer    = null;
        this._validityTimer  = null;
        this._liveSessions   = new Map(); // "guildId:userId" → streamId
        this._pendingOffline = new Map(); // "guildId:userId" → consecutive offline poll count
        this._accessToken    = null;
        this._tokenExpires   = 0;
        this._clientId       = process.env.TWITCH_CLIENT_ID     || '';
        this._clientSecret   = process.env.TWITCH_CLIENT_SECRET || '';
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    start() {
        if (!this._clientId || !this._clientSecret) {
            warn('[Twitch] TWITCH_CLIENT_ID atau TWITCH_CLIENT_SECRET tidak diset — Twitch notifier dinonaktifkan.');
            return;
        }
        this._loadLiveSessions();
        this._poll().catch(err => warn(`[Twitch] Poll awal error: ${err.message}`));
        this._pollTimer = setInterval(
            () => this._poll().catch(err => warn(`[Twitch] Poll error: ${err.message}`)),
            POLL_INTERVAL_MS
        );

        // Profil Twitch (foto + nama) di-refresh opportunistic saat akun terdeteksi
        // live (lihat _poll), plus fallback berkala ini supaya akun yang jarang
        // live tidak pernah basi lebih dari 24 jam.
        setTimeout(() => {
            this._refreshStaleAvatars().catch(err => warn(`[Twitch] Avatar refresh error: ${err.message}`));
            this._avatarTimer = setInterval(
                () => this._refreshStaleAvatars().catch(err => warn(`[Twitch] Avatar refresh error: ${err.message}`)),
                AVATAR_CHECK_INTERVAL_MS
            );
        }, 10 * 60 * 1000);

        // Deteksi akun yang benar-benar sudah tidak ada (dihapus/banned — bukan
        // rename, karena rename sudah self-heal otomatis di atas). Setelah gagal
        // berturut-turut, nonaktifkan otomatis + tandai "bermasalah" di dashboard,
        // supaya tidak silent-fail selamanya.
        setTimeout(() => {
            this._checkAccountValidity().catch(err => warn(`[Twitch] Validity check error: ${err.message}`));
            this._validityTimer = setInterval(
                () => this._checkAccountValidity().catch(err => warn(`[Twitch] Validity check error: ${err.message}`)),
                VALIDITY_CHECK_INTERVAL_MS
            );
        }, 15 * 60 * 1000);
    }

    _loadLiveSessions() {
        const db = this.client?.database;
        if (!db) return;
        for (const guild of this.client.guilds.cache.values()) {
            for (const acc of this.getAccounts(guild.id)) {
                if (!acc.userId) continue;
                const saved = db.get(`twitch-live-${guild.id}-${acc.userId}`);
                if (saved) this._liveSessions.set(`${guild.id}:${acc.userId}`, saved);
            }
        }
    }

    stop() {
        if (this._pollTimer)     clearInterval(this._pollTimer);
        if (this._avatarTimer)   clearInterval(this._avatarTimer);
        if (this._validityTimer) clearInterval(this._validityTimer);
        this._pollTimer = this._avatarTimer = this._validityTimer = null;
    }

    get isConfigured() {
        return !!(this._clientId && this._clientSecret);
    }

    // ─── Token Management ──────────────────────────────────────────────────────

    async _getToken() {
        if (this._accessToken && Date.now() < this._tokenExpires) return this._accessToken;

        const res = await fetch(TOKEN_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id:     this._clientId,
                client_secret: this._clientSecret,
                grant_type:    'client_credentials',
            }),
            signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) throw new Error(`Token request failed: HTTP ${res.status}`);
        const json = await res.json();
        if (!json.access_token) throw new Error('No access_token in token response');

        this._accessToken  = json.access_token;
        this._tokenExpires = Date.now() + (json.expires_in - 60) * 1000; // buffer 60 detik
        return this._accessToken;
    }

    async _helixGet(path) {
        const token = await this._getToken();
        const res = await fetch(`${HELIX_BASE}${path}`, {
            headers: {
                'Client-Id':     this._clientId,
                'Authorization': `Bearer ${token}`,
            },
            signal: AbortSignal.timeout(10_000),
        });

        // Token expired di sisi server → refresh dan retry sekali
        if (res.status === 401) {
            this._accessToken  = null;
            this._tokenExpires = 0;
            const fresh = await this._getToken();
            const retry = await fetch(`${HELIX_BASE}${path}`, {
                headers: {
                    'Client-Id':     this._clientId,
                    'Authorization': `Bearer ${fresh}`,
                },
                signal: AbortSignal.timeout(10_000),
            });
            if (!retry.ok) throw new Error(`Helix API HTTP ${retry.status}`);
            return retry.json();
        }

        if (!res.ok) throw new Error(`Helix API HTTP ${res.status}`);
        return res.json();
    }

    // ─── User Lookup ───────────────────────────────────────────────────────────

    async lookupUser(input) {
        let login = input.trim().replace(/^@/, '').toLowerCase();
        const urlMatch = login.match(/twitch\.tv\/([a-z0-9_]+)/i);
        if (urlMatch) login = urlMatch[1].toLowerCase();

        const usersData = await this._helixGet(`/users?login=${encodeURIComponent(login)}`);
        const user = usersData.data?.[0];
        if (!user) throw new Error(`Twitch account "${login}" not found.`);

        return {
            userId:      user.id,
            login:       user.login,
            displayName: user.display_name,
            thumbnail:   user.profile_image_url || '',
            description: user.description || '',
        };
    }

    // ─── Stream & Profile Fetch ────────────────────────────────────────────────

    async _fetchStreams(userIds) {
        if (userIds.length === 0) return [];
        // Query pakai user_id (stabil, immune terhadap rename) bukan user_login —
        // kalau streamer ganti username, login lama yang tersimpan di DB tidak
        // akan match apa pun lagi dan live detection berhenti diam-diam.
        // Batch max 100 id dalam satu request.
        const params = userIds.map(id => `user_id=${encodeURIComponent(id)}`).join('&');
        const data = await this._helixGet(`/streams?${params}`);
        return data.data || [];
    }

    async _fetchUserProfiles(userIds) {
        if (userIds.length === 0) return new Map();
        const map = new Map();
        // Helix membatasi maks 100 id per request
        for (let i = 0; i < userIds.length; i += 100) {
            const chunk  = userIds.slice(i, i + 100);
            const params = chunk.map(id => `id=${encodeURIComponent(id)}`).join('&');
            const data   = await this._helixGet(`/users?${params}`);
            for (const u of (data.data || [])) map.set(u.id, u);
        }
        return map;
    }

    // ─── Profile Refresh ───────────────────────────────────────────────────────

    _persistProfileUpdate(guild, userId, profile) {
        if (!profile) return null;
        const accounts = this.getAccounts(guild.id);
        const idx      = accounts.findIndex(a => a.userId === userId);
        if (idx === -1) return null;
        const account = accounts[idx];

        // profile.login selalu akurat walau account.login yang tersimpan sudah
        // basi (user ganti username) — karena profile di-fetch pakai userId,
        // bukan login. Auto-koreksi di sini supaya dashboard & embed link ikut benar.
        const freshLogin      = profile.login            || account.login;
        const freshThumbnail  = profile.profile_image_url || account.thumbnail;
        const freshName       = profile.display_name      || account.displayName || freshLogin;
        const renamed         = freshLogin !== account.login;
        const changed         = renamed || freshThumbnail !== account.thumbnail || freshName !== account.displayName;

        accounts[idx] = { ...account, login: freshLogin, thumbnail: freshThumbnail, displayName: freshName, thumbnailUpdatedAt: Date.now() };
        this.setAccounts(guild.id, accounts);

        if (renamed) warn(`[Twitch] Username berubah otomatis: "${account.login}" → "${freshLogin}" (guild ${guild.name})`);
        return { login: freshLogin, displayName: freshName, thumbnail: freshThumbnail, changed };
    }

    // ─── Poll Health Alert ─────────────────────────────────────────────────────
    // Rename sudah ditangani otomatis di atas — bagian ini untuk kasus yang TIDAK
    // bisa self-heal: kredensial dicabut/expired, Helix API down, dll. Setelah
    // gagal beruntun, DM owner sekali (tidak spam) supaya tidak ada yang sadar
    // notifikasi mati hanya karena kebetulan cek Discord.

    async _recordPollResult(success, errMessage) {
        const db = this.client?.database;
        if (!db) return;
        const failKey    = 'twitch-poll-failures';
        const alertedKey = 'twitch-poll-alerted';

        if (success) {
            const wasAlerted = db.get(alertedKey) === 'true';
            db.set(failKey, '0');
            if (wasAlerted) {
                db.set(alertedKey, 'false');
                await this._sendHealthDM(true).catch(err => warn(`[Twitch/Health] Gagal kirim DM recovery: ${err.message}`));
            }
            return;
        }

        const failures = parseInt(db.get(failKey) || '0', 10) + 1;
        db.set(failKey, String(failures));
        warn(`[Twitch] Poll gagal (${failures}/${HEALTH_FAIL_THRESHOLD}): ${errMessage}`);

        if (failures >= HEALTH_FAIL_THRESHOLD && db.get(alertedKey) !== 'true') {
            db.set(alertedKey, 'true');
            await this._sendHealthDM(false, errMessage).catch(err => warn(`[Twitch/Health] Gagal kirim DM alert: ${err.message}`));
        }
    }

    async _sendHealthDM(isRecovery, errMessage) {
        const config  = require('../config');
        const ownerId = config.users?.ownerId;
        if (!ownerId) return;

        let owner;
        try { owner = await this.client.users.fetch(ownerId); }
        catch { warn('[Twitch/Health] Gagal mengambil user owner dari Discord.'); return; }

        const embed = new EmbedBuilder()
            .setColor(isRecovery ? 0x57F287 : 0xED4245)
            .setTitle(isRecovery ? '✅ Twitch API — Kembali Normal' : '⚠️ Twitch API — Gagal Mengambil Data')
            .setTimestamp();

        if (isRecovery) {
            embed.setDescription('Polling Twitch berhasil kembali normal. Semua notifikasi live berjalan seperti biasa.');
        } else {
            embed.setDescription(
                `Polling Twitch gagal **${HEALTH_FAIL_THRESHOLD}x berturut-turut**.\n` +
                `Error terakhir: \`${(errMessage || '').slice(0, 200)}\`\n\n` +
                'Kemungkinan: TWITCH_CLIENT_ID/SECRET expired/dicabut, atau Helix API sedang down.'
            );
        }

        try { await owner.send({ embeds: [embed] }); }
        catch (err) { warn(`[Twitch/Health] Gagal kirim DM ke owner: ${err.message}`); }
    }

    // Fallback untuk akun yang jarang live — supaya foto profil/nama tidak
    // pernah basi lebih dari AVATAR_STALE_MS walau tidak pernah memicu refresh
    // opportunistic di _poll(). Di-batch dalam satu Helix call (max 100 id).
    async _refreshStaleAvatars() {
        const now   = Date.now();
        const stale = new Map(); // userId → [{ guild, account }]

        for (const guild of this.client.guilds.cache.values()) {
            for (const acc of this.getAccounts(guild.id)) {
                if (!acc.userId || acc.broken) continue;
                const lastUpdate = parseInt(acc.thumbnailUpdatedAt || '0', 10);
                if (now - lastUpdate < AVATAR_STALE_MS) continue;
                if (!stale.has(acc.userId)) stale.set(acc.userId, []);
                stale.get(acc.userId).push(guild);
            }
        }
        if (stale.size === 0) return;

        const profiles = await this._fetchUserProfiles([...stale.keys()]);
        for (const [userId, guilds] of stale) {
            const profile = profiles.get(userId);
            for (const guild of guilds) this._persistProfileUpdate(guild, userId, profile);
        }
    }

    // ─── Account Validity (auto-disable akun yang dihapus/banned) ──────────────
    // Beda dengan rename (sudah self-heal di _persistProfileUpdate): ini untuk
    // userId yang BENAR-BENAR tidak ditemukan lagi oleh Twitch sama sekali.
    // Gagal API/network dianggap "valid" (fail-open) supaya outage sesaat tidak
    // salah menandai akun yang sebenarnya baik-baik saja.
    async _checkAccountValidity() {
        const candidates = []; // { guild, account }
        for (const guild of this.client.guilds.cache.values()) {
            for (const acc of this.getAccounts(guild.id)) {
                if (acc.broken || !acc.enabled || !acc.userId) continue;
                candidates.push({ guild, account: acc });
            }
        }
        if (candidates.length === 0) return;

        const userIds = [...new Set(candidates.map(c => c.account.userId))];
        let profiles;
        try {
            profiles = await this._fetchUserProfiles(userIds);
        } catch {
            return; // Helix down/error → fail-open, jangan tandai siapa pun
        }

        for (const { guild, account } of candidates) {
            this._applyValidityResult(guild, account.userId, profiles.has(account.userId));
        }
    }

    _applyValidityResult(guild, userId, valid) {
        const accounts = this.getAccounts(guild.id);
        const idx      = accounts.findIndex(a => a.userId === userId);
        if (idx === -1) return;
        const account = accounts[idx];

        if (valid) {
            if (account.failCount) {
                accounts[idx] = { ...account, failCount: 0 };
                this.setAccounts(guild.id, accounts);
            }
            return;
        }

        const failCount = (account.failCount || 0) + 1;
        if (failCount >= ACCOUNT_FAIL_THRESHOLD) {
            accounts[idx] = { ...account, failCount, broken: true, brokenAt: Date.now(), enabled: false };
            this.setAccounts(guild.id, accounts);
            warn(`[Twitch] Akun ditandai bermasalah & dinonaktifkan otomatis: ${account.login} → ${guild.name}`);
        } else {
            accounts[idx] = { ...account, failCount };
            this.setAccounts(guild.id, accounts);
        }
    }

    // ─── Polling Loop ──────────────────────────────────────────────────────────

    async _poll() {
        const db = this.client?.database;
        if (!db) return;

        // Kumpulkan semua akun unik dari semua guild — key pakai userId (stabil),
        // bukan login, supaya rename tidak memutus tracking session live.
        const allAccounts = new Map(); // userId → [{ guild, account }]
        for (const guild of this.client.guilds.cache.values()) {
            for (const acc of this.getAccounts(guild.id)) {
                if (!acc.userId || !acc.enabled || !acc.channelId) continue;
                if (!allAccounts.has(acc.userId)) allAccounts.set(acc.userId, []);
                allAccounts.get(acc.userId).push({ guild, account: acc });
            }
        }

        if (allAccounts.size === 0) return;

        // Satu API call untuk semua userId sekaligus
        const userIds = [...allAccounts.keys()];
        let streams;
        try {
            streams = await this._fetchStreams(userIds);
        } catch (err) {
            await this._recordPollResult(false, err.message);
            return;
        }
        await this._recordPollResult(true);

        const liveMap = new Map(streams.map(s => [s.user_id, s]));

        // Ambil profil untuk akun yang sedang live (thumbnail + login terbaru)
        const liveUserIds = streams.map(s => s.user_id);
        const profiles    = liveUserIds.length > 0
            ? await this._fetchUserProfiles(liveUserIds)
            : new Map();

        for (const [userId, entries] of allAccounts) {
            const stream = liveMap.get(userId) || null;
            const isLive = !!stream;

            for (const { guild, account } of entries) {
                const sessionKey = `${guild.id}:${userId}`;
                const dbKey      = `twitch-live-${guild.id}-${userId}`;
                const wasLive    = this._liveSessions.has(sessionKey);

                if (isLive && !wasLive) {
                    this._pendingOffline.delete(sessionKey);
                    this._liveSessions.set(sessionKey, stream.id);
                    db.set(dbKey, stream.id);

                    // Auto-refresh profil (foto + nama + username) saat live —
                    // kesempatan gratis, sudah perlu hit API untuk data stream-nya.
                    const profile   = profiles.get(userId);
                    const persisted = this._persistProfileUpdate(guild, userId, profile);
                    const freshAccount = {
                        ...account,
                        login:       persisted?.login       || stream.user_login || account.login,
                        displayName: persisted?.displayName || stream.user_name  || account.displayName || account.login,
                        thumbnail:   persisted?.thumbnail   || account.thumbnail,
                    };
                    const streamData = {
                        id:           stream.id,
                        title:        stream.title       || 'Live Stream',
                        gameName:     stream.game_name   || '',
                        viewerCount:  stream.viewer_count ?? 0,
                        thumbnailUrl: (stream.thumbnail_url || '')
                            .replace('{width}', '440')
                            .replace('{height}', '248') + `?t=${Date.now()}`,
                        startedAt:    stream.started_at,
                    };
                    await this._sendNotification(guild, freshAccount, streamData);

                } else if (isLive && wasLive) {
                    // Masih live — reset pending offline jika sebelumnya ada blip
                    this._pendingOffline.delete(sessionKey);

                } else if (!isLive && wasLive) {
                    // Twitch API kadang blip — konfirmasi offline setelah 2 poll berturut-turut
                    const offlineCount = (this._pendingOffline.get(sessionKey) || 0) + 1;
                    if (offlineCount >= 2) {
                        this._pendingOffline.delete(sessionKey);
                        this._liveSessions.delete(sessionKey);
                        db.delete(dbKey);
                    } else {
                        this._pendingOffline.set(sessionKey, offlineCount);
                    }
                }
            }
        }

        // Bersihkan _pendingOffline untuk session yang sudah tidak di-track
        // (akun dihapus dari dashboard saat masih dalam status pending offline)
        for (const sessionKey of this._pendingOffline.keys()) {
            if (!this._liveSessions.has(sessionKey)) {
                this._pendingOffline.delete(sessionKey);
            }
        }
    }

    // ─── Discord Embed ─────────────────────────────────────────────────────────

    async _sendNotification(guild, account, streamData) {
        const channel = guild.channels.cache.get(account.channelId);
        if (!channel) return;

        const displayName = account.displayName || account.login;
        const streamUrl   = `https://twitch.tv/${account.login}`;

        const fill = s => (s || '')
            .replace(/{account}/g,  displayName)
            .replace(/{login}/g,    account.login)
            .replace(/{url}/g,      streamUrl)
            .replace(/{game}/g,     streamData?.gameName   || '')
            .replace(/{title}/g,    streamData?.title      || '')
            .replace(/{viewers}/g,  String(streamData?.viewerCount ?? 0));

        const defaultDesc = `Hey, **${displayName}** is **LIVE** on Twitch right now!\nCome join and watch the stream~ 🎉`;
        const description = fill(account.message || '').trim() || defaultDesc;

        const embed = new EmbedBuilder()
            .setColor(0x9146FF)
            .setTitle(`🔴 ${displayName} is Live Right Now!`)
            .setURL(streamUrl)
            .setDescription(description);

        embed.addFields({ name: '🎙️ Stream Title', value: streamData?.title || 'Live Stream', inline: false });
        if (streamData?.gameName) {
            embed.addFields({ name: '🎮 Category', value: streamData.gameName, inline: true });
        }
        embed.addFields({ name: '🔗 Link', value: `[Click Me ▶](${streamUrl})`, inline: true });

        if (streamData?.thumbnailUrl) embed.setImage(streamData.thumbnailUrl);
        if (account.thumbnail)        embed.setThumbnail(account.thumbnail);

        const _twBase = (process.env.BASE_URL || '').replace(/\/$/, '');
        const _twFooter = { text: _twBase ? 'Twitch LIVE' : '🟣 Twitch LIVE' };
        if (_twBase) _twFooter.iconURL = `${_twBase}/img/twitch.png`;
        embed.setFooter(_twFooter).setTimestamp();

        try {
            await channel.send({ embeds: [embed] });
        } catch (err) {
            warn(`[Twitch] Failed to send notification to #${channel.name} (${guild.name}): ${err.message}`);
        }
    }

    async sendTestNotification(guild, account) {
        return this._sendNotification(guild, account, {
            id:           'test',
            title:        '[TEST] Example stream title',
            gameName:     'Just Chatting',
            viewerCount:  1234,
            thumbnailUrl: 'https://static-cdn.jtvnw.net/ttv-static/404_preview-440x248.jpg',
            startedAt:    new Date().toISOString(),
        });
    }

    // ─── Database Helpers ──────────────────────────────────────────────────────

    getAccounts(guildId) {
        const db = this.client.database;
        try { return JSON.parse(db.get(`twitch-accounts-${guildId}`) || '[]'); }
        catch { return []; }
    }

    setAccounts(guildId, accounts) {
        this.client.database.set(`twitch-accounts-${guildId}`, JSON.stringify(accounts));
    }

    // Stub agar kode lama tidak error
    async subscribeUser()   {}
    async unsubscribeUser() {}
    verifySignature()       { return false; }
    async handleOnline()    {}
    async handleOffline()   {}
}

module.exports = TwitchNotifier;

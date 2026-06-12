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
const { info, warn }   = require('./Console');

const HELIX_BASE       = 'https://api.twitch.tv/helix';
const TOKEN_URL        = 'https://id.twitch.tv/oauth2/token';
const POLL_INTERVAL_MS = 2 * 60 * 1000; // cek tiap 2 menit

class TwitchNotifier {
    constructor(client) {
        this.client          = client;
        this._pollTimer      = null;
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
        info('[Twitch] TwitchNotifier (Helix API) dimulai.');
        this._loadLiveSessions();
        this._poll().catch(err => warn(`[Twitch] Poll awal error: ${err.message}`));
        this._pollTimer = setInterval(
            () => this._poll().catch(err => warn(`[Twitch] Poll error: ${err.message}`)),
            POLL_INTERVAL_MS
        );
    }

    _loadLiveSessions() {
        const db = this.client?.database;
        if (!db) return;
        let loaded = 0;
        for (const guild of this.client.guilds.cache.values()) {
            for (const acc of this.getAccounts(guild.id)) {
                if (!acc.userId) continue;
                const saved = db.get(`twitch-live-${guild.id}-${acc.userId}`);
                if (saved) {
                    this._liveSessions.set(`${guild.id}:${acc.userId}`, saved);
                    loaded++;
                }
            }
        }
        if (loaded > 0) info(`[Twitch] Memuat ${loaded} live session dari DB.`);
    }

    stop() {
        if (this._pollTimer) clearInterval(this._pollTimer);
        this._pollTimer = null;
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

    async _fetchStreams(logins) {
        if (logins.length === 0) return [];
        // Batch max 100 logins dalam satu request
        const params = logins.map(l => `user_login=${encodeURIComponent(l)}`).join('&');
        const data = await this._helixGet(`/streams?${params}`);
        return data.data || [];
    }

    async _fetchUserProfiles(userIds) {
        if (userIds.length === 0) return new Map();
        const params = userIds.map(id => `id=${encodeURIComponent(id)}`).join('&');
        const data = await this._helixGet(`/users?${params}`);
        const map = new Map();
        for (const u of (data.data || [])) map.set(u.id, u);
        return map;
    }

    // ─── Polling Loop ──────────────────────────────────────────────────────────

    async _poll() {
        const db = this.client?.database;
        if (!db) return;

        // Kumpulkan semua akun unik dari semua guild
        const allAccounts = new Map(); // login → [{ guild, account }]
        for (const guild of this.client.guilds.cache.values()) {
            for (const acc of this.getAccounts(guild.id)) {
                if (!acc.login || !acc.enabled || !acc.channelId) continue;
                const key = acc.login.toLowerCase();
                if (!allAccounts.has(key)) allAccounts.set(key, []);
                allAccounts.get(key).push({ guild, account: acc });
            }
        }

        if (allAccounts.size === 0) return;

        // Satu API call untuk semua login sekaligus
        const logins  = [...allAccounts.keys()];
        const streams = await this._fetchStreams(logins);
        const liveMap = new Map(streams.map(s => [s.user_login.toLowerCase(), s]));

        // Ambil profil untuk akun yang sedang live (thumbnail terbaru)
        const liveUserIds = streams.map(s => s.user_id);
        const profiles    = liveUserIds.length > 0
            ? await this._fetchUserProfiles(liveUserIds)
            : new Map();

        for (const [login, entries] of allAccounts) {
            const stream = liveMap.get(login) || null;

            for (const { guild, account } of entries) {
                const userId = account.userId || stream?.user_id;
                if (!userId) continue;

                const sessionKey = `${guild.id}:${userId}`;
                const dbKey      = `twitch-live-${guild.id}-${userId}`;
                const wasLive    = this._liveSessions.has(sessionKey);
                const isLive     = !!stream;

                if (isLive && !wasLive) {
                    this._pendingOffline.delete(sessionKey);
                    this._liveSessions.set(sessionKey, stream.id);
                    db.set(dbKey, stream.id);

                    const profile = profiles.get(userId);
                    const freshAccount = {
                        ...account,
                        displayName: profile?.display_name   || stream.user_name     || account.displayName || account.login,
                        thumbnail:   profile?.profile_image_url || account.thumbnail,
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
                    info(`[Twitch] ${login} LIVE di guild ${guild.id}`);

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
                        info(`[Twitch] ${login} offline di guild ${guild.id}`);
                    } else {
                        this._pendingOffline.set(sessionKey, offlineCount);
                        info(`[Twitch] ${login} tidak terdeteksi di poll ini (${offlineCount}/2) — menunggu konfirmasi offline`);
                    }
                }
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
            .setDescription(description)
            .setTimestamp();

        embed.addFields({ name: '🎙️ Stream Title', value: streamData?.title || 'Live Stream', inline: false });
        if (streamData?.gameName) {
            embed.addFields({ name: '🎮 Category', value: streamData.gameName, inline: true });
        }
        embed.addFields({ name: '🔗 Link', value: `[Click Me ▶](${streamUrl})`, inline: true });

        if (streamData?.thumbnailUrl) embed.setImage(streamData.thumbnailUrl);
        if (account.thumbnail)        embed.setThumbnail(account.thumbnail);

        await channel.send({ embeds: [embed] });
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

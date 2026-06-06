'use strict';

/**
 * KickNotifier — polling via Kick Official API (https://api.kick.com)
 *
 * Membutuhkan:
 *   KICK_CLIENT_ID     — dari https://kick.com/settings/developer (Developer Portal)
 *   KICK_CLIENT_SECRET — dari halaman yang sama
 *
 * OAuth flow: client_credentials (tidak perlu login user)
 * Token endpoint: https://id.kick.com/oauth/token
 * API base: https://api.kick.com/public/v1
 */

const { EmbedBuilder } = require('discord.js');
const { info, warn }   = require('./Console');

const TOKEN_URL        = 'https://id.kick.com/oauth/token';
const API_BASE         = 'https://api.kick.com/public/v1';
const POLL_INTERVAL_MS = 2 * 60 * 1000; // cek tiap 2 menit

class KickNotifier {
    constructor(client) {
        this.client        = client;
        this._pollTimer    = null;
        this._liveSessions = new Map(); // "guildId:slug" → streamId

        this._clientId     = process.env.KICK_CLIENT_ID     || '';
        this._clientSecret = process.env.KICK_CLIENT_SECRET || '';
        this._accessToken  = null;
        this._tokenExpiry  = 0;
    }

    get isConfigured() {
        return !!(this._clientId && this._clientSecret);
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    start() {
        if (!this.isConfigured) {
            warn('[Kick] KICK_CLIENT_ID / KICK_CLIENT_SECRET not set in .env — KickNotifier disabled.');
            warn('[Kick] Daftar di https://kick.com/settings/developer untuk mendapatkan credentials.');
            return;
        }
        info('[Kick] KickNotifier (Official API + OAuth) dimulai.');
        this._loadLiveSessions();
        this._poll().catch(err => warn(`[Kick] Poll awal error: ${err.message}`));
        this._pollTimer = setInterval(
            () => this._poll().catch(err => warn(`[Kick] Poll error: ${err.message}`)),
            POLL_INTERVAL_MS
        );
    }

    stop() {
        if (this._pollTimer) clearInterval(this._pollTimer);
        this._pollTimer = null;
    }

    _loadLiveSessions() {
        const db = this.client?.database;
        if (!db) return;
        let loaded = 0;
        for (const guild of this.client.guilds.cache.values()) {
            for (const acc of this.getAccounts(guild.id)) {
                const key   = `kick-live-${guild.id}-${acc.slug}`;
                const saved = db.get(key);
                if (saved) {
                    this._liveSessions.set(`${guild.id}:${acc.slug}`, saved);
                    loaded++;
                }
            }
        }
        if (loaded > 0) info(`[Kick] Memuat ${loaded} live session dari DB.`);
    }

    // ─── OAuth Token ───────────────────────────────────────────────────────────

    async _getToken() {
        if (this._accessToken && Date.now() < this._tokenExpiry - 30_000) {
            return this._accessToken;
        }
        const res = await fetch(TOKEN_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    new URLSearchParams({
                grant_type:    'client_credentials',
                client_id:     this._clientId,
                client_secret: this._clientSecret,
            }).toString(),
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`Token request failed: HTTP ${res.status} — ${body.slice(0, 100)}`);
        }
        const data = await res.json();
        this._accessToken = data.access_token;
        this._tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
        return this._accessToken;
    }

    async _apiGet(path) {
        const token = await this._getToken();
        const res   = await fetch(`${API_BASE}${path}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept':        'application/json',
            },
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return null;
        return await res.json();
    }

    // ─── Channel Lookup ────────────────────────────────────────────────────────

    async lookupChannel(input) {
        if (!this.isConfigured) {
            throw new Error('KICK_CLIENT_ID and KICK_CLIENT_SECRET are not configured in .env. Register at kick.com/settings/developer.');
        }

        const slug = this._resolveSlug(input);

        // Step 1: Ambil channel info untuk mendapatkan broadcaster_user_id
        let chData;
        try {
            chData = await this._apiGet(`/channels?slug=${encodeURIComponent(slug)}`);
        } catch (err) {
            throw new Error(`Gagal menghubungi Kick API: ${err.message}`);
        }

        const channel = chData?.data?.[0];
        if (!channel) throw new Error(`Kick channel "${slug}" not found.`);

        const userId = channel.broadcaster_user_id;

        // Step 2: Ambil user info menggunakan broadcaster_user_id
        // → mengembalikan profile_picture terbaru + display name
        let displayName = slug;
        let thumbnail   = null;
        try {
            const userData = await this._apiGet(`/users?id=${userId}`);
            const user     = userData?.data?.[0];
            if (user) {
                displayName = user.name  || slug;
                thumbnail   = user.profile_picture || null;
            }
        } catch { /* fallback ke slug jika gagal */ }

        return { slug: channel.slug, displayName, thumbnail, userId };
    }

    _resolveSlug(input) {
        const s = input.trim().replace(/^@/, '');
        const m = s.match(/kick\.com\/([A-Za-z0-9_-]+)/i);
        return (m ? m[1] : s).toLowerCase();
    }

    // ─── Polling Loop ──────────────────────────────────────────────────────────

    async _poll() {
        if (!this.isConfigured) return;
        const db = this.client?.database;
        if (!db) return;

        // Deduplikasi per slug
        const allAccounts = new Map();
        for (const guild of this.client.guilds.cache.values()) {
            for (const acc of this.getAccounts(guild.id)) {
                if (!acc.enabled || !acc.channelId) continue;
                if (!allAccounts.has(acc.slug)) allAccounts.set(acc.slug, []);
                allAccounts.get(acc.slug).push({ guild, account: acc });
            }
        }
        if (allAccounts.size === 0) return;

        // Batch query semua slug sekaligus
        const slugs = [...allAccounts.keys()];
        let liveMap;
        try {
            liveMap = await this._fetchLiveStatus(slugs);
        } catch (err) {
            warn(`[Kick] Poll fetch error: ${err.message}`);
            return;
        }

        for (const [slug, entries] of allAccounts) {
            const streamData = liveMap.get(slug) || null;
            const isLive     = !!streamData;

            for (const { guild, account } of entries) {
                const sessionKey = `${guild.id}:${slug}`;
                const dbKey      = `kick-live-${guild.id}-${slug}`;
                const wasLive    = this._liveSessions.has(sessionKey);

                if (isLive && !wasLive) {
                    this._liveSessions.set(sessionKey, String(streamData.id));
                    db.set(dbKey, String(streamData.id));

                    // Auto-refresh thumbnail via /users?id= saat live
                    let freshThumbnail = account.thumbnail;
                    let freshName      = account.displayName || slug;
                    const userId = account.userId;
                    if (userId) {
                        try {
                            const userData = await this._apiGet(`/users?id=${userId}`);
                            const user = userData?.data?.[0];
                            if (user?.profile_picture) {
                                freshThumbnail = user.profile_picture;
                                freshName      = user.name || freshName;
                                // Simpan ke DB agar halaman dashboard ikut update
                                const accounts = this.getAccounts(guild.id);
                                const idx      = accounts.findIndex(a => a.slug === slug);
                                if (idx !== -1) {
                                    accounts[idx].thumbnail   = freshThumbnail;
                                    accounts[idx].displayName = freshName;
                                    this.setAccounts(guild.id, accounts);
                                }
                            }
                        } catch { /* abaikan jika gagal, pakai data lama */ }
                    }

                    const freshAccount = {
                        ...account,
                        displayName: freshName,
                        thumbnail:   freshThumbnail,
                    };

                    await this._sendNotification(guild, freshAccount, streamData).catch(err =>
                        warn(`[Kick] Failed to send notification: ${err.message}`)
                    );
                    info(`[Kick] ${slug} LIVE di guild ${guild.name}`);

                } else if (!isLive && wasLive) {
                    this._liveSessions.delete(sessionKey);
                    db.delete(dbKey);
                    info(`[Kick] ${slug} offline di guild ${guild.name}`);
                }
            }
        }
    }

    async _fetchLiveStatus(slugs) {
        // Kick API: filter by slug → ?slug=a&slug=b&slug=c
        const query = slugs.map(s => `slug=${encodeURIComponent(s)}`).join('&');
        const data  = await this._apiGet(`/livestreams?${query}`);
        const map   = new Map();
        if (data?.data) {
            for (const stream of data.data) {
                if (stream.slug) map.set(stream.slug.toLowerCase(), stream);
            }
        }
        return map;
    }

    // ─── Discord Embed ─────────────────────────────────────────────────────────

    async _sendNotification(guild, account, streamData) {
        const channel = guild.channels.cache.get(account.channelId);
        if (!channel) return;

        const displayName = account.displayName || account.slug;
        const streamUrl   = `https://kick.com/${account.slug}`;

        let content = (account.message || '').trim();
        if (content) {
            content = content
                .replace(/{account}/g,   displayName)
                .replace(/{slug}/g,      account.slug)
                .replace(/{url}/g,       streamUrl)
                .replace(/{category}/g,  streamData?.categories?.[0]?.name || '')
                .replace(/{title}/g,     streamData?.stream_title || streamData?.session_title || '')
                .replace(/{viewers}/g,   String(streamData?.viewer_count ?? streamData?.viewers ?? 0));
        }

        const title    = streamData?.stream_title || 'Live Stream';
        const category = streamData?.category?.name || '';
        const viewers  = streamData?.viewer_count ?? 0;
        const thumbUrl = streamData?.thumbnail || '';

        const embed = new EmbedBuilder()
            .setColor(0x53FC18)
            .setAuthor({
                name:    `${displayName} is LIVE on Kick!`,
                iconURL: account.thumbnail || undefined,
                url:     streamUrl,
            })
            .setTitle(title)
            .setURL(streamUrl)
            .setTimestamp();

        if (category) embed.addFields({ name: '🎮 Kategori', value: category, inline: true });
        embed.addFields({ name: '🔗 Tonton', value: `[Buka Kick](${streamUrl})`, inline: true });

        if (thumbUrl)          embed.setImage(thumbUrl);
        if (account.thumbnail) embed.setThumbnail(account.thumbnail);

        await channel.send({ content: content || undefined, embeds: [embed] });
    }

    async sendTestNotification(guild, account) {
        return this._sendNotification(guild, account, {
            slug:         account.slug,
            stream_title: '[TEST] Contoh judul stream',
            category:     { name: 'Just Chatting' },
            viewer_count: 1234,
            thumbnail:    '',
        });
    }

    // ─── Database Helpers ──────────────────────────────────────────────────────

    getAccounts(guildId) {
        try { return JSON.parse(this.client.database.get(`kick-accounts-${guildId}`) || '[]'); }
        catch { return []; }
    }

    setAccounts(guildId, accounts) {
        this.client.database.set(`kick-accounts-${guildId}`, JSON.stringify(accounts));
    }
}

module.exports = KickNotifier;

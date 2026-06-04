'use strict';

/**
 * TwitchNotifier — polling via Twitch GQL (tanpa Client ID resmi)
 *
 * Menggunakan endpoint internal yang dipakai website Twitch sendiri.
 * Tidak memerlukan: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, BASE_URL, verifikasi HP.
 *
 * Cara kerja: setiap POLL_INTERVAL_MS cek status live tiap channel yang dipantau.
 * Jika berubah offline→online kirim notifikasi; online→offline hapus flag live.
 */

const { EmbedBuilder } = require('discord.js');
const { info, warn }   = require('./Console');

// Client-ID yang dipakai website Twitch.tv (bukan credential pribadi)
const GQL_CLIENT_ID    = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_ENDPOINT     = 'https://gql.twitch.tv/gql';
const POLL_INTERVAL_MS = 2 * 60 * 1000; // cek tiap 2 menit

class TwitchNotifier {
    constructor(client) {
        this.client      = client;
        this._pollTimer  = null;
        // Map<"guildId:userId", streamId> — session live aktif (in-memory)
        this._liveSessions = new Map();
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    start() {
        info('[Twitch] TwitchNotifier (polling GQL) dimulai.');
        // Muat live sessions dari DB agar restart tidak kirim notif ulang
        this._loadLiveSessions();
        this._poll().catch(err => warn(`[Twitch] Poll awal error: ${err.message}`));
        this._pollTimer = setInterval(
            () => this._poll().catch(err => warn(`[Twitch] Poll error: ${err.message}`)),
            POLL_INTERVAL_MS
        );
    }

    // Muat semua session live yang tersimpan di DB ke in-memory Map
    _loadLiveSessions() {
        const db = this.client?.database;
        if (!db) return;
        let loaded = 0;
        for (const guild of this.client.guilds.cache.values()) {
            const accounts = this.getAccounts(guild.id);
            for (const acc of accounts) {
                if (!acc.userId) continue;
                const key   = `twitch-live-${guild.id}-${acc.userId}`;
                const saved = db.get(key);
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

    get isConfigured() { return true; } // tidak butuh env var apapun

    // ─── GQL Request ───────────────────────────────────────────────────────────

    async _gql(query) {
        const res = await fetch(GQL_ENDPOINT, {
            method:  'POST',
            headers: {
                'Client-ID':    GQL_CLIENT_ID,
                'Content-Type': 'application/json',
                'Origin':       'https://www.twitch.tv',
                'Referer':      'https://www.twitch.tv/',
                'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            },
            body:   JSON.stringify({ query }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`GQL HTTP ${res.status}`);
        const json = await res.json();
        if (json.errors?.length) throw new Error(json.errors[0].message);
        return json.data;
    }

    // ─── User Lookup ───────────────────────────────────────────────────────────

    async lookupUser(input) {
        let login = input.trim().replace(/^@/, '');
        const urlMatch = login.match(/twitch\.tv\/([A-Za-z0-9_]+)/i);
        if (urlMatch) login = urlMatch[1];
        login = login.toLowerCase();

        const data = await this._gql(`{
            user(login: "${login}") {
                id
                login
                displayName
                profileImageURL(width: 150)
                description
            }
        }`);

        const user = data?.user;
        if (!user) throw new Error(`Akun Twitch "${login}" tidak ditemukan.`);

        // Fallback: jika profileImageURL null, pakai avatar default Twitch
        const thumbnail = user.profileImageURL
            || `https://static-cdn.jtvnw.net/user-default-pictures-uv/75305d54-c7cc-40d1-bb9c-91fbe85943c7-profile_image-150x150.png`;

        return {
            userId:      user.id,
            login:       user.login,
            displayName: user.displayName,
            thumbnail,
            description: user.description || '',
        };
    }

    // ─── Stream Status ─────────────────────────────────────────────────────────

    async _fetchStreamByLogin(login) {
        const data = await this._gql(`{
            user(login: "${login}") {
                id
                login
                displayName
                profileImageURL(width: 70)
                stream {
                    id
                    title
                    viewersCount
                    game { name }
                    createdAt
                    previewImageURL(width: 440, height: 248)
                }
            }
        }`);

        const user = data?.user;
        if (!user) return null;

        const thumbnail = user.profileImageURL
            || `https://static-cdn.jtvnw.net/user-default-pictures-uv/75305d54-c7cc-40d1-bb9c-91fbe85943c7-profile_image-150x150.png`;

        return {
            userId:      user.id,
            login:       user.login,
            displayName: user.displayName,
            thumbnail,
            stream: user.stream ? {
                id:           user.stream.id,
                title:        user.stream.title        || 'Live Stream',
                gameName:     user.stream.game?.name   || '',
                viewerCount:  user.stream.viewersCount ?? 0,
                thumbnailUrl: user.stream.previewImageURL || '',
                startedAt:    user.stream.createdAt,
            } : null,
        };
    }

    // ─── Polling Loop ──────────────────────────────────────────────────────────

    async _poll() {
        const db = this.client?.database;
        if (!db) return;

        // Kumpulkan semua akun unik dari semua guild (dedupe per login)
        const allAccounts = new Map(); // login → { account, guilds[] }
        for (const guild of this.client.guilds.cache.values()) {
            const accounts = this.getAccounts(guild.id);
            for (const acc of accounts) {
                if (!acc.login || !acc.enabled || !acc.channelId) continue;
                if (!allAccounts.has(acc.login)) allAccounts.set(acc.login, []);
                allAccounts.get(acc.login).push({ guild, account: acc });
            }
        }

        for (const [login, entries] of allAccounts) {
            try {
                const result = await this._fetchStreamByLogin(login);
                if (!result) continue;

                for (const { guild, account } of entries) {
                    const sessionKey = `${guild.id}:${result.userId}`;
                    const dbKey      = `twitch-live-${guild.id}-${result.userId}`;
                    const wasLive    = this._liveSessions.has(sessionKey);
                    const isLive     = !!result.stream;

                    if (isLive && !wasLive) {
                        // Baru mulai live — simpan ke Map DAN DB agar survive restart
                        this._liveSessions.set(sessionKey, result.stream.id);
                        db.set(dbKey, result.stream.id);
                        await this._sendNotification(guild, account, result.stream);
                        info(`[Twitch] ${login} LIVE di guild ${guild.id}`);

                    } else if (!isLive && wasLive) {
                        // Baru offline — hapus dari Map DAN DB
                        this._liveSessions.delete(sessionKey);
                        db.delete(dbKey);
                        info(`[Twitch] ${login} offline di guild ${guild.id}`);
                    }
                }
            } catch (err) {
                warn(`[Twitch] Poll error untuk ${login}: ${err.message}`);
            }
        }
    }

    // ─── Discord Embed ─────────────────────────────────────────────────────────

    async _sendNotification(guild, account, streamData) {
        const channel = guild.channels.cache.get(account.channelId);
        if (!channel) return;

        const displayName = account.displayName || account.login;
        const streamUrl   = `https://twitch.tv/${account.login}`;

        let content = (account.message || '').trim();
        if (content) {
            content = content
                .replace(/{account}/g,  displayName)
                .replace(/{login}/g,    account.login)
                .replace(/{url}/g,      streamUrl)
                .replace(/{game}/g,     streamData?.gameName    || '')
                .replace(/{title}/g,    streamData?.title       || '')
                .replace(/{viewers}/g,  String(streamData?.viewerCount ?? 0));
        }

        const embed = new EmbedBuilder()
            .setColor(0x9146FF)
            .setAuthor({
                name:    `${displayName} sedang LIVE di Twitch!`,
                iconURL: account.thumbnail || undefined,
                url:     streamUrl,
            })
            .setTitle(streamData?.title || 'Live Stream')
            .setURL(streamUrl)
            .setTimestamp();

        if (streamData?.gameName) {
            embed.addFields({ name: '🎮 Game',   value: streamData.gameName, inline: true });
        }
        embed.addFields({ name: '🔗 Tonton', value: `[Buka Twitch](${streamUrl})`, inline: true });

        if (streamData?.thumbnailUrl) embed.setImage(streamData.thumbnailUrl);
        if (account.thumbnail)        embed.setThumbnail(account.thumbnail);

        await channel.send({ content: content || undefined, embeds: [embed] });
    }

    async sendTestNotification(guild, account) {
        return this._sendNotification(guild, account, {
            id:           'test',
            title:        '[TEST] Contoh judul stream',
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

    // Stub agar kode lama yang memanggil ini tidak error
    async subscribeUser()   {}
    async unsubscribeUser() {}
    verifySignature()       { return false; }
    async handleOnline()    {}
    async handleOffline()   {}
}

module.exports = TwitchNotifier;

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
const { warn }         = require('./Console');

const TOKEN_URL        = 'https://id.kick.com/oauth/token';
const API_BASE         = 'https://api.kick.com/public/v1';
const POLL_INTERVAL_MS = 2 * 60 * 1000; // cek tiap 2 menit

const AVATAR_CHECK_INTERVAL_MS = 60 * 60 * 1000;     // Cek profil basi tiap 1 jam
const AVATAR_STALE_MS          = 24 * 60 * 60 * 1000; // Profil dianggap basi setelah 24 jam tidak live
const HEALTH_FAIL_THRESHOLD    = 3;                   // DM owner setelah 3x poll gagal berturut-turut
const VALIDITY_CHECK_INTERVAL_MS = 15 * 60 * 1000;    // Cek validitas akun tiap 15 menit
const ACCOUNT_FAIL_THRESHOLD     = 4;                 // ~1 jam gagal berturut-turut → tandai bermasalah

class KickNotifier {
    constructor(client) {
        this.client          = client;
        this._pollTimer      = null;
        this._avatarTimer    = null;
        this._validityTimer  = null;
        this._liveSessions   = new Map(); // "guildId:slug" → streamId

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
        this._loadLiveSessions();
        this._poll().catch(err => warn(`[Kick] Poll awal error: ${err.message}`));
        this._pollTimer = setInterval(
            () => this._poll().catch(err => warn(`[Kick] Poll error: ${err.message}`)),
            POLL_INTERVAL_MS
        );

        // Profil Kick (foto + nama) di-refresh opportunistic saat akun terdeteksi
        // live (lihat _poll), plus fallback berkala ini supaya akun yang jarang
        // live tidak pernah basi lebih dari 24 jam.
        setTimeout(() => {
            this._refreshStaleAvatars().catch(err => warn(`[Kick] Avatar refresh error: ${err.message}`));
            this._avatarTimer = setInterval(
                () => this._refreshStaleAvatars().catch(err => warn(`[Kick] Avatar refresh error: ${err.message}`)),
                AVATAR_CHECK_INTERVAL_MS
            );
        }, 10 * 60 * 1000);

        // Deteksi akun yang benar-benar sudah tidak ada (dihapus/banned — bukan
        // rename, karena rename sudah self-heal otomatis di _poll()/_refreshStaleAvatars).
        // Setelah gagal berturut-turut, nonaktifkan otomatis + tandai "bermasalah"
        // di dashboard, supaya tidak silent-fail selamanya.
        setTimeout(() => {
            this._checkAccountValidity().catch(err => warn(`[Kick] Validity check error: ${err.message}`));
            this._validityTimer = setInterval(
                () => this._checkAccountValidity().catch(err => warn(`[Kick] Validity check error: ${err.message}`)),
                VALIDITY_CHECK_INTERVAL_MS
            );
        }, 15 * 60 * 1000);
    }

    stop() {
        if (this._pollTimer)     clearInterval(this._pollTimer);
        if (this._avatarTimer)   clearInterval(this._avatarTimer);
        if (this._validityTimer) clearInterval(this._validityTimer);
        this._pollTimer = this._avatarTimer = this._validityTimer = null;
    }

    _loadLiveSessions() {
        const db = this.client?.database;
        if (!db) return;
        for (const guild of this.client.guilds.cache.values()) {
            for (const acc of this.getAccounts(guild.id)) {
                const key   = `kick-live-${guild.id}-${acc.slug}`;
                const saved = db.get(key);
                if (saved) this._liveSessions.set(`${guild.id}:${acc.slug}`, saved);
            }
        }
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

        // Deduplikasi per slug (key grouping pakai slug yang TERSIMPAN saat ini;
        // kalau ternyata sudah berganti nama, dikoreksi di bawah berdasarkan
        // broadcaster_user_id yang stabil).
        const allAccounts = new Map();
        for (const guild of this.client.guilds.cache.values()) {
            for (const acc of this.getAccounts(guild.id)) {
                if (!acc.enabled || !acc.channelId) continue;
                const key = acc.slug.toLowerCase();
                if (!allAccounts.has(key)) allAccounts.set(key, []);
                allAccounts.get(key).push({ guild, account: acc });
            }
        }
        if (allAccounts.size === 0) return;

        // Batch query semua akun sekaligus — prioritaskan broadcaster_user_id
        // (stabil walau username/slug berganti), slug cuma fallback untuk akun
        // lama yang belum punya userId tersimpan.
        const accountList = [...allAccounts.entries()].map(([slug, entries]) => ({
            slug,
            userId: entries[0].account.userId || null,
        }));

        let channels;
        try {
            channels = await this._fetchChannels(accountList);
        } catch (err) {
            await this._recordPollResult(false, err.message);
            return;
        }
        await this._recordPollResult(true);

        for (const [slug, entries] of allAccounts) {
            const userId  = entries[0].account.userId;
            const channel = userId ? channels.byUserId.get(String(userId)) : channels.bySlug.get(slug);
            const isLive  = !!channel?.stream?.is_live;
            const streamData = isLive ? this._toStreamData(channel) : null;

            for (const { guild, account } of entries) {
                // Auto-koreksi slug kalau streamer ganti username — broadcaster_user_id
                // tidak pernah berubah, jadi tetap match walau slug lama sudah invalid.
                let currentSlug = account.slug;
                if (channel?.slug && channel.slug.toLowerCase() !== slug) {
                    this._renameAccountSlug(guild, account.slug, channel.slug);
                    currentSlug = channel.slug;
                    account.slug = channel.slug;
                }

                // Pakai currentSlug (sudah dikoreksi di atas kalau rename) supaya
                // konsisten dengan key yang dipindahkan oleh _renameAccountSlug —
                // kalau masih pakai slug lama di sini, sesi live yang baru
                // dipindahkan tidak akan ke-detect dan memicu notif duplikat.
                const sessionKey = `${guild.id}:${currentSlug}`;
                const dbKey      = `kick-live-${guild.id}-${currentSlug}`;
                const wasLive    = this._liveSessions.has(sessionKey);

                if (isLive && !wasLive) {
                    this._liveSessions.set(sessionKey, String(streamData.id));
                    db.set(dbKey, String(streamData.id));

                    // Auto-refresh profil (foto + nama) saat live — kesempatan gratis,
                    // sudah perlu hit API untuk dapat data stream-nya.
                    const fresh = await this._refreshAccountProfile(guild, currentSlug).catch(() => null);
                    const freshAccount = {
                        ...account,
                        slug:        currentSlug,
                        displayName: fresh?.displayName || account.displayName || currentSlug,
                        thumbnail:   fresh?.thumbnail   || account.thumbnail,
                    };

                    await this._sendNotification(guild, freshAccount, streamData).catch(err =>
                        warn(`[Kick] Failed to send notification: ${err.message}`)
                    );

                } else if (!isLive && wasLive) {
                    this._liveSessions.delete(sessionKey);
                    db.delete(dbKey);
                }
            }
        }
    }

    // Ambil data channel untuk sekumpulan akun. broadcaster_user_id diutamakan
    // karena stabil (immune terhadap rename), slug dipakai sebagai fallback
    // untuk akun yang belum punya userId tersimpan.
    async _fetchChannels(accounts) {
        const userIds  = [...new Set(accounts.filter(a => a.userId).map(a => String(a.userId)))];
        const slugsOnly = [...new Set(accounts.filter(a => !a.userId).map(a => a.slug))];

        const [idChannels, slugChannels] = await Promise.all([
            this._fetchChannelsChunked('broadcaster_user_id', userIds),
            this._fetchChannelsChunked('slug', slugsOnly),
        ]);

        const byUserId = new Map(idChannels.map(c => [String(c.broadcaster_user_id), c]));
        const bySlug    = new Map(slugChannels.map(c => [c.slug.toLowerCase(), c]));
        return { byUserId, bySlug };
    }

    async _fetchChannelsChunked(paramName, values) {
        const out = [];
        if (values.length === 0) return out;
        const CHUNK_SIZE = 25; // batasi jumlah parameter per request agar query string tidak terlalu panjang
        for (let i = 0; i < values.length; i += CHUNK_SIZE) {
            const chunk = values.slice(i, i + CHUNK_SIZE);
            const query = chunk.map(v => `${paramName}=${encodeURIComponent(v)}`).join('&');
            let data = await this._apiGet(`/channels?${query}`);

            // Kick API mengembalikan HTTP 400 untuk SELURUH batch jika ada satu
            // value yang tidak valid (akun dihapus) — fallback ke per-value supaya
            // satu akun bermasalah tidak mematikan deteksi akun lain di chunk ini.
            if (!data?.data && chunk.length > 1) {
                const results = await Promise.all(
                    chunk.map(v => this._apiGet(`/channels?${paramName}=${encodeURIComponent(v)}`).catch(() => null))
                );
                data = { data: results.flatMap(r => r?.data || []) };
            }
            if (data?.data) out.push(...data.data);
        }
        return out;
    }

    _toStreamData(channel) {
        return {
            id:           channel.stream.start_time,
            stream_title: channel.stream_title,
            category:     channel.category,
            viewer_count: channel.stream.viewer_count,
            thumbnail:    channel.stream.thumbnail,
        };
    }

    _renameAccountSlug(guild, oldSlug, newSlug) {
        const accounts = this.getAccounts(guild.id);
        const idx = accounts.findIndex(a => a.slug === oldSlug);
        if (idx === -1) return;
        accounts[idx] = { ...accounts[idx], slug: newSlug };
        this.setAccounts(guild.id, accounts);

        // Pindahkan live-session tracking ke slug baru supaya tidak orphan &
        // tidak memicu notifikasi "live" palsu di siklus poll berikutnya.
        const oldSessionKey = `${guild.id}:${oldSlug}`;
        if (this._liveSessions.has(oldSessionKey)) {
            const streamId = this._liveSessions.get(oldSessionKey);
            this._liveSessions.delete(oldSessionKey);
            this._liveSessions.set(`${guild.id}:${newSlug}`, streamId);
            const db = this.client?.database;
            if (db) {
                db.delete(`kick-live-${guild.id}-${oldSlug}`);
                db.set(`kick-live-${guild.id}-${newSlug}`, streamId);
            }
        }

        warn(`[Kick] Slug berubah otomatis: "${oldSlug}" → "${newSlug}" (guild ${guild.name})`);
    }

    // ─── Poll Health Alert ─────────────────────────────────────────────────────
    // Rename sudah ditangani otomatis di atas — bagian ini untuk kasus yang TIDAK
    // bisa self-heal: kredensial dicabut/expired, Kick API down, dll. Setelah
    // gagal beruntun, DM owner sekali (tidak spam) supaya tidak ada yang sadar
    // notifikasi mati hanya karena kebetulan cek Discord.

    async _recordPollResult(success, errMessage) {
        const db = this.client?.database;
        if (!db) return;
        const failKey    = 'kick-poll-failures';
        const alertedKey = 'kick-poll-alerted';

        if (success) {
            const wasAlerted = db.get(alertedKey) === 'true';
            db.set(failKey, '0');
            if (wasAlerted) {
                db.set(alertedKey, 'false');
                await this._sendHealthDM(true).catch(err => warn(`[Kick/Health] Gagal kirim DM recovery: ${err.message}`));
            }
            return;
        }

        const failures = parseInt(db.get(failKey) || '0', 10) + 1;
        db.set(failKey, String(failures));
        warn(`[Kick] Poll gagal (${failures}/${HEALTH_FAIL_THRESHOLD}): ${errMessage}`);

        if (failures >= HEALTH_FAIL_THRESHOLD && db.get(alertedKey) !== 'true') {
            db.set(alertedKey, 'true');
            await this._sendHealthDM(false, errMessage).catch(err => warn(`[Kick/Health] Gagal kirim DM alert: ${err.message}`));
        }
    }

    async _sendHealthDM(isRecovery, errMessage) {
        const config  = require('../config');
        const ownerId = config.users?.ownerId;
        if (!ownerId) return;

        let owner;
        try { owner = await this.client.users.fetch(ownerId); }
        catch { warn('[Kick/Health] Gagal mengambil user owner dari Discord.'); return; }

        const embed = new EmbedBuilder()
            .setColor(isRecovery ? 0x57F287 : 0xED4245)
            .setTitle(isRecovery ? '✅ Kick API — Kembali Normal' : '⚠️ Kick API — Gagal Mengambil Data')
            .setTimestamp();

        if (isRecovery) {
            embed.setDescription('Polling Kick berhasil kembali normal. Semua notifikasi live berjalan seperti biasa.');
        } else {
            embed.setDescription(
                `Polling Kick gagal **${HEALTH_FAIL_THRESHOLD}x berturut-turut**.\n` +
                `Error terakhir: \`${(errMessage || '').slice(0, 200)}\`\n\n` +
                'Kemungkinan: KICK_CLIENT_ID/SECRET expired/dicabut, atau Kick API sedang down.'
            );
        }

        try { await owner.send({ embeds: [embed] }); }
        catch (err) { warn(`[Kick/Health] Gagal kirim DM ke owner: ${err.message}`); }
    }

    // ─── Profile Refresh ───────────────────────────────────────────────────────

    async _refreshAccountProfile(guild, slug) {
        const accounts = this.getAccounts(guild.id);
        const idx      = accounts.findIndex(a => a.slug === slug);
        if (idx === -1) return null;
        const account = accounts[idx];
        if (!account.userId) return null;

        const userData = await this._apiGet(`/users?id=${account.userId}`);
        const user      = userData?.data?.[0];
        if (!user) return null;

        const freshThumbnail = user.profile_picture || account.thumbnail;
        const freshName      = user.name || account.displayName || slug;
        const changed        = freshThumbnail !== account.thumbnail || freshName !== account.displayName;

        accounts[idx] = { ...account, thumbnail: freshThumbnail, displayName: freshName, thumbnailUpdatedAt: Date.now() };
        this.setAccounts(guild.id, accounts);

        return { displayName: freshName, thumbnail: freshThumbnail, changed };
    }

    // Fallback untuk akun yang jarang live — supaya foto profil/nama tidak
    // pernah basi lebih dari AVATAR_STALE_MS walau tidak pernah memicu refresh
    // opportunistic di _poll(). _poll() hanya mengoreksi rename untuk akun yang
    // enabled (live-detection aktif); sweep ini juga menutupi akun yang
    // disabled, supaya slug-nya tetap benar kalau nanti diaktifkan lagi.
    async _refreshStaleAvatars() {
        const now = Date.now();
        for (const guild of this.client.guilds.cache.values()) {
            for (const acc of this.getAccounts(guild.id)) {
                if (!acc.userId || acc.broken) continue;
                const lastUpdate = parseInt(acc.thumbnailUpdatedAt || '0', 10);
                if (now - lastUpdate < AVATAR_STALE_MS) continue;

                try {
                    const channelData = await this._apiGet(`/channels?broadcaster_user_id=${acc.userId}`);
                    const channel = channelData?.data?.[0];
                    if (channel?.slug && channel.slug !== acc.slug) {
                        this._renameAccountSlug(guild, acc.slug, channel.slug);
                    }
                } catch (err) {
                    warn(`[Kick] Gagal cek slug ${acc.slug}: ${err.message}`);
                }

                const currentSlug = this.getAccounts(guild.id).find(a => a.userId === acc.userId)?.slug || acc.slug;
                await this._refreshAccountProfile(guild, currentSlug).catch(err =>
                    warn(`[Kick] Gagal refresh profil ${currentSlug}: ${err.message}`)
                );
            }
        }
    }

    // ─── Account Validity (auto-disable akun yang dihapus/banned) ──────────────
    // Beda dengan rename (sudah self-heal di atas): ini untuk broadcaster_user_id
    // yang BENAR-BENAR tidak ditemukan lagi oleh Kick sama sekali. Gagal
    // API/network dianggap "valid" (fail-open) supaya outage sesaat tidak salah
    // menandai akun yang sebenarnya baik-baik saja.
    async _checkAccountValidity() {
        const candidates = []; // { guild, account }
        for (const guild of this.client.guilds.cache.values()) {
            for (const acc of this.getAccounts(guild.id)) {
                if (acc.broken || !acc.enabled || !acc.userId) continue;
                candidates.push({ guild, account: acc });
            }
        }
        if (candidates.length === 0) return;

        const userIds = [...new Set(candidates.map(c => String(c.account.userId)))];
        const foundIds = new Set();
        const CHUNK_SIZE = 25;
        try {
            for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
                const chunk = userIds.slice(i, i + CHUNK_SIZE);
                const query = chunk.map(id => `id=${encodeURIComponent(id)}`).join('&');
                const data  = await this._apiGet(`/users?${query}`);
                if (data === null) throw new Error('Kick /users API tidak merespon');
                for (const u of (data.data || [])) foundIds.add(String(u.user_id));
            }
        } catch {
            return; // Kick API down/error → fail-open, jangan tandai siapa pun
        }

        for (const { guild, account } of candidates) {
            this._applyValidityResult(guild, account.userId, foundIds.has(String(account.userId)));
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
            warn(`[Kick] Akun ditandai bermasalah & dinonaktifkan otomatis: ${account.slug} → ${guild.name}`);
        } else {
            accounts[idx] = { ...account, failCount };
            this.setAccounts(guild.id, accounts);
        }
    }

    // ─── Discord Embed ─────────────────────────────────────────────────────────

    async _sendNotification(guild, account, streamData) {
        const channel = guild.channels.cache.get(account.channelId);
        if (!channel) return;

        const displayName = account.displayName || account.slug;
        const streamUrl   = `https://kick.com/${account.slug}`;

        const fill = s => (s || '')
            .replace(/{account}/g,   displayName)
            .replace(/{slug}/g,      account.slug)
            .replace(/{url}/g,       streamUrl)
            .replace(/{category}/g,  streamData?.categories?.[0]?.name || streamData?.category?.name || '')
            .replace(/{title}/g,     streamData?.stream_title || streamData?.session_title || '')
            .replace(/{viewers}/g,   String(streamData?.viewer_count ?? streamData?.viewers ?? 0));

        const plainContent = fill(account.plainMessage || '').trim();
        const defaultDesc  = `Hey, **${displayName}** is **LIVE** on Kick right now!\nCome join and watch the stream~ 🎉`;
        const description  = fill(account.message || '').trim() || defaultDesc;

        const title    = streamData?.stream_title || 'Live Stream';
        const category = streamData?.category?.name || '';
        const thumbUrl = streamData?.thumbnail || '';

        const embed = new EmbedBuilder()
            .setColor(0x53FC18)
            .setTitle(`🔴 ${displayName} is Live!`)
            .setURL(streamUrl)
            .setDescription(description);

        embed.addFields({ name: '🎙️ Stream Title', value: title, inline: false });
        if (category) embed.addFields({ name: '🎮 Category', value: category, inline: true });
        embed.addFields({ name: '🔗 Link', value: `[Click Me ▶](${streamUrl})`, inline: true });

        if (thumbUrl)          embed.setImage(thumbUrl);
        if (account.thumbnail) embed.setThumbnail(account.thumbnail);

        const _kkBase = (process.env.BASE_URL || '').replace(/\/$/, '');
        const _kkFooter = { text: _kkBase ? 'Kick LIVE' : '🟢 Kick LIVE' };
        if (_kkBase) _kkFooter.iconURL = `${_kkBase}/img/kick.png`;
        embed.setFooter(_kkFooter).setTimestamp();

        try {
            await channel.send({ content: plainContent || undefined, embeds: [embed] });
        } catch (err) {
            warn(`[Kick] Failed to send notification to #${channel.name} (${guild.name}): ${err.message}`);
        }
    }

    async sendTestNotification(guild, account) {
        return this._sendNotification(guild, account, {
            slug:         account.slug,
            stream_title: '[TEST] Example stream title',
            category:     { name: 'Just Chatting' },
            viewer_count: 1234,
            thumbnail:    account.thumbnail || '',
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

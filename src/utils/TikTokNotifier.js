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

const POLL_INTERVAL_MS         = 5 * 60 * 1000;   // Video: 5 menit via RSSHub
const LIVE_POLL_INTERVAL_MS    = 3 * 60 * 1000;   // Live: 3 menit via WebSocket
const HEALTH_INTERVAL_MS       = 30 * 60 * 1000;  // Health check: 30 menit
const HEALTH_FAIL_THRESHOLD    = 3;               // Alert setelah 3x gagal berturut-turut
const LIVE_FAIL_THRESHOLD      = 3;               // Hapus liveKey setelah 3x gagal (bukan 2x)
const LIVE_NOTIF_COOLDOWN_MS   = 2 * 60 * 60 * 1000; // Cooldown 2 jam antar notif live

const RSSHUB_BASE = (process.env.RSSHUB_BASE_URL || 'https://rsshub.app').replace(/\/$/, '');

class TikTokNotifier {
    constructor(client) {
        this.client        = client;
        this._pollTimer    = null;
        this._liveTimer    = null;
        this._healthTimer  = null;
        this._isLiveCache  = new Map(); // username → { result, expiresAt }
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    start() {
        if (WebcastPushConnection) {
            info(`[TikTok] Video poll 5 menit (RSSHub: ${RSSHUB_BASE}) + live poll 3 menit + health monitor 30 menit.`);
            this._liveTimer = setInterval(() => this._pollLive(), LIVE_POLL_INTERVAL_MS);
        } else {
            info(`[TikTok] Video poll 5 menit (RSSHub: ${RSSHUB_BASE}) + health monitor 30 menit.`);
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
    }

    stop() {
        if (this._pollTimer)   clearInterval(this._pollTimer);
        if (this._liveTimer)   clearInterval(this._liveTimer);
        if (this._healthTimer) clearInterval(this._healthTimer);
        this._pollTimer = this._liveTimer = this._healthTimer = null;
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
            const diagnosis = await this._diagnoseTikTokAccount(username);
            throw new Error(diagnosis);
        }

        const xml = await res.text();
        if (!xml.includes('<item>') && !xml.includes('<entry>')) {
            throw new Error(`Account "${username}" has no public videos or is not recognized by RSSHub.`);
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

    async _diagnoseTikTokAccount(username) {
        const cleanUser = username.replace(/^@/, '');
        try {
            const res = await fetch(`https://www.tiktok.com/@${cleanUser}`, {
                signal:  AbortSignal.timeout(10_000),
                headers: {
                    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
            });

            if (res.status === 404) {
                return `TikTok account "${username}" not found. Make sure the username is correct.`;
            }

            if (!res.ok) {
                return `Account "${username}" is not accessible (HTTP ${res.status}). Please try again later.`;
            }

            const html = await res.text();

            // Cek akun private
            if (html.includes('"privateAccount":true') || html.includes('"isPrivateAccount":true')) {
                return `Account "${username}" is private 🔒. RSSHub cannot fetch the feed from a private account.`;
            }

            // Cek akun tidak ada / dinonaktifkan
            if (html.includes('user-not-found') || html.includes('Couldn\'t find this account')) {
                return `TikTok account "${username}" not found or has been deactivated.`;
            }

            // Cek tidak ada video
            if (html.includes('"videoCount":0') || html.includes('"itemCount":0')) {
                return `Account "${username}" has no public videos. Add at least 1 public video to enable monitoring.`;
            }

            // Akun ada tapi RSSHub masih gagal → kemungkinan rate limit atau TikTok block
            return `RSSHub failed to fetch the feed for "${username}". Possible reasons: private account, no videos, or TikTok is throttling access. Try again in a few minutes.`;

        } catch {
            // Jika TikTok juga tidak bisa diakses dari VPS
            return `RSSHub cannot fetch the feed for "${username}" (HTTP 503). Possible reasons: private account, no public videos, or TikTok is blocking access. Make sure the account is public and has videos.`;
        }
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

        for (const [username, guildEntries] of usernameMap) {
            try {
                const feedUrl = `${RSSHUB_BASE}/tiktok/user/${encodeURIComponent(username)}`;
                const res = await fetch(feedUrl, {
                    signal:  AbortSignal.timeout(12_000),
                    headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
                });
                if (!res.ok) {
                    warn(`[TikTok] Feed HTTP ${res.status} untuk ${username}`);
                    continue;
                }
                const entries = this._parseRssEntries(await res.text());
                if (entries.length === 0) continue;

                // Proses untuk setiap guild yang pantau username ini
                for (const { guild, account } of guildEntries) {
                    await this._processEntries(guild, db, account, entries).catch(err =>
                        warn(`[TikTok] Check error ${username} guild ${guild.id}: ${err.message}`)
                    );
                }
            } catch (err) {
                warn(`[TikTok] Poll error ${username}: ${err.message}`);
            }
        }
    }

    async _processEntries(guild, db, account, entries) {
        const lastKey   = `tiktok-lastVideo-${guild.id}-${account.username}`;
        const lastId    = db.get(lastKey);
        const latestId  = entries[0].id;

        if (!lastId) { db.set(lastKey, latestId); return; }
        if (lastId === latestId) return;

        const lastIdx    = entries.findIndex(e => e.id === lastId);
        const newEntries = lastIdx === -1 ? entries.slice(0, 3) : entries.slice(0, lastIdx);

        db.set(lastKey, latestId);
        for (const entry of [...newEntries].reverse()) {
            await this._sendVideoNotification(guild, account, entry).catch(err =>
                warn(`[TikTok] Kirim notif video error: ${err.message}`)
            );
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
        const isLive     = await this._isLive(account.username);
        const liveKey    = `tiktok-liveActive-${guild.id}-${account.username}`;
        const failKey    = `tiktok-liveFail-${guild.id}-${account.username}`;
        const notifAtKey = `tiktok-liveNotifAt-${guild.id}-${account.username}`;
        const wasLive    = !!db.get(liveKey);

        if (isLive) {
            db.delete(failKey);
            if (!wasLive) {
                // Cooldown: jangan kirim ulang jika sudah notif dalam 2 jam terakhir
                const lastNotif = parseInt(db.get(notifAtKey) || '0', 10);
                if (Date.now() - lastNotif < LIVE_NOTIF_COOLDOWN_MS) {
                    db.set(liveKey, String(Date.now())); // tandai live aktif tapi skip notif
                    return;
                }
                db.set(liveKey, String(Date.now()));
                db.set(notifAtKey, String(Date.now()));
                info(`[TikTok/Live] LIVE terdeteksi: ${account.username} → ${guild.name}`);
                await this._sendLiveNotification(guild, account).catch(err =>
                    warn(`[TikTok/Live] Failed to send notification: ${err.message}`)
                );
            }
        } else if (wasLive) {
            // Butuh LIVE_FAIL_THRESHOLD kali gagal berturut-turut sebelum live dianggap berakhir
            const fails = parseInt(db.get(failKey) || '0') + 1;
            if (fails >= LIVE_FAIL_THRESHOLD) {
                db.delete(liveKey);
                db.delete(failKey);
                info(`[TikTok/Live] Live berakhir: ${account.username}`);
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
        this._isLiveCache.set(username, { result, expiresAt: Date.now() + 2 * 60 * 1000 });

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

        info(`[TikTok] Video notif: "${entry.title}" | ${account.username} → ${guild.name}`);
        await discordCh.send({ embeds: [embed] }).catch(err =>
            warn(`[TikTok] Failed to send embed: ${err.message}`)
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
            || `Hey, **${displayName}** is **LIVE** on TikTok right now!\nCome join and watch the stream~ 🎉`;

        const embed = new EmbedBuilder()
            .setColor(0xFE2C55)
            .setTitle(`🔴 ${displayName} is Live Right Now!`)
            .setURL(liveUrl)
            .setDescription(description)
            .addFields(
                { name: '🔗 Link', value: `[Click Me ▶](${liveUrl})`, inline: false },
            );

        if (account.thumbnail) {
            embed.setThumbnail(account.thumbnail);
            embed.setImage(account.thumbnail);
        }

        const _ttBase = (process.env.BASE_URL || '').replace(/\/$/, '');
        const _ttLiveFooter = { text: _ttBase ? 'TikTok LIVE' : '🔴 TikTok LIVE' };
        if (_ttBase) _ttLiveFooter.iconURL = `${_ttBase}/img/tiktok.png`;
        embed.setFooter(_ttLiveFooter).setTimestamp();

        info(`[TikTok/Live] Live notif: ${account.username} → ${guild.name}`);
        await discordCh.send({ embeds: [embed] }).catch(err =>
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

        const feedUrl = `${RSSHUB_BASE}/tiktok/user/${encodeURIComponent(testUsername)}`;
        let healthy = false;
        try {
            const res = await fetch(feedUrl, {
                signal: AbortSignal.timeout(15_000),
                headers: { 'Cache-Control': 'no-cache' },
            });
            healthy = res.ok;
        } catch { healthy = false; }

        const failKey    = 'tiktok-health-failures';
        const alertedKey = 'tiktok-health-alerted';

        if (healthy) {
            const wasAlerted = db.get(alertedKey) === 'true';
            db.set(failKey, '0');
            if (wasAlerted) {
                db.set(alertedKey, 'false');
                info('[TikTok/Health] RSSHub kembali normal — kirim notif recovery ke owner.');
                await this._sendHealthDM(true).catch(err => warn(`[TikTok/Health] Failed to send recovery DM: ${err.message}`));
            }
        } else {
            const failures = parseInt(db.get(failKey) || '0') + 1;
            db.set(failKey, String(failures));
            warn(`[TikTok/Health] Health check failed (${failures}/${HEALTH_FAIL_THRESHOLD})`);

            if (failures >= HEALTH_FAIL_THRESHOLD && db.get(alertedKey) !== 'true') {
                db.set(alertedKey, 'true');
                info('[TikTok/Health] Threshold tercapai — kirim alert ke owner.');
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
                ? '✅ TikTok RSSHub — Kembali Normal'
                : '⚠️ TikTok RSSHub — Cookie Mungkin Expired')
            .setTimestamp();

        if (isRecovery) {
            embed.setDescription('RSSHub successfully resumed fetching TikTok feeds. All notifications are running normally.');
        } else {
            embed.setDescription(
                `RSSHub failed to respond **${HEALTH_FAIL_THRESHOLD} times in a row**.\n` +
                'TikTok cookies may have expired.'
            );
            embed.addFields({
                name: '📋 Cara Memperbarui Cookie',
                value:
                    '1. Login ke `tiktok.com` di browser\n' +
                    '2. DevTools → **Application** → **Cookies** → `tiktok.com`\n' +
                    '3. Copy nilai `sessionid` dan cookie lainnya\n' +
                    '4. Update `TIKTOK_COOKIE` di `~/rsshub/.env`\n' +
                    '5. Jalankan: `pm2 restart rsshub`',
                inline: false,
            });
            embed.addFields({
                name: '🔍 Verifikasi',
                value: '```bash\ncurl http://localhost:1200/tiktok/user/@username\n```\nIf it returns an XML feed → back to normal.',
                inline: false,
            });
        }

        try {
            await owner.send({ embeds: [embed] });
            info(`[TikTok/Health] DM terkirim ke owner: ${isRecovery ? 'recovery' : 'alert'}`);
        } catch (err) {
            warn(`[TikTok/Health] Failed to send DM to owner: ${err.message}`);
        }
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

            // Ekstrak thumbnail dari berbagai format RSS
            const thumbnail = this._extractEntryThumbnail(block);

            entries.push({
                id:    videoId,
                url,
                title:     titleM ? this._decodeXml(titleM[1]) : '(tanpa judul)',
                thumbnail,
            });
        }
        return entries;
    }

    _extractEntryThumbnail(block) {
        // 1. <media:content url="..." medium="image/video">
        let m = block.match(/<media:content[^>]+url=["']([^"']+)["']/i);
        if (m) return this._decodeXml(m[1]);

        // 2. <media:thumbnail url="...">
        m = block.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
        if (m) return this._decodeXml(m[1]);

        // 3. <enclosure url="..." type="image/...">
        m = block.match(/<enclosure[^>]+type=["']image\/[^"']*["'][^>]+url=["']([^"']+)["']/i)
          || block.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image\/[^"']*["']/i);
        if (m) return this._decodeXml(m[1]);

        // 4. <img src="..."> di dalam <description> (CDATA)
        const descM = block.match(/<description>([\s\S]*?)<\/description>/i);
        if (descM) {
            const imgM = this._decodeXml(descM[1]).match(/<img[^>]+src=["']([^"']+)["']/i);
            if (imgM) return imgM[1];
        }

        return null;
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

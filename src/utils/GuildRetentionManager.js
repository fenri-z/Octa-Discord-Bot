const { info, success, warn } = require('./Console');

const RETENTION_DAYS  = 14;
const RETENTION_MS    = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL  = 60 * 60 * 1000; // cek setiap 1 jam
const KEY_PREFIX      = 'guild-retention-';

class GuildRetentionManager {
    constructor(client) {
        this.client = client;
        this.db     = client.database;
        this._timer = null;
    }

    /**
     * Dipanggil saat bot keluar dari guild.
     * Menyimpan timestamp keluarnya bot ke database.
     */
    markGuildLeft(guildId) {
        this.db.set(`${KEY_PREFIX}${guildId}`, Date.now().toString());
        warn(`[Retention] Guild ${guildId} marked — data will be deleted in ${RETENTION_DAYS} days if bot doesn't rejoin.`);
    }

    /**
     * Dipanggil saat bot bergabung kembali ke guild dalam masa retensi.
     * Membatalkan penghapusan data.
     */
    cancelRetention(guildId) {
        if (this.db.has(`${KEY_PREFIX}${guildId}`)) {
            this.db.delete(`${KEY_PREFIX}${guildId}`);
            info(`[Retention] Guild ${guildId} rejoined within retention period — data preserved.`);
        }
    }

    /**
     * Hapus semua data guild dari database.
     * Mencari semua key yang mengandung guildId sebagai segment (dipisah dash).
     */
    _purgeGuildData(guildId) {
        return this.db.transaction(() => {
            // Key yang diakhiri -guildId  (e.g. welcome-enabled-12345)
            const c1 = this.db.deleteLike(`%-${guildId}`);
            // Key yang punya -guildId- di tengah  (e.g. autoreact-12345-panel)
            const c2 = this.db.deleteLike(`%-${guildId}-%`);
            // Hapus juga key retention itu sendiri (sudah tercakup c1, tapi eksplisit lebih aman)
            this.db.delete(`${KEY_PREFIX}${guildId}`);
            return c1 + c2;
        });
    }

    /**
     * Periksa semua guild yang sedang dalam masa retensi.
     * Dipanggil saat startup dan setiap CHECK_INTERVAL.
     */
    _checkExpired() {
        const keys = this.db.keysLike(`${KEY_PREFIX}%`);
        if (keys.length === 0) return;

        const now = Date.now();
        for (const key of keys) {
            const guildId = key.slice(KEY_PREFIX.length);
            const leftAt  = parseInt(this.db.get(key), 10);
            if (isNaN(leftAt)) continue;

            const elapsed = now - leftAt;
            const daysLeft = Math.ceil((RETENTION_MS - elapsed) / (24 * 60 * 60 * 1000));

            if (elapsed >= RETENTION_MS) {
                warn(`[Retention] Guild ${guildId} exceeded ${RETENTION_DAYS}-day retention — purging data...`);
                const count = this._purgeGuildData(guildId);
                success(`[Retention] Guild ${guildId} purged (${count} entries removed).`);
            } else {
                info(`[Retention] Guild ${guildId} — ${daysLeft} day(s) remaining before deletion.`);
            }
        }
    }

    start() {
        this._checkExpired();
        this._timer = setInterval(() => this._checkExpired(), CHECK_INTERVAL);
        info(`[Retention] GuildRetentionManager started — checking every hour, ${RETENTION_DAYS}-day grace period.`);
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }
}

module.exports = GuildRetentionManager;

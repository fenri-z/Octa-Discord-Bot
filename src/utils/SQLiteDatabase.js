/**
 * SQLiteDatabase — pengganti QuickYAML menggunakan better-sqlite3
 *
 * API yang diekspos identik dengan QuickYAML yang dipakai bot ini:
 *   .get(key)           → string | undefined
 *   .set(key, value)    → void
 *   .delete(key)        → void
 *   .has(key)           → boolean
 *
 * Semua operasi bersifat synchronous dan langsung ditulis ke disk
 * (WAL mode), sehingga tidak ada data yang hilang saat bot di-restart.
 */

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

class SQLiteDatabase {
    /**
     * @param {string} filePath  - Path file .db, misalnya './database.db'
     */
    constructor(filePath) {
        // Pastikan direktori ada
        const dir = path.dirname(path.resolve(filePath));
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        this._db = new Database(filePath);

        // WAL mode: write langsung ke disk, lebih cepat & aman dari crash
        this._db.pragma('journal_mode = WAL');
        this._db.pragma('synchronous = NORMAL');
        // Retry otomatis hingga 5 detik jika database sedang dikunci proses lain
        this._db.pragma('busy_timeout = 5000');
        // 64 MB page cache di RAM (negative = satuan KB)
        this._db.pragma('cache_size = -65536');
        // 256 MB memory-mapped I/O — baca DB langsung dari memori jika muat
        this._db.pragma('mmap_size = 268435456');
        // Tabel sementara di RAM bukan di disk
        this._db.pragma('temp_store = MEMORY');

        // Buat tabel jika belum ada
        this._db.exec(`
            CREATE TABLE IF NOT EXISTS kv (
                key   TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            )
        `);

        // Siapkan prepared statements untuk performa maksimal
        this._stmtGet    = this._db.prepare('SELECT value FROM kv WHERE key = ?');
        this._stmtSet    = this._db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)');
        this._stmtDelete = this._db.prepare('DELETE FROM kv WHERE key = ?');
        this._stmtHas    = this._db.prepare('SELECT 1 FROM kv WHERE key = ? LIMIT 1');
    }

    /**
     * Ambil nilai berdasarkan key.
     * @param {string} key
     * @returns {string | null}
     */
    get(key) {
        const row = this._stmtGet.get(key);
        return row ? row.value : null;
    }

    /**
     * Simpan nilai. Value harus bertipe string.
     * @param {string} key
     * @param {string} value
     */
    set(key, value) {
        this._stmtSet.run(key, value);
    }

    /**
     * Hapus key dari database.
     * @param {string} key
     */
    delete(key) {
        this._stmtDelete.run(key);
    }

    /**
     * Cek apakah key ada di database.
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
        return !!this._stmtHas.get(key);
    }

    /**
     * Jalankan serangkaian operasi sebagai satu transaksi SQLite yang atomic.
     * Aman untuk multi-process karena SQLite akan lock file selama transaksi.
     * @param {Function} fn  - Fungsi yang berisi operasi db
     * @returns {*} Nilai kembalian fn
     */
    transaction(fn) {
        return this._db.transaction(fn)();
    }

    /**
     * Coba ambil lock (mutex sederhana berbasis database).
     * Atomic: tidak ada proses lain yang bisa ambil lock yang sama di antara cek dan set.
     * @param {string} key  - Key lock
     * @returns {boolean}   true jika berhasil dapat lock, false jika sudah dikunci
     */
    tryLock(key) {
        return this.transaction(() => {
            if (this.has(key)) return false;
            this.set(key, '1');
            return true;
        });
    }

    /**
     * Lepas lock yang sudah diambil dengan tryLock().
     * @param {string} key
     */
    unlock(key) {
        this.delete(key);
    }

    /**
     * Atomic read-modify-write untuk nilai JSON array.
     * Aman digunakan dari multi-process karena dibungkus transaksi SQLite.
     * @param {string}   key  - Key database
     * @param {Function} fn   - fn(list: Array) → Array (list baru)
     * @returns {Array} List hasil modifikasi
     */
    modifyList(key, fn) {
        return this.transaction(() => {
            const raw = this.get(key);
            let list = [];
            try { list = raw ? JSON.parse(raw) : []; } catch {}
            const newList = fn(list);
            this.set(key, JSON.stringify(newList));
            return newList;
        });
    }

    /**
     * Ambil semua key yang cocok dengan pola SQL LIKE.
     * Gunakan % sebagai wildcard. Contoh: '%-123456789%'
     * @param {string} pattern
     * @returns {string[]}
     */
    keysLike(pattern) {
        const rows = this._db.prepare('SELECT key FROM kv WHERE key LIKE ?').all(pattern);
        return rows.map(r => r.key);
    }

    /**
     * Hitung entry yang cocok dengan pola (untuk server-side pagination).
     * @param {string} pattern  - SQL LIKE pattern, e.g. '%search%'
     * @returns {number}
     */
    countEntries(pattern = '%') {
        const row = this._db.prepare(
            "SELECT COUNT(*) as n FROM kv WHERE key LIKE ? AND key != 'error-logs'"
        ).get(pattern);
        return row ? row.n : 0;
    }

    /**
     * Ambil entry dengan pagination dan opsional filter (server-side).
     * @param {string} pattern
     * @param {number} limit
     * @param {number} offset
     * @returns {{ key: string, value: string }[]}
     */
    getEntriesPaged(pattern = '%', limit = 25, offset = 0) {
        return this._db.prepare(
            "SELECT key, value FROM kv WHERE key LIKE ? AND key != 'error-logs' ORDER BY key LIMIT ? OFFSET ?"
        ).all(pattern, limit, offset);
    }

    /**
     * Hapus semua key yang cocok dengan pola SQL LIKE.
     * @param {string} pattern
     * @returns {number} Jumlah baris yang dihapus
     */
    deleteLike(pattern) {
        const result = this._db.prepare('DELETE FROM kv WHERE key LIKE ?').run(pattern);
        return result.changes;
    }

    /**
     * Buat backup database ke file tujuan.
     * Menggunakan SQLite online backup API — aman dipakai saat DB sedang aktif.
     * @param {string} destPath  - Path file tujuan, e.g. './backups/backup-2026.db'
     * @returns {Promise<void>}
     */
    backup(destPath) {
        return this._db.backup(destPath);
    }

    /**
     * Tutup koneksi database (opsional, dipanggil saat proses berhenti).
     */
    close() {
        this._db.close();
    }
}

module.exports = SQLiteDatabase;

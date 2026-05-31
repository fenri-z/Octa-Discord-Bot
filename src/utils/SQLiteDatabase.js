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
     * Tutup koneksi database (opsional, dipanggil saat proses berhenti).
     */
    close() {
        this._db.close();
    }
}

module.exports = SQLiteDatabase;

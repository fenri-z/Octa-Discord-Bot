const path = require('path');
const fs   = require('fs');
const { success, warn } = require('./Console');

const BACKUP_DIR  = path.resolve('./backups');
const MAX_BACKUPS = 7;       // Simpan 7 backup terakhir
const INTERVAL_MS = 6 * 60 * 60 * 1000;  // Interval backup: setiap 6 jam

let _database      = null;
let _timer         = null;
let _lastBackupAt  = null;
let _lastBackupFile = null;

function _dateTag(d = new Date()) {
    // Format: 2026-06-12T14-30-00  (aman untuk nama file di semua OS)
    return d.toISOString().slice(0, 19).replace(/:/g, '-');
}

function _pruneOldBackups() {
    try {
        const entries = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('backup-') && f.endsWith('.db'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);   // terbaru di depan

        for (const entry of entries.slice(MAX_BACKUPS)) {
            fs.unlinkSync(path.join(BACKUP_DIR, entry.name));
        }
    } catch { /* abaikan — prune bukan operasi kritis */ }
}

async function runBackup() {
    if (!_database) return;
    try {
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

        const filename = `backup-${_dateTag()}.db`;
        const dest     = path.join(BACKUP_DIR, filename);

        // better-sqlite3 backup API: atomic, aman saat DB sedang aktif digunakan
        await _database.backup(dest);

        _lastBackupAt   = new Date();
        _lastBackupFile = filename;
        _pruneOldBackups();

        success(`[Backup] Saved → ${filename}`);
    } catch (err) {
        warn(`[Backup] Failed: ${err.message}`);
    }
}

/**
 * Mulai jadwal backup otomatis.
 * Backup pertama berjalan 30 detik setelah start (beri waktu bot selesai init).
 * @param {import('./SQLiteDatabase')} database
 */
function start(database) {
    _database = database;

    // Backup pertama setelah 30 detik
    setTimeout(() => {
        runBackup();
        // Lanjut setiap INTERVAL_MS
        _timer = setInterval(runBackup, INTERVAL_MS);
        _timer.unref();   // Jangan blokir proses exit jika hanya timer ini yang tersisa
    }, 30_000);
}

/** Hentikan jadwal backup (dipanggil saat graceful shutdown). */
function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

/**
 * Kembalikan status backup untuk health check endpoint.
 * @returns {{ lastBackup: string|null, backupCount: number, nextBackupIn: string }}
 */
function getStatus() {
    let backupCount = 0;
    try {
        if (fs.existsSync(BACKUP_DIR)) {
            backupCount = fs.readdirSync(BACKUP_DIR)
                .filter(f => f.startsWith('backup-') && f.endsWith('.db')).length;
        }
    } catch { /* abaikan */ }

    // Hitung waktu menuju backup berikutnya
    let nextIn = 'pending first backup';
    if (_lastBackupAt) {
        const msLeft = INTERVAL_MS - (Date.now() - _lastBackupAt.getTime());
        const hLeft  = Math.max(0, Math.floor(msLeft / 3_600_000));
        const mLeft  = Math.max(0, Math.floor((msLeft % 3_600_000) / 60_000));
        nextIn = `${hLeft}h ${mLeft}m`;
    }

    return {
        lastBackup:  _lastBackupAt?.toISOString() ?? null,
        lastFile:    _lastBackupFile ?? null,
        backupCount,
        nextBackupIn: nextIn,
        maxKept:     MAX_BACKUPS,
    };
}

module.exports = { start, stop, runBackup, getStatus };

const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const { spawnSync } = require('child_process');
const { google } = require('googleapis');
const { success, warn } = require('./Console');

const PROJECT_ROOT = path.resolve('.');
const BACKUP_DIR   = path.resolve('./backups');
const MAX_BACKUPS  = 7;
const INTERVAL_MS  = 6 * 60 * 60 * 1000;

// Entry .gitignore yang dilewati saat backup:
// - node_modules : terlalu besar, bisa install ulang
// - backups      : folder backup itu sendiri (hindari rekursi)
// - database.db* : ditangani terpisah via better-sqlite3 .backup() API
const SKIP_ENTRIES = new Set([
    'node_modules', 'node_modules/',
    'backups',      'backups/',
    'database.db',  'database.db-shm', 'database.db-wal',
]);

let _database       = null;
let _timer          = null;
let _lastBackupAt   = null;
let _lastBackupFile = null;

function _dateTag(d = new Date()) {
    return d.toISOString().slice(0, 19).replace(/:/g, '-');
}

/**
 * Baca .gitignore dan kembalikan daftar entry yang akan di-backup.
 */
function _parseGitignore() {
    const gitignorePath = path.join(PROJECT_ROOT, '.gitignore');
    if (!fs.existsSync(gitignorePath)) return [];

    return fs.readFileSync(gitignorePath, 'utf8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'))
        .filter(l => !SKIP_ENTRIES.has(l));
}

/**
 * Resolve entry .gitignore ke nama file/folder yang benar-benar ada.
 * Mendukung glob sederhana seperti *.log
 */
function _resolveTargets(entries) {
    const seen    = new Set();
    const targets = [];

    for (const entry of entries) {
        const clean = entry.replace(/\/$/, '');

        if (clean.includes('*')) {
            const suffix = clean.replace(/^\*/, '');
            try {
                for (const f of fs.readdirSync(PROJECT_ROOT)) {
                    if (f.endsWith(suffix) && !seen.has(f) && fs.existsSync(path.join(PROJECT_ROOT, f))) {
                        seen.add(f);
                        targets.push(f);
                    }
                }
            } catch { /* skip */ }
        } else {
            if (!seen.has(clean) && fs.existsSync(path.join(PROJECT_ROOT, clean))) {
                seen.add(clean);
                targets.push(clean);
            }
        }
    }

    return targets;
}

function _pruneOldBackups() {
    try {
        const entries = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('backup-') && f.endsWith('.tar.gz'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);

        for (const entry of entries.slice(MAX_BACKUPS)) {
            fs.unlinkSync(path.join(BACKUP_DIR, entry.name));
        }
    } catch { /* abaikan — prune bukan operasi kritis */ }
}

async function runBackup() {
    if (!_database) return;

    const tag      = _dateTag();
    const archive  = `backup-${tag}.tar.gz`;
    const archDest = path.join(BACKUP_DIR, archive);
    const tmpDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'octa-backup-'));

    try {
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

        // 1. Backup SQLite secara atomik ke tmpDir/database.db
        await _database.backup(path.join(tmpDir, 'database.db'));

        // 2. Salin file-file dari .gitignore ke tmpDir
        const targets = _resolveTargets(_parseGitignore());
        for (const target of targets) {
            const src = path.join(PROJECT_ROOT, target);
            const dst = path.join(tmpDir, target);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            spawnSync('cp', ['-r', src, dst], { stdio: 'pipe' });
        }

        // 3. Buat archive tar.gz dari semua isi tmpDir
        const result = spawnSync('tar', ['-czf', archDest, '-C', tmpDir, '.'], { stdio: 'pipe' });
        if (result.status !== 0) {
            throw new Error(result.stderr?.toString()?.trim() || 'tar gagal membuat archive');
        }

        _lastBackupAt   = new Date();
        _lastBackupFile = archive;
        _pruneOldBackups();

        success(`[Backup] Saved → ${archive} (database.db + ${targets.length} file lainnya)`);

        // Upload ke Google Drive (async, tidak blokir — gagal hanya log warning)
        _uploadToDrive(archDest, archive).catch(() => {});
    } catch (err) {
        warn(`[Backup] Failed: ${err.message}`);
    } finally {
        spawnSync('rm', ['-rf', tmpDir], { stdio: 'pipe' });
    }
}

/**
 * Cari waktu modifikasi backup terakhir dari folder backups/.
 * @returns {number|null} timestamp ms, atau null jika belum ada backup
 */
function _lastBackupMtime() {
    try {
        if (!fs.existsSync(BACKUP_DIR)) return null;
        const entries = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('backup-') && f.endsWith('.tar.gz'))
            .map(f => fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs);
        return entries.length ? Math.max(...entries) : null;
    } catch { return null; }
}

/**
 * Mulai jadwal backup otomatis.
 * Jika backup terakhir dibuat dalam rentang INTERVAL_MS, backup pertama ditunda
 * hingga sisa interval habis — sehingga restart bot tidak memicu backup ulang
 * yang tidak perlu.
 * @param {import('./SQLiteDatabase')} database
 */
function start(database) {
    _database = database;

    const lastMtime  = _lastBackupMtime();
    const elapsed    = lastMtime ? Date.now() - lastMtime : Infinity;
    const firstDelay = elapsed < INTERVAL_MS ? INTERVAL_MS - elapsed : 30_000;

    if (elapsed < INTERVAL_MS) {
        const mLeft = Math.ceil(firstDelay / 60_000);
        success(`[Backup] Backup terakhir baru ${Math.floor(elapsed / 60_000)} menit lalu — backup berikutnya dalam ~${mLeft} menit`);
    }

    setTimeout(() => {
        runBackup();
        _timer = setInterval(runBackup, INTERVAL_MS);
        _timer.unref();   // Jangan blokir proses exit jika hanya timer ini yang tersisa
    }, firstDelay);
}

/**
 * Upload file backup ke Google Drive.
 * Gagal upload tidak menghentikan backup lokal — hanya log warning.
 * @param {string} filePath path lengkap file yang akan diupload
 * @param {string} filename nama file di Google Drive
 */
async function _uploadToDrive(filePath, filename) {
    const oauthPath  = process.env.GDRIVE_OAUTH_PATH;
    const tokenPath  = process.env.GDRIVE_TOKEN_PATH;
    const folderId   = process.env.GDRIVE_FOLDER_ID;

    if (!oauthPath || !tokenPath || !folderId) return; // Drive tidak dikonfigurasi, skip

    try {
        const oauthCreds = JSON.parse(fs.readFileSync(path.resolve(oauthPath), 'utf8'));
        const token      = JSON.parse(fs.readFileSync(path.resolve(tokenPath), 'utf8'));
        const creds      = oauthCreds.installed || oauthCreds.web;

        const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret, creds.redirect_uris[0]);
        oauth2.setCredentials(token);

        // Simpan token baru jika di-refresh otomatis
        oauth2.on('tokens', (newTokens) => {
            const updated = { ...token, ...newTokens };
            fs.writeFileSync(path.resolve(tokenPath), JSON.stringify(updated, null, 2));
        });

        const drive = google.drive({ version: 'v3', auth: oauth2 });

        // Upload file baru ke folder Drive
        await drive.files.create({
            requestBody: {
                name:    filename,
                parents: [folderId],
            },
            media: {
                mimeType: 'application/gzip',
                body:     fs.createReadStream(filePath),
            },
        });

        // Hapus file lama di Drive, sisakan MAX_BACKUPS terakhir
        const list = await drive.files.list({
            q:       `'${folderId}' in parents and name contains 'backup-' and trashed = false`,
            fields:  'files(id, name, createdTime)',
            orderBy: 'createdTime desc',
        });

        const files = list.data.files ?? [];
        for (const file of files.slice(MAX_BACKUPS)) {
            await drive.files.delete({ fileId: file.id });
        }

        success(`[Backup] Uploaded → Google Drive (${filename})`);
    } catch (err) {
        warn(`[Backup] Drive upload failed: ${err.message}`);
    }
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
                .filter(f => f.startsWith('backup-') && f.endsWith('.tar.gz')).length;
        }
    } catch { /* abaikan */ }

    // Gunakan _lastBackupAt (in-memory) jika ada, fallback ke mtime file di disk
    let nextIn = 'pending first backup';
    const refTime = _lastBackupAt?.getTime() ?? _lastBackupMtime();
    if (refTime) {
        const msLeft = Math.max(0, INTERVAL_MS - (Date.now() - refTime));
        const hLeft  = Math.floor(msLeft / 3_600_000);
        const mLeft  = Math.floor((msLeft % 3_600_000) / 60_000);
        nextIn = `${hLeft}h ${mLeft}m`;
    }

    return {
        lastBackup:   _lastBackupAt?.toISOString() ?? null,
        lastFile:     _lastBackupFile ?? null,
        backupCount,
        nextBackupIn: nextIn,
        maxKept:      MAX_BACKUPS,
    };
}

module.exports = { start, stop, runBackup, getStatus };

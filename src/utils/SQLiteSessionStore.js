/**
 * SQLiteSessionStore — pengganti MemoryStore untuk express-session.
 * Memakai koneksi better-sqlite3 yang sudah ada (dari SQLiteDatabase._db)
 * sehingga tidak perlu package tambahan maupun koneksi database baru.
 *
 * Tabel `_sessions` dibuat otomatis di database yang sama dengan bot.
 * Sessions expired dibersihkan setiap 1 jam via setInterval.
 */

const { Store } = require('express-session');

class SQLiteSessionStore extends Store {
    /**
     * @param {import('better-sqlite3').Database} db - instance better-sqlite3 yang sudah terbuka
     */
    constructor(db) {
        super();
        this._db = db;

        this._db.exec(`
            CREATE TABLE IF NOT EXISTS _sessions (
                sid  TEXT    PRIMARY KEY NOT NULL,
                data TEXT    NOT NULL,
                exp  INTEGER NOT NULL
            )
        `);

        this._get     = this._db.prepare('SELECT data FROM _sessions WHERE sid = ? AND exp > ?');
        this._set     = this._db.prepare('INSERT OR REPLACE INTO _sessions (sid, data, exp) VALUES (?, ?, ?)');
        this._touch   = this._db.prepare('UPDATE _sessions SET exp = ? WHERE sid = ?');
        this._destroy = this._db.prepare('DELETE FROM _sessions WHERE sid = ?');
        this._clear   = this._db.prepare('DELETE FROM _sessions');
        this._count   = this._db.prepare('SELECT COUNT(*) AS n FROM _sessions WHERE exp > ?');
        this._prune   = this._db.prepare('DELETE FROM _sessions WHERE exp < ?');

        // Bersihkan session kedaluwarsa setiap 1 jam
        const timer = setInterval(() => this._prune.run(Date.now()), 3_600_000);
        if (timer.unref) timer.unref(); // jangan blokir exit Node.js
    }

    _expireAt(sess) {
        if (sess.cookie?.expires) return new Date(sess.cookie.expires).getTime();
        return Date.now() + 7 * 24 * 60 * 60 * 1000; // default 7 hari
    }

    get(sid, cb) {
        try {
            const row = this._get.get(sid, Date.now());
            cb(null, row ? JSON.parse(row.data) : null);
        } catch (e) { cb(e); }
    }

    set(sid, sess, cb) {
        try {
            this._set.run(sid, JSON.stringify(sess), this._expireAt(sess));
            cb(null);
        } catch (e) { cb(e); }
    }

    touch(sid, sess, cb) {
        try {
            this._touch.run(this._expireAt(sess), sid);
            cb(null);
        } catch (e) { cb(e); }
    }

    destroy(sid, cb) {
        try {
            this._destroy.run(sid);
            cb(null);
        } catch (e) { cb(e); }
    }

    length(cb) {
        try {
            cb(null, this._count.get(Date.now()).n);
        } catch (e) { cb(e); }
    }

    clear(cb) {
        try {
            this._clear.run();
            cb(null);
        } catch (e) { cb(e); }
    }
}

module.exports = SQLiteSessionStore;

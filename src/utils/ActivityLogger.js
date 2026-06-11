class ActivityLogger {
    static MAX_ENTRIES = 500;

    static log(db, action, detail = '', ip = '') {
        if (!db) return;
        try {
            const raw  = db.get('activity-log');
            const logs = raw ? JSON.parse(raw) : [];
            logs.unshift({ ts: Date.now(), action, detail, ip: ip || '' });
            if (logs.length > this.MAX_ENTRIES) logs.length = this.MAX_ENTRIES;
            db.set('activity-log', JSON.stringify(logs));
        } catch {}
    }

    static getAll(db) {
        if (!db) return [];
        try { return JSON.parse(db.get('activity-log') || '[]'); }
        catch { return []; }
    }

    static clear(db) {
        db?.delete('activity-log');
    }
}

module.exports = ActivityLogger;

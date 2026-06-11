/**
 * ErrorLogger — stores bot errors into the SQLite KV store.
 * Uses modifyList() for atomic read-modify-write so concurrent
 * writes don't corrupt the log array.
 */

const MAX_LOGS = 100;

class ErrorLogger {
    /**
     * Append an error entry to the rolling log.
     * @param {import('./SQLiteDatabase')} db
     * @param {'command_error'|'component_error'|'uncaught_exception'|'unhandled_rejection'} type
     * @param {string} message
     * @param {string} [stack]
     * @param {string} [context]  command/component name that caused the error
     */
    static log(db, type, message, stack = '', context = '') {
        if (!db) return;
        try {
            db.modifyList('error-logs', (list) => {
                const entry = {
                    id:      `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    type,
                    message: String(message || 'Unknown error').slice(0, 500),
                    stack:   String(stack   || '').slice(0, 3000),
                    context: String(context || '').slice(0, 100),
                    ts:      new Date().toISOString(),
                };
                list.unshift(entry);
                return list.slice(0, MAX_LOGS);
            });
        } catch { /* never throw — logging must not crash the bot */ }
    }

    /**
     * @param {import('./SQLiteDatabase')} db
     * @returns {Array}
     */
    static getAll(db) {
        if (!db) return [];
        try {
            const raw = db.get('error-logs');
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    }

    /**
     * @param {import('./SQLiteDatabase')} db
     */
    static clear(db) {
        if (!db) return;
        try { db.delete('error-logs'); } catch {}
    }
}

module.exports = ErrorLogger;

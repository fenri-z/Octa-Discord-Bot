const { error } = require('./Console');
const ErrorLogger = require('./ErrorLogger');

let _db = null;

/** Hubungkan ke database agar error juga tersimpan ke dev console. */
function init(db) { _db = db; }

/**
 * @param {string} context  - Label singkat, e.g. '[onMemberJoin]'
 * @param {unknown} err
 */
function logError(context, err) {
    const msg = err?.message || String(err);
    error(`${context} ${msg}`);
    if (_db) ErrorLogger.log(_db, 'event_handler_error', msg, err?.stack || '', context);
}

/**
 * Bungkus fungsi async agar error-nya dicatat tapi tidak crash.
 *
 * @param {string}   context
 * @param {Function} fn
 * @returns {Function}
 */
function safeRun(context, fn) {
    return async (...args) => {
        try {
            await fn(...args);
        } catch (err) {
            logError(context, err);
        }
    };
}

module.exports = { init, logError, safeRun };

const { error } = require('./Console');

/**
 * Log error dengan context tanpa crash bot.
 * Menggantikan .catch(() => null) di tempat-tempat kritikal.
 *
 * @param {string} context  - Label singkat, e.g. '[onMemberJoin]'
 * @param {unknown} err     - Error yang ditangkap
 */
function logError(context, err) {
    const msg = err?.message || String(err);
    error(`${context} ${msg}`);
}

/**
 * Bungkus fungsi async agar error-nya dicatat tapi tidak crash.
 * Berguna untuk wrapping event handler run().
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

module.exports = { logError, safeRun };

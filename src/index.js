require('dotenv').config();

const DiscordBot         = require('./client/DiscordBot');
const { startWebServer } = require('./web/server');
const YouTubeNotifier    = require('./utils/YouTubeNotifier');
const TikTokNotifier     = require('./utils/TikTokNotifier');
const ErrorLogger        = require('./utils/ErrorLogger');
const { warn, success, error: logErr } = require('./utils/Console');
const DatabaseBackup = require('./utils/DatabaseBackup');

const client = new DiscordBot();

process.on('uncaughtException', (err) => {
    console.error('[UncaughtException]', err);
    ErrorLogger.log(client.database, 'uncaught_exception', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error('[UnhandledRejection]', reason);
    ErrorLogger.log(client.database, 'unhandled_rejection', err.message, err.stack);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// PM2 sends SIGINT on restart/stop; SIGTERM on system shutdown.
// We flush SQLite WAL → main DB file before exiting so no data is lost.
let _shuttingDown = false;
async function gracefulShutdown(signal) {
    if (_shuttingDown) return;
    _shuttingDown = true;

    warn(`[Shutdown] ${signal} received — shutting down cleanly...`);

    try {
        // Stop all polling notifiers and backup scheduler
        DatabaseBackup.stop();
        client.youtubeNotifier?.stop?.();
        client.tiktokNotifier?.stop?.();
        client.twitchNotifier?.stop?.();
        client.kickNotifier?.stop?.();

        // Disconnect from Discord gateway (sends proper close frame)
        client.destroy();

        // Close SQLite — this checkpoints WAL and releases the file lock
        client.database?.close?.();

        success('[Shutdown] Clean exit.');
    } catch (err) {
        logErr(`[Shutdown] Error during shutdown: ${err.message}`);
    } finally {
        process.exit(0);
    }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// Jalankan web server dan notifier polling setelah event clientReady
client.once('clientReady', () => {
    const ytNotifier = new YouTubeNotifier(client);
    client.youtubeNotifier = ytNotifier;
    ytNotifier.start();

    const ttNotifier = new TikTokNotifier(client);
    client.tiktokNotifier = ttNotifier;
    ttNotifier.start();

    startWebServer(client);
    DatabaseBackup.start(client.database);
});

// Mulai koneksi ke Discord
client.connect();

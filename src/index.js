require('dotenv').config();

const DiscordBot         = require('./client/DiscordBot');
const { startWebServer } = require('./web/server');
const YouTubeNotifier    = require('./utils/YouTubeNotifier');
const TikTokNotifier     = require('./utils/TikTokNotifier');
const ErrorLogger        = require('./utils/ErrorLogger');

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

// Jalankan web server dan notifier polling setelah event clientReady
client.once('clientReady', () => {
    const ytNotifier = new YouTubeNotifier(client);
    client.youtubeNotifier = ytNotifier;
    ytNotifier.start();

    const ttNotifier = new TikTokNotifier(client);
    client.tiktokNotifier = ttNotifier;
    ttNotifier.start();

    startWebServer(client);
});

// Mulai koneksi ke Discord
client.connect();

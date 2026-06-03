require('dotenv').config();

const DiscordBot         = require('./client/DiscordBot');
const { startWebServer } = require('./web/server');
const YouTubeNotifier    = require('./utils/YouTubeNotifier');
const TikTokNotifier     = require('./utils/TikTokNotifier');

const client = new DiscordBot();

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

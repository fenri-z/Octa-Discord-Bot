require('dotenv').config();

const DiscordBot         = require('./client/DiscordBot');
const { startWebServer } = require('./web/server');
const YouTubeNotifier    = require('./utils/YouTubeNotifier');

const client = new DiscordBot();

// Jalankan web server dan YouTube polling setelah event clientReady
client.once('clientReady', () => {
    const notifier = new YouTubeNotifier(client);
    // Expose ke web routes agar API endpoint /youtube/lookup bisa mengaksesnya
    client.youtubeNotifier = notifier;
    notifier.start();

    startWebServer(client);
});

// Mulai koneksi ke Discord
client.connect();

require('dotenv').config();

const DiscordBot         = require('./client/DiscordBot');
const { startWebServer } = require('./web/server');

const client = new DiscordBot();

// Jalankan web server setelah event clientReady (Discord bot siap + cache terisi)
client.once('clientReady', () => {
    startWebServer(client);
});

// Mulai koneksi ke Discord
client.connect();

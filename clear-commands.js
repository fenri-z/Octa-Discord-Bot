/**
 * clear-commands.js
 *
 * Jalankan sekali untuk menghapus SEMUA command lama dari Discord API
 * dan mendaftarkan ulang dengan integration_types yang benar.
 *
 * Cara pakai:
 *   node clear-commands.js
 *
 * Butuh CLIENT_TOKEN dan CLIENT_ID di .env:
 *   CLIENT_TOKEN=...
 *   CLIENT_ID=...   ← Application ID dari Discord Developer Portal
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');

const token     = process.env.CLIENT_TOKEN;
const clientId  = process.env.CLIENT_ID;

if (!token || !clientId) {
    console.error('[ERROR] Pastikan CLIENT_TOKEN dan CLIENT_ID ada di file .env');
    console.error('        CLIENT_ID = Application ID dari Discord Developer Portal');
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log('[1/3] Mengambil daftar command yang terdaftar di Discord...');
        const existing = await rest.get(Routes.applicationCommands(clientId));
        console.log(`      Ditemukan ${existing.length} command terdaftar.`);

        if (existing.length > 0) {
            console.log('[2/3] Menghapus semua command lama...');
            await rest.put(Routes.applicationCommands(clientId), { body: [] });
            console.log('      Semua command berhasil dihapus.');
        } else {
            console.log('[2/3] Tidak ada command lama, skip.');
        }

        console.log('[3/3] Selesai. Sekarang jalankan bot dengan `npm start`.');
        console.log('      Bot akan mendaftarkan ulang semua command dengan');
        console.log('      integration_types yang benar saat startup.');
    } catch (err) {
        console.error('[ERROR]', err);
        process.exit(1);
    }
})();

'use strict';

// Cleanup script: hapus liveNotified keys yang salah di-seed untuk stream yang masih upcoming.
// Jalankan sekali di prod: node cleanup-upcoming-seeds.js

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.db');

async function isUpcoming(videoId) {
    try {
        const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
            method: 'POST',
            headers: {
                'Content-Type':             'application/json',
                'X-Youtube-Client-Name':    '1',
                'X-Youtube-Client-Version': '2.20231121.09.00',
            },
            body: JSON.stringify({
                videoId,
                context: { client: { clientName: 'WEB', clientVersion: '2.20231121.09.00', hl: 'en' } },
            }),
            signal: AbortSignal.timeout(8000),
        });
        const data = await res.json();
        return data?.videoDetails?.isUpcoming === true;
    } catch {
        return false;
    }
}

(async () => {
    const db   = new Database(DB_PATH);
    const rows = db.prepare("SELECT key FROM kv WHERE key LIKE 'youtube-liveNotified-%'").all();

    console.log(`Memeriksa ${rows.length} liveNotified key...`);

    let deleted = 0;
    for (const { key } of rows) {
        // Ambil videoId: 11 karakter terakhir setelah '-' terakhir
        const videoId = key.slice(key.lastIndexOf('-') + 1);
        if (videoId.length < 5) continue; // skip jika parse gagal

        const upcoming = await isUpcoming(videoId);
        if (upcoming) {
            db.prepare('DELETE FROM kv WHERE key = ?').run(key);
            console.log(`  [DELETED] ${key}`);
            deleted++;
        }
    }

    console.log(`\nSelesai. ${deleted} key dihapus dari total ${rows.length}.`);
    db.close();
})();

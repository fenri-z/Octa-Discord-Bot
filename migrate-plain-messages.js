/**
 * Migration: ubah plainMessage "" → null di semua guild
 *
 * Dijalankan SEKALI setelah update yang menambahkan default plain message.
 * Setelah migrasi, ?? operator di EJS akan menampilkan default untuk field
 * yang masih null (belum pernah diisi user), tapi tetap menghormati ""
 * (user sengaja mengosongkan).
 *
 * Jalankan:  node migrate-plain-messages.js
 */

'use strict';

const path         = require('path');
const SQLiteDatabase = require('./src/utils/SQLiteDatabase');
const config       = require('./src/config');

const dbPath = path.resolve(config.database.path);
console.log(`Database: ${dbPath}\n`);

const db = new SQLiteDatabase(dbPath);

let totalKeys    = 0;
let totalRecords = 0;
let totalFields  = 0;

function migrateList(pattern, fields) {
    const keys = db.keysLike(pattern);
    for (const key of keys) {
        const raw = db.get(key);
        if (!raw) continue;
        let list;
        try { list = JSON.parse(raw); } catch { continue; }
        if (!Array.isArray(list)) continue;

        let keyChanged = false;
        for (const item of list) {
            let recordChanged = false;
            for (const field of fields) {
                if (item[field] === '') {
                    item[field] = null;
                    totalFields++;
                    recordChanged = true;
                }
            }
            if (recordChanged) { totalRecords++; keyChanged = true; }
        }

        if (keyChanged) {
            db.set(key, JSON.stringify(list));
            totalKeys++;
            console.log(`  Updated: ${key}`);
        }
    }
}

console.log('YouTube channels...');
migrateList('youtube-channels-%', ['videoPlainMessage', 'shortPlainMessage', 'livePlainMessage']);

console.log('TikTok accounts...');
migrateList('tiktok-accounts-%', ['videoPlainMessage', 'livePlainMessage']);

console.log('Twitch accounts...');
migrateList('twitch-accounts-%', ['plainMessage']);

console.log('Kick accounts...');
migrateList('kick-accounts-%', ['plainMessage']);

console.log(`\nDone. ${totalKeys} guild key(s), ${totalRecords} record(s), ${totalFields} field(s) migrated.`);
db.close();

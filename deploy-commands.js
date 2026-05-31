/**
 * deploy-commands.js
 *
 * MODE:
 *   node deploy-commands.js              → daftarkan global (propagasi ~1 jam)
 *   node deploy-commands.js --guild      → daftarkan ke DEV_GUILD_ID saja (instan)
 *   node deploy-commands.js --guild <ID> → daftarkan ke guild ID tertentu (instan)
 *
 * Butuh di .env:
 *   CLIENT_TOKEN=...
 *   CLIENT_ID=...
 *   DEV_GUILD_ID=... (opsional, dipakai jika --guild tanpa ID)
 */

require('dotenv').config();
const { readdirSync } = require('fs');
const path = require('path');

// ── Validasi .env ──────────────────────────────────────────────────────────
const token    = process.env.CLIENT_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
    console.error('[ERROR] Pastikan CLIENT_TOKEN dan CLIENT_ID ada di file .env');
    process.exit(1);
}

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
    console.error(`[ERROR] Node.js v18+ diperlukan. Versi kamu: v${process.versions.node}`);
    process.exit(1);
}

// ── Parse argumen CLI ──────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const guildFlag   = args.includes('--guild');
const guildArgIdx = args.indexOf('--guild');
const guildId     = guildFlag
    ? (args[guildArgIdx + 1] && !args[guildArgIdx + 1].startsWith('--')
        ? args[guildArgIdx + 1]
        : process.env.DEV_GUILD_ID)
    : null;

if (guildFlag && !guildId) {
    console.error('[ERROR] --guild dipakai tapi tidak ada ID guild.');
    console.error('  Pakai: node deploy-commands.js --guild <GUILD_ID>');
    console.error('  Atau isi DEV_GUILD_ID di .env dan pakai: node deploy-commands.js --guild');
    process.exit(1);
}

// ── Kategorisasi command ───────────────────────────────────────────────────
const PUBLIC_COMMANDS  = new Set(['help', 'ping', 'invites']);
const PRIVATE_COMMANDS = new Set(['server', 'restart', 'offline']);

// ── Load semua application commands ───────────────────────────────────────
const commands = [];
const commandsPath = path.join(__dirname, 'src', 'commands');

console.log('Memuat command files...\n');

for (const dir of readdirSync(commandsPath)) {
    const dirPath = path.join(commandsPath, dir);
    let files;
    try { files = readdirSync(dirPath).filter(f => f.endsWith('.js')); }
    catch { continue; }

    for (const file of files) {
        try {
            const mod = require(path.join(dirPath, file));
            if (mod?.__type__ === 1 && mod?.command) {
                commands.push(mod.command);
                console.log(`  [load] ${dir}/${file}  →  /${mod.command.name}`);
            }
        } catch (e) {
            console.warn(`  [skip] ${dir}/${file}: ${e.message}`);
        }
    }
}

// ── Pisahkan command ───────────────────────────────────────────────────────
const publicCmds  = [];
const devOnlyCmds = [];

for (const cmd of commands) {
    const { aliases, ...cleanCmd } = cmd;
    if (PRIVATE_COMMANDS.has(cmd.name)) {
        devOnlyCmds.push({ ...cleanCmd, integration_types: [0], contexts: [0] });
    } else if (PUBLIC_COMMANDS.has(cmd.name)) {
        publicCmds.push({ ...cleanCmd, integration_types: [0], contexts: [0, 1] });
    } else {
        publicCmds.push({ ...cleanCmd, integration_types: [0], contexts: [0] });
    }
}

console.log(`\nTotal: ${publicCmds.length} public, ${devOnlyCmds.length} dev-only`);
console.log('Public  :', publicCmds.map(c => c.name).join(', ') || '(none)');
console.log('Dev-only:', devOnlyCmds.map(c => c.name).join(', ') || '(none)');
console.log('');

if (guildFlag) {
    console.log(`Mode: GUILD (instan) → Guild ID: ${guildId}`);
} else {
    console.log('Mode: GLOBAL (propagasi ~1 jam ke server baru)');
}
console.log('');

// ── Helper: PUT ke Discord API dengan retry ────────────────────────────────
const BASE = 'https://discord.com/api/v10';

async function discordPut(endpoint, body, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);

        try {
            const res = await fetch(`${BASE}${endpoint}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bot ${token}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'DiscordBot (deploy-commands, 1.0)',
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            const json = await res.json();

            if (res.status === 429) {
                const waitSec = Math.ceil(json.retry_after ?? 60);
                if (attempt < retries) {
                    console.warn(`\n  Rate limit! Menunggu ${waitSec} detik lalu retry...`);
                    for (let s = waitSec; s > 0; s--) {
                        process.stdout.write(`\r  Lanjut dalam ${s} detik...   `);
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    process.stdout.write('\r                                   \r');
                    continue;
                }
                const err = new Error('HTTP 429');
                err.status = 429; err.response = json;
                throw err;
            }

            if (!res.ok) {
                const err = new Error(`HTTP ${res.status}`);
                err.status = res.status; err.response = json;
                throw err;
            }

            return json;
        } finally {
            clearTimeout(timer);
        }
    }
}

// ── Jalankan ───────────────────────────────────────────────────────────────
(async () => {
    try {
        if (guildFlag) {
            // ── MODE GUILD: semua commands (termasuk dev-only) ke satu guild, instan ──
            const allCmds = [...publicCmds, ...devOnlyCmds];
            console.log(`[1/1] Mendaftarkan ${allCmds.length} commands ke guild ${guildId}...`);
            const result = await discordPut(
                `/applications/${clientId}/guilds/${guildId}/commands`,
                allCmds
            );
            console.log(`      OK — ${result.length} command terdaftar\n`);
            console.log('✅ Selesai! Guild commands aktif instan, tidak perlu tunggu.');

        } else {
            // ── MODE GLOBAL ────────────────────────────────────────────────────────
            console.log('[1/2] Mendaftarkan public commands secara global...');
            console.log(`      Mengirim ${publicCmds.length} commands...`);
            const globalResult = await discordPut(
                `/applications/${clientId}/commands`,
                publicCmds
            );
            console.log(`      OK — ${globalResult.length} command terdaftar\n`);

            if (devOnlyCmds.length > 0) {
                const devGuildId = process.env.DEV_GUILD_ID;
                if (!devGuildId) {
                    console.warn('[2/2] SKIP — DEV_GUILD_ID tidak ada di .env\n');
                } else {
                    console.log(`[2/2] Mendaftarkan dev-only commands ke guild ${devGuildId}...`);
                    const devResult = await discordPut(
                        `/applications/${clientId}/guilds/${devGuildId}/commands`,
                        devOnlyCmds
                    );
                    console.log(`      OK — ${devResult.length} command terdaftar di dev guild\n`);
                }
            } else {
                console.log('[2/2] Tidak ada dev-only commands, skip.\n');
            }

            console.log('✅ Global commands terdaftar!');
            console.log('   ⚠ Server BARU: commands muncul setelah ~1 jam (propagasi Discord).');
            console.log('   ✅ Server LAMA yang sudah ada bot: biasanya langsung aktif.');
            console.log('');
            console.log('   Tip: untuk testing di server baru, pakai mode guild agar instan:');
            console.log(`   node deploy-commands.js --guild <GUILD_ID>`);
        }

    } catch (err) {
        console.error('\n[ERROR] Gagal mendaftarkan commands:');
        if (err.name === 'AbortError') {
            console.error('  Request timeout setelah 30 detik.');
        } else if (err.status === 429) {
            const waitMin = Math.ceil((err.response?.retry_after ?? 0) / 60);
            console.error(`  Rate limit harian tercapai. Coba lagi dalam ~${waitMin} menit.`);
        } else if (err.status === 401) {
            console.error('  Token tidak valid atau expired.');
        } else if (err.status) {
            console.error(`  HTTP Status : ${err.status}`);
            console.error(`  Response    : ${JSON.stringify(err.response, null, 2)}`);
        } else {
            console.error(err);
        }
        process.exit(1);
    }
})();

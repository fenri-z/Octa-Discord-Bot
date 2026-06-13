/**
 * generateWelcomeCard.js — Enhanced welcome card with full customization
 * Uses sharp (SVG + compositing). Renders SVG at 2× density then downsamples
 * for crisp text, without the viewBox approach that breaks on older librsvg.
 */

const sharp = require('sharp');
const https = require('https');
const http  = require('http');

function fetchBuffer(url, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { timeout: 8000 }, (res) => {
            if ([301,302,307,308].includes(res.statusCode) && res.headers.location && maxRedirects > 0)
                return fetchBuffer(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end',  () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Fetch timeout')); });
    });
}

async function fetchAvatar(avatarUrl) {
    try {
        const buf  = await fetchBuffer(avatarUrl);
        const meta = await sharp(buf).metadata();
        if (!meta.format) throw new Error('Not an image');
        return buf;
    } catch {
        return sharp({ create: { width: 256, height: 256, channels: 4, background: { r:88, g:101, b:242, alpha:1 } } })
            .png().toBuffer();
    }
}

function escXml(s) {
    return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const FONT_MAP = {
    impact:  "Impact, 'Arial Black', sans-serif",
    arial:   'Arial, Helvetica, sans-serif',
    georgia: "Georgia, 'Times New Roman', serif",
    courier: "'Courier New', Courier, monospace",
    verdana: 'Verdana, Geneva, sans-serif',
};

// Render an SVG buffer at 2× density then resize down to target W×H
// This produces crisp text without relying on viewBox scaling.
async function svgAt2x(svgBuf, W, H) {
    return sharp(svgBuf, { density: 144 })   // 144 dpi = 2× default 72 dpi
        .resize(W, H, { kernel: sharp.kernel.lanczos3 })
        .png()
        .toBuffer();
}

async function generateWelcomeCard({
    avatarUrl      = null,
    avatarBuffer   = null,
    username       = 'Member',
    serverName     = 'Server',
    // Text content
    welcomeText    = 'WELCOME',
    userPrefix     = '',     // deprecated, diabaikan
    subText        = 'TO {server}',
    // Avatar
    avatarShape    = 'circle',
    // Background
    bgType         = 'gradient',  // 'gradient' | 'solid' | 'image' | 'transparent'
    bgColor        = '#1a1a2e',
    bgColor2       = '#16213e',
    bgImageUrl     = '',
    // Overlay
    overlayColor   = '#000000',
    overlayOpacity = 0,            // 0–100
    // Colors
    accentColor    = '#5865F2',
    titleColor     = '#ffffff',
    usernameColor  = '',
    messageColor   = '#cccccc',
    // Font
    fontFamily     = 'impact',
    // Legacy
    textColor      = '',
} = {}) {
    const W = 800, H = 260;
    const AS = 120, BD = 5;
    const AVL = 50;
    const AVT = Math.round((H - AS - BD * 2) / 2);   // 65
    const BT  = AS + BD * 2;                           // 130
    const TX  = AVL + BT + 40;                         // 240

    const resolvedTitle    = textColor    || titleColor    || '#ffffff';
    const resolvedUsername = usernameColor || accentColor  || '#5865F2';
    const resolvedMsg      = messageColor  || '#cccccc';
    const resolvedFont     = FONT_MAP[fontFamily] || FONT_MAP.impact;

    subText = (subText || '').replace(/{server}/gi, serverName);

    // ── Avatar ────────────────────────────────────────────────────────────
    let avBuf = avatarBuffer;
    if (!avBuf && avatarUrl) avBuf = await fetchAvatar(avatarUrl);
    if (!avBuf) avBuf = await sharp({
        create: { width: 256, height: 256, channels: 4, background: { r:88, g:101, b:242, alpha:1 } }
    }).png().toBuffer();

    const isSquare = avatarShape === 'square';

    // Mask at 2× for crisper edges, then resize to final size
    const AS2 = AS * 2;
    const maskSvg = isSquare
        ? `<svg width="${AS2}" height="${AS2}"><rect width="${AS2}" height="${AS2}" rx="32" ry="32"/></svg>`
        : `<svg width="${AS2}" height="${AS2}"><circle cx="${AS2/2}" cy="${AS2/2}" r="${AS2/2}"/></svg>`;
    const maskedAvatar = await sharp(avBuf)
        .resize(AS2, AS2, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
        .composite([{ input: Buffer.from(maskSvg), blend: 'dest-in' }])
        .png()
        .toBuffer()
        .then(buf => sharp(buf).resize(AS, AS, { kernel: sharp.kernel.lanczos3 }).png().toBuffer());

    const borderSvg = Buffer.from(isSquare
        ? `<svg width="${BT}" height="${BT}"><rect width="${BT}" height="${BT}" rx="20" ry="20" fill="${accentColor}"/></svg>`
        : `<svg width="${BT}" height="${BT}"><circle cx="${BT/2}" cy="${BT/2}" r="${BT/2}" fill="${accentColor}"/></svg>`
    );

    // ── Background layer ──────────────────────────────────────────────────
    let bgBuffer;
    let effectiveBgType = bgType;

    if (bgType === 'image' && bgImageUrl) {
        try {
            const raw = await fetchBuffer(bgImageUrl);
            bgBuffer  = await sharp(raw)
                .resize(W, H, { fit: 'cover', position: 'center', kernel: sharp.kernel.lanczos3 })
                .png().toBuffer();
        } catch { effectiveBgType = 'gradient'; }
    }

    if (!bgBuffer) {
        if (effectiveBgType === 'transparent') {
            bgBuffer = await sharp({
                create: { width: W, height: H, channels: 4, background: { r:0, g:0, b:0, alpha:0 } }
            }).png().toBuffer();
        } else {
            const bgSvg = effectiveBgType === 'solid'
                ? `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
                     <rect width="${W}" height="${H}" rx="20" fill="${bgColor}"/>
                   </svg>`
                : `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
                     <defs>
                       <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                         <stop offset="0%"   stop-color="${bgColor}"/>
                         <stop offset="100%" stop-color="${bgColor2 || bgColor}"/>
                       </linearGradient>
                     </defs>
                     <rect width="${W}" height="${H}" rx="20" fill="url(#bg)"/>
                   </svg>`;
            bgBuffer = await sharp(Buffer.from(bgSvg)).png().toBuffer();
        }
    }

    // ── Build composites ──────────────────────────────────────────────────
    const composites = [];

    // Overlay
    const op = Math.max(0, Math.min(100, Number(overlayOpacity) || 0));
    if (op > 0) {
        const overlaySvg = Buffer.from(
            `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
               <rect width="${W}" height="${H}" rx="20" fill="${overlayColor}" opacity="${(op/100).toFixed(2)}"/>
             </svg>`
        );
        composites.push({ input: await svgAt2x(overlaySvg, W, H), top: 0, left: 0 });
    }

    // Card decorations + text — rendered at 2× density for crispness
    const s = {
        w: escXml(welcomeText),
        u: escXml(username),
        t: escXml(subText),
    };
    const cardSvgBuf = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <!-- Decorative circles -->
  <circle cx="${W-60}" cy="40"       r="80" fill="${accentColor}" opacity="0.07"/>
  <circle cx="${W-20}" cy="${H-20}"  r="60" fill="${accentColor}" opacity="0.04"/>
  <!-- Title: stacked copy for soft glow without SVG filters -->
  <text x="${TX}" y="115" font-family="${resolvedFont}" font-size="56" font-weight="900"
        letter-spacing="3" fill="${resolvedTitle}" opacity="0.35">${s.w}</text>
  <text x="${TX}" y="115" font-family="${resolvedFont}" font-size="56" font-weight="900"
        letter-spacing="3" fill="${resolvedTitle}">${s.w}</text>
  <!-- Username: offset dark copy as shadow, then main text -->
  <text x="${TX}" y="159" font-family="${resolvedFont}" font-size="25" font-weight="700"
        fill="rgba(0,0,0,0.6)">${s.u}</text>
  <text x="${TX}" y="157" font-family="${resolvedFont}" font-size="25" font-weight="700"
        fill="${resolvedUsername}">${s.u}</text>
  <!-- Sub text -->
  <text x="${TX}" y="192" font-family="${resolvedFont}" font-size="17" font-weight="600"
        fill="${resolvedMsg}">${s.t}</text>
</svg>`);

    composites.push({ input: await svgAt2x(cardSvgBuf, W, H), top: 0, left: 0 });

    // Avatar border + masked avatar (all at output W×H coords)
    composites.push({ input: borderSvg,    top: AVT,        left: AVL        });
    composites.push({ input: maskedAvatar, top: AVT + BD,   left: AVL + BD   });

    return await sharp(bgBuffer)
        .composite(composites)
        .png({ compressionLevel: 6 })
        .toBuffer();
}

// ── Worker-thread support ─────────────────────────────────────────────────────
// File ini berfungsi ganda: sebagai modul biasa DAN sebagai worker script.
// Saat dijalankan sebagai worker, isMainThread = false → jalankan generasi lalu
// kirim buffer balik ke main thread. Ini mencegah sharp memblokir event loop.
const { Worker, isMainThread } = require('worker_threads');

if (!isMainThread) {
    const { workerData, parentPort } = require('worker_threads');
    console.log('[CardWorker] started');
    generateWelcomeCard(workerData)
        .then(buf => {
            console.log('[CardWorker] done, size:', buf.length);
            parentPort.postMessage(buf);
        })
        .catch(err => {
            console.error('[CardWorker] error:', err.message);
            parentPort.postMessage({ __error__: err.message });
        });
}

// Queue: max 2 worker threads active at once to prevent OOM under load
const MAX_CARD_WORKERS = 2;
let _activeCardWorkers = 0;
const _cardQueue = [];

const WORKER_TIMEOUT_MS = 20_000;

function _runCardJob({ options, resolve, reject }) {
    _activeCardWorkers++;
    const w = new Worker(__filename, { workerData: options });
    let settled = false;

    const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        _activeCardWorkers--;
        w.terminate();
        if (_cardQueue.length > 0) _runCardJob(_cardQueue.shift());
        reject(new Error('Card worker timed out'));
    }, WORKER_TIMEOUT_MS);

    const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        _activeCardWorkers--;
        if (_cardQueue.length > 0) _runCardJob(_cardQueue.shift());
    };
    w.once('message', r => {
        finish();
        if (r && r.__error__) reject(new Error(r.__error__));
        else resolve(r);
    });
    w.once('error', err => { finish(); reject(err); });
    w.once('exit', code => {
        if (!settled) { finish(); reject(new Error(`Card worker exited with code ${code}`)); }
    });
}

function generateCardAsync(options) {
    return new Promise((resolve, reject) => {
        if (_activeCardWorkers < MAX_CARD_WORKERS) {
            _runCardJob({ options, resolve, reject });
        } else {
            _cardQueue.push({ options, resolve, reject });
        }
    });
}

module.exports = { generateWelcomeCard, fetchAvatar, generateCardAsync };

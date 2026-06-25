/**
 * generateCard.js — Card generator for welcome, goodbye, boost, and unboost
 * Uses sharp (SVG + compositing). Renders SVG at 2× density then downsamples
 * for crisp text, without the viewBox approach that breaks on older librsvg.
 */

const sharp = require('sharp');
const https = require('https');
const http  = require('http');

const CLOUDFLARE_BLOCK_CODES = new Set([403, 429, 503]);

function fetchBufferDirect(url, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        let origin = '';
        try { origin = new URL(url).origin; } catch {}
        const req = mod.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                ...(origin ? { 'Referer': origin + '/' } : {}),
            },
        }, (res) => {
            if ([301,302,307,308].includes(res.statusCode) && res.headers.location && maxRedirects > 0)
                return fetchBufferDirect(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
            if (res.statusCode !== 200) {
                res.resume();
                const err = new Error(`HTTP ${res.statusCode}`);
                err.statusCode = res.statusCode;
                return reject(err);
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end',  () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Fetch timeout')); });
    });
}

async function fetchBuffer(url, maxRedirects = 5) {
    try {
        return await fetchBufferDirect(url, maxRedirects);
    } catch (err) {
        // Cloudflare or rate-limit block — retry through wsrv.nl image proxy
        const blocked = CLOUDFLARE_BLOCK_CODES.has(err.statusCode);
        const alreadyProxied = url.includes('wsrv.nl') || url.includes('images.weserv.nl');
        if (blocked && !alreadyProxied) {
            const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}&n=-1`;
            return fetchBufferDirect(proxyUrl, maxRedirects);
        }
        throw err;
    }
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
    impact:      "Impact, 'Arial Black', sans-serif",
    arial:       'Arial, Helvetica, sans-serif',
    georgia:     "Georgia, 'Times New Roman', serif",
    courier:     "'Courier New', Courier, monospace",
    verdana:     'Verdana, Geneva, sans-serif',
    discord:     "'GG Sans', Whitney, Inter, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif",
    bebasnew:    "'Bebas Neue', Impact, sans-serif",
    montserrat:  "'Montserrat', Arial, sans-serif",
    poppins:     "'Poppins', Arial, sans-serif",
    oswald:      "'Oswald', Arial, sans-serif",
    orbitron:    "'Orbitron', Arial, sans-serif",
    russoone:    "'Russo One', Impact, sans-serif",
    exo2:        "'Exo 2', Arial, sans-serif",
    rajdhani:    "'Rajdhani', Arial, sans-serif",
};

// Render an SVG buffer at 2× density then resize down to target W×H
// This produces crisp text without relying on viewBox scaling.
async function svgAt2x(svgBuf, W, H) {
    return sharp(svgBuf, { density: 144 })   // 144 dpi = 2× default 72 dpi
        .resize(W, H, { kernel: sharp.kernel.lanczos3 })
        .png()
        .toBuffer();
}

async function generateCard({
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
    // Layout
    cardLayout     = 'banner',  // 'banner' | 'classic'
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
    fontFamily     = 'poppins',
    // Legacy
    textColor      = '',
} = {}) {
    const resolvedTitle    = textColor    || titleColor    || '#ffffff';
    const resolvedUsername = usernameColor || accentColor  || '#5865F2';
    const resolvedMsg      = messageColor  || '#cccccc';
    const resolvedFont     = FONT_MAP[fontFamily] || FONT_MAP.impact;

    subText = (subText || '').replace(/{server}/gi, serverName);

    // ── Layout dimensions ─────────────────────────────────────────────────
    const isBanner = cardLayout !== 'classic';
    const W  = 1024;
    const H  = 420;
    const AS = isBanner ? 185 : 195;    // avatar size
    const BD = isBanner ? 8   : 6;      // border thickness
    const BT = AS + BD * 2;             // border total

    // ── Avatar position ───────────────────────────────────────────────────
    const AVL = isBanner
        ? Math.round((W - BT) / 2)          // centered horizontally
        : 45;                                // fixed left
    const AVT = isBanner
        ? 25                                 // top-center
        : Math.round((H - BT) / 2);         // vertically centered

    // ── Avatar ────────────────────────────────────────────────────────────
    let avBuf = avatarBuffer;
    if (!avBuf && avatarUrl) avBuf = await fetchAvatar(avatarUrl);
    if (!avBuf) avBuf = await sharp({
        create: { width: 256, height: 256, channels: 4, background: { r:88, g:101, b:242, alpha:1 } }
    }).png().toBuffer();

    const isSquare = avatarShape === 'square';

    // Mask at 2× for crisper edges, then resize to final size
    const AS2 = AS * 2;
    const squareRx = isBanner ? 40 : 36;
    const maskSvg = isSquare
        ? `<svg width="${AS2}" height="${AS2}"><rect width="${AS2}" height="${AS2}" rx="${squareRx*2}" ry="${squareRx*2}"/></svg>`
        : `<svg width="${AS2}" height="${AS2}"><circle cx="${AS2/2}" cy="${AS2/2}" r="${AS2/2}"/></svg>`;
    const maskedAvatar = await sharp(avBuf)
        .resize(AS2, AS2, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
        .composite([{ input: Buffer.from(maskSvg), blend: 'dest-in' }])
        .png()
        .toBuffer()
        .then(buf => sharp(buf).resize(AS, AS, { kernel: sharp.kernel.lanczos3 }).png().toBuffer());

    const bRx = isBanner ? 28 : 24;
    const borderSvg = Buffer.from(isSquare
        ? `<svg width="${BT}" height="${BT}"><rect width="${BT}" height="${BT}" rx="${bRx}" ry="${bRx}" fill="${accentColor}"/></svg>`
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

    let cardSvgBuf;
    if (isBanner) {
        // ── Banner layout: avatar top-center, text centered ───────────────
        const TEXT_W    = W - 120;
        const TITLE_Y   = 305, USER_Y = 352, SUB_Y = 390;
        const CX        = W / 2;

        const baseTitleFs  = 72;
        const approxCharW  = baseTitleFs * 0.58;
        const estimatedW   = welcomeText.length * approxCharW;
        const titleFs      = estimatedW > TEXT_W ? Math.max(30, Math.floor(baseTitleFs * TEXT_W / estimatedW)) : baseTitleFs;
        const titleLs      = titleFs < 52 ? 0 : 4;

        const baseUserFs   = 32;
        const estimatedUW  = username.length * baseUserFs * 0.6;
        const userFs       = estimatedUW > TEXT_W ? Math.max(18, Math.floor(baseUserFs * TEXT_W / estimatedUW)) : baseUserFs;

        cardSvgBuf = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><clipPath id="tc"><rect x="60" y="0" width="${TEXT_W}" height="${H}"/></clipPath></defs>
  ${effectiveBgType !== 'transparent' ? `<circle cx="80" cy="80" r="120" fill="${accentColor}" opacity="0.06"/>
  <circle cx="${W-80}" cy="${H-80}" r="100" fill="${accentColor}" opacity="0.05"/>` : ''}
  <text x="${CX}" y="${TITLE_Y}" text-anchor="middle" font-family="${resolvedFont}"
        font-size="${titleFs}" font-weight="900" letter-spacing="${titleLs}"
        fill="${resolvedTitle}" opacity="0.3" clip-path="url(#tc)">${s.w}</text>
  <text x="${CX}" y="${TITLE_Y}" text-anchor="middle" font-family="${resolvedFont}"
        font-size="${titleFs}" font-weight="900" letter-spacing="${titleLs}"
        fill="${resolvedTitle}" clip-path="url(#tc)">${s.w}</text>
  <text x="${CX}" y="${USER_Y+2}" text-anchor="middle" font-family="${resolvedFont}"
        font-size="${userFs}" font-weight="700" fill="rgba(0,0,0,0.55)" clip-path="url(#tc)">${s.u}</text>
  <text x="${CX}" y="${USER_Y}" text-anchor="middle" font-family="${resolvedFont}"
        font-size="${userFs}" font-weight="700" fill="${resolvedUsername}" clip-path="url(#tc)">${s.u}</text>
  <text x="${CX}" y="${SUB_Y}" text-anchor="middle" font-family="${resolvedFont}"
        font-size="20" font-weight="600" fill="${resolvedMsg}" clip-path="url(#tc)">${s.t}</text>
</svg>`);
    } else {
        // ── Classic layout: avatar left, text right ───────────────────────
        const TX      = AVL + BT + 50;  // text start x: 45 + 207 + 50 = 302
        const AVAIL_W = W - TX - 25;    // available text width: 1024 - 302 - 25 = 697

        const baseTitleFs = 84;
        const approxCharW = baseTitleFs * 0.62 + 3;
        const estimatedW  = welcomeText.length * approxCharW;
        const titleFs     = estimatedW > AVAIL_W ? Math.max(28, Math.floor(baseTitleFs * AVAIL_W / estimatedW)) : baseTitleFs;
        const titleLs     = titleFs < 52 ? 0 : 3;

        cardSvgBuf = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><clipPath id="tc"><rect x="${TX}" y="0" width="${AVAIL_W}" height="${H}"/></clipPath></defs>
  ${effectiveBgType !== 'transparent' ? `<circle cx="${W-60}" cy="40" r="80" fill="${accentColor}" opacity="0.07"/>
  <circle cx="${W-20}" cy="${H-20}" r="60" fill="${accentColor}" opacity="0.04"/>` : ''}
  <text x="${TX}" y="192" font-family="${resolvedFont}" font-size="${titleFs}" font-weight="900"
        letter-spacing="${titleLs}" fill="${resolvedTitle}" opacity="0.35" clip-path="url(#tc)">${s.w}</text>
  <text x="${TX}" y="192" font-family="${resolvedFont}" font-size="${titleFs}" font-weight="900"
        letter-spacing="${titleLs}" fill="${resolvedTitle}" clip-path="url(#tc)">${s.w}</text>
  <text x="${TX}" y="240" font-family="${resolvedFont}" font-size="34" font-weight="700"
        fill="rgba(0,0,0,0.6)" clip-path="url(#tc)">${s.u}</text>
  <text x="${TX}" y="238" font-family="${resolvedFont}" font-size="34" font-weight="700"
        fill="${resolvedUsername}" clip-path="url(#tc)">${s.u}</text>
  <text x="${TX}" y="275" font-family="${resolvedFont}" font-size="22" font-weight="600"
        fill="${resolvedMsg}" clip-path="url(#tc)">${s.t}</text>
</svg>`);
    }

    composites.push({ input: await svgAt2x(cardSvgBuf, W, H), top: 0, left: 0 });

    // Avatar border + masked avatar
    composites.push({ input: borderSvg,    top: AVT,      left: AVL      });
    composites.push({ input: maskedAvatar, top: AVT + BD, left: AVL + BD });

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
    generateCard(workerData)
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

module.exports = { generateCard, fetchAvatar, generateCardAsync };

/**
 * OCTA-BOT Web Dashboard — server.js
 * Express web server yang berjalan berdampingan dengan Discord bot.
 *
 * Cara pakai: file ini di-require dari src/index.js SETELAH bot connect.
 * So that the `client` (DiscordBot) object can be passed here and used
 * di semua route untuk baca data guild, member, dll.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../..', '.env') });

const express            = require('express');
const session            = require('express-session');
const passport           = require('passport');
const DiscordStrategy    = require('passport-discord').Strategy;
const path               = require('path');
const compression        = require('compression');
const Database           = require('better-sqlite3');
const SQLiteSessionStore = require('../utils/SQLiteSessionStore');
const config             = require('../config');
const i18next            = require('i18next');
const i18nextMiddleware  = require('i18next-http-middleware');
const Backend            = require('i18next-fs-backend');

// ─── i18next ──────────────────────────────────────────────────────────────────
i18next
    .use(Backend)
    .use(i18nextMiddleware.LanguageDetector)
    .init({
        backend: { loadPath: path.join(__dirname, 'locales/{{lng}}.json') },
        fallbackLng: 'en',
        supportedLngs: ['en', 'id'],
        detection: {
            order: ['session', 'cookie'],
            lookupSession: 'lang',
            lookupCookie: 'lang',
            caches: ['session', 'cookie'],
        },
        preload: ['en', 'id'],
        interpolation: { escapeValue: false },
    });

// ─── Buat app Express ────────────────────────────────────────────────────────
const app = express();

// Wajib saat di belakang reverse proxy (Nginx) agar Express tahu request
// aslinya HTTPS — tanpa ini session cookie secure:true tidak akan dikirim.
app.set('trust proxy', 1);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
    etag: true,
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─── Session (SQLite — menggantikan MemoryStore) ──────────────────────────────
// Buka koneksi DB terpisah khusus session agar tidak konflik dengan koneksi bot.
// SQLite WAL mode aman untuk multiple concurrent connections ke file yang sama.
const _sessionDb = new Database(path.resolve(config.database.path));
_sessionDb.pragma('journal_mode = WAL');
_sessionDb.pragma('synchronous = NORMAL');
_sessionDb.pragma('busy_timeout = 5000');

app.use(session({
    store: new SQLiteSessionStore(_sessionDb),
    secret: process.env.SESSION_SECRET || 'octa-secret-ganti-ini',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge:   1000 * 60 * 60 * 24 * 7, // 7 hari
        secure:   process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// ─── Passport (Discord OAuth2) ───────────────────────────────────────────────
passport.use(new DiscordStrategy({
    clientID:     process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL:  process.env.CALLBACK_URL || 'http://localhost:3000/auth/callback',
    scope:        ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, { ...profile, _accessToken: accessToken });
}));

passport.serializeUser((user, done)   => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

app.use(passport.initialize());
app.use(passport.session());
app.use(i18nextMiddleware.handle(i18next));

// ─── Inject client ke semua request ──────────────────────────────────────────
const ASSET_VER = Date.now(); // di-set sekali saat server start, ganti tiap restart/deploy
let discordClient = null;
app.use((req, res, next) => {
    req.discordClient  = discordClient;
    res.locals.user    = req.user || null;
    res.locals.assetVer = ASSET_VER;

    const botClientUser = discordClient?.user;
    res.locals.botNavName   = botClientUser?.username || 'OCTA BOT';
    res.locals.botNavAvatar = botClientUser?.avatar
        ? `https://cdn.discordapp.com/avatars/${botClientUser.id}/${botClientUser.avatar}.png?size=512`
        : 'https://cdn.discordapp.com/embed/avatars/0.png';

    res.locals.t           = req.t;
    res.locals.currentLang = req.language || 'en';

    next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
const authRoutes    = require('./routes/auth');
const dashRoutes    = require('./routes/dashboard');
const apiRoutes     = require('./routes/api');
const webhookRoutes = require('./routes/webhook');

app.use('/auth',      authRoutes);
app.use('/dashboard', dashRoutes);
app.use('/api',       apiRoutes);
// WebSub callback — harus public (tanpa auth), tapi tetap dapat req.discordClient
app.use('/webhook',   webhookRoutes);

app.get('/lang/:lng', (req, res) => {
    const supported = ['en', 'id'];
    const lng = supported.includes(req.params.lng) ? req.params.lng : 'en';
    req.session.lang = lng;
    res.cookie('lang', lng, { maxAge: 1000 * 60 * 60 * 24 * 365, httpOnly: false });
    const back = req.get('Referer') || '/';
    res.redirect(back);
});

app.get('/', (req, res) => {
    if (req.isAuthenticated()) return res.redirect('/dashboard');
    const botName = discordClient?.user?.username || 'OCTA BOT';
    res.render('index', { title: 'Home', botName, hasSidebar: false });
});

app.get('/privacy-policy', (req, res) => {
    res.render('pages/privacy-policy', { title: 'Privacy Policy', hasSidebar: false });
});

app.get('/terms-of-service', (req, res) => {
    res.render('pages/terms-of-service', { title: 'Terms of Service', hasSidebar: false });
});

app.get('/commands', (req, res) => {
    res.render('pages/commands', { title: 'Commands', hasSidebar: false });
});

app.get('/report-bug', (req, res) => {
    const u = req.user || null;
    res.render('pages/report-bug', {
        title: 'Report Bug', hasSidebar: false,
        reportUser: u ? { username: u.username, id: u.id } : null,
    });
});

const multer = require('multer');
const _bugUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 }, // maks 8 MB
    fileFilter: (req, file, cb) => {
        cb(null, /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype));
    },
}).single('image');

app.post('/report-bug', (req, res) => {
    _bugUpload(req, res, async (uploadErr) => {
        const webhookUrl = process.env.REPORT_WEBHOOK_URL;
        if (!webhookUrl) {
            return res.json({ success: false, message: 'Webhook is not configured.' });
        }

        const { firstName, lastName, discordUsername, discordId, message } = req.body;

        if (!firstName || !lastName || !discordUsername || !discordId || !message) {
            return res.json({ success: false, message: 'Semua field wajib diisi.' });
        }

        const imageFile = uploadErr ? null : req.file;

        const embed = {
            title: '🐛 Bug Report Baru',
            color: 0xED4245,
            fields: [
                { name: '👤 Nama',      value: `${firstName} ${lastName}`, inline: true  },
                { name: '🏷️ Discord',   value: `${discordUsername}`,        inline: true  },
                { name: '🆔 Discord ID', value: `\`${discordId}\``,          inline: true  },
                { name: '📝 Message',    value: message.slice(0, 1024),      inline: false },
            ],
            timestamp: new Date().toISOString(),
        };

        // Jika ada gambar, tambahkan sebagai image embed
        if (imageFile) {
            embed.image = { url: `attachment://${imageFile.originalname}` };
        }

        try {
            const botUser = discordClient?.user;
            const payload = {
                username:   botUser?.username || 'Bug Report',
                avatar_url: botUser?.avatar
                    ? `https://cdn.discordapp.com/avatars/${botUser.id}/${botUser.avatar}.png`
                    : undefined,
                embeds: [embed],
            };

            let r;
            if (imageFile) {
                // Kirim sebagai multipart/form-data agar gambar ikut terlampir
                const form = new FormData();
                form.append('payload_json', JSON.stringify(payload));
                form.append('files[0]', new Blob([imageFile.buffer], { type: imageFile.mimetype }), imageFile.originalname);
                r = await fetch(webhookUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) });
            } else {
                r = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(8_000),
                });
            }

            if (!r.ok) {
                const err = await r.text();
                console.error('[Report Bug] Webhook error:', r.status, err);
                return res.json({ success: false, message: 'Failed to send report. Please try again later.' });
            }

            res.json({ success: true, message: 'Report sent successfully! Thank you.' });
        } catch (err) {
            console.error('[Report Bug] Error:', err.message);
            res.json({ success: false, message: 'Failed to connect to server. Please try again later.' });
        }
    });
});

app.use((req, res) => {
    res.status(404).render('error', { hasSidebar: false, title: '404 Not Found', message: 'Page not found.' });
});

app.use((err, req, res, next) => {
    console.error('[WebServer Error]', err);
    res.status(500).render('error', { hasSidebar: false, title: '500 Error', message: 'Terjadi kesalahan pada server.' });
});

// ─── Export fungsi start ──────────────────────────────────────────────────────
/**
 * @param {import('../client/DiscordBot')} client
 */
function startWebServer(client) {
    discordClient = client;

    const PORT = process.env.WEB_PORT || 3000;
    app.listen(PORT, () => {
        console.log(`[WebServer] Dashboard berjalan di http://localhost:${PORT}`);
    });
}

module.exports = { startWebServer };

/**
 * OCTA-BOT Web Dashboard — server.js
 * Express web server yang berjalan berdampingan dengan Discord bot.
 *
 * Cara pakai: file ini di-require dari src/index.js SETELAH bot connect.
 * Sehingga object `client` (DiscordBot) bisa di-pass ke sini dan dipakai
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
    maxAge: '1h',
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
    return done(null, profile);
}));

passport.serializeUser((user, done)   => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

app.use(passport.initialize());
app.use(passport.session());

// ─── Inject client ke semua request ──────────────────────────────────────────
let discordClient = null;
app.use((req, res, next) => {
    req.discordClient = discordClient;
    res.locals.user   = req.user || null;

    const botClientUser = discordClient?.user;
    res.locals.botNavName   = botClientUser?.username || 'OCTA BOT';
    res.locals.botNavAvatar = botClientUser?.avatar
        ? `https://cdn.discordapp.com/avatars/${botClientUser.id}/${botClientUser.avatar}.png?size=64`
        : 'https://cdn.discordapp.com/embed/avatars/0.png';

    next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const dashRoutes = require('./routes/dashboard');
const apiRoutes  = require('./routes/api');

app.use('/auth',      authRoutes);
app.use('/dashboard', dashRoutes);
app.use('/api',       apiRoutes);

app.get('/', (req, res) => {
    if (req.isAuthenticated()) return res.redirect('/dashboard');
    res.render('index', { title: 'OCTA BOT', hasSidebar: false });
});

app.use((req, res) => {
    res.status(404).render('error', { hasSidebar: false, title: '404 Not Found', message: 'Halaman tidak ditemukan.' });
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

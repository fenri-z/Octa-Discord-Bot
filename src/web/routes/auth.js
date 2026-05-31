/**
 * routes/auth.js
 * Menangani login Discord OAuth2 dan logout.
 */

const express  = require('express');
const passport = require('passport');
const router   = express.Router();

// ── Login: redirect ke halaman Discord OAuth2 ────────────────────────────────
router.get('/login', passport.authenticate('discord'));

// ── Callback: Discord redirect ke sini setelah user approve ─────────────────
router.get('/callback',
    passport.authenticate('discord', {
        failureRedirect: '/?error=auth_failed'
    }),
    (req, res) => {
        // Berhasil login — redirect ke dashboard
        const returnTo = req.session.returnTo || '/dashboard';
        delete req.session.returnTo;
        res.redirect(returnTo);
    }
);

// ── Logout ────────────────────────────────────────────────────────────────────
router.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        req.session.destroy(() => {
            res.redirect('/');
        });
    });
});

module.exports = router;

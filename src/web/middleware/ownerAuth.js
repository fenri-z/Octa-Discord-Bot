const config = require('../../config');

/**
 * Pastikan user sudah login Discord DAN ID-nya adalah ownerId.
 * Jika belum login → redirect ke /auth/login.
 * Jika bukan owner → 403.
 */
function requireOwner(req, res, next) {
    if (!req.isAuthenticated()) {
        req.session.returnTo = req.originalUrl;
        return res.redirect('/auth/login');
    }
    if (req.user.id !== config.users.ownerId) {
        return res.status(403).render('error', {
            hasSidebar: false,
            title: '403 Forbidden',
            message: 'You do not have permission to access this page.',
        });
    }
    next();
}

/**
 * Setelah requireOwner, pastikan PIN sudah diverifikasi di sesi ini.
 * Jika belum → redirect ke /owner/verify.
 */
function requireOwnerPin(req, res, next) {
    if (!req.session.ownerVerified) {
        req.session.ownerReturnTo = req.originalUrl;
        return res.redirect('/dev-console/verify');
    }
    next();
}

module.exports = { requireOwner, requireOwnerPin };

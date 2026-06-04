'use strict';

/**
 * routes/webhook.js
 * Endpoint callback untuk YouTube WebSub (PubSubHubbub).
 * Harus bisa diakses publik — TIDAK perlu login.
 *
 * GET  /webhook/youtube  — verifikasi subscription dari hub
 * POST /webhook/youtube  — push notifikasi video baru dari YouTube
 */

const express = require('express');
const router  = express.Router();

// ── GET: verifikasi subscription ──────────────────────────────────────────────
router.get('/youtube', (req, res) => {
    const mode      = req.query['hub.mode'];
    const challenge = req.query['hub.challenge'];
    const topic     = req.query['hub.topic'] || '';

    if ((mode === 'subscribe' || mode === 'unsubscribe') && challenge) {
        // Pastikan topic adalah feed YouTube yang valid
        if (!topic.includes('youtube.com/xml/feeds/videos.xml')) {
            return res.status(404).send('Unknown topic');
        }

        // Catat subscription aktif
        if (mode === 'subscribe') {
            const channelIdM = topic.match(/channel_id=([\w-]+)/);
            if (channelIdM) {
                const notifier = req.discordClient?.youtubeNotifier;
                notifier?.onSubscribeVerified(channelIdM[1]);
            }
        }

        // Wajib: balas dengan hub.challenge agar hub menganggap verifikasi berhasil
        return res.status(200).type('text/plain').send(challenge);
    }

    res.status(400).send('Bad Request');
});

// ── POST: push notifikasi video baru ─────────────────────────────────────────
// express.raw() dipasang di sini supaya kita bisa verifikasi HMAC dari raw body
router.post('/youtube',
    express.raw({ type: ['application/atom+xml', 'application/xml', 'text/xml'], limit: '2mb' }),
    async (req, res) => {
        // Balas 200 secepatnya agar hub tidak retry
        res.status(200).send('OK');

        const notifier = req.discordClient?.youtubeNotifier;
        if (!notifier) return;

        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) return;

        // Verifikasi HMAC (jika YOUTUBE_WEBSUB_SECRET di-set)
        const signature = req.headers['x-hub-signature'];
        if (!notifier.verifySignature(body, signature)) {
            console.warn('[WebSub] Signature tidak valid, payload diabaikan.');
            return;
        }

        try {
            await notifier.handleWebhookPayload(body.toString('utf8'));
        } catch (err) {
            console.error('[WebSub] Error memproses payload:', err.message);
        }
    }
);

// ── POST: Twitch EventSub callback ────────────────────────────────────────────
// express.raw() dipasang agar kita bisa verifikasi HMAC dari raw body
router.post('/twitch',
    express.raw({ type: 'application/json', limit: '1mb' }),
    async (req, res) => {
        const messageId   = req.headers['twitch-eventsub-message-id']        || '';
        const timestamp   = req.headers['twitch-eventsub-message-timestamp'] || '';
        const signature   = req.headers['twitch-eventsub-message-signature'] || '';
        const messageType = req.headers['twitch-eventsub-message-type']      || '';

        const body    = req.body;
        const rawBody = Buffer.isBuffer(body) ? body.toString('utf8') : '';

        const notifier = req.discordClient?.twitchNotifier;

        // Verifikasi signature sebelum proses apapun
        if (notifier && !notifier.verifySignature(rawBody, messageId, timestamp, signature)) {
            return res.status(403).send('Forbidden');
        }

        let payload;
        try { payload = JSON.parse(rawBody); }
        catch { return res.status(400).send('Bad Request'); }

        // 1. Challenge verification — Twitch butuh jawaban segera
        if (messageType === 'webhook_callback_verification') {
            return res.status(200).type('text/plain').send(payload.challenge);
        }

        // Balas 200 secepatnya (max 3 detik menurut Twitch)
        res.status(200).send('OK');

        if (!notifier) return;

        try {
            // 2. Notification event
            if (messageType === 'notification') {
                const type  = payload.subscription?.type;
                const event = payload.event;
                if (!event) return;

                if (type === 'stream.online')  await notifier.handleOnline(event);
                if (type === 'stream.offline') await notifier.handleOffline(event);
            }

            // 3. Revocation — Twitch mencabut subscription (expired cookie, dll.)
            if (messageType === 'revocation') {
                const sub    = payload.subscription;
                const userId = sub?.condition?.broadcaster_user_id;
                const reason = sub?.status;
                console.warn(`[Twitch/Webhook] Subscription di-revoke (${reason}) untuk userId=${userId}`);
            }
        } catch (err) {
            console.error('[Twitch/Webhook] Error proses payload:', err.message);
        }
    }
);

module.exports = router;

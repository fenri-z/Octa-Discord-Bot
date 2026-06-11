/**
 * routes/owner.js
 * Owner-only panel: PIN verify, bot overview, guild list.
 * Semua route dilindungi requireOwner + requireOwnerPin (kecuali /verify).
 */

const express        = require('express');
const router         = express.Router();
const { ActivityType, ChannelType, EmbedBuilder } = require('discord.js');
const { requireOwner, requireOwnerPin } = require('../middleware/ownerAuth');
const ErrorLogger       = require('../../utils/ErrorLogger');
const ActivityLogger    = require('../../utils/ActivityLogger');

const VALID_STATUSES = new Set(['online', 'idle', 'dnd', 'invisible']);
const VALID_ACT_TYPES = new Set([0, 2, 3, 4, 5]); // Playing, Listening, Watching, Custom, Competing

// ── PIN Verification ──────────────────────────────────────────────────────────

router.get('/verify', requireOwner, (req, res) => {
    const error = req.query.error === '1' ? 'pin_wrong' : null;
    res.render('owner/pin', { title: 'Dev Console', hasSidebar: false, error });
});

router.post('/verify', requireOwner, (req, res) => {
    const pin     = (req.body.pin || '').trim();
    const envPin  = (process.env.OWNER_PIN || '').trim();

    if (!envPin) {
        return res.render('owner/pin', {
            title: 'Dev Console',
            hasSidebar: false,
            error: 'pin_not_configured',
        });
    }

    if (pin !== envPin) {
        return res.redirect('/dev-console/verify?error=1');
    }

    req.session.ownerVerified = true;
    const returnTo = req.session.ownerReturnTo || '/dev-console';
    delete req.session.ownerReturnTo;
    res.redirect(returnTo);
});

// Logout dari owner panel (hapus flag PIN, session utama tetap)
router.get('/logout', (req, res) => {
    req.session.ownerVerified = false;
    res.redirect('/');
});

// ── Semua route di bawah butuh PIN ───────────────────────────────────────────
router.use(requireOwner, requireOwnerPin);

// ── Maintenance Toggle ────────────────────────────────────────────────────────
router.post('/maintenance/toggle', (req, res) => {
    const client = req.discordClient;
    if (!client) return res.json({ success: false, message: 'Bot tidak tersedia.' });

    const isOn    = client.database.get('maintenance-mode') === '1';
    const newVal  = isOn ? '0' : '1';
    client.database.set('maintenance-mode', newVal);
    ActivityLogger.log(client.database, `Maintenance ${newVal === '1' ? 'ON' : 'OFF'}`, '', req.ip);

    res.json({ success: true, maintenance: newVal === '1' });
});

// ── Bot Status Control ────────────────────────────────────────────────────────
router.post('/status', (req, res) => {
    const client = req.discordClient;
    if (!client?.user) return res.json({ success: false, message: 'Bot tidak tersedia.' });

    const status   = req.body.status   || 'online';
    const actType  = parseInt(req.body.actType ?? '4', 10);
    const actName  = (req.body.actName || '').trim().slice(0, 128);

    if (!VALID_STATUSES.has(status))   return res.json({ success: false, message: 'Status tidak valid.' });
    if (!VALID_ACT_TYPES.has(actType)) return res.json({ success: false, message: 'Activity type tidak valid.' });

    client.user.setPresence({
        status,
        activities: actName ? [{ name: actName, type: actType }] : [],
    });

    client.database.set('bot-status',        status);
    client.database.set('bot-activity-type', String(actType));
    client.database.set('bot-activity-name', actName);
    ActivityLogger.log(client.database, 'Bot Status Changed', `${status}${actName ? ' — ' + actName : ''}`, req.ip);

    res.json({ success: true });
});

// ── Overview ─────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
    const client = req.discordClient;
    const mem    = process.memoryUsage();
    const upSec  = Math.floor(process.uptime());

    const totalGuilds = client?.guilds.cache.size  ?? 0;
    const totalUsers  = client?.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0) ?? 0;
    const ping        = client?.ws.ping ?? -1;

    const maintenance  = client?.database.get('maintenance-mode') === '1';
    const botStatus    = client?.database.get('bot-status')        || 'online';
    const botActType   = parseInt(client?.database.get('bot-activity-type') ?? '4', 10);
    const botActName   = client?.database.get('bot-activity-name') || '/help';

    const stats = {
        uptime:      _formatUptime(upSec),
        memRss:      _mb(mem.rss),
        memHeap:     _mb(mem.heapUsed),
        memHeapTotal:_mb(mem.heapTotal),
        totalGuilds,
        totalUsers,
        ping,
        nodeVersion: process.version,
        platform:    process.platform,
    };

    res.render('owner/index', { title: 'Dev Console', hasSidebar: true, activePage: 'index', stats, maintenance, botStatus, botActType, botActName });
});

// ── Stats API (real-time polling) ─────────────────────────────────────────────
router.get('/stats', (req, res) => {
    const client = req.discordClient;
    const mem    = process.memoryUsage();
    const upSec  = Math.floor(process.uptime());

    res.json({
        uptime:      _formatUptime(upSec),
        totalGuilds: client?.guilds.cache.size ?? 0,
        totalUsers:  client?.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0) ?? 0,
        ping:        client?.ws.ping ?? -1,
        memRss:      _mb(mem.rss),
        memHeap:     _mb(mem.heapUsed),
        memHeapTotal:_mb(mem.heapTotal),
    });
});

// ── Blacklist ─────────────────────────────────────────────────────────────────
router.get('/blacklist', (req, res) => {
    const client = req.discordClient;

    const userKeys  = client?.database.keysLike('blacklist-user-%')  ?? [];
    const guildKeys = client?.database.keysLike('blacklist-guild-%') ?? [];

    const users  = userKeys.map(k => ({ id: k.replace('blacklist-user-', '') }));
    const guilds = guildKeys.map(k => {
        const id    = k.replace('blacklist-guild-', '');
        const guild = client?.guilds.cache.get(id);
        return { id, name: guild?.name ?? null, icon: guild?.iconURL({ size: 64 }) ?? null };
    });

    res.render('owner/blacklist', { title: 'Blacklist Manager', hasSidebar: true, activePage: 'blacklist', users, guilds });
});

router.post('/blacklist/user/add', (req, res) => {
    const client = req.discordClient;
    if (!client) return res.json({ success: false, message: 'Bot tidak tersedia.' });

    const userId = (req.body.id || '').trim();
    if (!/^\d{17,20}$/.test(userId))
        return res.json({ success: false, message: 'User ID tidak valid (harus 17-20 digit).' });
    if (userId === client.user.id)
        return res.json({ success: false, message: 'Tidak bisa mem-blacklist bot sendiri.' });

    client.database.set(`blacklist-user-${userId}`, '1');
    ActivityLogger.log(client.database, 'Blacklist User Added', userId, req.ip);
    res.json({ success: true });
});

router.post('/blacklist/user/remove/:id', (req, res) => {
    const client = req.discordClient;
    if (!client) return res.json({ success: false, message: 'Bot tidak tersedia.' });

    client.database.delete(`blacklist-user-${req.params.id}`);
    ActivityLogger.log(client.database, 'Blacklist User Removed', req.params.id, req.ip);
    res.json({ success: true });
});

router.post('/blacklist/guild/add', (req, res) => {
    const client = req.discordClient;
    if (!client) return res.json({ success: false, message: 'Bot tidak tersedia.' });

    const guildId = (req.body.id || '').trim();
    if (!/^\d{17,20}$/.test(guildId))
        return res.json({ success: false, message: 'Guild ID tidak valid (harus 17-20 digit).' });

    client.database.set(`blacklist-guild-${guildId}`, '1');
    ActivityLogger.log(client.database, 'Blacklist Guild Added', guildId, req.ip);
    res.json({ success: true });
});

router.post('/blacklist/guild/remove/:id', (req, res) => {
    const client = req.discordClient;
    if (!client) return res.json({ success: false, message: 'Bot tidak tersedia.' });

    client.database.delete(`blacklist-guild-${req.params.id}`);
    ActivityLogger.log(client.database, 'Blacklist Guild Removed', req.params.id, req.ip);
    res.json({ success: true });
});

// ── Guild List ────────────────────────────────────────────────────────────────
router.get('/guilds', (req, res) => {
    const client = req.discordClient;
    if (!client) return res.render('owner/guilds', { title: 'Guild List', hasSidebar: true, activePage: 'guilds', guilds: [] });

    const guilds = [...client.guilds.cache.values()]
        .sort((a, b) => b.memberCount - a.memberCount)
        .map(g => ({
            id:          g.id,
            name:        g.name,
            memberCount: g.memberCount,
            ownerId:     g.ownerId,
            icon:        g.iconURL({ size: 64 }) || null,
            joinedAt:    g.joinedAt?.toISOString().slice(0, 10) ?? '—',
        }));

    res.render('owner/guilds', { title: 'Guild List', hasSidebar: true, activePage: 'guilds', guilds });
});

// Leave guild
router.post('/guilds/:id/leave', async (req, res) => {
    const client = req.discordClient;
    if (!client) return res.json({ success: false, message: 'Bot tidak tersedia.' });

    const guild = client.guilds.cache.get(req.params.id);
    if (!guild)  return res.json({ success: false, message: 'Guild tidak ditemukan.' });

    try {
        const name = guild.name, id = guild.id;
        await guild.leave();
        ActivityLogger.log(client.database, 'Left Guild', `${name} (${id})`, req.ip);
        res.json({ success: true, message: `Berhasil leave dari ${name}.` });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// ── Error Logs ────────────────────────────────────────────────────────────────
router.get('/logs', (req, res) => {
    const client = req.discordClient;
    const logs = ErrorLogger.getAll(client?.database);
    res.render('owner/logs', { title: 'Dev Console', hasSidebar: true, activePage: 'logs', logs });
});

router.post('/logs/clear', (req, res) => {
    const client = req.discordClient;
    ErrorLogger.clear(client?.database);
    ActivityLogger.log(client?.database, 'Error Logs Cleared', '', req.ip);
    res.json({ success: true });
});

// ── Database Viewer ───────────────────────────────────────────────────────────
router.get('/database', (req, res) => {
    const client = req.discordClient;
    if (!client?.database) return res.render('owner/database', { title: 'Dev Console', hasSidebar: true, activePage: 'database', entries: [] });

    const keys    = client.database.keysLike('%').filter(k => k !== 'error-logs');
    const entries = keys.map(k => ({ key: k, value: client.database.get(k) }));
    res.render('owner/database', { title: 'Dev Console', hasSidebar: true, activePage: 'database', entries });
});

router.post('/database/set', (req, res) => {
    const client = req.discordClient;
    if (!client?.database) return res.json({ success: false, message: 'DB unavailable.' });

    const key   = (req.body.key   || '').trim();
    const value = req.body.value  ?? '';

    if (!key)               return res.json({ success: false, message: 'Key is required.' });
    if (key === 'error-logs') return res.json({ success: false, message: 'Reserved key.' });

    client.database.set(key, String(value));
    ActivityLogger.log(client.database, 'Database Set', `key: ${key}`, req.ip);
    res.json({ success: true });
});

router.post('/database/delete/:key', (req, res) => {
    const client = req.discordClient;
    if (!client?.database) return res.json({ success: false, message: 'DB unavailable.' });

    const key = req.params.key;
    if (key === 'error-logs') return res.json({ success: false, message: 'Reserved key.' });

    client.database.delete(key);
    ActivityLogger.log(client.database, 'Database Delete', `key: ${key}`, req.ip);
    res.json({ success: true });
});

// ── Guild Inspector ───────────────────────────────────────────────────────────
router.get('/guilds/:id', (req, res) => {
    const client = req.discordClient;
    if (!client) return res.redirect('/dev-console/guilds');

    const guild = client.guilds.cache.get(req.params.id);
    if (!guild)  return res.redirect('/dev-console/guilds');

    const CH_ICON = {
        [ChannelType.GuildText]:         'hash',
        [ChannelType.GuildVoice]:        'volume-2',
        [ChannelType.GuildAnnouncement]: 'megaphone',
        [ChannelType.GuildStageVoice]:   'radio',
        [ChannelType.GuildForum]:        'layout-list',
        [ChannelType.GuildMedia]:        'image',
    };

    const buildCh = ch => ({
        id:   ch.id,
        name: ch.name,
        type: ch.type,
        icon: CH_ICON[ch.type] ?? 'hash',
        nsfw: ch.nsfw ?? false,
    });

    const categories = [...guild.channels.cache.values()]
        .filter(ch => ch.type === ChannelType.GuildCategory)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map(cat => ({
            id:   cat.id,
            name: cat.name,
            channels: [...guild.channels.cache.values()]
                .filter(ch => ch.parentId === cat.id && ch.type !== ChannelType.GuildCategory)
                .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                .map(buildCh),
        }));

    const uncategorized = [...guild.channels.cache.values()]
        .filter(ch => !ch.parentId && ch.type !== ChannelType.GuildCategory)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map(buildCh);

    const roles = [...guild.roles.cache.values()]
        .filter(r => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => ({
            id:          r.id,
            name:        r.name,
            color:       r.color !== 0 ? r.hexColor : null,
            hoist:       r.hoist,
            managed:     r.managed,
            memberCount: r.members.size,
        }));

    const PERM_LIST = [
        { key: 'Administrator',          label: 'Administrator',        danger: true  },
        { key: 'ManageGuild',            label: 'Manage Server',        danger: true  },
        { key: 'ManageChannels',         label: 'Manage Channels',      danger: true  },
        { key: 'ManageRoles',            label: 'Manage Roles',         danger: true  },
        { key: 'KickMembers',            label: 'Kick Members',         danger: true  },
        { key: 'BanMembers',             label: 'Ban Members',          danger: true  },
        { key: 'ModerateMembers',        label: 'Timeout Members',      danger: false },
        { key: 'ManageMessages',         label: 'Manage Messages',      danger: false },
        { key: 'ManageWebhooks',         label: 'Manage Webhooks',      danger: false },
        { key: 'ManageNicknames',        label: 'Manage Nicknames',     danger: false },
        { key: 'ViewChannel',            label: 'View Channels',        danger: false },
        { key: 'SendMessages',           label: 'Send Messages',        danger: false },
        { key: 'EmbedLinks',             label: 'Embed Links',          danger: false },
        { key: 'AttachFiles',            label: 'Attach Files',         danger: false },
        { key: 'ReadMessageHistory',     label: 'Read Message History', danger: false },
        { key: 'MentionEveryone',        label: 'Mention Everyone',     danger: false },
        { key: 'UseExternalEmojis',      label: 'Use External Emojis',  danger: false },
        { key: 'AddReactions',           label: 'Add Reactions',        danger: false },
        { key: 'Connect',                label: 'Connect (Voice)',       danger: false },
        { key: 'Speak',                  label: 'Speak (Voice)',         danger: false },
        { key: 'UseApplicationCommands', label: 'Use App Commands',     danger: false },
    ];

    const botMember = guild.members.me;
    const perms = PERM_LIST.map(p => ({ ...p, has: botMember?.permissions.has(p.key) ?? false }));

    const VERIF   = ['None', 'Low', 'Medium', 'High', 'Very High'];
    const owner   = guild.members.cache.get(guild.ownerId);

    res.render('owner/guild-detail', {
        title: guild.name,
        hasSidebar: true,
        activePage: 'guilds',
        guild: {
            id:                guild.id,
            name:              guild.name,
            icon:              guild.iconURL({ size: 256 }) ?? null,
            banner:            guild.bannerURL({ size: 512 }) ?? null,
            description:       guild.description ?? null,
            memberCount:       guild.memberCount,
            ownerId:           guild.ownerId,
            ownerTag:          owner?.user.tag ?? owner?.user.username ?? guild.ownerId,
            ownerAvatar:       owner?.user.displayAvatarURL({ size: 64 }) ?? null,
            createdAt:         guild.createdAt.toISOString().slice(0, 10),
            joinedAt:          guild.joinedAt?.toISOString().slice(0, 10) ?? '—',
            channelCount:      guild.channels.cache.filter(ch => ch.type !== ChannelType.GuildCategory).size,
            roleCount:         guild.roles.cache.size - 1,
            premiumTier:       guild.premiumTier,
            boostCount:        guild.premiumSubscriptionCount ?? 0,
            verificationLevel: VERIF[guild.verificationLevel] ?? 'Unknown',
        },
        categories,
        uncategorized,
        roles,
        perms,
    });
});

// ── Bot Restart ───────────────────────────────────────────────────────────────
router.post('/restart', (req, res) => {
    const client = req.discordClient;
    ActivityLogger.log(client?.database, 'Bot Restart Initiated', '', req.ip);
    res.json({ success: true });
    setTimeout(() => process.exit(0), 400);
});

// ── Command Manager ───────────────────────────────────────────────────────────
router.get('/commands', (req, res) => {
    const client = req.discordClient;

    const slashCmds = client
        ? [...client.collection.application_commands.values()].map(m => ({
            name:        m.command.name,
            description: m.command.description || '',
            options:     m.command.options?.length ?? 0,
        }))
        : [];

    const msgCmds = client
        ? [...client.collection.message_commands.values()].map(m => ({
            name:        m.command.name,
            description: m.command.description || '',
            aliases:     m.command.aliases ?? [],
        }))
        : [];

    res.render('owner/commands', {
        title: 'Command Manager',
        hasSidebar: true,
        activePage: 'commands',
        slashCmds,
        msgCmds,
    });
});

// ── Broadcast Message ─────────────────────────────────────────────────────────
router.get('/broadcast', (req, res) => {
    res.render('owner/broadcast', {
        title: 'Broadcast Message',
        hasSidebar: true,
        activePage: 'broadcast',
    });
});

router.post('/broadcast', async (req, res) => {
    const client = req.discordClient;
    if (!client) return res.json({ success: false, message: 'Bot tidak tersedia.' });

    const mode    = req.body.mode || 'text';
    const content = (req.body.message || '').trim();

    if (mode === 'text') {
        if (!content)              return res.json({ success: false, message: 'Pesan tidak boleh kosong.' });
        if (content.length > 2000) return res.json({ success: false, message: 'Pesan maksimal 2000 karakter.' });
    } else {
        const e = req.body.embed || {};
        if (!e.title && !e.description)
            return res.json({ success: false, message: 'Embed harus memiliki title atau description.' });
    }

    const guilds = [...client.guilds.cache.values()];
    let sent = 0, failed = 0;

    await Promise.allSettled(guilds.map(async (guild) => {
        try {
            const botMember = guild.members.me;
            const channel   = guild.channels.cache.find(ch =>
                ch.isTextBased() &&
                !ch.isThread() &&
                (!botMember || ch.permissionsFor(botMember)?.has(['SendMessages', 'ViewChannel']))
            );
            if (!channel) { failed++; return; }

            if (mode === 'embed') {
                const e     = req.body.embed || {};
                const embed = new EmbedBuilder();
                if (e.color)       try { embed.setColor(e.color); } catch {}
                if (e.author)      embed.setAuthor({ name: String(e.author).slice(0, 256) });
                if (e.title)       embed.setTitle(String(e.title).slice(0, 256));
                if (e.url)         try { embed.setURL(e.url); } catch {}
                if (e.description) embed.setDescription(String(e.description).slice(0, 4096));
                if (e.thumbnail)   try { embed.setThumbnail(e.thumbnail); } catch {}
                if (e.image)       try { embed.setImage(e.image); } catch {}
                if (e.footer)      embed.setFooter({ text: String(e.footer).slice(0, 2048) });
                if (e.timestamp)   embed.setTimestamp();
                await channel.send({ content: content || undefined, embeds: [embed] });
            } else {
                await channel.send(content);
            }
            sent++;
        } catch { failed++; }
    }));

    ActivityLogger.log(client.database, `Broadcast Sent (${mode})`, `${sent}/${guilds.length} delivered`, req.ip);
    res.json({ success: true, sent, failed, total: guilds.length });
});

// ── Eval Console ──────────────────────────────────────────────────────────────
router.get('/eval', (req, res) => {
    res.render('owner/eval', {
        title: 'Eval Console',
        hasSidebar: true,
        activePage: 'eval',
    });
});

router.post('/eval', async (req, res) => {
    const client = req.discordClient; // eslint-disable-line no-unused-vars
    const code   = (req.body.code || '').trim();

    if (!code) return res.json({ success: false, output: 'No code provided.', duration: 0 });

    const start = Date.now();
    try {
        let result = eval(code); // eslint-disable-line no-eval
        if (result && typeof result.then === 'function') result = await result;

        const duration = Date.now() - start;
        let output;
        if (result === undefined)          output = 'undefined';
        else if (result === null)          output = 'null';
        else if (typeof result === 'object') {
            try { output = JSON.stringify(result, null, 2); }
            catch { output = String(result); }
        } else { output = String(result); }

        ActivityLogger.log(client?.database, 'Eval Executed', code.slice(0, 120) + (code.length > 120 ? '…' : ''), req.ip);
        res.json({ success: true, output, duration });
    } catch (err) {
        ActivityLogger.log(client?.database, 'Eval Error', code.slice(0, 120) + (code.length > 120 ? '…' : ''), req.ip);
        res.json({ success: false, output: err.stack || err.message, duration: Date.now() - start });
    }
});

// ── Activity Log ──────────────────────────────────────────────────────────────
router.get('/activity', (req, res) => {
    const client = req.discordClient;
    const logs   = ActivityLogger.getAll(client?.database);
    res.render('owner/activity', { title: 'Activity Log', hasSidebar: true, activePage: 'activity', logs });
});

router.post('/activity/clear', (req, res) => {
    const client = req.discordClient;
    ActivityLogger.clear(client?.database);
    ActivityLogger.log(client?.database, 'Activity Log Cleared', '', req.ip);
    res.json({ success: true });
});

// ── Config Viewer ─────────────────────────────────────────────────────────────
router.get('/config', (req, res) => {
    const botConfig = require('../../config');
    const SENSITIVE = /TOKEN|SECRET|PIN|API_KEY|WEBHOOK/i;
    const mask = (val) => {
        if (!val) return '';
        const s = String(val);
        return s.length <= 8 ? '••••••••' : s.slice(0, 4) + '•'.repeat(Math.min(s.length - 4, 24));
    };

    const ENV_GROUPS = [
        { label: 'Discord Bot',  vars: ['CLIENT_TOKEN', 'CLIENT_ID', 'DEV_GUILD_ID'] },
        { label: 'OAuth2 / Web', vars: ['CLIENT_SECRET', 'CALLBACK_URL', 'WEB_PORT', 'SESSION_SECRET', 'OWNER_PIN', 'NODE_ENV'] },
        { label: 'YouTube',      vars: ['BASE_URL', 'YOUTUBE_API_KEY', 'YOUTUBE_WEBSUB_SECRET'] },
        { label: 'Twitch',       vars: ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'] },
        { label: 'Kick.com',     vars: ['KICK_CLIENT_ID', 'KICK_CLIENT_SECRET'] },
        { label: 'Other',        vars: ['RSSHUB_BASE_URL', 'REPORT_WEBHOOK_URL'] },
    ];

    const envData = ENV_GROUPS.map(g => ({
        label: g.label,
        entries: g.vars.map(key => {
            const raw = process.env[key] || '';
            const sensitive = SENSITIVE.test(key);
            return { key, raw, display: sensitive ? mask(raw) : (raw || '(empty)'), sensitive };
        }),
    }));

    const mem = process.memoryUsage();
    const runtime = {
        nodeVersion:  process.version,
        platform:     process.platform,
        arch:         process.arch,
        nodeEnv:      process.env.NODE_ENV || 'development',
        uptimeSec:    Math.floor(process.uptime()),
        memHeapUsed:  _mb(mem.heapUsed),
        memHeapTotal: _mb(mem.heapTotal),
        memRss:       _mb(mem.rss),
    };

    res.render('owner/config', {
        title: 'Config Viewer',
        hasSidebar: true,
        activePage: 'config',
        botConfig,
        envData,
        runtime,
    });
});

// ── Bot Invite Generator ──────────────────────────────────────────────────────
router.get('/invite', (req, res) => {
    const client = req.discordClient;
    res.render('owner/invite', {
        title: 'Invite Generator',
        hasSidebar: true,
        activePage: 'invite',
        clientId: client?.user?.id ?? '',
    });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function _mb(bytes) { return (bytes / 1024 / 1024).toFixed(1); }

function _formatUptime(sec) {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
}

module.exports = router;

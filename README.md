# OCTA BOT

A feature-rich Discord bot built with **discord.js v14** and a web dashboard, written entirely in JavaScript.

## Features

### Moderation
- Ban, kick, mute, warn members
- Auto-moderation (word/spam filter)
- Moderation log (audit trail)
- Anti-raid protection on member join

### Utility
- Welcome & Goodbye messages with custom image cards
- Autorole: on join, button-based, reaction-based, booster-based
- AFK system
- XP / leveling system with rank cards
- Leaderboard
- Giveaway system
- Poll system
- Ticket system
- Server stats channels (member count, etc.)
- Invite link monitor
- Starboard
- Custom commands per server
- Activity / extended logging (voice, message deletes, member changes)
- Language selection per server (English & Indonesian)

### Live Notifications
- YouTube live / new video notifications
- Twitch live notifications
- TikTok live notifications

### Web Dashboard
- Discord OAuth2 login
- Manage all bot settings per server from a browser
- Live preview for welcome & goodbye cards
- Message Builder (custom embed sender)
- Owner panel: server list, database viewer, broadcast, blacklist, backup, eval, logs, config

### Technical Highlights
- Slash commands, user context, message context, and prefix (message) commands
- Component handlers: Buttons, Select Menus, Modals, Autocomplete
- SQLite database via `better-sqlite3` (persistent, no separate DB server needed)
- SQLite-backed session store (sessions survive bot restarts)
- Image processing with `sharp` (rank cards, welcome/goodbye cards)
- i18n support via `i18next` (English & Indonesian)
- Google Drive integration for automated database backups
- ImgBB integration for image hosting

## Dependencies

```
discord.js              ^14.x
better-sqlite3          latest
dotenv                  latest
colors                  latest
express                 latest
express-session         latest
express-validator       latest
passport                latest
passport-discord        latest
ejs                     latest
compression             latest
sharp                   latest
i18next                 latest
i18next-fs-backend      latest
i18next-http-middleware latest
multer                  latest
googleapis              latest
tiktok-live-connector   latest
pm2                     latest
```

> Node.js v18 or newer is required.

## Quick Setup

See **[SETUP.md](./SETUP.md)** for the full installation and VPS deployment guide.

## Command Structure

### Application Command (Slash Command):

```js
new ApplicationCommand({
    command: APIApplicationCommand,
    options?: Partial<{
        cooldown: number,
        botOwner: boolean,
        guildOwner: boolean,
        botDevelopers: boolean,
    }>,
    run: async (client, interaction) => { }
});
```

### Message Command:

```js
new MessageCommand({
    command: {
        name: string,
        description?: string,
        aliases?: string[],
        permissions?: PermissionResolvable[],
    },
    options?: Partial<{
        cooldown: number,
        botOwner: boolean,
        guildOwner: boolean,
        botDevelopers: boolean,
        nsfw: boolean
    }>,
    run: async (client, message, args) => { }
});
```

## License

[GPL-3.0](./LICENSE)

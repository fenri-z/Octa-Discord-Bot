# OCTA BOT — Setup & Deployment Guide

## Prerequisites

- Node.js v18 or newer
- A Discord application and bot token from the [Discord Developer Portal](https://discord.com/developers/applications)

> **Note:** `better-sqlite3` and `sharp` are native Node.js modules. On most systems they install from prebuilt binaries automatically. If the build fails, install `build-essential` and `python3` first (`apt install -y build-essential python3`).

---

## 1. Install Dependencies

```bash
npm install
```

---

## 2. Install Fonts

The card generator (welcome/goodbye/rank/booster cards) renders text using system fonts. Run the included script to install all required fonts:

```bash
sudo bash scripts/install-fonts.sh
```

This installs:
- **System fonts**: Arial, Impact, Georgia, Verdana, Courier New (via `ttf-mscorefonts-installer`), Inter, Liberation
- **Google Fonts**: Bebas Neue, Montserrat, Poppins, Oswald, Orbitron, Russo One, Exo 2, Rajdhani

> If you skip this step, cards will still generate but will fall back to generic sans-serif fonts instead of the selected font style.

---

## 3. Configure the Bot

### `src/config.js`

Open `src/config.js` and fill in the following values:

| Field | Description |
|---|---|
| `development.guildId` | Guild ID used when `development.enabled` is `true` (commands register to this guild only, for faster testing) |
| `development.devGuildId` | Private guild ID for owner-only commands (these are never registered globally) |
| `commands.prefix` | Prefix for message (text) commands |
| `users.ownerId` | Your Discord user ID |
| `users.developers` | Array of developer Discord user IDs |

### `.env`

Create a `.env` file in the project root and fill in the required values:

```env
# ── Discord Bot ────────────────────────────────────────────
CLIENT_TOKEN="..."          # Bot token from Discord Developer Portal
CLIENT_ID="..."             # Application ID
DEV_GUILD_ID="..."          # Your private/dev guild ID

# ── Web Dashboard ──────────────────────────────────────────
CLIENT_SECRET="..."         # OAuth2 secret (Discord Developer Portal → OAuth2 → General)
CALLBACK_URL="http://localhost:3000/auth/callback"
WEB_PORT=3000
SESSION_SECRET="..."        # Long random string — generate with:
                            # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
OWNER_PIN="..."             # PIN to access the owner dashboard panel
NODE_ENV="development"      # You can change it to production if you want to
BASE_URL="http://localhost:3000"

# ── YouTube Notifications ──────────────────────────────────
YOUTUBE_WEBSUB_SECRET="..."     # Any random secret string for WebSub verification
YOUTUBE_API_KEY="..."           # Google Cloud API key with YouTube Data API v3 enabled

# ── Twitch Notifications ───────────────────────────────────
TWITCH_CLIENT_ID="..."
TWITCH_CLIENT_SECRET="..."

# ── Kick Notifications ─────────────────────────────────────
KICK_CLIENT_ID="..."
KICK_CLIENT_SECRET="..."

# ── Misc ───────────────────────────────────────────────────
REPORT_WEBHOOK_URL="..."    # Discord webhook URL for bug reports from the web

# ── Google Drive Backup ────────────────────────────────────
GDRIVE_OAUTH_PATH="./credentials/oauth2.json"   # Path to Google OAuth2 credentials file
GDRIVE_TOKEN_PATH="./credentials/token.json"    # Path to saved Google access token
GDRIVE_FOLDER_ID="..."      # Google Drive folder ID to upload backups to

# ── Image Hosting ──────────────────────────────────────────
IMGBB_API_KEY="..."         # API key from imgbb.com (used to host card images)
```

> Variables for optional features (YouTube, Twitch, Kick, Google Drive, ImgBB) can be left blank if you don't use those features.

---

## 4. Register Redirect URI in Discord Developer Portal

1. Go to [https://discord.com/developers/applications](https://discord.com/developers/applications)
2. Select your application → **OAuth2 → General**
3. Under **Redirects**, add:
   - `http://localhost:3000/auth/callback` (development)
   - `https://yourdomain.com/auth/callback` (production)
4. Click **Save Changes**

---

## 5. Run the Bot (Development)

```bash
node .
# or
npm start
```

The bot and dashboard run together. The dashboard is accessible at `http://localhost:3000`.

### Other Scripts

```bash
npm run clear-commands   # Remove all registered application commands
```

---

## Deploy to VPS (Production)

### A. Install Node.js v18+

`apt install nodejs` on Ubuntu typically installs an outdated version. Use NodeSource instead:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v   # should print v22.x.x or similar
```

### B. Install System Dependencies

```bash
apt update && apt install -y \
  build-essential python3 \
  nginx certbot python3-certbot-nginx \
  fontconfig unzip
```

> `build-essential` and `python3` are needed if `better-sqlite3` or `sharp` need to compile from source. `fontconfig` is required for the font installer script.

### C. Upload & Install the Project

```bash
# Using git:
git clone https://github.com/fenri-z/Octa-Discord-Bot.git /user/octa-bot
cd /user/octa-bot
npm install
```

### D. Install Fonts

```bash
sudo bash scripts/install-fonts.sh
```

### E. Update `.env` for Production

```env
CALLBACK_URL="https://yourdomain.com/auth/callback"
NODE_ENV="production"
WEB_PORT=3000
BASE_URL="https://yourdomain.com"
```

### F. Run with PM2

```bash
pm2 start src/index.js --name octa-bot
pm2 save
pm2 startup   # follow the printed instructions
```

### G. Set Up Nginx as a Reverse Proxy

Create `/etc/nginx/sites-available/octabot`:

```nginx
server {
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/octabot /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### H. Enable HTTPS (Let's Encrypt)

```bash
certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

### I. Update Redirect URI in Discord Developer Portal

Replace `http://localhost:3000/auth/callback` with `https://yourdomain.com/auth/callback`.

---

## Project Structure

```
src/
├── index.js
├── config.js
├── client/
│   ├── DiscordBot.js               ← Extended Discord.js Client
│   └── handler/
│       ├── CommandsHandler.js
│       ├── CommandsListener.js
│       ├── ComponentsHandler.js
│       ├── ComponentsListener.js
│       └── EventsHandler.js
├── commands/
│   ├── Developer/                  ← Owner-only commands (eval, reload, restart)
│   ├── Information/                ← help, userinfo
│   ├── Moderation/                 ← ban, kick, mute, warn, automod, modlog, etc.
│   └── Utility/                    ← welcome, goodbye, autorole, leveling, giveaway, ticket, etc.
├── components/
│   ├── autocomplete/
│   ├── Button/
│   ├── Modal/
│   └── SelectMenu/
├── events/
│   ├── Client/
│   └── Guild/
├── locales/
│   ├── en.js                       ← English bot locale
│   └── id.js                       ← Indonesian bot locale
├── structure/                      ← Base classes (ApplicationCommand, MessageCommand, etc.)
├── utils/                          ← Helpers (DB, image gen, notifiers, cache, etc.)
└── web/
    ├── server.js                   ← Express app
    ├── middleware/
    ├── routes/
    │   ├── auth.js                 ← Discord OAuth2 login/logout
    │   ├── dashboard.js            ← Dashboard pages
    │   ├── api.js                  ← REST API for saving settings
    │   ├── owner.js                ← Owner panel routes
    │   └── webhook.js              ← Webhook receiver (YouTube WebSub, etc.)
    ├── views/
    │   ├── dashboard/              ← Per-feature settings pages
    │   ├── owner/                  ← Owner panel pages
    │   ├── pages/                  ← Public pages (ToS, Privacy, Bug Report, Commands)
    │   └── partials/
    └── public/
        ├── css/style.css
        └── js/dashboard.js
```

---

## Production Notes

- Sessions are stored in SQLite (`data/database.db`) — they persist across bot restarts.
- `app.set('trust proxy', 1)` is set — required for `secure: true` cookies to work behind Nginx.
- Use a long, random `SESSION_SECRET` and keep it private.
- Database backups can be automated to Google Drive via the owner dashboard.
- Rank cards and welcome/goodbye cards are generated server-side using `sharp`.

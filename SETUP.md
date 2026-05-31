# OCTA BOT — Setup & Deployment Guide

## 1. Install dependencies

```bash
npm install discord.js better-sqlite3 dotenv colors express express-session passport passport-discord ejs compression
```

## 2. Konfigurasi file

Rename file-file berikut:

```
src/example.config.js  →  src/config.js
.env.example           →  .env
```

Isi nilai yang diperlukan di `config.js` dan `.env`.

## 3. Variabel .env

```env
# Discord Bot
TOKEN="..."             # Bot token dari Discord Developer Portal
CLIENT_ID="..."         # Application ID
CLIENT_SECRET="..."     # OAuth2 secret dari Discord Developer Portal → OAuth2 → General

# Web Dashboard
CALLBACK_URL="http://localhost:3000/auth/callback"
WEB_PORT=3000
SESSION_SECRET="..."    # String random — generate dengan:
                        # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
NODE_ENV="development"
```

## 4. Daftarkan Redirect URI di Discord Developer Portal

1. Buka https://discord.com/developers/applications
2. Pilih aplikasi botmu → **OAuth2 → General**
3. Di bagian **Redirects**, tambahkan:
   - `http://localhost:3000/auth/callback` (development)
   - `https://domainmu.com/auth/callback` (production)
4. Klik **Save Changes**

## 5. Jalankan bot (development)

```bash
node .
```

Bot dan dashboard berjalan bersamaan. Dashboard bisa diakses di: http://localhost:3000

---

## Deploy ke VPS (Production)

### A. Install dependensi VPS

```bash
apt update && apt install -y nodejs npm nginx certbot python3-certbot-nginx
npm install -g pm2
```

### B. Upload & install proyek

```bash
# Contoh pakai git:
git clone <repo-url> /root/OCTA-BOT
cd /root/OCTA-BOT
npm install
```

### C. Update .env untuk production

```env
CALLBACK_URL="https://domainmu.com/auth/callback"
NODE_ENV="production"
WEB_PORT=3000
```

### D. Jalankan dengan PM2

```bash
pm2 start src/index.js --name octa-bot
pm2 save
pm2 startup   # ikuti instruksi yang muncul
```

### E. Setup Nginx sebagai reverse proxy

Buat file `/etc/nginx/sites-available/octabot`:

```nginx
server {
    server_name domainmu.com www.domainmu.com;

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

### F. Aktifkan HTTPS (Let's Encrypt)

```bash
certbot --nginx -d domainmu.com -d www.domainmu.com
```

### G. Update Redirect URI di Discord Developer Portal

Ganti `http://localhost:3000/auth/callback` dengan `https://domainmu.com/auth/callback`

---

## Struktur file web

```
src/
├── index.js
├── config.js
├── utils/
│   └── SQLiteSessionStore.js   ← Session store SQLite (menggantikan MemoryStore)
└── web/
    ├── server.js               ← Express app utama
    ├── routes/
    │   ├── auth.js             ← Login/logout Discord OAuth2
    │   ├── dashboard.js        ← Halaman-halaman dashboard
    │   └── api.js              ← REST API simpan settings
    ├── views/
    │   ├── index.ejs           ← Landing page
    │   ├── error.ejs           ← Halaman error
    │   ├── partials/
    │   │   ├── head.ejs
    │   │   ├── navbar.ejs
    │   │   └── footer.ejs
    │   └── dashboard/
    │       ├── servers.ejs     ← Pilih server
    │       ├── home.ejs        ← Overview server
    │       ├── welcome.ejs     ← Settings welcome message
    │       ├── goodbye.ejs     ← Settings goodbye message
    │       ├── autorole.ejs    ← Settings autorole
    │       ├── booster.ejs     ← Settings booster reward
    │       ├── message-builder.ejs  ← Kirim embed custom
    │       ├── serverstats.ejs ← Settings server stats channels
    │       └── invites.ejs     ← Monitor invite links server
    └── public/
        ├── css/style.css
        └── js/dashboard.js
```

## Catatan Production

- Session disimpan di SQLite (`database.db`) — tidak akan hilang saat bot restart
- `app.set('trust proxy', 1)` sudah terpasang — wajib agar cookie `secure: true` berfungsi di belakang Nginx
- Ganti `SESSION_SECRET` dengan string random yang panjang dan simpan aman

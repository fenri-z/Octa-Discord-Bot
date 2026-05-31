# OCTA BOT

Discord bot berbasis **discord.js v14** dengan web dashboard, ditulis sepenuhnya dalam JavaScript.

## Fitur

- Handler commands, components, dan events berbasis discord.js v14
- Mendukung semua tipe command:
  - Message commands
  - Application commands (Chat Input, User Context, Message Context)
- Handler components: Buttons, Select Menus, Modals, Autocomplete
- Database SQLite via `better-sqlite3` (key-value store)
- Web dashboard dengan Discord OAuth2 login
- Fitur dashboard:
  - Welcome & Goodbye messages (dengan preview live)
  - Autorole
  - Server booster reward
  - Message Builder
  - Server Stats (channel statistik anggota)
  - Invite Links (monitor semua invite server)

## Dependensi

```
discord.js        ^14.x
better-sqlite3    latest
dotenv            latest
colors            latest
express           latest
express-session   latest
passport          latest
passport-discord  latest
ejs               latest
compression       latest
```

> Node.js v18 atau lebih baru direkomendasikan.

## Setup Cepat

Lihat **[SETUP.md](./SETUP.md)** untuk panduan lengkap instalasi dan deployment ke VPS.

## Struktur Command

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

## Lisensi

[GPL-3.0](./LICENSE)

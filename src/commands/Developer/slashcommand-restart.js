const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags
} = require("discord.js");
const { execSync, spawn } = require("child_process");
const path = require("path");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { isDeveloper } = require("../../utils/dmGuildProxy");

// ── Helpers ────────────────────────────────────────────────────────────────

const IS_WINDOWS = process.platform === "win32";

/** Nama executable pm2 sesuai OS */
function pm2Bin() {
    return IS_WINDOWS ? "pm2.cmd" : "pm2";
}

/** Cek apakah pm2 sudah terinstall di sistem */
function isPm2Installed() {
    try { execSync(`${pm2Bin()} --version`, { stdio: "ignore", shell: IS_WINDOWS }); return true; }
    catch { return false; }
}

/** Cek apakah proses ini sedang dijalankan oleh pm2 */
function isRunningUnderPm2() {
    return typeof process.env.PM2_HOME !== "undefined"
        || typeof process.env.pm_id    !== "undefined";
}

/** Nama proses pm2 */
function getPm2Name() {
    return process.env.PM2_PROCESS_NAME || "octa-bot";
}

/**
 * Root directory proyek = folder yang berisi package.json
 * slashcommand-restart.js ada di: src/commands/Developer/
 * Naik 3 level → root proyek
 */
const ROOT_DIR   = path.resolve(__dirname, "../../..");
const ENTRY_FILE = path.join(ROOT_DIR, "src", "index.js");

// ── Command ────────────────────────────────────────────────────────────────
module.exports = new ApplicationCommand({
    command: {
        name: "restart",
        description: "Safely restart the bot (database is closed first).",
        type: 1
    },

    options: { botOwner: false },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {

        // ── Guard: hanya developer ────────────────────────────────────────
        if (!isDeveloper(interaction.user.id)) {
            return interaction.reply({
                content: "❌ You do not have permission to run this command.",
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor("#FEE75C")
                    .setTitle("🔄 Preparing Restart...")
                    .setDescription("Clearing old autocomplete data, closing database connection, then restarting the bot.\nBot will be back online in a few seconds.")
                    .setTimestamp()
            ],
            flags: MessageFlags.Ephemeral
        });

        await new Promise(r => setTimeout(r, 1500));

        const underPm2  = isRunningUnderPm2();
        const pm2Exists = isPm2Installed();
        const pm2Name   = getPm2Name();

        // ── Hapus autocomplete lama via clear-commands.js ─────────────────
        try {
            execSync(`node ${path.join(ROOT_DIR, "clear-commands.js")}`, {
                stdio: "inherit",
                shell: IS_WINDOWS,
                cwd:   ROOT_DIR,
                env:   { ...process.env }
            });
        } catch { /* abaikan jika gagal, restart tetap lanjut */ }

        // ── Tutup database & koneksi Discord dengan aman ──────────────────
        try { client.database.close(); } catch { /* abaikan */ }
        try { client.destroy();        } catch { /* abaikan */ }

        if (underPm2) {
            // ── Sudah di pm2 → restart ────────────────────────────────────
            try {
                execSync(`${pm2Bin()} restart ${pm2Name}`, {
                    stdio: "ignore",
                    shell: IS_WINDOWS
                });
            } catch {
                process.exit(1);
            }

        } else if (pm2Exists) {
            // ── pm2 ada tapi belum dipakai → spawn ke pm2 lalu exit ───────
            const child = spawn(
                pm2Bin(),
                ["start", ENTRY_FILE, "--name", pm2Name, "--time"],
                {
                    detached: true,
                    stdio:    "ignore",
                    shell:    IS_WINDOWS,
                    cwd:      ROOT_DIR,
                    env:      { ...process.env }
                }
            );
            child.unref();
            setTimeout(() => process.exit(0), 500);

        } else {
            // ── pm2 belum ada → install dulu lalu spawn ───────────────────
            try {
                execSync("npm install -g pm2", {
                    stdio: "inherit",
                    shell: IS_WINDOWS,
                    cwd:   ROOT_DIR
                });
            } catch {
                process.exit(1);
            }

            const child = spawn(
                pm2Bin(),
                ["start", ENTRY_FILE, "--name", pm2Name, "--time"],
                {
                    detached: true,
                    stdio:    "ignore",
                    shell:    IS_WINDOWS,
                    cwd:      ROOT_DIR,
                    env:      { ...process.env }
                }
            );
            child.unref();
            setTimeout(() => process.exit(0), 500);
        }
    }
}).toJSON();

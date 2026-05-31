const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags
} = require("discord.js");
const { execSync } = require("child_process");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { isDeveloper } = require("../../utils/dmGuildProxy");

// ── Helpers ────────────────────────────────────────────────────────────────

const IS_WINDOWS = process.platform === "win32";

function pm2Bin() {
    return IS_WINDOWS ? "pm2.cmd" : "pm2";
}

function isRunningUnderPm2() {
    return typeof process.env.PM2_HOME !== "undefined"
        || typeof process.env.pm_id    !== "undefined";
}

function getPm2Name() {
    return process.env.PM2_PROCESS_NAME || "octa-bot";
}

// ── Command ────────────────────────────────────────────────────────────────
module.exports = new ApplicationCommand({
    command: {
        name: "offline",
        description: "Matikan bot dengan aman (database di-close dahulu).",
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
                content: "❌ Kamu tidak punya izin untuk menjalankan command ini.",
                flags: MessageFlags.Ephemeral
            });
        }

        const underPm2 = isRunningUnderPm2();
        const pm2Name  = getPm2Name();

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor("#ED4245")
                    .setTitle("⛔ Mematikan Bot...")
                    .setDescription(
                        underPm2
                            ? `Menutup database lalu menghapus proses pm2 \`${pm2Name}\`.\nBot akan offline sepenuhnya.`
                            : "Menutup database lalu mematikan proses bot.\nBot akan offline sepenuhnya."
                    )
                    .setTimestamp()
            ],
            flags: MessageFlags.Ephemeral
        });

        await new Promise(r => setTimeout(r, 1500));

        // ── Tutup database & koneksi Discord dengan aman ──────────────────
        try { client.database.close(); } catch { /* abaikan */ }
        try { client.destroy();        } catch { /* abaikan */ }

        if (underPm2) {
            // ── Jalan di pm2 → delete agar tidak auto-restart ─────────────
            try {
                execSync(`${pm2Bin()} delete ${pm2Name}`, {
                    stdio: "ignore",
                    shell: IS_WINDOWS
                });
            } catch {
                process.exit(0);
            }
        } else {
            // ── Jalan manual → matikan proses langsung ────────────────────
            process.exit(0);
        }
    }
}).toJSON();

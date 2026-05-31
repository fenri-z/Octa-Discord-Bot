const { ButtonInteraction, MessageFlags, EmbedBuilder } = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");

// ── Helpers ─────────────────────────────────────────────────────────────────

function getPanel(client, guildId, name) {
    const raw = client.database.get(`autobtn-${guildId}-${name}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

// ── Handler ──────────────────────────────────────────────────────────────────

module.exports = new Component({
    /**
     * customId format:  autobtn:<mode>:<panelName>:<roleId>
     * mode: 'multi' | 'single'
     *
     * Pattern matching dilakukan di ComponentsListener — pastikan
     * handler ini terdaftar dengan prefix 'autobtn:' atau full match
     * dikonfigurasi sesuai framework.
     *
     * Karena framework ini memakai exact customId, kita pakai customId
     * generik lalu baca nilai dari interaction.customId langsung.
     */
    customId: 'autobtn',
    type: 'button',

    /**
     * @param {DiscordBot} client
     * @param {ButtonInteraction} interaction
     */
    run: async (client, interaction) => {
        const { guild, member, customId } = interaction;

        // ── Parse customId ────────────────────────────────────────────────
        // Format: autobtn:<mode>:<panelName>:<roleId>
        const parts = customId.split(':');
        if (parts.length < 4) {
            return interaction.reply({ content: '❌ Format button tidak valid.', flags: MessageFlags.Ephemeral });
        }

        const [, mode, panelName, roleId] = parts;

        // ── Ambil data panel ──────────────────────────────────────────────
        const panel = getPanel(client, guild.id, panelName);
        if (!panel) {
            return interaction.reply({
                content: `❌ Panel \`${panelName}\` tidak ditemukan di database. Mungkin sudah dihapus oleh admin.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Pastikan roleId ada di daftar panel (keamanan)
        const buttonDef = panel.buttons.find(b => b.roleId === roleId);
        if (!buttonDef) {
            return interaction.reply({
                content: '❌ Role ini tidak terdaftar di panel. Panel mungkin sudah diperbarui.',
                flags: MessageFlags.Ephemeral
            });
        }

        // ── Ambil role dari cache guild ───────────────────────────────────
        const role = guild.roles.cache.get(roleId);
        if (!role) {
            return interaction.reply({
                content: '❌ Role tidak ditemukan di server. Mungkin sudah dihapus.',
                flags: MessageFlags.Ephemeral
            });
        }

        // ── Cek permission bot ────────────────────────────────────────────
        const botMember = guild.members.me;
        if (!botMember?.permissions.has('ManageRoles')) {
            return interaction.reply({
                content: '❌ Bot tidak memiliki izin **Manage Roles**.',
                flags: MessageFlags.Ephemeral
            });
        }
        if (botMember.roles.highest.comparePositionTo(role) <= 0) {
            return interaction.reply({
                content: `❌ Role ${role} berada di atas role bot. Bot tidak bisa mengelola role ini.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const hasRole = member.roles.cache.has(roleId);

        // ════════════════════════════════════════════════════════════════════
        // MODE: MULTI — bisa klik banyak button, toggle role masing-masing
        // ════════════════════════════════════════════════════════════════════
        if (mode === 'multi') {
            if (hasRole) {
                await member.roles.remove(role, `Autorole Button (multi) – panel: ${panelName}`);
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#ED4245')
                            .setDescription(`❌ Role ${role} telah **dilepas** dari akunmu.`)
                    ],
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await member.roles.add(role, `Autorole Button (multi) – panel: ${panelName}`);
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#57F287')
                            .setDescription(`✅ Role ${role} berhasil **diberikan** ke akunmu.`)
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // ════════════════════════════════════════════════════════════════════
        // MODE: SINGLE — hanya boleh 1 role dari panel ini yang aktif
        //   • Jika role yang diklik sudah aktif → lepas (toggle off)
        //   • Jika role lain dari panel aktif → lepas semua, beri yang diklik
        //   • Jika belum punya role apapun dari panel → langsung beri
        // ════════════════════════════════════════════════════════════════════
        if (mode === 'single') {
            const allPanelRoleIds = panel.buttons.map(b => b.roleId);

            // Role-role dari panel yang sedang dimiliki member
            const currentPanelRoles = member.roles.cache.filter(r => allPanelRoleIds.includes(r.id));

            if (hasRole) {
                // Sudah punya → toggle off
                await member.roles.remove(role, `Autorole Button (single) – panel: ${panelName}`);
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#ED4245')
                            .setDescription(`❌ Role ${role} telah **dilepas** dari akunmu.`)
                    ],
                    flags: MessageFlags.Ephemeral
                });
            } else {
                // Lepas semua role panel lain yang aktif
                if (currentPanelRoles.size > 0) {
                    for (const [, oldRole] of currentPanelRoles) {
                        await member.roles.remove(oldRole, `Autorole Button (single) – diganti – panel: ${panelName}`).catch(() => null);
                    }
                }

                // Beri role baru
                await member.roles.add(role, `Autorole Button (single) – panel: ${panelName}`);

                const replacedList = currentPanelRoles.size > 0
                    ? `\n*(Menggantikan: ${[...currentPanelRoles.values()].map(r => `${r}`).join(', ')})*`
                    : '';

                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#57F287')
                            .setDescription(`✅ Role ${role} berhasil **diberikan** ke akunmu.${replacedList}`)
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // Fallback mode tidak dikenal
        return interaction.reply({
            content: '❌ Mode button tidak dikenal.',
            flags: MessageFlags.Ephemeral
        });
    }
}).toJSON();

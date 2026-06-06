const { ButtonInteraction, MessageFlags, EmbedBuilder } = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");
const { getLang, getStrings } = require('../../utils/BotLang');

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
     * Pattern matching is done in ComponentsListener — make sure
     * this handler is registered with the prefix 'autobtn:' or a full match
     * configured according to the framework.
     *
     * Since this framework uses exact customId, we use a generic customId
     * and read the value from interaction.customId directly.
     */
    customId: 'autobtn',
    type: 'button',

    /**
     * @param {DiscordBot} client
     * @param {ButtonInteraction} interaction
     */
    run: async (client, interaction) => {
        const { guild, member, customId } = interaction;
        const s = getStrings(getLang(client.database, guild.id)).autorole_button;

        // ── Parse customId ────────────────────────────────────────────────
        // Format: autobtn:<mode>:<panelName>:<roleId>
        const parts = customId.split(':');
        if (parts.length < 4) {
            return interaction.reply({ content: s.btn_invalid_format, flags: MessageFlags.Ephemeral });
        }

        const [, mode, panelName, roleId] = parts;

        // ── Fetch panel data ──────────────────────────────────────────────
        const panel = getPanel(client, guild.id, panelName);
        if (!panel) {
            return interaction.reply({
                content: s.btn_panel_gone(panelName),
                flags: MessageFlags.Ephemeral
            });
        }

        // Ensure roleId exists in the panel list (security check)
        const buttonDef = panel.buttons.find(b => b.roleId === roleId);
        if (!buttonDef) {
            return interaction.reply({
                content: s.btn_role_not_in,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── Fetch role from guild cache ───────────────────────────────────
        const role = guild.roles.cache.get(roleId);
        if (!role) {
            return interaction.reply({
                content: s.btn_role_gone,
                flags: MessageFlags.Ephemeral
            });
        }

        // ── Check bot permissions ─────────────────────────────────────────
        const botMember = guild.members.me;
        if (!botMember?.permissions.has('ManageRoles')) {
            return interaction.reply({
                content: s.btn_no_manage_roles,
                flags: MessageFlags.Ephemeral
            });
        }
        if (botMember.roles.highest.comparePositionTo(role) <= 0) {
            return interaction.reply({
                content: s.btn_role_too_high(role),
                flags: MessageFlags.Ephemeral
            });
        }

        const hasRole = member.roles.cache.has(roleId);

        // ════════════════════════════════════════════════════════════════════
        // MODE: MULTI — can click multiple buttons, each role toggled independently
        // ════════════════════════════════════════════════════════════════════
        if (mode === 'multi') {
            if (hasRole) {
                await member.roles.remove(role, `Autorole Button (multi) – panel: ${panelName}`);
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#ED4245')
                            .setDescription(s.btn_role_removed(role))
                    ],
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await member.roles.add(role, `Autorole Button (multi) – panel: ${panelName}`);
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#57F287')
                            .setDescription(s.btn_role_added(role))
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // ════════════════════════════════════════════════════════════════════
        // MODE: SINGLE — only 1 role from this panel can be active at a time
        //   • If the clicked role is already active → remove it (toggle off)
        //   • If another role from the panel is active → remove all, give the clicked one
        //   • If no role from the panel is active → give it directly
        // ════════════════════════════════════════════════════════════════════
        if (mode === 'single') {
            const allPanelRoleIds = panel.buttons.map(b => b.roleId);

            // Roles from this panel that the member currently has
            const currentPanelRoles = member.roles.cache.filter(r => allPanelRoleIds.includes(r.id));

            if (hasRole) {
                // Already has it → toggle off
                await member.roles.remove(role, `Autorole Button (single) – panel: ${panelName}`);
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#ED4245')
                            .setDescription(s.btn_role_removed(role))
                    ],
                    flags: MessageFlags.Ephemeral
                });
            } else {
                // Remove all other active panel roles
                if (currentPanelRoles.size > 0) {
                    for (const [, oldRole] of currentPanelRoles) {
                        await member.roles.remove(oldRole, `Autorole Button (single) – replaced – panel: ${panelName}`).catch(() => null);
                    }
                }

                // Give the new role
                await member.roles.add(role, `Autorole Button (single) – panel: ${panelName}`);

                const replacedStr = currentPanelRoles.size > 0
                    ? [...currentPanelRoles.values()].map(r => `${r}`).join(', ')
                    : null;

                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#57F287')
                            .setDescription(replacedStr
                                ? s.btn_role_added_rep(role, replacedStr)
                                : s.btn_role_added(role)
                            )
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // Fallback: unknown mode
        return interaction.reply({
            content: s.btn_unknown_mode,
            flags: MessageFlags.Ephemeral
        });
    }
}).toJSON();

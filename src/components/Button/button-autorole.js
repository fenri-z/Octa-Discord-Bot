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

        // ── Parse customId ────────────────────────────────────────────────
        // Format: autobtn:<mode>:<panelName>:<roleId>
        const parts = customId.split(':');
        if (parts.length < 4) {
            return interaction.reply({ content: '❌ Invalid button format.', flags: MessageFlags.Ephemeral });
        }

        const [, mode, panelName, roleId] = parts;

        // ── Fetch panel data ──────────────────────────────────────────────
        const panel = getPanel(client, guild.id, panelName);
        if (!panel) {
            return interaction.reply({
                content: `❌ Panel \`${panelName}\` not found in the database. It may have been deleted by an admin.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Ensure roleId exists in the panel list (security check)
        const buttonDef = panel.buttons.find(b => b.roleId === roleId);
        if (!buttonDef) {
            return interaction.reply({
                content: '❌ This role is not registered in the panel. The panel may have been updated.',
                flags: MessageFlags.Ephemeral
            });
        }

        // ── Fetch role from guild cache ───────────────────────────────────
        const role = guild.roles.cache.get(roleId);
        if (!role) {
            return interaction.reply({
                content: '❌ Role not found in the server. It may have been deleted.',
                flags: MessageFlags.Ephemeral
            });
        }

        // ── Check bot permissions ─────────────────────────────────────────
        const botMember = guild.members.me;
        if (!botMember?.permissions.has('ManageRoles')) {
            return interaction.reply({
                content: '❌ The bot does not have the **Manage Roles** permission.',
                flags: MessageFlags.Ephemeral
            });
        }
        if (botMember.roles.highest.comparePositionTo(role) <= 0) {
            return interaction.reply({
                content: `❌ Role ${role} is above the bot's highest role. The bot cannot manage this role.`,
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
                            .setDescription(`❌ Role ${role} has been **removed** from your account.`)
                    ],
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await member.roles.add(role, `Autorole Button (multi) – panel: ${panelName}`);
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#57F287')
                            .setDescription(`✅ Role ${role} has been successfully **given** to your account.`)
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
                            .setDescription(`❌ Role ${role} has been **removed** from your account.`)
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

                const replacedList = currentPanelRoles.size > 0
                    ? `\n*(Replaced: ${[...currentPanelRoles.values()].map(r => `${r}`).join(', ')})*`
                    : '';

                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#57F287')
                            .setDescription(`✅ Role ${role} has been successfully **given** to your account.${replacedList}`)
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // Fallback: unknown mode
        return interaction.reply({
            content: '❌ Unknown button mode.',
            flags: MessageFlags.Ephemeral
        });
    }
}).toJSON();

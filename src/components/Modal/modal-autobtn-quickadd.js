const {
    ModalSubmitInteraction,
    EmbedBuilder,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");
const { resolveRole } = require('../../utils/resolveGuildOption');
const { getLang, getStrings } = require('../../utils/BotLang');

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPanel(client, guildId, name) {
    const raw = client.database.get(`autobtn-${guildId}-${name}`);
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function savePanel(client, guildId, name, data) {
    client.database.set(`autobtn-${guildId}-${name}`, JSON.stringify(data));
    const rawList = client.database.get(`autobtn-list-${guildId}`);
    let list = [];
    if (rawList && typeof rawList === 'string') {
        try { list = JSON.parse(rawList); } catch { list = []; }
    }
    if (!list.includes(name)) {
        list.push(name);
        client.database.set(`autobtn-list-${guildId}`, JSON.stringify(list));
    }
}

const STYLE_MAP = {
    primary:   ButtonStyle.Primary,
    success:   ButtonStyle.Success,
    danger:    ButtonStyle.Danger,
    secondary: ButtonStyle.Secondary
};

const STYLE_LABEL = {
    [ButtonStyle.Primary]:   '🔵 Blue (Primary)',
    [ButtonStyle.Success]:   '🟢 Green (Success)',
    [ButtonStyle.Danger]:    '🔴 Red (Danger)',
    [ButtonStyle.Secondary]: '⚪ Gray (Secondary)'
};

// ── Modal Handler ─────────────────────────────────────────────────────────────

module.exports = new Component({
    customId: 'autobtn-quickadd-modal',   // prefix match: autobtn-quickadd-modal:<panelName>
    type: 'modal',

    /**
     * @param {DiscordBot} client
     * @param {ModalSubmitInteraction} interaction
     */
    run: async (client, interaction) => {
        const guildId   = interaction.guild.id;
        const userId    = interaction.user.id;
        const panelName = interaction.customId.split(':').slice(1).join(':');
        const s = getStrings(getLang(client.database, guildId)).autorole_button;

        // Clean up pending key
        client.database.delete(`autobtn-quickadd-${guildId}-${userId}`);

        const panel = getPanel(client, guildId, panelName);
        if (!panel) {
            return interaction.reply({
                content: s.qa_panel_gone(panelName),
                flags: MessageFlags.Ephemeral
            });
        }

        const roleStr  = interaction.fields.getTextInputValue('quickadd-role').trim();
        const label    = interaction.fields.getTextInputValue('quickadd-label').trim();
        const warnaRaw = interaction.fields.getTextInputValue('quickadd-warna').trim().toLowerCase();

        // Resolve color
        const panelDefaultKey = panel.defaultStyle
            ? Object.keys(STYLE_MAP).find(k => STYLE_MAP[k] === panel.defaultStyle) || 'primary'
            : 'primary';
        const warnaKey = warnaRaw && STYLE_MAP[warnaRaw] ? warnaRaw : panelDefaultKey;

        if (warnaRaw && !STYLE_MAP[warnaRaw]) {
            return interaction.reply({
                content: s.qa_invalid_color(warnaRaw),
                flags: MessageFlags.Ephemeral
            });
        }

        const role = resolveRole(interaction.guild, roleStr);
        if (!role) {
            return interaction.reply({ content: s.qa_role_gone, flags: MessageFlags.Ephemeral });
        }
        if (role.managed || role.id === interaction.guild.id) {
            return interaction.reply({ content: s.qa_role_invalid, flags: MessageFlags.Ephemeral });
        }
        if (panel.buttons.some(b => b.roleId === role.id)) {
            return interaction.reply({
                content: s.qa_role_exists(role, panelName),
                flags: MessageFlags.Ephemeral
            });
        }
        if (panel.buttons.length >= 25) {
            return interaction.reply({
                content: s.qa_panel_full,
                flags: MessageFlags.Ephemeral
            });
        }

        // Add button
        panel.buttons.push({
            roleId: role.id,
            label,
            style: STYLE_MAP[warnaKey] ?? ButtonStyle.Primary
        });
        panel.updatedAt = Date.now();
        savePanel(client, guildId, panelName, panel);

        // Show result + follow-up buttons (add another / done)
        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`autobtn-quickadd:${panelName}`)
                .setLabel(s.qa_add_another)
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`autobtn-quickskip:${panelName}`)
                .setLabel(s.qa_done_btn)
                .setStyle(ButtonStyle.Primary)
        );

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle(s.btn_added_title(panelName))
                    .addFields(
                        { name: '🎭 Role',  value: `${role}`,  inline: true },
                        { name: '🏷️ Label', value: label,      inline: true },
                        { name: '🎨 Color', value: STYLE_LABEL[STYLE_MAP[warnaKey]] ?? warnaKey, inline: true },
                        { name: '📊 Total', value: `${panel.buttons.length}/25 buttons`, inline: true },
                        {
                            name: '📤 Next Steps',
                            value: `Click **${s.qa_add_another}** to add more buttons, or **${s.qa_done_btn}** then send the panel with \`/autorole-button send ${panelName}\`.`,
                            inline: false
                        }
                    )
                    .setTimestamp()
            ],
            components: [actionRow],
            flags: MessageFlags.Ephemeral
        });
    }
}).toJSON();

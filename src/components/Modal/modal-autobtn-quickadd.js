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
    [ButtonStyle.Primary]:   '🔵 Biru (Primary)',
    [ButtonStyle.Success]:   '🟢 Hijau (Success)',
    [ButtonStyle.Danger]:    '🔴 Merah (Danger)',
    [ButtonStyle.Secondary]: '⚪ Abu-abu (Secondary)'
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

        // Bersihkan pending key
        client.database.delete(`autobtn-quickadd-${guildId}-${userId}`);

        const panel = getPanel(client, guildId, panelName);
        if (!panel) {
            return interaction.reply({
                content: `❌ Panel \`${panelName}\` tidak ditemukan. Mungkin sudah terhapus.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const roleStr  = interaction.fields.getTextInputValue('quickadd-role').trim();
        const label    = interaction.fields.getTextInputValue('quickadd-label').trim();
        const warnaRaw = interaction.fields.getTextInputValue('quickadd-warna').trim().toLowerCase();

        // Resolusi warna
        const panelDefaultKey = panel.defaultStyle
            ? Object.keys(STYLE_MAP).find(k => STYLE_MAP[k] === panel.defaultStyle) || 'primary'
            : 'primary';
        const warnaKey = warnaRaw && STYLE_MAP[warnaRaw] ? warnaRaw : panelDefaultKey;

        if (warnaRaw && !STYLE_MAP[warnaRaw]) {
            return interaction.reply({
                content: `❌ Warna \`${warnaRaw}\` tidak valid. Gunakan: \`primary\`, \`success\`, \`danger\`, atau \`secondary\`.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const role = resolveRole(interaction.guild, roleStr);
        if (!role) {
            return interaction.reply({ content: '❌ Role tidak ditemukan. Coba lagi dengan mention atau ID role.', flags: MessageFlags.Ephemeral });
        }
        if (role.managed || role.id === interaction.guild.id) {
            return interaction.reply({ content: '❌ Role ini tidak bisa digunakan (managed atau @everyone).', flags: MessageFlags.Ephemeral });
        }
        if (panel.buttons.some(b => b.roleId === role.id)) {
            return interaction.reply({
                content: `⚠️ Role ${role} sudah punya tombol di panel \`${panelName}\`.`,
                flags: MessageFlags.Ephemeral
            });
        }
        if (panel.buttons.length >= 25) {
            return interaction.reply({
                content: '❌ Satu panel maksimal 25 tombol.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Tambah button
        panel.buttons.push({
            roleId: role.id,
            label,
            style: STYLE_MAP[warnaKey] ?? ButtonStyle.Primary
        });
        panel.updatedAt = Date.now();
        savePanel(client, guildId, panelName, panel);

        // Tampilkan hasil + tombol lanjutan (tambah lagi / selesai)
        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`autobtn-quickadd:${panelName}`)
                .setLabel('➕ Tambah Button Lagi')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`autobtn-quickskip:${panelName}`)
                .setLabel('✅ Selesai')
                .setStyle(ButtonStyle.Primary)
        );

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle(`✅ Button Ditambahkan ke Panel \`${panelName}\``)
                    .addFields(
                        { name: '🎭 Role',  value: `${role}`,  inline: true },
                        { name: '🏷️ Label', value: label,      inline: true },
                        { name: '🎨 Warna', value: STYLE_LABEL[STYLE_MAP[warnaKey]] ?? warnaKey, inline: true },
                        { name: '📊 Total', value: `${panel.buttons.length}/25 tombol`, inline: true },
                        {
                            name: '📤 Langkah Selanjutnya',
                            value: `Klik **➕ Tambah Button Lagi** untuk menambah tombol berikutnya, atau **✅ Selesai** lalu kirim panel dengan \`/autorole-button kirim ${panelName}\`.`,
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

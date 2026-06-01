const {
    ButtonInteraction, PermissionFlagsBits, ChannelType,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require("discord.js");
const DiscordBot  = require("../../client/DiscordBot");
const Component   = require("../../structure/Component");

// ── Helpers ──────────────────────────────────────────────────────────────────

function getStaffRoles(client, guildId) {
    const raw = client.database.get(`ticket-staff-roles-${guildId}`);
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

function getOpenList(client, guildId) {
    const raw = client.database.get(`ticket-open-list-${guildId}`);
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

// ── Component ─────────────────────────────────────────────────────────────────

module.exports = new Component({
    customId: 'ticket-open',
    type: 'button',

    /**
     * @param {DiscordBot} client
     * @param {ButtonInteraction} interaction
     */
    run: async (client, interaction) => {
        const { guild, member } = interaction;
        const guildId = guild.id;

        // Cek apakah tiket aktif
        if (!client.database.get(`ticket-enabled-${guildId}`)) {
            return interaction.reply({ content: '❌ Sistem tiket tidak aktif di server ini.', flags: MessageFlags.Ephemeral });
        }

        // Cek apakah user sudah punya tiket terbuka
        const existingId = client.database.get(`ticket-user-${guildId}-${member.id}`);
        if (existingId) {
            const existingCh = guild.channels.cache.get(existingId);
            if (existingCh) {
                return interaction.reply({
                    content: `❌ Kamu sudah punya tiket yang aktif: ${existingCh}\nSelesaikan tiket itu terlebih dahulu.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            client.database.delete(`ticket-user-${guildId}-${member.id}`);
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const categoryId  = client.database.get(`ticket-category-${guildId}`) || null;
            const staffRoles  = getStaffRoles(client, guildId);
            const embedColor  = client.database.get(`ticket-embed-color-${guildId}`) || '#5865F2';

            // Nomor tiket
            const count    = parseInt(client.database.get(`ticket-count-${guildId}`) || '0') + 1;
            client.database.set(`ticket-count-${guildId}`, String(count));

            const safeUsername = member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'user';
            const channelName  = `ticket-${String(count).padStart(4, '0')}-${safeUsername}`;

            // ── Permission overwrites ─────────────────────────────────────
            const overwrites = [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                {
                    id: guild.members.me.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels,
                        PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks,
                    ]
                },
                {
                    id: member.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks,
                    ]
                },
            ];

            // Owner server
            if (guild.ownerId && guild.ownerId !== member.id) {
                overwrites.push({
                    id: guild.ownerId,
                    allow: [
                        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages,
                        PermissionFlagsBits.AttachFiles,
                    ]
                });
            }

            // Staff roles
            for (const roleId of staffRoles) {
                if (guild.roles.cache.has(roleId)) {
                    overwrites.push({
                        id: roleId,
                        allow: [
                            PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages,
                            PermissionFlagsBits.AttachFiles,
                        ]
                    });
                }
            }

            // ── Buat channel tiket ────────────────────────────────────────
            const createOpts = {
                name: channelName,
                type: ChannelType.GuildText,
                permissionOverwrites: overwrites,
                topic: `Tiket #${String(count).padStart(4,'0')} — ${member.user.tag}`,
                reason: `Tiket dibuat oleh ${member.user.tag}`,
            };
            if (categoryId && guild.channels.cache.has(categoryId)) {
                createOpts.parent = categoryId;
            }

            const ticketChannel = await guild.channels.create(createOpts);

            // ── Simpan data tiket ─────────────────────────────────────────
            client.database.set(`ticket-user-${guildId}-${member.id}`, ticketChannel.id);
            client.database.set(`ticket-info-${guildId}-${ticketChannel.id}`, JSON.stringify({
                ticketNumber: count,
                userId:       member.id,
                username:     member.user.tag,
                openedAt:     Date.now(),
                status:       'open',
            }));

            const openList = getOpenList(client, guildId);
            openList.push(ticketChannel.id);
            client.database.set(`ticket-open-list-${guildId}`, JSON.stringify(openList));

            // ── Pesan selamat datang di channel tiket ────────────────────
            const colorHex = embedColor.startsWith('#') ? embedColor : `#${embedColor}`;
            const welcomeEmbed = new EmbedBuilder()
                .setColor(colorHex)
                .setTitle(`🎫 Tiket #${String(count).padStart(4, '0')}`)
                .setDescription(
                    `Halo ${member}! Tiket kamu sudah dibuat.\n\n` +
                    `Silakan jelaskan keperluan kamu dan tim staff akan segera membantu.\n\n` +
                    `> Klik **🔒 Tutup Tiket** untuk menutup tiket ini.`
                )
                .addFields(
                    { name: '👤 Dibuat oleh', value: `${member} (${member.user.tag})`, inline: true },
                    { name: '🕐 Waktu buka', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                )
                .setTimestamp();

            const staffMentions = staffRoles.map(id => `<@&${id}>`).join(' ');
            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket-close')
                    .setLabel('🔒 Tutup Tiket')
                    .setStyle(ButtonStyle.Danger),
            );

            await ticketChannel.send({
                content: `${member}${staffMentions ? ' ' + staffMentions : ''}`,
                embeds:  [welcomeEmbed],
                components: [actionRow],
            });

            await interaction.editReply({ content: `✅ Tiket berhasil dibuat! ${ticketChannel}` });

        } catch (err) {
            console.error('[ticket-open]', err);
            await interaction.editReply({ content: '❌ Gagal membuat tiket. Pastikan bot punya permission Manage Channels.' }).catch(() => null);
        }
    }
}).toJSON();

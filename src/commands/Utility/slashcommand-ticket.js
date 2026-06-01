const {
    ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require("discord.js");
const DiscordBot       = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { resolveRole, resolveChannel } = require('../../utils/resolveGuildOption');
const { checkBotPermissions } = require('../../utils/checkBotPermissions');

// ── Helpers ──────────────────────────────────────────────────────────────────

function getStaffRoles(client, guildId) {
    const raw = client.database.get(`ticket-staff-roles-${guildId}`);
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

function getOpenList(client, guildId) {
    const raw = client.database.get(`ticket-open-list-${guildId}`);
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

function buildPanelEmbed(client, guildId) {
    const title    = client.database.get(`ticket-embed-title-${guildId}`) || '🎫 Support Ticket';
    const desc     = client.database.get(`ticket-embed-desc-${guildId}`)  || 'Klik tombol di bawah untuk membuat tiket dan mendapatkan bantuan dari tim staff.';
    const colorRaw = client.database.get(`ticket-embed-color-${guildId}`) || '#5865F2';
    const color    = colorRaw.startsWith('#') ? colorRaw : `#${colorRaw}`;
    return new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc);
}

function buildPanelRow(client, guildId) {
    const btnLabel = client.database.get(`ticket-embed-btn-label-${guildId}`) || '📩 Buat Ticket';
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket-open')
            .setLabel(btnLabel)
            .setStyle(ButtonStyle.Primary)
    );
}

// ── Command ───────────────────────────────────────────────────────────────────

module.exports = new ApplicationCommand({
    command: {
        name: 'ticket',
        description: 'Kelola sistem tiket server.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            // ── kirim-panel ───────────────────────────────────────────────
            {
                name: 'kirim-panel',
                description: 'Kirim panel tiket ke channel tertentu.',
                type: 1,
                options: [
                    {
                        name: 'channel',
                        description: 'Channel tujuan pengiriman panel (kosong = channel saat ini)',
                        type: 3, required: false, autocomplete: true
                    }
                ]
            },
            // ── tutup ─────────────────────────────────────────────────────
            {
                name: 'tutup',
                description: 'Tutup tiket di channel ini (hanya bisa dipakai di dalam channel tiket).',
                type: 1
            },
            // ── tambah ───────────────────────────────────────────────────
            {
                name: 'tambah',
                description: 'Tambahkan user ke tiket saat ini.',
                type: 1,
                options: [
                    { name: 'user', description: 'User yang ingin ditambahkan', type: 6, required: true }
                ]
            },
            // ── hapus ────────────────────────────────────────────────────
            {
                name: 'hapus',
                description: 'Hapus akses user dari tiket saat ini.',
                type: 1,
                options: [
                    { name: 'user', description: 'User yang ingin dihapus aksesnya', type: 6, required: true }
                ]
            },
            // ── list ─────────────────────────────────────────────────────
            {
                name: 'list',
                description: 'Lihat daftar tiket yang sedang terbuka.',
                type: 1
            },
        ]
    },

    options: { botOwner: false },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const { guild, options } = interaction;
        const sub     = options.getSubcommand();
        const guildId = guild.id;

        const ok = await checkBotPermissions(interaction, [
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageRoles,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
        ]);
        if (!ok) return;

        // ── /ticket kirim-panel ───────────────────────────────────────────
        if (sub === 'kirim-panel') {
            if (!client.database.get(`ticket-enabled-${guildId}`)) {
                return interaction.reply({
                    content: '❌ Sistem tiket belum diaktifkan. Aktifkan dulu di **Dashboard → Ticket**.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const channelStr    = options.getString('channel');
            let   targetChannel = interaction.channel;

            if (channelStr) {
                const resolved = resolveChannel(guild, channelStr);
                if (!resolved) return interaction.reply({ content: '❌ Channel tidak ditemukan.', flags: MessageFlags.Ephemeral });
                targetChannel = resolved;
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            // Hapus panel lama jika ada
            const oldPanelRaw = client.database.get(`ticket-panel-msg-${guildId}`);
            if (oldPanelRaw) {
                try {
                    const old = JSON.parse(oldPanelRaw);
                    const oldCh = guild.channels.cache.get(old.channelId);
                    if (oldCh) {
                        const oldMsg = await oldCh.messages.fetch(old.messageId).catch(() => null);
                        if (oldMsg) await oldMsg.delete().catch(() => null);
                    }
                } catch {}
            }

            const sentMsg = await targetChannel.send({
                embeds:     [buildPanelEmbed(client, guildId)],
                components: [buildPanelRow(client, guildId)],
            });

            client.database.set(`ticket-panel-msg-${guildId}`, JSON.stringify({
                messageId: sentMsg.id, channelId: targetChannel.id
            }));
            client.database.set(`ticket-panel-channel-${guildId}`, targetChannel.id);

            return interaction.editReply({ content: `✅ Panel tiket berhasil dikirim ke ${targetChannel}!` });
        }

        // ── /ticket tutup ─────────────────────────────────────────────────
        if (sub === 'tutup') {
            const raw = client.database.get(`ticket-info-${guildId}-${interaction.channel.id}`);
            if (!raw) {
                return interaction.reply({ content: '❌ Perintah ini hanya bisa dipakai di dalam channel tiket.', flags: MessageFlags.Ephemeral });
            }

            // Trigger tombol close secara programatik
            const fakeInteraction = { ...interaction, customId: 'ticket-close' };
            const closeHandler = require('../Button/button-ticket-close');
            return closeHandler.run(client, interaction);
        }

        // ── /ticket tambah ────────────────────────────────────────────────
        if (sub === 'tambah') {
            const raw = client.database.get(`ticket-info-${guildId}-${interaction.channel.id}`);
            if (!raw) {
                return interaction.reply({ content: '❌ Perintah ini hanya bisa dipakai di dalam channel tiket.', flags: MessageFlags.Ephemeral });
            }

            const target = options.getUser('user');
            const member = await guild.members.fetch(target.id).catch(() => null);
            if (!member) return interaction.reply({ content: '❌ User tidak ditemukan di server.', flags: MessageFlags.Ephemeral });

            await interaction.channel.permissionOverwrites.edit(member.id, {
                [PermissionFlagsBits.ViewChannel]:     true,
                [PermissionFlagsBits.SendMessages]:    true,
                [PermissionFlagsBits.ReadMessageHistory]: true,
            });

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#57F287')
                        .setDescription(`✅ ${member} berhasil ditambahkan ke tiket ini.`)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /ticket hapus ─────────────────────────────────────────────────
        if (sub === 'hapus') {
            const raw = client.database.get(`ticket-info-${guildId}-${interaction.channel.id}`);
            if (!raw) {
                return interaction.reply({ content: '❌ Perintah ini hanya bisa dipakai di dalam channel tiket.', flags: MessageFlags.Ephemeral });
            }

            const target = options.getUser('user');
            await interaction.channel.permissionOverwrites.edit(target.id, {
                [PermissionFlagsBits.ViewChannel]: false,
            });

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setDescription(`✅ Akses <@${target.id}> dari tiket ini berhasil dihapus.`)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // ── /ticket list ──────────────────────────────────────────────────
        if (sub === 'list') {
            const openList = getOpenList(client, guildId);

            if (openList.length === 0) {
                return interaction.reply({
                    embeds: [new EmbedBuilder().setColor('#5865F2').setDescription('📭 Tidak ada tiket yang sedang terbuka.')],
                    flags: MessageFlags.Ephemeral
                });
            }

            const fields = openList.slice(0, 25).map(channelId => {
                const ch   = guild.channels.cache.get(channelId);
                const info = (() => {
                    try { return JSON.parse(client.database.get(`ticket-info-${guildId}-${channelId}`) || '{}'); } catch { return {}; }
                })();
                const chName  = ch ? `<#${channelId}>` : `#${channelId} (dihapus)`;
                const openAt  = info.openedAt ? `<t:${Math.floor(info.openedAt/1000)}:R>` : '-';
                const creator = info.userId ? `<@${info.userId}>` : '-';
                return { name: `🎫 Tiket #${String(info.ticketNumber||0).padStart(4,'0')}`, value: `${chName}\nDibuat: ${creator} ${openAt}`, inline: true };
            });

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#5865F2')
                        .setTitle(`🎫 Tiket Aktif — ${openList.length} terbuka`)
                        .addFields(fields)
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        }
    }
}).toJSON();

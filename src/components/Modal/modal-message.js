const { ModalSubmitInteraction, EmbedBuilder, MessageFlags } = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const Component  = require("../../structure/Component");

const KATEGORI = { UNIK: 'unik', BIASA: 'biasa' };

function buildEmbed(data) {
    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder();
    const colorHex = data.color && /^#?[0-9A-Fa-f]{6}$/.test(data.color.trim())
        ? (data.color.startsWith('#') ? data.color : `#${data.color}`)
        : '#5865F2';
    embed.setColor(colorHex);
    if (data.title)       embed.setTitle(data.title.slice(0, 256));
    if (data.description) embed.setDescription(data.description.slice(0, 4096));
    if (data.footer)      embed.setFooter({ text: data.footer.slice(0, 2048) });
    if (data.image)       embed.setImage(data.image);
    if (data.thumbnail)   embed.setThumbnail(data.thumbnail);
    if (data.authorName)  embed.setAuthor({
        name:    data.authorName.slice(0, 256),
        iconURL: data.authorIcon || undefined
    });
    return embed;
}

module.exports = new Component({
    customId: 'message-modal',  // prefix match: message-modal:name:mode
    type: 'modal',

    /**
     * @param {DiscordBot} client
     * @param {ModalSubmitInteraction} interaction
     */
    run: async (client, interaction) => {
        const guildId = interaction.guild.id;
        const userId  = interaction.user.id;

        const rawPending = client.database.get(`pesan-pending-${guildId}-${userId}`);
        if (!rawPending) {
            return interaction.reply({
                content: '❌ Session expired. Run the command again.',
                flags: MessageFlags.Ephemeral
            });
        }

        client.database.delete(`pesan-pending-${guildId}-${userId}`);

        let pending;
        try { pending = JSON.parse(rawPending); } catch {
            pending = { nama: rawPending, kategori: KATEGORI.BIASA, mode: 'buat' };
        }

        const { nama, kategori = KATEGORI.BIASA, mode = 'buat' } = pending;

        const rawExisting = client.database.get(`pesan-${guildId}-${nama}`);
        let existing = null;
        if (rawExisting && typeof rawExisting === 'string') {
            try { existing = JSON.parse(rawExisting); } catch { existing = null; }
        }

        const now = Date.now();

        // ── TYPE MODE: save as plain text ──────────────────────────────────
        if (mode === 'tipe') {
            let plainText = '';
            try { plainText = interaction.fields.getTextInputValue('message-field-plaintext').trim(); } catch {}
            const tmpl = {
                ...(existing || {}),
                kategori,
                messageType: 'plain',
                plainText,
                updatedAt:   now,
                createdAt:   existing?.createdAt || now,
            };
            client.database.set(`pesan-${guildId}-${nama}`, JSON.stringify(tmpl));

            const rawList = client.database.get(`pesan-list-${guildId}`);
            let list = [];
            if (rawList && typeof rawList === 'string') { try { list = JSON.parse(rawList); } catch {} }
            if (!list.includes(nama)) { list.push(nama); client.database.set(`pesan-list-${guildId}`, JSON.stringify(list)); }

            return interaction.reply({
                content: `✅ Template \`${nama}\` changed to **Plain Text** type.\nUse \`/message preview ${nama}\` to preview, then \`/message send ${nama}\` to send.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Read form values for create/edit mode
        let title = '', description = '', footer = '', plainText = '';
        const isPlainMode = existing?.messageType === 'plain' && mode === 'edit';
        if (isPlainMode) {
            try { plainText = interaction.fields.getTextInputValue('message-field-plaintext').trim(); } catch {}
        } else {
            try { title       = interaction.fields.getTextInputValue('message-field-title').trim(); }       catch {}
            try { description = interaction.fields.getTextInputValue('message-field-description').trim(); } catch {}
            try { footer      = interaction.fields.getTextInputValue('message-field-footer').trim(); }      catch {}
        }

        const isNew = !existing;
        const tmpl  = {
            messageType: existing?.messageType || 'embed',
            plainText:   isPlainMode ? plainText : (existing?.plainText || ''),
            title:       isPlainMode ? (existing?.title || '') : title,
            description: isPlainMode ? (existing?.description || '') : description,
            footer:      isPlainMode ? (existing?.footer || '') : footer,
            kategori,
            color:      existing?.color      || '#5865F2',
            image:      existing?.image      || '',
            thumbnail:  existing?.thumbnail  || '',
            authorName: existing?.authorName || '',
            authorIcon: existing?.authorIcon || '',
            createdAt:  existing?.createdAt  || now,
            updatedAt:  now,
        };

        client.database.set(`pesan-${guildId}-${nama}`, JSON.stringify(tmpl));

        const rawList = client.database.get(`pesan-list-${guildId}`);
        let list = [];
        if (rawList && typeof rawList === 'string') {
            try { list = JSON.parse(rawList); } catch { list = []; }
        }
        if (!list.includes(nama)) {
            list.push(nama);
            client.database.set(`pesan-list-${guildId}`, JSON.stringify(list));
        }

        // ── EDIT MODE: immediately update the Discord message ──────────────
        if (mode === 'edit') {
            const rawSent = client.database.get(`pesan-unik-sent-${guildId}-${nama}`);
            if (!rawSent) {
                return interaction.reply({
                    content: `✏️ Template \`${nama}\` updated, but message data is missing. Resend with \`/message send ${nama}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            let sentData;
            try { sentData = JSON.parse(rawSent); } catch {
                return interaction.reply({ content: '❌ Unique message data is corrupted.', flags: MessageFlags.Ephemeral });
            }

            const targetChannel = interaction.guild.channels.cache.get(sentData.channelId)
                ?? await interaction.guild.channels.fetch(sentData.channelId).catch(() => null);

            if (!targetChannel) {
                client.database.delete(`pesan-unik-sent-${guildId}-${nama}`);
                return interaction.reply({
                    content: `❌ Channel not found. Data reset — resend with \`/message send ${nama}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            let targetMessage;
            try {
                targetMessage = await targetChannel.messages.fetch(sentData.messageId);
            } catch {
                client.database.delete(`pesan-unik-sent-${guildId}-${nama}`);
                return interaction.reply({
                    content: `❌ Message not found (may have been manually deleted). Data reset — resend with \`/message send ${nama}\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (targetMessage.author.id !== interaction.client.user.id) {
                return interaction.reply({
                    content: '❌ The bot can only edit its own messages.',
                    flags: MessageFlags.Ephemeral
                });
            }

            try {
                if (tmpl.messageType === 'plain') {
                    await targetMessage.edit({ content: (tmpl.plainText || '').slice(0, 2000), embeds: [] });
                } else {
                    await targetMessage.edit({ embeds: [buildEmbed(tmpl)], content: null });
                }
                return interaction.reply({
                    content: `✅ Unique message \`${nama}\` successfully updated!\n🔗 [View message](${targetMessage.url})`,
                    flags: MessageFlags.Ephemeral
                });
            } catch {
                return interaction.reply({ content: '❌ Failed to edit the message in Discord.', flags: MessageFlags.Ephemeral });
            }
        }

        // ── CREATE MODE: show confirmation ─────────────────────────────────
        const isEmpty  = !tmpl.title && !tmpl.description;
        const isUnik   = kategori === KATEGORI.UNIK;
        const badgeKat = isUnik ? '🔒 Unique' : '📄 Regular';

        const embed = new EmbedBuilder()
            .setColor(isNew ? '#57F287' : '#FEE75C')
            .setTitle(isNew
                ? `✅ Template \`${nama}\` Created [${badgeKat}]`
                : `✏️ Template \`${nama}\` Updated [${badgeKat}]`)
            .setDescription(
                isEmpty
                    ? '⚠️ Title and description are both empty. Fill at least one so the embed can be sent.'
                    : isUnik
                        ? '🔒 Unique message: can only be sent **once**, then use `/message edit` to update its content.'
                        : '📄 Regular message: can be sent multiple times. Cannot be edited/deleted via command after sending.'
            )
            .addFields(
                { name: '👁️ Preview',         value: `\`/message preview ${nama}\``,       inline: true },
                { name: '🎨 Set Color',        value: `\`/message set-color ${nama}\``,     inline: true },
                { name: '🖼️ Add Image',        value: `\`/message set-image ${nama}\``,     inline: true },
                { name: '📌 Add Thumbnail',    value: `\`/message set-thumbnail ${nama}\``, inline: true },
                { name: '✍️ Add Author',        value: `\`/message set-author ${nama}\``,   inline: true },
                { name: '📤 Send',             value: `\`/message send ${nama}\``,          inline: true },
                ...(isUnik ? [{ name: '✏️ Edit Message', value: `\`/message edit ${nama}\``, inline: true }] : []),
            )
            .setFooter({ text: `Total templates: ${list.length} · Use /message list to view all.` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
}).toJSON();

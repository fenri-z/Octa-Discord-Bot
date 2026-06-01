const DiscordBot = require("../DiscordBot");
const config = require("../../config");
const { error } = require("../../utils/Console");
const { MessageFlags } = require("discord.js");
const { isDeveloper, createDMProxy } = require("../../utils/dmGuildProxy");

class ComponentsListener {
    /**
     * @param {DiscordBot} client
     */
    constructor(client) {
        client.on('interactionCreate', async (interaction) => {

            const checkUserPermissions = async (component) => {
                if (component.options?.public === false && interaction.user.id !== interaction.message.interaction.user.id) {
                    await interaction.reply({
                        content: config.messages.COMPONENT_NOT_PUBLIC,
                        flags: MessageFlags.Ephemeral
                    });
                    return false;
                }
                return true;
            };

            // ── Helper: buat proxy untuk DM jika perlu ────────────────
            // Digunakan agar modal/button handler bisa mengakses guild
            // saat dipanggil dari DM oleh owner/developer
            const resolveDMInteraction = async (interaction) => {
                if (interaction.guild) return interaction; // sudah ada guild, lanjut normal

                if (!isDeveloper(interaction.user.id)) return null; // bukan developer, abaikan

                const selectedGuildId = client.database.get(`dm-guild-${interaction.user.id}`);
                if (!selectedGuildId) return interaction; // tidak ada guild dipilih, biarkan handler yang handle error

                const selectedGuild = client.guilds.cache.get(selectedGuildId);
                if (!selectedGuild) return interaction;

                return createDMProxy(interaction, selectedGuild);
            };

            try {
                if (interaction.isButton()) {
                    // Coba exact match dulu
                    let component = client.collection.components.buttons.get(interaction.customId);

                    // Jika tidak ada, coba prefix match (customId berformat "prefix:...")
                    if (!component) {
                        const prefix = interaction.customId.split(':')[0];
                        component = client.collection.components.buttons.get(prefix);
                    }

                    if (!component) return;
                    if (!(await checkUserPermissions(component))) return;

                    const resolved = await resolveDMInteraction(interaction);
                    if (resolved === null) return;

                    try { component.run(client, resolved); } catch (err) { error(err); }
                    return;
                }

                if (interaction.isAnySelectMenu()) {
                    const component = client.collection.components.selects.get(interaction.customId);
                    if (!component) return;
                    if (!(await checkUserPermissions(component))) return;

                    const resolved = await resolveDMInteraction(interaction);
                    if (resolved === null) return;

                    try { component.run(client, resolved); } catch (err) { error(err); }
                    return;
                }

                if (interaction.isModalSubmit()) {
                    // Coba exact match dulu
                    let component = client.collection.components.modals.get(interaction.customId);

                    // Jika tidak ada, coba prefix match (customId berformat "prefix:...")
                    if (!component) {
                        const prefix = interaction.customId.split(':')[0];
                        component = client.collection.components.modals.get(prefix);
                    }

                    if (!component) return;

                    const resolved = await resolveDMInteraction(interaction);
                    if (resolved === null) return;

                    try { component.run(client, resolved); } catch (err) { error(err); }
                    return;
                }

                if (interaction.isAutocomplete()) {
                    // ── Guard: autocomplete hanya jalan di server (guild install) ──────────
                    if (!interaction.guild) {
                        await interaction.respond([]).catch(() => null);
                        return;
                    }

                    // ── Guard: di server, hanya owner/developer/ManageGuild ───────────────
                    if (!isDeveloper(interaction.user.id)) {
                        const { PermissionFlagsBits } = require('discord.js');
                        const guild  = interaction.guild;
                        const member = interaction.member
                            ?? await guild.members.fetch(interaction.user.id).catch(() => null);

                        const isGuildOwner   = interaction.user.id === guild.ownerId;
                        const hasManageGuild = member?.permissions?.has(PermissionFlagsBits.ManageGuild) ?? false;

                        if (!isGuildOwner && !hasManageGuild) {
                            await interaction.respond([]).catch(() => null);
                            return;
                        }
                    }

                    // ── Routing berdasarkan nama opsi yang sedang difokus ──────
                    const focused = interaction.options.getFocused(true);
                    if (focused.name === 'channel') {
                        const { autocompleteChannel } = require('../../utils/autocompleteHelper');
                        await autocompleteChannel(interaction, client).catch(() => null);
                        return;
                    }
                    if (focused.name === 'role') {
                        const { autocompleteRole } = require('../../utils/autocompleteHelper');
                        await autocompleteRole(interaction, client, { excludeManaged: true }).catch(() => null);
                        return;
                    }
                    if (focused.name === 'nama') {
                        if (interaction.commandName === 'autorole-button') {
                            const { autocompleteAutobtnNama } = require('../../utils/autocompleteHelper');
                            await autocompleteAutobtnNama(interaction, client).catch(() => null);
                        } else if (interaction.commandName === 'autorole-reaction') {
                            const { autocompleteAutoreactNama } = require('../../utils/autocompleteHelper');
                            await autocompleteAutoreactNama(interaction, client).catch(() => null);
                        } else {
                            const { autocompleteTemplate } = require('../../utils/autocompleteHelper');
                            await autocompleteTemplate(interaction, client).catch(() => null);
                        }
                        return;
                    }
                    if (focused.name === 'panel') {
                        if (interaction.commandName === 'autorole-reaction') {
                            const { autocompleteReactPanel } = require('../../utils/autocompleteHelper');
                            await autocompleteReactPanel(interaction, client).catch(() => null);
                        } else {
                            const { autocompletePanel } = require('../../utils/autocompleteHelper');
                            await autocompletePanel(interaction, client).catch(() => null);
                        }
                        return;
                    }
                    if (focused.name === 'sumber') {
                        const { autocompleteSumberSalin } = require('../../utils/autocompleteHelper');
                        await autocompleteSumberSalin(interaction, client).catch(() => null);
                        return;
                    }
                    if (focused.name === 'tujuan') {
                        const { autocompleteTujuanSalin } = require('../../utils/autocompleteHelper');
                        await autocompleteTujuanSalin(interaction, client).catch(() => null);
                        return;
                    }

                    // ── Routing berdasarkan commandName (component terdaftar) ──
                    const component = client.collection.components.autocomplete.get(interaction.commandName);
                    if (!component) {
                        await interaction.respond([]).catch(() => null);
                        return;
                    }

                    try { await component.run(client, interaction); } catch (err) { error(err); }
                    return;
                }

            } catch (err) {
                error(err);
            }
        });
    }
}

module.exports = ComponentsListener;

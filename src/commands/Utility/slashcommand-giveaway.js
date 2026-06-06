'use strict';

const { ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const DiscordBot         = require('../../client/DiscordBot');
const ApplicationCommand = require('../../structure/ApplicationCommand');
const { getLang, getStrings } = require('../../utils/BotLang');

// ── Duration parser ────────────────────────────────────────────────────────────
// Example: "1h30m", "2d", "30m", "1h", "7200" (seconds)
function parseDuration(input) {
    const str = String(input).trim().toLowerCase();

    // Pure number = minutes
    if (/^\d+$/.test(str)) return parseInt(str) * 60_000;

    let ms = 0;
    const matches = str.matchAll(/(\d+(?:\.\d+)?)\s*(d|h|m|s)/g);
    for (const m of matches) {
        const val = parseFloat(m[1]);
        switch (m[2]) {
            case 'd': ms += val * 86_400_000; break;
            case 'h': ms += val * 3_600_000;  break;
            case 'm': ms += val * 60_000;     break;
            case 's': ms += val * 1_000;      break;
        }
    }
    return ms;
}

function formatDuration(ms) {
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const parts = [];
    if (d) parts.push(`${d} day(s)`);
    if (h) parts.push(`${h} hour(s)`);
    if (m) parts.push(`${m} minute(s)`);
    return parts.join(' ') || 'less than 1 minute';
}

// ── Command ────────────────────────────────────────────────────────────────────

module.exports = new ApplicationCommand({
    command: {
        name: 'giveaway',
        description: 'Manage server giveaways.',
        type: 1,
        default_member_permissions: String(PermissionFlagsBits.ManageGuild),
        options: [
            // ── start ─────────────────────────────────────────────────────
            {
                name: 'start',
                description: 'Start a new giveaway.',
                type: 1,
                options: [
                    {
                        name: 'prize',
                        description: 'The prize to be given (e.g. Discord Nitro 1 Month)',
                        type: 3, required: true,
                    },
                    {
                        name: 'duration',
                        description: 'Giveaway duration (e.g. 1h, 30m, 1d, 2h30m)',
                        type: 3, required: true,
                    },
                    {
                        name: 'channel',
                        description: 'Channel to send the giveaway embed (default: current channel)',
                        type: 7, required: false,
                        channel_types: [0, 5],
                    },
                    {
                        name: 'winners',
                        description: 'Number of winners (default: 1, max: 20)',
                        type: 4, required: false,
                        min_value: 1, max_value: 20,
                    },
                    {
                        name: 'required_role',
                        description: 'Role required to participate (optional)',
                        type: 8, required: false,
                    },
                ],
            },
            // ── end ───────────────────────────────────────────────────────
            {
                name: 'end',
                description: 'End an active giveaway now and pick winners.',
                type: 1,
                options: [
                    {
                        name: 'giveaway',
                        description: 'Select the giveaway to end',
                        type: 3, required: true, autocomplete: true,
                    },
                ],
            },
            // ── reroll ────────────────────────────────────────────────────
            {
                name: 'reroll',
                description: 'Reroll the winner of a finished giveaway.',
                type: 1,
                options: [
                    {
                        name: 'giveaway',
                        description: 'Select the giveaway to reroll',
                        type: 3, required: true, autocomplete: true,
                    },
                ],
            },
            // ── list ──────────────────────────────────────────────────────
            {
                name: 'list',
                description: 'Show all active giveaways in this server.',
                type: 1,
            },
        ],
    },

    // ── Autocomplete ──────────────────────────────────────────────────────────
    /**
     * @param {import('discord.js').AutocompleteInteraction} interaction
     * @param {DiscordBot} client
     */
    autocomplete: async (client, interaction) => {
        const sub     = interaction.options.getSubcommand();
        const focused = interaction.options.getFocused().toLowerCase();
        const manager = client.giveawayManager;
        if (!manager) return interaction.respond([]);

        const all = manager.getAll(interaction.guildId);
        let list;

        if (sub === 'end') {
            list = all.filter(g => !g.ended && !g.cancelled);
        } else if (sub === 'reroll') {
            list = all.filter(g => g.ended && !g.cancelled);
        } else {
            list = all;
        }

        const choices = list
            .filter(g => g.prize.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(g => ({
                name: `${g.prize} (${g.ended ? 'Ended' : 'Active'})`.slice(0, 100),
                value: g.id,
            }));

        await interaction.respond(choices);
    },

    // ── Run ───────────────────────────────────────────────────────────────────
    /**
     * @param {ChatInputCommandInteraction} interaction
     * @param {DiscordBot} client
     */
    run: async (client, interaction) => {
        const s       = getStrings(getLang(client.database, interaction.guild?.id)).giveaway;
        const sub     = interaction.options.getSubcommand();
        const manager = client.giveawayManager;

        if (!manager) {
            return interaction.reply({
                content: '❌ GiveawayManager is not available.',
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── /giveaway start ───────────────────────────────────────────────
        if (sub === 'start') {
            const prize          = interaction.options.getString('prize');
            const durasiRaw      = interaction.options.getString('duration');
            const channelOption  = interaction.options.getChannel('channel');
            const winnerCount    = interaction.options.getInteger('winners')       ?? 1;
            const requiredRole   = interaction.options.getRole('required_role');

            const targetChannel = channelOption || interaction.channel;

            const durationMs = parseDuration(durasiRaw);
            if (durationMs < 10_000) {
                return interaction.reply({
                    content: '❌ Minimum duration is 10 seconds. Format examples: `1h`, `30m`, `1d`, `2h30m`.',
                    flags: MessageFlags.Ephemeral,
                });
            }
            if (durationMs > 30 * 86_400_000) {
                return interaction.reply({
                    content: '❌ Maximum duration is 30 days.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const gw = await manager.createGiveaway({
                    guildId:        interaction.guildId,
                    channelId:      targetChannel.id,
                    prize,
                    durationMs,
                    winnerCount,
                    hostId:         interaction.user.id,
                    requiredRoleId: requiredRole?.id || null,
                });

                await interaction.editReply({
                    content: [
                        `✅ Giveaway **${gw.prize}** started in ${targetChannel}!`,
                        `⏰ Ends in **${formatDuration(durationMs)}**`,
                        `🏆 **${winnerCount}** winner(s)`,
                        requiredRole ? `🔒 Required role: ${requiredRole}` : '',
                    ].filter(Boolean).join('\n'),
                });
            } catch (err) {
                await interaction.editReply({ content: `❌ Failed: ${err.message}` });
            }
            return;
        }

        // ── /giveaway end ─────────────────────────────────────────────────
        if (sub === 'end') {
            const id = interaction.options.getString('giveaway');
            const gw = manager._get(id);

            if (!gw || gw.guildId !== interaction.guildId) {
                return interaction.reply({ content: s.not_found, flags: MessageFlags.Ephemeral });
            }
            if (gw.ended) {
                return interaction.reply({ content: s.already_ended, flags: MessageFlags.Ephemeral });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                await manager.endGiveaway(id);
                await interaction.editReply({ content: s.ended(id) });
            } catch (err) {
                await interaction.editReply({ content: `❌ Failed: ${err.message}` });
            }
            return;
        }

        // ── /giveaway reroll ──────────────────────────────────────────────
        if (sub === 'reroll') {
            const id = interaction.options.getString('giveaway');
            const gw = manager._get(id);

            if (!gw || gw.guildId !== interaction.guildId) {
                return interaction.reply({ content: s.not_found, flags: MessageFlags.Ephemeral });
            }
            if (!gw.ended) {
                return interaction.reply({ content: '❌ Giveaway has not ended yet.', flags: MessageFlags.Ephemeral });
            }
            if (gw.cancelled) {
                return interaction.reply({ content: '❌ This giveaway has been cancelled.', flags: MessageFlags.Ephemeral });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                const winners = await manager.rerollGiveaway(id);
                const mention = winners.map(u => `<@${u.id}>`).join(', ');
                await interaction.editReply({
                    content: winners.length
                        ? `${s.rerolled(id)}\n🏆 ${mention}`
                        : '⚠️ No eligible participants found.',
                });
            } catch (err) {
                await interaction.editReply({ content: `❌ Failed: ${err.message}` });
            }
            return;
        }

        // ── /giveaway list ────────────────────────────────────────────────
        if (sub === 'list') {
            const all    = manager.getAll(interaction.guildId);
            const active = all.filter(g => !g.ended && !g.cancelled);

            if (!active.length) {
                return interaction.reply({
                    content: '📋 No giveaways are currently running.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            const embed = new EmbedBuilder()
                .setColor(0xF0A032)
                .setTitle('🎉 Active Giveaways')
                .setTimestamp();

            for (const gw of active.slice(0, 10)) {
                const channel   = interaction.guild.channels.cache.get(gw.channelId);
                const remaining = gw.endsAt - Date.now();
                embed.addFields({
                    name: gw.prize,
                    value: [
                        `📢 ${channel ? channel.toString() : 'channel not found'}`,
                        `⏰ Ends <t:${Math.floor(gw.endsAt / 1000)}:R>`,
                        `🏆 ${gw.winnerCount} winner(s)`,
                    ].join('\n'),
                    inline: false,
                });
            }

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
    },
}).toJSON();

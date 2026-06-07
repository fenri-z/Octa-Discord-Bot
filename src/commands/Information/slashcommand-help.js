const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { getLang, getStrings } = require('../../utils/BotLang');
const { isDeveloper } = require("../../utils/dmGuildProxy");

// ─── Permission level ────────────────────────────────────────────────────────
function getUserLevel(interaction) {
    const userId = interaction.user.id;
    const isDM   = !interaction.guild;
    if (isDeveloper(userId))                                                             return 'dev';
    if (!isDM && interaction.member?.id === interaction.guild?.ownerId)                  return 'guild_owner';
    if (!isDM && interaction.member?.permissions.has(PermissionFlagsBits.Administrator)) return 'admin';
    if (!isDM && interaction.member?.permissions.has(PermissionFlagsBits.ManageGuild))   return 'manager';
    if (!isDM && (
        interaction.member?.permissions.has(PermissionFlagsBits.KickMembers)    ||
        interaction.member?.permissions.has(PermissionFlagsBits.BanMembers)     ||
        interaction.member?.permissions.has(PermissionFlagsBits.ModerateMembers)||
        interaction.member?.permissions.has(PermissionFlagsBits.ManageMessages)
    )) return 'moderator';
    return 'member';
}

const LEVEL_ORDER = ['member', 'moderator', 'manager', 'admin', 'guild_owner', 'dev'];
function hasAccess(userLevel, minLevel) {
    return LEVEL_ORDER.indexOf(userLevel) >= LEVEL_ORDER.indexOf(minLevel);
}

// ─── Static category structure (no translatable text here) ──────────────────
// Text comes from locale via s.cat[id] and s.cmd[name]
const CATEGORIES = [
    { id: 'information',  emoji: '📖', minLevel: 'member',    color: '#EB459E', commands: [
        { name: 'help',     emoji: '📖' },
        { name: 'ping',     emoji: '🏓' },
        { name: 'userinfo', emoji: '👤' },
    ]},
    { id: 'moderation',   emoji: '🛡️', minLevel: 'moderator', color: '#5865F2', commands: [
        { name: 'ban',      emoji: '🔨' },
        { name: 'kick',     emoji: '👢' },
        { name: 'mute',     emoji: '🔇' },
        { name: 'warn',     emoji: '⚠️' },
        { name: 'purge',    emoji: '🗑️' },
        { name: 'lock',     emoji: '🔒' },
        { name: 'slowmode', emoji: '⏱️' },
    ]},
    { id: 'automod',      emoji: '🤖', minLevel: 'manager',   color: '#57F287', commands: [
        { name: 'automod', emoji: '🤖' },
        { name: 'modlog',  emoji: '📋' },
        { name: 'invites', emoji: '📩' },
    ]},
    { id: 'notification', emoji: '🔔', minLevel: 'admin',     color: '#FEE75C', commands: [
        { name: 'welcome',   emoji: '👋' },
        { name: 'goodbye',   emoji: '🚪' },
        { name: 'booster',   emoji: '🚀' },
        { name: 'unbooster', emoji: '💔' },
    ]},
    { id: 'autorole',     emoji: '🎭', minLevel: 'admin',     color: '#FEE75C', commands: [
        { name: 'autorole-join',      emoji: '🎭' },
        { name: 'autorole-button',    emoji: '🔘' },
        { name: 'autorole-reaction',  emoji: '✨' },
        { name: 'autorole-booster',   emoji: '🚀' },
    ]},
    { id: 'utility',      emoji: '🔧', minLevel: 'admin',     color: '#FEE75C', commands: [
        { name: 'ticket',       emoji: '🎫' },
        { name: 'giveaway',     emoji: '🎉' },
        { name: 'serverstats',  emoji: '📊' },
        { name: 'message',      emoji: '📝' },
        { name: 'set-nickname', emoji: '✏️' },
        { name: 'language',     emoji: '🌐' },
    ]},
    { id: 'developer',    emoji: '🛠️', minLevel: 'dev',       color: '#FF73FA', commands: [
        { name: 'server',  emoji: '🌐' },
        { name: 'eval',    emoji: '💻' },
        { name: 'reload',  emoji: '🔄' },
        { name: 'offline', emoji: '🔴' },
        { name: 'restart', emoji: '🔁' },
    ]},
];

const PAGE_SIZE = 7;

function getAccessible(userLevel) {
    return CATEGORIES.filter(cat => hasAccess(userLevel, cat.minLevel));
}

// ─── Slash command mention helper ────────────────────────────────────────────
function mention(client, syntax) {
    const clean = syntax.trim();
    if (!clean.startsWith('/')) return `\`${clean}\``;
    const parts   = clean.slice(1).split(' ');
    const topName = parts[0];
    const appCmd  = client.application?.commands?.cache?.find(c => c.name === topName);
    if (!appCmd) return `\`${clean}\``;
    const rest = parts.slice(1).join(' ');
    return rest ? `</${topName} ${rest}:${appCmd.id}>` : `</${topName}:${appCmd.id}>`;
}

// ─── Usage renderer ──────────────────────────────────────────────────────────
function renderUsage(lines, client) {
    return lines.map(([syntax, desc]) => {
        if (syntax.startsWith('/')) return `${mention(client, syntax)} — ${desc}`;
        return `> ‣ \`${syntax.trim()}\` — ${desc}`;
    }).join('\n');
}

// ─── Paginator ───────────────────────────────────────────────────────────────
function getPages(lines) {
    if (!lines?.length) return [[]];
    const pages = [];
    for (let i = 0; i < lines.length; i += PAGE_SIZE) {
        pages.push(lines.slice(i, i + PAGE_SIZE));
    }
    return pages;
}

// ─── Embed builders ──────────────────────────────────────────────────────────
function buildMainEmbed(client, s) {
    return new EmbedBuilder()
        .setColor('#5865F2')
        .setThumbnail(client.user.displayAvatarURL())
        .setTitle(client.user.username)
        .setDescription(s.main_desc(client.user.toString()))
        .addFields({ name: s.main_commands_title, value: s.main_commands_val })
        .setFooter({ text: s.footer_main })
        .setTimestamp();
}

function buildCategoryEmbed(cat, s, client) {
    const catText = s.cat[cat.id] ?? { label: cat.id, tip: '' };
    const list = cat.commands.map(cmd => {
        const cmdText = s.cmd[cmd.name];
        const short   = cmdText?.short ?? cmd.name;
        return `${mention(client, `/${cmd.name}`)} — ${cmd.emoji} ${short}`;
    }).join('\n');

    return new EmbedBuilder()
        .setColor(cat.color)
        .setTitle(s.cat_view_title(`${cat.emoji} ${catText.label}`))
        .setDescription(catText.tip)
        .addFields({ name: s.field_commands, value: list })
        .setFooter({ text: s.footer_cat(catText.label, cat.commands.length) })
        .setTimestamp();
}

function buildCommandEmbed(cat, cmd, s, client, page = 0) {
    const catText  = s.cat[cat.id] ?? { label: cat.id };
    const cmdText  = s.cmd[cmd.name] ?? { short: cmd.name, lines: [] };
    const pages    = getPages(cmdText.lines);
    const safePage = Math.min(page, pages.length - 1);
    const usage    = pages[safePage]?.length
        ? renderUsage(pages[safePage], client)
        : `\`/${cmd.name}\``;
    const pageInfo = pages.length > 1 ? ` (${safePage + 1}/${pages.length})` : '';

    return new EmbedBuilder()
        .setColor(cat.color)
        .setTitle(s.cmd_view_title(cmd.name))
        .setDescription(`${cmd.emoji} ${cmdText.short}`)
        .addFields({ name: s.field_usage + pageInfo, value: usage })
        .setFooter({ text: s.footer_cmd(catText.label) })
        .setTimestamp();
}

// ─── Select menu & button builders ──────────────────────────────────────────
function buildCategoryRow(accessCats, selectedId, s) {
    const selectedCat = accessCats.find(c => c.id === selectedId);
    const options = [];

    // Add "Main Menu" as first option only when a category is already selected
    if (selectedId !== null) {
        options.push(
            new StringSelectMenuOptionBuilder()
                .setLabel(s.btn_main ?? 'Main Menu')
                .setDescription(s.btn_main_desc ?? 'Return to the main menu')
                .setValue('__main__')
                .setEmoji('🏠')
        );
    }

    accessCats.forEach(cat => {
        const catText = s.cat[cat.id] ?? { label: cat.id, opt: '' };
        options.push(
            new StringSelectMenuOptionBuilder()
                .setLabel(catText.label)
                .setDescription(catText.opt.slice(0, 100))
                .setValue(cat.id)
                .setEmoji(cat.emoji)
                .setDefault(cat.id === selectedId)
        );
    });

    const selText = selectedCat ? (s.cat[selectedCat.id]?.label ?? selectedCat.id) : null;
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('help-category')
            .setPlaceholder(selText ? `${selectedCat.emoji} ${selText}` : s.cat_placeholder)
            .addOptions(options)
    );
}

function buildCommandRow(cat, selectedCmdName, s) {
    const options = cat.commands.map(cmd => {
        const cmdText = s.cmd[cmd.name] ?? { short: cmd.name };
        return new StringSelectMenuOptionBuilder()
            .setLabel(`/${cmd.name}`)
            .setDescription(cmdText.short.slice(0, 100))
            .setValue(cmd.name)
            .setEmoji(cmd.emoji)
            .setDefault(cmd.name === selectedCmdName);
    });
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('help-command')
            .setPlaceholder(s.cmd_placeholder)
            .addOptions(options)
    );
}

function buildPageRow(page, totalPages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('help-prev')
            .setLabel('◀')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId('help-next')
            .setLabel('▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1),
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND
// ─────────────────────────────────────────────────────────────────────────────
module.exports = new ApplicationCommand({
    command: {
        name: 'help',
        description: 'Show the bot command help menu.',
        type: 1,
        options: []
    },
    options: { cooldown: 5000 },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const s          = getStrings(getLang(client.database, interaction.guild?.id)).help;
        const userLevel  = getUserLevel(interaction);
        const accessCats = getAccessible(userLevel);

        await interaction.deferReply();

        let currentCatId   = null;
        let currentCmdName = null;
        let currentPage    = 0;

        const reply = await interaction.editReply({
            embeds:     [buildMainEmbed(client, s)],
            components: [buildCategoryRow(accessCats, null, s)]
        });

        const collector = reply.createMessageComponentCollector({
            filter: i => i.user.id === interaction.user.id &&
                ['help-category', 'help-command', 'help-prev', 'help-next'].includes(i.customId),
        });

        collector.on('collect', async i => {
            if (i.customId === 'help-category') {
                // Main Menu option selected from dropdown
                if (i.values[0] === '__main__') {
                    currentCatId   = null;
                    currentCmdName = null;
                    currentPage    = 0;
                    return i.update({
                        embeds:     [buildMainEmbed(client, s)],
                        components: [buildCategoryRow(accessCats, null, s)],
                    });
                }
                currentCatId   = i.values[0];
                currentCmdName = null;
                currentPage    = 0;
            } else if (i.customId === 'help-command') {
                currentCmdName = i.values[0];
                currentPage    = 0;
            } else if (i.customId === 'help-prev') {
                currentPage = Math.max(0, currentPage - 1);
            } else if (i.customId === 'help-next') {
                currentPage++;
            }

            const cat = CATEGORIES.find(c => c.id === currentCatId);
            if (!cat) return i.update({});

            const catRow     = buildCategoryRow(accessCats, currentCatId, s);
            const cmdRow     = buildCommandRow(cat, currentCmdName, s);
            const components = [catRow, cmdRow];

            let embed;
            if (currentCmdName) {
                const cmd = cat.commands.find(c => c.name === currentCmdName);
                if (cmd) {
                    const cmdText  = s.cmd[cmd.name] ?? { short: cmd.name, lines: [] };
                    const pages    = getPages(cmdText.lines);
                    const safePage = Math.min(currentPage, pages.length - 1);
                    embed = buildCommandEmbed(cat, cmd, s, client, safePage);
                    if (pages.length > 1) components.push(buildPageRow(safePage, pages.length));
                } else {
                    embed = buildCategoryEmbed(cat, s, client);
                }
            } else {
                embed = buildCategoryEmbed(cat, s, client);
            }

            await i.update({ embeds: [embed], components });
        });

    }
}).toJSON();

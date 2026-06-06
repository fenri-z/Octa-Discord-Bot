const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
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

// ─── Semantic categories & commands ─────────────────────────────────────────
const CATEGORIES = [
    {
        id: 'information', emoji: '📖', label: 'Information',
        optionDesc: 'General commands for all members.',
        tip: '> ℹ️ Available to all server members.',
        minLevel: 'member', color: '#EB459E',
        commands: [
            {
                name: 'help', emoji: '📖',
                short: 'Show the bot command help menu.',
                usage: '/help — Show this help menu.',
            },
            {
                name: 'ping', emoji: '🏓',
                short: 'Check the bot connection latency.',
                usage: '/ping — Check bot latency and API response time.',
            },
            {
                name: 'userinfo', emoji: '👤',
                short: 'Show detailed information about a member or yourself.',
                usage: '/userinfo — Show your own info.\n/userinfo user:@user — Show info of another member.',
            },
        ]
    },
    {
        id: 'moderation', emoji: '🛡️', label: 'Moderation',
        optionDesc: 'Requires: Kick, Ban, Timeout, or Manage Messages.',
        tip: '> 🛡️ Requires: Kick, Ban, Timeout, or Manage Messages.',
        minLevel: 'moderator', color: '#5865F2',
        commands: [
            {
                name: 'ban', emoji: '🔨',
                short: 'Ban or unban members from the server.',
                usage: '/ban member user:@user — Ban a member.\n  reason: — Optional reason.\n  delete_days: — Delete message history (0–7 days).\n/ban unban user:123456 — Unban a user by ID.',
            },
            {
                name: 'kick', emoji: '👢',
                short: 'Kick a member from the server.',
                usage: '/kick user:@user — Kick a member.\n  reason: — Optional reason.',
            },
            {
                name: 'mute', emoji: '🔇',
                short: 'Timeout or remove timeout from a member.',
                usage: '/mute member user:@user duration:1h — Timeout a member.\n  duration formats: 10m, 1h, 2d (max 28d)\n/mute unmute user:@user — Remove timeout.',
            },
            {
                name: 'warn', emoji: '⚠️',
                short: 'Manage member warnings.',
                usage: '/warn add member:@user reason:spam — Add a warning.\n/warn remove member:@user id:abc123 — Remove a warning.\n/warn clear member:@user — Clear all warnings.\n/warn list member:@user — View all warnings.',
            },
            {
                name: 'purge', emoji: '🗑️',
                short: 'Delete messages in bulk.',
                usage: '/purge all amount:50 — Delete up to 100 recent messages.\n/purge user user:@user amount:20 — Delete from a specific user.',
            },
            {
                name: 'lock', emoji: '🔒',
                short: 'Lock or unlock a channel.',
                usage: '/lock channel reason:maintenance — Lock the channel.\n/lock unlock — Unlock the channel.',
            },
            {
                name: 'slowmode', emoji: '⏱️',
                short: 'Set or remove slowmode in the channel.',
                usage: '/slowmode duration:30s — Set slowmode. (formats: 30s, 5m, 1h · 0 to disable)',
            },
        ]
    },
    {
        id: 'automod', emoji: '🤖', label: 'AutoMod',
        optionDesc: 'Requires: Manage Server.',
        tip: '> ⚙️ Requires: Manage Server.',
        minLevel: 'manager', color: '#57F287',
        commands: [
            {
                name: 'automod', emoji: '🤖',
                short: 'Configure the automatic moderation system.',
                usage: '/automod config — View current settings.\n/automod action type:warn — Set violation action (delete/warn/mute/kick/ban).\n/automod antilink active:true — Enable link blocking.\n/automod antiinvite active:true — Block Discord invites.\n/automod spam active:true limit:5 interval:5 — Anti-spam.\n/automod massmention active:true limit:5 — Mention limit.\n/automod attachments active:true — Filter attachments.\n/automod mute role:@Muted — Set mute role.\n/automod auditlog channel:#mod-log — Set log channel.\n/automod antiraid active:true join_limit:10 interval:10 — Anti-raid.\n/automod words add word:badword — Add banned word.\n/automod words list — List banned words.\n/automod words delete word:badword — Remove banned word.\n/automod whitelist add channel:#bot-spam — Whitelist channel/role.\n/automod whitelist remove role:@Staff — Remove from whitelist.\n/automod whitelist list — View whitelist.',
            },
            {
                name: 'modlog', emoji: '📋',
                short: 'Configure moderation action logging.',
                usage: '/modlog set channel:#mod-log — Set the mod log channel.\n/modlog disable — Disable modlog.\n/modlog events — Choose which events to log.',
            },
            {
                name: 'invites', emoji: '📩',
                short: 'Show all server invite links with usage statistics.',
                usage: '/invites — Show invite list (sorted by most used).\n/invites page:2 — View a specific page.',
            },
        ]
    },
    {
        id: 'notification', emoji: '🔔', label: 'Notification',
        optionDesc: 'Requires: Administrator or Server Owner.',
        tip: '> 👑 Requires: Administrator or Server Owner.',
        minLevel: 'admin', color: '#FEE75C',
        commands: [
            {
                name: 'welcome', emoji: '👋',
                short: 'Configure welcome messages for new members.',
                usage: '/welcome status — View configuration.\n/welcome toggle active:true — Enable/disable.\n/welcome channel channel:#welcome — Set the channel.\n/welcome text — Edit title & description (opens modal).\n/welcome color hex:#5865F2 — Set embed color.\n/welcome footer text:Welcome! — Set footer text.\n/welcome thumbnail show:true — Show/hide member avatar.\n/welcome fields field:... show:true — Toggle info fields.\n/welcome reset — Reset all settings.\n/welcome preview — Preview the welcome embed.',
            },
            {
                name: 'goodbye', emoji: '🚪',
                short: 'Configure goodbye messages when members leave.',
                usage: '/goodbye status — View configuration.\n/goodbye toggle active:true — Enable/disable.\n/goodbye channel channel:#log-leave — Set the channel.\n/goodbye type type:embed — Choose embed or plain text.\n/goodbye text — Edit content (opens modal).\n/goodbye color hex:#ED4245 — Set embed color.\n/goodbye reset — Reset all settings.\n/goodbye preview — Preview.',
            },
            {
                name: 'booster', emoji: '🚀',
                short: 'Configure server booster notifications and autorole.',
                usage: '/booster status — View all configurations.\n/booster list — List current server boosters.\n/booster notif boost-toggle active:true — Enable boost notification.\n/booster notif boost-channel channel:#boost — Set boost channel.\n/booster notif boost-title text:... — Set boost embed title.\n/booster notif boost-color hex:#FF73FA — Set boost embed color.\n/booster notif unboost-toggle active:true — Enable unboost notification.\n/booster notif unboost-channel channel:#boost — Set unboost channel.\n/booster autorole set role:@Booster — Set booster auto-role.\n/booster autorole toggle active:true — Enable/disable.\n/booster autorole autoremove active:true — Auto-remove when unboost.\n/booster reset — Reset all booster configuration.',
            },
        ]
    },
    {
        id: 'autorole', emoji: '🎭', label: 'Autorole',
        optionDesc: 'Requires: Administrator or Server Owner.',
        tip: '> 👑 Requires: Administrator or Server Owner.',
        minLevel: 'admin', color: '#FEE75C',
        commands: [
            {
                name: 'autorole', emoji: '🎭',
                short: 'Configure automatic roles for members and bots.',
                usage: '/autorole status — View autorole configuration.\n/autorole human set role:@Member — Set auto-role for humans.\n/autorole human toggle active:true — Enable/disable human autorole.\n/autorole bot set role:@Bot — Set auto-role for bots.',
            },
            {
                name: 'autorole-button', emoji: '🔘',
                short: 'Role selection panels with clickable buttons.',
                usage: '/autorole-button list — View all panels.\n/autorole-button create name:gaming mode:multi — Create/edit a panel.\n  mode: multi (any combo) or single (radio-style)\n/autorole-button add-button panel:gaming role:@Gaming label:🎮 Gaming — Add button.\n/autorole-button add-bulk panel:gaming — Add multiple buttons (modal).\n/autorole-button edit-button panel:gaming role:@Gaming label:New — Edit button.\n/autorole-button delete-button panel:gaming role:@Gaming — Remove button.\n/autorole-button send panel:gaming channel:#roles — Send panel to channel.',
            },
            {
                name: 'autorole-reaction', emoji: '✨',
                short: 'Role assignment via emoji reactions.',
                usage: '/autorole-reaction list — View all panels.\n/autorole-reaction create name:color mode:multi — Create/edit a panel.\n/autorole-reaction add-reaction panel:color emoji:🔴 role:@Red — Add reaction.\n/autorole-reaction delete-reaction panel:color role:@Red — Remove reaction.\n/autorole-reaction preview panel:color — Preview the panel.\n/autorole-reaction send panel:color channel:#roles — Send panel to channel.',
            },
        ]
    },
    {
        id: 'ticket', emoji: '🎫', label: 'Ticket',
        optionDesc: 'Requires: Administrator or Server Owner.',
        tip: '> 👑 Requires: Administrator or Server Owner.',
        minLevel: 'admin', color: '#FEE75C',
        commands: [
            {
                name: 'ticket', emoji: '🎫',
                short: 'Manage the server support ticket system.',
                usage: '/ticket send-panel channel:#tickets — Send the ticket open button.\n/ticket list — View all currently open tickets.\n/ticket close — Close the current ticket.\n/ticket add user:@user — Add a user to the ticket.\n/ticket remove user:@user — Remove a user from the ticket.',
            },
        ]
    },
    {
        id: 'giveaway', emoji: '🎉', label: 'Giveaway',
        optionDesc: 'Requires: Administrator or Server Owner.',
        tip: '> 👑 Requires: Administrator or Server Owner.',
        minLevel: 'admin', color: '#FEE75C',
        commands: [
            {
                name: 'giveaway', emoji: '🎉',
                short: 'Create and manage server giveaways.',
                usage: '/giveaway start prize:Nitro duration:1d channel:#giveaway winners:3 — Start a giveaway.\n  duration formats: 30m, 1h, 1d, 7d\n/giveaway end giveaway:id — End a giveaway now.\n/giveaway reroll giveaway:id — Reroll the winner.\n/giveaway list — View all active giveaways.',
            },
        ]
    },
    {
        id: 'utility', emoji: '🔧', label: 'Utility',
        optionDesc: 'Requires: Administrator or Server Owner.',
        tip: '> 👑 Requires: Administrator or Server Owner.',
        minLevel: 'admin', color: '#FEE75C',
        commands: [
            {
                name: 'serverstats', emoji: '📊',
                short: 'Live voice channels displaying server statistics.',
                usage: '/serverstats setup category_name:📊 Stats — Create stats channels.\n/serverstats status active:true — Enable/disable.\n/serverstats label type:total format:👥 Members: {count} — Customize label.\n  type: total, human, bot, category\n/serverstats info — View configuration.\n/serverstats reset — Delete all stats configuration.',
            },
            {
                name: 'message', emoji: '📝',
                short: 'Create and manage reusable embed message templates.',
                usage: '/message create name:welcome — Create a new template.\n/message set-color name:welcome hex:#5865F2 — Set embed color.\n/message set-image name:welcome url:... — Set large image.\n/message set-thumbnail name:welcome url:... — Set thumbnail.\n/message preview name:welcome — Preview the template.\n/message list — List all saved templates.\n/message send name:welcome channel:#general — Send template.\n/message edit name:welcome — Edit a sent unique message.\n/message copy name:welcome newname:welcome2 — Duplicate template.\n/message delete name:welcome — Delete template.',
            },
            {
                name: 'set-nickname', emoji: '✏️',
                short: 'Change or reset the bot\'s nickname in this server.',
                usage: '/set-nickname name:OCTA — Set the bot nickname.\n/set-nickname — Reset to default (leave name field empty).',
            },
            {
                name: 'language', emoji: '🌐',
                short: 'Set the bot language for this server.',
                usage: '/language language:English — Set language to English.\n/language language:Indonesian — Set language to Indonesian.',
            },
        ]
    },
    {
        id: 'developer', emoji: '🛠️', label: 'Developer',
        optionDesc: 'Restricted to bot owner and developers.',
        tip: '> 🔒 Restricted to bot owner and developers.',
        minLevel: 'dev', color: '#FF73FA',
        commands: [
            {
                name: 'server', emoji: '🌐',
                short: 'Manage the bot from DMs by selecting an active server.',
                usage: '/server list — List all servers the bot is in.\n/server select id:123456789 — Select the active server.\n/server info — View the active server status.\n/server channels type:Text — View channels in active server.\n/server roles filter:Manual — View roles in active server.\n/server commands category:Utility — View commands in active server.\n/server cancel — Cancel the active server selection.',
            },
            {
                name: 'eval', emoji: '💻',
                short: 'Execute JavaScript code directly on the bot.',
                usage: '/eval code:client.guilds.cache.size — Run JS code for debugging.',
            },
            {
                name: 'reload', emoji: '🔄',
                short: 'Reload all commands without restarting the bot.',
                usage: '/reload — Reload all commands.',
            },
            {
                name: 'offline', emoji: '🔴',
                short: 'Safely shut down the bot.',
                usage: '/offline — Shut down the bot (database closed first).',
            },
            {
                name: 'restart', emoji: '🔁',
                short: 'Safely restart the bot.',
                usage: '/restart — Restart the bot (database closed first).',
            },
        ]
    },
];

function getAccessible(userLevel) {
    return CATEGORIES.filter(cat => hasAccess(userLevel, cat.minLevel));
}

// ─── Embed builders ──────────────────────────────────────────────────────────
function buildMainEmbed(client, s) {
    return new EmbedBuilder()
        .setColor('#5865F2')
        .setThumbnail(client.user.displayAvatarURL())
        .setTitle(client.user.username)
        .setDescription(s.main_desc(`@${client.user.username}`))
        .addFields({ name: s.main_commands_title, value: s.main_commands_val })
        .setFooter({ text: s.footer_main })
        .setTimestamp();
}

function buildCategoryEmbed(cat, s) {
    const list = cat.commands.map(cmd => `/${cmd.name} — ${cmd.emoji} ${cmd.short}`).join('\n');
    return new EmbedBuilder()
        .setColor(cat.color)
        .setTitle(s.cat_view_title(`${cat.emoji} ${cat.label}`))
        .setDescription(cat.tip)
        .addFields({ name: s.field_commands, value: list })
        .setFooter({ text: s.footer_cat(cat.label, cat.commands.length) })
        .setTimestamp();
}

function buildCommandEmbed(cat, cmd, s) {
    return new EmbedBuilder()
        .setColor(cat.color)
        .setTitle(s.cmd_view_title(cmd.name))
        .setDescription(`${cmd.emoji} ${cmd.short}`)
        .addFields({ name: s.field_usage, value: `\`\`\`\n${cmd.usage}\n\`\`\`` })
        .setFooter({ text: s.footer_cmd(cat.label) })
        .setTimestamp();
}

// ─── Select menu builders ────────────────────────────────────────────────────
function buildCategoryRow(accessCats, selectedId, s) {
    const selectedCat = accessCats.find(c => c.id === selectedId);
    const options = accessCats.map(cat =>
        new StringSelectMenuOptionBuilder()
            .setLabel(cat.label)
            .setDescription(cat.optionDesc.slice(0, 100))
            .setValue(cat.id)
            .setEmoji(cat.emoji)
            .setDefault(cat.id === selectedId)
    );
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('help-category')
            .setPlaceholder(selectedCat ? `${selectedCat.emoji} ${selectedCat.label}` : s.cat_placeholder)
            .addOptions(options)
    );
}

function buildCommandRow(cat, selectedCmdName, s) {
    const options = cat.commands.map(cmd =>
        new StringSelectMenuOptionBuilder()
            .setLabel(`/${cmd.name}`)
            .setDescription(cmd.short.slice(0, 100))
            .setValue(cmd.name)
            .setEmoji(cmd.emoji)
            .setDefault(cmd.name === selectedCmdName)
    );
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('help-command')
            .setPlaceholder(s.cmd_placeholder)
            .addOptions(options)
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

        const reply = await interaction.editReply({
            embeds:     [buildMainEmbed(client, s)],
            components: [buildCategoryRow(accessCats, null, s)]
        });

        const collector = reply.createMessageComponentCollector({
            filter: i => i.user.id === interaction.user.id &&
                (i.customId === 'help-category' || i.customId === 'help-command'),
            time: 3 * 60 * 1000
        });

        collector.on('collect', async i => {
            if (i.customId === 'help-category') {
                currentCatId   = i.values[0];
                currentCmdName = null;
            } else {
                currentCmdName = i.values[0];
            }

            const cat = CATEGORIES.find(c => c.id === currentCatId);
            if (!cat) return i.update({});

            const catRow = buildCategoryRow(accessCats, currentCatId, s);
            const cmdRow = buildCommandRow(cat, currentCmdName, s);

            let embed;
            if (currentCmdName) {
                const cmd = cat.commands.find(c => c.name === currentCmdName);
                embed = cmd ? buildCommandEmbed(cat, cmd, s) : buildCategoryEmbed(cat, s);
            } else {
                embed = buildCategoryEmbed(cat, s);
            }

            await i.update({ embeds: [embed], components: [catRow, cmdRow] });
        });

        collector.on('end', async () => {
            const disabledRow = new ActionRowBuilder().addComponents(
                StringSelectMenuBuilder.from(buildCategoryRow(accessCats, currentCatId, s).components[0])
                    .setDisabled(true)
                    .setPlaceholder(s.menu_expired)
            );
            await reply.edit({ components: [disabledRow] }).catch(() => null);
        });
    }
}).toJSON();

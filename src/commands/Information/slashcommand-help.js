const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { isDeveloper } = require("../../utils/dmGuildProxy");

// ═════════════════════════════════════════════════════════════════════════════
// HELPER — detect user access level
// ═════════════════════════════════════════════════════════════════════════════
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

// ═════════════════════════════════════════════════════════════════════════════
// DATA COMMAND
// ═════════════════════════════════════════════════════════════════════════════
const COMMANDS = {
    dev: [
        // ── Server DM ──────────────────────────────────────────────────────
        { name: '/server list',      desc: 'Show all servers the bot is in.',                                             example: '/server list' },
        { name: '/server select',    desc: 'Select the active server from DM. Required before other commands via DM.',             example: '/server select id:123456789' },
        { name: '/server info',      desc: 'View the currently active server and bot permission status.',                           example: '/server info' },
        { name: '/server channels',  desc: 'View all channels + IDs in the active server. Useful for filling IDs in other commands.', example: '/server channels type:Text' },
        { name: '/server roles',     desc: 'View all roles + IDs in the active server. Useful for filling role IDs in other commands.', example: '/server roles filter:Manual' },
        { name: '/server commands',  desc: 'Show all commands along with their configuration status in the active server.',        example: '/server commands category:Utility' },
        { name: '/server cancel',    desc: 'Cancel the active server selection.',                                                  example: '/server cancel' },
        // ── Kontrol Bot ────────────────────────────────────────────────────
        { name: '/eval',             desc: 'Run JavaScript code directly on the bot. For debugging.',                              example: '/eval code:client.guilds.cache.size' },
        { name: '/reload',           desc: 'Reload all commands without restarting the bot.',                                      example: '/reload' },
        { name: '/offline',          desc: 'Safely shut down the bot (database is closed first).',                                example: '/offline' },
        { name: '/restart',          desc: 'Safely restart the bot (database is closed first).',                                  example: '/restart' },
    ],
    admin: [
        // ── Welcome ────────────────────────────────────────────────────────
        { name: '/welcome status',          desc: 'View the current welcome message configuration.',                                      example: '/welcome status' },
        { name: '/welcome toggle',          desc: 'Enable/disable welcome messages for new members.',                                    example: '/welcome toggle active:true' },
        { name: '/welcome channel',         desc: 'Set the channel where welcome messages are sent.',                                     example: '/welcome channel channel:#welcome' },
        { name: '/welcome text',            desc: 'Edit the welcome embed title & description via modal. Placeholders: `{server}` `{member}` `{count}` `{tag}`', example: '/welcome text' },
        { name: '/welcome color',           desc: 'Change the welcome embed border color (hex).',                                        example: '/welcome color hex:#5865F2' },
        { name: '/welcome footer',          desc: 'Edit the welcome embed footer text.',                                                  example: '/welcome footer text:Welcome to the server!' },
        { name: '/welcome thumbnail',       desc: 'Show/hide the member profile picture in the welcome embed.',                          example: '/welcome thumbnail show:true' },
        { name: '/welcome fields',          desc: 'Show/hide info fields (new member, account created, total members, invited by, invite code, total invites).', example: '/welcome fields field:diundang_oleh show:true' },
        { name: '/welcome reset',           desc: 'Reset all welcome settings to default.',                                              example: '/welcome reset' },
        { name: '/welcome preview',         desc: 'Preview the welcome embed.',                                                          example: '/welcome preview' },
        // ── Goodbye ────────────────────────────────────────────────────────
        { name: '/goodbye status',    desc: 'View the goodbye message configuration.',                                          example: '/goodbye status' },
        { name: '/goodbye toggle',    desc: 'Enable/disable goodbye messages.',                                                 example: '/goodbye toggle active:true' },
        { name: '/goodbye channel',   desc: 'Set the goodbye message channel.',                                                 example: '/goodbye channel channel:#log-leave' },
        { name: '/goodbye type',      desc: 'Choose the message type: embed or plain text.',                                    example: '/goodbye type type:embed' },
        { name: '/goodbye text',      desc: 'Edit the embed title & description (embed) or plain text content (plain) via modal.', example: '/goodbye text' },
        { name: '/goodbye color',     desc: 'Change the goodbye embed border color (hex).',                                     example: '/goodbye color hex:#ED4245' },
        { name: '/goodbye footer',    desc: 'Edit the goodbye embed footer text.',                                               example: '/goodbye footer text:Goodbye!' },
        { name: '/goodbye thumbnail', desc: 'Show/hide the profile picture in the goodbye embed.',                               example: '/goodbye thumbnail show:false' },
        { name: '/goodbye fields',    desc: 'Show/hide info fields (member, joined, account created, total members).',           example: '/goodbye fields field:bergabung show:true' },
        { name: '/goodbye card',      desc: 'Configure goodbye card: toggle on/off, edit text, edit colors.',                  example: '/goodbye card action:toggle' },
        { name: '/goodbye reset',     desc: 'Reset all goodbye settings to default.',                                           example: '/goodbye reset' },
        { name: '/goodbye preview',   desc: 'Preview the goodbye message with current settings.',                               example: '/goodbye preview' },
        // ── Autorole (Otomatis) ────────────────────────────────────────────
        { name: '/autorole status',         desc: 'View active automatic roles for humans and bots.',                             example: '/autorole status' },
        { name: '/autorole human set',      desc: 'Auto-role for human members who join the server.',                             example: '/autorole human set role:@Member' },
        { name: '/autorole human toggle',   desc: 'Enable/disable human autorole.',                                               example: '/autorole human toggle active:true' },
        { name: '/autorole bot set',        desc: 'Auto-role for bots that are added.',                                           example: '/autorole bot set role:@Bot' },
        // ── Autorole Button ────────────────────────────────────────────────
        { name: '/autorole-button list',         desc: 'View all existing autorole button panels.',                              example: '/autorole-button list' },
        { name: '/autorole-button create',       desc: 'Create a new panel or change the template/mode. Mode: Multi or Single.',   example: '/autorole-button create name:gaming mode:multi' },
        { name: '/autorole-button add-button',   desc: 'Add a role button to a panel.',                                          example: '/autorole-button add-button panel:gaming role:@Gaming label:🎮 Gaming color:primary' },
        { name: '/autorole-button add-bulk',     desc: 'Add multiple buttons at once. Format: `@Role | Label | color`',          example: '/autorole-button add-bulk panel:gaming' },
        { name: '/autorole-button edit-button',  desc: 'Edit the label or color of an existing button in a panel.',              example: '/autorole-button edit-button panel:gaming role:@Gaming label:🎮 Gamer' },
        { name: '/autorole-button edit-bulk',    desc: 'Edit multiple buttons at once in a panel.',                              example: '/autorole-button edit-bulk panel:gaming' },
        { name: '/autorole-button delete-button', desc: 'Remove a single role button from a panel.',                             example: '/autorole-button delete-button panel:gaming role:@Gaming' },
        { name: '/autorole-button delete-bulk',  desc: 'Remove multiple buttons at once from a panel.',                          example: '/autorole-button delete-bulk panel:gaming' },
        { name: '/autorole-button send',         desc: 'Send the role button panel to a channel so members can click it.',       example: '/autorole-button send panel:gaming channel:#roles' },
        // ── Autorole Reaction ──────────────────────────────────────────────
        { name: '/autorole-reaction list',           desc: 'View all existing autorole reaction panels.',                            example: '/autorole-reaction list' },
        { name: '/autorole-reaction create',         desc: 'Create a new panel or edit the embed appearance. Mode: Multi or Single.', example: '/autorole-reaction create name:color mode:multi' },
        { name: '/autorole-reaction add-reaction',   desc: 'Add an emoji reaction + role to a panel.',                              example: '/autorole-reaction add-reaction panel:color emoji:🔴 role:@Red' },
        { name: '/autorole-reaction delete-reaction', desc: 'Remove a reaction from a panel by role.',                              example: '/autorole-reaction delete-reaction panel:color role:@Red' },
        { name: '/autorole-reaction delete-panel',   desc: 'Delete the entire panel from the database.',                            example: '/autorole-reaction delete-panel panel:color' },
        { name: '/autorole-reaction set-color',      desc: 'Change the panel embed left border color (hex).',                       example: '/autorole-reaction set-color panel:color hex:#5865F2' },
        { name: '/autorole-reaction preview',        desc: 'Preview the panel appearance (only visible to you).',                   example: '/autorole-reaction preview panel:color' },
        { name: '/autorole-reaction send',           desc: 'Send the panel to a channel (can only be sent once).',                  example: '/autorole-reaction send panel:color channel:#roles' },
        // ── Booster ────────────────────────────────────────────────────────
        { name: '/booster status',               desc: 'View all booster feature configurations.',                                example: '/booster status' },
        { name: '/booster list',                 desc: 'List all members currently boosting the server.',                         example: '/booster list' },
        { name: '/booster notif boost-toggle',   desc: 'Enable/disable notifications when someone boosts.',                      example: '/booster notif boost-toggle active:true' },
        { name: '/booster notif boost-channel',  desc: 'Set the notification channel when someone boosts.',                      example: '/booster notif boost-channel channel:#boost' },
        { name: '/booster notif boost-title',    desc: 'Edit the boost notification embed title.',                               example: '/booster notif boost-title text:Thank you, {member}!' },
        { name: '/booster notif boost-description', desc: 'Edit the boost notification embed description.',                      example: '/booster notif boost-description text:You have boosted the server!' },
        { name: '/booster notif boost-color',    desc: 'Change the boost notification embed color (hex).',                       example: '/booster notif boost-color hex:#FF73FA' },
        { name: '/booster notif unboost-toggle', desc: 'Enable/disable notifications when a boost ends.',                        example: '/booster notif unboost-toggle active:true' },
        { name: '/booster notif unboost-channel',desc: 'Set the notification channel when a boost ends.',                        example: '/booster notif unboost-channel channel:#boost' },
        { name: '/booster notif unboost-title',  desc: 'Edit the unboost notification embed title.',                             example: '/booster notif unboost-title text:See you, {member}!' },
        { name: '/booster notif unboost-description', desc: 'Edit the unboost notification embed description.',                  example: '/booster notif unboost-description text:Your boost has ended.' },
        { name: '/booster notif unboost-color',  desc: 'Change the unboost notification embed color (hex).',                     example: '/booster notif unboost-color hex:#ED4245' },
        { name: '/booster notif preview-boost',  desc: 'Preview the boost notification embed.',                                  example: '/booster notif preview-boost' },
        { name: '/booster notif preview-unboost',desc: 'Preview the unboost notification embed.',                                example: '/booster notif preview-unboost' },
        { name: '/booster autorole set',         desc: 'Assign an auto-role to members who boost.',                              example: '/booster autorole set role:@Booster' },
        { name: '/booster autorole toggle',      desc: 'Enable/disable automatic booster role assignment.',                      example: '/booster autorole toggle active:true' },
        { name: '/booster autorole autoremove',  desc: 'Automatically remove the booster role when someone stops boosting.',     example: '/booster autorole autoremove active:true' },
        { name: '/booster autorole remove',      desc: 'Remove the booster role configuration.',                                 example: '/booster autorole remove' },
        { name: '/booster reset',                desc: 'Reset some or all booster configurations.',                              example: '/booster reset' },
        // ── Server Stats ───────────────────────────────────────────────────
        { name: '/serverstats setup',       desc: 'Create a category & voice channels for automatic stats (total members, users, bots).', example: '/serverstats setup category_name:📊 Stats' },
        { name: '/serverstats status',      desc: 'Enable or disable the server stats feature.',                                  example: '/serverstats status active:true' },
        { name: '/serverstats label',       desc: 'Change the stats channel text format. Use `{count}` as the number.',           example: '/serverstats label type:total format:👥 Members: {count}' },
        { name: '/serverstats info',        desc: 'View the current server stats configuration.',                                 example: '/serverstats info' },
        { name: '/serverstats reset',       desc: 'Delete all server stats configurations (channels are not deleted).',           example: '/serverstats reset' },
        // ── Message / Embed ────────────────────────────────────────────────
        { name: '/message create',        desc: 'Create a named embed message template that can be reused.',               example: '/message create name:welcome' },
        { name: '/message set-color',     desc: 'Change the embed border color (hex).',                                    example: '/message set-color' },
        { name: '/message set-image',     desc: 'Set the large image on a message template.',                              example: '/message set-image' },
        { name: '/message set-thumbnail', desc: 'Set the thumbnail on a message template.',                                example: '/message set-thumbnail' },
        { name: '/message set-author',    desc: 'Set the author name and icon on a message template.',                     example: '/message set-author' },
        { name: '/message preview',       desc: 'Preview a message template.',                                             example: '/message preview' },
        { name: '/message info',          desc: 'View the details of a message template.',                                 example: '/message info' },
        { name: '/message list',          desc: 'List all saved message templates.',                                       example: '/message list' },
        { name: '/message send',          desc: 'Send a message template to a channel.',                                   example: '/message send name:welcome channel:#general' },
        { name: '/message edit',          desc: 'Edit a sent unique message template.',                                    example: '/message edit' },
        { name: '/message copy',          desc: 'Duplicate a message template with a new name.',                           example: '/message copy' },
        { name: '/message delete',        desc: 'Delete a message template.',                                              example: '/message delete name:welcome' },
        // ── Invite Links ───────────────────────────────────────────────────
        { name: '/invites',                 desc: 'Show all server invite links, sorted by most used. Supports pagination.',                         example: '/invites page:2' },
        // ── Automod ────────────────────────────────────────────────────────
        { name: '/automod config',             desc: 'View all current automod configurations.',                                      example: '/automod config' },
        { name: '/automod guide',              desc: 'Complete guide on how to set up the automod system.',                           example: '/automod guide' },
        { name: '/automod muteperms',          desc: 'Guide for setting up mute role permissions for the mute feature to work.',      example: '/automod muteperms' },
        { name: '/automod action',             desc: 'Choose the action on violation: delete / warn / mute / kick / ban.',            example: '/automod action type:warn' },
        { name: '/automod antilink',           desc: 'Enable/disable blocking of all URLs in messages.',                              example: '/automod antilink active:true' },
        { name: '/automod antiinvite',         desc: 'Enable/disable blocking of Discord invite links.',                              example: '/automod antiinvite active:true' },
        { name: '/automod spam',               desc: 'Configure anti-spam protection (message limit per interval).',                 example: '/automod spam active:true limit:5 interval:5' },
        { name: '/automod massmention',        desc: 'Configure the maximum mention limit in a single message.',                      example: '/automod massmention active:true limit:5' },
        { name: '/automod attachments',        desc: 'Enable/disable file/attachment filtering in messages.',                         example: '/automod attachments active:true' },
        { name: '/automod mute',               desc: 'Set the mute role to be used when the mute action is active.',                  example: '/automod mute role:@Muted' },
        { name: '/automod auditlog',           desc: 'Set the log channel for all automod activity.',                                 example: '/automod auditlog channel:#mod-log' },
        { name: '/automod antiraid',           desc: 'Configure anti-raid: block mass joins in a short time.',                       example: '/automod antiraid active:true join_limit:10 interval:10' },
        { name: '/automod words add',          desc: 'Add a banned word to the filter list.',                                         example: '/automod words add word:badword' },
        { name: '/automod words list',         desc: 'View all words in the banned list.',                                           example: '/automod words list' },
        { name: '/automod words delete',       desc: 'Remove a word from the banned list.',                                          example: '/automod words delete word:badword' },
        { name: '/automod whitelist add',      desc: 'Add a channel or role to the whitelist (exempt from automod).',                 example: '/automod whitelist add channel:#bot-spam' },
        { name: '/automod whitelist remove',   desc: 'Remove a channel or role from the whitelist.',                                  example: '/automod whitelist remove role:@Staff' },
        { name: '/automod whitelist list',     desc: 'View all whitelisted channels and roles.',                                      example: '/automod whitelist list' },
        // ── Ticket ─────────────────────────────────────────────────────────
        { name: '/ticket send-panel',   desc: 'Send the ticket panel to a specific channel.',                               example: '/ticket send-panel channel:#tickets' },
        { name: '/ticket list',         desc: 'View all currently open tickets in the server.',                             example: '/ticket list' },
        { name: '/ticket close',        desc: 'Close the ticket in this ticket channel.',                                   example: '/ticket close' },
        { name: '/ticket add',          desc: 'Add a user to the active ticket.',                                           example: '/ticket add user:@user' },
        { name: '/ticket remove',       desc: 'Remove a user\'s access from the active ticket.',                           example: '/ticket remove user:@user' },
        // ── Giveaway ───────────────────────────────────────────────────────
        { name: '/giveaway start',  desc: 'Start a new giveaway with a prize, duration, and winner count.',                example: '/giveaway start prize:Nitro duration:1d channel:#giveaway winners:3' },
        { name: '/giveaway end',    desc: 'End an active giveaway now and pick winners.',                                   example: '/giveaway end giveaway:id' },
        { name: '/giveaway reroll', desc: 'Reroll the winner of a finished giveaway.',                                     example: '/giveaway reroll giveaway:id' },
        { name: '/giveaway list',   desc: 'View all active giveaways in the server.',                                      example: '/giveaway list' },
        // ── Modlog ─────────────────────────────────────────────────────────
        { name: '/modlog set',      desc: 'Set the channel for logging moderation actions (ban, kick, timeout, warn).',    example: '/modlog set channel:#mod-log' },
        { name: '/modlog disable',  desc: 'Disable and remove the mod log configuration.',                                 example: '/modlog disable' },
        { name: '/modlog events',   desc: 'Choose which events to log: ban, unban, kick, timeout, warn.',                  example: '/modlog events' },
        // ── Warning ────────────────────────────────────────────────────────
        { name: '/warn add',    desc: 'Add a warning to a member with an optional reason.',                               example: '/warn add member:@user reason:spam' },
        { name: '/warn remove', desc: 'Remove a single warning by ID (see IDs from /warn list).',                         example: '/warn remove member:@user id:abc123' },
        { name: '/warn clear',  desc: 'Remove all warnings from a member.',                                               example: '/warn clear member:@user' },
        { name: '/warn list',   desc: 'View all warnings for a member along with IDs and reasons.',                        example: '/warn list member:@user' },
        // ── Ban / Kick / Mute ──────────────────────────────────────────────
        { name: '/ban member',   desc: 'Ban a member from the server. Optional: reason and delete message history (0–7 days).', example: '/ban member user:@user reason:violation' },
        { name: '/ban unban',    desc: 'Unban a user from the server by ID.',                                              example: '/ban unban user:123456789' },
        { name: '/kick',         desc: 'Kick a member from the server with an optional reason.',                           example: '/kick user:@user reason:spam' },
        { name: '/mute member',  desc: 'Timeout a member (e.g. 10m, 1h, 2d — max 28d).',                                 example: '/mute member user:@user duration:1h' },
        { name: '/mute unmute',  desc: 'Remove timeout from a member.',                                                    example: '/mute unmute user:@user' },
        // ── Purge / Lock / Slowmode ────────────────────────────────────────
        { name: '/purge all',    desc: 'Delete a number of recent messages in the channel (1–100).',                      example: '/purge all amount:50' },
        { name: '/purge user',   desc: 'Delete messages from a specific user in the channel (searches 1–100 messages).', example: '/purge user user:@user amount:20' },
        { name: '/lock channel', desc: 'Lock the channel so members cannot send messages. Supports strict mode.',         example: '/lock channel reason:maintenance' },
        { name: '/lock unlock',  desc: 'Unlock a previously locked channel.',                                             example: '/lock unlock' },
        { name: '/slowmode',     desc: 'Set or remove slowmode in the channel (e.g. 30s, 5m, 1h — 0 to disable).',       example: '/slowmode duration:30s' },
        // ── Lainnya ────────────────────────────────────────────────────────
        { name: '/set-nickname',            desc: 'Change or reset the bot nickname in this server.',                             example: '/set-nickname name:OCTA' },
    ],
    manager: [
        { name: '/welcome status',       desc: 'View the welcome message configuration.',               example: '/welcome status' },
        { name: '/welcome toggle',       desc: 'Enable/disable welcome messages.',                     example: '/welcome toggle active:true' },
        { name: '/welcome channel',      desc: 'Set the welcome message channel.',                     example: '/welcome channel channel:#welcome' },
        { name: '/goodbye status',       desc: 'View the goodbye message configuration.',              example: '/goodbye status' },
        { name: '/goodbye toggle',       desc: 'Enable/disable goodbye messages.',                     example: '/goodbye toggle active:true' },
        { name: '/goodbye channel',      desc: 'Set the goodbye message channel.',                     example: '/goodbye channel channel:#log' },
        { name: '/booster list',         desc: 'List members currently boosting the server.',          example: '/booster list' },
        { name: '/booster notif boost-toggle',   desc: 'Enable/disable boost notifications.',          example: '/booster notif boost-toggle active:true' },
        { name: '/booster notif unboost-toggle', desc: 'Enable/disable unboost notifications.',        example: '/booster notif unboost-toggle active:true' },
        { name: '/serverstats info',     desc: 'View the current server stats configuration.',         example: '/serverstats info' },
        { name: '/message create', desc: 'Create an embed message template.',              example: '/message create name:info' },
        { name: '/message list',   desc: 'List all message templates.',                   example: '/message list' },
        { name: '/message send',   desc: 'Send a message template to a channel.',         example: '/message send name:info channel:#general' },
        { name: '/invites',              desc: 'Show all server invite links with inviter details, channel, and total usage.',                   example: '/invites' },
        { name: '/automod config',       desc: 'View the current automod configuration.',                      example: '/automod config' },
        { name: '/automod antilink',     desc: 'Enable/disable link filtering.',                              example: '/automod antilink active:true' },
        { name: '/automod spam',         desc: 'Configure anti-spam.',                                        example: '/automod spam active:true' },
        { name: '/automod words add',    desc: 'Add a banned word.',                                          example: '/automod words add word:badword' },
        { name: '/automod whitelist add',desc: 'Whitelist a channel/role from automod.',                      example: '/automod whitelist add channel:#bot-spam' },
    ],
    moderator: [
        { name: '/booster list',  desc: 'View the list of members currently boosting the server.',     example: '/booster list' },
        // ── Warning ────────────────────────────────────────────────────────
        { name: '/warn add',    desc: 'Add a warning to a member with an optional reason.',            example: '/warn add member:@user reason:spam' },
        { name: '/warn remove', desc: 'Remove a single warning by ID.',                                example: '/warn remove member:@user id:abc123' },
        { name: '/warn clear',  desc: 'Remove all warnings from a member.',                            example: '/warn clear member:@user' },
        { name: '/warn list',   desc: 'View member warnings with IDs and reasons.',                    example: '/warn list member:@user' },
        // ── Ban / Kick / Mute ──────────────────────────────────────────────
        { name: '/ban member',   desc: 'Ban a member from the server with an optional reason.',        example: '/ban member user:@user reason:violation' },
        { name: '/ban unban',    desc: 'Unban a user from the server.',                                example: '/ban unban user:123456789' },
        { name: '/kick',         desc: 'Kick a member from the server with an optional reason.',       example: '/kick user:@user reason:spam' },
        { name: '/mute member',  desc: 'Timeout a member (e.g. 10m, 1h, 2d — max 28d).',              example: '/mute member user:@user duration:1h' },
        { name: '/mute unmute',  desc: 'Remove timeout from a member.',                                example: '/mute unmute user:@user' },
        // ── Purge ──────────────────────────────────────────────────────────
        { name: '/purge all',    desc: 'Delete a number of recent messages in the channel (1–100).',   example: '/purge all amount:50' },
        { name: '/purge user',   desc: 'Delete messages from a specific user in the channel.',          example: '/purge user user:@user amount:20' },
        // ── Info ───────────────────────────────────────────────────────────
        { name: '/userinfo',     desc: 'Show detailed information about a member.',                    example: '/userinfo user:@user' },
    ],
    member: [
        { name: '/help',      desc: 'Show this help menu.',                                            example: '/help' },
        { name: '/ping',      desc: 'Check the bot connection latency.',                               example: '/ping' },
        { name: '/userinfo',  desc: 'Show detailed information about yourself or another member.',     example: '/userinfo' },
    ],
};

// ═════════════════════════════════════════════════════════════════════════════
// PAGINATION HELPER
// Max ~12 commands per page to stay safely under 6000 char embed limit
// ═════════════════════════════════════════════════════════════════════════════
const CMDS_PER_PAGE = 5;

/**
 * Split commands into pages and build a single embed for one page.
 */
function buildPagedEmbed(category, isDM, guildName, userLevel, page = 0) {
    const COLOR = { dev:'#FF73FA', guild_owner:'#FEE75C', admin:'#FEE75C', manager:'#57F287', moderator:'#5865F2', member:'#EB459E', overview:'#99AAB5' };
    const TITLE = { dev:'🛠️ Developer / Bot Owner', guild_owner:'👑 Server Owner & Admin', admin:'👑 Server Owner & Admin', manager:'⚙️ Server Manager', moderator:'🛡️ Server Moderator', member:'👤 Member' };

    if (category === 'overview') {
        const ORDER = ['dev', 'guild_owner', 'admin', 'manager', 'moderator', 'member'];
        const idx   = ORDER.indexOf(userLevel);

        const lines = [];
        if (idx <= ORDER.indexOf('dev'))       lines.push('🛠️ **Developer** — Bot control, eval, reload, offline, restart, server DM');
        if (idx <= ORDER.indexOf('admin'))     lines.push('👑 **Admin** — Welcome, goodbye, autorole, booster, serverstats, message, ticket, giveaway, modlog, warn, ban, kick, mute, purge, lock, slowmode');
        if (idx <= ORDER.indexOf('manager'))   lines.push('⚙️ **Manager** — Server settings without administrator, invites');
        if (idx <= ORDER.indexOf('moderator')) lines.push('🛡️ **Moderator** — Warn, ban, kick, mute, purge, userinfo, booster list');
        lines.push('👤 **Member** — /help, /ping, /userinfo');

        if (isDM && userLevel === 'member') {
            return new EmbedBuilder()
                .setColor(COLOR.member)
                .setTitle('📖 Help Menu — DM Bot')
                .setDescription([
                    '> You are accessing help from the **DM Bot**.',
                    '',
                    '**📂 Available commands:**',
                    '👤 **Member** — /help and /ping',
                ].join('\n'))
                .setFooter({ text: 'Menu active for 3 minutes · Select a category from the menu below.' })
                .setTimestamp();
        }

        return new EmbedBuilder()
            .setColor(COLOR.overview)
            .setTitle(`📖 Help Menu${guildName ? ` — ${guildName}` : ' — DM Bot'}`)
            .setDescription([
                isDM
                    ? '> You are accessing help from the **DM Bot**. Use the menu below to view commands.'
                    : '> Select a category from the menu below to view commands and examples.',
                '',
                '**📂 Available categories:**',
                ...lines,
            ].join('\n'))
            .setFooter({ text: 'Menu active for 3 minutes · Select a category from the menu below.' })
            .setTimestamp();
    }

    // guild_owner category uses admin data
    const dataKey = category === 'guild_owner' ? 'admin' : category;
    const allCmds = COMMANDS[dataKey] ?? [];
    const totalPages = Math.ceil(allCmds.length / CMDS_PER_PAGE);
    const safePage   = Math.max(0, Math.min(page, totalPages - 1));

    const pageCmds = allCmds.slice(safePage * CMDS_PER_PAGE, (safePage + 1) * CMDS_PER_PAGE);

    const NOTE = {
        dev:         isDM
            ? '> 💡 From DM: use `/server select` first, then other commands will run on that server.'
            : '> 💡 These commands can also be used from the **bot DM** after `/server select`.',
        guild_owner: '> 💡 Requires **Administrator** permission or **Server Owner**.',
        admin:       '> 💡 Requires **Administrator** permission or **Server Owner**.',
        manager:     '> 💡 Requires **Manage Server** permission (without Administrator).',
        moderator:   '> 💡 Requires one of: Kick, Ban, Timeout, or Manage Messages.',
        member:      '> ℹ️ Commands available to all members.',
    };

    const fieldValue = pageCmds.map(c =>
        `**${c.name}**\n> ${c.desc}\n> 📌 \`${c.example}\``
    ).join('\n\n');

    return new EmbedBuilder()
        .setColor(COLOR[category] ?? '#99AAB5')
        .setTitle(TITLE[category] ?? '📋 Command')
        .setDescription(NOTE[category] ?? null)
        .addFields({
            name: `📋 Commands (${allCmds.length} total) — Page ${safePage + 1}/${totalPages}`,
            value: fieldValue,
            inline: false
        })
        .setFooter({ text: `${guildName ?? 'DM Bot'} · Page ${safePage + 1}/${totalPages} · Select another category from the menu.` })
        .setTimestamp();
}

function getTotalPages(category) {
    const dataKey = (category === 'guild_owner') ? 'admin' : category;
    const cmds = COMMANDS[dataKey] ?? [];
    return Math.max(1, Math.ceil(cmds.length / CMDS_PER_PAGE));
}

// ═════════════════════════════════════════════════════════════════════════════
// SELECT MENU
// ═════════════════════════════════════════════════════════════════════════════
function buildMenu(userLevel, isDM) {
    const ORDER  = ['dev', 'guild_owner', 'admin', 'manager', 'moderator', 'member'];
    const idx    = ORDER.indexOf(userLevel);
    const options = [];

    if (isDM && userLevel === 'member') {
        options.push(new StringSelectMenuOptionBuilder()
            .setLabel('👤 Member').setDescription('/help and /ping for everyone.').setValue('member').setEmoji('👤'));

        return new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('help-menu')
                .setPlaceholder('Select a command category…')
                .addOptions(options)
        );
    }

    options.push(new StringSelectMenuOptionBuilder()
        .setLabel('📋 Category Overview').setDescription('View all available categories.').setValue('overview').setEmoji('📋'));

    if (idx <= ORDER.indexOf('dev')) options.push(new StringSelectMenuOptionBuilder()
        .setLabel('🛠️ Developer / Bot Owner').setDescription('Eval, reload, offline, restart, server control via DM.').setValue('dev').setEmoji('🛠️'));

    if (idx <= ORDER.indexOf('admin')) options.push(new StringSelectMenuOptionBuilder()
        .setLabel('👑 Server Owner & Admin').setDescription('Welcome, autorole, booster, ticket, giveaway, modlog, warn, and more.').setValue('admin').setEmoji('👑'));

    if (idx <= ORDER.indexOf('manager')) options.push(new StringSelectMenuOptionBuilder()
        .setLabel('⚙️ Server Manager').setDescription('Server settings without administrator.').setValue('manager').setEmoji('⚙️'));

    if (idx <= ORDER.indexOf('moderator')) options.push(new StringSelectMenuOptionBuilder()
        .setLabel('🛡️ Server Moderator').setDescription('Warn, ban, kick, mute, purge, userinfo, and more.').setValue('moderator').setEmoji('🛡️'));

    options.push(new StringSelectMenuOptionBuilder()
        .setLabel('👤 Member').setDescription('/help and /ping for everyone.').setValue('member').setEmoji('👤'));

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('help-menu')
            .setPlaceholder('Select a command category…')
            .addOptions(options)
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// PAGINATION BUTTONS
// ═════════════════════════════════════════════════════════════════════════════
function buildNavRow(page, totalPages, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('help-prev')
            .setLabel('◀ Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled || page <= 0),
        new ButtonBuilder()
            .setCustomId('help-next')
            .setLabel('Next ▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled || page >= totalPages - 1),
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// COMMAND
// ═════════════════════════════════════════════════════════════════════════════
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
        const isDM      = !interaction.guild;
        const guildName = interaction.guild?.name ?? null;
        const userLevel = getUserLevel(interaction);

        await interaction.deferReply();

        // State for this session
        let currentCategory = 'overview';
        let currentPage     = 0;

        const overviewEmbed = buildPagedEmbed('overview', isDM, guildName, userLevel, 0);
        const menu          = buildMenu(userLevel, isDM);
        const totalPages    = getTotalPages(currentCategory);
        const navRow        = buildNavRow(0, totalPages);

        // Show nav buttons only if not overview and there's >1 page
        const components = currentCategory === 'overview' || totalPages <= 1
            ? [menu]
            : [menu, navRow];

        const reply = await interaction.editReply({
            embeds: [overviewEmbed],
            components: [menu]  // overview tidak perlu nav
        });

        // ── Collector for select menu AND navigation buttons ────────────
        const collector = reply.createMessageComponentCollector({
            filter: i => i.user.id === interaction.user.id &&
                (i.customId === 'help-menu' || i.customId === 'help-prev' || i.customId === 'help-next'),
            time: 3 * 60 * 1000
        });

        collector.on('collect', async i => {
            if (i.customId === 'help-menu') {
                // Change category, reset page
                currentCategory = i.values[0];
                currentPage     = 0;
            } else if (i.customId === 'help-prev') {
                currentPage = Math.max(0, currentPage - 1);
            } else if (i.customId === 'help-next') {
                const tp = getTotalPages(currentCategory);
                currentPage = Math.min(tp - 1, currentPage + 1);
            }

            const embed      = buildPagedEmbed(currentCategory, isDM, guildName, userLevel, currentPage);
            const tp         = getTotalPages(currentCategory);
            const newNavRow  = buildNavRow(currentPage, tp);

            // Show nav only if there's more than 1 page and it's not overview
            const newComponents = (currentCategory === 'overview' || tp <= 1)
                ? [menu]
                : [menu, newNavRow];

            await i.update({ embeds: [embed], components: newComponents });
        });

        collector.on('end', async () => {
            const disabledMenu = new ActionRowBuilder().addComponents(
                StringSelectMenuBuilder.from(menu.components[0])
                    .setDisabled(true)
                    .setPlaceholder('Menu is no longer active.')
            );
            await reply.edit({ components: [disabledMenu] }).catch(() => null);
        });
    }
}).toJSON();

const { PermissionFlagsBits, MessageFlags } = require('discord.js');

/**
 * Nama ramah untuk setiap permission flag.
 */
const PERM_NAMES = {
    [PermissionFlagsBits.SendMessages]:          'Send Messages',
    [PermissionFlagsBits.SendMessagesInThreads]: 'Send Messages in Threads',
    [PermissionFlagsBits.EmbedLinks]:            'Embed Links',
    [PermissionFlagsBits.AttachFiles]:           'Attach Files',
    [PermissionFlagsBits.ReadMessageHistory]:    'Read Message History',
    [PermissionFlagsBits.ViewChannel]:           'View Channel',
    [PermissionFlagsBits.ManageMessages]:        'Manage Messages',
    [PermissionFlagsBits.ManageChannels]:        'Manage Channels',
    [PermissionFlagsBits.ManageRoles]:           'Manage Roles',
    [PermissionFlagsBits.ManageWebhooks]:        'Manage Webhooks',
    [PermissionFlagsBits.Connect]:               'Connect',
    [PermissionFlagsBits.MoveMembers]:           'Move Members',
    [PermissionFlagsBits.CreateInstantInvite]:   'Create Invite',
    [PermissionFlagsBits.MentionEveryone]:       'Mention Everyone',
    [PermissionFlagsBits.AddReactions]:          'Add Reactions',
};

/**
 * Cek apakah bot punya semua permission yang diperlukan.
 * Jika `channel` diberikan, cek permission bot di channel tersebut (override guild).
 * Jika tidak, cek permission guild-wide.
 *
 * Kalau ada yang kurang, langsung reply error dan return false.
 *
 * @param {import('discord.js').ChatInputCommandInteraction | import('discord.js').ButtonInteraction} interaction
 * @param {bigint[]} perms - array PermissionFlagsBits yang dibutuhkan
 * @param {import('discord.js').GuildChannel | null} channel - opsional, cek per-channel
 * @returns {Promise<boolean>} true = OK, false = kurang & sudah reply error
 */
async function checkBotPermissions(interaction, perms, channel = null) {
    const guild     = interaction.guild;
    const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!botMember) {
        await interaction.reply({
            content: '❌ Failed to fetch bot data from server. Please try again.',
            flags: MessageFlags.Ephemeral
        });
        return false;
    }

    const target      = channel ?? interaction.channel;
    const permissions = target
        ? botMember.permissionsIn(target)
        : botMember.permissions;

    const missing = perms.filter(p => !permissions.has(p));
    if (missing.length === 0) return true;

    const missingNames = missing
        .map(p => `\`${PERM_NAMES[p] ?? String(p)}\``)
        .join(', ');

    const channelInfo = channel ? ` di <#${channel.id}>` : '';

    const replyMethod = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
    await interaction[replyMethod]({
        content: `❌ Bot does not have the required permissions${channelInfo}.\n\n**Missing permissions:** ${missingNames}`,
        flags: MessageFlags.Ephemeral
    });

    return false;
}

module.exports = { checkBotPermissions };

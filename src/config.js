const config = {
    database: {
        path: './data/database.db'
    },
    development: {
        enabled: false, // If true, the bot will register all application commands to a specific guild (not globally).
        guildId: '1507687982638039111',
        devGuildId: '1507687982638039111', // Private guild ID of the bot owner/developer. PRIVATE_COMMANDS (like /server) are only registered here, never globally.
    },
    commands: {
        prefix: '?oc', // For message commands, prefix is required. This can be changed by a database.
        message_commands: true, // If true, the bot will allow users to use message (or prefix) commands.
        application_commands: {
            chat_input: true, // If true, the bot will allow users to use chat input (or slash) commands.
            user_context: true, // If true, the bot will allow users to use user context menu commands.
            message_context: true // If true, the bot will allow users to use message context menu commands.
        }
    },
    users: {
        ownerId: '443953586313887762', // The bot owner ID, which is you.
        developers: ['443953586313887762', 'Another account ID'] // The bot developers, remember to include your account ID with the other account IDs.
    },
    messages: { // Messages configuration for application commands and message commands handler.
        NOT_BOT_OWNER: 'You do not have the permission to run this command because you\'re not the owner of me!',
        NOT_BOT_DEVELOPER: 'You do not have the permission to run this command because you\'re not a developer of me!',
        NOT_DEV_GUILD: 'This command can only be used in the developer server!',
        NOT_GUILD_OWNER: 'You do not have the permission to run this command because you\'re not the guild owner!',
        CHANNEL_NOT_NSFW: 'You cannot run this command in a non-NSFW channel!',
        MISSING_PERMISSIONS: 'You do not have the permission to run this command, missing permissions.',
        COMPONENT_NOT_PUBLIC: 'You are not the author of this button!',
        GUILD_COOLDOWN: 'You are currently in cooldown, you have the ability to re-use this command again in \`%cooldown%s\`.',
        MAINTENANCE_MODE: '🔧 **Bot is currently under maintenance.**\nAll commands are temporarily disabled. Please try again later.',
        BLACKLISTED_USER:  '🚫 You have been blacklisted from using this bot.',
        BLACKLISTED_GUILD: '🚫 This server has been blacklisted from using this bot.'
    }
}

module.exports = config;

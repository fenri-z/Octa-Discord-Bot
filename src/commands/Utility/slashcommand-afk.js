const ApplicationCommand = require('../../structure/ApplicationCommand');
const { getLang, getStrings } = require('../../utils/BotLang');

module.exports = new ApplicationCommand({
    command: {
        name: 'afk',
        description: 'Set your AFK status. The bot will notify others who mention you.',
        type: 1,
        options: [{
            type: 3, name: 'reason',
            description: 'Reason for being AFK (optional).',
            required: false,
        }],
    },
    run: async (client, interaction) => {
        const db      = client.database;
        const guildId = interaction.guild.id;
        const userId  = interaction.user.id;
        const s       = getStrings(getLang(db, guildId)).afk;

        const reason = interaction.options.getString('reason') || 'AFK';

        db.set(`afk-${guildId}-${userId}`, JSON.stringify({
            reason,
            since: Date.now(),
        }));

        return interaction.reply({
            content: s.set(reason),
        });
    }
}).toJSON();

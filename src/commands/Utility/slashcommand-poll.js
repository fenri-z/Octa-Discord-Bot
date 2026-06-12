const ApplicationCommand = require('../../structure/ApplicationCommand');
const { EmbedBuilder } = require('discord.js');
const { getLang, getStrings } = require('../../utils/BotLang');
const { schedulePoll } = require('../../utils/PollManager');

const EMOJIS = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

module.exports = new ApplicationCommand({
    command: {
        name: 'poll',
        description: 'Create a poll with up to 5 voting options.',
        type: 1,
        options: [
            { type: 3, name: 'question',  description: 'The poll question.',           required: true  },
            { type: 3, name: 'option1',   description: 'First option.',                required: true  },
            { type: 3, name: 'option2',   description: 'Second option.',               required: true  },
            { type: 3, name: 'option3',   description: 'Third option (optional).',     required: false },
            { type: 3, name: 'option4',   description: 'Fourth option (optional).',    required: false },
            { type: 3, name: 'option5',   description: 'Fifth option (optional).',     required: false },
            {
                type: 3, name: 'duration',
                description: 'Poll duration, e.g. 1h, 30m, 1d (optional).',
                required: false,
            },
        ],
    },
    run: async (client, interaction) => {
        const s = getStrings(getLang(client.database, interaction.guild?.id)).poll;

        const question = interaction.options.getString('question');
        const options  = [
            interaction.options.getString('option1'),
            interaction.options.getString('option2'),
            interaction.options.getString('option3'),
            interaction.options.getString('option4'),
            interaction.options.getString('option5'),
        ].filter(Boolean);

        const durationStr = interaction.options.getString('duration');
        const durationMs  = parseDuration(durationStr);

        const desc   = options.map((opt, i) => `${EMOJIS[i]} ${opt}`).join('\n');
        const endsAt = durationMs ? Date.now() + durationMs : null;

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`📊 ${question}`)
            .setDescription(desc)
            .setFooter({
                text: endsAt
                    ? s.footer_ends(interaction.user.username, new Date(endsAt).toLocaleString())
                    : s.footer_by(interaction.user.username),
            });

        const msg = await interaction.reply({ embeds: [embed], fetchReply: true });

        for (let i = 0; i < options.length; i++) {
            await msg.react(EMOJIS[i]).catch(() => null);
        }

        if (durationMs && durationMs <= 86_400_000 * 7) {
            const lang = getLang(client.database, interaction.guild?.id);
            const pollData = {
                guildId:   interaction.guild.id,
                channelId: interaction.channel.id,
                messageId: msg.id,
                question,
                options,
                endsAt:    endsAt,
                lang,
            };
            client.database.set(
                `poll-active-${interaction.channel.id}-${msg.id}`,
                JSON.stringify(pollData)
            );
            schedulePoll(client, pollData, durationMs);
        }
    }
}).toJSON();

function parseDuration(str) {
    if (!str) return null;
    const match = str.match(/^(\d+)(s|m|h|d)$/i);
    if (!match) return null;
    const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return parseInt(match[1]) * (units[match[2].toLowerCase()] ?? 0);
}


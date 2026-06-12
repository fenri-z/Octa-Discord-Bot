const ApplicationCommand = require('../../structure/ApplicationCommand');

module.exports = new ApplicationCommand({
    command: {
        name: 'poll',
        description: 'Create a native Discord poll with up to 10 options.',
        type: 1,
        options: [
            { type: 3, name: 'question',      description: 'The poll question.',                        required: true  },
            { type: 3, name: 'option1',        description: 'First option.',                             required: true  },
            { type: 3, name: 'option2',        description: 'Second option.',                            required: true  },
            { type: 3, name: 'option3',        description: 'Third option (optional).',                  required: false },
            { type: 3, name: 'option4',        description: 'Fourth option (optional).',                 required: false },
            { type: 3, name: 'option5',        description: 'Fifth option (optional).',                  required: false },
            { type: 3, name: 'option6',        description: 'Sixth option (optional).',                  required: false },
            { type: 3, name: 'option7',        description: 'Seventh option (optional).',                required: false },
            { type: 3, name: 'option8',        description: 'Eighth option (optional).',                 required: false },
            { type: 3, name: 'option9',        description: 'Ninth option (optional).',                  required: false },
            { type: 3, name: 'option10',       description: 'Tenth option (optional).',                  required: false },
            { type: 3, name: 'duration',       description: 'Duration: 1h, 6h, 1d, 7d (default: 24h).', required: false },
            { type: 5, name: 'multi_select',   description: 'Allow selecting multiple answers?',         required: false },
        ],
    },
    run: async (client, interaction) => {
        const question = interaction.options.getString('question');
        const options  = [
            interaction.options.getString('option1'),
            interaction.options.getString('option2'),
            interaction.options.getString('option3'),
            interaction.options.getString('option4'),
            interaction.options.getString('option5'),
            interaction.options.getString('option6'),
            interaction.options.getString('option7'),
            interaction.options.getString('option8'),
            interaction.options.getString('option9'),
            interaction.options.getString('option10'),
        ].filter(Boolean);

        const durationHours  = parseDurationHours(interaction.options.getString('duration'));
        const allowMulti     = interaction.options.getBoolean('multi_select') ?? false;

        await interaction.reply({
            poll: {
                question:        { text: question },
                answers:         options.map(opt => ({ text: opt })),
                duration:        durationHours,
                allowMultiselect: allowMulti,
            },
        });
    }
}).toJSON();

// Returns duration in hours (1–168). Defaults to 24 if invalid/missing.
function parseDurationHours(str) {
    if (!str) return 24;
    const match = str.match(/^(\d+)(m|h|d)$/i);
    if (!match) return 24;
    const val  = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    const hours = unit === 'm' ? Math.ceil(val / 60)
                : unit === 'h' ? val
                : unit === 'd' ? val * 24
                : 24;
    return Math.max(1, Math.min(168, hours));
}

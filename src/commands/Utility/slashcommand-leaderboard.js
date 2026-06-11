const ApplicationCommand = require('../../structure/ApplicationCommand');
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { getLang, getStrings } = require('../../utils/BotLang');

function xpForLevel(lvl) { return 5 * lvl * lvl + 50 * lvl + 100; }
function getLevelFromXP(totalXP) {
    let level = 0, acc = 0;
    while (true) { const n = xpForLevel(level); if (acc + n > totalXP) break; acc += n; level++; }
    return level;
}

module.exports = new ApplicationCommand({
    command: {
        name: 'leaderboard',
        description: 'Show the top 10 members ranked by total XP in this server.',
        type: 1,
    },
    run: async (client, interaction) => {
        const db      = client.database;
        const { guild } = interaction;
        const s       = getStrings(getLang(db, guild.id)).leaderboard;

        if (db.get(`level-enabled-${guild.id}`) !== 'true')
            return interaction.reply({ content: s.not_enabled, flags: MessageFlags.Ephemeral });

        await interaction.deferReply();

        const keys  = db.keysLike(`level-user-${guild.id}-%`);
        const top10 = keys
            .map(k => {
                const uid = k.replace(`level-user-${guild.id}-`, '');
                try { return { uid, data: JSON.parse(db.get(k)) }; } catch { return null; }
            })
            .filter(Boolean)
            .sort((a, b) => b.data.xp - a.data.xp)
            .slice(0, 10);

        if (!top10.length)
            return interaction.editReply(s.no_data);

        const medals = ['🥇', '🥈', '🥉'];
        const lines  = await Promise.all(top10.map(async ({ uid, data }, i) => {
            const member = guild.members.cache.get(uid)
                ?? await guild.members.fetch(uid).catch(() => null);
            const name   = member?.user.username ?? 'Unknown';
            const lvl    = getLevelFromXP(data.xp);
            const prefix = medals[i] ?? `**${i + 1}.**`;
            return `${prefix} **${name}** · Level ${lvl} · ${data.xp.toLocaleString()} XP`;
        }));

        const embed = new EmbedBuilder()
            .setColor(0xF0A032)
            .setTitle(s.title(guild.name))
            .setDescription(lines.join('\n'))
            .setFooter({ text: s.footer });

        return interaction.editReply({ embeds: [embed] });
    }
}).toJSON();

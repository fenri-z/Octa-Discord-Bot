const ApplicationCommand = require('../../structure/ApplicationCommand');
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { getLang, getStrings } = require('../../utils/BotLang');

function xpForLevel(lvl) { return 5 * lvl * lvl + 50 * lvl + 100; }

function getLevelInfo(totalXP) {
    let level = 0, accumulated = 0;
    while (true) {
        const needed = xpForLevel(level);
        if (accumulated + needed > totalXP) break;
        accumulated += needed;
        level++;
    }
    return { level, currentXP: totalXP - accumulated, nextLevelXP: xpForLevel(level) };
}

function progressBar(cur, total, len = 12) {
    const filled = Math.min(Math.round((cur / total) * len), len);
    return `\`[${'█'.repeat(filled)}${'░'.repeat(len - filled)}]\` ${Math.round((cur / total) * 100)}%`;
}

module.exports = new ApplicationCommand({
    command: {
        name: 'rank',
        description: 'Show level, XP, and ranking of a member.',
        type: 1,
        options: [{
            type: 6, name: 'member',
            description: 'Member to view (default: yourself).',
            required: false,
        }],
    },
    run: async (client, interaction) => {
        const db      = client.database;
        const guildId = interaction.guild.id;
        const s       = getStrings(getLang(db, guildId)).rank;

        if (db.get(`level-enabled-${guildId}`) !== 'true')
            return interaction.reply({ content: s.not_enabled, flags: MessageFlags.Ephemeral });

        const target   = interaction.options.getMember('member') ?? interaction.member;
        const raw      = db.get(`level-user-${guildId}-${target.id}`);
        const userData = raw ? JSON.parse(raw) : { xp: 0, level: 0 };

        const { level, currentXP, nextLevelXP } = getLevelInfo(userData.xp);

        const keys   = db.keysLike(`level-user-${guildId}-%`);
        const sorted = keys
            .map(k => { try { return { key: k, xp: JSON.parse(db.get(k)).xp }; } catch { return null; } })
            .filter(Boolean)
            .sort((a, b) => b.xp - a.xp);
        const rank = sorted.findIndex(e => e.key === `level-user-${guildId}-${target.id}`) + 1;

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setAuthor({ name: target.user.tag, iconURL: target.user.displayAvatarURL({ size: 64 }) })
            .setTitle(`Level ${level}`)
            .addFields(
                { name: s.field_xp_cur, value: `${currentXP.toLocaleString()} / ${nextLevelXP.toLocaleString()}`, inline: true },
                { name: s.field_xp_tot, value: userData.xp.toLocaleString(), inline: true },
                { name: s.field_rank,   value: rank > 0 ? `#${rank}` : '#—', inline: true },
                { name: s.field_prog,   value: progressBar(currentXP, nextLevelXP) },
            );

        return interaction.reply({ embeds: [embed] });
    }
}).toJSON();

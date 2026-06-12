const Event = require("../../structure/Event");
const { updateStats } = require("../../utils/serverStatsHelper");
const { safeRun } = require('../../utils/logError');

module.exports = new Event({
    event: 'guildMemberRemove',
    once: false,

    /**
     * @param {import("../../client/DiscordBot")} __client__
     * @param {import("discord.js").GuildMember} member
     */
    run: safeRun('[onMemberLeaveStats]', async (__client__, member) => {
        await updateStats(__client__, member.guild);
    })
}).toJSON();

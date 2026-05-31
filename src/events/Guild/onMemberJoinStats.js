const Event = require("../../structure/Event");
const { updateStats } = require("../../utils/serverStatsHelper");

module.exports = new Event({
    event: 'guildMemberAdd',
    once: false,

    /**
     * @param {import("../../client/DiscordBot")} __client__
     * @param {import("discord.js").GuildMember} member
     */
    run: async (__client__, member) => {
        await updateStats(__client__, member.guild);
    }
}).toJSON();

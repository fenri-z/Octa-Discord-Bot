const { Client, Collection, Partials } = require("discord.js");
const CommandsHandler = require("./handler/CommandsHandler");
const { warn, error, info, success } = require("../utils/Console");
const config = require("../config");
const CommandsListener = require("./handler/CommandsListener");
const ComponentsHandler = require("./handler/ComponentsHandler");
const ComponentsListener = require("./handler/ComponentsListener");
const EventsHandler = require("./handler/EventsHandler");
const SQLiteDatabase = require("../utils/SQLiteDatabase");

class DiscordBot extends Client {
    collection = {
        application_commands: new Collection(),
        message_commands: new Collection(),
        message_commands_aliases: new Collection(),
        components: {
            buttons: new Collection(),
            selects: new Collection(),
            modals: new Collection(),
            autocomplete: new Collection()
        }
    }
    rest_application_commands_array = [];
    login_attempts = 0;
    login_timestamp = 0;

    commands_handler = new CommandsHandler(this);
    components_handler = new ComponentsHandler(this);
    events_handler = new EventsHandler(this);
    database = new SQLiteDatabase(config.database.path);

    constructor() {
        super({
            // Bitmask 112383 = semua intent yang dibutuhkan bot ini TANPA:
            //   GuildPresences (1<<8 = 256)  → sangat berat, update setiap status member berubah
            //   GuildMessageTyping (1<<11)   → tidak dipakai
            //   DirectMessageTyping (1<<14)  → tidak dipakai
            // Sebelumnya: 3276799 (semua intent aktif termasuk yang berat)
            intents: 112383,
            partials: [
                Partials.Channel,
                Partials.GuildMember,
                Partials.Message,
                Partials.Reaction,
                Partials.User
            ],
            presence: {
                status: 'online',
                activities: [{ name: '/help', type: 4 }]
            }
        });
        
        new CommandsListener(this);
        new ComponentsListener(this);
    }

    connect = async () => {
        warn(`Attempting to connect to the Discord bot... (${this.login_attempts + 1})`);

        this.login_timestamp = Date.now();

        try {
            await this.login(process.env.CLIENT_TOKEN);
            this.commands_handler.load();
            this.components_handler.load();
            this.events_handler.load();

            success('Bot ready. Jalankan "node deploy-commands.js" jika perlu daftarkan ulang commands.');
        } catch (err) {
            error('Failed to connect to the Discord bot, retrying...');
            error(err);
            this.login_attempts++;
            setTimeout(this.connect, 5000);
        }
    }
}

module.exports = DiscordBot;

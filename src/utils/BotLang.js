const SUPPORTED    = ['en', 'id'];
const DEFAULT_LANG = 'en';

const LOCALES = {
    en: require('../locales/en'),
    id: require('../locales/id'),
};

function getLang(db, guildId) {
    const stored = db.get(`bot-lang-${guildId}`);
    return SUPPORTED.includes(stored) ? stored : DEFAULT_LANG;
}

function setLang(db, guildId, lang) {
    db.set(`bot-lang-${guildId}`, SUPPORTED.includes(lang) ? lang : DEFAULT_LANG);
}

function getStrings(lang) {
    return LOCALES[lang] ?? LOCALES[DEFAULT_LANG];
}

module.exports = { getLang, setLang, getStrings };

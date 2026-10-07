// The shell's own words (tray menu, update dialog) in the person's language (PulseWork ENG-20).
//
// Everything else people read is the hosted web app, which is already translated and keeps the language in the
// shared pulse_lang cookie. That cookie lives in this window's session, so the shell reads it from there (and
// follows it when it changes), falling back to the operating system's language, then English.
// Catalogs are locales/<language>/common.json, made by the Translate workflow (pulse-i18n).
const { app } = require('electron');
const { createMessages } = require('@pulsetechnologies/i18n');

// Static requires so the packager sees every catalog. Add a line when a language's catalog lands.
const catalogs = {
  en: require('./locales/en/common.json'),
  es: require('./locales/es/common.json'),
  'zh-Hans': require('./locales/zh-Hans/common.json'),
  'zh-Hant': require('./locales/zh-Hant/common.json'),
  hi: require('./locales/hi/common.json'),
  ar: require('./locales/ar/common.json'),
  fr: require('./locales/fr/common.json'),
  'pt-BR': require('./locales/pt-BR/common.json'),
  ru: require('./locales/ru/common.json'),
  bn: require('./locales/bn/common.json'),
  ja: require('./locales/ja/common.json'),
  de: require('./locales/de/common.json'),
  id: require('./locales/id/common.json'),
  ur: require('./locales/ur/common.json'),
  vi: require('./locales/vi/common.json'),
  ko: require('./locales/ko/common.json'),
  fil: require('./locales/fil/common.json'),
  ht: require('./locales/ht/common.json'),
};
const messages = createMessages(catalogs);

let current = 'en';
const listeners = new Set();

function setLanguage(code) {
  const next = messages.resolve(code);
  if (next === current) return;
  current = next;
  for (const fn of listeners) fn();
}

/** Start following the language: the OS first, then the app's pulse_lang cookie in `session`. */
function start(session) {
  setLanguage(app.getLocale());
  const read = (value) => { try { return decodeURIComponent(value); } catch { return value; } };
  session.cookies.get({ name: 'pulse_lang' }).then((found) => { if (found[0]) setLanguage(read(found[0].value)); }).catch(() => {});
  session.cookies.on('changed', (_event, cookie, _cause, removed) => {
    if (cookie.name === 'pulse_lang' && !removed) setLanguage(read(cookie.value));
  });
}

/** Translate a key in the current language; `{{name}}` values. */
const t = (key, vars) => messages.t(current, key, vars);

/** Run `fn` when the language changes (to rebuild the tray menu). */
const onChange = (fn) => { listeners.add(fn); };

module.exports = { start, t, onChange, language: () => current };

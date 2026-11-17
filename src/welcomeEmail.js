// The welcome e-mail a player gets right after the FIRST registration (a new profile, or a roster profile claimed with a phone and e-mail).
// The texts are edited in Backend > Menu ("Welcome e-mail" card, super admin) and kept as JSON in site_settings under 'welcomeEmail';
// what is not saved (or saved empty) is the built-in text below. {name} and {link} in a text are replaced; every line break of the body is kept,
// and a line that starts with "- " is a bullet.
const db = require('./db');

const KEY = 'welcomeEmail';

const DEFAULTS = {
  enabled: true,
  sk: {
    subject: 'Vitaj v lige BLTA, {name}!',
    body: [
      'Ahoj {name},',
      '',
      'vitaj v BLTA – Bratislavskej lige tenisových amatérov! Tvoj profil je vytvorený a môžeš začať. Takto to funguje:',
      '',
      '1. Prihlás sa – telefónnym číslom a 5-miestnym kódom, ktorý si si vytvoril pri registrácii.',
      '2. Doplň si profil – fotku, úroveň a čo ťa o tebe zaujíma.',
      '3. Prihlás sa do sezóny – v menu otvor Turnaje, vyber ligu alebo turnaj a klikni na Registrácia. Tak sa dostaneš do skupiny a do tabuliek.',
      '4. Hraj zápasy – termín si dohodneš so súperom zo svojej skupiny a výsledok zapíšeš cez + Nový zápas. Skóre sa dá zapisovať aj naživo.',
      '5. Sleduj svoj postup – tabuľky, rebríček a tvoje courtIQ sa aktualizujú automaticky.',
      '',
      'Chceš si len tak zahrať? V menu nájdeš Hľadám súpera – pridáš si voľné termíny a niekto sa ti ozve.',
      '',
      'Tvoj profil: {link}',
      '',
      'Máš otázku? Stačí odpovedať na tento e-mail.',
      '',
      'Vidíme sa na kurte!',
      'Tím BLTA',
    ].join('\n'),
  },
  en: {
    subject: 'Welcome to the BLTA league, {name}!',
    body: [
      'Hi {name},',
      '',
      'welcome to BLTA – the Bratislava League of Tennis Amateurs! Your profile is ready. Here is how it works:',
      '',
      '1. Sign in – with your phone number and the 5-digit code you created when you registered.',
      '2. Complete your profile – a photo, your level and a few words about you.',
      '3. Sign up for a season – open Tournaments in the menu, pick a league or a tournament and click Register. That puts you in a group and in the tables.',
      '4. Play your matches – agree a date with an opponent from your group and enter the result with + New match. You can also score live.',
      '5. Follow your progress – the tables, the ranking and your courtIQ update by themselves.',
      '',
      'Just want a game? Open Looking for an opponent in the menu, add the times you are free and someone will get in touch.',
      '',
      'Your profile: {link}',
      '',
      'Questions? Just reply to this e-mail.',
      '',
      'See you on court!',
      'The BLTA team',
    ].join('\n'),
  },
};

const LIMITS = { subject: 150, body: 6000 };

function read() {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(KEY);
  let saved = {};
  try { saved = row ? JSON.parse(row.value) : {}; } catch { saved = {}; }
  const pick = (lang, field) => (typeof (saved[lang] || {})[field] === 'string' && saved[lang][field].trim() ? saved[lang][field] : DEFAULTS[lang][field]);
  return {
    enabled: saved.enabled === false ? false : true,
    sk: { subject: pick('sk', 'subject'), body: pick('sk', 'body') },
    en: { subject: pick('en', 'subject'), body: pick('en', 'body') },
  };
}

// -> { error } or the saved values. A text left empty goes back to the built-in one.
function save(body) {
  const b = body || {};
  const out = { enabled: b.enabled !== false };
  for (const lang of ['sk', 'en']) {
    out[lang] = {};
    for (const field of ['subject', 'body']) {
      const v = typeof (b[lang] || {})[field] === 'string' ? b[lang][field].replace(/\r/g, '').trim() : '';
      if (v.length > LIMITS[field]) return { error: `The ${field} (${lang.toUpperCase()}) is too long (max ${LIMITS[field]} characters)` };
      out[lang][field] = field === 'subject' ? v.replace(/\s+/g, ' ') : v;
    }
  }
  db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(out));
  return read();
}

const fill = (text, vars) => String(text).replace(/\{(name|link)\}/g, (_, k) => vars[k]);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// -> { subject, text, html } in the player's language
function render(lang, { name, link }) {
  const s = read();
  const l = lang === 'en' ? 'en' : 'sk';
  const vars = { name, link };
  const subject = fill(s[l].subject, vars);
  const text = fill(s[l].body, vars);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1b1b1f;max-width:560px">${
    text.split('\n').map((line) => (line.trim() === '' ? '<div style="height:10px"></div>' : `<div>${esc(line).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#ff5500">$1</a>')}</div>`)).join('')
  }</div>`;
  return { subject, text, html };
}

module.exports = { DEFAULTS, read, save, render, isEnabled: () => read().enabled };

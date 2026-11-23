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

// The look of the e-mail: the BLTA colours (black, lime green, orange) in a table layout with inline styles, because mail programs ignore <style> and
// CSS classes. The TEXT is the one edited in the backend; only its lines are dressed: the first line is the big greeting, "1. Title – text" lines
// become numbered steps, "- " lines bullets, "Label: https://..." a button, the last paragraph the signature.
const C = { page: '#0d0c0a', card: '#17171a', line: '#2a2a30', white: '#ffffff', text: '#c9ccd3', dim: '#8b8f98', green: '#b2fa06', ink: '#0a0a0a', orange: '#ff5500' };
const FONT = "font-family:'Segoe UI',Helvetica,Arial,sans-serif;";

const button = (label, href) => `<tr><td style="padding:14px 0 6px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${C.orange}" style="border-radius:8px"><a href="${esc(href)}" style="display:inline-block;padding:13px 26px;${FONT}font-size:14px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:${C.white};text-decoration:none">${esc(label)} &rarr;</a></td></tr></table></td></tr>`;

// links inside a line of ALREADY ESCAPED text: "[Winter Opening Series](https://...)" (a space between ] and ( is allowed) and a bare https://... address become links
const inlineLinks = (html) => html.replace(/\[([^\]]+)\]\s*\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<]+)/g, (all, label, href, bare) => (bare
  ? `<a href="${bare}" style="color:${C.green}">${bare}</a>`
  : `<a href="${href}" style="color:${C.green};font-weight:700">${label}</a>`));

function dress(text, { origin, logoUrl }) {
  const lines = text.split('\n');
  // the signature = the last paragraph (after the last blank line), when there is more than one paragraph
  let sigFrom = lines.length;
  const lastBlank = lines.map((l) => l.trim()).lastIndexOf('');
  if (lastBlank > 0 && lastBlank < lines.length - 1) sigFrom = lastBlank + 1;
  const out = [];
  let first = true;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === '') { out.push('<tr><td style="height:10px;line-height:10px;font-size:0">&nbsp;</td></tr>'); return; }
    const bigTitle = (t) => `<tr><td style="${FONT}font-size:26px;line-height:1.25;font-weight:800;color:${C.white};padding-bottom:4px">${esc(t)}</td></tr>`;
    const heading = line.match(/^#\s+(.*)$/);
    if (heading) { first = false; out.push(bigTitle(heading[1])); return; }
    if (/^-{3,}$/.test(line)) {
      out.push(`<tr><td data-divider="1" style="padding:12px 0"><div style="border-top:1px solid ${C.line};height:1px;line-height:1px;font-size:0">&nbsp;</div></td></tr>`);
      return;
    }
    const box = line.match(/^>\s+(.*)$/);
    if (box) {
      out.push(`<tr><td style="padding:6px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#222a10" style="background:#222a10;border:1px solid ${C.green};border-radius:10px;padding:12px 16px;${FONT}font-size:15px;line-height:1.55;color:${C.white}">${esc(box[1])}</td></tr></table></td></tr>`);
      return;
    }
    const btn = line.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (btn) {
      const href = /^https?:\/\//i.test(btn[2]) || /^mailto:/i.test(btn[2]) ? btn[2] : (/^\/(?!\/)/.test(btn[2]) && origin ? origin + btn[2] : '');
      out.push(href ? button(btn[1], href) : `<tr><td style="${FONT}font-size:15px;line-height:1.6;color:${C.text}">${esc(btn[1])}</td></tr>`);
      return;
    }
    const step = line.match(/^(\d+)\.\s+(.*)$/);
    const bullet = !step && line.match(/^-\s+(.*)$/);
    if (step || bullet) {
      const body = inlineLinks(esc(step ? step[2] : bullet[1]));
      const cut = body.search(/\s[–-]\s/);
      const html = cut > 0 ? `<b style="color:${C.white}">${body.slice(0, cut)}</b>${body.slice(cut)}` : body;
      const badge = step
        ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" width="28" height="28" style="width:28px;height:28px;border-radius:14px;background:${C.green};color:${C.ink};${FONT}font-size:14px;font-weight:800">${esc(step[1])}</td></tr></table>`
        : `<div style="width:8px;height:8px;border-radius:4px;background:${C.green};margin:9px 0 0 10px"></div>`;
      out.push(`<tr><td style="padding:5px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td width="44" valign="top">${badge}</td><td valign="top" style="${FONT}font-size:15px;line-height:1.55;color:${C.text}">${html}</td></tr></table></td></tr>`);
      return;
    }
    const lk = line.match(/^(.*?):?\s*(https?:\/\/\S+)\s*$/);
    if (lk) {
      out.push(button(lk[1].trim() || 'BLTA', lk[2]));
      return;
    }
    if (i >= sigFrom) { // plain lines of the last paragraph: the signature
      const style = i === sigFrom ? `${FONT}font-size:16px;font-weight:800;color:${C.white};padding-top:6px` : `${FONT}font-size:14px;color:${C.green};font-weight:700`;
      out.push(`<tr><td style="${style}">${esc(line)}</td></tr>`);
      return;
    }
    if (first) { first = false; out.push(bigTitle(line)); return; } // the first plain line: the greeting
    out.push(`<tr><td style="${FONT}font-size:15px;line-height:1.6;color:${C.text}">${inlineLinks(esc(line))}</td></tr>`);
  });
  const logo = logoUrl ? `<img src="${esc(logoUrl)}" width="52" height="39" alt="BLTA" style="display:block;border:0">` : '';
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:${C.page}" bgcolor="${C.page}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
  <tr><td style="padding:0 4px 14px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle">${logo}</td><td valign="middle" style="padding-left:12px;${FONT}color:${C.white}"><div style="font-size:11px;font-weight:700;letter-spacing:.18em;color:${C.dim}">LIGA</div><div style="font-size:22px;font-weight:800;letter-spacing:.04em;color:${C.white}">BLTA</div></td></tr></table></td></tr>
  <tr><td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:14px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:30px 32px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${out.join('')}</table></td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding:16px 8px 0;${FONT}font-size:12px;color:${C.dim}">BLTA &middot; Bratislavská liga tenisových amatérov${origin ? ` &middot; <a href="${esc(origin)}" style="color:${C.dim}">${esc(origin.replace(/^https?:\/\//, ''))}</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
}

// -> { subject, text, html } in the player's language
// `bodyOverride` (the live preview of the backend editor) is used instead of the saved text; nothing is saved
function render(lang, { name, link }, bodyOverride) {
  const s = read();
  const l = lang === 'en' ? 'en' : 'sk';
  const vars = { name, link };
  const subject = fill(s[l].subject, vars);
  const text = fill(typeof bodyOverride === 'string' ? bodyOverride.replace(/\r/g, '') : s[l].body, vars);
  const origin = (/^https?:\/\/[^/]+/.exec(link || '') || [''])[0];
  const html = dress(text, { origin, logoUrl: origin ? `${origin}/img/blta-logo-sm.png` : '' });
  return { subject, text, html };
}

module.exports = { DEFAULTS, read, save, render, isEnabled: () => read().enabled };

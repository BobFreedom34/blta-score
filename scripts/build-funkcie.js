// Builds public/funkcie.html (the "Funkcie" page: every function of the app in categories) from docs/funkcie-aplikacie.md.
// Run `node scripts/build-funkcie.js` after editing the markdown; the page is plain static HTML (shell taken from courtiq.html).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inl = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
const P = {
  ball: '<circle cx="12" cy="12" r="10"/><path d="M5 5c3.5 3.5 3.5 10.5 0 14"/><path d="M19 5c-3.5 3.5-3.5 10.5 0 14"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  barChart: '<path d="M12 20V10M18 20V4M6 20v-4"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 14h6M9 18h4"/>',
  live: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  arrow: '<path d="M7 17 17 7"/><path d="M7 7h10v10"/>',
};
const ic = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${P[k]}</svg>`;
const META = {
  1: ['ball', 'Od naplánovania po výsledok – skóre sa mení pred očami, priamo z kurtu.'],
  2: ['search', 'Nikdy nehraj sám – nájdi partnera a dohodni zápas za pár klepnutí.'],
  3: ['user', 'Tvoja tenisová vizitka: štatistiky, úroveň, odznaky a pokrok.'],
  4: ['barChart', 'Vidíš, kde si, kto je pred tebou a o čo hráš.'],
  5: ['globe', 'Ligy vo viacerých mestách, sezóny, skupiny a play-off.'],
  6: ['trophy', 'Od prihlášky cez žreb a pavúk až po víťazov.'],
  7: ['users', 'Vlastná partia, klub alebo škola – so svojou stránkou, novinkami a rebríčkom.'],
  8: ['calendar', 'Voľné kurty na týždeň dopredu a rezervácia na jedno kliknutie.'],
  9: ['bell', 'Dôležité veci sa k tebe dostanú samy.'],
  10: ['live', 'Ukáž zápas svetu – na webe, v streame aj na veľkej obrazovke.'],
  11: ['phone', 'Vždy po ruke – bez sťahovania z obchodu.'],
};
const secs = [];
let cur = null;
for (const l of fs.readFileSync(path.join(root, 'docs', 'funkcie-aplikacie.md'), 'utf8').split(/\r?\n/)) {
  let m;
  if ((m = l.match(/^## (\d+)\. (.*)/))) { cur = { n: +m[1], name: m[2], cards: [] }; secs.push(cur); }
  else if (/^## /.test(l)) cur = null;
  else if (cur && /^\|/.test(l) && !/^\|[-| ]+\|$/.test(l)) {
    const c = l.replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
    if (c[0] !== 'Funkcia') cur.cards.push(c);
  }
}
const total = secs.reduce((a, s) => a + s.cards.length, 0);
const chips = secs.map((s) => `<a class="fn-chip" href="#fn-${s.n}">${ic(META[s.n][0])}${esc(s.name)}</a>`).join('');
const body = secs.map((s) => `<section class="fn-sec" id="fn-${s.n}"><div class="fn-sh"><div class="fn-hex">${ic(META[s.n][0])}</div><div><h2>${esc(s.name)}</h2><p>${esc(META[s.n][1])}</p></div></div><div class="fn-grid">${s.cards.map((c) => `<div class="fn-card grey-tile"><div class="fn-top"><div class="fn-ico">${ic(META[s.n][0])}</div><h3>${inl(c[0])}</h3></div><p>${inl(c[1] || '')}</p><div class="fn-foot"><span>${esc(s.name)}</span><em>${ic('arrow')}</em></div></div>`).join('')}</div></section>`).join('\n');
const shell = fs.readFileSync(path.join(root, 'public', 'courtiq.html'), 'utf8');
const startMain = shell.indexOf('<div class="container pr-page ciq-page"');
const endMain = shell.indexOf('\n', startMain);
const intro = `<div class="container pr-page fn-page">
  <h1 class="fn-h1">Funkcie</h1>
  <p class="page-intro">Všetko, čo ti aplikácia ponúka – od prvého zápasu až po víťazstvo v turnaji. Skóre naživo, rebríčky, turnaje, komunity aj rezervácie kurtov na jednom mieste.</p>
  <div class="fn-chips">${chips}</div>
${body}
</div>`;
let html = shell.slice(0, startMain) + intro + shell.slice(endMain);
html = html.replace(/<title>[^<]*<\/title>/, '<title>Funkcie - BLTA - Bratislavská Liga Tenisových Amatérov</title>')
  .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="Všetky funkcie aplikácie BLTA Score: živé skórovanie, rebríčky, turnaje, komunity, rezervácie kurtov, prenos a správa ligy v jednom prehľade.">')
  .replace('<script src="/js/courtiq-page.js"></script>\n', '');
fs.writeFileSync(path.join(root, 'public', 'funkcie.html'), html);
console.log('public/funkcie.html', total, 'cards,', secs.length, 'categories');

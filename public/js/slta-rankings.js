// The national page "Rebríčky miest" (slta.sk): the rankings of the cities side by side, three cities in a row. A switch picks the ranking
// (the main BLTA ranking, CourtIQ or the tournaments) and the chips pick the cities (none picked = every city). Data: GET /api/leagues/rankings.

const LANG = document.documentElement.lang === 'en' ? 'en' : 'sk';

const TEXT = {
  sk: {
    eyebrow: 'Slovenská liga tenisových amatérov',
    h1: 'Rebríčky <em>miest</em>',
    lead: 'Rebríčky jednotlivých miest.',
    filter: 'Mestá', all: 'Všetky mestá',
    navCities: 'Mestá', navRank: 'Rebríčky', navFeat: 'Funkcie', navHow: 'Ako to funguje', navFaq: 'Otázky', navOrg: 'Organizátori',
    footer: 'SLTA - Slovenská liga tenisových amatérov',
    blta: 'Hlavný rebríček', courtiq: 'CourtIQ', tournaments: 'Turnaje',
    descBlta: 'Hlavný rebríček: body BLTA za výsledky ligových zápasov.',
    descCourtiq: 'CourtIQ: automatický rating sily hráča od 1.0 do 7.0 počítaný zo skutočných zápasov. Otáznik znamená, že hodnotenie je zatiaľ predbežné.',
    descTournaments: 'Turnaje: body z turnajov.',
    players: 'hráčov', more: 'Celý rebríček', empty: 'Zatiaľ žiadne hodnotenia.', none: 'Rebríčky sa zatiaľ nepodarilo načítať.', provisional: 'predbežné',
  },
  en: {
    eyebrow: 'Slovak Amateur Tennis League',
    h1: 'City <em>rankings</em>',
    lead: 'Rankings of the individual cities.',
    filter: 'Cities', all: 'All cities',
    navCities: 'Cities', navRank: 'Rankings', navFeat: 'Features', navHow: 'How it works', navFaq: 'Questions', navOrg: 'Organisers',
    footer: 'SLTA - Slovak Amateur Tennis League',
    blta: 'Main ranking', courtiq: 'CourtIQ', tournaments: 'Tournaments',
    descBlta: 'Main ranking: BLTA points for the results of league matches.',
    descCourtiq: 'CourtIQ: an automatic skill rating from 1.0 to 7.0, computed from real matches. A question mark means the rating is still provisional.',
    descTournaments: 'Tournaments: points from tournaments.',
    players: 'players', more: 'Full ranking', empty: 'No ratings yet.', none: 'The rankings could not be loaded.', provisional: 'provisional',
  },
};
const T = TEXT[LANG];
const KINDS = ['blta', 'courtiq', 'tournaments'];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

document.querySelectorAll('[data-i]').forEach((el) => { if (T[el.dataset.i]) el.textContent = T[el.dataset.i]; });
document.querySelectorAll('[data-i-html]').forEach((el) => { if (T[el.dataset.iHtml]) el.innerHTML = T[el.dataset.iHtml]; });
document.getElementById(`lang-${LANG}`).classList.add('on');

(function mobileNav() {
  const toggle = document.getElementById('nav-toggle');
  const links = document.getElementById('nav-links');
  if (!toggle || !links) return;
  toggle.addEventListener('click', (e) => { e.stopPropagation(); links.classList.toggle('open'); });
  links.addEventListener('click', (e) => { if (e.target.closest('a')) links.classList.remove('open'); });
  document.addEventListener('click', (e) => { if (links.classList.contains('open') && !links.contains(e.target) && e.target !== toggle) links.classList.remove('open'); });
})();

let cities = [];
let kind = 'blta';
const picked = new Set(); // the slugs of the chosen cities; empty = all of them

// the state lives in the address (?tab=courtiq&cities=bratislava,kosice) so a link shows the same view
function readUrl() {
  const q = new URLSearchParams(location.search);
  if (KINDS.includes(q.get('tab'))) kind = q.get('tab');
  (q.get('cities') || '').split(',').filter(Boolean).forEach((s) => picked.add(s));
}
function writeUrl() {
  const q = new URLSearchParams();
  if (kind !== 'blta') q.set('tab', kind);
  if (picked.size) q.set('cities', [...picked].join(','));
  const text = q.toString();
  history.replaceState(null, '', location.pathname + (text ? `?${text}` : ''));
}

function renderControls() {
  document.getElementById('rk-tabs').innerHTML = KINDS.map((k) => `<button type="button" class="rk-tab${k === kind ? ' on' : ''}" role="tab" aria-selected="${k === kind}" data-kind="${k}">${esc(T[k])}</button>`).join('');
  document.getElementById('rk-chips').innerHTML = `<button type="button" class="rk-chip${picked.size ? '' : ' on'}" data-all="1">${esc(T.all)}</button>`
    + cities.map((c) => `<button type="button" class="rk-chip${picked.has(c.slug) ? ' on' : ''}" data-city="${esc(c.slug)}">${esc(c.name)}</button>`).join('');
  document.getElementById('rk-desc').textContent = T[{ blta: 'descBlta', courtiq: 'descCourtiq', tournaments: 'descTournaments' }[kind]];
}

function valueHtml(row) {
  if (kind === 'courtiq') return `${Number(row.value).toFixed(1)}${row.provisional ? `<span class="rk-q" title="${esc(T.provisional)}">?</span>` : ''}`;
  return esc(row.value);
}

function cardHtml(city) {
  const r = city.rankings[kind];
  const rows = r.rows.map((row) => {
    const name = row.link ? `<a class="rk-name" href="${esc(row.link)}">${esc(row.name)}</a>` : `<span class="rk-name">${esc(row.name)}</span>`;
    return `<div class="rk-row${row.rank <= 3 ? ` top${row.rank}` : ''}"><span class="rk-rank">${row.rank}</span>${name}<span class="rk-val">${valueHtml(row)}</span></div>`;
  }).join('');
  return `
    <article class="rk-card">
      <div class="rk-card-head"><h2 class="rk-city">${esc(city.name)}</h2><span class="rk-count">${(r.playerCount !== undefined ? r.playerCount : r.total) ? `${r.playerCount !== undefined ? r.playerCount : r.total} ${esc(T.players)}` : ''}</span></div>
      ${rows || `<div class="rk-empty">${esc(T.empty)}</div>`}
      ${r.total ? `<a class="rk-more" href="${esc(r.more)}">${esc(T.more)} ›</a>` : ''}
    </article>`;
}

function renderGrid() {
  const shown = cities.filter((c) => !picked.size || picked.has(c.slug));
  document.getElementById('rk-grid').innerHTML = shown.length ? shown.map(cardHtml).join('') : `<p class="rk-none">${esc(T.none)}</p>`;
}

function render() {
  renderControls();
  renderGrid();
  writeUrl();
}

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-kind]');
  if (tab) { kind = tab.dataset.kind; render(); return; }
  const chip = e.target.closest('.rk-chip');
  if (!chip) return;
  if (chip.dataset.all) picked.clear();
  else if (picked.has(chip.dataset.city)) picked.delete(chip.dataset.city);
  else picked.add(chip.dataset.city);
  render();
});

(async () => {
  readUrl();
  try {
    const res = await fetch(`/api/leagues/rankings?lang=${LANG}`);
    if (!res.ok) throw new Error('bad');
    cities = (await res.json()).cities || [];
  } catch {
    cities = [];
  }
  // a city in the address that has no rankings is dropped
  [...picked].forEach((s) => { if (!cities.some((c) => c.slug === s)) picked.delete(s); });
  render();
})();

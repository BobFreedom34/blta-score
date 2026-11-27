// League group tables: pick a season (the current one is selected on load) and a category to see every group
// table of that category; drill down to a single group with the group pills. The standings come from
// /api/seasons/:id/standings (calculated from the matches tagged with each group) and refresh whenever a match changes.
// A second filter row switches between the group stage (these tables) and the play-off: the bracket(s) of the chosen
// season and category (/api/seasons/:id/brackets, drawn with bracket-view.js).

const seasonEl = document.getElementById('tables-season');
const catsEl = document.getElementById('tables-cats');
const phaseEl = document.getElementById('tables-phase');
const groupsEl = document.getElementById('tables-groups');
const rootEl = document.getElementById('tables-root');
const legendEl = document.getElementById('tables-legend');

const CATEGORY_ORDER = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const CATEGORY_NAMES = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice' };

let seasons = [];
let seasonId = null;
let standings = null;
let category = null;
let groupId = null; // null = all groups of the category
let phase = 'GROUP'; // 'GROUP' = group stage tables, 'PLAYOFF' = the bracket
let playoffKind = 'MAIN'; // the play-off shows one kind of draw at a time: the main draw (Hlavný pavúk), the consolation draw (Útecha) or the placement draws
const kindOfBracket = (b) => (b.kind === 'CONSOLATION' ? 'CONSOLATION' : b.kind === 'PLACEMENT' ? 'PLACEMENT' : 'MAIN');
const kindLabel = (k) => t(k === 'CONSOLATION' ? 'season.kindConsolation' : k === 'PLACEMENT' ? 'season.kindPlacement' : 'season.kindMain');
let brackets = []; // the season's brackets: { id, name, category }
const bracketData = new Map(); // bracket id -> full bracket, cleared whenever the data is refreshed
// a result entered in a drawn bracket (bracket-result.js) comes back as the new bracket
document.addEventListener('bracket:changed', (e) => { if (e.detail && bracketData.has(e.detail.id)) bracketData.set(e.detail.id, e.detail); });
let bracketRun = 0; // guards a slow bracket request against a newer selection

// The season whose dates include today; otherwise the newest one that has matches.
function pickDefaultSeason() {
  // /tables?season=ID (the home page's season timeline links here) wins over the automatic choice.
  const wanted = Number(new URLSearchParams(window.location.search).get('season'));
  if (wanted && seasons.some((s) => s.id === wanted)) return wanted;
  const today = new Date().toISOString().slice(0, 10);
  const current = seasons.find((s) => s.startDate && s.endDate && s.startDate <= today && today <= s.endDate && s.groups.length);
  return (current || seasons.find((s) => s.matchCount > 0) || seasons[0] || {}).id || null;
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}

function renderTabs() {
  seasonEl.innerHTML = seasons.map((s) => `<option value="${s.id}"${s.id === seasonId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');

  const groups = standings ? standings.groups : [];
  const cats = CATEGORY_ORDER.filter((c) => groups.some((g) => g.category === c) || brackets.some((b) => b.category === c));
  if (!cats.includes(category)) category = cats[0] || null;
  catsEl.innerHTML = cats.map((c) => `<button type="button" class="tab${c === category ? ' active' : ''}" data-cat="${c}">${CATEGORY_NAMES[c]}</button>`).join('');

  phaseEl.innerHTML = [['GROUP', 'tables.phaseGroup'], ['PLAYOFF', 'tables.phasePlayoff']]
    .map(([key, label]) => `<button type="button" class="tab${key === phase ? ' active' : ''}" data-phase="${key}">${escapeHtml(t(label))}</button>`).join('');

  const inCat = groups.filter((g) => g.category === category);
  if (groupId !== null && !inCat.some((g) => g.id === groupId)) groupId = null;
  // the play-off: a filter for the kind of draw (only when the category has more than one kind), so the main draw and the consolation draw are not under each other
  const catBrackets = brackets.filter((b) => b.category === category);
  const kinds = ['MAIN', 'CONSOLATION', 'PLACEMENT'].filter((k) => catBrackets.some((b) => kindOfBracket(b) === k));
  if (!kinds.includes(playoffKind)) playoffKind = kinds[0] || 'MAIN';
  groupsEl.innerHTML = phase === 'GROUP' && inCat.length > 1
    ? `<button type="button" class="tab${groupId === null ? ' active' : ''}" data-group="all">${escapeHtml(t('tables.allGroups'))}</button>`
      + inCat.map((g) => `<button type="button" class="tab${g.id === groupId ? ' active' : ''}" data-group="${g.id}">${escapeHtml(groupShortName(g.name))}</button>`).join('')
    : (phase === 'PLAYOFF' && kinds.length > 1
      ? kinds.map((k) => `<button type="button" class="tab${k === playoffKind ? ' active' : ''}" data-kind="${k}">${escapeHtml(kindLabel(k))}<small>${catBrackets.filter((b) => kindOfBracket(b) === k).length}</small></button>`).join('')
      : '');
}

// The bracket(s) of the chosen season and category, drawn the same way as on the bracket page.
async function renderBrackets() {
  const run = (bracketRun += 1);
  const inCategory = brackets.filter((b) => b.category === category);
  const kindsHere = new Set(inCategory.map(kindOfBracket));
  const list = kindsHere.size > 1 ? inCategory.filter((b) => kindOfBracket(b) === playoffKind) : inCategory;
  const dates = standings && standings.startDate && standings.endDate ? ` · ${escapeHtml(formatDate(standings.startDate))} – ${escapeHtml(formatDate(standings.endDate))}` : '';
  legendEl.innerHTML = standings ? `${escapeHtml(standings.name)}${dates}` : '';
  if (!list.length) {
    rootEl.innerHTML = `<div class="empty-state">${escapeHtml(t('tables.noBracket'))}</div>`;
    return;
  }
  if (list.some((b) => !bracketData.has(b.id))) {
    rootEl.innerHTML = `<div class="empty-state">${escapeHtml(t('common.loading'))}</div>`;
    await Promise.all(list.filter((b) => !bracketData.has(b.id)).map(async (b) => {
      try { bracketData.set(b.id, await api(`/brackets/${b.id}`)); } catch { /* shown as missing below */ }
    }));
    if (run !== bracketRun) return; // a newer selection replaced this one
  }
  const html = list.filter((b) => bracketData.has(b.id)).map((b) => `
    <section class="grp-section">
      <h2 class="grp-title">${escapeHtml(b.name)}</h2>
      ${bracketBoardHtml(bracketData.get(b.id))}
    </section>`).join('');
  rootEl.innerHTML = html || `<div class="empty-state">${escapeHtml(t('tables.noBracket'))}</div>`;
}

function renderTables() {
  if (phase === 'PLAYOFF') { renderBrackets(); return; }
  const groups = standings ? standings.groups.filter((g) => g.category === category && (groupId === null || g.id === groupId)) : [];
  if (!groups.length) {
    rootEl.innerHTML = `<div class="empty-state">${escapeHtml(t('tables.noGroups'))}</div>`;
    legendEl.textContent = '';
    return;
  }
  rootEl.innerHTML = groups.map(groupTableHtml).join('');
  const dates = standings.startDate && standings.endDate ? ` · ${escapeHtml(formatDate(standings.startDate))} – ${escapeHtml(formatDate(standings.endDate))}` : '';
  legendEl.innerHTML = `${escapeHtml(t('tables.rules'))}<br>${escapeHtml(standings.name)}${dates}${standings.frozen ? `<br>${escapeHtml(t('tables.frozen'))}` : ''}`;
}

async function loadStandings() {
  bracketData.clear();
  if (!seasonId) { standings = null; brackets = []; return; }
  try {
    standings = await api(`/seasons/${seasonId}/standings`);
  } catch {
    standings = null;
  }
  try {
    brackets = await api(`/seasons/${seasonId}/brackets`);
  } catch {
    brackets = [];
  }
}

async function refresh() {
  await loadStandings();
  renderTabs();
  renderTables();
}

seasonEl.addEventListener('change', async () => {
  seasonId = Number(seasonEl.value);
  category = null;
  groupId = null;
  await refresh();
});
catsEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  category = b.dataset.cat;
  groupId = null;
  renderTabs();
  renderTables();
});
phaseEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-phase]');
  if (!b || b.dataset.phase === phase) return;
  phase = b.dataset.phase;
  renderTabs();
  renderTables();
});
groupsEl.addEventListener('click', (e) => {
  const k = e.target.closest('[data-kind]');
  if (k) { playoffKind = k.dataset.kind; renderTabs(); renderTables(); return; }
  const b = e.target.closest('[data-group]');
  if (!b) return;
  groupId = b.dataset.group === 'all' ? null : Number(b.dataset.group);
  renderTabs();
  renderTables();
});

(async () => {
  try {
    // a tournament is listed here only when it has groups (its brackets are on its own page)
    seasons = (await api('/seasons')).filter((s) => s.kind !== 'TOURNAMENT' || s.groups.length);
  } catch {
    rootEl.innerHTML = `<div class="empty-state">${escapeHtml(t('tables.noGroups'))}</div>`;
    return;
  }
  seasonId = pickDefaultSeason();
  await refresh();
  // Always in step with the matches: any change anywhere recalculates the tables being shown.
  if (typeof io === 'function') {
    const socket = io();
    let timer = null;
    socket.on('matches:changed', (e) => { if (e && e.status === 'SCHEDULE') return; clearTimeout(timer); timer = setTimeout(refresh, 600); });
  }
})();

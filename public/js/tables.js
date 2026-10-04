// League group tables: pick a season (the current one is selected on load) and a category to see every group
// table of that category; drill down to a single group with the group pills. The standings come from
// /api/seasons/:id/standings (calculated from the matches tagged with each group) and refresh whenever a match changes.

const seasonEl = document.getElementById('tables-season');
const catsEl = document.getElementById('tables-cats');
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

function initials(name) {
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0] || '')[0] + ((parts[1] || '')[0] || '')).toUpperCase();
}

// The season whose dates include today; otherwise the newest one that has matches.
function pickDefaultSeason() {
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
  const cats = CATEGORY_ORDER.filter((c) => groups.some((g) => g.category === c));
  if (!cats.includes(category)) category = cats[0] || null;
  catsEl.innerHTML = cats.map((c) => `<button type="button" class="tab${c === category ? ' active' : ''}" data-cat="${c}">${CATEGORY_NAMES[c]}</button>`).join('');

  const inCat = groups.filter((g) => g.category === category);
  if (groupId !== null && !inCat.some((g) => g.id === groupId)) groupId = null;
  groupsEl.innerHTML = inCat.length > 1
    ? `<button type="button" class="tab${groupId === null ? ' active' : ''}" data-group="all">${escapeHtml(t('tables.allGroups'))}</button>`
      + inCat.map((g) => `<button type="button" class="tab${g.id === groupId ? ' active' : ''}" data-group="${g.id}">${escapeHtml(g.name)}</button>`).join('')
    : '';
}

function tableHtml(group) {
  return `
    <section class="grp-section">
      <h2 class="grp-title">${escapeHtml(group.name)} <span>${escapeHtml(t('tables.counted', { done: group.matchesCounted, total: group.matchesTotal }))}</span></h2>
      <div class="card card-dark grp-card">
        <div class="grp-head">
          <span>#</span><span>${escapeHtml(t('tables.player'))}</span><span>${escapeHtml(t('tables.points'))}</span><span>${escapeHtml(t('tables.matches'))}</span><span>${escapeHtml(t('tables.wins'))}</span><span>${escapeHtml(t('tables.losses'))}</span><span>+/−</span>
        </div>
        ${group.rows.length ? group.rows.map((r) => {
          const d = r.setDiff;
          return `
          <div class="grp-row">
            <span class="grp-pos">${r.position}</span>
            <a class="grp-name" href="/player/${encodeURIComponent(r.player.slug || r.player.id)}"><em>${escapeHtml(initials(r.player.name))}</em><b>${escapeHtml(r.player.name)}</b></a>
            <span class="grp-pts">${r.points}</span>
            <span class="dim">${r.played}</span>
            <span class="dim">${r.wins}</span>
            <span class="dim">${r.losses}</span>
            <span class="${d > 0 ? 'pos' : d < 0 ? 'neg' : 'dim'}">${d > 0 ? `+${d}` : d}</span>
          </div>`;
        }).join('') : `<div class="empty-state" style="padding:18px 0">${escapeHtml(t('tables.noPlayers'))}</div>`}
      </div>
    </section>`;
}

function renderTables() {
  const groups = standings ? standings.groups.filter((g) => g.category === category && (groupId === null || g.id === groupId)) : [];
  if (!groups.length) {
    rootEl.innerHTML = `<div class="empty-state">${escapeHtml(t('tables.noGroups'))}</div>`;
    legendEl.textContent = '';
    return;
  }
  rootEl.innerHTML = groups.map(tableHtml).join('');
  const dates = standings.startDate && standings.endDate ? ` · ${escapeHtml(formatDate(standings.startDate))} – ${escapeHtml(formatDate(standings.endDate))}` : '';
  legendEl.innerHTML = `${escapeHtml(t('tables.rules'))}<br>${escapeHtml(standings.name)}${dates}`;
}

async function loadStandings() {
  if (!seasonId) { standings = null; return; }
  try {
    standings = await api(`/seasons/${seasonId}/standings`);
  } catch {
    standings = null;
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
groupsEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-group]');
  if (!b) return;
  groupId = b.dataset.group === 'all' ? null : Number(b.dataset.group);
  renderTabs();
  renderTables();
});

(async () => {
  try {
    seasons = await api('/seasons');
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
    socket.on('matches:changed', () => { clearTimeout(timer); timer = setTimeout(refresh, 600); });
  }
})();

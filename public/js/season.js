// Season page (/season/<slug>): one page per season that gathers what already lives elsewhere in the app — the numbers of the
// season (from its dates, groups and players), the group tables, the latest results and next matches, the round schedule, the
// players, the play-off bracket — each as a short block with a link to the full page. Only the entry fee, prize money, draw
// date, description, gallery link and the "paid" ticks are entered for this page (backend > Seasons).
// Data: GET /api/seasons/by-slug/:slug, /api/seasons/:id/standings, /api/seasons/:id/brackets, /api/matches?seasonId=…

const rootEl = document.getElementById('sv-root');
const slug = decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1] || '');

const CATEGORY_ORDER = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const CATEGORY_NAMES = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice' };

let season = null;
let standings = null;
let brackets = [];
let results = [];
let upcoming = [];
let roundMatches = [];
let category = null;
let round = null;
const bracketData = new Map(); // bracket id -> full bracket, cleared whenever the data is refreshed
let spyOff = null;

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayWord(n) {
  if (n === 1) return t('schedule.dayOne');
  if (currentLang === 'en') return t('schedule.dayMany');
  return n >= 2 && n <= 4 ? t('schedule.dayFew') : t('schedule.dayMany');
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}

// "Sep – Dec 2026" / "Dec 2025 – Apr 2026"
function termText() {
  if (!season.startDate || !season.endDate) return '';
  const a = new Date(`${season.startDate}T12:00:00`);
  const b = new Date(`${season.endDate}T12:00:00`);
  const loc = currentLang === 'en' ? 'en-GB' : 'sk-SK';
  const month = (d) => d.toLocaleDateString(loc, { month: 'short' }).replace('.', '');
  const first = a.getFullYear() === b.getFullYear() ? month(a) : `${month(a)} ${a.getFullYear()}`;
  return `${first} – ${month(b)} ${b.getFullYear()}`;
}

// ---------- data ----------

async function loadStandings() {
  bracketData.clear();
  try { standings = await api(`/seasons/${season.id}/standings`); } catch { standings = null; }
  try { brackets = await api(`/seasons/${season.id}/brackets`); } catch { brackets = []; }
}

async function loadBlocks() {
  const base = `seasonId=${season.id}`;
  const soft = (p) => p.catch(() => []);
  const [finished, live, planned] = await Promise.all([
    soft(api(`/matches?${base}&status=FINISHED&limit=5`)),
    soft(api(`/matches?${base}&status=LIVE`)),
    soft(api(`/matches?${base}&status=PLANNED&limit=5`)),
  ]);
  results = finished;
  upcoming = [...live, ...planned].slice(0, 5);
}

async function loadRound() {
  roundMatches = round === null ? [] : await api(`/matches?seasonId=${season.id}&round=${round}`).catch(() => []);
}

// The round to show first: the first one that still has matches to play, else the last.
function pickRound() {
  const rounds = season.rounds || [];
  if (!rounds.length) return null;
  const open = rounds.find((r) => r.finished < r.total);
  return (open || rounds[rounds.length - 1]).round;
}

// ---------- pieces ----------

function statusOf() {
  const today = todayIso();
  if (standings && standings.frozen) return 'past';
  if (season.endDate && season.endDate < today) return 'past';
  if (season.startDate && season.startDate > today) return 'future';
  return 'now';
}

// The players of the season: the group lists (with their paid tick); a finished season whose lists were never filled uses
// the names in its final tables.
function playersList() {
  const groups = season.groups || [];
  const members = groups.flatMap((g) => g.members.filter((m) => !m.withdrawn).map((m) => ({ id: m.id, name: m.name, slug: m.slug, category: g.category, paid: m.paid })));
  if (members.length) return members;
  return (standings ? standings.groups : []).flatMap((g) => g.rows.map((r) => ({ id: r.player.id, name: r.player.name, slug: r.player.slug, category: g.category, paid: null })));
}

function matchRowHtml(m, withMeta = true) {
  const done = m.status === 'FINISHED';
  const live = m.status === 'LIVE';
  const sets = (m.state && m.state.setsWon) || { 1: 0, 2: 0 };
  const mid = done
    ? `<span class="sc">${sets[1]} : ${sets[2]}</span>`
    : live
      ? `<span class="sc live">${escapeHtml(t('home.live'))}</span>`
      : `<span class="sc tbd">${escapeHtml(m.scheduledAt ? compactDateOnly(m.scheduledAt) : t('season.noDate'))}</span>`;
  const meta = !withMeta ? '' : [
    m.group ? `${CATEGORY_NAMES[m.group.category] || m.group.category} · ${m.group.name}` : '',
    m.round ? t('season.roundN', { n: m.round }) : '',
    done && m.scheduledAt ? compactDateOnly(m.scheduledAt) : '',
  ].filter(Boolean).join(' · ');
  return `
    <a class="sv-m" href="/match/${m.token}">
      <span class="a${done && m.winnerId === m.player1.id ? ' w' : ''}">${escapeHtml(m.player1.name)}</span>${mid}<span class="b${done && m.winnerId === m.player2.id ? ' w' : ''}">${escapeHtml(m.player2.name)}</span>
      ${meta ? `<span class="meta">${escapeHtml(meta)}</span>` : ''}
    </a>`;
}

function secHead(id, title, linkHref, linkText, count) {
  return `<div class="sv-sec-h"><h2>${escapeHtml(title)}${count ? `<em>${escapeHtml(String(count))}</em>` : ''}</h2>${linkHref ? `<a href="${linkHref}">${escapeHtml(linkText)} ›</a>` : ''}</div>`;
}

function headerHtml() {
  const status = statusOf();
  const today = todayIso();
  let note = '';
  if (status === 'now' && season.endDate) {
    const left = Math.max(0, Math.round((new Date(`${season.endDate}T12:00:00`) - new Date(`${today}T12:00:00`)) / 864e5));
    note = `<span class="sv-chip w">${escapeHtml(t('schedule.daysLeft', { n: left, d: dayWord(left) }))}</span>`;
  } else if (status === 'future' && season.startDate) {
    const n = Math.round((new Date(`${season.startDate}T12:00:00`) - new Date(`${today}T12:00:00`)) / 864e5);
    note = `<span class="sv-chip w">${escapeHtml(t('schedule.startsIn', { n, d: dayWord(n) }))}</span>`;
  }
  const state = status === 'now' ? `<span class="sv-chip now">${escapeHtml(t('schedule.running'))}</span>`
    : status === 'past' ? `<span class="sv-chip w">${escapeHtml(t('season.over'))}</span>`
      : `<span class="sv-chip w">${escapeHtml(t('season.upcomingChip'))}</span>`;
  return `
    <div class="sv-crumb"><a href="/harmonogram">${escapeHtml(t('schedule.heading'))}</a> › ${escapeHtml(termText())}</div>
    <h1 class="sv-title">${escapeHtml(season.name)}</h1>
    <div class="sv-chips"><span class="sv-chip l">${escapeHtml(t('schedule.league'))}</span>${state}${note}</div>
    <div class="sv-progress">${seasonProgressHtml(season, standings)}</div>`;
}

function tilesHtml() {
  const players = playersList().length;
  const groupCount = (season.groups || []).length || (standings ? standings.groups.length : 0);
  const tile = (key, value, sub) => `<div class="sv-tile"><div class="k">${escapeHtml(t(key))}</div><div class="v">${value}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</div></div>`;
  const cats = CATEGORY_ORDER.filter((c) => (season.groups || []).some((g) => g.category === c) || (standings && standings.groups.some((g) => g.category === c)));
  const tiles = [
    cats.length ? tile('season.tileCats', String(cats.length), cats.map((c) => CATEGORY_NAMES[c]).join(' · ')) : '',
    termText() ? `<div class="sv-tile"><div class="k">${escapeHtml(t('season.tileTerm'))}</div><div class="v sm">${escapeHtml(termText())}</div></div>` : '',
    players ? tile('season.tilePlayers', String(players), groupCount ? t('season.groupsN', { n: groupCount }) : '') : '',
    season.entryFee ? `<div class="sv-tile"><div class="k">${escapeHtml(t('season.tileFee'))}</div><div class="v">${escapeHtml(season.entryFee)}</div></div>` : '',
    season.drawDate ? `<div class="sv-tile"><div class="k">${escapeHtml(t('season.tileDraw'))}</div><div class="v sm">${escapeHtml(formatDate(season.drawDate))}</div></div>` : '',
    season.prizeMoney ? `<div class="sv-tile"><div class="k">${escapeHtml(t('season.tilePrize'))}</div><div class="v sm">${escapeHtml(season.prizeMoney)}</div></div>` : '',
  ].join('');
  const info = season.info ? `<p class="sv-info">${escapeHtml(season.info)}</p>` : '';
  return `<div class="sv-tiles" id="sv-info">${tiles}</div>${info}`;
}

function resultsHtml() {
  if (!results.length && !upcoming.length) return '';
  const rows = (list, empty) => (list.length ? list.map(matchRowHtml).join('') : `<div class="sv-empty">${escapeHtml(empty)}</div>`);
  return `
    <section class="sv-sec" id="sv-results">
      <div class="sv-two">
        <div>${secHead('results', t('season.results'), `/matches?season=${season.id}&tab=FINISHED`, t('season.allResults'))}<div class="sv-box">${rows(results, t('season.noResults'))}</div></div>
        <div>${secHead('upcoming', t('season.upcoming'), `/matches?season=${season.id}`, t('season.allMatches'))}<div class="sv-box">${rows(upcoming, t('season.noUpcoming'))}</div></div>
      </div>
    </section>`;
}

function tablesHtml() {
  const groups = standings ? standings.groups : [];
  if (!groups.length) return '';
  const cats = CATEGORY_ORDER.filter((c) => groups.some((g) => g.category === c));
  if (!cats.includes(category)) category = cats[0];
  const pills = cats.map((c) => `<button type="button" class="tab${c === category ? ' active' : ''}" data-cat="${c}">${escapeHtml(CATEGORY_NAMES[c])}<small>${groups.filter((g) => g.category === c).length}</small></button>`).join('');
  const frozen = standings.frozen ? `<p class="sv-note">${escapeHtml(t('tables.frozen'))}</p>` : '';
  return `
    <section class="sv-sec" id="sv-tables">
      ${secHead('tables', t('season.tables'), `/tables?season=${season.id}`, t('season.fullTables'))}
      <div class="tabs" id="sv-cats">${pills}</div>
      <div class="sv-gl">${groups.filter((g) => g.category === category).map(groupTableHtml).join('')}</div>
      ${frozen}
    </section>`;
}

function scheduleHtml() {
  const rounds = season.rounds || [];
  if (!rounds.length) return '';
  const pills = rounds.map((r) => `<button type="button" class="sv-round${r.round === round ? ' cur' : ''}${r.finished >= r.total ? ' done' : ''}" data-round="${r.round}">${escapeHtml(t('season.roundN', { n: r.round }))}<small>${r.finished}/${r.total}</small></button>`).join('');
  const order = new Map((season.groups || []).map((g, i) => [g.id, i]));
  const sorted = [...roundMatches].sort((a, b) => (order.get(a.group && a.group.id) ?? 99) - (order.get(b.group && b.group.id) ?? 99));
  let html = '';
  let last = null;
  sorted.forEach((m) => {
    const key = m.group ? m.group.id : 0;
    if (key !== last) {
      last = key;
      html += `<div class="sv-ghead">${m.group ? `${escapeHtml(CATEGORY_NAMES[m.group.category] || m.group.category)} · <b>${escapeHtml(m.group.name)}</b>` : ''}</div>`;
    }
    html += matchRowHtml(m, false);
  });
  return `
    <section class="sv-sec" id="sv-schedule">
      ${secHead('schedule', t('season.schedule'), `/matches?season=${season.id}`, t('season.allMatches'))}
      <div class="sv-rounds" id="sv-rounds">${pills}</div>
      <div class="sv-box">${html || `<div class="sv-empty">${escapeHtml(t('season.noSchedule'))}</div>`}</div>
    </section>`;
}

function playersHtml() {
  const list = playersList();
  if (!list.length) return '';
  const showPaid = !!season.entryFee && list.some((p) => p.paid !== null);
  const loc = currentLang === 'en' ? 'en' : 'sk';
  const rows = [...list].sort((a, b) => a.name.localeCompare(b.name, loc)).map((p) => {
    const name = p.id ? `<a href="/player/${encodeURIComponent(p.slug || p.id)}">${escapeHtml(p.name)}</a>` : escapeHtml(p.name);
    const paid = showPaid ? `<span class="${p.paid ? 'ok' : 'no'}">${escapeHtml(p.paid ? `✓ ${t('season.paid')}` : `— ${t('season.unpaid')}`)}</span>` : '';
    return `<div><span>${name} <em>${escapeHtml(CATEGORY_NAMES[p.category] || '')}</em></span>${paid}</div>`;
  }).join('');
  return `
    <section class="sv-sec" id="sv-players">
      ${secHead('players', t('season.players'), '/players', t('season.allPlayers'), list.length)}
      <div class="sv-pl">${rows}</div>
    </section>`;
}

function playoffHtml() {
  const hasGroups = standings && standings.groups.length;
  if (!brackets.length && (statusOf() === 'past' || !hasGroups)) return '';
  const body = brackets.length
    ? brackets.map((b) => `<div class="sv-bracket" data-bracket="${b.id}"><h3 class="grp-title">${escapeHtml(CATEGORY_NAMES[b.category] || '')} · ${escapeHtml(b.name)}</h3><div class="sv-bracket-body">${escapeHtml(t('common.loading'))}</div></div>`).join('')
    : `<div class="sv-empty">${escapeHtml(t('season.playoffSoon'))}</div>`;
  return `<section class="sv-sec" id="sv-playoff">${secHead('playoff', t('season.playoff'))}${body}</section>`;
}

async function fillBrackets() {
  const holders = [...rootEl.querySelectorAll('[data-bracket]')];
  await Promise.all(holders.map(async (el) => {
    const id = Number(el.dataset.bracket);
    if (!bracketData.has(id)) {
      try { bracketData.set(id, await api(`/brackets/${id}`)); } catch { /* shown as missing below */ }
    }
    const body = el.querySelector('.sv-bracket-body');
    if (body) body.innerHTML = bracketData.has(id) ? bracketBoardHtml(bracketData.get(id)) : escapeHtml(t('tables.noBracket'));
  }));
}

function galleryHtml() {
  if (!season.galleryUrl) return '';
  return `<section class="sv-sec" id="sv-gallery">${secHead('gallery', t('season.gallery'))}<a class="sv-gallery-btn" href="${escapeHtml(season.galleryUrl)}" target="_blank" rel="noopener">${escapeHtml(t('season.galleryOpen'))}</a></section>`;
}

// ---------- page ----------

function render() {
  const sections = [
    ['sv-info', 'season.navInfo', true],
    ['sv-tables', 'season.navTables', !!tablesHtml()],
    ['sv-results', 'season.navResults', !!resultsHtml()],
    ['sv-schedule', 'season.navSchedule', !!scheduleHtml()],
    ['sv-players', 'season.navPlayers', !!playersHtml()],
    ['sv-playoff', 'season.navPlayoff', !!playoffHtml()],
    ['sv-gallery', 'season.navGallery', !!galleryHtml()],
  ].filter((s) => s[2]);
  const nav = `<nav class="sv-nav" id="sv-nav">${sections.map(([id, label]) => `<a href="#${id}" data-target="${id}">${escapeHtml(t(label))}</a>`).join('')}</nav>`;
  rootEl.innerHTML = `${headerHtml()}${tilesHtml()}${nav}${tablesHtml()}${resultsHtml()}${scheduleHtml()}${playersHtml()}${playoffHtml()}${galleryHtml()}`;
  fillBrackets();
  initNav();
}

// The section menu sticks under the top bar and marks the section being read.
function initNav() {
  const nav = document.getElementById('sv-nav');
  if (!nav) return;
  const topbar = document.querySelector('.topbar');
  const top = topbar ? topbar.getBoundingClientRect().height : 56;
  nav.style.top = `${top}px`;
  if (spyOff) spyOff();
  let queued = false;
  const update = () => {
    queued = false;
    const line = top + nav.offsetHeight + 24;
    let current = nav.querySelector('a');
    nav.querySelectorAll('a').forEach((a) => {
      const el = document.getElementById(a.dataset.target);
      if (el && el.getBoundingClientRect().top <= line) current = a;
    });
    nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a === current));
    if (current && nav.scrollWidth > nav.clientWidth) {
      const target = current.offsetLeft - 16;
      if (Math.abs(nav.scrollLeft - target) > 40) nav.scrollTo({ left: target, behavior: 'smooth' });
    }
  };
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  spyOff = () => window.removeEventListener('scroll', onScroll);
  update();
  nav.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-target]');
    if (!a) return;
    e.preventDefault();
    const el = document.getElementById(a.dataset.target);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - top - nav.offsetHeight - 14, behavior: 'smooth' });
  });
}

rootEl.addEventListener('click', async (e) => {
  const cat = e.target.closest('#sv-cats [data-cat]');
  if (cat) { category = cat.dataset.cat; render(); return; }
  const r = e.target.closest('#sv-rounds [data-round]');
  if (r) {
    round = Number(r.dataset.round);
    await loadRound();
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }
});

let refreshTimer = null;
async function refresh() {
  try {
    season = await api(`/seasons/by-slug/${encodeURIComponent(slug)}`);
    await Promise.all([loadStandings(), loadBlocks(), loadRound()]);
  } catch { return; }
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

(async () => {
  try {
    season = await api(`/seasons/by-slug/${encodeURIComponent(slug)}`);
  } catch {
    rootEl.innerHTML = `<div class="empty-state">${escapeHtml(t('season.notFound'))}</div>`;
    return;
  }
  document.title = `${season.name} — Tennis SCORE`;
  round = pickRound();
  await Promise.all([loadStandings(), loadBlocks(), loadRound()]);
  render();
  // a match changed somewhere: refresh the tables and match blocks (a moment later, so a burst of points is one refresh)
  if (typeof io === 'function') {
    io().on('matches:changed', () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, 1500);
    });
  }
})();

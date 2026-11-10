// Schedule page (/harmonogram): the list of the league seasons and tournaments of the chosen year, grouped by the month they start in (shown first), and a year-at-a-glance
// timeline of the same events (every one as a bar across the twelve months). Two buttons switch between them; the choice is remembered in the browser.
// Data: GET /api/schedule (seasons come from the seasons table, tournaments from the backend's event list).
// Year pills choose the year, two selects filter by category and by event type. Language changes reload the page.

const yearsEl = document.getElementById('sch-years');
const catEl = document.getElementById('sch-cat');
const typeEl = document.getElementById('sch-type');
const timelineEl = document.getElementById('sch-timeline');
const rootEl = document.getElementById('sch-root');

let events = [];
let year = null;
let cat = 'ALL';
let type = 'ALL';
// the address can open the page already filtered: /harmonogram?type=TOURNAMENT (the menu item "Turnaje") or ?type=LEAGUE; the year is the current one unless ?year= says another
try {
  const asked = new URLSearchParams(window.location.search);
  if (['TOURNAMENT', 'LEAGUE'].includes(asked.get('type'))) type = asked.get('type');
  if (/^d{4}$/.test(asked.get('year') || '')) year = Number(asked.get('year'));
} catch { /* no filter */ }
let view = 'list'; // 'list' (the first look) | 'timeline'
try { if (localStorage.getItem('blta_schedule_view') === 'timeline') view = 'timeline'; } catch { /* the list stays */ }
const viewEl = document.getElementById('sch-view');

const CATEGORY_ORDER = ['ELITE', 'NEXT_GEN', 'NOVICE', 'DOUBLES'];
const CATEGORY_NAMES = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice', get DOUBLES() { return t('season.catDoubles'); } }; // DOUBLES: the doubles tournaments

function locale() {
  return currentLang === 'en' ? 'en-GB' : 'sk-SK';
}

// the dates, the status and the progress come from the shared row template (public/js/schedule-row.js), the same one the tournament cards of the clubs use
const parseDay = schRow.parseDay;
const todayIso = schRow.todayIso;
const daysBetween = schRow.daysBetween;
const dayWord = schRow.dayWord;

// The years an event touches (a season that runs from December to April belongs to both).
function eventYears(e) {
  const out = [];
  for (let y = parseDay(e.startDate).getFullYear(); y <= parseDay(e.endDate).getFullYear(); y += 1) out.push(y);
  return out;
}

function allYears() {
  return [...new Set(events.flatMap(eventYears))].sort((a, b) => b - a);
}

function pickDefaultYear() {
  const years = allYears();
  const now = new Date().getFullYear();
  return years.includes(now) ? now : (years.find((y) => y < now) || years[years.length - 1] || null);
}

function renderFilters() {
  yearsEl.innerHTML = allYears().map((y) => `<button type="button" class="tab${y === year ? ' active' : ''}" data-year="${y}">${y}</button>`).join('');
  catEl.innerHTML = `<option value="ALL">${escapeHtml(t('schedule.allCats'))}</option>`
    + CATEGORY_ORDER.map((c) => `<option value="${c}"${c === cat ? ' selected' : ''}>${escapeHtml(CATEGORY_NAMES[c])}</option>`).join('');
  typeEl.innerHTML = [['ALL', 'schedule.allTypes'], ['LEAGUE', 'schedule.league'], ['TOURNAMENT', 'schedule.tournaments']]
    .map(([key, label]) => `<option value="${key}"${key === type ? ' selected' : ''}>${escapeHtml(t(label))}</option>`).join('');
}

const dateRange = (e) => schRow.dateRange(e.startDate, e.endDate);
const yearText = (e) => schRow.yearText(e.startDate, e.endDate);
// (tournamentEnded: the playing window of its last day is over)
const statusOf = (e, today) => schRow.statusOf({ ...e, ended: e.tournamentEnded }, today);
const progressOf = (e, today) => schRow.progressOf(e, today);

function categoriesText(e) {
  return e.categories.map((c) => CATEGORY_NAMES[c] || c).join(' · ');
}

// ---------- the year timeline ----------

function timelineHtml(shown, today) {
  const yearStart = `${year}-01-01`;
  const yearDays = daysBetween(yearStart, `${year}-12-31`) + 1;
  const at = (iso) => (Math.max(0, Math.min(yearDays, daysBetween(yearStart, iso))) / yearDays) * 100;
  const months = Array.from({ length: 12 }, (_, m) => new Date(year, m, 1, 12).toLocaleDateString(locale(), { month: 'short' }).replace('.', ''));
  const rows = shown.map((e) => {
    const status = statusOf(e, today);
    const isLeague = e.type === 'LEAGUE';
    const start = at(e.startDate);
    const end = Math.min(100, ((Math.min(yearDays, daysBetween(yearStart, e.endDate) + 1)) / yearDays) * 100);
    const width = Math.max(end - start, 1.2);
    let bar;
    if (isLeague && width >= 9) {
      const fill = status === 'now' ? `<i style="width:${progressOf(e, today)}%"></i>` : '';
      bar = `<div class="sch-bar ${status}" style="left:${start}%;width:${width}%">${fill}<span>${escapeHtml(dateRange(e))}</span></div>`;
    } else {
      // a short bar (a tournament, or the few days of a season that fall in this year) has no room for its date inside:
      // the date sits beside it, on the side with room (the right edge would cut it off)
      const side = start > 75 ? `right:calc(${100 - start}% + 10px)` : `left:calc(${start + width}% + 10px)`;
      bar = `<div class="sch-bar ${isLeague ? '' : 'tour '}${status}" style="left:${start}%;width:${width}%"></div><span class="sch-bar-label" style="${side}">${escapeHtml(dateRange(e))}</span>`;
    }
    const sub = [t(isLeague ? 'schedule.league' : 'schedule.tournament'), e.venue, categoriesText(e)].filter(Boolean).join(' · ');
    return `<div class="sch-tl-row"><div class="sch-tl-label"><b>${escapeHtml(e.name)}</b><small>${escapeHtml(sub)}</small></div><div class="sch-tl-track">${bar}</div></div>`;
  }).join('');
  const marker = Number(today.slice(0, 4)) === year
    ? `<div class="sch-tl-over"><div class="sch-tl-today" style="left:${at(today)}%"><em>${escapeHtml(t('schedule.today'))}</em></div></div>`
    : '';
  const legend = `<div class="sch-tl-legend"><span><i class="l"></i>${escapeHtml(t('schedule.league'))}</span><span><i class="t"></i>${escapeHtml(t('schedule.tournament'))}</span><span><i class="p"></i>${escapeHtml(t('schedule.past'))}</span><span><i class="n"></i>${escapeHtml(t('schedule.today'))}</span></div>`;
  return `<div class="sch-tl-wrap"><div class="sch-tl"><div class="sch-tl-head"><div></div><div class="sch-tl-months">${months.map((m) => `<span>${escapeHtml(m)}</span>`).join('')}</div></div>${rows}${marker}</div>${legend}</div>`;
}

// ---------- the list ----------

function rowHtml(e, today) {
  const link = e.link || '';
  return schRow.html({
    ...e,
    kind: e.type,
    ended: e.tournamentEnded,
    registration: e.registrationOpen && link ? 'open' : 'none', // (the league shows no grey "closed" button)
  }, today);
}

function render() {
  renderFilters();
  const today = todayIso();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const shown = events
    .filter((e) => e.startDate <= to && e.endDate >= from)
    .filter((e) => cat === 'ALL' || e.categories.includes(cat))
    .filter((e) => type === 'ALL' || e.type === type);
  // only the chosen view is shown (with nothing to show, the note is in the list place whatever the view)
  viewEl.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  timelineEl.hidden = view !== 'timeline' || !shown.length;
  rootEl.hidden = view !== 'list' && !!shown.length;
  if (!shown.length) {
    timelineEl.innerHTML = '';
    rootEl.innerHTML = `<div class="empty-state">${escapeHtml(t('schedule.empty'))}</div>`;
    return;
  }
  timelineEl.innerHTML = timelineHtml(shown, today);
  // in the order of time: the past, what is running now and what is coming, grouped by the month the event starts in (inside the shown year)
  const byMonth = new Map();
  shown.forEach((e) => {
    const start = e.startDate < from ? from : e.startDate;
    const month = parseDay(start).getMonth();
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(e);
  });
  rootEl.innerHTML = [...byMonth.keys()].sort((a, b) => a - b).map((month) => {
    const name = new Date(year, month, 1, 12).toLocaleDateString(locale(), { month: 'long' });
    const states = byMonth.get(month).map((e) => statusOf(e, today));
    const tone = states.includes('now') ? ' now' : (states.every((x) => x === 'past') ? ' past' : '');
    return `<h2 class="sch-month-title">${escapeHtml(name)}</h2><div class="sch-card${tone}">${byMonth.get(month).map((e) => rowHtml(e, today)).join('')}</div>`;
  }).join('');
}

viewEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (!btn || btn.dataset.view === view) return;
  view = btn.dataset.view;
  try { localStorage.setItem('blta_schedule_view', view); } catch { /* it is just not remembered */ }
  render();
});
yearsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-year]');
  if (!btn) return;
  year = Number(btn.dataset.year);
  render();
});
// the green "Registrácia" and the club tag of a row sit inside the link of the row: it leads to the registration of the season by itself (in the address of the page's language)
function goRegister(el) {
  const to = el.dataset.href;
  location.href = window.BLTA_LOCALIZE && window.BLTA_LOCALIZE.localUrl ? window.BLTA_LOCALIZE.localUrl(to) : to;
}
rootEl.addEventListener('click', (e) => {
  const r = e.target.closest('.sch-reg, .sch-club');
  if (!r) return;
  e.preventDefault();
  e.stopPropagation();
  goRegister(r);
});
rootEl.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && (e.target.classList.contains('sch-reg') || e.target.classList.contains('sch-club'))) { e.preventDefault(); goRegister(e.target); }
});
catEl.addEventListener('change', () => { cat = catEl.value; render(); });
typeEl.addEventListener('change', () => { type = typeEl.value; render(); });

(async () => {
  try {
    events = await api('/schedule');
  } catch {
    rootEl.innerHTML = `<div class="empty-state">${escapeHtml(t('schedule.loadError'))}</div>`;
    return;
  }
  if (year === null || !allYears().includes(year)) year = pickDefaultYear(); // (?year= in the address, else the current year)
  if (year === null) {
    rootEl.innerHTML = `<div class="empty-state">${escapeHtml(t('schedule.empty'))}</div>`;
    return;
  }
  render();
})();

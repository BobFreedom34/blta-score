// Schedule page (/harmonogram): a year-at-a-glance timeline (every league season and tournament of the chosen year as a
// bar across the twelve months) with the list of the same events underneath, grouped by the month they start in.
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

const CATEGORY_ORDER = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const CATEGORY_NAMES = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice' };

function locale() {
  return currentLang === 'en' ? 'en-GB' : 'sk-SK';
}

// "2026-05-04" as a local date at noon, so no timezone can move it to the neighbouring day.
function parseDay(iso) {
  return new Date(`${iso}T12:00:00`);
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(fromIso, toIso) {
  return Math.round((parseDay(toIso) - parseDay(fromIso)) / 864e5);
}

function dayWord(n) {
  if (n === 1) return t('schedule.dayOne');
  if (currentLang === 'en') return t('schedule.dayMany');
  return n >= 2 && n <= 4 ? t('schedule.dayFew') : t('schedule.dayMany');
}

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

// "01.05. – 31.08.", "14. – 15.11.", "13.12."
function dateRange(e) {
  const a = parseDay(e.startDate);
  const b = parseDay(e.endDate);
  const two = (n) => String(n).padStart(2, '0');
  const dm = (d) => `${two(d.getDate())}.${two(d.getMonth() + 1)}.`;
  if (e.startDate === e.endDate) return dm(a);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${two(a.getDate())}. – ${dm(b)}`;
  return `${dm(a)} – ${dm(b)}`;
}

function yearText(e) {
  const a = parseDay(e.startDate).getFullYear();
  const b = parseDay(e.endDate).getFullYear();
  return a === b ? String(a) : `${a} – ${b}`;
}

function statusOf(e, today) {
  if (e.endDate < today) return 'past';
  if (e.startDate > today) return 'future';
  return 'now';
}

// How far through a running event we are, in percent.
function progressOf(e, today) {
  const total = Math.max(1, daysBetween(e.startDate, e.endDate));
  return Math.min(100, Math.max(0, Math.round((daysBetween(e.startDate, today) / total) * 100)));
}

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
  const status = statusOf(e, today);
  const isLeague = e.type === 'LEAGUE';
  let extra = '';
  let bar = '';
  if (status === 'now') {
    const left = Math.max(0, daysBetween(today, e.endDate));
    extra = ` · ${t('schedule.daysLeft', { n: left, d: dayWord(left) })}`;
    bar = `<div class="home-bar mini"><i style="width:${progressOf(e, today)}%"></i></div>`;
  } else if (status === 'future') {
    const n = daysBetween(today, e.startDate);
    extra = ` · ${t('schedule.startsIn', { n, d: dayWord(n) })}`;
  }
  const tags = `<span class="sch-tag${isLeague ? '' : ' tour'}">${escapeHtml(t(isLeague ? 'schedule.league' : 'schedule.tournament'))}</span>`
    + (status === 'now' ? `<span class="sch-tag now">${escapeHtml(t('schedule.running'))}</span>` : '')
    + (status === 'past' ? `<span class="sch-tag past">${escapeHtml(t('schedule.finishedTag'))}</span>` : '');
  const sub = `${e.venue ? `${escapeHtml(e.venue)} · ` : ''}<b>${escapeHtml(categoriesText(e))}</b>${escapeHtml(extra)}`;
  const more = e.link ? `<span class="sch-go">${escapeHtml(t('schedule.more'))} ›</span>` : '<span></span>';
  const open = e.link
    ? `<a class="sch-row link ${status}" href="${escapeHtml(e.link)}"${/^https?:/i.test(e.link) ? ' target="_blank" rel="noopener"' : ''}>`
    : `<div class="sch-row ${status}">`;
  return `
    ${open}
      <div class="sch-date">${escapeHtml(dateRange(e))}<small>${escapeHtml(yearText(e))}</small></div>
      <div class="sch-info${e.logoUrl ? ' with-logo' : ''}">${e.logoUrl ? `<img class="sch-logo" src="${escapeHtml(e.logoUrl)}" alt="" loading="lazy">` : ''}<div class="sch-text"><div class="sch-name">${escapeHtml(e.name)} ${tags}</div><div class="sch-sub">${sub}</div>${bar}</div></div>
      ${more}
    ${e.link ? '</a>' : '</div>'}`;
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
  if (!shown.length) {
    timelineEl.innerHTML = '';
    rootEl.innerHTML = `<div class="empty-state">${escapeHtml(t('schedule.empty'))}</div>`;
    return;
  }
  timelineEl.innerHTML = timelineHtml(shown, today);
  // grouped by the month the event starts in (inside the shown year)
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
    return `<div class="sch-month-title">${escapeHtml(name)}</div><div class="sch-card${tone}">${byMonth.get(month).map((e) => rowHtml(e, today)).join('')}</div>`;
  }).join('');
}

yearsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-year]');
  if (!btn) return;
  year = Number(btn.dataset.year);
  render();
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
  year = pickDefaultYear();
  if (year === null) {
    rootEl.innerHTML = `<div class="empty-state">${escapeHtml(t('schedule.empty'))}</div>`;
    return;
  }
  render();
})();

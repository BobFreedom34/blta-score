// The schedule of a tournament on the whole screen (/obrazovka-harmonogramu/<id>): every court and every match of a day on one screen, for a TV or a projector, as the
// timeline (a column per court, the hours down the side) or as the list (the courts side by side, a compact line per match). It is made to be compact: as many courts and
// matches as possible on one screen, a match is "Player – Player" on one line. Opened from the "Celá obrazovka" link of the Harmonogram tab of the tournament (it keeps
// the view and the day that were open there). It reloads itself every 15 seconds. Needs common.js and court-schedule.js (the time helpers and the labels of a match),
// data: GET /api/seasons/:id/schedule.
const stcId = Number(window.location.pathname.split('/').filter(Boolean).pop());
const stcRoot = document.getElementById('scr');
stcRoot.classList.add('stc');
const stcQuery = new URLSearchParams(window.location.search);
let stcData = null;
let stcView = stcQuery.get('view') === 'timeline' ? 'timeline' : 'list'; // the list is the first view after the page is opened (the timeline only when the address asks for it)
let stcDay = stcQuery.get('day') || null;
let stcUpdatedAt = null;
let stcError = '';
let stcIdleTimer = null;

const stcPad = (n) => String(n).padStart(2, '0');
const stcNow = () => { const d = new Date(); return `${stcPad(d.getHours())}:${stcPad(d.getMinutes())}`; };

function stcMatchesOfDay(day) {
  return stcData.matches.filter((m) => m.scheduledAt && csParts(csStartOf(m)).day === day);
}

// the day shown first: the one in the address, else today when it has matches, else the first day that has any
function stcChooseDay() {
  const days = stcData.settings.days || [];
  if (stcDay && days.includes(stcDay)) return stcDay;
  const today = csParts(new Date().toISOString()).day;
  const has = (d) => stcMatchesOfDay(d).length > 0;
  if (days.includes(today) && has(today)) return today;
  return days.find(has) || (days.includes(today) ? today : days[0]) || today;
}

// the pair of players on one line: "Jan Szalay – Michal Bori" (the winner of a finished match in green)
function stcPair(m) {
  const won = (p) => (m.winnerId && m.winnerId === p.id ? ' class="stc-win"' : '');
  return `<span${won(m.player1)}>${escapeHtml(m.player1.name || '?')}</span><i> – </i><span${won(m.player2)}>${escapeHtml(m.player2.name || '?')}</span>`;
}

// the two players one under the other, and when the match is being played or has been played their sets in the format of the match page: a column per set (S1, S2, MTB),
// the games of each player in his line, the winner of a set in green, the tie-break points small (the finished match keeps the winner's name green)
function stcPlayers(m) {
  const st = m.state || { sets: [] };
  const started = (s, i) => s.winner || s.p1 || s.p2 || (s.tiebreak && (s.tiebreak.p1 || s.tiebreak.p2)) || (m.status === 'LIVE' && i === st.currentSet);
  const shown = m.status === 'LIVE' || m.status === 'FINISHED' || m.status === 'UNFINISHED' ? (st.sets || []).filter(started) : [];
  const name = (p) => (m.winnerId && m.winnerId === p.id ? ' stc-win' : '');
  const head = shown.length
    ? `<span class="stc-pl-line stc-pl-head"><span class="stc-nm"></span><span class="stc-sc">${shown.map((s, i) => `<span>${s.isSuperTiebreak ? 'MTB' : `S${i + 1}`}</span>`).join('')}</span></span>` : '';
  const line = (p, num) => `<span class="stc-pl-line"><span class="stc-nm${name(p)}">${escapeHtml(p.name || '?')}</span>${shown.length ? `<span class="stc-sc">${shown.map((s) => `<span>${setCell(s, num, { highlightWinner: true })}</span>`).join('')}</span>` : ''}</span>`;
  return `<span class="stc-pl">${head}${line(m.player1, 1)}${line(m.player2, 2)}</span>`;
}

const stcMeta = (m) => escapeHtml([categoryLabel(m.category), csRoundLabel(m)].filter(Boolean).join(' · '));

// ---------- the timeline: every court side by side, the matches of the day cover the height of the screen ----------

function stcTimelineHtml(day) {
  const { settings } = stcData;
  const matches = stcMatchesOfDay(day);
  // the time that is shown: from the first match to the last one of the day (in half hours), not the whole opening time of the courts
  let startMin = csMinutesOf(settings.dayStart);
  let endMin = csMinutesOf(settings.dayEnd);
  if (matches.length) {
    const starts = matches.map((m) => csParts(csStartOf(m)).minutes);
    const ends = matches.map((m) => csParts(m.endsAt).minutes);
    startMin = Math.floor(Math.min(...starts) / 30) * 30;
    endMin = Math.max(Math.ceil(Math.max(...ends) / 30) * 30, startMin + 90);
  }
  const span = endMin - startMin;
  const pct = (minutes) => `${((minutes - startMin) / span) * 100}%`;
  const hours = [];
  const lines = [];
  for (let h = Math.ceil(startMin / 60); h * 60 <= endMin; h += 1) {
    hours.push(`<div class="stc-hour" style="top:${pct(h * 60)}">${h}:00</div>`);
    lines.push(`<i class="stc-line" style="top:${pct(h * 60)}"></i>`);
  }
  const today = csParts(new Date().toISOString());
  const nowLine = today.day === day && today.minutes >= startMin && today.minutes <= endMin ? `<div class="stc-nowline" style="top:${pct(today.minutes)}"></div>` : '';
  const cols = Array.from({ length: settings.courtCount }, (_, i) => {
    const court = i + 1;
    const ofCourt = matches.filter((m) => m.courtNo === court);
    const blocks = ofCourt.map((m) => {
      const parts = csParts(csStartOf(m));
      const real = Math.max(20, Math.round((Date.parse(m.endsAt) - Date.parse(csStartOf(m))) / 60000));
      const classes = ['stc-m', `stc-st-${String(m.status || 'PLANNED').toLowerCase()}`].join(' ');
      return `<div class="${classes}" style="top:${pct(parts.minutes)};height:calc(${(real / span) * 100}% - 2px)">
        <div class="stc-m-l1"><span class="stc-m-time">${csTime(csStartOf(m))}</span></div>
        <div class="stc-m-pl">${stcPlayers(m)}</div>
        <div class="stc-m-meta">${stcMeta(m)}</div>
      </div>`;
    }).join('');
    return `<div class="stc-colwrap"><div class="stc-h"><span>${escapeHtml(t('courts.court', { n: court }))}</span><em>${ofCourt.length}</em></div><div class="stc-col">${lines.join('')}${nowLine}${blocks}</div></div>`;
  });
  // at most 3 courts in a row (as in the timeline of the tournament page): more courts go on to the next row, every row has the hours at its left edge and the same
  // columns, so the courts of the last row are as wide as the others; the rows share the height of the screen
  const perRow = 3;
  const width = Math.min(perRow, cols.length);
  const rowCount = Math.max(1, Math.ceil(cols.length / perRow));
  const gutter = `<div class="stc-colwrap stc-gutter"><div class="stc-h">&nbsp;</div><div class="stc-col stc-axis">${hours.join('')}</div></div>`;
  const rows = [];
  for (let i = 0; i < cols.length; i += perRow) {
    rows.push(`<div class="stc-tl" style="--n:${width};--hrs:${Math.max(2, span / 60) * rowCount}">${gutter}${cols.slice(i, i + perRow).join('')}</div>`);
  }
  return `<div class="stc-tls">${rows.join('')}</div>`;
}

// ---------- the list: the courts side by side (two rows of courts when there are many), a compact row per match (the time, the two players one under the other, the category) ----------

function stcListHtml(day) {
  const { settings } = stcData;
  const matches = stcMatchesOfDay(day);
  const n = settings.courtCount;
  const perRow = n <= 4 ? n : Math.ceil(n / 2); // up to 4 courts in one row, more courts in two rows
  const cols = Array.from({ length: n }, (_, i) => {
    const court = i + 1;
    const rows = matches.filter((m) => m.courtNo === court).sort((a, b) => Date.parse(csStartOf(a)) - Date.parse(csStartOf(b)));
    const body = rows.map((m) => {
      return `
      <div class="stc-row stc-st-${String(m.status || 'PLANNED').toLowerCase()}">
        <span class="stc-row-time">${csTime(csStartOf(m))}</span>
        <span class="stc-row-pl">${stcPlayers(m)}</span>
        <span class="stc-row-meta">${stcMeta(m)}</span>
      </div>`;
    }).join('');
    return `<div class="stc-lcol"><div class="stc-h"><span>${escapeHtml(t('courts.court', { n: court }))}</span><em>${rows.length}</em></div><div class="stc-lrows">${body || `<div class="stc-empty">${escapeHtml(t('courts.courtFree'))}</div>`}</div></div>`;
  });
  return `<div class="stc-list" style="--cols:${perRow}">${cols.join('')}</div>`;
}

// ---------- the page ----------

function stcBackUrl() {
  const slug = stcData.seasonSlug;
  if (!slug) return '/harmonogram';
  return siteUrl(`/${stcData.seasonKind === 'TOURNAMENT' ? 'tournament' : 'season'}/${encodeURIComponent(slug)}`);
}

function stcRender() {
  if (!stcData) {
    stcRoot.innerHTML = `<div class="scr-loading">${escapeHtml(stcError || '…')}</div>`;
    return;
  }
  const { settings } = stcData;
  const day = stcChooseDay();
  stcDay = day;
  const days = settings.days || [];
  const dayPills = days.length > 1
    ? `<div class="scr-controls">${days.map((d) => `<button type="button" class="scr-btn${d === day ? ' green' : ''}" data-stc-day="${d}">${escapeHtml(csDayLabel(d))}</button>`).join('')}</div>` : '';
  const views = `<div class="scr-controls">
      <button type="button" class="scr-btn${stcView === 'timeline' ? ' green' : ''}" data-stc-view="timeline">${escapeHtml(t('courts.timeline'))}</button>
      <button type="button" class="scr-btn${stcView === 'list' ? ' green' : ''}" data-stc-view="list">${escapeHtml(t('courts.list'))}</button>
    </div>`;
  const body = settings.courtCount
    ? (stcView === 'timeline' ? stcTimelineHtml(day) : stcListHtml(day))
    : `<div class="scr-loading">${escapeHtml(t('courts.noCourts'))}</div>`;
  const live = stcData.matches.filter((m) => m.status === 'LIVE').length;
  // ONE type size for both views, the one the list needs: it follows the number of the courts rows of the list and of the most matches of a court of the day
  const nCourts = settings.courtCount || 0;
  const listPerRow = nCourts <= 4 ? Math.max(1, nCourts) : Math.ceil(nCourts / 2);
  const listRows = Math.max(1, Math.ceil(nCourts / listPerRow));
  const mostRows = Math.max(2, ...Array.from({ length: nCourts }, (_, i) => stcMatchesOfDay(day).filter((m) => m.courtNo === i + 1).length));
  stcRoot.innerHTML = `
    <header class="scr-head stc-head">
      <div class="scr-head-main">
        <h1 class="scr-comp">${escapeHtml(stcData.seasonName || t('season.navCourts'))}</h1>
        <div class="scr-meta"><span class="scr-phase">${escapeHtml(csDayLabel(day))}</span><span>${escapeHtml(t('season.navCourts'))}</span>${live ? `<span class="stc-live">${escapeHtml(t('courts.liveNow'))} ${live}</span>` : ''}</div>
      </div>
      <div class="scr-head-side">
        <div class="scr-clock" id="scr-clock">${stcNow()}</div>
        <img class="scr-logo" src="/img/blta-logo-sm.png" alt="BLTA">
      </div>
    </header>
    <main class="stc-main" style="--lrows:${listRows};--rows:${mostRows}">${body}</main>
    <footer class="scr-foot stc-foot">
      <div class="left">${stcUpdatedAt ? `⟳ ${escapeHtml(tl('Obnovuje sa automaticky · naposledy', 'Updates by itself · last at'))} ${stcPad(stcUpdatedAt.getHours())}:${stcPad(stcUpdatedAt.getMinutes())}:${stcPad(stcUpdatedAt.getSeconds())}` : ''}</div>
      <div class="stc-foot-mid">${dayPills}${views}</div>
      <div class="scr-controls">
        <a class="scr-btn" href="${escapeHtml(stcBackUrl())}">← ${escapeHtml(tl('Späť na turnaj', 'Back to the tournament'))}</a>
        <button type="button" class="scr-btn green" id="scr-full">${escapeHtml(document.fullscreenElement ? tl('Zavrieť celú obrazovku', 'Exit full screen') : tl('Celá obrazovka', 'Full screen'))}</button>
      </div>
    </footer>`;
}

function stcRememberChoice() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('view', stcView);
    if (stcDay) url.searchParams.set('day', stcDay);
    window.history.replaceState(null, '', url);
  } catch { /* the address stays as it is */ }
}

async function stcLoad() {
  try {
    stcData = await api(`/seasons/${stcId}/schedule`);
    stcUpdatedAt = new Date();
    stcError = '';
    stcRender();
  } catch (err) {
    if (!stcData) { stcError = err.message; stcRender(); }
  }
}

function stcToggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
}

function stcWake() {
  document.body.classList.remove('idle');
  clearTimeout(stcIdleTimer);
  stcIdleTimer = setTimeout(() => document.body.classList.add('idle'), 4000);
}

stcRoot.addEventListener('click', (e) => {
  if (e.target.closest('#scr-full')) { stcToggleFullscreen(); return; }
  const day = e.target.closest('[data-stc-day]');
  if (day) { stcDay = day.dataset.stcDay; stcRememberChoice(); stcRender(); return; }
  const view = e.target.closest('[data-stc-view]');
  if (view) { stcView = view.dataset.stcView; stcRememberChoice(); stcRender(); }
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); stcToggleFullscreen(); }
  stcWake();
});
document.addEventListener('mousemove', stcWake);
document.addEventListener('touchstart', stcWake, { passive: true });
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('is-full', !!document.fullscreenElement);
  stcRender();
});

stcWake();
stcLoad();
setInterval(() => { const c = document.getElementById('scr-clock'); if (c) c.textContent = stcNow(); }, 1000);
setInterval(stcLoad, 15000);

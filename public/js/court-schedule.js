// "Rozvrh kurtov" — the court schedule tab of a tournament page: a timeline (a column per court, the playing day from top to bottom, a
// block per match) and a list (a section per court). Everybody sees both; an admin can also drag a match onto a court at a time (it is
// then locked: the planner never moves it), drag it back to "Nerozvrhnuté" to take it off, change the settings of the day and run the
// planner. Data: GET /api/seasons/:id/schedule; the admin calls are PUT .../schedule/matches/:token, PATCH .../schedule/settings and
// POST .../schedule/auto (see src/tournamentSchedule.js). Needs common.js (api, t, escapeHtml, toast, checkAdmin, categoryLabel).
// Used by season.js: initCourtSchedule(hostElement, season).

const CS_TZ = 'Europe/Bratislava';
const CS_PX = 2.8; // pixels per minute of the timeline (a 30-minute match is high enough for the whole card: time, two players, category)
const CS_SNAP = 15; // minutes
const CS_MS = 60 * 1000;

let csState = null; // { host, season, admin, data, day, view } — day and view are kept when the tab is drawn again
let csDrag = null;
const csUnlocked = new Set(); // tokens of FINISHED matches the organiser unlocked on this page (a finished match is locked by itself until then)
let csChoice = { day: null, view: 'timeline' };

// ---------- time (Bratislava) ----------

function csParts(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CS_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { day: `${get('year')}-${String(get('month')).padStart(2, '0')}-${String(get('day')).padStart(2, '0')}`, minutes: get('hour') * 60 + get('minute') };
}

function csOffsetMinutes(utcMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CS_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return Math.round((Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs) / CS_MS);
}

// "2026-05-01" + minutes since midnight (Bratislava) -> ISO string
function csLocalToIso(day, minutes) {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const first = guess - csOffsetMinutes(guess) * CS_MS;
  return new Date(guess - csOffsetMinutes(first) * CS_MS).toISOString();
}

// where a block starts: the planned time, or — for a finished match — when it really started
const csStartOf = (m) => m.blockStart || m.scheduledAt;
const csMinutesOf = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const csClock = (minutes) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
const csTime = (iso) => csClock(csParts(iso).minutes);
const csDayLabel = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(currentLang === 'en' ? 'en-GB' : 'sk-SK', { weekday: 'short', timeZone: 'UTC' });
  return `${wd} ${d}. ${m}.`;
};

// ---------- pieces ----------

function csRoundLabel(m) {
  if (m.group) return [groupShortName(m.group.name), m.groupRound ? t('courts.round', { n: m.groupRound }) : ''].filter(Boolean).join(' · ');
  if (!m.round) return '';
  const rounds = m.rounds || 0;
  let name = t('courts.round', { n: m.round });
  if (rounds && m.round === rounds) name = t('courts.final');
  else if (rounds && m.round === rounds - 1) name = t('courts.semi');
  else if (rounds && m.round === rounds - 2) name = t('courts.quarter');
  return m.bracket && m.bracket.kind === 'CONSOLATION' ? `${t('courts.consolation')} · ${name}` : name;
}

// the left border of a block: green = not started yet, orange = being played, grey = finished
const csStatusClass = (m) => `cs-st-${String(m.status || 'PLANNED').toLowerCase()}`;

function csPlayersHtml(m) {
  const won = (p) => (m.winnerId && m.winnerId === p.id ? ' class="cs-win"' : '');
  return `<span${won(m.player1)}>${escapeHtml(m.player1.name || '?')}</span><span${won(m.player2)}>${escapeHtml(m.player2.name || '?')}</span>`;
}

// The two players, and when the match is being played or has been played their sets in the format of the match page (the same as the schedule on the whole screen): the
// name on the left, a column per set (S1, S2, MTB) on the right with the games of that player, the winner of a set green, the tie-break points small.
function csScoredPlayersHtml(m) {
  const st = m.state || { sets: [] };
  const started = (s, i) => s.winner || s.p1 || s.p2 || (s.tiebreak && (s.tiebreak.p1 || s.tiebreak.p2)) || (m.status === 'LIVE' && i === st.currentSet);
  const shown = m.status === 'LIVE' || m.status === 'FINISHED' || m.status === 'UNFINISHED' ? (st.sets || []).filter(started) : [];
  const won = (p) => (m.winnerId && m.winnerId === p.id ? ' cs-win' : '');
  const head = shown.length
    ? `<span class="cs-pl-line cs-pl-head"><span class="cs-nm"></span><span class="cs-sc">${shown.map((s, i) => `<span>${s.isSuperTiebreak ? 'MTB' : `S${i + 1}`}</span>`).join('')}</span></span>` : '';
  const line = (p, num) => `<span class="cs-pl-line"><span class="cs-nm${won(p)}">${escapeHtml(p.name || '?')}</span>${shown.length ? `<span class="cs-sc">${shown.map((s) => `<span>${setCell(s, num, { highlightWinner: true })}</span>`).join('')}</span>` : ''}</span>`;
  return `<span class="cs-pl">${head}${line(m.player1, 1)}${line(m.player2, 2)}</span>`;
}

// Blocks of one court that overlap in time (two finished matches whose real times overlap, a long match over a later one) are drawn side by side, like a calendar,
// so none hides another: returns a Map token -> { lane, lanes } for the matches of one court
function csLanes(matches) {
  const span = (m) => { const s = Date.parse(csStartOf(m)); return [s, Math.max(s + 20 * CS_MS, Date.parse(m.endsAt))]; };
  const sorted = [...matches].sort((a, b) => span(a)[0] - span(b)[0] || span(a)[1] - span(b)[1]);
  const out = new Map();
  let cluster = [];
  let laneEnds = [];
  let clusterEnd = -Infinity;
  const flush = () => { cluster.forEach((m) => { out.get(m.token).lanes = laneEnds.length; }); cluster = []; laneEnds = []; };
  sorted.forEach((m) => {
    const [s, e] = span(m);
    if (s >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(e); } else laneEnds[lane] = e;
    out.set(m.token, { lane, lanes: 1 });
    cluster.push(m);
    clusterEnd = Math.max(s >= clusterEnd ? -Infinity : clusterEnd, e);
  });
  flush();
  return out;
}

function csBlockHtml(m, day, startMin, laneInfo) {
  const parts = csParts(csStartOf(m));
  // the real length: a match that ended early is drawn only up to its end (a short block shows one line only)
  const real = Math.round((Date.parse(m.endsAt) - Date.parse(csStartOf(m))) / CS_MS);
  const minutes = Math.max(20, real);
  const short = real < 25; // (the card is always whole, two lines of players; only a very short block drops the category line)
  const top = (parts.minutes - startMin) * CS_PX;
  const finished = m.status === 'FINISHED';
  const unlocked = finished && csUnlocked.has(m.token); // a finished match is locked by itself; the organiser unlocks it to move or resize it
  const resizable = csState.admin && (m.status === 'PLANNED' || unlocked);
  const movable = resizable;
  const lanes = laneInfo && laneInfo.lanes > 1 ? laneInfo : null;
  const classes = ['cs-m', csStatusClass(m), `cs-st-${m.status.toLowerCase()}`, movable ? 'cs-drag' : '', m.locked ? 'cs-locked' : '', short ? 'cs-short' : '', lanes ? 'cs-lane' : ''].filter(Boolean).join(' ');
  const across = lanes ? `;left:calc(4px + (100% - 8px) * ${lanes.lane} / ${lanes.lanes});right:auto;width:calc((100% - 8px) / ${lanes.lanes} - 2px)` : '';
  return `<a class="${classes}" href="/match/${m.token}" draggable="false" data-token="${m.token}" ${movable ? 'data-drag="1"' : ''}
      style="top:${top}px;height:${minutes * CS_PX - 3}px${across}" data-minutes="${real}" title="${escapeHtml(`${csTime(csStartOf(m))} · ${m.player1.name} – ${m.player2.name}`)}">
    <span class="cs-m-time">${csTime(csStartOf(m))}${m.status === 'FINISHED' ? ` <b class="cs-done">${escapeHtml(t('courts.finished'))}</b>` : ''}${finished && csState.admin ? ` <i class="cs-lock fin${unlocked ? ' open' : ''}" data-fin-lock="${m.token}" title="${escapeHtml(unlocked ? tl('Odomknutý — zápas môžeš posúvať a meniť mu dĺžku. Kliknutím ho zamkneš.', 'Unlocked — you can move the match and change its length. Click to lock it.') : tl('Skončený zápas je zamknutý. Kliknutím ho odomkneš, potom ho môžeš posúvať a meniť mu dĺžku.', 'A finished match is locked. Click to unlock it, then you can move it and change its length.'))}"></i>` : ''}${m.status === 'PLANNED' && m.locked && csState.admin ? ` <i class="cs-lock" data-unlock="${m.token}" title="${escapeHtml(tl('Zamknutý — plánovač ho nepresúva. Kliknutím ho odomkneš.', 'Locked — the planner does not move it. Click to unlock it.'))}"></i>` : ''}${m.status === 'LIVE' ? ` <b class="cs-live">${escapeHtml(t('home.live'))}</b>` : ''}</span>
    <span class="cs-m-pl">${csScoredPlayersHtml(m)}</span>
    <span class="cs-m-meta">${escapeHtml([categoryLabel(m.category), csRoundLabel(m)].filter(Boolean).join(' · '))}</span>
    ${resizable ? `<span class="cs-resize" data-resize="1" title="${escapeHtml(tl('Potiahni na zmenu dĺžky zápasu', 'Drag to change the length of the match'))}${m.durationMinutes ? escapeHtml(tl(` (nastavených ${m.durationMinutes} min) — dvojklik vráti pôvodnú dĺžku`, ` (set to ${m.durationMinutes} min) — double-click restores the original length`)) : ''}"></span>` : ''}
  </a>`;
}

// at most 3 courts side by side on a computer, 2 on a phone; more courts go on to the next row (each row has the hours at its left edge)
const csNarrow = window.matchMedia ? window.matchMedia('(max-width: 700px)') : null;
if (csNarrow && csNarrow.addEventListener) csNarrow.addEventListener('change', () => { if (typeof csState !== 'undefined' && csState && csState.host && csState.host.isConnected) csRender(); });
const csPerRow = () => (csNarrow && csNarrow.matches ? 2 : 3);

// the playing window of one day of the tournament { start, end }: its own times (set in the Backend) or the general ones
function csDayWindow(settings, day) {
  return (settings.dayTimes && settings.dayTimes[day]) || { start: settings.dayStart, end: settings.dayEnd };
}

function csTimelineHtml(day) {
  const { settings, matches } = csState.data;
  const window = csDayWindow(settings, day);
  const startMin = csMinutesOf(window.start);
  const endMin = csMinutesOf(window.end);
  const height = (endMin - startMin) * CS_PX;
  const hours = [];
  const lines = [];
  for (let h = Math.ceil(startMin / 60); h * 60 <= endMin; h += 1) {
    hours.push(`<div class="cs-hour" style="top:${(h * 60 - startMin) * CS_PX}px">${h}:00</div>`);
    lines.push(`<i class="cs-line" style="top:${(h * 60 - startMin) * CS_PX}px"></i>`);
  }
  const today = csParts(new Date().toISOString());
  const nowLine = today.day === day && today.minutes >= startMin && today.minutes <= endMin ? `<div class="cs-now" style="top:${(today.minutes - startMin) * CS_PX}px"></div>` : '';
  const cols = Array.from({ length: settings.courtCount }, (_, i) => {
    const court = i + 1;
    const ofCourt = matches.filter((m) => m.courtNo === court && m.scheduledAt && csParts(csStartOf(m)).day === day);
    const count = ofCourt.length; // the matches of the day on this court (the little number in the heading, as in the list)
    const lanes = csLanes(ofCourt);
    const blocks = ofCourt.map((m) => csBlockHtml(m, day, startMin, lanes.get(m.token))).join('');
    return `<div class="cs-colwrap"><div class="cs-court-h"><span>${escapeHtml(t('courts.court', { n: court }))}</span>${csLiveButtonHtml(court)}<em>${count}</em></div><div class="cs-col" data-court="${court}" style="height:${height}px">${lines.join('')}${nowLine}${blocks}</div></div>`;
  });
  const per = csPerRow();
  const width = Math.min(per, settings.courtCount); // every row has the same columns, so the courts of the last row are as wide as the others
  const gutter = `<div class="cs-gutter"><div class="cs-court-h">&nbsp;</div><div class="cs-hours" style="height:${height}px">${hours.join('')}</div></div>`;
  const rows = [];
  for (let i = 0; i < cols.length; i += per) rows.push(`<div class="cs-grid" style="--cs-cols:${width}">${gutter}${cols.slice(i, i + per).join('')}</div>`);
  return `<div class="cs-scroll">${rows.join('')}</div>`;
}

// the matches being played right now, with the score so far — at the top of the tab, whether or not they are on a court
function csLiveHtml() {
  const live = csState.data.matches.filter((m) => m.status === 'LIVE');
  if (!live.length) return '';
  const cards = live.map((m) => `
    <a class="cs-livecard ${csStatusClass(m)}" href="/match/${m.token}">
      <span class="cs-live-h"><b class="cs-live">${escapeHtml(t('home.live'))}</b>${m.courtNo ? ` ${escapeHtml(t('courts.court', { n: m.courtNo }))}` : ''}</span>
      <span class="cs-live-pl">${csScoredPlayersHtml(m)}</span>
      <span class="cs-m-meta">${escapeHtml([categoryLabel(m.category), csRoundLabel(m)].filter(Boolean).join(' · '))}</span>
    </a>`).join('');
  return `<div class="cs-livestrip"><div class="cs-tray-h">${escapeHtml(t('courts.liveNow'))}<em>${live.length}</em></div><div class="cs-tray-body">${cards}</div></div>`;
}

function csTrayHtml() {
  const waiting = csState.data.matches.filter((m) => m.status === 'PLANNED' && !m.scheduledAt);
  if (!waiting.length && !csState.admin) return '';
  const chips = waiting.map((m) => {
    const movable = csState.admin;
    return `<a class="cs-chip ${csStatusClass(m)}${movable ? ' cs-drag' : ''}" href="/match/${m.token}" draggable="false" data-token="${m.token}" ${movable ? 'data-drag="1"' : ''}>
      <span class="cs-m-pl">${csPlayersHtml(m)}</span><span class="cs-m-meta">${escapeHtml([categoryLabel(m.category), csRoundLabel(m)].filter(Boolean).join(' · '))}</span></a>`;
  }).join('');
  return `<div class="cs-tray"><div class="cs-tray-h">${escapeHtml(t('courts.unscheduled'))}<em>${waiting.length}</em></div><div class="cs-tray-body">${chips || `<span class="cs-tray-empty">${escapeHtml(t('courts.trayEmpty'))}</span>`}</div></div>`;
}

// the "Live video" button in the heading of a court that has a YouTube link (the organiser enters it per court): opens the stream on YouTube in a new tab
function csLiveButtonHtml(court) {
  const stream = (csState.data.courtStreams || [])[court - 1];
  if (!stream || !stream.url) return '';
  return `<a class="cs-live-btn" href="${escapeHtml(stream.url)}" target="_blank" rel="noopener">▶ <span class="cs-live-long">${escapeHtml(t('courts.liveVideo'))}</span><span class="cs-live-short">${escapeHtml(t('courts.liveShort'))}</span></a>`;
}

function csListHtml(day) {
  const { settings, matches } = csState.data;
  const sections = Array.from({ length: settings.courtCount }, (_, i) => {
    const court = i + 1;
    const rows = matches.filter((m) => m.courtNo === court && m.scheduledAt && csParts(csStartOf(m)).day === day)
      .sort((a, b) => Date.parse(csStartOf(a)) - Date.parse(csStartOf(b)));
    const body = rows.map((m) => `
      <a class="cs-row ${csStatusClass(m)}" href="/match/${m.token}">
        <span class="cs-row-time">${csTime(csStartOf(m))}</span>
        <span class="cs-row-pl">${csScoredPlayersHtml(m)}</span>
        <span class="cs-row-meta">${escapeHtml([categoryLabel(m.category), csRoundLabel(m)].filter(Boolean).join(' · '))}</span>
      </a>`).join('');
    return `<div class="cs-list-court"><div class="cs-list-h">${escapeHtml(t('courts.court', { n: court }))}${csLiveButtonHtml(court)}<em>${rows.length}</em></div>${body || `<div class="cs-row-empty">${escapeHtml(t('courts.courtFree'))}</div>`}</div>`;
  }).join('');
  return `<div class="cs-list">${sections}</div>`;
}

function csAdminHtml() {
  if (!csState.admin) return '';
  const s = csState.data.settings;
  const field = (id, label, value, attrs) => `<label>${label}<input id="cs-${id}" value="${escapeHtml(String(value))}" ${attrs}></label>`;
  return `
    <div class="cs-admin">
      <div class="cs-admin-row">
        ${field('minutes', tl('Dĺžka zápasu (min)', 'Match length (min)'), s.matchMinutes, 'type="number" min="15" max="300" step="5"')}
        ${field('start', tl('Začiatok dňa', 'Start of the day'), s.dayStart, 'type="time"')}
        ${field('end', tl('Koniec dňa', 'End of the day'), s.dayEnd, 'type="time"')}
        ${field('rest', tl('Oddych hráča (min)', 'Player rest (min)'), s.restMinutes, 'type="number" min="0" max="240" step="5"')}
        ${field('maxday', tl('Max. zápasov hráča za deň (0 = bez limitu)', 'Max. matches per player per day (0 = no limit)'), s.maxPerDay, 'type="number" min="0" max="10"')}
        <label class="cs-check"><input type="checkbox" id="cs-auto" ${s.autoSchedule ? 'checked' : ''}> ${tl('Rozvrh skladá systém sám', 'The system builds the schedule itself')}</label>
        <button type="button" class="btn btn-sm btn-outline" data-cs="settings">${tl('Uložiť nastavenia', 'Save settings')}</button>
      </div>
      <div class="cs-admin-row">
        <button type="button" class="btn btn-sm btn-primary" data-cs="addmatch">+ ${tl('Pridať zápas', 'Add a match')}</button>
        <button type="button" class="btn btn-sm btn-primary" data-cs="fill">${tl('Poskladať rozvrh', 'Build the schedule')}</button>
        <button type="button" class="btn btn-sm btn-outline" data-cs="compact" title="${escapeHtml(tl('Posunie nezamknuté zápasy dopredu tam, kde sa uvoľnil čas (zápas skončil skôr, bol skrátený)', 'Moves the unlocked matches earlier where time was freed (a match ended early or was shortened)'))}">${tl('Zhustiť rozvrh', 'Compact the schedule')}</button>
        <button type="button" class="btn btn-sm btn-outline" data-cs="rebuild">${tl('Prepočítať odznova', 'Rebuild from scratch')}</button>
        <button type="button" class="btn btn-sm btn-outline" data-cs="unlock">${tl('Odomknúť všetky zápasy', 'Unlock all matches')}</button>
        <button type="button" class="btn btn-sm btn-outline" data-cs="clear">${tl('Vyčistiť rozvrh', 'Clear the schedule')}</button>
        <span class="cs-hint">${tl('Potiahni zápas na kurt a čas, spodnú hranu bloku na zmenu dĺžky zápasu (zámok = ručne umiestnený, plánovač ho nepresúva; kliknutím na zámok ho odomkneš). Späť do „Nerozvrhnuté“ ho zrušíš. Skončený zápas je zamknutý sám; kliknutím na jeho zámok ho odomkneš a môžeš ho posúvať aj meniť jeho dĺžku. Počet kurtov: Formát turnaja.', 'Drag a match to a court and a time, the bottom edge of a block to change the length of the match (lock = placed by hand, the planner does not move it; click the lock to unlock it). Drag it back to "Unscheduled" to take it off. A finished match is locked by itself; click its lock to unlock it, then you can move it and change its length. Number of courts: Tournament format.')}</span>
      </div>
    </div>`;
}

// ---------- drawing ----------

// the day shown first: today when it has matches, else the first day that has any, else today / the first day
function csChooseDay() {
  const days = csState.data.settings.days;
  if (csChoice.day && days.includes(csChoice.day)) return csChoice.day;
  const today = csParts(new Date().toISOString()).day;
  const hasMatches = (d) => csState.data.matches.some((m) => m.scheduledAt && csParts(csStartOf(m)).day === d);
  if (days.includes(today) && hasMatches(today)) return today;
  return days.find(hasMatches) || (days.includes(today) ? today : days[0]);
}

function csRender() {
  const { settings } = csState.data;
  const day = csChooseDay();
  csChoice.day = day;
  const pills = settings.days.length > 1
    ? `<div class="tabs cs-days">${settings.days.map((d) => `<button type="button" class="tab${d === day ? ' active' : ''}" data-cs-day="${d}">${escapeHtml(csDayLabel(d))}</button>`).join('')}</div>` : '';
  const views = `<div class="cs-seg" role="group"><button type="button" class="${csChoice.view === 'timeline' ? 'active' : ''}" data-cs-view="timeline">${escapeHtml(t('courts.timeline'))}</button><button type="button" class="${csChoice.view === 'list' ? 'active' : ''}" data-cs-view="list">${escapeHtml(t('courts.list'))}</button></div>`;
  // the whole-screen page of this schedule (every court and match of the day for a TV): it opens on the list first (Zoznam), on the day that is shown here
  const fullHref = siteUrl(`/schedule-screen/${csState.season.id}?view=list&day=${day}`);
  const fullLink = `<a class="btn btn-sm btn-primary cs-fullscreen" href="${escapeHtml(fullHref)}">${courtIcon('monitor')}<span>${escapeHtml(tl('Celá obrazovka', 'Full screen'))}</span></a>`;
  csState.host.innerHTML = `
    <section class="sv-sec cs-sec">
      ${csLiveHtml()}
      <div class="cs-bar">${pills}<div class="cs-bar-row">${views}${settings.courtCount ? fullLink : ''}</div></div>
      <div class="cs-legend"><span class="cs-st-planned">${escapeHtml(t('courts.legendPlanned'))}</span><span class="cs-st-live">${escapeHtml(t('courts.legendLive'))}</span><span class="cs-st-finished">${escapeHtml(t('courts.legendFinished'))}</span></div>
      ${settings.courtCount ? '' : `<div class="sv-empty">${escapeHtml(t('courts.noCourts'))}</div>`}
      ${settings.courtCount ? (csChoice.view === 'timeline' ? csTimelineHtml(day) : csListHtml(day)) : ''}
      ${csChoice.view === 'timeline' || csState.admin ? csTrayHtml() : ''}
      ${csAdminHtml()}
    </section>`;
}

async function csApply(promise, okMessage) {
  try {
    const res = await promise;
    csState.data = res.schedule || res;
    if (res.warnings && res.warnings.length) toast(res.warnings.join(' '));
    else if (okMessage) toast(okMessage);
  } catch (err) {
    toast(err.message);
  }
  csRender();
}

// ---------- dragging (admin) ----------

function csOnPointerDown(e) {
  if (!csState.admin || e.button !== 0) return;
  const handle = e.target.closest('[data-resize]');
  if (handle && csState.host.contains(handle)) {
    // the bottom edge of a block: drag to change the length of this one match
    const block = handle.closest('.cs-m');
    const minutes = Number(block.dataset.minutes) || 30;
    csDrag = { resize: true, el: block, token: block.dataset.token, startY: e.clientY, startMinutes: minutes, minutes, moved: false };
    window.addEventListener('pointermove', csOnPointerMove);
    window.addEventListener('pointerup', csOnPointerUp);
    window.addEventListener('pointercancel', csOnPointerUp);
    return;
  }
  const el = e.target.closest('[data-drag]');
  if (!el || !csState.host.contains(el)) return;
  const rect = el.getBoundingClientRect();
  csDrag = { el, length: Number(el.dataset.minutes) || 0, token: el.dataset.token, startX: e.clientX, startY: e.clientY, offY: e.clientY - rect.top, offX: e.clientX - rect.left, width: rect.width, height: rect.height, ghost: null, target: null, preview: null };
  window.addEventListener('pointermove', csOnPointerMove);
  window.addEventListener('pointerup', csOnPointerUp);
  window.addEventListener('pointercancel', csOnPointerUp);
}

function csDropTarget(e) {
  const { settings } = csState.data;
  const under = document.elementFromPoint(e.clientX, e.clientY);
  if (!under) return null;
  const col = under.closest('.cs-col');
  if (col) {
    const colRect = col.getBoundingClientRect();
    const dayWindow = csDayWindow(settings, csChoice.day);
    const startMin = csMinutesOf(dayWindow.start);
    const endMin = csMinutesOf(dayWindow.end);
    const length = csDrag.length || settings.matchMinutes;
    let minutes = startMin + Math.round(((e.clientY - csDrag.offY - colRect.top) / CS_PX) / CS_SNAP) * CS_SNAP;
    minutes = Math.max(startMin, Math.min(minutes, endMin - length));
    return { type: 'court', col, court: Number(col.dataset.court), minutes, length };
  }
  const tray = under.closest('.cs-tray');
  return tray ? { type: 'tray', tray } : null;
}

function csOnPointerMove(e) {
  if (!csDrag) return;
  if (csDrag.resize) {
    const dy = e.clientY - csDrag.startY;
    if (!csDrag.moved && Math.abs(dy) < 4) return;
    csDrag.moved = true;
    csDrag.minutes = Math.max(15, Math.min(300, Math.round((csDrag.startMinutes + dy / CS_PX) / 5) * 5));
    csDrag.el.style.height = `${csDrag.minutes * CS_PX - 3}px`;
    csDrag.el.title = `${csDrag.minutes} min`;
    return;
  }
  if (!csDrag.ghost) {
    if (Math.hypot(e.clientX - csDrag.startX, e.clientY - csDrag.startY) < 6) return;
    const ghost = csDrag.el.cloneNode(true);
    ghost.classList.add('cs-ghost');
    ghost.style.width = `${csDrag.width}px`;
    ghost.style.height = `${csDrag.height}px`;
    ghost.style.top = '0';
    document.body.appendChild(ghost);
    csDrag.ghost = ghost;
    csDrag.el.classList.add('cs-dragging');
  }
  csDrag.ghost.style.transform = `translate(${e.clientX - csDrag.offX}px, ${e.clientY - csDrag.offY}px)`;
  const target = csDropTarget(e);
  csDrag.target = target;
  if (csDrag.preview) { csDrag.preview.remove(); csDrag.preview = null; }
  csState.host.querySelectorAll('.cs-tray').forEach((el) => el.classList.toggle('cs-tray-over', !!target && target.type === 'tray'));
  if (target && target.type === 'court') {
    const startMin = csMinutesOf(csDayWindow(csState.data.settings, csChoice.day).start);
    const preview = document.createElement('div');
    preview.className = 'cs-drop';
    preview.style.top = `${(target.minutes - startMin) * CS_PX}px`;
    preview.style.height = `${target.length * CS_PX - 3}px`;
    preview.textContent = csClock(target.minutes);
    target.col.appendChild(preview);
    csDrag.preview = preview;
  }
}

function csOnPointerUp() {
  window.removeEventListener('pointermove', csOnPointerMove);
  window.removeEventListener('pointerup', csOnPointerUp);
  window.removeEventListener('pointercancel', csOnPointerUp);
  const drag = csDrag;
  csDrag = null;
  if (drag && drag.resize) {
    if (!drag.moved) return;
    const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    window.addEventListener('click', stop, { capture: true, once: true }); // the drag must not also open the match
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
    if (drag.minutes === drag.startMinutes) { csRender(); return; }
    csApply(api(`/seasons/${csState.season.id}/schedule/matches/${drag.token}`, { method: 'PUT', body: { durationMinutes: drag.minutes } }), `Dĺžka zápasu: ${drag.minutes} min`);
    return;
  }
  if (!drag || !drag.ghost) return; // a plain click: the link opens the match
  drag.ghost.remove();
  if (drag.preview) drag.preview.remove();
  drag.el.classList.remove('cs-dragging');
  csState.host.querySelectorAll('.cs-tray').forEach((el) => el.classList.remove('cs-tray-over'));
  const swallow = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
  window.addEventListener('click', swallow, { capture: true, once: true }); // the drag must not also open the match
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
  const target = drag.target;
  if (!target) return;
  const base = `/seasons/${csState.season.id}/schedule/matches/${drag.token}`;
  if (target.type === 'court') {
    csApply(api(base, { method: 'PUT', body: { courtNo: target.court, scheduledAt: csLocalToIso(csChoice.day, target.minutes) } }));
  } else if (drag.el.classList.contains('cs-m') && !drag.el.classList.contains('cs-st-finished')) { // (a finished match stays on the schedule)
    csApply(api(base, { method: 'PUT', body: { courtNo: null } }));
  }
}

// ---------- entry ----------

// a live score changed somewhere: only this tab's data is fetched again (not while the admin is dragging)
async function reloadCourtSchedule() {
  if (!csState || csDrag) return;
  try { csState.data = await api(`/seasons/${csState.season.id}/schedule`); } catch { return; }
  csRender();
}

// "+ Pridať zápas": a match added by hand to a group (or Swiss round) of the tournament, for the organiser (src/tournamentMatches.js). A court and a time are optional: without
// them the planner places it. A rematch or a second match of a player in the same round is refused by the server until "aj keď už hrali" is ticked.
async function csOpenAddMatch() {
  let opts;
  try { opts = await api(`/seasons/${csState.season.id}/match-options`); } catch (err) { toast(err.message); return; }
  if (!opts.groups.length) { toast(tl('Turnaj nemá skupinu ani švajčiarske kolo, do ktorého by sa dal pridať zápas.', 'The tournament has no group or Swiss round to add a match to.')); return; }
  const old = document.getElementById('cs-addmatch-modal');
  if (old) old.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'cs-addmatch-modal';
  modal.style.display = 'flex';
  const dayLabel = (d) => { const [y, m, dd] = d.split('-'); return `${Number(dd)}. ${Number(m)}. ${y}`; };
  modal.innerHTML = `
    <div class="modal cs-addmatch">
      <button type="button" class="close" data-am="close" aria-label="Close">&times;</button>
      <h3 style="margin-top:0">${escapeHtml(tl('Pridať zápas do turnaja', 'Add a match to the tournament'))}</h3>
      <form id="cs-am-form">
        <div class="field"${opts.groups.length > 1 ? '' : ' hidden'}>
          <label for="cs-am-group">${escapeHtml(tl('Skupina', 'Group'))}</label>
          <select id="cs-am-group">${opts.groups.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label for="cs-am-round">${escapeHtml(tl('Kolo', 'Round'))}</label>
          <input type="number" id="cs-am-round" min="1" max="99" inputmode="numeric">
        </div>
        <div class="field">
          <label for="cs-am-p1">${escapeHtml(tl('Hráči', 'Players'))}</label>
          <div style="display:flex;gap:8px">
            <select id="cs-am-p1" style="flex:1" aria-label="${escapeHtml(tl('Hráč 1', 'Player 1'))}"></select>
            <select id="cs-am-p2" style="flex:1" aria-label="${escapeHtml(tl('Hráč 2', 'Player 2'))}"></select>
          </div>
        </div>
        <div class="field">
          <label for="cs-am-court">${escapeHtml(tl('Kurt', 'Court'))} <span style="font-weight:400;color:var(--gray-dim);font-size:12px">${escapeHtml(tl('(voliteľné)', '(optional)'))}</span></label>
          <select id="cs-am-court"><option value="">${escapeHtml(tl('Nechať na plánovač', 'Let the planner place it'))}</option>${Array.from({ length: opts.courtCount }, (_, i) => `<option value="${i + 1}">${escapeHtml(tl('Kurt', 'Court'))} ${i + 1}</option>`).join('')}</select>
        </div>
        <div class="field" id="cs-am-when" hidden>
          <label for="cs-am-day">${escapeHtml(tl('Deň a čas', 'Day and time'))}</label>
          <div style="display:flex;gap:8px">
            <select id="cs-am-day" style="flex:1">${opts.days.map((d) => `<option value="${d}">${escapeHtml(dayLabel(d))}</option>`).join('')}</select>
            <input type="text" inputmode="numeric" class="time-input" placeholder="HH:MM" maxlength="5" autocomplete="off" id="cs-am-time" value="09:00" style="flex:1">
          </div>
        </div>
        <div class="field" id="cs-am-force-row" hidden>
          <label style="display:flex;align-items:center;gap:8px;font-weight:600"><input type="checkbox" id="cs-am-force" style="width:auto"> ${escapeHtml(tl('aj keď už hrali (pridať napriek upozorneniu)', 'even if they have played (add it despite the warning)'))}</label>
        </div>
        <div id="cs-am-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
        <button type="submit" class="btn btn-primary btn-block" style="margin-top:6px">${escapeHtml(tl('Pridať zápas', 'Add the match'))}</button>
      </form>
    </div>`;
  document.body.appendChild(modal);
  const $ = (id) => document.getElementById(id);
  const groupOf = () => opts.groups.find((g) => g.id === Number($('cs-am-group').value)) || opts.groups[0];
  const fillPlayers = () => {
    const g = groupOf();
    const list = g.players.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    $('cs-am-p1').innerHTML = `<option value="">—</option>${list}`;
    $('cs-am-p2').innerHTML = `<option value="">—</option>${list}`;
    $('cs-am-round').value = g.currentRound;
  };
  fillPlayers();
  $('cs-am-group').addEventListener('change', fillPlayers);
  $('cs-am-court').addEventListener('change', () => { $('cs-am-when').hidden = !$('cs-am-court').value; });
  const close = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-am="close"]')) close(); });
  $('cs-am-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('cs-am-error').textContent = '';
    const court = $('cs-am-court').value;
    const body = { groupId: groupOf().id, round: Number($('cs-am-round').value), player1Id: Number($('cs-am-p1').value) || null, player2Id: Number($('cs-am-p2').value) || null, force: $('cs-am-force').checked };
    if (court) {
      body.courtNo = Number(court);
      const time = $('cs-am-time').value.trim();
      if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) { $('cs-am-error').textContent = tl('Čas zadaj ako HH:MM, napr. 14:30.', 'Enter the time as HH:MM, for example 14:30.'); return; }
      body.scheduledAt = new Date(`${$('cs-am-day').value}T${time.padStart(5, '0')}:00`).toISOString();
    }
    try {
      const done = await api(`/seasons/${csState.season.id}/matches`, { method: 'POST', body });
      close();
      toast(done.warnings && done.warnings.length ? done.warnings.join(' ') : (done.placed ? tl('Zápas pridaný', 'Match added') : tl('Zápas pridaný — je v „Nerozvrhnuté“', 'Match added — it is in "Unscheduled"')));
      await reloadCourtSchedule();
    } catch (err) {
      $('cs-am-error').textContent = err.message;
      // a rematch, or a second match of a player in this round: the organiser may add it anyway
      $('cs-am-force-row').hidden = !(err.data && (err.data.code === 'REMATCH' || err.data.code === 'SAME_ROUND'));
    }
  });
}

async function initCourtSchedule(host, season) {
  host.innerHTML = `<div class="sv-empty">${escapeHtml(t('common.loading'))}</div>`;
  const [data, admin] = await Promise.all([api(`/seasons/${season.id}/schedule`), checkAdmin()]);
  if (csState && csState.host !== host) {
    csState.host.removeEventListener('pointerdown', csOnPointerDown);
    csState.host.onclick = null;
  }
  csState = { host, season, admin: admin || !!season.canManage, data };
  host.removeEventListener('pointerdown', csOnPointerDown);
  host.addEventListener('pointerdown', csOnPointerDown);
  host.ondblclick = (e) => {
    const handle = e.target.closest('[data-resize]');
    if (!handle || !csState.admin) return;
    e.preventDefault();
    csApply(api(`/seasons/${season.id}/schedule/matches/${handle.closest('.cs-m').dataset.token}`, { method: 'PUT', body: { durationMinutes: null } }), tl('Dĺžka zápasu vrátená na pôvodnú', 'The length of the match is back to the original'));
  };
  host.onclick = async (e) => {
    const handle = e.target.closest('[data-resize]');
    if (handle) { e.preventDefault(); return; }
    const finLock = e.target.closest('[data-fin-lock]');
    if (finLock) {
      e.preventDefault();
      const token = finLock.dataset.finLock;
      if (csUnlocked.has(token)) csUnlocked.delete(token); else csUnlocked.add(token);
      csRender();
      return;
    }
    const lock = e.target.closest('[data-unlock]');
    if (lock) {
      e.preventDefault();
      csApply(api(`/seasons/${season.id}/schedule/matches/${lock.dataset.unlock}`, { method: 'PUT', body: { locked: false } }), tl('Zápas odomknutý — plánovač ho môže pri prepočte presunúť', 'Match unlocked — the planner may move it when it recalculates'));
      return;
    }
    const day = e.target.closest('[data-cs-day]');
    if (day) { csChoice.day = day.dataset.csDay; csRender(); return; }
    const view = e.target.closest('[data-cs-view]');
    if (view) { csChoice.view = view.dataset.csView; csRender(); return; }
    const act = e.target.closest('[data-cs]');
    if (!act) return;
    const base = `/seasons/${season.id}/schedule`;
    const kind = act.dataset.cs;
    if (kind === 'settings') {
      const body = {
        matchMinutes: Number(document.getElementById('cs-minutes').value),
        dayStart: document.getElementById('cs-start').value,
        dayEnd: document.getElementById('cs-end').value,
        restMinutes: Number(document.getElementById('cs-rest').value),
        maxPerDay: Number(document.getElementById('cs-maxday').value) || 0,
        autoSchedule: document.getElementById('cs-auto').checked,
      };
      csApply(api(`${base}/settings`, { method: 'PATCH', body }), tl('Nastavenia uložené', 'Settings saved'));
    } else if (kind === 'addmatch') {
      csOpenAddMatch();
    } else if (kind === 'fill') {
      csApply(api(`${base}/auto`, { method: 'POST', body: { mode: 'fill' } }), tl('Rozvrh poskladaný', 'Schedule built'));
    } else if (kind === 'compact') {
      csApply(api(`${base}/auto`, { method: 'POST', body: { mode: 'compact' } }), tl('Zápasy posunuté dopredu', 'Matches moved earlier'));
    } else if (kind === 'rebuild') {
      if (confirm(tl('Prepočítať rozvrh odznova? Ručne umiestnené (zamknuté) zápasy ostanú, ostatné naplánované zápasy sa rozložia nanovo.', 'Rebuild the schedule from scratch? Matches placed by hand (locked) stay, the other planned matches are laid out again.'))) csApply(api(`${base}/auto`, { method: 'POST', body: { mode: 'rebuild' } }), tl('Rozvrh prepočítaný', 'Schedule rebuilt'));
    } else if (kind === 'unlock') {
      csApply(api(`${base}/auto`, { method: 'POST', body: { mode: 'unlock' } }), tl('Všetky zápasy odomknuté', 'All matches unlocked'));
    } else if (kind === 'clear') {
      if (confirm(tl('Vyčistiť rozvrh? Všetky nezačaté zápasy sa vrátia do „Nerozvrhnuté“, aj ručne umiestnené.', 'Clear the schedule? All matches that have not started go back to "Unscheduled", also the ones placed by hand.'))) csApply(api(`${base}/auto`, { method: 'POST', body: { mode: 'clear' } }), tl('Rozvrh vyčistený', 'Schedule cleared'));
    }
  };
  csRender();
}

// "Rozvrh kurtov" — the court schedule tab of a tournament page: a timeline (a column per court, the playing day from top to bottom, a
// block per match) and a list (a section per court). Everybody sees both; an admin can also drag a match onto a court at a time (it is
// then locked: the planner never moves it), drag it back to "Nerozvrhnuté" to take it off, change the settings of the day and run the
// planner. Data: GET /api/seasons/:id/schedule; the admin calls are PUT .../schedule/matches/:token, PATCH .../schedule/settings and
// POST .../schedule/auto (see src/tournamentSchedule.js). Needs common.js (api, t, escapeHtml, toast, checkAdmin, categoryLabel).
// Used by season.js: initCourtSchedule(hostElement, season).

const CS_TZ = 'Europe/Bratislava';
const CS_PX = 1.5; // pixels per minute of the timeline
const CS_SNAP = 15; // minutes
const CS_MS = 60 * 1000;

let csState = null; // { host, season, admin, data, day, view } — day and view are kept when the tab is drawn again
let csDrag = null;
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
  if (!m.round) return '';
  const rounds = m.rounds || 0;
  let name = t('courts.round', { n: m.round });
  if (rounds && m.round === rounds) name = t('courts.final');
  else if (rounds && m.round === rounds - 1) name = t('courts.semi');
  else if (rounds && m.round === rounds - 2) name = t('courts.quarter');
  return m.bracket && m.bracket.kind === 'CONSOLATION' ? `${t('courts.consolation')} · ${name}` : name;
}

const csCatClass = (m) => `cs-cat-${String(m.category || '').toLowerCase().replace(/_/g, '')}`;

function csPlayersHtml(m) {
  const won = (p) => (m.winnerId && m.winnerId === p.id ? ' class="cs-win"' : '');
  return `<span${won(m.player1)}>${escapeHtml(m.player1.name || '?')}</span><span${won(m.player2)}>${escapeHtml(m.player2.name || '?')}</span>`;
}

function csBlockHtml(m, day, startMin) {
  const parts = csParts(m.scheduledAt);
  const minutes = Math.max(15, Math.round((Date.parse(m.endsAt) - Date.parse(m.scheduledAt)) / CS_MS));
  const top = (parts.minutes - startMin) * CS_PX;
  const movable = csState.admin && m.status === 'PLANNED';
  const classes = ['cs-m', csCatClass(m), `cs-st-${m.status.toLowerCase()}`, movable ? 'cs-drag' : '', m.locked ? 'cs-locked' : ''].filter(Boolean).join(' ');
  return `<a class="${classes}" href="/match/${m.token}" draggable="false" data-token="${m.token}" ${movable ? 'data-drag="1"' : ''}
      style="top:${top}px;height:${minutes * CS_PX - 3}px" title="${escapeHtml(`${csTime(m.scheduledAt)}–${csTime(m.endsAt)} · ${m.player1.name} – ${m.player2.name}`)}">
    <span class="cs-m-time">${csTime(m.scheduledAt)}${m.locked && csState.admin ? ' <i class="cs-lock" title="Zamknuté — plánovač ho nepresúva"></i>' : ''}${m.status === 'LIVE' ? ` <b class="cs-live">${escapeHtml(t('home.live'))}</b>` : ''}</span>
    <span class="cs-m-pl">${csPlayersHtml(m)}</span>
    <span class="cs-m-meta">${escapeHtml([categoryLabel(m.category), csRoundLabel(m)].filter(Boolean).join(' · '))}</span>
    ${(m.status === 'FINISHED' || m.status === 'LIVE') && m.scoreSummary ? `<span class="cs-m-score">${escapeHtml(m.scoreSummary)}</span>` : ''}
  </a>`;
}

function csTimelineHtml(day) {
  const { settings, matches } = csState.data;
  const startMin = csMinutesOf(settings.dayStart);
  const endMin = csMinutesOf(settings.dayEnd);
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
    const blocks = matches.filter((m) => m.courtNo === court && m.scheduledAt && csParts(m.scheduledAt).day === day).map((m) => csBlockHtml(m, day, startMin)).join('');
    return `<div class="cs-colwrap"><div class="cs-court-h">${escapeHtml(t('courts.court', { n: court }))}</div><div class="cs-col" data-court="${court}" style="height:${height}px">${lines.join('')}${nowLine}${blocks}</div></div>`;
  }).join('');
  return `<div class="cs-scroll"><div class="cs-grid" style="--cs-cols:${settings.courtCount}"><div class="cs-gutter"><div class="cs-court-h">&nbsp;</div><div class="cs-hours" style="height:${height}px">${hours.join('')}</div></div>${cols}</div></div>`;
}

// the matches being played right now, with the score so far — at the top of the tab, whether or not they are on a court
function csLiveHtml() {
  const live = csState.data.matches.filter((m) => m.status === 'LIVE');
  if (!live.length) return '';
  const cards = live.map((m) => `
    <a class="cs-livecard ${csCatClass(m)}" href="/match/${m.token}">
      <span class="cs-live-h"><b class="cs-live">${escapeHtml(t('home.live'))}</b>${m.courtNo ? ` ${escapeHtml(t('courts.court', { n: m.courtNo }))}` : ''}</span>
      <span class="cs-m-pl">${csPlayersHtml(m)}</span>
      <span class="cs-live-score">${escapeHtml(m.scoreSummary || '0-0')}</span>
      <span class="cs-m-meta">${escapeHtml([categoryLabel(m.category), csRoundLabel(m)].filter(Boolean).join(' · '))}</span>
    </a>`).join('');
  return `<div class="cs-livestrip"><div class="cs-tray-h">${escapeHtml(t('courts.liveNow'))}<em>${live.length}</em></div><div class="cs-tray-body">${cards}</div></div>`;
}

function csTrayHtml() {
  const waiting = csState.data.matches.filter((m) => m.status === 'PLANNED' && !m.scheduledAt);
  if (!waiting.length && !csState.admin) return '';
  const chips = waiting.map((m) => {
    const movable = csState.admin;
    return `<a class="cs-chip ${csCatClass(m)}${movable ? ' cs-drag' : ''}" href="/match/${m.token}" draggable="false" data-token="${m.token}" ${movable ? 'data-drag="1"' : ''}>
      <span class="cs-m-pl">${csPlayersHtml(m)}</span><span class="cs-m-meta">${escapeHtml([categoryLabel(m.category), csRoundLabel(m)].filter(Boolean).join(' · '))}</span></a>`;
  }).join('');
  return `<div class="cs-tray"><div class="cs-tray-h">${escapeHtml(t('courts.unscheduled'))}<em>${waiting.length}</em></div><div class="cs-tray-body">${chips || `<span class="cs-tray-empty">${escapeHtml(t('courts.trayEmpty'))}</span>`}</div></div>`;
}

function csListHtml(day) {
  const { settings, matches } = csState.data;
  const sections = Array.from({ length: settings.courtCount }, (_, i) => {
    const court = i + 1;
    const rows = matches.filter((m) => m.courtNo === court && m.scheduledAt && csParts(m.scheduledAt).day === day)
      .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
    const body = rows.map((m) => `
      <a class="cs-row ${csCatClass(m)}" href="/match/${m.token}">
        <span class="cs-row-time">${csTime(m.scheduledAt)}–${csTime(m.endsAt)}</span>
        <span class="cs-row-pl">${csPlayersHtml(m)}</span>
        <span class="cs-row-meta">${escapeHtml([categoryLabel(m.category), csRoundLabel(m)].filter(Boolean).join(' · '))}</span>
        <span class="cs-row-st">${m.status === 'LIVE' ? `<b class="cs-live">${escapeHtml(t('home.live'))}</b> ${escapeHtml(m.scoreSummary || '')}` : m.status === 'FINISHED' ? escapeHtml(m.scoreSummary || '') : ''}</span>
      </a>`).join('');
    return `<div class="cs-list-court"><div class="cs-list-h">${escapeHtml(t('courts.court', { n: court }))}<em>${rows.length}</em></div>${body || `<div class="cs-row-empty">${escapeHtml(t('courts.courtFree'))}</div>`}</div>`;
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
        ${field('minutes', 'Dĺžka zápasu (min)', s.matchMinutes, 'type="number" min="15" max="300" step="5"')}
        ${field('start', 'Začiatok dňa', s.dayStart, 'type="time"')}
        ${field('end', 'Koniec dňa', s.dayEnd, 'type="time"')}
        ${field('rest', 'Oddych hráča (min)', s.restMinutes, 'type="number" min="0" max="240" step="5"')}
        <label class="cs-check"><input type="checkbox" id="cs-auto" ${s.autoSchedule ? 'checked' : ''}> Rozvrh skladá systém sám</label>
        <button type="button" class="btn btn-sm btn-outline" data-cs="settings">Uložiť nastavenia</button>
      </div>
      <div class="cs-admin-row">
        <button type="button" class="btn btn-sm btn-primary" data-cs="fill">Poskladať rozvrh</button>
        <button type="button" class="btn btn-sm btn-outline" data-cs="rebuild">Prepočítať odznova</button>
        <button type="button" class="btn btn-sm btn-outline" data-cs="clear">Vyčistiť rozvrh</button>
        <span class="cs-hint">Potiahni zápas na kurt a čas (zámok = ručne umiestnený, plánovač ho nepresúva). Späť do „Nerozvrhnuté“ ho zrušíš. Počet kurtov: Pavúk turnaja.</span>
      </div>
    </div>`;
}

// ---------- drawing ----------

// the day shown first: today when it has matches, else the first day that has any, else today / the first day
function csChooseDay() {
  const days = csState.data.settings.days;
  if (csChoice.day && days.includes(csChoice.day)) return csChoice.day;
  const today = csParts(new Date().toISOString()).day;
  const hasMatches = (d) => csState.data.matches.some((m) => m.scheduledAt && csParts(m.scheduledAt).day === d);
  if (days.includes(today) && hasMatches(today)) return today;
  return days.find(hasMatches) || (days.includes(today) ? today : days[0]);
}

function csRender() {
  const { settings } = csState.data;
  const day = csChooseDay();
  csChoice.day = day;
  const pills = settings.days.length > 1
    ? `<div class="tabs cs-days">${settings.days.map((d) => `<button type="button" class="tab${d === day ? ' active' : ''}" data-cs-day="${d}">${escapeHtml(csDayLabel(d))}</button>`).join('')}</div>` : '';
  const views = `<div class="tabs cs-views"><button type="button" class="tab${csChoice.view === 'timeline' ? ' active' : ''}" data-cs-view="timeline">${escapeHtml(t('courts.timeline'))}</button><button type="button" class="tab${csChoice.view === 'list' ? ' active' : ''}" data-cs-view="list">${escapeHtml(t('courts.list'))}</button></div>`;
  csState.host.innerHTML = `
    <section class="sv-sec cs-sec">
      ${csLiveHtml()}
      <div class="cs-bar">${pills}${views}</div>
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
  const el = e.target.closest('[data-drag]');
  if (!el || !csState.host.contains(el)) return;
  const rect = el.getBoundingClientRect();
  csDrag = { el, token: el.dataset.token, startX: e.clientX, startY: e.clientY, offY: e.clientY - rect.top, offX: e.clientX - rect.left, width: rect.width, height: rect.height, ghost: null, target: null, preview: null };
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
    const startMin = csMinutesOf(settings.dayStart);
    const endMin = csMinutesOf(settings.dayEnd);
    const length = settings.matchMinutes;
    let minutes = startMin + Math.round(((e.clientY - csDrag.offY - colRect.top) / CS_PX) / CS_SNAP) * CS_SNAP;
    minutes = Math.max(startMin, Math.min(minutes, endMin - length));
    return { type: 'court', col, court: Number(col.dataset.court), minutes, length };
  }
  const tray = under.closest('.cs-tray');
  return tray ? { type: 'tray', tray } : null;
}

function csOnPointerMove(e) {
  if (!csDrag) return;
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
    const startMin = csMinutesOf(csState.data.settings.dayStart);
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
  } else if (drag.el.classList.contains('cs-m')) {
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

async function initCourtSchedule(host, season) {
  host.innerHTML = `<div class="sv-empty">${escapeHtml(t('common.loading'))}</div>`;
  const [data, admin] = await Promise.all([api(`/seasons/${season.id}/schedule`), checkAdmin()]);
  if (csState && csState.host !== host) {
    csState.host.removeEventListener('pointerdown', csOnPointerDown);
    csState.host.onclick = null;
  }
  csState = { host, season, admin, data };
  host.removeEventListener('pointerdown', csOnPointerDown);
  host.addEventListener('pointerdown', csOnPointerDown);
  host.onclick = async (e) => {
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
        autoSchedule: document.getElementById('cs-auto').checked,
      };
      csApply(api(`${base}/settings`, { method: 'PATCH', body }), 'Nastavenia uložené');
    } else if (kind === 'fill') {
      csApply(api(`${base}/auto`, { method: 'POST', body: { mode: 'fill' } }), 'Rozvrh poskladaný');
    } else if (kind === 'rebuild') {
      if (confirm('Prepočítať rozvrh odznova? Ručne umiestnené (zamknuté) zápasy ostanú, ostatné naplánované zápasy sa rozložia nanovo.')) csApply(api(`${base}/auto`, { method: 'POST', body: { mode: 'rebuild' } }), 'Rozvrh prepočítaný');
    } else if (kind === 'clear') {
      if (confirm('Vyčistiť rozvrh? Všetky nezačaté zápasy sa vrátia do „Nerozvrhnuté“, aj ručne umiestnené.')) csApply(api(`${base}/auto`, { method: 'POST', body: { mode: 'clear' } }), 'Rozvrh vyčistený');
    }
  };
  csRender();
}

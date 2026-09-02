// label is a t() key, not literal text — read it with t(FILTERS[key].label)
// wherever it's shown, so it follows the current language.
const FILTERS = {
  ALL: { status: 'PLANNED', label: 'tabs.all' },
  SCHEDULED: { status: 'PLANNED', dateFilter: 'has', label: 'tabs.scheduled' },
  UNSCHEDULED: { status: 'PLANNED', dateFilter: 'none', label: 'tabs.planned' },
  LIVE: { status: 'LIVE', label: 'tabs.live' },
  FINISHED: { status: 'FINISHED', label: 'tabs.finished' },
  UNFINISHED: { status: 'UNFINISHED', label: 'tabs.unfinished' },
};
let currentFilter = 'ALL';
let currentQuery = '';
let currentCategory = '';
let currentTimeFilter = '';
let debounceTimer = null;
let isAdminUser = false;

const listEl = document.getElementById('match-list');

// Midnight-to-midnight for "today + offsetDays", in the viewer's local time.
function getDayRange(offsetDays) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

// Monday-Sunday week containing "today + offsetWeeks*7", in the viewer's local time.
function getWeekRange(offsetWeeks) {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday + offsetWeeks * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { from: monday.toISOString(), to: sunday.toISOString() };
}

// Google Calendar's "quick add" URL — no API/auth needed, just opens their
// prefilled event form in a new tab for the viewer to save themselves.
// Duration isn't tracked for a match that hasn't started, so this defaults
// to 2 hours.
function googleCalendarUrl(m) {
  const start = new Date(m.scheduledAt);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const text = t('calendar.eventTitle', { p1: m.player1.name, p2: m.player2.name });
  const details = `${m.formatLabel}\n${window.location.origin}/match/${m.token}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text,
    dates: `${fmt(start)}/${fmt(end)}`,
    details,
    location: m.location || '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function notifyButtonsHtml(m) {
  const startDone = localStorage.getItem(`blta_notified_${m.token}_START`);
  const finishDone = localStorage.getItem(`blta_notified_${m.token}_FINISH`);
  const startCount = m.notifyStartCount || 0;
  const finishCount = m.notifyFinishCount || 0;
  const startCountSuffix = startCount ? ` (${startCount})` : '';
  const finishCountSuffix = finishCount ? ` (${finishCount})` : '';
  const startLabelFull = `${t(startDone ? 'matches.notifiedStart' : 'matches.notifyStart')}${startCountSuffix}`;
  const finishLabelFull = `${t(finishDone ? 'matches.notifiedFinish' : 'matches.notifyFinish')}${finishCountSuffix}`;
  // Compact mobile labels drop the "Notify:"/"Notified:" wording and keep
  // just the icon (✓ once done, same as the full label) + the bare word —
  // see .notify-btn .btn-text-compact in style.css for where these show.
  const startLabelShort = `${startDone ? '✓' : '🔔'} ${t('matches.startShort')}${startCountSuffix}`;
  const finishLabelShort = `${finishDone ? '✓' : '🔔'} ${t('matches.finishShort')}${finishCountSuffix}`;
  return `
    <div class="notify-buttons-row">
      <button type="button" class="btn btn-sm btn-outline add-calendar-btn" data-url="${escapeHtml(googleCalendarUrl(m))}"><span class="cal-full">${t('matches.addToCalendar')}</span><span class="cal-compact">📅+</span></button>
      <button type="button" class="btn btn-sm btn-outline notify-btn" data-token="${m.token}" data-type="START" ${startDone ? 'disabled' : ''}><span class="btn-text-full">${startLabelFull}</span><span class="btn-text-compact">${startLabelShort}</span></button>
      <button type="button" class="btn btn-sm btn-outline notify-btn" data-token="${m.token}" data-type="FINISH" ${finishDone ? 'disabled' : ''}><span class="btn-text-full">${finishLabelFull}</span><span class="btn-text-compact">${finishLabelShort}</span></button>
    </div>
  `;
}

// /compact and /embed/compact share this — see compactMatchCardHtml in
// common.js — via the same 'compact-page' body class.
const COMPACT_MODE = document.body.classList.contains('compact-page');

// /compactblta only — a fixed category allowlist read off the body tag
// (see compactblta.html) rather than a hardcoded list here, so the page
// itself stays the one place that says which categories it's for. Applied
// in buildFilterParamsForSpec below only when nothing more specific is
// already selected — the page's own category dropdown only offers these
// same categories to pick from, so a specific pick never needs widening
// back out to the rest of the list.
const FORCED_CATEGORIES = (document.body.dataset.categories || '').split(',').map((c) => c.trim()).filter(Boolean);

// Enough of a match's ownership shape (mirrors checkMatchAccess in
// routes/matches.js) baked onto the Set date/Propose times buttons so the
// click handler can decide eligibility immediately, before opening either
// modal — see canManageMatch in common.js and the click delegation below.
function plannedActionDataAttrs(m) {
  return `data-token="${m.token}" data-p1-id="${m.player1.id}" data-p2-id="${m.player2.id}" data-created-by-admin="${m.createdByAdmin ? '1' : '0'}" data-created-by-anonymous="${m.createdByAnonymous ? '1' : '0'}" data-created-by-player-id="${m.createdByPlayerId != null ? m.createdByPlayerId : ''}"`;
}

function matchCardHtml(m) {
  if (COMPACT_MODE) return compactMatchCardHtml(m);
  const winnerP1 = m.status === 'FINISHED' && m.winnerId === m.player1.id;
  const winnerP2 = m.status === 'FINISHED' && m.winnerId === m.player2.id;
  const scoreboard = cardScoreboardHtml(m);
  return `
    <a class="match-card status-${m.status}${m.status === 'PLANNED' && m.scheduledAt ? ' has-date' : ''}" href="/match/${m.token}">
      <div class="match-card-top">
        ${categoryBadge(m.category)}
        ${statusBadge(m)}
        <div class="match-card-meta" style="margin-left:auto">
          ${m.location ? `<span>📍 ${escapeHtml(m.location)}</span>` : ''}
          ${m.status === 'PLANNED' && m.scheduledAt ? '' : `<span>🗓 ${fmtDateShort(m.scheduledAt)}</span>`}
          ${(m.status !== 'FINISHED' || isAdminUser) && canManageMatch(m, isAdminUser) ? `<button type="button" class="match-quick-edit-btn" data-token="${m.token}" title="${escapeHtml(t('match.editMatchBtn'))}">✏️</button>` : ''}
        </div>
      </div>
      ${m.notes ? `<div class="match-card-notes">${escapeHtml(m.notes)}</div>` : ''}
      ${scoreboard || `
        <div class="match-players-box">
          <div class="match-players">
            <div class="match-players-names">
              <div class="name ${winnerP1 ? 'winner' : ''}">${playerNameLink(m.player1)}${ballsIconHtml(m, 1)}${courtIconHtml(m, 1)}${proposalIconHtml(m, 1)}${playerInfoBtn(m.player1)}</div>
              <div class="vs">vs</div>
              <div class="name ${winnerP2 ? 'winner' : ''}">${playerNameLink(m.player2)}${ballsIconHtml(m, 2)}${courtIconHtml(m, 2)}${proposalIconHtml(m, 2)}${playerInfoBtn(m.player2)}</div>
            </div>
            <div class="match-score${m.status === 'PLANNED' ? ' match-score-format' : ''}">${matchScoreHtml(m)}</div>
          </div>
        </div>
      `}
      ${isOverdueUnresolved(m) ? `<div class="overdue-warning">${t('matches.overdueWarning')}</div>` : ''}
      ${m.status === 'PLANNED' && !m.scheduledAt ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <button type="button" class="btn btn-sm btn-outline quick-schedule-btn" ${plannedActionDataAttrs(m)}><span class="btn-text-full">${t('matches.setDateLocation')}</span><span class="btn-text-compact">${t('matches.setDateLocationShort')}</span></button>
          <button type="button" class="btn btn-sm btn-outline propose-times-btn" ${plannedActionDataAttrs(m)} data-p1-name="${escapeHtml(m.player1.name)}" data-p2-name="${escapeHtml(m.player2.name)}">${t('matches.proposeTimes')}</button>
        </div>
      ` : ''}
      ${m.status === 'PLANNED' && m.scheduledAt ? notifyButtonsHtml(m) : ''}
    </a>
  `;
}

// "All Matches" mixes dated and undated planned matches (API returns dated
// first) — head each section, and insert a new heading right where that
// switch happens. The dedicated Scheduled/Not yet scheduled tabs already
// show one kind only, so they skip the headings entirely.
function buildMatchListHtml(matches, liveMatches) {
  if (currentFilter !== 'ALL') {
    return matches.map(matchCardHtml).join('');
  }
  const parts = [];
  // Live sits in its own group above Scheduled/Not yet scheduled, and only
  // appears at all when there's something live right now.
  if (liveMatches && liveMatches.length) {
    parts.push(`<div class="match-list-heading">${t('matches.liveHeading')}</div>`);
    parts.push(...liveMatches.map(matchCardHtml));
  }
  matches.forEach((m, i) => {
    const curScheduled = !!m.scheduledAt;
    if (i === 0) {
      parts.push(`<div class="match-list-heading">${t(curScheduled ? 'matches.scheduledHeading' : 'matches.plannedHeading')}</div>`);
    } else if (matches[i - 1].scheduledAt && !curScheduled) {
      parts.push(`<div class="match-list-heading">${t('matches.plannedHeading')}</div>`);
    }
    parts.push(matchCardHtml(m));
  });
  return parts.join('');
}

// Same {status, dateFilter} spec shape as a FILTERS entry, but usable
// standalone — the "My matches" tab's per-group queries (see
// MY_MATCHES_GROUPS below) aren't full FILTERS entries themselves (no
// single FILTERS key covers "my matches"), so they share this builder
// instead of going through a FILTERS key.
function buildFilterParamsForSpec(spec) {
  const params = new URLSearchParams();
  if (spec.status) params.set('status', spec.status);
  if (currentQuery) params.set('q', currentQuery);
  if (currentCategory) params.set('category', currentCategory);
  else if (FORCED_CATEGORIES.length) params.set('category', FORCED_CATEGORIES.join(','));

  if (spec.dateFilter === 'has') {
    params.set('hasDate', '1');
  } else if (spec.dateFilter === 'none') {
    params.set('noDate', '1');
  } else if (spec.status === 'PLANNED' || spec.status === 'FINISHED' || spec.status === 'UNFINISHED') {
    if (currentTimeFilter === 'today') {
      const { from, to } = getDayRange(0);
      params.set('from', from);
      params.set('to', to);
    } else if (currentTimeFilter === 'tomorrow') {
      const { from, to } = getDayRange(1);
      params.set('from', from);
      params.set('to', to);
    } else if (currentTimeFilter === 'this_week') {
      const { from, to } = getWeekRange(0);
      params.set('from', from);
      params.set('to', to);
    } else if (currentTimeFilter === 'next_week') {
      const { from, to } = getWeekRange(1);
      params.set('from', from);
      params.set('to', to);
    } else if (currentTimeFilter === 'tbd') {
      params.set('noDate', '1');
    }
  }
  return params;
}

function buildFilterParams(filterKey) {
  return buildFilterParamsForSpec(FILTERS[filterKey]);
}

// The "My matches" tab (unlocked only once a real player is logged in —
// see updateMyMatchesTabState) divides that player's own matches into the
// same groups/headings as the head-to-head list on their own profile page
// (see GROUPS in player.js) — Live / Scheduled / Not yet scheduled /
// Finished / Unfinished — rather than the single-status ALL tab, since a
// player's own matches should include their finished history too.
const MY_MATCHES_GROUPS = [
  { get heading() { return t('matches.liveHeading'); }, params: { status: 'LIVE' } },
  { get heading() { return t('matches.scheduledHeading'); }, params: { status: 'PLANNED', dateFilter: 'has' } },
  { get heading() { return t('matches.plannedHeading'); }, params: { status: 'PLANNED', dateFilter: 'none' } },
  { get heading() { return t('matches.finishedHeading'); }, params: { status: 'FINISHED' } },
  { get heading() { return t('matches.unfinishedHeading'); }, params: { status: 'UNFINISHED' } },
];

async function loadMyMatches() {
  await RANKS_READY;
  try {
    const rawGroups = await Promise.all(MY_MATCHES_GROUPS.map((g) => {
      const params = buildFilterParamsForSpec(g.params);
      params.set('playerId', currentPlayerId);
      return api(`/matches?${params.toString()}`);
    }));
    const parts = [];
    rawGroups.forEach((matches, i) => {
      if (!matches.length) return;
      parts.push(`<div class="match-list-heading">${MY_MATCHES_GROUPS[i].heading}</div>`);
      parts.push(...matches.map(matchCardHtml));
    });
    listEl.innerHTML = parts.length
      ? parts.join('')
      : `<div class="empty-state">${escapeHtml(t('matches.noneOfType', { label: t('tabs.myMatches').toLowerCase() }))}</div>`;
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">${escapeHtml(t('matches.couldNotLoad', { error: err.message }))}</div>`;
  }
}

async function refreshMyMatchesCount() {
  const el = document.getElementById('count-MY_MATCHES');
  if (!el || !playerAuthed || !currentPlayerId) return;
  try {
    const totals = await Promise.all(MY_MATCHES_GROUPS.map((g) => {
      const params = buildFilterParamsForSpec(g.params);
      params.set('playerId', currentPlayerId);
      return api(`/matches?${params.toString()}`);
    }));
    el.textContent = totals.reduce((sum, matches) => sum + matches.length, 0);
  } catch { /* ignore */ }
}

// The tab is always visible (first in the row), but only makes sense for a
// real logged-in player. Until then it's greyed out via .tab-locked (see the click
// handler below for what a click does in that state instead of switching
// tabs). If a player logs out while this tab is the active one, fall back
// to ALL rather than leave a now-locked tab selected.
function updateMyMatchesTabState() {
  const tabBtn = document.getElementById('tab-MY_MATCHES');
  if (!tabBtn) return;
  const unlocked = playerAuthed && !!currentPlayerId;
  tabBtn.classList.toggle('tab-locked', !unlocked);
  if (!unlocked && currentFilter === 'MY_MATCHES') {
    document.querySelectorAll('.tab').forEach((tb) => tb.classList.remove('active'));
    document.querySelector('.tab[data-filter="ALL"]').classList.add('active');
    currentFilter = 'ALL';
  }
}

async function loadMatches() {
  if (currentFilter === 'MY_MATCHES') return loadMyMatches();
  await RANKS_READY;
  const params = buildFilterParams(currentFilter);
  try {
    // "All Matches" also folds in a Live group up top, on the same
    // search/category filters — a separate request since the API only
    // takes one status per call.
    const [matches, liveMatches] = await Promise.all([
      api(`/matches?${params.toString()}`),
      currentFilter === 'ALL' ? api(`/matches?${buildFilterParams('LIVE').toString()}`) : Promise.resolve([]),
    ]);
    if (matches.length === 0 && liveMatches.length === 0) {
      const hasFilters = currentQuery || currentCategory || currentTimeFilter;
      const label = t(FILTERS[currentFilter].label).toLowerCase();
      listEl.innerHTML = `<div class="empty-state">${escapeHtml(t(hasFilters ? 'matches.noneFiltered' : 'matches.noneOfType', { label }))}</div>`;
    } else {
      listEl.innerHTML = buildMatchListHtml(matches, liveMatches);
    }
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">${escapeHtml(t('matches.couldNotLoad', { error: err.message }))}</div>`;
  }
}

async function refreshCounts() {
  for (const key of Object.keys(FILTERS)) {
    try {
      const params = buildFilterParams(key);
      let matches = await api(`/matches?${params.toString()}`);
      if (key === 'ALL') {
        const liveMatches = await api(`/matches?${buildFilterParams('LIVE').toString()}`);
        matches = matches.concat(liveMatches);
      }
      const el = document.getElementById(`count-${key}`);
      if (el) el.textContent = matches.length;
      // Unfinished matches are the exception, not the norm — the tab stays
      // out of the way entirely until there's actually one to see.
      if (key === 'UNFINISHED') {
        const tabBtn = document.getElementById('tab-UNFINISHED');
        if (tabBtn) tabBtn.style.display = matches.length ? '' : 'none';
      }
    } catch { /* ignore */ }
  }
}

function activateTab(tab) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
  currentFilter = tab.dataset.filter;
  loadMatches();
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    if (tab.dataset.filter === 'MY_MATCHES' && !(playerAuthed && currentPlayerId)) {
      // Locked until a real player is logged in — a click prompts the
      // login modal instead of switching immediately, then only actually
      // switches to it once a real player identity comes back.
      openPlayerLoginModal(() => {
        if (playerAuthed && currentPlayerId) activateTab(tab);
      });
      return;
    }
    activateTab(tab);
  });
});
document.querySelector(`.tab[data-filter="${currentFilter}"]`).classList.add('active');

document.getElementById('filter-q').addEventListener('input', (e) => {
  currentQuery = e.target.value.trim();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadMatches, 250);
});
document.getElementById('filter-category').addEventListener('change', (e) => {
  currentCategory = e.target.value;
  loadMatches();
});
document.getElementById('filter-time').addEventListener('change', (e) => {
  currentTimeFilter = e.target.value;
  loadMatches();
});
document.getElementById('reset-filters-btn').addEventListener('click', () => {
  currentQuery = '';
  currentCategory = '';
  currentTimeFilter = '';
  document.getElementById('filter-q').value = '';
  document.getElementById('filter-category').value = '';
  document.getElementById('filter-time').value = '';
  loadMatches();
  refreshCounts();
  refreshMyMatchesCount();
});

document.getElementById('embed-list-btn').addEventListener('click', () => {
  const f = FILTERS[currentFilter];
  const src = new URL(COMPACT_MODE ? '/embed/compact' : '/embed/live', window.location.origin);
  src.searchParams.set('status', f.status);
  if (f.dateFilter === 'has') src.searchParams.set('dateFilter', 'has');
  else if (f.dateFilter === 'none') src.searchParams.set('dateFilter', 'none');
  // A specific category picked from the dropdown carries over as-is; on
  // /compactblta, with nothing more specific picked, the page's own
  // allowlist (see FORCED_CATEGORIES) carries over instead — otherwise the
  // embedded widget would show every category again, silently dropping
  // the one thing this page's whole point is to restrict.
  if (currentCategory) src.searchParams.set('category', currentCategory);
  else if (FORCED_CATEGORIES.length) src.searchParams.set('category', FORCED_CATEGORIES.join(','));
  // The compact table reads better wide and short; the full card is tall and
  // narrow (a sidebar widget), so each embed defaults to a different shape.
  const iframeStyle = COMPACT_MODE ? 'border:0;width:100%' : 'border:0;max-width:480px';
  const code = `<iframe src="${src.toString()}" width="100%" height="${COMPACT_MODE ? 400 : 600}" frameborder="0" style="${iframeStyle}"></iframe>`;
  document.getElementById('embed-modal-desc').textContent = t('embed.descWithList', { label: t(f.label).toLowerCase() });
  document.getElementById('embed-code').textContent = code;
  document.getElementById('copy-embed-btn').onclick = () => {
    copyToClipboard(code).then(() => toast(t('embed.copied')));
  };
  document.getElementById('embed-modal').style.display = 'flex';
});

let quickScheduleToken = null;

function openQuickScheduleModal(token) {
  quickScheduleToken = token;
  document.getElementById('quick-schedule-location').value = '';
  document.getElementById('quick-schedule-date').value = '';
  document.getElementById('quick-schedule-time').value = '';
  document.getElementById('quick-schedule-error').textContent = '';
  document.getElementById('quick-schedule-modal').style.display = 'flex';
}

let notifyToken = null;
let notifyType = null;

function openNotifyModal(token, type) {
  notifyToken = token;
  notifyType = type;
  document.getElementById('notify-modal-title').textContent = t(type === 'START' ? 'notify.startTitle' : 'notify.finishTitle');
  document.getElementById('notify-modal-desc').textContent = t(type === 'START' ? 'notify.startDesc' : 'notify.finishDesc');
  document.getElementById('notify-email').value = localStorage.getItem('blta_notify_email') || '';
  document.getElementById('notify-error').textContent = '';
  document.getElementById('notify-modal').style.display = 'flex';
}

// Shared gate for the two Planned-card quick actions. Both buttons are
// always visible (see matchCardHtml) — logging in, and eligibility for
// this specific match, are enforced here instead: prompt login first if
// logged out, then — the moment login is confirmed — reject immediately
// with checkMatchAccess's own message if this player isn't allowed to
// manage this particular match, rather than only rejecting
// after they've filled out the whole modal and hit submit.
function handlePlannedActionClick(btn, onReady) {
  requirePlayerAuth(() => {
    const matchLike = {
      player1: { id: Number(btn.dataset.p1Id) },
      player2: { id: Number(btn.dataset.p2Id) },
      createdByAdmin: btn.dataset.createdByAdmin === '1',
      createdByAnonymous: btn.dataset.createdByAnonymous === '1',
      createdByPlayerId: btn.dataset.createdByPlayerId ? Number(btn.dataset.createdByPlayerId) : null,
    };
    if (!canManageMatch(matchLike, isAdminUser)) {
      showAccessDeniedModal(t('accessDenied.message'));
      return;
    }
    onReady();
  });
}

listEl.addEventListener('click', (e) => {
  const calendarBtn = e.target.closest('.add-calendar-btn');
  if (calendarBtn) {
    e.preventDefault();
    e.stopPropagation();
    window.open(calendarBtn.dataset.url, '_blank', 'noopener');
    return;
  }
  const scheduleBtn = e.target.closest('.quick-schedule-btn');
  if (scheduleBtn) {
    e.preventDefault();
    e.stopPropagation();
    handlePlannedActionClick(scheduleBtn, () => openQuickScheduleModal(scheduleBtn.dataset.token));
    return;
  }
  const proposeBtn = e.target.closest('.propose-times-btn');
  if (proposeBtn) {
    e.preventDefault();
    e.stopPropagation();
    handlePlannedActionClick(proposeBtn, () => openProposeTimesModal(proposeBtn.dataset.token, proposeBtn.dataset.p1Name, proposeBtn.dataset.p2Name, proposeBtn.dataset.p1Id, proposeBtn.dataset.p2Id, loadMatches));
    return;
  }
  const notifyBtn = e.target.closest('.notify-btn');
  if (notifyBtn) {
    e.preventDefault();
    e.stopPropagation();
    openNotifyModal(notifyBtn.dataset.token, notifyBtn.dataset.type);
    return;
  }
  const quickEditBtn = e.target.closest('.match-quick-edit-btn');
  if (quickEditBtn) {
    e.preventDefault();
    e.stopPropagation();
    handleQuickEditMatchClick(quickEditBtn.dataset.token, isAdminUser, loadMatches);
  }
});

document.getElementById('quick-schedule-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('quick-schedule-error');
  errorEl.textContent = '';
  const location = document.getElementById('quick-schedule-location').value.trim();
  const dateVal = document.getElementById('quick-schedule-date').value;
  const timeVal = document.getElementById('quick-schedule-time').value;
  const scheduledAt = dateVal ? new Date(`${dateVal}T${timeVal || '00:00'}`).toISOString() : null;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    await api(`/matches/${quickScheduleToken}`, { method: 'PATCH', body: { location, scheduledAt } });
    document.getElementById('quick-schedule-modal').style.display = 'none';
    loadMatches();
  } catch (err) {
    errorEl.textContent = err.message;
  }
  submitBtn.disabled = false;
});

document.getElementById('notify-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('notify-error');
  errorEl.textContent = '';
  const email = document.getElementById('notify-email').value.trim();

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    await api(`/matches/${notifyToken}/notify-me`, { method: 'POST', body: { email, type: notifyType } });
    localStorage.setItem('blta_notify_email', email);
    localStorage.setItem(`blta_notified_${notifyToken}_${notifyType}`, '1');
    document.getElementById('notify-modal').style.display = 'none';
    toast(t('notify.subscribed'));
    loadMatches();
  } catch (err) {
    errorEl.textContent = err.message;
  }
  submitBtn.disabled = false;
});

document.getElementById('notify-push-btn').addEventListener('click', async () => {
  const errorEl = document.getElementById('notify-push-error');
  const btn = document.getElementById('notify-push-btn');
  errorEl.textContent = '';
  btn.disabled = true;
  try {
    await subscribeToPush(notifyToken, notifyType);
    localStorage.setItem(`blta_notified_${notifyToken}_${notifyType}`, '1');
    document.getElementById('notify-modal').style.display = 'none';
    toast(t('notify.subscribed'));
    loadMatches();
  } catch (err) {
    errorEl.textContent = err.message;
  }
  btn.disabled = false;
});

const socket = io();
socket.on('matches:changed', () => {
  loadMatches();
  refreshCounts();
  refreshMyMatchesCount();
});

(async () => {
  // Awaited before the first render (and before any click can reach
  // handlePlannedActionClick above) so isAdminUser/playerAuthed/
  // currentPlayerId are accurate the moment someone can actually click one
  // of the Planned-card buttons.
  isAdminUser = await checkAdmin();
  await refreshPlayerAuth();
  updateMyMatchesTabState();
  loadMatches();
  refreshCounts();
  refreshMyMatchesCount();
  // Re-render once a *later* login/logout finishes (see the
  // blta:auth-changed dispatch in common.js) — registered only after the
  // refreshPlayerAuth() call above so its own initial dispatch doesn't
  // trigger a redundant second loadMatches() right after this one.
  window.addEventListener('blta:auth-changed', () => {
    updateMyMatchesTabState();
    loadMatches();
    refreshMyMatchesCount();
  });
})();

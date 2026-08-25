const FILTERS = {
  ALL: { status: 'PLANNED', label: 'All Matches' },
  SCHEDULED: { status: 'PLANNED', dateFilter: 'has', label: 'Scheduled' },
  UNSCHEDULED: { status: 'PLANNED', dateFilter: 'none', label: 'Planned' },
  LIVE: { status: 'LIVE', label: 'Live' },
  FINISHED: { status: 'FINISHED', label: 'Finished' },
};
let currentFilter = 'ALL';
let currentQuery = '';
let currentCategory = '';
let currentTimeFilter = '';
let debounceTimer = null;

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
  const text = `${m.player1.name} vs ${m.player2.name} — BLTA match`;
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
  const startLabel = `${startDone ? '✓ Notified: start' : '🔔 Notify: start'}${startCount ? ` (${startCount})` : ''}`;
  const finishLabel = `${finishDone ? '✓ Notified: finish' : '🏁 Notify: finish'}${finishCount ? ` (${finishCount})` : ''}`;
  return `
    <div class="notify-buttons-row">
      <button type="button" class="btn btn-sm btn-outline add-calendar-btn" data-url="${escapeHtml(googleCalendarUrl(m))}"><span class="cal-full">📅 Add to Calendar</span><span class="cal-compact">📅+</span></button>
      <button type="button" class="btn btn-sm btn-outline notify-btn" data-token="${m.token}" data-type="START" ${startDone ? 'disabled' : ''}>${startLabel}</button>
      <button type="button" class="btn btn-sm btn-outline notify-btn" data-token="${m.token}" data-type="FINISH" ${finishDone ? 'disabled' : ''}>${finishLabel}</button>
    </div>
  `;
}

function matchCardHtml(m) {
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
        </div>
      </div>
      ${m.notes ? `<div class="match-card-notes">${escapeHtml(m.notes)}</div>` : ''}
      ${scoreboard || `
        <div class="match-players-box">
          <div class="match-players">
            <div>
              <div class="name ${winnerP1 ? 'winner' : ''}">${playerNameLink(m.player1)}${playerInfoBtn(m.player1)}</div>
              <div class="vs">vs</div>
              <div class="name ${winnerP2 ? 'winner' : ''}">${playerNameLink(m.player2)}${playerInfoBtn(m.player2)}</div>
            </div>
            <div class="match-score">${matchScoreHtml(m)}</div>
          </div>
        </div>
      `}
      ${isOverdueUnresolved(m) ? '<div class="overdue-warning">⚠️ Overdue — no result recorded yet</div>' : ''}
      ${m.status === 'PLANNED' && !m.scheduledAt ? `<button type="button" class="btn btn-sm btn-outline quick-schedule-btn" data-token="${m.token}" style="margin-top:6px">📅 Set date &amp; location</button>` : ''}
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
    parts.push('<div class="match-list-heading">🔴 Live</div>');
    parts.push(...liveMatches.map(matchCardHtml));
  }
  matches.forEach((m, i) => {
    const curScheduled = !!m.scheduledAt;
    if (i === 0) {
      parts.push(`<div class="match-list-heading">${curScheduled ? '📅 Scheduled' : '🕓 Planned'}</div>`);
    } else if (matches[i - 1].scheduledAt && !curScheduled) {
      parts.push('<div class="match-list-heading">🕓 Planned</div>');
    }
    parts.push(matchCardHtml(m));
  });
  return parts.join('');
}

function buildFilterParams(filterKey) {
  const f = FILTERS[filterKey];
  const params = new URLSearchParams();
  params.set('status', f.status);
  if (currentQuery) params.set('q', currentQuery);
  if (currentCategory) params.set('category', currentCategory);

  if (f.dateFilter === 'has') {
    params.set('hasDate', '1');
  } else if (f.dateFilter === 'none') {
    params.set('noDate', '1');
  } else if (f.status === 'PLANNED' || f.status === 'FINISHED') {
    if (currentTimeFilter === 'today') {
      const { from, to } = getDayRange(0);
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

async function loadMatches() {
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
      listEl.innerHTML = `<div class="empty-state">No ${FILTERS[currentFilter].label.toLowerCase()} matches${hasFilters ? ' match your filters' : ''}.</div>`;
    } else {
      listEl.innerHTML = buildMatchListHtml(matches, liveMatches);
    }
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Could not load matches: ${escapeHtml(err.message)}</div>`;
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
    } catch { /* ignore */ }
  }
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = tab.dataset.filter;
    loadMatches();
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
});

document.getElementById('embed-list-btn').addEventListener('click', () => {
  const f = FILTERS[currentFilter];
  const src = new URL('/embed/live', window.location.origin);
  src.searchParams.set('status', f.status);
  if (f.dateFilter === 'has') src.searchParams.set('dateFilter', 'has');
  else if (f.dateFilter === 'none') src.searchParams.set('dateFilter', 'none');
  const code = `<iframe src="${src.toString()}" width="100%" height="600" frameborder="0" style="border:0;max-width:480px"></iframe>`;
  document.getElementById('embed-modal-desc').textContent =
    `Paste this into a "Custom HTML" block on your blta.sk page to show the ${f.label.toLowerCase()} list:`;
  document.getElementById('embed-code').textContent = code;
  document.getElementById('copy-embed-btn').onclick = () => {
    copyToClipboard(code).then(() => toast('Embed code copied'));
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
  document.getElementById('notify-modal-title').textContent = type === 'START' ? 'Notify me when it starts' : 'Notify me when it finishes';
  document.getElementById('notify-modal-desc').textContent = type === 'START'
    ? "We'll email you as soon as this match starts."
    : "We'll email you the result as soon as this match finishes.";
  document.getElementById('notify-email').value = localStorage.getItem('blta_notify_email') || '';
  document.getElementById('notify-error').textContent = '';
  document.getElementById('notify-modal').style.display = 'flex';
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
    requirePlayerAuth(() => openQuickScheduleModal(scheduleBtn.dataset.token));
    return;
  }
  const notifyBtn = e.target.closest('.notify-btn');
  if (notifyBtn) {
    e.preventDefault();
    e.stopPropagation();
    openNotifyModal(notifyBtn.dataset.token, notifyBtn.dataset.type);
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
    toast("You're subscribed!");
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
    toast("You're subscribed!");
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
});

loadMatches();
refreshCounts();

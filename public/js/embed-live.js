const listEl = document.getElementById('live-list');

const VALID_STATUSES = ['PLANNED', 'LIVE', 'FINISHED'];
const params = new URLSearchParams(window.location.search);
const statusFilter = VALID_STATUSES.includes((params.get('status') || '').toUpperCase())
  ? params.get('status').toUpperCase()
  : 'LIVE';
// Only meaningful when statusFilter is PLANNED — narrows to just the
// Scheduled or just the Not yet scheduled subset, matching the home page's
// dedicated tabs, instead of embedding the full combined Planned list.
const dateFilter = statusFilter === 'PLANNED' && ['has', 'none'].includes(params.get('dateFilter'))
  ? params.get('dateFilter')
  : null;

const HEADERS = {
  PLANNED: '🗓 Planned matches',
  LIVE: '🔴 Live now',
  FINISHED: '✅ Finished matches',
};
const PLANNED_DATE_HEADERS = { has: '📅 Scheduled matches', none: '🕓 Planned' };
const EMPTY_MESSAGES = {
  PLANNED: 'No planned matches right now.',
  LIVE: 'No live matches right now.',
  FINISHED: 'No finished matches yet.',
};
const PLANNED_DATE_EMPTY_MESSAGES = { has: 'No scheduled matches right now.', none: 'No unscheduled matches right now.' };

function header() {
  return dateFilter ? PLANNED_DATE_HEADERS[dateFilter] : HEADERS[statusFilter];
}
function emptyMessage() {
  return dateFilter ? PLANNED_DATE_EMPTY_MESSAGES[dateFilter] : EMPTY_MESSAGES[statusFilter];
}

// Same card markup as the home page's match list, so an embedded widget
// looks identical to (and shows the same information as) the live site.
function matchCardHtml(m) {
  const winnerP1 = m.status === 'FINISHED' && m.winnerId === m.player1.id;
  const winnerP2 = m.status === 'FINISHED' && m.winnerId === m.player2.id;
  const scoreboard = cardScoreboardHtml(m);
  return `
    <a class="match-card status-${m.status}${m.status === 'PLANNED' && m.scheduledAt ? ' has-date' : ''}" href="${window.location.origin}/match/${m.token}" target="_blank" rel="noopener">
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
    </a>
  `;
}

// Combined Planned list (no dateFilter): same Scheduled / Not yet scheduled
// divider as the home page's "All Matches" tab. A dateFilter-scoped embed
// already shows one kind only, so it skips the divider entirely.
function buildListHtml(matches) {
  if (statusFilter !== 'PLANNED' || dateFilter) {
    return matches.map(matchCardHtml).join('');
  }
  const parts = [];
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

async function load() {
  try {
    const qs = new URLSearchParams();
    qs.set('status', statusFilter);
    if (dateFilter === 'has') qs.set('hasDate', '1');
    else if (dateFilter === 'none') qs.set('noDate', '1');
    const matches = await api(`/matches?${qs.toString()}`);
    const body = matches.length
      ? `<div class="match-list">${buildListHtml(matches)}</div>`
      : `<div class="empty-state" style="padding:24px">${emptyMessage()}</div>`;
    // Header always shows, even with zero matches, so an embedded "Live now"
    // widget doesn't just look blank/broken when nothing is live.
    listEl.innerHTML = `<div style="font-weight:800;margin-bottom:10px">${header()}</div>${body}`;
  } catch {
    listEl.innerHTML = `<div class="empty-state">Could not load matches.</div>`;
  }
}

const socket = io();
socket.on('matches:changed', load);
load();

const listEl = document.getElementById('live-list');

const VALID_STATUSES = ['PLANNED', 'LIVE', 'FINISHED'];
const params = new URLSearchParams(window.location.search);
const statusFilter = VALID_STATUSES.includes((params.get('status') || '').toUpperCase())
  ? params.get('status').toUpperCase()
  : 'LIVE';

const HEADERS = {
  PLANNED: '🗓 Planned matches',
  LIVE: '🔴 Live now',
  FINISHED: '✅ Finished matches',
};
const EMPTY_MESSAGES = {
  PLANNED: 'No planned matches right now.',
  LIVE: 'No live matches right now.',
  FINISHED: 'No finished matches yet.',
};

// Same card markup as the home page's match list, so an embedded widget
// looks identical to (and shows the same information as) the live site.
function matchCardHtml(m) {
  const winnerP1 = m.status === 'FINISHED' && m.winnerId === m.player1.id;
  const winnerP2 = m.status === 'FINISHED' && m.winnerId === m.player2.id;
  return `
    <a class="match-card status-${m.status}" href="${window.location.origin}/match/${m.token}" target="_blank" rel="noopener">
      <div class="match-card-top">
        ${categoryBadge(m.category)}
        ${statusBadge(m)}
        <div class="match-card-meta" style="margin-left:auto">
          ${m.location ? `<span>📍 ${escapeHtml(m.location)}</span>` : ''}
          <span>🗓 ${fmtDateShort(m.scheduledAt)}</span>
        </div>
      </div>
      <div class="match-players">
        <div>
          <div class="name ${winnerP1 ? 'winner' : ''}">${escapeHtml(m.player1.name)}</div>
          <div class="name ${winnerP2 ? 'winner' : ''}">${escapeHtml(m.player2.name)}</div>
        </div>
        <div class="match-score">${escapeHtml(matchResultText(m))}</div>
      </div>
    </a>
  `;
}

// Planned matches: same Scheduled / Not yet scheduled divider as the home
// page's "All Matches" tab (the API already returns dated matches first).
function buildListHtml(matches) {
  if (statusFilter !== 'PLANNED') {
    return matches.map(matchCardHtml).join('');
  }
  const parts = [];
  matches.forEach((m, i) => {
    const curScheduled = !!m.scheduledAt;
    if (i === 0) {
      parts.push(`<div class="match-list-heading">${curScheduled ? '📅 Scheduled' : '🕓 Not yet scheduled'}</div>`);
    } else if (matches[i - 1].scheduledAt && !curScheduled) {
      parts.push('<div class="match-list-heading">🕓 Not yet scheduled</div>');
    }
    parts.push(matchCardHtml(m));
  });
  return parts.join('');
}

async function load() {
  try {
    const matches = await api(`/matches?status=${statusFilter}`);
    listEl.innerHTML = matches.length
      ? `<div style="font-weight:800;margin-bottom:10px">${HEADERS[statusFilter]}</div><div class="match-list">${buildListHtml(matches)}</div>`
      : `<div class="empty-state" style="padding:24px">${EMPTY_MESSAGES[statusFilter]}</div>`;
  } catch {
    listEl.innerHTML = `<div class="empty-state">Could not load matches.</div>`;
  }
}

const socket = io();
socket.on('matches:changed', load);
load();

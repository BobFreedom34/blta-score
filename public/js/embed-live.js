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

function itemHtml(m) {
  const url = `${window.location.origin}/match/${m.token}`;
  const scoreOrFormat = m.status === 'PLANNED' ? m.formatLabel : (escapeHtml(m.scoreSummary) || 'starting…');
  return `
    <div class="embed-live-item">
      ${categoryBadge(m.category)}
      <a href="${url}" target="_blank" rel="noopener">
        <strong>${escapeHtml(m.player1.name)}</strong> vs <strong>${escapeHtml(m.player2.name)}</strong>
      </a>
      <span class="match-score">${scoreOrFormat}</span>
    </div>
  `;
}

async function load() {
  try {
    const matches = await api(`/matches?status=${statusFilter}`);
    listEl.innerHTML = matches.length
      ? `<div style="font-weight:800;margin-bottom:8px">${HEADERS[statusFilter]}</div>${matches.map(itemHtml).join('')}`
      : `<div class="empty-state" style="padding:24px">${EMPTY_MESSAGES[statusFilter]}</div>`;
  } catch {
    listEl.innerHTML = `<div class="empty-state">Could not load matches.</div>`;
  }
}

const socket = io();
socket.on('matches:changed', load);
load();

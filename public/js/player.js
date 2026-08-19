const playerId = window.location.pathname.split('/').filter(Boolean).pop();
const nameEl = document.getElementById('player-name');
const listEl = document.getElementById('player-match-list');

// Same card markup as the home page's match list, minus the quick-schedule/
// notify actions (this page is a read-only history view for one player).
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
      ${scoreboard || `
        <div class="match-players">
          <div>
            <div class="name ${winnerP1 ? 'winner' : ''}">${escapeHtml(m.player1.name)}</div>
            <div class="vs">vs</div>
            <div class="name ${winnerP2 ? 'winner' : ''}">${escapeHtml(m.player2.name)}</div>
          </div>
          <div class="match-score">${escapeHtml(matchResultText(m))}</div>
        </div>
      `}
      ${isOverdueUnresolved(m) ? '<div class="overdue-warning">⚠️ Overdue — no result recorded yet</div>' : ''}
    </a>
  `;
}

const GROUPS = [
  { heading: '🔴 Live', params: { status: 'LIVE' } },
  { heading: '📅 Scheduled', params: { status: 'PLANNED', hasDate: '1' } },
  { heading: '🕓 Not yet scheduled', params: { status: 'PLANNED', noDate: '1' } },
  { heading: '✅ Finished', params: { status: 'FINISHED' } },
];

async function load() {
  try {
    const results = await Promise.all(GROUPS.map((g) => {
      const qs = new URLSearchParams({ playerId, ...g.params });
      return api(`/matches?${qs.toString()}`);
    }));
    const parts = [];
    results.forEach((matches, i) => {
      if (!matches.length) return;
      parts.push(`<div class="match-list-heading">${GROUPS[i].heading}</div>`);
      parts.push(...matches.map(matchCardHtml));
    });
    listEl.innerHTML = parts.length ? parts.join('') : '<div class="empty-state">No matches yet.</div>';
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Could not load matches: ${escapeHtml(err.message)}</div>`;
  }
}

(async () => {
  try {
    const player = await api(`/players/${playerId}`);
    nameEl.textContent = player.name;
    document.title = `${player.name} — BLTA Score`;
  } catch {
    nameEl.textContent = 'Player not found';
    listEl.innerHTML = '';
    return;
  }
  load();
  const socket = io();
  socket.on('matches:changed', load);
})();

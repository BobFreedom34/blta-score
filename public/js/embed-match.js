const matchToken = window.location.pathname.split('/').filter(Boolean).pop();
const root = document.getElementById('embed-root');

function setCell(set, playerNum) {
  const gKey = playerNum === 1 ? 'p1' : 'p2';
  if (set.isSuperTiebreak) return `${set.tiebreak[gKey]}`;
  const main = set[gKey];
  const sub = set.tiebreak ? `<sup class="sub-tb">${set.tiebreak[gKey]}</sup>` : '';
  return `${main}${sub}`;
}

function render(m) {
  const state = m.state;
  const headerCells = state.sets.map((s, i) => `<th>${s.isSuperTiebreak ? 'MTB' : `S${i + 1}`}</th>`).join('');
  const row = (playerNum, player) => {
    const isWinner = m.status === 'FINISHED' && m.winnerId === player.id;
    const cells = state.sets.map((s, i) => {
      const isCurrent = m.status === 'LIVE' && i === state.currentSet;
      return `<td class="set-score ${isCurrent ? 'current' : ''}">${setCell(s, playerNum)}</td>`;
    }).join('');
    return `<tr class="${isWinner ? 'winner-row' : ''}"><td class="name-cell">${escapeHtml(player.name)}</td>${cells}</tr>`;
  };

  root.innerHTML = `
    <div style="margin-bottom:8px">${categoryBadge(m.category)} ${statusBadge(m.status)}</div>
    <div class="scoreboard">
      <table>
        <thead><tr><th></th>${headerCells}</tr></thead>
        <tbody>${row(1, m.player1)}${row(2, m.player2)}</tbody>
      </table>
    </div>
    <div style="margin-top:8px;font-size:11px;color:var(--gray)">
      ${m.location ? `📍 ${escapeHtml(m.location)} · ` : ''}${fmtDateShort(m.scheduledAt)}
      · <a href="${window.location.origin}/match/${m.token}" target="_blank" rel="noopener" style="text-decoration:underline">Full match ↗</a>
    </div>
  `;
}

async function init() {
  try {
    render(await api(`/matches/${matchToken}`));
  } catch (err) {
    root.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
    return;
  }
  const socket = io();
  socket.emit('join', `match:${matchToken}`);
  socket.on('match:update', (m) => { if (m.token === matchToken) render(m); });
}
init();

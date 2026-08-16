let currentStatus = 'LIVE';
let currentQuery = '';
let currentCategory = '';
let debounceTimer = null;

const listEl = document.getElementById('match-list');

function matchCardHtml(m) {
  const winnerP1 = m.status === 'FINISHED' && m.winnerId === m.player1.id;
  const winnerP2 = m.status === 'FINISHED' && m.winnerId === m.player2.id;
  return `
    <a class="match-card status-${m.status}" href="/match/${m.token}">
      <div class="match-card-top">
        ${categoryBadge(m.category)}
        ${statusBadge(m.status)}
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
        <div class="match-score">${m.status === 'PLANNED' ? m.formatLabel : (escapeHtml(m.scoreSummary) || '—')}</div>
      </div>
    </a>
  `;
}

async function loadMatches() {
  const params = new URLSearchParams();
  params.set('status', currentStatus);
  if (currentQuery) params.set('q', currentQuery);
  if (currentCategory) params.set('category', currentCategory);

  try {
    const matches = await api(`/matches?${params.toString()}`);
    if (matches.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No ${STATUS_LABELS[currentStatus].toLowerCase()} matches${currentQuery || currentCategory ? ' match your filters' : ''}.</div>`;
    } else {
      listEl.innerHTML = matches.map(matchCardHtml).join('');
    }
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Could not load matches: ${escapeHtml(err.message)}</div>`;
  }
}

async function refreshCounts() {
  for (const status of ['LIVE', 'PLANNED', 'FINISHED']) {
    try {
      const matches = await api(`/matches?status=${status}`);
      document.getElementById(`count-${status}`).textContent = matches.length;
    } catch { /* ignore */ }
  }
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    currentStatus = tab.dataset.status;
    loadMatches();
  });
});
document.querySelector(`.tab[data-status="${currentStatus}"]`).classList.add('active');

document.getElementById('filter-q').addEventListener('input', (e) => {
  currentQuery = e.target.value.trim();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadMatches, 250);
});
document.getElementById('filter-category').addEventListener('change', (e) => {
  currentCategory = e.target.value;
  loadMatches();
});

const socket = io();
socket.on('matches:changed', () => {
  loadMatches();
  refreshCounts();
});

loadMatches();
refreshCounts();

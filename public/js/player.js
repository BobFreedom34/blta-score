const playerId = window.location.pathname.split('/').filter(Boolean).pop();
const nameEl = document.getElementById('player-name');
const listEl = document.getElementById('player-match-list');
const resultFilterEl = document.getElementById('result-filter');
const yearFilterEl = document.getElementById('year-filter');

let currentResult = '';
let currentYear = '';
let rawGroups = []; // last-fetched matches per GROUPS entry, unfiltered

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
        <div class="match-players-box">
          <div class="match-players">
            <div>
              <div class="name ${winnerP1 ? 'winner' : ''}">${escapeHtml(m.player1.name)}</div>
              <div class="vs">vs</div>
              <div class="name ${winnerP2 ? 'winner' : ''}">${escapeHtml(m.player2.name)}</div>
            </div>
            <div class="match-score">${escapeHtml(matchResultText(m))}</div>
          </div>
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

function matchYear(m) {
  return m.scheduledAt ? new Date(m.scheduledAt).getFullYear() : null;
}

// Won/Lost only ever matches a finished match with a decided winner, so
// picking either one naturally empties (and hides) the Live/Scheduled/Not
// yet scheduled groups without any special-casing here.
function passesFilters(m) {
  if (currentResult === 'won' && m.winnerId !== Number(playerId)) return false;
  if (currentResult === 'lost' && (!m.winnerId || m.winnerId === Number(playerId))) return false;
  if (currentYear && String(matchYear(m)) !== currentYear) return false;
  return true;
}

function populateYearOptions() {
  const years = [...new Set(rawGroups.flat().filter((m) => m.scheduledAt).map(matchYear))].sort((a, b) => b - a);
  const keep = yearFilterEl.value;
  yearFilterEl.innerHTML = '<option value="">All years</option>' + years.map((y) => `<option value="${y}">${y}</option>`).join('');
  yearFilterEl.value = years.some((y) => String(y) === keep) ? keep : '';
  currentYear = yearFilterEl.value;
}

function render() {
  const parts = [];
  rawGroups.forEach((matches, i) => {
    const filtered = matches.filter(passesFilters);
    if (!filtered.length) return;
    parts.push(`<div class="match-list-heading">${GROUPS[i].heading}</div>`);
    parts.push(...filtered.map(matchCardHtml));
  });
  listEl.innerHTML = parts.length ? parts.join('') : '<div class="empty-state">No matches match your filters.</div>';
}

async function load() {
  try {
    rawGroups = await Promise.all(GROUPS.map((g) => {
      const qs = new URLSearchParams({ playerId, ...g.params });
      return api(`/matches?${qs.toString()}`);
    }));
    populateYearOptions();
    render();
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Could not load matches: ${escapeHtml(err.message)}</div>`;
  }
}

resultFilterEl.addEventListener('change', (e) => {
  currentResult = e.target.value;
  render();
});
yearFilterEl.addEventListener('change', (e) => {
  currentYear = e.target.value;
  render();
});
document.getElementById('reset-filters-btn').addEventListener('click', () => {
  currentResult = '';
  currentYear = '';
  resultFilterEl.value = '';
  yearFilterEl.value = '';
  render();
});

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

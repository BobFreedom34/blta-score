const playerId = window.location.pathname.split('/').filter(Boolean).pop();
const nameEl = document.getElementById('player-name');
const listEl = document.getElementById('player-match-list');
const resultFilterEl = document.getElementById('result-filter');
const yearFilterEl = document.getElementById('year-filter');

let currentResult = '';
let currentYear = '';
let rawGroups = []; // last-fetched matches per GROUPS entry, unfiltered
let h2hExpanded = false;
const H2H_COLLAPSED_LIMIT = 5;

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
              <div class="name ${winnerP1 ? 'winner' : ''}">${escapeHtml(m.player1.name)}${playerInfoBtn(m.player1)}</div>
              <div class="vs">vs</div>
              <div class="name ${winnerP2 ? 'winner' : ''}">${escapeHtml(m.player2.name)}${playerInfoBtn(m.player2)}</div>
            </div>
            <div class="match-score">${matchScoreHtml(m)}</div>
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
  { heading: '🕓 Planned', params: { status: 'PLANNED', noDate: '1' } },
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

// Career record, always computed from the full finished-match history —
// independent of the result/year filters below, which only narrow the list.
function renderStats() {
  const finished = rawGroups[3] || [];
  let wins = 0;
  let losses = 0;
  finished.forEach((m) => {
    if (m.winnerId === Number(playerId)) wins += 1;
    else if (m.winnerId) losses += 1;
  });
  const played = wins + losses;
  document.getElementById('stat-played').textContent = played;
  document.getElementById('stat-wl').textContent = `${wins} — ${losses}`;
  document.getElementById('stat-pct').textContent = played ? `${Math.round((wins / played) * 100)}%` : '—';
}

// Per-opponent win/loss record, built from the same full finished-match
// history as renderStats() — also independent of the result/year filters.
function opponentRecords() {
  const finished = rawGroups[3] || [];
  const byOpponent = new Map();
  finished.forEach((m) => {
    if (!m.winnerId) return;
    const opponent = m.player1.id === Number(playerId) ? m.player2 : m.player1;
    const rec = byOpponent.get(opponent.id) || { opponent, wins: 0, losses: 0 };
    if (m.winnerId === Number(playerId)) rec.wins += 1;
    else rec.losses += 1;
    byOpponent.set(opponent.id, rec);
  });
  return [...byOpponent.values()].sort((a, b) => {
    const byTotal = (b.wins + b.losses) - (a.wins + a.losses);
    return byTotal !== 0 ? byTotal : a.opponent.name.localeCompare(b.opponent.name);
  });
}

function h2hRowHtml(rec) {
  const total = rec.wins + rec.losses;
  const winPct = Math.round((rec.wins / total) * 100);
  const scoreColor = rec.wins > rec.losses ? 'var(--green)' : rec.wins < rec.losses ? 'var(--danger)' : 'var(--gray)';
  return `
    <div class="h2h-row">
      <a class="h2h-name" href="/player/${rec.opponent.id}">${escapeHtml(rec.opponent.name)}</a>
      <div class="h2h-record">
        <div class="h2h-bar">
          <div style="width:${winPct}%;background:var(--green)"></div><div style="width:${100 - winPct}%;background:var(--danger)"></div>
        </div>
        <span class="h2h-score" style="color:${scoreColor}">${rec.wins} — ${rec.losses}</span>
      </div>
    </div>
  `;
}

function renderH2H() {
  const el = document.getElementById('h2h-section');
  const records = opponentRecords();
  if (!records.length) {
    el.innerHTML = '';
    return;
  }
  const remaining = records.length - H2H_COLLAPSED_LIMIT;
  const visible = h2hExpanded || remaining <= 0 ? records : records.slice(0, H2H_COLLAPSED_LIMIT);
  const toggleHtml = remaining > 0
    ? `<button type="button" class="h2h-toggle" id="h2h-toggle">${h2hExpanded ? 'Show less' : `Show all (${remaining} more)`}</button>`
    : '';
  el.innerHTML = `
    <div class="h2h-title">Head-to-head</div>
    <div class="h2h-card">${visible.map(h2hRowHtml).join('')}</div>
    ${toggleHtml}
  `;
  if (remaining > 0) {
    document.getElementById('h2h-toggle').addEventListener('click', () => {
      h2hExpanded = !h2hExpanded;
      renderH2H();
    });
  }
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
    renderStats();
    renderH2H();
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

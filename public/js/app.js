let currentStatus = 'PLANNED';
let currentQuery = '';
let currentCategory = '';
let currentTimeFilter = '';
let debounceTimer = null;

const listEl = document.getElementById('match-list');

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

function matchCardHtml(m) {
  const winnerP1 = m.status === 'FINISHED' && m.winnerId === m.player1.id;
  const winnerP2 = m.status === 'FINISHED' && m.winnerId === m.player2.id;
  return `
    <a class="match-card status-${m.status}" href="/match/${m.token}">
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
      ${m.status === 'PLANNED' && !m.scheduledAt ? `<button type="button" class="btn btn-sm btn-outline quick-schedule-btn" data-token="${m.token}" style="margin-top:10px">📅 Set date &amp; location</button>` : ''}
    </a>
  `;
}

// For the Planned tab the API already returns dated matches (soonest first),
// then undated ones — head each section, and insert a new heading right
// where that switch happens.
function buildMatchListHtml(matches) {
  if (currentStatus !== 'PLANNED') {
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

async function loadMatches() {
  const params = new URLSearchParams();
  params.set('status', currentStatus);
  if (currentQuery) params.set('q', currentQuery);
  if (currentCategory) params.set('category', currentCategory);
  if (currentTimeFilter === 'this_week') {
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

  try {
    const matches = await api(`/matches?${params.toString()}`);
    if (matches.length === 0) {
      const hasFilters = currentQuery || currentCategory || currentTimeFilter;
      listEl.innerHTML = `<div class="empty-state">No ${STATUS_LABELS[currentStatus].toLowerCase()} matches${hasFilters ? ' match your filters' : ''}.</div>`;
    } else {
      listEl.innerHTML = buildMatchListHtml(matches);
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
document.getElementById('filter-time').addEventListener('change', (e) => {
  currentTimeFilter = e.target.value;
  loadMatches();
});

document.getElementById('embed-list-btn').addEventListener('click', () => {
  const src = `${window.location.origin}/embed/live?status=${currentStatus}`;
  const code = `<iframe src="${src}" width="100%" height="600" frameborder="0" style="border:0;max-width:480px"></iframe>`;
  document.getElementById('embed-modal-desc').textContent =
    `Paste this into a "Custom HTML" block on your blta.sk page to show the ${STATUS_LABELS[currentStatus].toLowerCase()} matches list:`;
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

listEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.quick-schedule-btn');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  openQuickScheduleModal(btn.dataset.token);
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

const socket = io();
socket.on('matches:changed', () => {
  loadMatches();
  refreshCounts();
});

loadMatches();
refreshCounts();

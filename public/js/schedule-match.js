setupFormatOptions('format-options');

loadPlayers();
setupAutocomplete('player1', 'player1-suggestions');
setupAutocomplete('player2', 'player2-suggestions');
const getBallsPlayer = setupBallsPicker();

// Preferred venues — add/remove chips, sent as proposalVenues on submit.
const proposalVenuesList = [];
function renderVenueChips() {
  const list = document.getElementById('venue-chip-list');
  list.innerHTML = proposalVenuesList.map((v, i) => `
    <span class="venue-chip">${escapeHtml(v)}<button type="button" class="venue-chip-remove" data-i="${i}" aria-label="Remove venue">&times;</button></span>
  `).join('');
  list.querySelectorAll('.venue-chip-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      proposalVenuesList.splice(Number(btn.dataset.i), 1);
      renderVenueChips();
    });
  });
}
function addVenue() {
  const input = document.getElementById('venue-input');
  const val = input.value.trim();
  if (!val || proposalVenuesList.length >= 10) return;
  if (proposalVenuesList.some((v) => v.toLowerCase() === val.toLowerCase())) { input.value = ''; return; }
  proposalVenuesList.push(val);
  input.value = '';
  renderVenueChips();
}
document.getElementById('venue-add-btn').addEventListener('click', addVenue);
document.getElementById('venue-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addVenue(); }
});

// When2Meet-style availability grid over the next two weeks, paged one week
// at a time so it always fills the screen width without horizontal scroll —
// that matters on touch, where drag-select and page-scroll would otherwise
// fight over the same gesture. Sent as proposalSlots on submit; the other
// player later picks one via the match's share link (POST /:token/respond-proposal),
// no login needed on their side.
const PROPOSAL_START_HOUR = 7;
const PROPOSAL_END_HOUR = 22; // exclusive — last slot starts at 21:00
const proposalDays = []; // 14 Date objects (local midnight), tomorrow..+14 days
{
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 1; i <= 14; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    proposalDays.push(d);
  }
}
const selectedSlots = new Set(); // ISO datetime strings, on the hour
let activeWeek = 0;

function slotIso(day, hour) {
  const d = new Date(day);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function updateSlotCount() {
  document.getElementById('slot-count').textContent = selectedSlots.size ? `— ${selectedSlots.size} selected` : '';
}

function renderWeekTabs() {
  const fmt = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const label = (days) => `${fmt(days[0])} – ${fmt(days[days.length - 1])}`;
  const weeks = [proposalDays.slice(0, 7), proposalDays.slice(7, 14)];
  document.getElementById('week-tabs').innerHTML = weeks.map((days, i) => `
    <button type="button" class="tab${i === activeWeek ? ' active' : ''}" data-week="${i}">Week ${i + 1}<span>${label(days)}</span></button>
  `).join('');
  document.querySelectorAll('#week-tabs .tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeWeek = Number(btn.dataset.week);
      renderWeekTabs();
      renderAvailabilityGrid();
    });
  });
}

function renderAvailabilityGrid() {
  const days = proposalDays.slice(activeWeek * 7, activeWeek * 7 + 7);
  const dayHead = (d) => `${d.toLocaleDateString(undefined, { weekday: 'short' })}<br>${d.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' })}`;

  let html = '<div class="availability-grid"><div class="avail-corner"></div>';
  for (const d of days) html += `<div class="avail-day-head">${dayHead(d)}</div>`;
  for (let h = PROPOSAL_START_HOUR; h < PROPOSAL_END_HOUR; h++) {
    html += `<div class="avail-time-label">${String(h).padStart(2, '0')}:00</div>`;
    for (const d of days) {
      const iso = slotIso(d, h);
      html += `<div class="avail-cell${selectedSlots.has(iso) ? ' selected' : ''}" data-iso="${iso}"></div>`;
    }
  }
  html += '</div>';
  document.getElementById('availability-grid-wrap').innerHTML = html;
}

function setupGridDragSelect(wrap) {
  let dragging = false;
  let paintValue = true;
  let lastCell = null;

  function paint(cell) {
    if (!cell || cell === lastCell) return;
    lastCell = cell;
    if (paintValue) { selectedSlots.add(cell.dataset.iso); cell.classList.add('selected'); }
    else { selectedSlots.delete(cell.dataset.iso); cell.classList.remove('selected'); }
    updateSlotCount();
  }

  wrap.addEventListener('mousedown', (e) => {
    const cell = e.target.closest('.avail-cell');
    if (!cell) return;
    e.preventDefault();
    dragging = true;
    lastCell = null;
    paintValue = !cell.classList.contains('selected');
    paint(cell);
  });
  wrap.addEventListener('mouseover', (e) => {
    if (!dragging) return;
    paint(e.target.closest('.avail-cell'));
  });
  document.addEventListener('mouseup', () => { dragging = false; lastCell = null; });

  wrap.addEventListener('touchstart', (e) => {
    const cell = e.target.closest('.avail-cell');
    if (!cell) return;
    dragging = true;
    lastCell = null;
    paintValue = !cell.classList.contains('selected');
    paint(cell);
  }, { passive: true });
  wrap.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const cell = el && el.classList.contains('avail-cell') ? el : null;
    if (cell) { e.preventDefault(); paint(cell); }
  }, { passive: false });
  document.addEventListener('touchend', () => { dragging = false; lastCell = null; });
}

renderWeekTabs();
renderAvailabilityGrid();
setupGridDragSelect(document.getElementById('availability-grid-wrap'));
updateSlotCount();

document.getElementById('clear-slots-btn').addEventListener('click', () => {
  selectedSlots.clear();
  renderAvailabilityGrid();
  updateSlotCount();
});

// ---------- "Waiting for a response" list ----------
// Every currently-unconfirmed proposal, league-wide — same visibility model
// as the main Matches list (anyone can see it), just filtered down to
// PLANNED + no date yet + actually a proposal (not just an old-style
// "planned, date TBD" match, which has no proposalSlots at all).
function proposalCardHtml(m) {
  const n = m.proposalSlots.length;
  return `
    <a class="match-card status-PLANNED" href="/match/${m.token}">
      <div class="match-card-top">
        ${categoryBadge(m.category)}
        <span class="badge badge-status">Awaiting response</span>
        <div class="match-card-meta" style="margin-left:auto">🗓 ${n} time${n === 1 ? '' : 's'} proposed</div>
      </div>
      <div class="match-players-box">
        <div class="match-players">
          <div>
            <div class="name">${playerNameLink(m.player1)}${ballsIconHtml(m, 1)}${playerInfoBtn(m.player1)}</div>
            <div class="vs">vs</div>
            <div class="name">${playerNameLink(m.player2)}${ballsIconHtml(m, 2)}${playerInfoBtn(m.player2)}</div>
          </div>
        </div>
      </div>
      ${(m.proposalVenues && m.proposalVenues.length) ? `<div class="match-card-meta">📍 ${m.proposalVenues.map(escapeHtml).join(' · ')}</div>` : ''}
    </a>
  `;
}

async function loadProposals() {
  const listEl = document.getElementById('proposal-list');
  try {
    const matches = await api('/matches?status=PLANNED&noDate=1');
    const awaiting = matches.filter((m) => m.proposalSlots);
    listEl.innerHTML = awaiting.length
      ? awaiting.map(proposalCardHtml).join('')
      : '<div class="empty-state">No matches are currently awaiting a response.</div>';
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Could not load proposed matches: ${escapeHtml(err.message)}</div>`;
  }
}
loadProposals();

document.getElementById('schedule-match-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('form-error');
  errorEl.textContent = '';

  const player1Name = document.getElementById('player1').value.trim();
  const player2Name = document.getElementById('player2').value.trim();
  const category = document.getElementById('category').value;
  const notes = document.getElementById('notes').value.trim();
  const format = document.querySelector('input[name="format"]:checked').value;

  if (!player1Name || !player2Name) {
    errorEl.textContent = 'Please enter both player names.';
    return;
  }
  if (player1Name.toLowerCase() === player2Name.toLowerCase()) {
    errorEl.textContent = 'Player 1 and Player 2 must be different.';
    return;
  }
  if (selectedSlots.size === 0) {
    errorEl.textContent = 'Mark at least one time you can play.';
    return;
  }
  if (proposalVenuesList.length === 0) {
    errorEl.textContent = 'Add at least one preferred venue.';
    return;
  }
  const notifyEmail = document.getElementById('notify-email').value.trim();
  if (notifyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail)) {
    errorEl.textContent = 'Enter a valid confirmation email address, or leave it blank.';
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');

  requirePlayerAuth(async () => {
    submitBtn.disabled = true;
    try {
      const match = await api('/matches', {
        method: 'POST',
        body: {
          player1Name,
          player2Name,
          category,
          format,
          notes,
          ballsPlayer: getBallsPlayer(),
          proposalSlots: Array.from(selectedSlots),
          proposalVenues: proposalVenuesList,
          proposalNotifyEmail: notifyEmail || undefined,
        },
      });
      window.location.href = `/match/${match.token}`;
    } catch (err) {
      errorEl.textContent = err.message;
      submitBtn.disabled = false;
    }
  });
});

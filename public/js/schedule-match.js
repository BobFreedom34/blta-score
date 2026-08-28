setupFormatOptions('format-options');

loadPlayers();
setupAutocomplete('player1', 'player1-suggestions');
setupAutocomplete('player2', 'player2-suggestions');
const getBallsPlayer = setupBallsPicker();
const getProposedBy = setupProposerPicker();

const venuePicker = createVenueChipPicker({ listId: 'venue-chip-list', inputId: 'venue-input', addBtnId: 'venue-add-btn' });
const availabilityPicker = createAvailabilityPicker({ weekTabsId: 'week-tabs', gridWrapId: 'availability-grid-wrap', slotCountId: 'slot-count' });

document.getElementById('clear-slots-btn').addEventListener('click', () => availabilityPicker.clear());

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
  if (availabilityPicker.selectedSlots.size === 0) {
    errorEl.textContent = 'Mark at least one time you can play.';
    return;
  }
  if (venuePicker.venues.length === 0) {
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
          proposalSlots: Array.from(availabilityPicker.selectedSlots),
          proposalVenues: venuePicker.venues,
          proposedBy: getProposedBy(),
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

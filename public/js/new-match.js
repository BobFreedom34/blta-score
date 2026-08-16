const FORMATS = [
  { key: 'BO1', label: 'Best of 1 set', hint: 'Single set, first to 6 games (win by 2), tiebreak at 6-6.' },
  { key: 'BO3', label: 'Best of 3 sets', hint: 'Standard match. Tiebreak at 6-6 in every set.' },
  { key: 'BO3_STB', label: 'Best of 3 sets — deciding set is a match tiebreak', hint: 'If 1-1 in sets, the 3rd set is replaced by a single tiebreak to 10 points.' },
  { key: 'BO5', label: 'Best of 5 sets', hint: 'Tiebreak at 6-6 in every set.' },
  { key: 'BO5_STB', label: 'Best of 5 sets — deciding set is a match tiebreak', hint: 'If 2-2 in sets, the 5th set is replaced by a single tiebreak to 10 points.' },
];

const formatContainer = document.getElementById('format-options');
formatContainer.innerHTML = FORMATS.map((f, i) => `
  <label class="format-option">
    <input type="radio" name="format" value="${f.key}" ${i === 1 ? 'checked' : ''}>
    <span>
      <div style="font-weight:700">${f.label}</div>
      <div style="font-size:12px;color:var(--gray)">${f.hint}</div>
    </span>
  </label>
`).join('');

async function loadPlayersDatalist() {
  try {
    const players = await api('/players');
    document.getElementById('players-datalist').innerHTML =
      players.map((p) => `<option value="${escapeHtml(p.name)}">`).join('');
  } catch { /* ignore, autocomplete just won't populate */ }
}
loadPlayersDatalist();

document.getElementById('new-match-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('form-error');
  errorEl.textContent = '';

  const player1Name = document.getElementById('player1').value.trim();
  const player2Name = document.getElementById('player2').value.trim();
  const category = document.getElementById('category').value;
  const location = document.getElementById('location').value.trim();
  const scheduledAtRaw = document.getElementById('scheduledAt').value;
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

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const match = await api('/matches', {
      method: 'POST',
      body: {
        player1Name,
        player2Name,
        category,
        location,
        scheduledAt: scheduledAtRaw ? new Date(scheduledAtRaw).toISOString() : null,
        format,
        notes,
      },
    });
    window.location.href = `/match/${match.token}`;
  } catch (err) {
    errorEl.textContent = err.message;
    submitBtn.disabled = false;
  }
});

setupFormatOptions('format-options');

loadPlayers();
setupAutocomplete('player1', 'player1-suggestions');
setupAutocomplete('player2', 'player2-suggestions');
const getBallsPlayer = setupBallsPicker();

document.getElementById('new-match-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('form-error');
  errorEl.textContent = '';

  const player1Name = document.getElementById('player1').value.trim();
  const player2Name = document.getElementById('player2').value.trim();
  const category = document.getElementById('category').value;
  const location = document.getElementById('location').value.trim();
  const scheduledAtDate = document.getElementById('scheduledAtDate').value;
  const scheduledAtTime = document.getElementById('scheduledAtTime').value;
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

  requirePlayerAuth(async () => {
    submitBtn.disabled = true;
    try {
      const match = await api('/matches', {
        method: 'POST',
        body: {
          player1Name,
          player2Name,
          category,
          location,
          scheduledAt: scheduledAtDate ? new Date(`${scheduledAtDate}T${scheduledAtTime || '00:00'}`).toISOString() : null,
          format,
          notes,
          ballsPlayer: getBallsPlayer(),
        },
      });
      window.location.href = `/match/${match.token}`;
    } catch (err) {
      errorEl.textContent = err.message;
      submitBtn.disabled = false;
    }
  });
});

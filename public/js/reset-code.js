// Landing page for the link emailed by POST /player/forgot-pin (see
// openPlayerLoginModal's "Forgot your code?" flow in common.js) — reached
// with no existing session, so this can't reuse the login modal's own
// step machinery; it's its own small page instead.
const params = new URLSearchParams(window.location.search);
const resetToken = params.get('token') || '';

const formCard = document.getElementById('reset-code-form-card');
const successCard = document.getElementById('reset-code-success-card');
const invalidCard = document.getElementById('reset-code-invalid-card');

if (!resetToken) {
  formCard.style.display = 'none';
  invalidCard.style.display = '';
} else {
  const form = document.getElementById('reset-code-form');
  const input = document.getElementById('reset-code-input');
  const confirmInput = document.getElementById('reset-code-confirm-input');
  const errorEl = document.getElementById('reset-code-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = input.value.trim();
    const confirmPin = confirmInput.value.trim();
    if (!pin || !confirmPin) return;
    errorEl.textContent = '';
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const res = await api('/player/reset-pin', { method: 'POST', body: { token: resetToken, pin, confirmPin } });
      // Same session globals openPlayerLoginModal's applySession sets —
      // the server has already logged this player in, so the rest of the
      // site should immediately reflect that once they navigate there.
      playerAuthed = !!res.isPlayer;
      currentPlayerName = res.playerName || null;
      currentPlayerId = res.playerId || null;
      updatePlayerNavLinks();
      window.dispatchEvent(new Event('blta:auth-changed'));

      document.getElementById('reset-code-success-text').textContent = currentPlayerName
        ? t('login.successNamed', { name: currentPlayerName })
        : t('login.successGeneric');
      formCard.style.display = 'none';
      successCard.style.display = '';
    } catch (err) {
      errorEl.textContent = loginErrorText(err);
    }
    submitBtn.disabled = false;
  });
}

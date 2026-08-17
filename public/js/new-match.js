const FORMATS = [
  { key: 'BO3', label: 'Best of 3 sets', sublabel: '(BLTA Play-Off)', hint: 'Standard match. Tiebreak at 6-6 in every set.' },
  { key: 'BO3_STB', label: 'Best of 3 sets — deciding set is a match tiebreak', sublabel: '(BLTA League)', hint: 'If 1-1 in sets, the 3rd set is replaced by a single tiebreak to 10 points.' },
  { key: 'BO5', label: 'Best of 5 sets', hint: 'Tiebreak at 6-6 in every set.' },
  { key: 'BO5_STB', label: 'Best of 5 sets — deciding set is a match tiebreak', hint: 'If 2-2 in sets, the 5th set is replaced by a single tiebreak to 10 points.' },
  { key: 'BO1', label: 'Best of 1 set', hint: 'Single set, first to 6 games (win by 2), tiebreak at 6-6.' },
];

const formatContainer = document.getElementById('format-options');
formatContainer.innerHTML = FORMATS.map((f, i) => `
  <label class="format-option">
    <input type="radio" name="format" value="${f.key}" ${i === 0 ? 'checked' : ''}>
    <span>
      <div style="font-weight:700">${f.label}${f.sublabel ? ` <span style="font-weight:400;color:var(--gray);font-size:12px">${f.sublabel}</span>` : ''}</div>
      <div style="font-size:12px;color:var(--gray)">${f.hint}</div>
    </span>
  </label>
`).join('');

let allPlayers = [];
async function loadPlayers() {
  try { allPlayers = await api('/players'); } catch { allPlayers = []; }
}
loadPlayers();

// Custom autocomplete instead of a native <datalist>, which mobile Safari in
// particular renders inconsistently (often not showing suggestions at all).
function setupAutocomplete(inputId, listId) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  let activeIndex = -1;

  function currentMatches() {
    const q = input.value.trim().toLowerCase();
    if (!q) return [];
    return allPlayers.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
  }

  function render() {
    const matches = currentMatches();
    list.innerHTML = matches.map((p, i) => `
      <div class="autocomplete-item${i === activeIndex ? ' active' : ''}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
    `).join('');
    list.classList.toggle('open', matches.length > 0);
  }

  input.addEventListener('input', () => { activeIndex = -1; render(); });
  input.addEventListener('focus', render);
  input.addEventListener('keydown', (e) => {
    const items = list.querySelectorAll('.autocomplete-item');
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      render();
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      input.value = items[activeIndex].dataset.name;
      list.classList.remove('open');
      activeIndex = -1;
    } else if (e.key === 'Escape') {
      list.classList.remove('open');
      activeIndex = -1;
    }
  });
  list.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.autocomplete-item');
    if (!item) return;
    e.preventDefault(); // keep focus on input so blur doesn't close the list first
    input.value = item.dataset.name;
    list.classList.remove('open');
    activeIndex = -1;
  });
  input.addEventListener('blur', () => {
    setTimeout(() => list.classList.remove('open'), 100);
  });
}
setupAutocomplete('player1', 'player1-suggestions');
setupAutocomplete('player2', 'player2-suggestions');

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
        },
      });
      window.location.href = `/match/${match.token}`;
    } catch (err) {
      errorEl.textContent = err.message;
      submitBtn.disabled = false;
    }
  });
});

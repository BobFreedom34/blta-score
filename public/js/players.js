const listEl = document.getElementById('player-list');
let query = '';

async function loadPlayers() {
  const params = query ? `?q=${encodeURIComponent(query)}` : '';
  try {
    const players = await api(`/players${params}`);
    if (players.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No players yet. Add the first one above.</div>`;
      return;
    }
    listEl.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px">${players.map((p) => (
      `<span class="badge" style="background:var(--gray-light);color:var(--ink);font-size:13px;padding:8px 14px">${escapeHtml(p.name)}</span>`
    )).join('')}</div>`;
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Could not load players: ${escapeHtml(err.message)}</div>`;
  }
}

document.getElementById('add-player-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('new-player-name');
  const name = input.value.trim();
  if (!name) return;
  try {
    await api('/players', { method: 'POST', body: { name } });
    input.value = '';
    toast(`Added ${name}`);
    loadPlayers();
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById('filter-q').addEventListener('input', (e) => {
  query = e.target.value.trim();
  loadPlayers();
});

loadPlayers();

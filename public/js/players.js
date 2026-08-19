const listEl = document.getElementById('player-list');
let query = '';
let players = [];
let isAdminUser = false;

function playerRowHtml(p) {
  const actions = isAdminUser ? `
      <div class="player-row-actions">
        <button type="button" class="btn btn-sm btn-outline" data-action="edit">Edit</button>
        <button type="button" class="btn btn-sm btn-danger" data-action="delete">Delete</button>
      </div>
  ` : '';
  return `
    <div class="player-row" data-id="${p.id}">
      <a class="player-name" href="/player/${p.id}">${escapeHtml(p.name)}</a>
      ${actions}
    </div>
  `;
}

function render() {
  if (players.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No players ${query ? 'match your search' : 'yet. Add the first one above'}.</div>`;
    return;
  }
  listEl.innerHTML = players.map(playerRowHtml).join('');
  if (isAdminUser) attachRowHandlers();
}

async function loadPlayers() {
  const params = query ? `?q=${encodeURIComponent(query)}` : '';
  try {
    players = await api(`/players${params}`);
    render();
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Could not load players: ${escapeHtml(err.message)}</div>`;
  }
}

function attachRowHandlers() {
  listEl.querySelectorAll('.player-row').forEach((row) => {
    const id = row.dataset.id;
    const player = players.find((p) => String(p.id) === id);

    row.querySelector('[data-action="edit"]').addEventListener('click', () => {
      row.innerHTML = `
        <input type="text" class="edit-name-input" value="${escapeHtml(player.name)}" maxlength="60">
        <div class="player-row-actions">
          <button type="button" class="btn btn-sm btn-primary" data-action="save">Save</button>
          <button type="button" class="btn btn-sm btn-outline" data-action="cancel">Cancel</button>
        </div>
      `;
      const input = row.querySelector('.edit-name-input');
      input.focus();
      input.select();

      row.querySelector('[data-action="cancel"]').addEventListener('click', render);
      const save = async () => {
        const name = input.value.trim();
        if (!name) return toast('Name is required');
        try {
          await api(`/players/${id}`, { method: 'PATCH', body: { name } });
          toast('Player renamed');
          loadPlayers();
        } catch (err) {
          toast(err.message);
        }
      };
      row.querySelector('[data-action="save"]').addEventListener('click', save);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') render();
      });
    });

    row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm(`Delete ${player.name}? This can't be undone.`)) return;
      try {
        await api(`/players/${id}`, { method: 'DELETE' });
        toast(`Deleted ${player.name}`);
        loadPlayers();
      } catch (err) {
        toast(err.message);
      }
    });
  });
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

(async () => {
  isAdminUser = await checkAdmin();
  document.getElementById('add-player-card').style.display = isAdminUser ? '' : 'none';
  document.getElementById('admin-required-card').style.display = isAdminUser ? 'none' : '';
  loadPlayers();
})();

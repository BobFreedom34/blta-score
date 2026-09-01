const listEl = document.getElementById('player-list');
let query = '';
let players = [];
let isAdminUser = false;

// Phone and email are admin-only here (phone doubles as a player's login
// credential — see auth.js; email is where a login-code reset link and
// the new-registration notice go) and only ever present in the API
// response at all when the viewer is admin, so this display/edit UI only
// shows up for them too.
function playerRowHtml(p) {
  const phone = isAdminUser
    ? `<span class="player-phone">${p.phone ? escapeHtml(p.phone) : `<span class="player-phone-missing">${t('players.noPhoneOnFile')}</span>`}</span>`
    : '';
  const email = isAdminUser
    ? `<span class="player-email">${p.email ? escapeHtml(p.email) : `<span class="player-email-missing">${t('players.noEmailOnFile')}</span>`}</span>`
    : '';
  const actions = isAdminUser ? `
      <div class="player-row-actions">
        <button type="button" class="btn btn-sm btn-outline" data-action="edit">${t('common.edit')}</button>
        <button type="button" class="btn btn-sm btn-danger" data-action="delete">${t('common.delete')}</button>
      </div>
  ` : '';
  return `
    <div class="player-row" data-id="${p.id}">
      <a class="player-name" href="/player/${p.slug || p.id}">${escapeHtml(p.name)}</a>
      ${phone}
      ${email}
      ${actions}
    </div>
  `;
}

// Last whitespace-separated word of a full name — used to alphabetize by
// surname instead of by however the name happens to be entered.
function surname(name) {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1];
}

function render() {
  if (players.length === 0) {
    listEl.innerHTML = `<div class="empty-state">${t(query ? 'players.noneSearch' : 'players.noneYet')}</div>`;
    return;
  }
  const sorted = [...players].sort((a, b) => {
    const bySurname = surname(a.name).localeCompare(surname(b.name));
    return bySurname !== 0 ? bySurname : a.name.localeCompare(b.name);
  });
  const parts = [];
  let currentLetter = null;
  sorted.forEach((p) => {
    const letter = surname(p.name).charAt(0).toUpperCase();
    if (letter !== currentLetter) {
      currentLetter = letter;
      parts.push(`<div class="player-group-heading">${escapeHtml(letter)}</div>`);
    }
    parts.push(playerRowHtml(p));
  });
  listEl.innerHTML = parts.join('');
  if (isAdminUser) attachRowHandlers();
}

async function loadPlayers() {
  const params = query ? `?q=${encodeURIComponent(query)}` : '';
  try {
    players = await api(`/players${params}`);
    render();
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">${escapeHtml(t('players.couldNotLoad', { error: err.message }))}</div>`;
  }
}

function attachRowHandlers() {
  listEl.querySelectorAll('.player-row').forEach((row) => {
    const id = row.dataset.id;
    const player = players.find((p) => String(p.id) === id);

    row.querySelector('[data-action="edit"]').addEventListener('click', () => {
      row.innerHTML = `
        <input type="text" class="edit-name-input" value="${escapeHtml(player.name)}" maxlength="60" placeholder="${escapeHtml(t('players.namePlaceholder'))}">
        <input type="text" class="edit-phone-input" inputmode="numeric" value="${player.phone ? escapeHtml(player.phone) : ''}" placeholder="0903111222" maxlength="10">
        <input type="email" class="edit-email-input" value="${player.email ? escapeHtml(player.email) : ''}" placeholder="meno@example.com" maxlength="100">
        <div class="player-row-actions">
          <button type="button" class="btn btn-sm btn-primary" data-action="save">${t('common.save')}</button>
          <button type="button" class="btn btn-sm btn-outline" data-action="cancel">${t('common.cancel')}</button>
        </div>
      `;
      const nameInput = row.querySelector('.edit-name-input');
      const phoneInput = row.querySelector('.edit-phone-input');
      const emailInput = row.querySelector('.edit-email-input');
      nameInput.focus();
      nameInput.select();

      row.querySelector('[data-action="cancel"]').addEventListener('click', render);
      const save = async () => {
        const name = nameInput.value.trim();
        if (!name) return toast(t('players.nameRequired'));
        const phone = phoneInput.value.trim();
        const email = emailInput.value.trim();
        try {
          if (name !== player.name) {
            await api(`/players/${id}`, { method: 'PATCH', body: { name } });
          }
          if (phone !== (player.phone || '')) {
            await api(`/players/${id}/phone`, { method: 'PATCH', body: { phone } });
          }
          // Email lives on the general bio route (not its own dedicated
          // one like phone) — same route the profile page's "Edit
          // profile" modal already uses for it.
          if (email !== (player.email || '')) {
            await api(`/players/${id}/bio`, { method: 'PATCH', body: { email } });
          }
          toast(t('players.updated'));
          loadPlayers();
        } catch (err) {
          toast(err.message);
        }
      };
      row.querySelector('[data-action="save"]').addEventListener('click', save);
      [nameInput, phoneInput, emailInput].forEach((input) => {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') render();
        });
      });
    });

    row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm(t('players.deleteConfirm', { name: player.name }))) return;
      try {
        await api(`/players/${id}`, { method: 'DELETE' });
        toast(t('players.deleted', { name: player.name }));
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
    toast(t('players.added', { name }));
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

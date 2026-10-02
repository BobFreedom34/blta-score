const root = document.getElementById('venues-admin-root');

let venues = [];

const inputStyle = 'padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';

function renderLoggedOut() {
  root.innerHTML = `
    <div class="card">
      <p style="margin:0;color:var(--gray)">
        Managing venues requires an admin login.
        <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.
      </p>
    </div>
  `;
}

function renderAdmin() {
  root.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">Add a venue</h3>
      <form id="add-venue-form" style="display:flex;gap:8px;flex-wrap:wrap">
        <input type="text" id="venue-name" maxlength="120" placeholder="e.g. NTC Bratislava" required style="flex:1;min-width:200px;${inputStyle}">
        <button type="submit" class="btn btn-primary">Add venue</button>
      </form>
      <div id="add-venue-error" style="color:var(--danger);font-weight:600;margin-top:8px"></div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Venues <span id="venue-count" style="font-weight:400;color:var(--gray-dim);font-size:13px"></span></h3>
      <div id="venue-list">Loading…</div>
    </div>
  `;

  document.getElementById('add-venue-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('add-venue-error');
    errorEl.textContent = '';
    const input = document.getElementById('venue-name');
    try {
      await api('/venues', { method: 'POST', body: { name: input.value.trim() } });
      input.value = '';
      toast('Venue added');
      await loadVenuesList();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  loadVenuesList();
}

async function loadVenuesList() {
  venues = await api('/venues');
  renderList();
}

function renderList() {
  document.getElementById('venue-count').textContent = venues.length ? `(${venues.length})` : '';
  const listEl = document.getElementById('venue-list');
  listEl.innerHTML = venues.length
    ? venues.map((v) => `
      <div class="venue-admin-row" data-id="${v.id}" style="border-bottom:1px solid var(--gray-light);padding:12px 4px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div class="venue-name-cell" style="flex:1;min-width:160px;font-weight:700">${escapeHtml(v.name)}</div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button type="button" class="btn btn-sm btn-outline" data-action="rename">Rename</button>
            <button type="button" class="btn btn-sm btn-danger" data-action="delete">Delete</button>
          </div>
        </div>
      </div>
    `).join('')
    : '<div class="empty-state">No venues yet.</div>';

  document.querySelectorAll('.venue-admin-row').forEach((rowEl) => {
    const id = Number(rowEl.dataset.id);
    const venue = venues.find((x) => x.id === id);

    rowEl.querySelector('[data-action="rename"]').addEventListener('click', () => {
      const cell = rowEl.querySelector('.venue-name-cell');
      cell.innerHTML = `
        <form class="venue-rename-form" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input type="text" class="venue-rename-input" value="${escapeHtml(venue.name)}" maxlength="120" required style="flex:1;min-width:160px;${inputStyle};font-weight:700">
          <button type="submit" class="btn btn-sm btn-primary">Save</button>
          <button type="button" class="btn btn-sm btn-outline" data-action="cancel-rename">Cancel</button>
          <span class="venue-rename-error" style="color:var(--danger);font-weight:600;font-size:12px;width:100%"></span>
        </form>
      `;
      const form = cell.querySelector('.venue-rename-form');
      const input = form.querySelector('.venue-rename-input');
      input.focus();
      input.select();
      form.querySelector('[data-action="cancel-rename"]').addEventListener('click', renderList);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api(`/venues/${id}`, { method: 'PATCH', body: { name: input.value.trim() } });
          toast('Venue renamed');
          await loadVenuesList();
        } catch (err) {
          form.querySelector('.venue-rename-error').textContent = err.message;
        }
      });
    });

    rowEl.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm(`Delete "${venue.name}"? Matches already using it as their location keep it — it just stops being suggested.`)) return;
      try {
        await api(`/venues/${id}`, { method: 'DELETE' });
        toast('Venue deleted');
        await loadVenuesList();
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

(async () => {
  const isAdminUser = await checkAdmin();
  if (!isAdminUser) return renderLoggedOut();
  renderAdmin();
})();

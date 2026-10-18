// Backend > Cities: the cities (leagues) of SLTA. Bratislava (BLTA) is the first one; every other city starts hidden and is shown on the
// picker of the national page when its status is set. Data: GET /api/leagues/all, POST /api/leagues, PATCH/DELETE /api/leagues/:id.
const root = document.getElementById('leagues-admin-root');

let cities = [];

const CITY_STATUS_OPTIONS = [
  ['HIDDEN', 'Hidden (not on the picker)'],
  ['COMING_SOON', 'Coming soon (pre-registration)'],
  ['PREPARING', 'In preparation'],
  ['ACTIVE', 'Active (running)'],
];
const CITY_STATUS_SHORT = { HIDDEN: 'Hidden', COMING_SOON: 'Coming soon', PREPARING: 'In preparation', ACTIVE: 'Active' };

const inputStyle = 'padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px;width:100%';

function renderLoggedOut() {
  root.innerHTML = `
    <div class="card">
      <p style="margin:0;color:var(--gray)">
        Managing the cities requires an admin login.
        <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.
      </p>
    </div>
  `;
}

function renderAdmin() {
  root.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">Add a city</h3>
      <form id="add-city-form" style="display:flex;gap:8px;flex-wrap:wrap">
        <input type="text" id="city-name" maxlength="60" placeholder="e.g. Košice" required style="flex:1;min-width:200px;${inputStyle};width:auto">
        <button type="submit" class="btn btn-primary">Add city</button>
      </form>
      <p style="font-size:12px;color:var(--gray-dim);margin:8px 0 0">The address (slta.sk/kosice) and the brand name (SLTA Košice) come from the name; you can change them afterwards. A new city is hidden until you set its status.</p>
      <div id="add-city-error" style="color:var(--danger);font-weight:600;margin-top:8px"></div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Cities <span id="city-count" style="font-weight:400;color:var(--gray-dim);font-size:13px"></span></h3>
      <div id="city-list">Loading…</div>
    </div>
  `;
  document.getElementById('add-city-form').addEventListener('submit', addCity);
  loadCities();
}

async function addCity(e) {
  e.preventDefault();
  const input = document.getElementById('city-name');
  const errorEl = document.getElementById('add-city-error');
  errorEl.textContent = '';
  try {
    await api('/leagues', { method: 'POST', body: { name: input.value } });
    input.value = '';
    toast('City added');
    await loadCities();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function loadCities() {
  const listEl = document.getElementById('city-list');
  try {
    cities = await api('/leagues/all');
  } catch (err) {
    listEl.textContent = err.message;
    return;
  }
  document.getElementById('city-count').textContent = `(${cities.length})`;
  listEl.innerHTML = cities.map((c) => `
    <div class="city-row" data-id="${c.id}" style="border-top:1px solid #eee;padding:12px 0">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <strong>${escapeHtml(c.name)}</strong> <span style="color:var(--gray-dim)">· ${escapeHtml(c.brandName)}</span>
          <div style="font-size:12px;color:var(--gray-dim);margin-top:2px">slta.sk/${escapeHtml(c.slug)}${c.domain ? ` · ${escapeHtml(c.domain)}` : ''}</div>
        </div>
        <span style="font-size:12px;font-weight:700;color:${c.status === 'ACTIVE' ? 'var(--green-dark, #2d7a1f)' : 'var(--gray)'}">${escapeHtml(CITY_STATUS_SHORT[c.status] || c.status)}</span>
        <span style="font-size:12px;color:var(--gray-dim)">${c.players} players · ${c.seasons} seasons · ${c.venues} venues</span>
        <button type="button" class="btn btn-sm btn-outline" data-action="edit">Edit</button>
      </div>
      <div class="city-edit-slot"></div>
    </div>
  `).join('');
  listEl.querySelectorAll('.city-row').forEach((row) => {
    row.querySelector('[data-action="edit"]').addEventListener('click', () => openEdit(row, cities.find((c) => c.id === Number(row.dataset.id))));
  });
}

function cityField(label, name, value, hint = '') {
  return `<label style="display:block;font-size:12px;font-weight:700;margin-bottom:10px">${label}<input type="text" name="${name}" value="${escapeHtml(value == null ? '' : String(value))}" style="${inputStyle};margin-top:4px">${hint ? `<span style="font-weight:400;color:var(--gray-dim)">${hint}</span>` : ''}</label>`;
}

function openEdit(row, c) {
  const slot = row.querySelector('.city-edit-slot');
  if (slot.innerHTML) { slot.innerHTML = ''; return; }
  const isFirst = c.id === 1;
  slot.innerHTML = `
    <form class="city-edit" style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0 14px">
      ${cityField('City', 'name', c.name)}
      ${cityField('Brand name', 'brandName', c.brandName, 'Shown in titles, e-mails and the footer, e.g. BLTA or SLTA Košice')}
      ${cityField('Address (slug)', 'slug', c.slug, `slta.sk/&lt;slug&gt;`)}
      ${cityField('Own domain', 'domain', c.domain, 'Optional, e.g. blta.sk (without https://)')}
      <label style="display:block;font-size:12px;font-weight:700;margin-bottom:10px">Status
        <select name="status" style="${inputStyle};margin-top:4px">${CITY_STATUS_OPTIONS.filter(([v]) => !(isFirst && v === 'HIDDEN')).map(([v, l]) => `<option value="${v}"${c.status === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      </label>
      ${cityField('Order on the picker', 'sortOrder', c.sortOrder)}
      ${cityField('Latitude', 'lat', c.lat, 'For the map pin')}
      ${cityField('Longitude', 'lng', c.lng, 'For the map pin')}
      <div style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="submit" class="btn btn-primary btn-sm">Save</button>
        <button type="button" class="btn btn-outline btn-sm" data-action="cancel">Cancel</button>
        ${isFirst ? '' : '<button type="button" class="btn btn-danger btn-sm" data-action="delete" style="margin-left:auto">Delete</button>'}
        <span class="city-edit-error" style="color:var(--danger);font-weight:600;flex-basis:100%"></span>
      </div>
    </form>
  `;
  const form = slot.querySelector('form');
  const errorEl = slot.querySelector('.city-edit-error');
  form.querySelector('[data-action="cancel"]').addEventListener('click', () => { slot.innerHTML = ''; });
  const del = form.querySelector('[data-action="delete"]');
  if (del) {
    del.addEventListener('click', async () => {
      if (!confirm(`Delete the city ${c.name}? This only works for a city that has no data yet.`)) return;
      try {
        await api(`/leagues/${c.id}`, { method: 'DELETE' });
        toast('City deleted');
        await loadCities();
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      await api(`/leagues/${c.id}`, { method: 'PATCH', body: data });
      toast('City saved');
      await loadCities();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

(async () => {
  const isAdminUser = await checkAdmin();
  if (!isAdminUser) return renderLoggedOut();
  renderAdmin();
})();

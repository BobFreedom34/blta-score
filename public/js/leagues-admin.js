// Backend > Cities: the cities (leagues) of SLTA. Bratislava (BLTA) is the first one; every other city starts hidden and is shown on the
// picker of the national page when its status is set. Data: GET /api/leagues/all, POST /api/leagues, PATCH/DELETE /api/leagues/:id.
const root = document.getElementById('leagues-admin-root');

let cities = [];

const CITY_STATUS_OPTIONS = [
  ['HIDDEN', 'Hidden (not on the picker)'],
  ['SEEKING_ORGANIZER', 'Looking for an organizer'],
  ['COMING_SOON', 'Coming soon (pre-registration)'],
  ['PREPARING', 'In preparation'],
  ['ACTIVE', 'Active (running)'],
];
const CITY_STATUS_SHORT = { HIDDEN: 'Hidden', SEEKING_ORGANIZER: 'Looking for an organizer', COMING_SOON: 'Coming soon', PREPARING: 'In preparation', ACTIVE: 'Active' };

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
    <div class="card" style="margin-bottom:20px" id="lock-card">
      <h3 style="margin-top:0">National site slta.sk <span id="lock-state" style="font-weight:700;font-size:13px"></span></h3>
      <p style="font-size:13px;color:var(--gray-dim);margin:0 0 10px">While the site is being prepared you can lock its main page with a password. Visitors then see only a password page, and search engines are told to stay away (the page is also set not to be indexed in Backend &gt; SEO — switch that on there when the site opens).</p>
      <form id="lock-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input type="password" id="lock-password" autocomplete="new-password" placeholder="New password (6+ characters)" style="flex:1;min-width:220px;${inputStyle};width:auto">
        <button type="submit" class="btn btn-primary" id="lock-on">Lock with this password</button>
        <button type="button" class="btn btn-outline" id="lock-off">Unlock</button>
      </form>
      <div id="lock-error" style="color:var(--danger);font-weight:600;margin-top:8px"></div>
    </div>
    <div class="card" style="margin-bottom:20px" data-sec="keep">
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
  setupLock();
  loadCities();
}

async function setupLock() {
  const stateEl = document.getElementById('lock-state');
  const errorEl = document.getElementById('lock-error');
  const input = document.getElementById('lock-password');
  const show = (s) => {
    stateEl.textContent = s.locked ? '· locked with a password' : '· open';
    stateEl.style.color = s.locked ? 'var(--danger)' : 'var(--gray)';
    document.getElementById('lock-off').disabled = !s.locked;
    input.placeholder = s.locked ? 'New password (leave empty to keep the current one)' : 'New password (6+ characters)';
  };
  const send = async (body) => {
    errorEl.textContent = '';
    try {
      show(await api('/leagues/national-lock', { method: 'PUT', body }));
      input.value = '';
      toast(body.enabled ? 'slta.sk is locked' : 'slta.sk is unlocked');
    } catch (err) {
      errorEl.textContent = err.message;
    }
  };
  try { show(await api('/leagues/national-lock')); } catch (err) { errorEl.textContent = err.message; }
  document.getElementById('lock-form').addEventListener('submit', (e) => { e.preventDefault(); send({ enabled: true, password: input.value }); });
  document.getElementById('lock-off').addEventListener('click', () => send({ enabled: false }));
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
        ${c.checklist ? `<button type="button" class="btn btn-sm btn-outline" data-action="check" style="${c.checklist.done === c.checklist.total ? 'border-color:#2d7a1f;color:#2d7a1f' : ''}" title="What the city still needs before it is opened">Launch checklist ${c.checklist.done}/${c.checklist.total}</button>` : ''}
        <button type="button" class="btn btn-sm btn-outline" data-action="edit">Edit</button>
      </div>
      <div class="city-check-slot"></div>
      <div class="city-edit-slot"></div>
    </div>
  `).join('');
  listEl.querySelectorAll('.city-row').forEach((row) => {
    row.querySelector('[data-action="edit"]').addEventListener('click', () => openEdit(row, cities.find((c) => c.id === Number(row.dataset.id))));
    const checkBtn = row.querySelector('[data-action="check"]');
    if (checkBtn) checkBtn.addEventListener('click', () => toggleChecklist(row, cities.find((c) => c.id === Number(row.dataset.id))));
  });
}

// The launch checklist of a city: what it still needs before it is opened. A step that is not done leads to the Backend page where it is done,
// after switching to that city (everything in the Backend works on the city chosen at the top).
const openChecklists = new Set();
function checklistHtml(c) {
  const k = c.checklist;
  const pct = Math.round((k.done / k.total) * 100);
  return `
    <div style="margin-top:12px;background:#f7f7f9;border-radius:12px;padding:14px 16px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <strong>${escapeHtml(c.name)} · ${k.done} of ${k.total} ready</strong>
        <div style="flex:1;min-width:120px;height:8px;border-radius:99px;background:#e1e1e6;overflow:hidden"><div style="width:${pct}%;height:100%;background:${k.done === k.total ? '#2d7a1f' : 'var(--orange)'}"></div></div>
      </div>
      ${k.items.map((i) => `
        <div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-top:1px solid #e9e9ee">
          <span style="flex:0 0 20px;font-weight:800;color:${i.ok ? '#2d7a1f' : '#c0392b'}">${i.ok ? '✓' : '✗'}</span>
          <div style="flex:1;min-width:0"><div style="font-weight:700${i.ok ? ';color:var(--gray)' : ''}">${escapeHtml(i.label)}</div>${i.ok ? '' : `<div style="font-size:12px;color:var(--gray-dim)">${escapeHtml(i.hint)}</div>`}</div>
          ${i.ok ? '' : `<button type="button" class="btn btn-sm btn-outline" data-check-go="${escapeHtml(i.page)}">Open →</button>`}
        </div>`).join('')}
    </div>`;
}
function toggleChecklist(row, c) {
  const slot = row.querySelector('.city-check-slot');
  if (slot.innerHTML) { slot.innerHTML = ''; openChecklists.delete(c.id); return; }
  openChecklists.add(c.id);
  slot.innerHTML = checklistHtml(c);
  slot.querySelectorAll('[data-check-go]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('/admin/acting-city', { method: 'POST', body: { leagueId: c.id } });
      window.location.href = b.dataset.checkGo;
    } catch (err) { toast(err.message); }
  }));
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
  const session = await loadSession().catch(() => ({}));
  if (session.adminRole !== 'SUPER') { root.innerHTML = '<div class="card"><p style="margin:0;color:var(--gray)">Only the super admin can manage the cities.</p></div>'; return; }
  renderAdmin();
})();

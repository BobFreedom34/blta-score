// Backend > Admins: the admins of the cities. Only the super admin sees this page. A city admin logs in on /admin with the email and password
// set here and runs one city only. Data: GET/POST /api/city-admins, PATCH/DELETE /api/city-admins/:id (the password is never given back).
const root = document.getElementById('admins-admin-root');

let cityList = [];
let admins = [];

const fieldStyle = 'padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px;width:100%';

function renderBlocked(message) {
  root.innerHTML = `<div class="card"><p style="margin:0;color:var(--gray)">${message}</p></div>`;
}

function cityOptions(selected) {
  return cityList.map((c) => `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
}

function renderAdmin() {
  root.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">Add an admin of a city</h3>
      <form id="add-admin-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 12px;align-items:end">
        <label style="font-size:12px;font-weight:700">Name<input type="text" name="name" maxlength="60" required placeholder="Martin K." style="${fieldStyle};margin-top:4px"></label>
        <label style="font-size:12px;font-weight:700">Email (the login)<input type="email" name="email" required placeholder="martin@example.com" autocomplete="off" style="${fieldStyle};margin-top:4px"></label>
        <label style="font-size:12px;font-weight:700">City<select name="leagueId" style="${fieldStyle};margin-top:4px">${cityOptions(0)}</select></label>
        <label style="font-size:12px;font-weight:700">Password (8+ characters)<input type="password" name="password" required minlength="8" autocomplete="new-password" style="${fieldStyle};margin-top:4px"></label>
        <button type="submit" class="btn btn-primary">Add admin</button>
      </form>
      <p style="font-size:12px;color:var(--gray-dim);margin:8px 0 0">You choose the password and pass it on to the person yourself; they cannot see it again, and you can set a new one at any time. They log in on the Backend page (blta.sk/admin) with the email and this password.</p>
      <div id="add-admin-error" style="color:var(--danger);font-weight:600;margin-top:8px"></div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Admins of the cities <span id="admin-count" style="font-weight:400;color:var(--gray-dim);font-size:13px"></span></h3>
      <div id="admin-list">Loading…</div>
    </div>
  `;
  document.getElementById('add-admin-form').addEventListener('submit', addAdmin);
  loadAdmins();
}

async function addAdmin(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('add-admin-error');
  errorEl.textContent = '';
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    await api('/city-admins', { method: 'POST', body: { ...data, leagueId: Number(data.leagueId) } });
    form.reset();
    toast('Admin added');
    await loadAdmins();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function loadAdmins() {
  const listEl = document.getElementById('admin-list');
  try {
    admins = await api('/city-admins');
  } catch (err) {
    listEl.textContent = err.message;
    return;
  }
  document.getElementById('admin-count').textContent = `(${admins.length})`;
  if (!admins.length) {
    listEl.innerHTML = '<p style="color:var(--gray-dim);margin:0">No city has its own admin yet. Until then you run every city yourself with the picker above the tabs.</p>';
    return;
  }
  const when = (iso) => (iso ? new Date(iso).toLocaleString('sk-SK', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
  listEl.innerHTML = admins.map((a) => `
    <div class="admin-row" data-id="${a.id}" style="border-top:1px solid #eee;padding:12px 0">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <strong>${escapeHtml(a.name)}</strong> <span style="color:var(--gray-dim)">· ${escapeHtml(a.email)}</span>
          <div style="font-size:12px;color:var(--gray-dim);margin-top:2px">Last login: ${escapeHtml(when(a.lastLoginAt))}</div>
        </div>
        <span style="font-size:12px;font-weight:700;color:var(--orange)">${escapeHtml(a.cityName)}</span>
        <button type="button" class="btn btn-sm btn-outline" data-action="edit">Edit</button>
      </div>
      <div class="admin-edit-slot"></div>
    </div>
  `).join('');
  listEl.querySelectorAll('.admin-row').forEach((row) => {
    row.querySelector('[data-action="edit"]').addEventListener('click', () => openEdit(row, admins.find((a) => a.id === Number(row.dataset.id))));
  });
}

function openEdit(row, a) {
  const slot = row.querySelector('.admin-edit-slot');
  if (slot.innerHTML) { slot.innerHTML = ''; return; }
  slot.innerHTML = `
    <form class="admin-edit" style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 14px">
      <label style="font-size:12px;font-weight:700">Name<input type="text" name="name" value="${escapeHtml(a.name)}" maxlength="60" style="${fieldStyle};margin-top:4px"></label>
      <label style="font-size:12px;font-weight:700">Email<input type="email" name="email" value="${escapeHtml(a.email)}" style="${fieldStyle};margin-top:4px"></label>
      <label style="font-size:12px;font-weight:700">City<select name="leagueId" style="${fieldStyle};margin-top:4px">${cityOptions(a.leagueId)}</select></label>
      <label style="font-size:12px;font-weight:700">New password<input type="password" name="password" autocomplete="new-password" placeholder="Leave empty to keep the current one" style="${fieldStyle};margin-top:4px"></label>
      <div style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="submit" class="btn btn-primary btn-sm">Save</button>
        <button type="button" class="btn btn-outline btn-sm" data-action="cancel">Cancel</button>
        <button type="button" class="btn btn-danger btn-sm" data-action="delete" style="margin-left:auto">Remove admin</button>
        <span class="admin-edit-error" style="color:var(--danger);font-weight:600;flex-basis:100%"></span>
      </div>
    </form>
  `;
  const form = slot.querySelector('form');
  const errorEl = slot.querySelector('.admin-edit-error');
  form.querySelector('[data-action="cancel"]').addEventListener('click', () => { slot.innerHTML = ''; });
  form.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm(`Remove ${a.name}? They are logged out at once and can no longer log in. What they created stays in ${a.cityName}.`)) return;
    try {
      await api(`/city-admins/${a.id}`, { method: 'DELETE' });
      toast('Admin removed');
      await loadAdmins();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.password) delete data.password;
    try {
      await api(`/city-admins/${a.id}`, { method: 'PATCH', body: { ...data, leagueId: Number(data.leagueId) } });
      toast('Admin saved');
      await loadAdmins();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

(async () => {
  const isAdminUser = await checkAdmin();
  if (!isAdminUser) return renderBlocked('This page needs an admin login. <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.');
  const session = await loadSession().catch(() => ({}));
  if (session.adminRole !== 'SUPER') return renderBlocked('Only the super admin can manage the admins.');
  try { cityList = await api('/leagues/all'); } catch (err) { return renderBlocked(err.message); }
  renderAdmin();
})();

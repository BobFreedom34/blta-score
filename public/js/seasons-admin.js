const root = document.getElementById('seasons-admin-root');

let seasons = [];

// Which season cards are unfolded. Remembered in this browser; the first time only the running season is open.
const OPEN_KEY = 'blta_seasons_admin_open';
let openIds = null;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function seasonStatus(s) {
  const today = todayIso();
  if (s.startDate && s.endDate) {
    if (s.endDate < today) return 'past';
    if (s.startDate > today) return 'future';
    return 'now';
  }
  return 'future';
}

function initOpenIds() {
  if (openIds) return;
  try {
    const stored = JSON.parse(localStorage.getItem(OPEN_KEY));
    if (Array.isArray(stored)) openIds = new Set(stored);
  } catch { /* no saved state */ }
  if (!openIds) openIds = new Set(seasons.filter((s) => seasonStatus(s) === 'now').map((s) => s.id));
}

function saveOpenIds() {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify([...openIds])); } catch { /* ignore */ }
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}

const STATUS_LABEL = { now: 'Running', past: 'Finished', future: 'Upcoming' };

const CATEGORIES = [
  ['ELITE', 'Elite'],
  ['NEXT_GEN', 'Next Gen'],
  ['NOVICE', 'Novice'],
];
const inputStyle = 'padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';

function categoryOptions(selected) {
  return CATEGORIES.map(([key, label]) => `<option value="${key}"${key === selected ? ' selected' : ''}>${label}</option>`).join('');
}

function renderLoggedOut() {
  root.innerHTML = `
    <div class="card">
      <p style="margin:0;color:var(--gray)">
        Managing seasons requires an admin login.
        <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.
      </p>
    </div>
  `;
}

function renderAdmin() {
  root.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">Add a season</h3>
      <form id="add-season-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <label style="flex:1;min-width:220px;font-size:12px;font-weight:700">Name
          <input type="text" id="season-name" maxlength="120" placeholder="e.g. Winter Opening Series 2027" required style="display:block;width:100%;margin-top:4px;${inputStyle}">
        </label>
        <label style="font-size:12px;font-weight:700">Starts
          <input type="date" id="season-start" style="display:block;margin-top:4px;${inputStyle}">
        </label>
        <label style="font-size:12px;font-weight:700">Ends
          <input type="date" id="season-end" style="display:block;margin-top:4px;${inputStyle}">
        </label>
        <button type="submit" class="btn btn-primary">Add season</button>
      </form>
      <div id="add-season-error" style="color:var(--danger);font-weight:600;margin-top:8px"></div>
    </div>
    <div id="season-list">Loading…</div>
  `;

  document.getElementById('add-season-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('add-season-error');
    errorEl.textContent = '';
    try {
      const created = await api('/seasons', {
        method: 'POST',
        body: {
          name: document.getElementById('season-name').value.trim(),
          startDate: document.getElementById('season-start').value || null,
          endDate: document.getElementById('season-end').value || null,
        },
      });
      e.target.reset();
      if (created && created.id) { initOpenIds(); openIds.add(created.id); saveOpenIds(); }
      toast('Season added');
      await load();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  load();
}

async function load() {
  seasons = await api('/seasons');
  initOpenIds();
  renderList();
}

function groupRowHtml(g) {
  return `
    <div class="season-group-row" data-group="${g.id}" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--gray-light)">
      <input type="text" data-field="name" value="${escapeHtml(g.name)}" maxlength="80" style="flex:1;min-width:140px;${inputStyle}">
      <select data-field="category" style="${inputStyle}">${categoryOptions(g.category)}</select>
      <span style="font-size:12px;color:var(--gray);min-width:70px">${g.matchCount} ${g.matchCount === 1 ? 'match' : 'matches'}</span>
      <button type="button" class="btn btn-sm btn-outline" data-action="save-group">Save</button>
      <button type="button" class="btn btn-sm btn-danger" data-action="delete-group">Delete</button>
    </div>
  `;
}

function seasonHtml(s) {
  const byCategory = CATEGORIES.map(([key]) => s.groups.filter((g) => g.category === key).length);
  return `
    <details class="card season-admin-card" data-season="${s.id}"${openIds.has(s.id) ? ' open' : ''} style="margin-bottom:12px">
      <summary class="sa-sum">
        <svg class="sa-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        <span class="sa-name">${escapeHtml(s.name)}</span>
        <span class="sa-dates">${escapeHtml(s.startDate && s.endDate ? `${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}` : '')}</span>
        <span class="sa-chip ${seasonStatus(s)}">${STATUS_LABEL[seasonStatus(s)]}</span>
        <span class="sa-count">${s.groups.length} ${s.groups.length === 1 ? 'group' : 'groups'} · ${s.matchCount} ${s.matchCount === 1 ? 'match' : 'matches'}</span>
      </summary>
      <div class="sa-body">
      <form class="season-edit-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <label style="flex:1;min-width:220px;font-size:12px;font-weight:700">Season
          <input type="text" data-field="name" value="${escapeHtml(s.name)}" maxlength="120" required style="display:block;width:100%;margin-top:4px;${inputStyle}">
        </label>
        <label style="font-size:12px;font-weight:700">Starts
          <input type="date" data-field="startDate" value="${escapeHtml(s.startDate || '')}" style="display:block;margin-top:4px;${inputStyle}">
        </label>
        <label style="font-size:12px;font-weight:700">Ends
          <input type="date" data-field="endDate" value="${escapeHtml(s.endDate || '')}" style="display:block;margin-top:4px;${inputStyle}">
        </label>
        <button type="submit" class="btn btn-sm btn-outline">Save season</button>
        <button type="button" class="btn btn-sm btn-danger" data-action="delete-season">Delete season</button>
      </form>
      <div style="font-size:12px;color:var(--gray);margin:8px 0 12px">
        ${s.matchCount} tagged ${s.matchCount === 1 ? 'match' : 'matches'} ·
        ${s.groups.length} ${s.groups.length === 1 ? 'group' : 'groups'}
        (${byCategory[0]} Elite, ${byCategory[1]} Next Gen, ${byCategory[2]} Novice) — each group is one standings table
      </div>
      <div class="season-error" style="color:var(--danger);font-weight:600"></div>
      <div class="season-groups">${s.groups.length ? s.groups.map(groupRowHtml).join('') : '<div class="empty-state" style="padding:12px 0">No groups yet.</div>'}</div>
      <form class="add-group-form" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <input type="text" data-field="name" maxlength="80" placeholder="New group, e.g. Babolat" required style="flex:1;min-width:160px;${inputStyle}">
        <select data-field="category" required style="${inputStyle}">
          <option value="">Category…</option>
          ${categoryOptions('')}
        </select>
        <button type="submit" class="btn btn-sm btn-primary">Add group</button>
      </form>
      </div>
    </details>
  `;
}

function renderList() {
  const listEl = document.getElementById('season-list');
  if (!seasons.length) {
    listEl.innerHTML = '<div class="card"><div class="empty-state">No seasons yet.</div></div>';
    return;
  }
  listEl.innerHTML = `<div class="sa-bar"><button type="button" data-fold="open">Expand all</button><span>·</span><button type="button" data-fold="close">Collapse all</button></div>` + seasons.map(seasonHtml).join('');
  listEl.querySelectorAll('.season-admin-card').forEach(wireSeason);
  listEl.querySelectorAll('[data-fold]').forEach((btn) => {
    btn.addEventListener('click', () => {
      listEl.querySelectorAll('.season-admin-card').forEach((c) => { c.open = btn.dataset.fold === 'open'; });
    });
  });
}

function wireSeason(card) {
  const id = Number(card.dataset.season);
  const season = seasons.find((s) => s.id === id);
  const errorEl = card.querySelector('.season-error');
  const fail = (err) => { errorEl.textContent = err.message; };
  card.addEventListener('toggle', () => {
    if (card.open) openIds.add(id); else openIds.delete(id);
    saveOpenIds();
  });

  card.querySelector('.season-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const f = (name) => e.target.querySelector(`[data-field="${name}"]`).value;
    try {
      await api(`/seasons/${id}`, { method: 'PATCH', body: { name: f('name').trim(), startDate: f('startDate') || null, endDate: f('endDate') || null } });
      toast('Season saved');
      await load();
    } catch (err) { fail(err); }
  });

  card.querySelector('[data-action="delete-season"]').addEventListener('click', async () => {
    const extra = season.matchCount ? ` ${season.matchCount} matches will lose their season and group (the matches stay).` : '';
    if (!confirm(`Delete "${season.name}" and its ${season.groups.length} groups?${extra}`)) return;
    try {
      await api(`/seasons/${id}`, { method: 'DELETE' });
      toast('Season deleted');
      await load();
    } catch (err) { fail(err); }
  });

  card.querySelector('.add-group-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const f = (name) => e.target.querySelector(`[data-field="${name}"]`).value;
    try {
      await api(`/seasons/${id}/groups`, { method: 'POST', body: { name: f('name').trim(), category: f('category') } });
      toast('Group added');
      await load();
    } catch (err) { fail(err); }
  });

  card.querySelectorAll('.season-group-row').forEach((row) => {
    const groupId = Number(row.dataset.group);
    const group = season.groups.find((g) => g.id === groupId);
    const val = (name) => row.querySelector(`[data-field="${name}"]`).value;
    row.querySelector('[data-action="save-group"]').addEventListener('click', async () => {
      errorEl.textContent = '';
      try {
        await api(`/seasons/groups/${groupId}`, { method: 'PATCH', body: { name: val('name').trim(), category: val('category') } });
        toast('Group saved');
        await load();
      } catch (err) { fail(err); }
    });
    row.querySelector('[data-action="delete-group"]').addEventListener('click', async () => {
      const extra = group.matchCount ? ` ${group.matchCount} matches will lose their group (they stay in the season).` : '';
      if (!confirm(`Delete group "${group.name}"?${extra}`)) return;
      try {
        await api(`/seasons/groups/${groupId}`, { method: 'DELETE' });
        toast('Group deleted');
        await load();
      } catch (err) { fail(err); }
    });
  });
}

(async () => {
  const isAdminUser = await checkAdmin();
  if (!isAdminUser) return renderLoggedOut();
  renderAdmin();
})();

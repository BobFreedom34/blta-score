// Backend > Schedule (/schedule-admin): the other events (no page of their own) of the public schedule page (/harmonogram), plus a
// read-only list of the league seasons the schedule takes from Seasons.
(function eventsAdmin() {
  const host = document.getElementById('events-admin-root');
  if (!host) return;

  const CATS = [['ELITE', 'Elite'], ['NEXT_GEN', 'Next Gen'], ['NOVICE', 'Novice']];
  const field = 'padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  let list = [];
  let leagues = [];
  let editingId = null;

  function fmt(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${Number(d)}.${Number(m)}.${y}`;
  }

  function formHtml(e) {
    const picked = e ? e.categories : CATS.map(([k]) => k);
    return `
      <form id="ev-form" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <label style="flex:2;min-width:220px;font-size:12px;font-weight:700">Name
          <input type="text" id="ev-name" maxlength="120" required value="${escapeHtml(e ? e.name : '')}" placeholder="e.g. Slávia Filozof Cup 2026" style="display:block;width:100%;margin-top:4px;${field}">
        </label>
        <label style="font-size:12px;font-weight:700">Starts
          <input type="date" id="ev-start" required value="${e ? e.startDate : ''}" style="display:block;margin-top:4px;${field}">
        </label>
        <label style="font-size:12px;font-weight:700">Ends <span style="font-weight:600;color:var(--gray)">(optional)</span>
          <input type="date" id="ev-end" value="${e && e.endDate !== e.startDate ? e.endDate : ''}" style="display:block;margin-top:4px;${field}">
        </label>
        <label style="flex:2;min-width:220px;font-size:12px;font-weight:700">Venue <span style="font-weight:600;color:var(--gray)">(optional)</span>
          <input type="text" id="ev-venue" maxlength="200" value="${escapeHtml(e ? e.venue : '')}" placeholder="Address or club" style="display:block;width:100%;margin-top:4px;${field}">
        </label>
        <label style="flex:2;min-width:220px;font-size:12px;font-weight:700">More-info link <span style="font-weight:600;color:var(--gray)">(optional)</span>
          <input type="text" id="ev-link" maxlength="500" value="${escapeHtml(e ? e.link : '')}" placeholder="https://… or /tables" style="display:block;width:100%;margin-top:4px;${field}">
        </label>
        <div style="font-size:12px;font-weight:700">Categories
          <div style="display:flex;gap:12px;margin-top:8px;font-weight:600;font-size:14px">
            ${CATS.map(([k, label]) => `<label><input type="checkbox" class="ev-cat" value="${k}"${picked.includes(k) ? ' checked' : ''}> ${label}</label>`).join('')}
          </div>
        </div>
        <button type="submit" class="btn btn-primary">${e ? 'Save event' : 'Add event'}</button>
        ${e ? '<button type="button" class="btn btn-outline" id="ev-cancel">Cancel</button>' : ''}
      </form>
      <div id="ev-error" style="color:var(--danger);font-weight:600;margin-top:8px"></div>`;
  }

  function render() {
    const editing = list.find((e) => e.eventId === editingId) || null;
    const rows = list.map((e) => `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 0;border-top:1px solid #eee">
        <div style="flex:1;min-width:200px">
          <strong>${escapeHtml(e.name)}</strong>
          <div style="color:var(--gray);font-size:13px">${fmt(e.startDate)}${e.endDate !== e.startDate ? ` – ${fmt(e.endDate)}` : ''}${e.venue ? ` · ${escapeHtml(e.venue)}` : ''} · ${e.categories.map((c) => (CATS.find(([k]) => k === c) || [c, c])[1]).join(', ')}</div>
        </div>
        <button type="button" class="btn btn-sm btn-outline" data-edit="${e.eventId}">Edit</button>
        <button type="button" class="btn btn-sm btn-outline" data-del="${e.eventId}">Delete</button>
      </div>`).join('');
    const leagueRows = leagues.map((e) => `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid #eee">
        <strong style="flex:1;min-width:200px">${escapeHtml(e.name)}</strong>
        <span style="color:var(--gray);font-size:13px">${fmt(e.startDate)} – ${fmt(e.endDate)}</span>
      </div>`).join('');
    host.innerHTML = `
      <div class="card">
        <h3 style="margin-top:0">League seasons <span style="font-weight:600;font-size:12px;color:var(--gray)">— from <a href="/seasons-admin" style="text-decoration:underline;color:var(--orange)">Seasons</a>, change their dates there</span></h3>
        ${leagueRows || '<span style="color:var(--gray)">No seasons with a start date yet.</span>'}
      </div>
      <h2 style="margin:30px 0 12px;color:var(--white)">Tournaments &amp; events</h2>
      <div class="card">
        <h3 style="margin-top:0">${editing ? 'Edit event' : 'Add an event'}</h3>
        ${formHtml(editing)}
      </div>
      <div class="card" style="margin-top:14px">
        ${rows || '<span style="color:var(--gray)">No events yet.</span>'}
      </div>`;
  }

  async function load() {
    const all = await api('/schedule');
    list = all.filter((e) => e.type === 'TOURNAMENT').sort((a, b) => b.startDate.localeCompare(a.startDate));
    leagues = all.filter((e) => e.type === 'LEAGUE').sort((a, b) => b.startDate.localeCompare(a.startDate));
    render();
  }

  host.addEventListener('submit', async (ev) => {
    if (ev.target.id !== 'ev-form') return;
    ev.preventDefault();
    const errorEl = document.getElementById('ev-error');
    errorEl.textContent = '';
    const body = {
      name: document.getElementById('ev-name').value.trim(),
      startDate: document.getElementById('ev-start').value,
      endDate: document.getElementById('ev-end').value || null,
      venue: document.getElementById('ev-venue').value.trim(),
      link: document.getElementById('ev-link').value.trim(),
      categories: [...host.querySelectorAll('.ev-cat:checked')].map((c) => c.value),
    };
    try {
      if (editingId) await api(`/schedule/events/${editingId}`, { method: 'PATCH', body });
      else await api('/schedule/events', { method: 'POST', body });
      editingId = null;
      await load();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  host.addEventListener('click', async (ev) => {
    const edit = ev.target.closest('[data-edit]');
    const del = ev.target.closest('[data-del]');
    if (edit) { editingId = Number(edit.dataset.edit); render(); host.scrollIntoView(); }
    else if (ev.target.id === 'ev-cancel') { editingId = null; render(); }
    else if (del) {
      const e = list.find((x) => x.eventId === Number(del.dataset.del));
      if (!e || !window.confirm(`Delete "${e.name}"?`)) return;
      try { await api(`/schedule/events/${e.eventId}`, { method: 'DELETE' }); editingId = null; await load(); } catch (err) { window.alert(err.message); }
    }
  });

  // only for a logged-in admin
  checkAdmin().then((isAdmin) => {
    if (isAdmin) { load(); return; }
    host.innerHTML = '<div class="card"><p style="margin:0;color:var(--gray)">Managing the schedule requires an admin login. <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.</p></div>';
  });
})();

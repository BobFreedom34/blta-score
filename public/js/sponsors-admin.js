// Backend > Sponsors (/sponsors-admin): the sponsors and partners of the city - name, logo, link, the season it is tied to (or the whole city), a
// time window, a switch to hide one without deleting it, the order and the clicks on its logo. The super admin also has the sponsors of the
// national page (slta.sk).
(function sponsorsAdmin() {
  const host = document.getElementById('sponsors-admin-root');
  if (!host) return;

  const field = 'display:block;width:100%;margin-top:4px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  let sponsors = [];
  let seasons = [];
  let national = false;
  let isSuper = false;
  try { national = sessionStorage.getItem('sponsors_scope') === 'national'; } catch { /* the city one */ }
  const scopeQuery = () => (national ? '?scope=national' : '');

  const seasonOptions = (selected) => `<option value="">Whole city (the home page)</option>${seasons.map((s) => `<option value="${s.id}"${Number(selected) === s.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}`;

  function rowHtml(s, i) {
    return `
      <div class="sp-row" data-id="${s.id}" style="display:flex;gap:16px;flex-wrap:wrap;padding:14px 0;border-top:1px solid #eee">
        <div style="width:170px;${s.active ? '' : 'opacity:.45'}">
          <div style="width:170px;height:84px;border-radius:10px;background:#1b1b1f;display:flex;align-items:center;justify-content:center;overflow:hidden;color:#8b8f98;font-size:12px;font-weight:600">${s.logoUrl ? `<img src="${escapeHtml(s.logoUrl)}" alt="" style="max-width:100%;max-height:100%;object-fit:contain">` : 'No logo yet'}</div>
          <label class="btn btn-sm btn-outline" style="margin-top:6px;cursor:pointer">${s.logoUrl ? 'Replace logo' : 'Upload logo'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden data-logo></label>
          <div style="font-size:12px;color:var(--gray);margin-top:6px"><b>${s.clicks}</b> click${s.clicks === 1 ? '' : 's'}</div>
        </div>
        <div style="flex:1;min-width:240px">
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <label style="flex:1;min-width:160px;font-size:12px;font-weight:700">Name
              <input type="text" class="sp-name" maxlength="100" value="${escapeHtml(s.name)}" style="${field}">
            </label>
            <label style="flex:2;min-width:200px;font-size:12px;font-weight:700">Link <span style="font-weight:600;color:var(--gray)">(https://…)</span>
              <input type="text" class="sp-link" maxlength="500" value="${escapeHtml(s.link)}" placeholder="https://www.example.com" style="${field}">
            </label>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
            ${national ? '' : `<label style="flex:2;min-width:200px;font-size:12px;font-weight:700">Shown on
              <select class="sp-season" style="${field}">${seasonOptions(s.seasonId)}</select>
            </label>`}
            <label style="flex:1;min-width:140px;font-size:12px;font-weight:700">From <span style="font-weight:600;color:var(--gray)">(optional)</span>
              <input type="date" class="sp-from" value="${escapeHtml(s.startDate)}" style="${field}">
            </label>
            <label style="flex:1;min-width:140px;font-size:12px;font-weight:700">Until <span style="font-weight:600;color:var(--gray)">(optional)</span>
              <input type="date" class="sp-to" value="${escapeHtml(s.endDate)}" style="${field}">
            </label>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">
            <button type="button" class="btn btn-sm btn-primary" data-act="save">Save</button>
            <label style="font-size:14px;font-weight:600"><input type="checkbox" class="sp-active"${s.active ? ' checked' : ''}> Shown</label>
            <span style="flex:1"></span>
            <button type="button" class="btn btn-sm btn-outline" data-act="up"${i === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" class="btn btn-sm btn-outline" data-act="down"${i === sponsors.length - 1 ? ' disabled' : ''}>↓</button>
            <button type="button" class="btn btn-sm btn-danger" data-act="delete">Delete</button>
            <span class="sp-msg" style="font-weight:600"></span>
          </div>
        </div>
      </div>`;
  }

  function render() {
    host.innerHTML = `
      ${isSuper ? `<div class="card" style="margin-bottom:16px"><strong>Which sponsors?</strong>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <button type="button" class="btn ${national ? 'btn-outline' : 'btn-primary'}" data-scope="city">The city I work on</button>
          <button type="button" class="btn ${national ? 'btn-primary' : 'btn-outline'}" data-scope="national">The national page (slta.sk)</button>
        </div></div>` : ''}
      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">Add a sponsor${national ? ' — national page' : ''}</h3>
        <form id="sp-add" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <label style="flex:1;min-width:180px;font-size:12px;font-weight:700">Name
            <input type="text" name="name" maxlength="100" required style="${field}">
          </label>
          <label style="flex:2;min-width:220px;font-size:12px;font-weight:700">Link <span style="font-weight:600;color:var(--gray)">(https://…)</span>
            <input type="text" name="link" maxlength="500" placeholder="https://www.example.com" style="${field}">
          </label>
          ${national ? '' : `<label style="flex:2;min-width:200px;font-size:12px;font-weight:700">Shown on
            <select name="seasonId" style="${field}">${seasonOptions('')}</select>
          </label>`}
          <button type="submit" class="btn btn-primary">Add</button>
          <span id="sp-add-msg" style="flex-basis:100%;font-weight:600"></span>
        </form>
        <p style="color:var(--gray);margin:10px 0 0;font-size:13px">Add the sponsor first, then upload its logo (PNG, JPG or WebP up to 4 MB; a wide logo on a transparent background looks best).</p>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Sponsors <span style="font-weight:600;font-size:12px;color:var(--gray)">— shown in this order; a page with no sponsor shows no strip</span></h3>
        ${sponsors.length ? sponsors.map(rowHtml).join('') : '<span style="color:var(--gray)">No sponsors yet.</span>'}
      </div>`;
  }

  async function load() {
    sponsors = await api(`/sponsors/all${scopeQuery()}`);
    try { seasons = national ? [] : await api('/seasons'); } catch { seasons = []; }
    render();
  }

  function say(row, text, bad) {
    const el = row.querySelector('.sp-msg');
    el.textContent = text;
    el.style.color = bad ? 'var(--danger)' : 'var(--green, #2e9e4f)';
  }

  host.addEventListener('click', async (e) => {
    const sw = e.target.closest('[data-scope]');
    if (sw) {
      national = sw.dataset.scope === 'national';
      try { sessionStorage.setItem('sponsors_scope', national ? 'national' : 'city'); } catch { /* not remembered */ }
      await load();
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('.sp-row');
    const id = Number(row.dataset.id);
    try {
      if (btn.dataset.act === 'save') {
        const seasonEl = row.querySelector('.sp-season');
        await api(`/sponsors/${id}`, {
          method: 'PATCH',
          body: {
            name: row.querySelector('.sp-name').value, link: row.querySelector('.sp-link').value,
            startDate: row.querySelector('.sp-from').value, endDate: row.querySelector('.sp-to').value,
            active: row.querySelector('.sp-active').checked, ...(seasonEl ? { seasonId: seasonEl.value } : {}),
          },
        });
        say(row, 'Saved');
        sponsors = await api(`/sponsors/all${scopeQuery()}`);
      } else if (btn.dataset.act === 'up' || btn.dataset.act === 'down') {
        const i = sponsors.findIndex((s) => s.id === id);
        const j = btn.dataset.act === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= sponsors.length) return;
        // the order is written 0, 1, 2… so two sponsors never tie
        const order = sponsors.map((s) => s.id);
        [order[i], order[j]] = [order[j], order[i]];
        for (let k = 0; k < order.length; k += 1) await api(`/sponsors/${order[k]}`, { method: 'PATCH', body: { sortOrder: k } });
        await load();
      } else if (btn.dataset.act === 'delete') {
        if (!window.confirm('Delete this sponsor?')) return;
        await api(`/sponsors/${id}`, { method: 'DELETE' });
        await load();
      }
    } catch (err) {
      say(row, err.message, true);
    }
  });

  host.addEventListener('change', async (e) => {
    const input = e.target.closest('input[data-logo]');
    if (!input || !input.files[0]) return;
    const row = input.closest('.sp-row');
    say(row, 'Uploading…');
    try {
      const form = new FormData();
      form.append('image', input.files[0], input.files[0].name || 'logo.png');
      const res = await fetch(`/api/sponsors/${row.dataset.id}/logo`, { method: 'POST', body: form, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      toast('Logo uploaded');
      await load();
    } catch (err) {
      say(row, err.message, true);
    }
  });

  host.addEventListener('submit', async (e) => {
    if (e.target.id !== 'sp-add') return;
    e.preventDefault();
    const msg = document.getElementById('sp-add-msg');
    msg.textContent = '';
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api(`/sponsors${scopeQuery()}`, { method: 'POST', body: { name: data.name, link: data.link, ...(national ? {} : { seasonId: data.seasonId }) } });
      toast('Sponsor added');
      await load();
    } catch (err) {
      msg.textContent = err.message;
      msg.style.color = 'var(--danger)';
    }
  });

  checkAdmin().then(async (isAdmin) => {
    if (isAdmin) {
      try { isSuper = (await loadSession()).adminRole === 'SUPER'; } catch { isSuper = false; }
      if (!isSuper) national = false;
      load().catch((err) => { host.innerHTML = `<div class="card" style="color:var(--danger)">${escapeHtml(err.message)}</div>`; });
      return;
    }
    host.innerHTML = '<div class="card"><p style="margin:0;color:var(--gray)">Managing the sponsors requires an admin login. <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.</p></div>';
  });
})();

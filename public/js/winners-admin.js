// Backend > Winners (/winners-admin): the editions (series or tournaments) of the public winners page (/vitazi), their category
// blocks and the four places of each block (winner, finalist, two semifinalists) — a player or a typed name, with an optional
// own photo (without one the player's profile photo is shown). Data: /api/winners (see src/routes/winners.js).
(function winnersAdmin() {
  const host = document.getElementById('winners-admin-root');
  if (!host) return;

  const CATS = [['ELITE', 'Elite'], ['NEXT_GEN', 'Next Gen'], ['NOVICE', 'Novice']];
  const SLOTS = [[1, 'Winner'], [2, 'Finalist'], [3, 'Semifinalist'], [4, 'Semifinalist']];
  const field = 'padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  let editions = [];
  let players = [];
  let seasons = [];
  let tournaments = [];
  let selectedId = null;
  let pending = null; // a season or tournament picked from the list that has no edition yet: { title, seasonId } — created on the first save
  let message = '';

  const current = () => (pending ? null : editions.find((e) => e.id === selectedId) || null);

  // The list: the editions that exist, then every season and tournament that has no edition yet (picking one starts it).
  function pickerHtml() {
    const has = (title, seasonId) => editions.some((x) => x.title.toLowerCase() === title.toLowerCase() || (seasonId && x.seasonId === seasonId));
    const opt = (value, label, on) => `<option value="${value}"${on ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    const group = (label, items) => (items.length ? `<optgroup label="${label}">${items.join('')}</optgroup>` : '');
    const made = editions.map((x) => opt(`ed:${x.id}`, x.title + (x.visible ? '' : ' (hidden)'), !pending && x.id === selectedId));
    const seasonItems = seasons.filter((x) => !has(x.name, x.id)).map((x) => opt(`season:${x.id}`, x.name, pending && pending.key === `season:${x.id}`));
    const eventItems = tournaments.filter((x) => !has(x.name, null)).map((x) => opt(`event:${x.eventId}`, x.name, pending && pending.key === `event:${x.eventId}`));
    return group('Editions', made) + group('Seasons — no winners yet', seasonItems) + group('Tournaments — no winners yet', eventItems);
  }

  function playerOptions(selectedPlayerId) {
    return `<option value="">— typed name —</option>${players.map((p) => `<option value="${p.id}"${p.id === selectedPlayerId ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}`;
  }

  function placeRowHtml(block, slot, label) {
    const place = block.places.find((p) => p.slot === slot) || null;
    const playerId = place ? place.own.playerId : null;
    const typed = place && !playerId ? place.own.name : '';
    const photo = place ? place.photoUrl : null;
    const own = place && place.own.photoUrl;
    const thumb = photo
      ? `<img src="${escapeHtml(photo)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:50%;border:2px solid ${own ? 'var(--orange)' : '#ccc'}" title="${own ? 'Own photo' : 'Profile photo'}">`
      : '<span style="width:40px;height:40px;border-radius:50%;background:#eee;display:inline-block"></span>';
    const canUpload = !!(place && place.placeId);
    return `
      <div class="wa-place" data-slot="${slot}" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid #eee">
        <strong style="width:110px;font-size:13px">${label}</strong>
        <select class="wa-player" style="min-width:200px;${field}">${playerOptions(playerId)}</select>
        <input type="text" class="wa-name" maxlength="120" placeholder="Name" value="${escapeHtml(typed)}" style="flex:1;min-width:150px;${field};${playerId ? 'display:none' : ''}">
        ${thumb}
        <button type="button" class="btn btn-sm btn-outline" data-act="upload" data-place="${canUpload ? place.placeId : ''}"${canUpload ? '' : ' disabled title="Save the block first"'}>Upload photo</button>
        ${own ? `<button type="button" class="btn btn-sm btn-outline" data-act="remove-photo" data-place="${place.placeId}">Remove photo</button>` : ''}
      </div>`;
  }

  function blockHtml(block) {
    const own = !block.category;
    return `
      <div class="card wa-block" data-block="${block.id}" style="margin-top:14px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
          <select class="wa-cat" style="${field}">
            ${CATS.map(([k, label]) => `<option value="${k}"${block.category === k ? ' selected' : ''}>${label}</option>`).join('')}
            <option value=""${own ? ' selected' : ''}>Own title…</option>
          </select>
          <input type="text" class="wa-title" maxlength="120" placeholder="e.g. Konečné poradie" value="${escapeHtml(block.title)}" style="${field};${own ? '' : 'display:none'}">
          <span style="flex:1"></span>
          <button type="button" class="btn btn-sm btn-primary" data-act="save-block">Save block</button>
          <button type="button" class="btn btn-sm btn-outline" data-act="delete-block">Delete block</button>
        </div>
        ${SLOTS.map(([slot, label]) => placeRowHtml(block, slot, label)).join('')}
        <div style="color:var(--gray);font-size:12px;margin-top:6px">Save the block before uploading photos. Without an own photo the player's profile photo is shown.</div>
      </div>`;
  }

  function render() {
    const e = current();
    const ed = e || (pending ? { title: pending.title, seasonId: pending.seasonId, visible: true } : null);
    const picker = pickerHtml();
    const bar = `
      <div class="card">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <select id="wa-edition" style="min-width:280px;${field}">${picker || '<option value="">No seasons or editions yet</option>'}</select>
          <button type="button" class="btn btn-primary" data-act="new-edition">+ New edition</button>
        </div>
        ${ed ? `
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:14px;padding-top:14px;border-top:1px solid #eee">
          <label style="flex:2;min-width:220px;font-size:12px;font-weight:700">Title
            <input type="text" id="wa-ed-title" maxlength="120" value="${escapeHtml(ed.title)}" style="display:block;width:100%;margin-top:4px;${field}">
          </label>
          <label style="flex:1;min-width:200px;font-size:12px;font-weight:700">Season page <span style="font-weight:600;color:var(--gray)">(optional link)</span>
            <select id="wa-ed-season" style="display:block;width:100%;margin-top:4px;${field}">
              <option value="">— none —</option>
              ${seasons.map((s) => `<option value="${s.id}"${s.id === ed.seasonId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
          </label>
          ${e ? `<label style="font-size:13px;font-weight:700;padding-bottom:9px"><input type="checkbox" id="wa-ed-visible"${e.visible ? ' checked' : ''}> Visible on /vitazi</label>
          <button type="button" class="btn btn-primary" data-act="save-edition">Save edition</button>
          <button type="button" class="btn btn-outline" data-act="up" title="Show higher on the page">↑</button>
          <button type="button" class="btn btn-outline" data-act="down" title="Show lower on the page">↓</button>
          <button type="button" class="btn btn-outline" data-act="delete-edition">Delete edition</button>` : `<button type="button" class="btn btn-primary" data-act="create-edition">Start this edition</button>`}
        </div>` : ''}
        <div id="wa-msg" style="font-weight:600;margin-top:8px;color:var(--danger)">${escapeHtml(message)}</div>
      </div>`;
    const blocks = ed
      ? (e ? e.blocks.map(blockHtml).join('') : '') + '<div style="margin-top:14px"><button type="button" class="btn btn-outline" data-act="add-block">+ Add category block</button></div>'
      : '';
    host.innerHTML = bar + blocks;
  }

  function setEdition(updated) {
    const i = editions.findIndex((x) => x.id === updated.id);
    if (i >= 0) editions[i] = updated; else editions.unshift(updated);
  }

  async function run(fn) {
    message = '';
    try { await fn(); } catch (err) { message = err.message; }
    render();
  }

  async function load() {
    let schedule;
    [editions, players, seasons, schedule] = await Promise.all([api('/winners/all'), api('/players'), api('/seasons'), api('/schedule')]);
    tournaments = schedule.filter((x) => x.type === 'TOURNAMENT').sort((a, b) => b.startDate.localeCompare(a.startDate));
    if (!current() && !pending) selectedId = editions.length ? editions[0].id : null;
    render();
  }

  function blockEl(target) { return target.closest('.wa-block'); }

  host.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'wa-edition') {
      const [kind, id] = t.value.split(':');
      pending = null;
      selectedId = null;
      if (kind === 'ed') selectedId = Number(id);
      else if (kind === 'season') { const x = seasons.find((y) => y.id === Number(id)); if (x) pending = { key: t.value, title: x.name, seasonId: x.id }; }
      else if (kind === 'event') { const x = tournaments.find((y) => y.eventId === Number(id)); if (x) pending = { key: t.value, title: x.name, seasonId: null }; }
      message = '';
      render();
      return;
    }
    if (t.classList.contains('wa-cat')) blockEl(t).querySelector('.wa-title').style.display = t.value ? 'none' : '';
    if (t.classList.contains('wa-player')) {
      const nameInput = t.closest('.wa-place').querySelector('.wa-name');
      nameInput.style.display = t.value ? 'none' : '';
    }
    if (t.classList.contains('wa-photo-input')) uploadPhoto(t);
  });

  async function uploadPhoto(input) {
    const file = input.files && input.files[0];
    const placeId = input.dataset.place;
    input.remove();
    if (!file) return;
    await run(async () => {
      const form = new FormData();
      form.append('photo', file);
      const res = await fetch(`/api/winners/places/${placeId}/photo`, { method: 'POST', body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || `Upload failed (${res.status})`);
      setEdition(data);
    });
  }

  // the edition of a season or tournament picked from the list, made from the title and season shown
  async function createPending() {
    const seasonValue = document.getElementById('wa-ed-season').value;
    const created = await api('/winners/editions', { method: 'POST', body: { title: document.getElementById('wa-ed-title').value.trim(), seasonId: seasonValue ? Number(seasonValue) : null } });
    setEdition(created);
    selectedId = created.id;
    pending = null;
    return created;
  }

  host.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const e = current();

    if (act === 'new-edition') {
      const title = (window.prompt('Title of the new edition (e.g. BLTA Autumn Finals Series 2026)') || '').trim();
      if (!title) return;
      await run(async () => { const created = await api('/winners/editions', { method: 'POST', body: { title } }); setEdition(created); selectedId = created.id; pending = null; });
    } else if (act === 'create-edition' && pending) {
      await run(createPending);
    } else if (act === 'save-edition' && e) {
      await run(async () => {
        const seasonValue = document.getElementById('wa-ed-season').value;
        setEdition(await api(`/winners/editions/${e.id}`, { method: 'PATCH', body: {
          title: document.getElementById('wa-ed-title').value.trim(),
          seasonId: seasonValue ? Number(seasonValue) : null,
          visible: document.getElementById('wa-ed-visible').checked,
        } }));
      });
    } else if ((act === 'up' || act === 'down') && e) {
      const i = editions.findIndex((x) => x.id === e.id);
      const other = editions[act === 'up' ? i - 1 : i + 1];
      if (!other) return;
      await run(async () => {
        const a = e.sortOrder;
        const b = other.sortOrder === a ? a + (act === 'up' ? -1 : 1) : other.sortOrder;
        await api(`/winners/editions/${e.id}`, { method: 'PATCH', body: { sortOrder: b } });
        await api(`/winners/editions/${other.id}`, { method: 'PATCH', body: { sortOrder: a } });
        editions = await api('/winners/all');
      });
    } else if (act === 'delete-edition' && e) {
      if (!window.confirm(`Delete "${e.title}" with all its winners and photos?`)) return;
      await run(async () => { await api(`/winners/editions/${e.id}`, { method: 'DELETE' }); editions = editions.filter((x) => x.id !== e.id); selectedId = editions.length ? editions[0].id : null; });
    } else if (act === 'add-block' && (e || pending)) {
      await run(async () => {
        const edition = e || await createPending();
        const used = edition.blocks.map((b) => b.category);
        const free = CATS.map(([k]) => k).find((k) => !used.includes(k));
        const body = free ? { category: free } : { title: 'New block' };
        setEdition(await api(`/winners/editions/${edition.id}/blocks`, { method: 'POST', body }));
      });
    } else if (act === 'save-block') {
      const el = blockEl(btn);
      const blockId = Number(el.dataset.block);
      await run(async () => {
        const category = el.querySelector('.wa-cat').value || null;
        await api(`/winners/blocks/${blockId}`, { method: 'PATCH', body: { category, title: el.querySelector('.wa-title').value.trim() } });
        const places = [...el.querySelectorAll('.wa-place')].map((row) => {
          const playerId = row.querySelector('.wa-player').value;
          return { slot: Number(row.dataset.slot), playerId: playerId ? Number(playerId) : null, name: playerId ? '' : row.querySelector('.wa-name').value.trim() };
        });
        setEdition(await api(`/winners/blocks/${blockId}/places`, { method: 'PUT', body: { places } }));
        message = '';
      });
    } else if (act === 'delete-block') {
      if (!window.confirm('Delete this category block with its winners and photos?')) return;
      const blockId = Number(blockEl(btn).dataset.block);
      await run(async () => { await api(`/winners/blocks/${blockId}`, { method: 'DELETE' }); setEdition(await api('/winners/all').then((all) => all.find((x) => x.id === e.id))); });
    } else if (act === 'upload') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      input.className = 'wa-photo-input';
      input.dataset.place = btn.dataset.place;
      input.style.display = 'none';
      host.appendChild(input);
      input.click();
    } else if (act === 'remove-photo') {
      await run(async () => { setEdition(await api(`/winners/places/${btn.dataset.place}/photo`, { method: 'DELETE' })); });
    }
  });

  // only for a logged-in admin
  checkAdmin().then((isAdmin) => {
    if (isAdmin) { load().catch((err) => { host.innerHTML = `<div class="card"><p style="margin:0;color:var(--danger)">${escapeHtml(err.message)}</p></div>`; }); return; }
    host.innerHTML = '<div class="card"><p style="margin:0;color:var(--gray)">Managing the winners requires an admin login. <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.</p></div>';
  });
})();

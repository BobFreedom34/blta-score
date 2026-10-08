// Backend > Winners (/winners-admin): the editions (series or tournaments) of the public winners page (/vitazi), their category
// blocks and the four places of each block (winner, finalist, two semifinalists) — a player or a typed name, with an optional
// own photo (without one the player's profile photo is shown). Every edition is a fold-out section, and so is each block in it.
// Data: /api/winners (see src/routes/winners.js).
(function winnersAdmin() {
  const host = document.getElementById('winners-admin-root');
  if (!host) return;

  const CATS = [['ELITE', 'Elite'], ['NEXT_GEN', 'Next Gen'], ['NOVICE', 'Novice']];
  const SLOTS = [[1, 'Winner'], [2, 'Finalist'], [3, 'Semifinalist'], [4, 'Semifinalist']];
  const field = 'padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  const summaryStyle = 'cursor:pointer;font-weight:800;font-size:16px;padding:2px 0';
  const muted = 'font-weight:600;font-size:13px;color:var(--gray)';
  let editions = [];
  let players = [];
  let seasons = [];
  let tournaments = [];
  let message = '';
  const openEditions = new Set(); // which sections are unfolded, kept while the page redraws
  const openBlocks = new Set();

  const catLabel = (category) => (CATS.find(([k]) => k === category) || [category, category])[1];

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

  // "Elite — Róbert Sloboda · 4/4": enough to recognise a folded block
  function blockSummary(block) {
    const label = block.category ? catLabel(block.category) : (block.title || 'Untitled');
    const winner = block.places.find((p) => p.slot === 1);
    return `${escapeHtml(label)}${winner ? ` <span style="${muted}">— ${escapeHtml(winner.name)}</span>` : ''} <span style="${muted}">· ${block.places.length}/4</span>`;
  }

  function blockHtml(block) {
    const own = !block.category;
    return `
      <details class="card wa-block" data-id="${block.id}" style="margin-top:12px"${openBlocks.has(block.id) ? ' open' : ''}>
        <summary style="${summaryStyle}">${blockSummary(block)}</summary>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:10px 0 6px">
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
      </details>`;
  }

  function editionHtml(e) {
    const places = e.blocks.reduce((n, b) => n + b.places.length, 0);
    const seasonOptions = seasons.map((s) => `<option value="${s.id}"${s.id === e.seasonId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
    return `
      <details class="card wa-ed" data-id="${e.id}" style="margin-top:12px"${openEditions.has(e.id) ? ' open' : ''}>
        <summary style="${summaryStyle};font-size:18px">${escapeHtml(e.title)}
          ${e.visible ? '' : '<span style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--danger);margin-left:6px">hidden</span>'}
          <span style="${muted};margin-left:8px">${e.blocks.length} ${e.blocks.length === 1 ? 'category' : 'categories'} · ${places} winners</span>
        </summary>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid #eee">
          <label style="flex:2;min-width:220px;font-size:12px;font-weight:700">Title
            <input type="text" class="wa-ed-title" maxlength="120" value="${escapeHtml(e.title)}" style="display:block;width:100%;margin-top:4px;${field}">
          </label>
          <label style="flex:1;min-width:200px;font-size:12px;font-weight:700">Season page <span style="font-weight:600;color:var(--gray)">(optional link)</span>
            <select class="wa-ed-season" style="display:block;width:100%;margin-top:4px;${field}">
              <option value="">— none —</option>
              ${seasonOptions}
            </select>
          </label>
          <label style="font-size:13px;font-weight:700;padding-bottom:9px"><input type="checkbox" class="wa-ed-visible"${e.visible ? ' checked' : ''}> Visible on /vitazi</label>
          <button type="button" class="btn btn-primary" data-act="save-edition">Save edition</button>
          <button type="button" class="btn btn-outline" data-act="up" title="Show higher on the page">↑</button>
          <button type="button" class="btn btn-outline" data-act="down" title="Show lower on the page">↓</button>
          <button type="button" class="btn btn-outline" data-act="delete-edition">Delete edition</button>
        </div>
        ${e.blocks.map(blockHtml).join('')}
        <div style="margin-top:12px"><button type="button" class="btn btn-outline" data-act="add-block">+ Add category block</button></div>
      </details>`;
  }

  // Seasons and tournaments that have no edition yet: picking one starts its winners list.
  function addPickerHtml() {
    const has = (title, seasonId) => editions.some((x) => x.title.toLowerCase() === title.toLowerCase() || (seasonId && x.seasonId === seasonId));
    const opt = (value, label) => `<option value="${value}">${escapeHtml(label)}</option>`;
    const group = (label, items) => (items.length ? `<optgroup label="${label}">${items.join('')}</optgroup>` : '');
    const seasonItems = seasons.filter((x) => !has(x.name, x.id)).map((x) => opt(`season:${x.id}`, x.name));
    const eventItems = tournaments.filter((x) => !has(x.name, null)).map((x) => opt(`event:${x.eventId}`, x.name));
    if (!seasonItems.length && !eventItems.length) return '';
    return `<select id="wa-add" style="min-width:300px;${field}"><option value="">Add winners for a season or tournament…</option>${group('Seasons and tournaments', seasonItems)}${group('Other events', eventItems)}</select>`;
  }

  function render() {
    const y = window.scrollY;
    host.innerHTML = `
      <div class="card">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          ${addPickerHtml()}
          <button type="button" class="btn btn-primary" data-act="new-edition">+ New edition</button>
          <span style="flex:1"></span>
          <button type="button" class="btn btn-sm btn-outline" data-act="fold-all">Fold all</button>
          <button type="button" class="btn btn-sm btn-outline" data-act="unfold-all">Unfold all</button>
        </div>
        <div id="wa-msg" style="font-weight:600;margin-top:${message ? 8 : 0}px;color:var(--danger)">${escapeHtml(message)}</div>
      </div>
      ${editions.length ? editions.map(editionHtml).join('') : '<div class="card" style="margin-top:12px;color:var(--gray)">No winners lists yet. Pick a season or tournament above, or start a new edition.</div>'}`;
    window.scrollTo(0, y);
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
    tournaments = schedule.filter((x) => x.type === 'TOURNAMENT' && x.eventId).sort((a, b) => b.startDate.localeCompare(a.startDate));
    render();
  }

  const blockEl = (target) => target.closest('.wa-block');
  const editionRoot = (target) => target.closest('.wa-ed');
  const editionIdOf = (target) => Number(editionRoot(target).dataset.id);

  // remember what is unfolded (the toggle event does not bubble, so it is caught on the way down)
  host.addEventListener('toggle', (ev) => {
    const d = ev.target;
    if (!(d instanceof HTMLDetailsElement)) return;
    const set = d.classList.contains('wa-ed') ? openEditions : (d.classList.contains('wa-block') ? openBlocks : null);
    if (!set) return;
    const id = Number(d.dataset.id);
    if (d.open) set.add(id); else set.delete(id);
  }, true);

  host.addEventListener('change', async (ev) => {
    const t = ev.target;
    if (t.id === 'wa-add') {
      const [kind, id] = t.value.split(':');
      const source = kind === 'season' ? seasons.find((x) => x.id === Number(id)) : tournaments.find((x) => x.eventId === Number(id));
      if (!source) return;
      await run(async () => {
        const created = await api('/winners/editions', { method: 'POST', body: { title: source.name, seasonId: kind === 'season' ? source.id : null } });
        setEdition(created);
        openEditions.add(created.id);
      });
      return;
    }
    if (t.classList.contains('wa-cat')) blockEl(t).querySelector('.wa-title').style.display = t.value ? 'none' : '';
    if (t.classList.contains('wa-player')) t.closest('.wa-place').querySelector('.wa-name').style.display = t.value ? 'none' : '';
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

  host.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'fold-all' || act === 'unfold-all') {
      const open = act === 'unfold-all';
      editions.forEach((e) => {
        if (open) openEditions.add(e.id); else openEditions.delete(e.id);
        e.blocks.forEach((b) => { if (open) openBlocks.add(b.id); else openBlocks.delete(b.id); });
      });
      render();
    } else if (act === 'new-edition') {
      const title = (window.prompt('Title of the new edition (e.g. BLTA Autumn Finals Series 2026)') || '').trim();
      if (!title) return;
      await run(async () => { const created = await api('/winners/editions', { method: 'POST', body: { title } }); setEdition(created); openEditions.add(created.id); });
    } else if (act === 'save-edition') {
      const root = editionRoot(btn);
      const id = editionIdOf(btn);
      await run(async () => {
        const seasonValue = root.querySelector('.wa-ed-season').value;
        setEdition(await api(`/winners/editions/${id}`, { method: 'PATCH', body: {
          title: root.querySelector('.wa-ed-title').value.trim(),
          seasonId: seasonValue ? Number(seasonValue) : null,
          visible: root.querySelector('.wa-ed-visible').checked,
        } }));
      });
    } else if (act === 'up' || act === 'down') {
      const i = editions.findIndex((x) => x.id === editionIdOf(btn));
      const e = editions[i];
      const other = editions[act === 'up' ? i - 1 : i + 1];
      if (!other) return;
      await run(async () => {
        const a = e.sortOrder;
        const b = other.sortOrder === a ? a + (act === 'up' ? -1 : 1) : other.sortOrder;
        await api(`/winners/editions/${e.id}`, { method: 'PATCH', body: { sortOrder: b } });
        await api(`/winners/editions/${other.id}`, { method: 'PATCH', body: { sortOrder: a } });
        editions = await api('/winners/all');
      });
    } else if (act === 'delete-edition') {
      const e = editions.find((x) => x.id === editionIdOf(btn));
      if (!e || !window.confirm(`Delete "${e.title}" with all its winners and photos?`)) return;
      await run(async () => { await api(`/winners/editions/${e.id}`, { method: 'DELETE' }); editions = editions.filter((x) => x.id !== e.id); });
    } else if (act === 'add-block') {
      const e = editions.find((x) => x.id === editionIdOf(btn));
      if (!e) return;
      await run(async () => {
        const used = e.blocks.map((b) => b.category);
        const free = CATS.map(([k]) => k).find((k) => !used.includes(k));
        const updated = await api(`/winners/editions/${e.id}/blocks`, { method: 'POST', body: free ? { category: free } : { title: 'New block' } });
        setEdition(updated);
        openBlocks.add(updated.blocks[updated.blocks.length - 1].id);
      });
    } else if (act === 'save-block') {
      const el = blockEl(btn);
      const blockId = Number(el.dataset.id);
      await run(async () => {
        const category = el.querySelector('.wa-cat').value || null;
        await api(`/winners/blocks/${blockId}`, { method: 'PATCH', body: { category, title: el.querySelector('.wa-title').value.trim() } });
        const places = [...el.querySelectorAll('.wa-place')].map((row) => {
          const playerId = row.querySelector('.wa-player').value;
          return { slot: Number(row.dataset.slot), playerId: playerId ? Number(playerId) : null, name: playerId ? '' : row.querySelector('.wa-name').value.trim() };
        });
        setEdition(await api(`/winners/blocks/${blockId}/places`, { method: 'PUT', body: { places } }));
      });
    } else if (act === 'delete-block') {
      if (!window.confirm('Delete this category block with its winners and photos?')) return;
      const blockId = Number(blockEl(btn).dataset.id);
      await run(async () => { await api(`/winners/blocks/${blockId}`, { method: 'DELETE' }); editions = await api('/winners/all'); });
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

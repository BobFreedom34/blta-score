// Víťazi — the winners of ONE season or tournament: the last tab of its card in Backend > Seasons and Backend > Tournaments (it used to be a page of its own).
// A winners list ("edition") is linked to the season; it has a block per category (or an own title) and four places in each block (winner, finalist, two
// semifinalists) — a player or a typed name, with an optional own photo (without one the profile photo of the player is shown). It is what the public page
// /vitazi and the end of the page of the season show. A list made before (not linked to any season) can be linked from here.
// Data: /api/winners (see src/routes/winners.js). mountWinnersPanel(host, { id, name }) draws the tab; needs common.js (api, escapeHtml, tl, toast).
(function winnersPanel() {
  const CATS = [['ELITE', 'Elite'], ['NEXT_GEN', 'Next Gen'], ['NOVICE', 'Novice']];
  const SLOTS = [[1, () => tl('Víťaz', 'Winner')], [2, () => tl('Finalista', 'Finalist')], [3, () => tl('Semifinalista', 'Semifinalist')], [4, () => tl('Semifinalista', 'Semifinalist')]];
  const field = 'padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  const summaryStyle = 'cursor:pointer;font-weight:800;font-size:16px;padding:2px 0';
  const muted = 'font-weight:600;font-size:13px;color:var(--gray)';
  const catLabel = (category) => (CATS.find(([k]) => k === category) || [category, category])[1];

  async function mountWinnersPanel(host, season) {
    let editions = [];
    let players = [];
    let message = '';
    const openBlocks = new Set(); // which blocks are unfolded, kept while the tab redraws

    const club = !!season.club; // a tournament of a community: its organiser edits the list (the editions of THIS season only), it shows on the page of the tournament and of the community
    const allUrl = club ? `/winners/all?seasonId=${season.id}` : '/winners/all';
    const mine = () => editions.filter((e) => e.seasonId === season.id);
    const unlinked = () => editions.filter((e) => !e.seasonId);

    // One search box for a place: type "rob" and the players whose name has a word starting so (without regard to accents) are offered; pick one and the place is
    // linked to that player (green frame); leave what was typed and it is a typed name (for someone who is not a player of the app)
    const suggestions = (query) => {
      const q = query.trim();
      if (!q) return [];
      const first = searchTokens(q)[0] || '';
      const rank = (name) => {
        const words = searchTokens(name);
        if (words.join(' ').startsWith(searchTokens(q).join(' '))) return 0;
        return words.some((w) => w.startsWith(first)) ? 1 : 2;
      };
      return players.filter((p) => matchesQuery(p.name, q)).map((p, i) => ({ p, i, r: rank(p.name) })).sort((a, b) => a.r - b.r || a.i - b.i).slice(0, 8).map((x) => x.p);
    };
    const closeSuggestions = (root) => root.querySelectorAll('.wa-sug.open').forEach((el) => { el.classList.remove('open'); el.innerHTML = ''; });
    function showSuggestions(input) {
      const list = input.parentElement.querySelector('.wa-sug');
      const found = suggestions(input.value);
      list.innerHTML = found.map((p) => `<div class="autocomplete-item" data-pick="${p.id}">${highlightMatch(p.name, input.value)}</div>`).join('');
      list.classList.toggle('open', found.length > 0);
    }

    function placeRowHtml(block, slot, label) {
      const place = block.places.find((p) => p.slot === slot) || null;
      const playerId = place ? place.own.playerId : null;
      const found = playerId ? players.find((p) => p.id === playerId) : null;
      const shown = found ? found.name : (place && (playerId ? place.name : place.own.name || place.name)) || '';
      const linked = playerId ? { id: playerId, name: shown } : null; // (also when the player is not in the list any more: the link is kept until the name is changed)
      const photo = place ? place.photoUrl : null;
      const own = place && place.own.photoUrl;
      const thumb = photo
        ? `<img src="${escapeHtml(photo)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:50%;border:2px solid ${own ? 'var(--orange)' : '#ccc'}" title="${escapeHtml(own ? tl('Vlastná fotka', 'Own photo') : tl('Fotka z profilu', 'Profile photo'))}">`
        : '<span style="width:40px;height:40px;border-radius:50%;background:#eee;display:inline-block"></span>';
      const canUpload = !!(place && place.placeId);
      return `
        <div class="wa-place" data-slot="${slot}" data-pid="${linked ? linked.id : ''}" data-pname="${linked ? escapeHtml(linked.name) : ''}" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid rgba(255,255,255,0.12)">
          <strong style="width:110px;font-size:13px">${escapeHtml(label())}</strong>
          <div class="autocomplete" style="flex:1;min-width:220px">
            <input type="text" class="wa-name" maxlength="120" autocomplete="off" placeholder="${escapeHtml(tl('Hľadaj hráča alebo napíš meno…', 'Search a player or type a name…'))}" value="${escapeHtml(shown)}" style="width:100%;box-sizing:border-box;${field};${linked ? 'border-color:var(--green)' : ''}" title="${escapeHtml(linked ? tl('Hráč z aplikácie', 'A player of the app') : tl('Napísané meno', 'A typed name'))}">
            <div class="autocomplete-list wa-sug"></div>
          </div>
          ${thumb}
          <button type="button" class="btn btn-sm btn-outline" data-act="upload" data-place="${canUpload ? place.placeId : ''}"${canUpload ? '' : ` disabled title="${escapeHtml(tl('Najprv ulož blok', 'Save the block first'))}"`}>${escapeHtml(tl('Nahrať fotku', 'Upload photo'))}</button>
          ${own ? `<button type="button" class="btn btn-sm btn-outline" data-act="remove-photo" data-place="${place.placeId}">${escapeHtml(tl('Odstrániť fotku', 'Remove photo'))}</button>` : ''}
        </div>`;
    }

    // "Elite — Róbert Sloboda · 4/4": enough to recognise a folded block
    function blockSummary(block) {
      const label = block.category ? catLabel(block.category) : (block.title || tl('Bez názvu', 'Untitled'));
      const winner = block.places.find((p) => p.slot === 1);
      return `${escapeHtml(label)}${winner ? ` <span style="${muted}">— ${escapeHtml(winner.name)}</span>` : ''} <span style="${muted}">· ${block.places.length}/4</span>`;
    }

    function blockHtml(block) {
      const ownTitle = !block.category;
      return `
        <details class="card wa-block" data-id="${block.id}" style="margin-top:12px"${openBlocks.has(block.id) ? ' open' : ''}>
          <summary style="${summaryStyle}">${blockSummary(block)}</summary>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:10px 0 6px">
            <select class="wa-cat" style="${field}">
              ${CATS.map(([k, label]) => `<option value="${k}"${block.category === k ? ' selected' : ''}>${label}</option>`).join('')}
              <option value=""${ownTitle ? ' selected' : ''}>${escapeHtml(tl('Vlastný názov…', 'Own title…'))}</option>
            </select>
            <input type="text" class="wa-title" maxlength="120" placeholder="${escapeHtml(tl('napr. Konečné poradie', 'e.g. Final standings'))}" value="${escapeHtml(block.title)}" style="${field};${ownTitle ? '' : 'display:none'}">
            <span style="flex:1"></span>
            <button type="button" class="btn btn-sm btn-primary" data-act="save-block">${escapeHtml(tl('Uložiť blok', 'Save block'))}</button>
            <button type="button" class="btn btn-sm btn-outline" data-act="delete-block">${escapeHtml(tl('Zmazať blok', 'Delete block'))}</button>
          </div>
          ${SLOTS.map(([slot, label]) => placeRowHtml(block, slot, label)).join('')}
          <div style="color:var(--gray);font-size:12px;margin-top:6px">${escapeHtml(tl('Pred nahrávaním fotiek ulož blok. Bez vlastnej fotky sa ukáže fotka hráča z profilu.', "Save the block before uploading photos. Without an own photo the player's profile photo is shown."))}</div>
        </details>`;
    }

    function editionHtml(e) {
      const places = e.blocks.reduce((n, b) => n + b.places.length, 0);
      return `
        <section class="sa-section wa-ed" data-id="${e.id}">
          <h4>${escapeHtml(tl('Víťazi', 'Winners'))} <span style="${muted};text-transform:none;letter-spacing:0">${e.blocks.length} ${escapeHtml(tl('kategórií', 'categories'))} · ${places} ${escapeHtml(tl('víťazov', 'winners'))}</span></h4>
          <div style="display:flex;gap:12px 14px;flex-wrap:wrap;align-items:flex-end">
            <label class="sa-field" style="flex:2;min-width:220px">${escapeHtml(club ? tl('Názov zoznamu', 'Title of the list') : tl('Názov zoznamu na stránke Víťazi', 'Title of the list on the Winners page'))}
              <input type="text" class="wa-ed-title" maxlength="120" value="${escapeHtml(e.title)}">
            </label>
            <label class="sa-check" style="padding-bottom:10px"><input type="checkbox" class="wa-ed-visible"${e.visible ? ' checked' : ''}> ${escapeHtml(club ? tl('Zobraziť verejne', 'Show publicly') : tl('Zobraziť na /vitazi', 'Shown on /vitazi'))}</label>
            <button type="button" class="btn btn-sm btn-primary" data-act="save-edition">${escapeHtml(tl('Uložiť', 'Save'))}</button>
            <button type="button" class="btn btn-sm btn-danger" data-act="delete-edition">${escapeHtml(tl('Zmazať víťazov', 'Delete the winners'))}</button>
          </div>
          ${e.blocks.map(blockHtml).join('')}
          <div style="margin-top:14px"><button type="button" class="btn btn-sm btn-outline" data-act="add-block">+ ${escapeHtml(tl('Pridať blok kategórie', 'Add a category block'))}</button></div>
        </section>`;
    }

    function startHtml() {
      const old = unlinked();
      return `
        <section class="sa-section">
          <h4>${escapeHtml(tl('Víťazi', 'Winners'))}</h4>
          <p class="sa-hint" style="margin:0 0 14px">${escapeHtml(club ? tl('Zoznam víťazov turnaja: pre každú kategóriu víťaz, finalista a dvaja semifinalisti. Ukáže sa na konci stránky turnaja a na stránke komunity.', 'The winners of the tournament: for every category the winner, the finalist and two semifinalists. It shows at the end of the page of the tournament and on the page of the community.') : tl('Zoznam víťazov tejto súťaže: pre každú kategóriu víťaz, finalista a dvaja semifinalisti. Ukáže sa na stránke Víťazi a na konci stránky súťaže.', 'The winners of this competition: for every category the winner, the finalist and two semifinalists. It shows on the Winners page and at the end of the page of the competition.'))}</p>
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
            <button type="button" class="btn btn-primary" data-act="create">${escapeHtml(tl('Vytvoriť zoznam víťazov', 'Create the winners list'))}</button>
            ${old.length ? `<select id="wp-link" style="min-width:280px;${field}"><option value="">${escapeHtml(tl('…alebo pripojiť existujúci zoznam', '…or link a list that exists'))}</option>${old.map((e) => `<option value="${e.id}">${escapeHtml(e.title)}</option>`).join('')}</select>` : ''}
          </div>
        </section>`;
    }

    function render() {
      const y = window.scrollY;
      const list = mine();
      host.innerHTML = `${message ? `<div style="color:var(--danger);font-weight:600;margin:0 0 12px">${escapeHtml(message)}</div>` : ''}${list.length ? list.map(editionHtml).join('') : startHtml()}`;
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

    const blockEl = (target) => target.closest('.wa-block');
    const editionRoot = (target) => target.closest('.wa-ed');
    const editionIdOf = (target) => Number(editionRoot(target).dataset.id);

    // remember which block is unfolded (the toggle event does not bubble, so it is caught on the way down)
    if (!host.dataset.wpToggle) {
      host.dataset.wpToggle = '1';
      host.addEventListener('toggle', (ev) => {
        const d = ev.target;
        if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('wa-block')) return;
        const id = Number(d.dataset.id);
        if (d.open) openBlocks.add(id); else openBlocks.delete(id);
      }, true);
    }

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

    host.onchange = async (ev) => {
      const t = ev.target;
      if (t.id === 'wp-link') {
        if (!t.value) return;
        await run(async () => { setEdition(await api(`/winners/editions/${Number(t.value)}`, { method: 'PATCH', body: { seasonId: season.id } })); });
        return;
      }
      if (t.classList.contains('wa-cat')) blockEl(t).querySelector('.wa-title').style.display = t.value ? 'none' : '';
      if (t.classList.contains('wa-photo-input')) uploadPhoto(t);
    };

    // the search box of a place: typing offers players, and a name that is changed after a player was picked is a typed name again
    host.oninput = (ev) => {
      const t = ev.target;
      if (!t.classList || !t.classList.contains('wa-name')) return;
      const row = t.closest('.wa-place');
      if (row.dataset.pid && row.dataset.pname !== t.value) { row.dataset.pid = ''; t.style.borderColor = ''; t.title = tl('Napísané meno', 'A typed name'); }
      showSuggestions(t);
    };
    host.onfocusin = (ev) => { if (ev.target.classList && ev.target.classList.contains('wa-name') && !ev.target.closest('.wa-place').dataset.pid) showSuggestions(ev.target); };
    host.onfocusout = (ev) => { if (ev.target.classList && ev.target.classList.contains('wa-name')) setTimeout(() => closeSuggestions(ev.target.closest('.wa-place') || host), 150); };
    host.onkeydown = (ev) => {
      const t = ev.target;
      if (!t.classList || !t.classList.contains('wa-name')) return;
      const list = t.parentElement.querySelector('.wa-sug');
      if (ev.key === 'Escape') { closeSuggestions(t.closest('.wa-place')); return; }
      if (!list.classList.contains('open')) return;
      const items = [...list.querySelectorAll('.autocomplete-item')];
      const at = items.findIndex((el) => el.classList.contains('active'));
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const next = ev.key === 'ArrowDown' ? Math.min(at + 1, items.length - 1) : Math.max(at - 1, 0);
        items.forEach((el, i) => el.classList.toggle('active', i === next));
      } else if (ev.key === 'Enter' && at >= 0) {
        ev.preventDefault();
        items[at].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
    };
    host.onmousedown = (ev) => {
      const item = ev.target.closest && ev.target.closest('[data-pick]');
      if (!item) return;
      ev.preventDefault(); // (the box keeps its focus until the pick is done)
      const row = item.closest('.wa-place');
      const player = players.find((p) => String(p.id) === item.dataset.pick);
      if (!player) return;
      const input = row.querySelector('.wa-name');
      input.value = player.name;
      input.style.borderColor = 'var(--green)';
      input.title = tl('Hráč z aplikácie', 'A player of the app');
      row.dataset.pid = String(player.id);
      row.dataset.pname = player.name;
      closeSuggestions(row);
    };

    host.onclick = async (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'create') {
        await run(async () => { setEdition(await api('/winners/editions', { method: 'POST', body: { title: season.name, seasonId: season.id } })); });
      } else if (act === 'save-edition') {
        const root = editionRoot(btn);
        const id = editionIdOf(btn);
        await run(async () => {
          setEdition(await api(`/winners/editions/${id}`, { method: 'PATCH', body: { title: root.querySelector('.wa-ed-title').value.trim(), visible: root.querySelector('.wa-ed-visible').checked } }));
          toast(tl('Uložené', 'Saved'));
        });
      } else if (act === 'delete-edition') {
        const e = editions.find((x) => x.id === editionIdOf(btn));
        if (!e || !window.confirm(tl(`Zmazať víťazov „${e.title}“ aj s fotkami?`, `Delete the winners "${e.title}" with all their photos?`))) return;
        await run(async () => { await api(`/winners/editions/${e.id}`, { method: 'DELETE' }); editions = editions.filter((x) => x.id !== e.id); });
      } else if (act === 'add-block') {
        const e = editions.find((x) => x.id === editionIdOf(btn));
        if (!e) return;
        await run(async () => {
          const used = e.blocks.map((b) => b.category);
          const free = CATS.map(([k]) => k).find((k) => !used.includes(k));
          const updated = await api(`/winners/editions/${e.id}/blocks`, { method: 'POST', body: free ? { category: free } : { title: tl('Nový blok', 'New block') } });
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
            const playerId = row.dataset.pid;
            return { slot: Number(row.dataset.slot), playerId: playerId ? Number(playerId) : null, name: playerId ? '' : row.querySelector('.wa-name').value.trim() };
          });
          setEdition(await api(`/winners/blocks/${blockId}/places`, { method: 'PUT', body: { places } }));
          toast(tl('Blok uložený', 'Block saved'));
        });
      } else if (act === 'delete-block') {
        if (!window.confirm(tl('Zmazať tento blok kategórie aj s víťazmi a fotkami?', 'Delete this category block with its winners and photos?'))) return;
        const blockId = Number(blockEl(btn).dataset.id);
        await run(async () => { await api(`/winners/blocks/${blockId}`, { method: 'DELETE' }); editions = await api(allUrl); });
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
    };

    host.innerHTML = `<div style="color:var(--gray)">${escapeHtml(tl('Načítavam…', 'Loading…'))}</div>`;
    [editions, players] = await Promise.all([api(allUrl), api('/players')]);
    render();
  }

  window.mountWinnersPanel = mountWinnersPanel;
})();

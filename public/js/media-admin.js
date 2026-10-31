// Backend > Media (/media-admin): the picture library of the city that is worked on — upload (several at once, or drop them on the page), rename,
// delete, copy the address — and, read only, the pictures that are on the server already. Data: GET/POST /api/media, PATCH/DELETE /api/media/:id.
(function mediaAdmin() {
  const host = document.getElementById('media-admin-root');
  if (!host) return;

  let library = [];
  let server = [];
  let filter = '';
  let placeFilter = ''; // the kind of the pictures on the server that is shown ('' = all)
  const esc = (s) => escapeHtml(String(s == null ? '' : s));
  const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);

  function tile(m, own) {
    return `
      <figure class="md-tile" data-url="${esc(m.url)}"${own ? ` data-id="${m.id}"` : ''}>
        <a class="md-img" href="${esc(m.url)}" target="_blank" rel="noopener"><img src="${esc(m.url)}" alt="${esc(m.name)}" loading="lazy"></a>
        <figcaption>
          <span class="md-name" title="${esc(m.label ? `${m.label} — ${m.name}` : m.name)}">${esc(m.label || m.name)}</span>
          <small>${m.place ? `${esc(m.place)} · ` : ''}${kb(m.size)}</small>
          <span class="md-actions">
            <button type="button" class="btn btn-sm btn-outline" data-act="copy">Copy address</button>
            ${own ? '' : '<button type="button" class="btn btn-sm btn-outline" data-act="adopt">Add to the library</button>'}
            ${own ? '<button type="button" class="btn btn-sm btn-outline" data-act="rename">Rename</button><button type="button" class="btn btn-sm btn-danger" data-act="delete">Delete</button>' : ''}
          </span>
        </figcaption>
      </figure>`;
  }

  const matches = (m) => !filter || [m.name, m.label, m.place].join(' ').toLowerCase().includes(filter);

  function render() {
    const mine = library.filter(matches);
    const found = server.filter(matches);
    const kinds = [...found.reduce((map, m) => map.set(m.place, (map.get(m.place) || 0) + 1), new Map())].sort((a, b) => a[0].localeCompare(b[0]));
    if (placeFilter && !kinds.some(([k]) => k === placeFilter)) placeFilter = '';
    const there = found.filter((m) => !placeFilter || m.place === placeFilter);
    const chip = (key, label, n) => `<button type="button" class="tab${placeFilter === key ? ' active' : ''}" data-place="${esc(key)}">${esc(label)} <small>${n}</small></button>`;
    host.innerHTML = `
      <div class="card md-drop" id="md-drop" data-sec-title="Upload pictures">
        <strong class="sec-orig-title">Upload pictures</strong>
        <p style="margin:4px 0 10px;font-size:13px;color:var(--gray-dim)">PNG, JPG, WebP or GIF, up to 8 MB each. Choose several at once or drop them here.</p>
        <input type="file" id="md-files" accept="image/png,image/jpeg,image/webp,image/gif" multiple style="display:none">
        <button type="button" class="btn btn-primary" id="md-pick">Choose pictures…</button>
        <span id="md-msg" style="font-weight:600;margin-left:10px"></span>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:18px 0 8px">
        <h3 style="margin:0">Library <span style="font-weight:400;color:var(--gray-dim);font-size:13px">(${library.length})</span></h3>
        <input type="search" id="md-search" placeholder="Search by name" value="${esc(filter)}" style="padding:7px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px;min-width:200px">
      </div>
      <div class="md-grid">${mine.map((m) => tile(m, true)).join('') || `<div class="card" style="grid-column:1/-1;color:var(--gray)">${library.length ? 'Nothing matches.' : 'The library is empty — upload the first pictures above.'}</div>`}</div>
      <div style="margin-top:26px">
        <h3 style="margin:0">Pictures already on the site <span style="font-weight:400;color:var(--gray-dim);font-size:13px">(${found.length})</span></h3>
        <p style="font-size:13px;color:var(--gray-dim);margin:6px 0 10px">Every picture the site holds: communities and clubs, seasons and tournaments, venues, sponsors, badges, players, the carousel, the blog and the site's own logos. You can pick any of them in the upload window of every page (tab "On the server"), or take one into the library to rename it. Deleting them is done where they are used.</p>
        <div class="tabs" style="margin-top:0">${chip('', 'All', found.length)}${kinds.map(([k, n]) => chip(k, k, n)).join('')}</div>
        <div class="md-grid">${there.map((m) => tile(m, false)).join('') || '<div class="card" style="grid-column:1/-1;color:var(--gray)">Nothing here.</div>'}</div>
      </div>`;
  }

  const say = (text, bad) => { const el = document.getElementById('md-msg'); if (!el) return; el.textContent = text; el.style.color = bad ? 'var(--danger)' : 'var(--green, #2e9e4f)'; };

  async function upload(files) {
    const list = [...files].filter((f) => /^image\/(png|jpeg|webp|gif)$/.test(f.type));
    if (!list.length) { say('Choose PNG, JPG, WebP or GIF pictures', true); return; }
    say(`Uploading ${list.length}…`);
    let done = 0;
    let already = 0;
    // a few at a time, so one big batch does not hit the size limit of a request
    for (let i = 0; i < list.length; i += 5) {
      const form = new FormData();
      list.slice(i, i + 5).forEach((f) => form.append('image', f));
      const res = await fetch('/api/media', { method: 'POST', body: form, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { say(data.error || 'Upload failed', true); await load(false); return; }
      done += data.added.length;
      already += (data.reused || []).length;
    }
    await load(false);
    const kept = already ? ` (${already} ${already === 1 ? 'was' : 'were'} in the library already, not added again)` : '';
    say(done ? `Added ${done} picture${done === 1 ? '' : 's'} ✓${kept}` : `Nothing new: ${already === 1 ? 'that picture is' : 'those pictures are'} in the library already ✓`);
  }

  async function load(withServer = true) {
    const data = await api(`/media${withServer ? '?server=1' : ''}`);
    library = data.library;
    if (data.server) server = data.server;
    render();
  }

  host.addEventListener('click', async (e) => {
    if (e.target.closest('#md-pick')) { document.getElementById('md-files').click(); return; }
    const kind = e.target.closest('[data-place]');
    if (kind) { placeFilter = kind.dataset.place; render(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const t = btn.closest('.md-tile');
    const url = t.dataset.url;
    const id = t.dataset.id ? Number(t.dataset.id) : null;
    try {
      if (btn.dataset.act === 'adopt') {
        // the same bytes are never stored twice (POST /api/media), so adopting a picture that is in the library already only says so
        const blob = await (await fetch(url)).blob();
        const form = new FormData();
        form.append('image', new File([blob], url.split('/').pop(), { type: blob.type }));
        const res = await fetch('/api/media', { method: 'POST', body: form, credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not add the picture');
        await load(false);
        toast(data.added && data.added.length ? 'Added to the library' : 'It is in the library already');
      } else if (btn.dataset.act === 'copy') {
        await copyToClipboard(`${location.origin}${url}`);
        toast('Address copied');
      } else if (btn.dataset.act === 'rename') {
        const m = library.find((x) => x.id === id);
        const name = window.prompt('Name of the picture', m.name);
        if (!name || name === m.name) return;
        const saved = await api(`/media/${id}`, { method: 'PATCH', body: { name } });
        library = library.map((x) => (x.id === id ? saved : x));
        render();
      } else if (btn.dataset.act === 'delete') {
        const m = library.find((x) => x.id === id);
        if (!window.confirm(`Delete "${m.name}" from the library? Pictures already put on a page from it stay there.`)) return;
        await api(`/media/${id}`, { method: 'DELETE' });
        library = library.filter((x) => x.id !== id);
        render();
      }
    } catch (err) { toast(err.message); }
  });

  host.addEventListener('change', (e) => { if (e.target.id === 'md-files') { upload(e.target.files); e.target.value = ''; } });
  host.addEventListener('input', (e) => {
    if (e.target.id !== 'md-search') return;
    filter = e.target.value.trim().toLowerCase();
    const pos = e.target.selectionStart;
    render();
    const box = document.getElementById('md-search');
    box.focus();
    box.setSelectionRange(pos, pos);
  });
  host.addEventListener('dragover', (e) => { if (e.target.closest('#md-drop')) { e.preventDefault(); document.getElementById('md-drop').classList.add('over'); } });
  host.addEventListener('dragleave', (e) => { const d = document.getElementById('md-drop'); if (d && !d.contains(e.relatedTarget)) d.classList.remove('over'); });
  host.addEventListener('drop', (e) => {
    if (!e.target.closest('#md-drop')) return;
    e.preventDefault();
    document.getElementById('md-drop').classList.remove('over');
    upload(e.dataTransfer.files);
  });

  checkAdmin().then((isAdmin) => {
    if (!isAdmin) { host.innerHTML = '<div class="card"><p style="margin:0;color:var(--gray)">The media library requires an admin login. <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.</p></div>'; return; }
    load().catch((err) => { host.innerHTML = `<div class="card" style="color:var(--danger)">${escapeHtml(err.message)}</div>`; });
  });
})();

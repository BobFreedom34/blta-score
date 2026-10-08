// Backend > Carousel (/carousel-admin): the pictures of the image carousel at the top of the home page — upload, order, a caption
// (Slovak / English) and a link for each, and a switch to hide one without deleting it.
(function carouselAdmin() {
  const host = document.getElementById('carousel-admin-root');
  if (!host) return;

  const field = 'display:block;width:100%;margin-top:4px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  let slides = [];

  function rowHtml(s, i) {
    return `
      <div class="ca-row" data-id="${s.id}" style="display:flex;gap:14px;flex-wrap:wrap;padding:14px 0;border-top:1px solid #eee">
        <div style="display:flex;flex-direction:column;gap:12px;width:200px;${s.active ? '' : 'opacity:.4'}">
          <div>
            <div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:4px">Desktop · 16:6</div>
            <img src="${escapeHtml(s.imageUrl)}" alt="" style="display:block;width:200px;height:75px;object-fit:cover;border-radius:10px;background:#eee">
          </div>
          <div>
            <div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:4px">Mobile · 16:9</div>
            ${s.mobileImageUrl
              ? `<img src="${escapeHtml(s.mobileImageUrl)}" alt="" style="display:block;width:200px;height:112px;object-fit:cover;border-radius:10px;background:#eee">`
              : '<div style="width:200px;height:112px;border-radius:10px;border:1.5px dashed #ccc;display:grid;place-items:center;text-align:center;font-size:12px;font-weight:600;color:var(--gray);padding:0 10px">none — phones get the desktop picture, cut to 16:9</div>'}
            <div style="display:flex;gap:6px;margin-top:6px">
              <button type="button" class="btn btn-sm btn-outline" data-act="mobile-upload">${s.mobileImageUrl ? 'Replace' : 'Upload mobile picture'}</button>
              ${s.mobileImageUrl ? '<button type="button" class="btn btn-sm btn-outline" data-act="mobile-remove">Remove</button>' : ''}
            </div>
          </div>
        </div>
        <div style="flex:1;min-width:240px">
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <label style="flex:1;min-width:180px;font-size:12px;font-weight:700">Heading (Slovak) <span style="font-weight:600;color:var(--gray)">— bold</span>
              <input type="text" class="ca-sk" maxlength="120" value="${escapeHtml(s.captionSk)}" style="${field}">
            </label>
            <label style="flex:1;min-width:180px;font-size:12px;font-weight:700">Heading (English)
              <input type="text" class="ca-en" maxlength="120" value="${escapeHtml(s.captionEn)}" placeholder="falls back to the Slovak heading" style="${field}">
            </label>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
            <label style="flex:1;min-width:180px;font-size:12px;font-weight:700">Subtext (Slovak) <span style="font-weight:600;color:var(--gray)">— thin, under the heading</span>
              <input type="text" class="ca-sub-sk" maxlength="240" value="${escapeHtml(s.subtextSk)}" style="${field}">
            </label>
            <label style="flex:1;min-width:180px;font-size:12px;font-weight:700">Subtext (English)
              <input type="text" class="ca-sub-en" maxlength="240" value="${escapeHtml(s.subtextEn)}" placeholder="falls back to the Slovak subtext" style="${field}">
            </label>
          </div>
          <label style="display:block;font-size:12px;font-weight:700;margin-top:10px">Link <span style="font-weight:600;color:var(--gray)">(optional — a page like /players or a full https:// address)</span>
            <input type="text" class="ca-link" maxlength="500" value="${escapeHtml(s.link)}" style="${field}">
          </label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">
            <button type="button" class="btn btn-sm btn-primary" data-act="save">Save</button>
            <label style="font-size:14px;font-weight:600"><input type="checkbox" class="ca-active"${s.active ? ' checked' : ''}> Shown on the home page</label>
            <span style="flex:1"></span>
            <button type="button" class="btn btn-sm btn-outline" data-act="up"${i === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" class="btn btn-sm btn-outline" data-act="down"${i === slides.length - 1 ? ' disabled' : ''}>↓</button>
            <button type="button" class="btn btn-sm btn-danger" data-act="delete">Delete</button>
            <span class="ca-msg" style="font-weight:600"></span>
          </div>
        </div>
      </div>`;
  }

  function render() {
    host.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">Add pictures</h3>
        <p style="color:var(--gray);margin:0 0 10px;font-size:14px">PNG, JPG or WebP, up to 6 MB each. These are the <b>desktop</b> pictures: a wide picture (about <b>16:6</b>, e.g. 1600 × 600) fills the banner best. Pick several files to add them at once. Every picture can then get its own <b>mobile</b> picture at <b>16:9</b> (e.g. 1280 × 720) with the button under it; without one, phones get the desktop picture cut to 16:9 from the middle.</p>
        <input type="file" id="ca-files" accept="image/png,image/jpeg,image/webp" multiple>
        <button type="button" class="btn btn-primary" id="ca-upload" style="margin-left:8px">Upload</button>
        <div id="ca-upload-msg" style="font-weight:600;margin-top:8px"></div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Pictures <span style="font-weight:600;font-size:12px;color:var(--gray)">— in this order on the home page; the home page shows nothing when there is none</span></h3>
        ${slides.length ? slides.map(rowHtml).join('') : '<span style="color:var(--gray)">No pictures yet.</span>'}
      </div>`;
  }

  async function load() {
    slides = await api('/carousel/all');
    render();
  }

  function say(row, text, bad) {
    const el = row.querySelector('.ca-msg');
    el.textContent = text;
    el.style.color = bad ? 'var(--danger)' : 'var(--green, #2e9e4f)';
  }

  async function upload() {
    const input = document.getElementById('ca-files');
    const msg = document.getElementById('ca-upload-msg');
    const files = [...input.files];
    if (!files.length) { msg.textContent = 'Choose a picture first.'; msg.style.color = 'var(--danger)'; return; }
    msg.style.color = 'var(--gray)';
    let done = 0;
    for (const file of files) {
      msg.textContent = `Uploading ${done + 1} of ${files.length}…`;
      const form = new FormData();
      form.append('image', file);
      const res = await fetch('/api/carousel', { method: 'POST', body: form, credentials: 'same-origin' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        msg.textContent = `${file.name}: ${err.error || 'upload failed'}`;
        msg.style.color = 'var(--danger)';
        await load();
        return;
      }
      done += 1;
    }
    await load();
    document.getElementById('ca-upload-msg').textContent = `${done} picture${done === 1 ? '' : 's'} added ✓`;
    document.getElementById('ca-upload-msg').style.color = 'var(--green, #2e9e4f)';
  }

  // the mobile picture of a slide: choose a file, it goes up at once and replaces the previous one
  host.addEventListener('change', async (e) => {
    const input = e.target.closest('.ca-mobile-input');
    if (!input) return;
    const file = input.files && input.files[0];
    const id = Number(input.dataset.id);
    input.remove();
    if (!file) return;
    const row = host.querySelector(`.ca-row[data-id="${id}"]`);
    say(row, 'Uploading…');
    try {
      const form = new FormData();
      form.append('image', file);
      const res = await fetch(`/api/carousel/${id}/mobile-image`, { method: 'POST', body: form, credentials: 'same-origin' });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || 'upload failed');
      await load();
      say(host.querySelector(`.ca-row[data-id="${id}"]`), 'Mobile picture saved ✓');
    } catch (err) {
      say(row, err.message, true);
    }
  });

  host.addEventListener('click', async (e) => {
    if (e.target.id === 'ca-upload') { upload(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('.ca-row');
    const id = Number(row.dataset.id);
    const i = slides.findIndex((s) => s.id === id);
    try {
      if (btn.dataset.act === 'save') {
        await api(`/carousel/${id}`, { method: 'PATCH', body: {
          captionSk: row.querySelector('.ca-sk').value,
          captionEn: row.querySelector('.ca-en').value,
          subtextSk: row.querySelector('.ca-sub-sk').value,
          subtextEn: row.querySelector('.ca-sub-en').value,
          link: row.querySelector('.ca-link').value,
          active: row.querySelector('.ca-active').checked,
        } });
        await load();
        say(host.querySelector(`.ca-row[data-id="${id}"]`), 'Saved ✓');
      } else if (btn.dataset.act === 'up' || btn.dataset.act === 'down') {
        const j = btn.dataset.act === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= slides.length) return;
        // renumber 0..n so two slides never share a place, then swap the two
        const order = slides.map((s) => s.id);
        [order[i], order[j]] = [order[j], order[i]];
        await Promise.all(order.map((sid, n) => api(`/carousel/${sid}`, { method: 'PATCH', body: { sortOrder: n } })));
        await load();
      } else if (btn.dataset.act === 'mobile-upload') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/webp';
        input.className = 'ca-mobile-input';
        input.dataset.id = String(id);
        input.style.display = 'none';
        host.appendChild(input);
        input.click();
      } else if (btn.dataset.act === 'mobile-remove') {
        await api(`/carousel/${id}/mobile-image`, { method: 'DELETE' });
        await load();
      } else if (btn.dataset.act === 'delete') {
        if (!window.confirm('Delete this picture?')) return;
        await api(`/carousel/${id}`, { method: 'DELETE' });
        await load();
      }
    } catch (err) {
      say(row, err.message, true);
    }
  });

  checkAdmin().then((isAdmin) => {
    if (isAdmin) { load().catch((err) => { host.innerHTML = `<div class="card" style="color:var(--danger)">${escapeHtml(err.message)}</div>`; }); return; }
    host.innerHTML = '<div class="card"><p style="margin:0;color:var(--gray)">Managing the carousel requires an admin login. <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.</p></div>';
  });
})();

// Backend > Blog (/blog-admin): the articles of the public blog. A list (newest first) and an editor with a Slovak and an English version of the
// title, the address, the short text and the text of the article, the texts for search engines, one featured picture, the date and the status
// (published / draft). The text is HTML with a small toolbar; it is cleaned on the server when saved. API: /api/articles (src/routes/blog.js).
(function blogAdmin() {
  const host = document.getElementById('blog-admin-root');
  if (!host) return;

  const field = 'display:block;width:100%;margin-top:4px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  const label = 'display:block;font-size:12px;font-weight:700;margin-top:12px';
  const LANGS = [['Sk', 'Slovenčina'], ['En', 'English']];
  let articles = [];
  let editing = null; // null = the list, 0 = a new article, else the id
  let draft = null; // the form's values while editing
  let lang = 'Sk';

  const say = (el, text, bad) => { if (!el) return; el.textContent = text; el.style.color = bad ? 'var(--danger)' : 'var(--green, #2e9e4f)'; el.style.fontWeight = '600'; };
  const day = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`; };
  const localInput = (iso) => { const d = new Date(iso || Date.now()); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

  async function load() {
    articles = await api('/articles/admin');
    render();
  }

  // ---------------------------------------------------------------- the list

  function listHtml() {
    const rows = articles.map((a) => `
      <div class="blg-row" data-id="${a.id}" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:10px 0;border-top:1px solid #eee">
        <div style="flex:1;min-width:220px">
          <b>${escapeHtml(a.titleSk)}</b>
          <div style="font-size:12px;color:var(--gray)">${escapeHtml(day(a.publishedAt))} · <code>${escapeHtml(a.urls.sk)}</code></div>
        </div>
        <span style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;padding:3px 9px;border-radius:8px;${a.status === 'PUBLISHED' ? 'background:var(--green);color:#0a0a0a' : 'background:#ddd;color:#555'}">${a.status === 'PUBLISHED' ? 'Published' : 'Draft'}</span>
        ${a.status === 'PUBLISHED' ? `<a class="btn btn-sm btn-outline" href="${escapeHtml(a.urls.sk)}" target="_blank" rel="noopener">View</a>` : ''}
        <button type="button" class="btn btn-sm btn-primary" data-act="edit">Edit</button>
        <button type="button" class="btn btn-sm btn-danger" data-act="delete">Delete</button>
      </div>`).join('');
    return `
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <h3 style="margin:0">Articles <span style="font-weight:600;color:var(--gray);font-size:13px">(${articles.length})</span></h3>
          <button type="button" class="btn btn-primary" data-act="new">+ New article</button>
        </div>
        ${rows || '<div class="empty-state" style="padding:12px 0">No articles yet.</div>'}
      </div>`;
  }

  // ---------------------------------------------------------------- the editor

  function blank() {
    return { id: 0, slugSk: '', slugEn: '', titleSk: '', titleEn: '', excerptSk: '', excerptEn: '', bodySk: '', bodyEn: '', imageUrl: '', seoTitleSk: '', seoTitleEn: '', seoDescSk: '', seoDescEn: '', keywordsSk: '', keywordsEn: '', status: 'PUBLISHED', publishedAt: new Date().toISOString() };
  }

  function langFields(l) {
    const sk = l === 'Sk';
    const hint = (t) => `<span style="font-weight:600;color:var(--gray)"> ${t}</span>`;
    return `
      <label style="${label}">Title${sk ? '' : hint('(empty = the Slovak one)')}
        <input type="text" data-f="title${l}" value="${escapeHtml(draft[`title${l}`])}" maxlength="200" style="${field}">
      </label>
      <label style="${label}">Address${hint(sk ? '(letters, digits and hyphens; empty = made from the title)' : '(empty = the same as the Slovak one)')}
        <span style="display:flex;align-items:center;gap:4px"><span style="font-weight:700;color:var(--gray);white-space:nowrap">${sk ? '/' : '/en/'}</span><input type="text" data-f="slug${l}" value="${escapeHtml(draft[`slug${l}`])}" maxlength="80" style="${field}"></span>
      </label>
      <label style="${label}">Short text for the list${hint(sk ? '' : '(empty = the Slovak one)')}
        <textarea data-f="excerpt${l}" rows="2" maxlength="400" style="${field};resize:vertical">${escapeHtml(draft[`excerpt${l}`])}</textarea>
      </label>
      <div style="${label}">Text of the article${hint(sk ? '' : '(empty = the Slovak one)')}</div>
      <div class="blg-pane">
        ${RichEditor.toolbarHtml()}
        <div style="margin:6px 0"><button type="button" class="btn btn-sm btn-outline" data-act="insert-img">Picture…</button></div>
        <div class="blg-rte blog-body pr-edit" contenteditable="true" style="padding:14px;background:#161618;border-radius:10px">${RichEditor.tidy(draft[`body${l}`] || '')}</div>
        <textarea class="blg-source" data-f="body${l}" rows="16" style="${field};font-family:ui-monospace,Consolas,monospace;font-size:13px;resize:vertical;display:none">${escapeHtml(draft[`body${l}`])}</textarea>
      </div>
      <div style="margin-top:16px;padding-top:6px;border-top:1px solid #eee;font-weight:800">For search engines${hint('(what Google and link previews show)')}</div>
      <label style="${label}">Title tag${hint(sk ? '(empty = the title + " - BLTA - …")' : '(empty = the Slovak one, or the title + " - BLTA - …")')}
        <input type="text" data-f="seoTitle${l}" value="${escapeHtml(draft[`seoTitle${l}`])}" maxlength="200" style="${field}">
      </label>
      <label style="${label}">Description${hint('(about 150 characters; empty = the short text)')}
        <textarea data-f="seoDesc${l}" rows="2" maxlength="400" style="${field};resize:vertical">${escapeHtml(draft[`seoDesc${l}`])}</textarea>
      </label>
      <label style="${label}">Keywords${hint('(optional)')}
        <input type="text" data-f="keywords${l}" value="${escapeHtml(draft[`keywords${l}`])}" maxlength="300" style="${field}">
      </label>`;
  }

  function editorHtml() {
    const tabs = LANGS.map(([l, name]) => `<button type="button" class="tab${lang === l ? ' active' : ''}" data-lang="${l}">${name}</button>`).join('');
    return `
      <div class="card" style="margin-bottom:16px" data-sec-open="1">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <h3 style="margin:0">${draft.id ? 'Edit article' : 'New article'}</h3>
          <button type="button" class="btn btn-sm btn-outline" data-act="back">← All articles</button>
        </div>
        <div class="tabs" style="margin-top:12px">${tabs}</div>
        <div id="blg-lang">${langFields(lang)}</div>
        <div style="margin-top:18px;padding-top:6px;border-top:1px solid #eee;font-weight:800">For both languages</div>
        <label style="${label}">Featured picture${'<span style="font-weight:600;color:var(--gray)"> (the list, the link preview and the top of the article)</span>'}
          <span style="display:flex;gap:8px;align-items:center"><input type="text" data-f="imageUrl" value="${escapeHtml(draft.imageUrl)}" placeholder="https://… or /blog-images/…" style="${field}"><button type="button" class="btn btn-sm btn-outline" data-act="upload-main" style="white-space:nowrap">Upload…</button></span>
        </label>
        <div id="blg-thumb" style="margin-top:8px">${draft.imageUrl ? `<img src="${escapeHtml(draft.imageUrl)}" alt="" style="max-height:120px;border-radius:8px">` : ''}</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap">
          <label style="${label};flex:1;min-width:200px">Date<input type="datetime-local" data-f="publishedAt" value="${escapeHtml(localInput(draft.publishedAt))}" style="${field}"></label>
          <label style="${label};flex:1;min-width:200px">Status
            <select data-f="status" style="${field}"><option value="PUBLISHED"${draft.status === 'PUBLISHED' ? ' selected' : ''}>Published</option><option value="DRAFT"${draft.status === 'DRAFT' ? ' selected' : ''}>Draft (not visible)</option></select>
          </label>
        </div>
        <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;align-items:center">
          <button type="button" class="btn btn-primary" data-act="save">Save</button>
          <button type="button" class="btn btn-outline" data-act="back">Cancel</button>
          <span id="blg-msg"></span>
        </div>
        <input type="file" id="blg-file" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none">
      </div>`;
  }

  function render() {
    host.innerHTML = editing === null ? listHtml() : editorHtml();
  }

  // the form's current values back into `draft` (what is on screen for the language shown + the shared fields)
  function collect() {
    // the text of the article: what is in the visual editor (the HTML view keeps its own text in the textarea)
    host.querySelectorAll('.blg-pane').forEach((p) => { const src = p.querySelector('.blg-source'); if (src.style.display === 'none') src.value = p.querySelector('.blg-rte').innerHTML; });
    host.querySelectorAll('[data-f]').forEach((el) => {
      const k = el.dataset.f;
      draft[k] = k === 'publishedAt' ? new Date(el.value || Date.now()).toISOString() : el.value;
    });
  }

  // ---------------------------------------------------------------- the toolbar

  async function uploadPicture() {
    const input = host.querySelector('#blg-file');
    return new Promise((resolve) => {
      input.value = '';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return resolve(null);
        const form = new FormData();
        form.append('image', file);
        try {
          const res = await fetch('/api/articles/upload', { method: 'POST', body: form, credentials: 'same-origin' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Upload failed');
          resolve(data.url);
        } catch (err) { say(host.querySelector('#blg-msg'), err.message, true); resolve(null); }
      };
      input.click();
    });
  }

  // ---------------------------------------------------------------- events

  host.addEventListener('click', async (e) => {
    const lg = e.target.closest('[data-lang]');
    if (lg) { collect(); lang = lg.dataset.lang; render(); return; }
    if (RichEditor.handleToolbarClick(e, { pane: '.blg-pane', editor: '.blg-rte', source: '.blg-source' })) return; // the toolbar of the text (shared with Rules and Info)
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = e.target.closest('.blg-row');
    const act = btn.dataset.act;
    if (act === 'new') { draft = blank(); editing = 0; lang = 'Sk'; render(); return; }
    if (act === 'edit') { const a = articles.find((x) => x.id === Number(row.dataset.id)); draft = { ...a }; editing = a.id; lang = 'Sk'; render(); return; }
    if (act === 'back') { editing = null; draft = null; render(); return; }
    if (act === 'delete') {
      const a = articles.find((x) => x.id === Number(row.dataset.id));
      if (!window.confirm(`Delete "${a.titleSk}"? Its address stops working (404). This cannot be undone.`)) return;
      try { await api(`/articles/admin/${a.id}`, { method: 'DELETE' }); await load(); } catch (err) { window.alert(err.message); }
      return;
    }
    if (act === 'insert-img') {
      const url = await uploadPicture();
      if (url) RichEditor.insertHtmlAtCursor(host.querySelector('.blg-rte'), `<p><img src="${escapeHtml(url)}" alt=""></p>`);
      return;
    }
    if (act === 'upload-main') {
      const url = await uploadPicture();
      if (url) { host.querySelector('[data-f="imageUrl"]').value = url; host.querySelector('#blg-thumb').innerHTML = `<img src="${escapeHtml(url)}" alt="" style="max-height:120px;border-radius:8px">`; }
      return;
    }
    if (act === 'save') {
      collect();
      const msg = host.querySelector('#blg-msg');
      try {
        const saved = editing ? await api(`/articles/admin/${editing}`, { method: 'PUT', body: draft }) : await api('/articles/admin', { method: 'POST', body: draft });
        await load();
        editing = saved.id; draft = { ...saved }; render();
        say(host.querySelector('#blg-msg'), `Saved ✓  ${saved.status === 'PUBLISHED' ? `${saved.urls.sk}` : '(draft: not visible)'}`);
      } catch (err) { say(msg, err.message, true); }
    }
  });

  host.addEventListener('mousedown', (e) => { if (e.target.closest('.rte-toolbar button')) e.preventDefault(); });
  host.addEventListener('change', (e) => { RichEditor.handleToolbarChange(e, { pane: '.blg-pane', editor: '.blg-rte', source: '.blg-source' }); });

  host.addEventListener('input', (e) => {
    if (e.target.dataset && e.target.dataset.f === 'imageUrl') {
      const v = e.target.value.trim();
      host.querySelector('#blg-thumb').innerHTML = v ? `<img src="${escapeHtml(v)}" alt="" style="max-height:120px;border-radius:8px">` : '';
    }
  });

  checkAdmin().then((isAdmin) => {
    if (isAdmin) { load().catch((err) => { host.innerHTML = `<div class="card" style="color:var(--danger)">${escapeHtml(err.message)}</div>`; }); return; }
    host.innerHTML = '<div class="card"><p style="margin:0;color:var(--gray)">Managing the blog requires an admin login. <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.</p></div>';
  });
})();

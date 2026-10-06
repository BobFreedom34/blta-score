// Backend > Rules (/rules-admin): the text of the public Propozície page, section by section — a title, a short label for the
// buttons at the top of the page, and a formatted text (bold, lists, links; the tiles and tables of the page can be edited in
// place, and "HTML" shows the code for adding or removing one).
(function rulesAdmin() {
  const host = document.getElementById('rules-admin-root');
  if (!host) return;

  const field = 'display:block;width:100%;margin-top:4px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  let sections = [];
  const openIds = new Set();

  // text pasted into the editor keeps no formatting: its lines become paragraphs
  function paragraphs(text) {
    return String(text).split(/\r?\n+/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${escapeHtml(l)}</p>`).join('');
  }

  // code typed in the HTML view is cleaned of scripts and event handlers before it goes into the editor (the server keeps only
  // the page's own tags and classes when it is saved)
  function tidy(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    t.content.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove());
    t.content.querySelectorAll('*').forEach((n) => [...n.attributes].forEach((a) => { if (/^on/i.test(a.name)) n.removeAttribute(a.name); }));
    return t.innerHTML;
  }

  function toolbarHtml() {
    return `
      <div class="rte-toolbar">
        <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
        <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
        <button type="button" data-cmd="underline" title="Underline"><u>U</u></button>
        <button type="button" data-cmd="heading" title="Sub-heading">H</button>
        <button type="button" data-cmd="insertUnorderedList" title="Bulleted list">• List</button>
        <button type="button" data-cmd="insertOrderedList" title="Numbered list">1. List</button>
        <button type="button" data-cmd="link" title="Link">Link</button>
        <button type="button" data-cmd="removeFormat" title="Remove formatting">Clear</button>
        <button type="button" data-cmd="source" title="Show the HTML code" style="margin-left:auto">&lt;/&gt; HTML</button>
      </div>`;
  }

  function cardHtml(s, i) {
    return `
      <details class="card rl-card" data-id="${s.id}" style="margin-bottom:12px"${openIds.has(s.id) ? ' open' : ''}>
        <summary style="cursor:pointer;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;list-style:none">
          <strong>${escapeHtml(s.title)}</strong>
          <span style="color:var(--gray);font-size:13px">#${escapeHtml(s.slug)}${s.navLabel ? '' : ' · not in the buttons at the top'}</span>
        </summary>
        <div class="rl-form">
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
            <label style="flex:2;min-width:240px;font-size:12px;font-weight:700">Title
              <input type="text" class="rl-title" maxlength="120" value="${escapeHtml(s.title)}" style="${field}">
            </label>
            <label style="flex:1;min-width:180px;font-size:12px;font-weight:700">Button at the top <span style="font-weight:600;color:var(--gray)">(empty = none)</span>
              <input type="text" class="rl-nav" maxlength="40" value="${escapeHtml(s.navLabel)}" style="${field}">
            </label>
          </div>
          <div style="font-size:12px;font-weight:700;margin-top:12px">Text</div>
          ${toolbarHtml()}
          <div class="rl-editor pr-card pr-edit" contenteditable="true">${s.html}</div>
          <textarea class="rl-source" rows="14" spellcheck="false" style="${field};font-family:Consolas,monospace;font-size:13px;display:none"></textarea>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px">
            <button type="button" class="btn btn-primary" data-act="save">Save</button>
            <button type="button" class="btn btn-sm btn-outline" data-act="up"${i === 0 ? ' disabled' : ''}>↑ Move up</button>
            <button type="button" class="btn btn-sm btn-outline" data-act="down"${i === sections.length - 1 ? ' disabled' : ''}>↓ Move down</button>
            ${s.original ? '<button type="button" class="btn btn-sm btn-outline" data-act="reset">Back to the first text</button>' : ''}
            <span style="flex:1"></span>
            <button type="button" class="btn btn-sm btn-danger" data-act="delete">Delete section</button>
            <span class="rl-msg" style="font-weight:600"></span>
          </div>
        </div>
      </details>`;
  }

  function render() {
    host.innerHTML = `
      <p style="color:var(--gray-dim);margin:0 0 14px">Changes show on <a href="/propozicie" target="_blank" style="text-decoration:underline;color:var(--orange)">/propozicie</a> as soon as you press Save. The buttons at the top of the page follow the sections, in this order.</p>
      ${sections.map(cardHtml).join('') || '<div class="card" style="color:var(--gray)">No sections yet.</div>'}
      <div class="card" style="margin-top:20px">
        <h3 style="margin-top:0">Add a section</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <label style="flex:2;min-width:240px;font-size:12px;font-weight:700">Title
            <input type="text" id="rl-new-title" maxlength="120" style="${field}">
          </label>
          <label style="flex:1;min-width:180px;font-size:12px;font-weight:700">Button at the top <span style="font-weight:600;color:var(--gray)">(optional)</span>
            <input type="text" id="rl-new-nav" maxlength="40" style="${field}">
          </label>
        </div>
        <div style="margin-top:12px;display:flex;gap:10px;align-items:center">
          <button type="button" class="btn btn-primary" id="rl-add">Add section</button>
          <span id="rl-add-msg" style="font-weight:600"></span>
        </div>
      </div>`;
  }

  async function load() {
    sections = await api('/rules');
    render();
  }

  const cardOf = (el) => el.closest('.rl-card');
  const say = (card, text, bad) => {
    const m = card.querySelector('.rl-msg');
    m.textContent = text;
    m.style.color = bad ? 'var(--danger)' : 'var(--green, #2e9e4f)';
  };
  const bodyOf = (card) => {
    const src = card.querySelector('.rl-source');
    return src.style.display !== 'none' ? tidy(src.value) : card.querySelector('.rl-editor').innerHTML;
  };

  host.addEventListener('toggle', (e) => {
    const c = e.target.closest && e.target.closest('.rl-card');
    if (c && c === e.target) { const id = Number(c.dataset.id); if (c.open) openIds.add(id); else openIds.delete(id); }
  }, true);

  // the toolbar acts on the selection of the editor above it
  host.addEventListener('mousedown', (e) => { if (e.target.closest('.rte-toolbar button')) e.preventDefault(); });
  host.addEventListener('click', async (e) => {
    const tb = e.target.closest('.rte-toolbar [data-cmd]');
    if (tb) {
      const card = cardOf(tb);
      const rte = card.querySelector('.rl-editor');
      const src = card.querySelector('.rl-source');
      const cmd = tb.dataset.cmd;
      if (cmd === 'source') {
        if (src.style.display === 'none') { src.value = rte.innerHTML; src.style.display = 'block'; rte.style.display = 'none'; tb.style.borderColor = 'var(--orange)'; }
        else { rte.innerHTML = tidy(src.value); src.style.display = 'none'; rte.style.display = ''; tb.style.borderColor = ''; }
        return;
      }
      if (src.style.display !== 'none') return; // the buttons act on the formatted view
      rte.focus();
      if (cmd === 'link') {
        const url = window.prompt('Link address (https://…, mailto:… or /page)');
        if (url) document.execCommand('createLink', false, url);
      } else if (cmd === 'heading') {
        const inHeading = document.queryCommandValue('formatBlock').toLowerCase() === 'h3';
        document.execCommand('formatBlock', false, inHeading ? 'p' : 'h3');
      } else {
        document.execCommand(cmd, false, null);
      }
      return;
    }

    if (e.target.id === 'rl-add') {
      const title = document.getElementById('rl-new-title').value;
      const msg = document.getElementById('rl-add-msg');
      try {
        const created = await api('/rules', { method: 'POST', body: { title, navLabel: document.getElementById('rl-new-nav').value, html: '<p></p>' } });
        openIds.add(created.id);
        await load();
      } catch (err) { msg.textContent = err.message; msg.style.color = 'var(--danger)'; }
      return;
    }

    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = cardOf(btn);
    const id = Number(card.dataset.id);
    try {
      if (btn.dataset.act === 'save') {
        const saved = await api(`/rules/${id}`, { method: 'PUT', body: { title: card.querySelector('.rl-title').value, navLabel: card.querySelector('.rl-nav').value, html: bodyOf(card) } });
        sections = sections.map((s) => (s.id === id ? saved : s));
        openIds.add(id);
        render();
        say(host.querySelector(`.rl-card[data-id="${id}"]`), 'Saved ✓');
      } else if (btn.dataset.act === 'up' || btn.dataset.act === 'down') {
        openIds.add(id);
        sections = await api(`/rules/${id}/move`, { method: 'POST', body: { dir: btn.dataset.act } });
        render();
      } else if (btn.dataset.act === 'reset') {
        if (!window.confirm('Put the first text of this section back? Your changes to it are lost.')) return;
        const saved = await api(`/rules/${id}/reset`, { method: 'POST' });
        sections = sections.map((s) => (s.id === id ? saved : s));
        openIds.add(id);
        render();
        say(host.querySelector(`.rl-card[data-id="${id}"]`), 'Back to the first text ✓');
      } else if (btn.dataset.act === 'delete') {
        const s = sections.find((x) => x.id === id);
        if (!window.confirm(`Delete the section "${s.title}"?`)) return;
        await api(`/rules/${id}`, { method: 'DELETE' });
        openIds.delete(id);
        await load();
      }
    } catch (err) {
      say(card, err.message, true);
    }
  });

  host.addEventListener('paste', (e) => {
    if (!e.target.closest || !e.target.closest('.rl-editor')) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertHTML', false, paragraphs(text));
  });

  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* the server keeps divs */ }

  checkAdmin().then((isAdmin) => {
    if (isAdmin) { load().catch((err) => { host.innerHTML = `<div class="card" style="color:var(--danger)">${escapeHtml(err.message)}</div>`; }); return; }
    host.innerHTML = '<div class="card"><p style="margin:0;color:var(--gray)">Editing the rules requires an admin login. <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.</p></div>';
  });
})();

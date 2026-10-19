// Backend > Info (/about-admin): the texts of the "Info" window of the home page, tab by tab — a title and a formatted text in Slovak and in
// English. They belong to the city that is worked on (the picker above the tabs). Data: GET /api/about, PUT / DELETE /api/about/:tab.
(function aboutAdmin() {
  const host = document.getElementById('about-admin-root');
  if (!host) return;

  const field = 'display:block;width:100%;margin-top:4px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  const TABS = [['us', 'About us'], ['rules', 'Rules'], ['cats', 'Categories'], ['dates', 'League dates'], ['tour', 'Tournaments']];
  const LANGS = [['sk', 'Slovenčina'], ['en', 'English']];
  let data = { useDefaults: false, tabs: {} };
  const openTabs = new Set();
  const langOf = new Map(); // tab -> the language that is showing

  const esc = (s) => escapeHtml(String(s == null ? '' : s));
  // the text that came with the site (public/js/i18n.js), as editable HTML — only for the first city
  const D = (lang, key) => (typeof TRANSLATIONS !== 'undefined' && ((TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || (TRANSLATIONS.en && TRANSLATIONS.en[key]))) || '';
  function defaults(tab, lang) {
    const p = (k) => `<p>${esc(D(lang, k))}</p>`;
    const withLink = (textKey, linkKey, href) => {
      const parts = esc(D(lang, textKey)).split('{link}');
      return `<p>${parts.length < 2 ? parts[0] : `${parts[0]}<a href="${href}">${esc(D(lang, linkKey))}</a>${parts[1]}`}</p>`;
    };
    if (tab === 'us') return { title: D(lang, 'about.us.h'), html: `<p><strong>${esc(D(lang, 'about.us.lead'))}</strong></p>${[1, 2, 3, 4, 5].map((n) => p(`about.us.p${n}`)).join('')}<p><strong>${esc(D(lang, 'about.us.sign'))}</strong></p>` };
    if (tab === 'rules') return { title: D(lang, 'about.rules.h'), html: `${p('about.rules.lead')}${withLink('about.rules.p1', 'about.rules.link', '/propozicie')}<p><strong>${esc(D(lang, 'about.rules.inside'))}</strong></p><ol>${[1, 2, 3, 4].map((n) => `<li><strong>${esc(D(lang, `about.rules.i${n}t`))}</strong> – ${esc(D(lang, `about.rules.i${n}d`))}</li>`).join('')}</ol>${p('about.rules.p2')}` };
    if (tab === 'cats') return { title: D(lang, 'about.cats.h'), html: `${p('about.cats.p')}<ul><li><strong>Novice</strong> – ${esc(D(lang, 'about.cats.novice'))}</li><li><strong>Next Gen</strong> – ${esc(D(lang, 'about.cats.nextgen'))}</li><li><strong>Elite</strong> – ${esc(D(lang, 'about.cats.elite'))}</li></ul>` };
    if (tab === 'dates') return { title: D(lang, 'about.dates.h'), html: `${p('about.dates.p')}<ul><li><strong>Winter Opening Series</strong> – ${esc(D(lang, 'about.dates.winter'))}</li><li><strong>Summer Rally Series</strong> – ${esc(D(lang, 'about.dates.summer'))}</li><li><strong>Autumn Finals Series</strong> – ${esc(D(lang, 'about.dates.autumn'))}</li></ul>${p('about.dates.foot')}` };
    return { title: D(lang, 'about.tour.h'), html: `${withLink('about.tour.p1', 'about.tour.link', '/harmonogram')}<p><strong>${esc(D(lang, 'about.tour.strong'))}</strong> ${esc(D(lang, 'about.tour.p2'))}</p>` };
  }

  // what a language of a tab holds now: what the city saved, else (first city) the first text, else nothing
  function valueOf(tab, lang) {
    const saved = data.tabs[tab] && data.tabs[tab][lang];
    if (saved) return saved;
    return data.useDefaults ? defaults(tab, lang) : { title: '', html: '' };
  }

  function paragraphs(text) {
    return String(text).split(/\r?\n+/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('');
  }
  function tidy(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    t.content.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove());
    t.content.querySelectorAll('*').forEach((n) => [...n.attributes].forEach((a) => { if (/^on/i.test(a.name)) n.removeAttribute(a.name); }));
    return t.innerHTML;
  }

  const toolbar = `
    <div class="rte-toolbar">
      <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
      <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
      <button type="button" data-cmd="heading" title="Sub-heading">H</button>
      <button type="button" data-cmd="insertUnorderedList" title="Bulleted list">• List</button>
      <button type="button" data-cmd="insertOrderedList" title="Numbered list">1. List</button>
      <button type="button" data-cmd="link" title="Link">Link</button>
      <button type="button" data-cmd="removeFormat" title="Remove formatting">Clear</button>
      <button type="button" data-cmd="source" title="Show the HTML code" style="margin-left:auto">&lt;/&gt; HTML</button>
    </div>`;

  function panel(tab, lang, shown) {
    const v = valueOf(tab, lang);
    return `
      <div class="ab-panel" data-lang="${lang}"${shown ? '' : ' style="display:none"'}>
        <label style="display:block;font-size:12px;font-weight:700;margin-top:12px">Title
          <input type="text" class="ab-title" maxlength="120" value="${esc(v.title)}" style="${field}">
        </label>
        <div style="font-size:12px;font-weight:700;margin-top:12px">Text</div>
        ${toolbar}
        <div class="ab-editor pr-card pr-edit" contenteditable="true">${v.html}</div>
        <textarea class="ab-source" rows="12" spellcheck="false" style="${field};font-family:Consolas,monospace;font-size:13px;display:none"></textarea>
      </div>`;
  }

  function card([tab, name]) {
    const saved = !!data.tabs[tab];
    const lang = langOf.get(tab) || 'sk';
    return `
      <details class="card ab-card" data-tab-key="${tab}" style="margin-bottom:12px"${openTabs.has(tab) ? ' open' : ''}>
        <summary style="cursor:pointer;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;list-style:none">
          <strong>${name}</strong>
          <span style="color:var(--gray);font-size:13px">${saved ? 'written for this city' : (data.useDefaults ? 'the text that came with the site' : 'empty — the tab is not shown')}</span>
        </summary>
        <div class="ab-form">
          <div style="display:flex;gap:8px;margin-top:14px">
            ${LANGS.map(([code, label]) => `<button type="button" class="btn ${code === lang ? 'btn-primary' : 'btn-outline'}" data-lang-tab="${code}">${label}</button>`).join('')}
          </div>
          ${LANGS.map(([code]) => panel(tab, code, code === lang)).join('')}
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px">
            <button type="button" class="btn btn-primary" data-act="save">Save</button>
            ${saved ? `<button type="button" class="btn btn-sm btn-outline" data-act="remove">${data.useDefaults ? 'Back to the first text' : 'Remove this tab'}</button>` : ''}
            <span class="ab-msg" style="font-weight:600"></span>
          </div>
        </div>
      </details>`;
  }

  function render() {
    host.innerHTML = TABS.map(card).join('');
  }

  const cardOf = (el) => el.closest('.ab-card');
  const say = (c, text, bad) => { const m = c.querySelector('.ab-msg'); m.textContent = text; m.style.color = bad ? 'var(--danger)' : 'var(--green, #2e9e4f)'; };
  const htmlOf = (p) => {
    const src = p.querySelector('.ab-source');
    return src.style.display !== 'none' ? tidy(src.value) : p.querySelector('.ab-editor').innerHTML;
  };

  host.addEventListener('toggle', (e) => {
    const c = e.target.closest && e.target.closest('.ab-card');
    if (c && c === e.target) { if (c.open) openTabs.add(c.dataset.tabKey); else openTabs.delete(c.dataset.tabKey); }
  }, true);
  host.addEventListener('mousedown', (e) => { if (e.target.closest('.rte-toolbar button')) e.preventDefault(); });

  host.addEventListener('click', async (e) => {
    const lang = e.target.closest('[data-lang-tab]');
    if (lang) {
      const c = cardOf(lang);
      langOf.set(c.dataset.tabKey, lang.dataset.langTab);
      c.querySelectorAll('[data-lang-tab]').forEach((b) => { b.classList.toggle('btn-primary', b === lang); b.classList.toggle('btn-outline', b !== lang); });
      c.querySelectorAll('.ab-panel').forEach((p) => { p.style.display = p.dataset.lang === lang.dataset.langTab ? '' : 'none'; });
      return;
    }
    const tb = e.target.closest('.rte-toolbar [data-cmd]');
    if (tb) {
      const p = tb.closest('.ab-panel');
      const rte = p.querySelector('.ab-editor');
      const src = p.querySelector('.ab-source');
      const cmd = tb.dataset.cmd;
      if (cmd === 'source') {
        if (src.style.display === 'none') { src.value = rte.innerHTML; src.style.display = 'block'; rte.style.display = 'none'; tb.style.borderColor = 'var(--orange)'; }
        else { rte.innerHTML = tidy(src.value); src.style.display = 'none'; rte.style.display = ''; tb.style.borderColor = ''; }
        return;
      }
      if (src.style.display !== 'none') return;
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
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const c = cardOf(btn);
    const tab = c.dataset.tabKey;
    try {
      if (btn.dataset.act === 'save') {
        const body = {};
        c.querySelectorAll('.ab-panel').forEach((p) => { body[p.dataset.lang] = { title: p.querySelector('.ab-title').value, html: htmlOf(p) }; });
        data = await api(`/about/${tab}`, { method: 'PUT', body });
        openTabs.add(tab);
        render();
        say(host.querySelector(`.ab-card[data-tab-key="${tab}"]`), 'Saved ✓');
      } else if (btn.dataset.act === 'remove') {
        if (!window.confirm(data.useDefaults ? 'Put the first text of this tab back? Your text is lost.' : 'Remove this tab? Your text is lost and the tab is no longer shown.')) return;
        data = await api(`/about/${tab}`, { method: 'DELETE' });
        openTabs.add(tab);
        render();
      }
    } catch (err) {
      say(c, err.message, true);
    }
  });

  host.addEventListener('paste', (e) => {
    if (!e.target.closest || !e.target.closest('.ab-editor')) return;
    e.preventDefault();
    document.execCommand('insertHTML', false, paragraphs((e.clipboardData || window.clipboardData).getData('text/plain')));
  });
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* the server keeps divs */ }

  checkAdmin().then(async (isAdmin) => {
    if (!isAdmin) { host.innerHTML = '<div class="card"><p style="margin:0;color:var(--gray)">Editing the Info window requires an admin login. <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.</p></div>'; return; }
    try { data = await api('/about'); render(); } catch (err) { host.innerHTML = `<div class="card" style="color:var(--danger)">${escapeHtml(err.message)}</div>`; }
  });
})();

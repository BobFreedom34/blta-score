// Backend > SEO (/seo-admin): the address (slug) and the title, description, keywords, link-preview texts and picture of every
// public page, in Slovak and in English, and the robots setting. The values are baked into the page's HTML on the server
// (src/seo.js); the Slovak page lives at /<slug>, the English one at /en/<slug>.
(function seoAdmin() {
  const host = document.getElementById('seo-admin-root');
  if (!host) return;

  const field = 'display:block;width:100%;margin-top:4px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  const label = 'display:block;font-size:12px;font-weight:700;margin-top:12px';
  // what Google roughly shows before it cuts the text off
  const TITLE_GOOD = 60;
  const DESC_GOOD = 160;
  const LANGS = [['sk', 'Slovenčina'], ['en', 'English']];
  const PLACEHOLDER = { sk: 'tenisová liga, Bratislava, amatérsky tenis', en: 'tennis league, Bratislava, amateur tennis' };
  let pages = [];
  const tabOf = new Map(); // page key -> the language tab that is showing

  const SAMPLE = '{name}';

  function counter(text, good) {
    const n = [...text].length;
    return `<span class="seo-count" style="font-weight:600;color:${n > good ? 'var(--danger)' : 'var(--gray)'}">${n} / ${good}</span>`;
  }

  // The address of the page in a language, for a slug: /rebricek, /en/rankings, /serie/<name>, /en/season/<name>
  function addressOf(p, lang, slug) {
    if (p.home) return lang === 'en' ? '/en' : '/';
    const param = p.template ? `/${p.path.endsWith(':id') ? '<id>' : '<name>'}` : '';
    return `${lang === 'en' ? '/en' : ''}/${slug}${param}`;
  }

  function snippet(p, lang, v, slug) {
    const sample = (t) => String(t || '').split(SAMPLE).join(p.template ? 'Example' : '');
    const url = `${location.origin}${addressOf(p, lang, slug)}`.replace('<name>', 'example').replace('<id>', '1');
    return `
      <div class="seo-snippet" style="margin-top:14px;padding:12px 14px;border-radius:10px;background:#fff;color:#202124;font-family:Arial,sans-serif">
        <div style="font-size:12px;color:#4d5156;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(url)}</div>
        <div class="seo-snip-title" style="font-size:18px;line-height:1.3;color:#1a0dab;margin:2px 0">${escapeHtml(sample(v.title) || '(no title)')}</div>
        <div class="seo-snip-desc" style="font-size:13px;line-height:1.5;color:#4d5156">${escapeHtml(sample(v.description) || '(no description)')}</div>
      </div>`;
  }

  function panelHtml(p, lang, shown) {
    const v = p.values[lang];
    const slug = p.slugs[lang];
    const slugField = p.home
      ? `<div style="font-size:13px;color:var(--gray);margin-top:12px">Address: <code>${escapeHtml(addressOf(p, lang, ''))}</code> (the home page has no slug)</div>`
      : `<label style="${label}">Address (slug) <span style="font-weight:600;color:var(--gray)">— letters, digits and hyphens; accents and spaces are turned into plain letters and hyphens</span>
          <span style="display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap">
            <code style="font-size:14px">${lang === 'en' ? '/en/' : '/'}</code>
            <input type="text" name="${lang}.slug" maxlength="60" value="${escapeHtml(slug)}" style="${field};margin-top:0;flex:1;min-width:160px">
            ${p.template ? `<code style="font-size:14px">/${p.path.endsWith(':id') ? '&lt;id&gt;' : '&lt;name&gt;'}</code>` : ''}
          </span>
        </label>`;
    return `
      <div class="seo-panel" data-lang="${lang}"${shown ? '' : ' style="display:none"'}>
        ${slugField}
        <label style="${label}">Title ${counter(v.title, TITLE_GOOD)}
          <input type="text" name="${lang}.title" maxlength="120" value="${escapeHtml(v.title)}" style="${field}">
        </label>
        <label style="${label}">Description ${counter(v.description, DESC_GOOD)}
          <textarea name="${lang}.description" rows="3" maxlength="320" style="${field}">${escapeHtml(v.description)}</textarea>
        </label>
        <label style="${label}">Keywords <span style="font-weight:600;color:var(--gray)">(optional, separated by commas — Google ignores them, some other engines read them)</span>
          <input type="text" name="${lang}.keywords" maxlength="300" value="${escapeHtml(v.keywords)}" placeholder="${escapeHtml(PLACEHOLDER[lang])}" style="${field}">
        </label>
        <div style="font-size:13px;font-weight:800;margin-top:18px">Link preview <span style="font-weight:600;color:var(--gray)">(WhatsApp, Facebook, Messenger… — empty = the title and description above)</span></div>
        <label style="${label}">Preview title
          <input type="text" name="${lang}.ogTitle" maxlength="120" value="${escapeHtml(v.ogTitle)}" style="${field}">
        </label>
        <label style="${label}">Preview description
          <textarea name="${lang}.ogDescription" rows="2" maxlength="320" style="${field}">${escapeHtml(v.ogDescription)}</textarea>
        </label>
        <label style="${label}">Preview picture <span style="font-weight:600;color:var(--gray)">(address, https://… or /img/…; empty = the BLTA logo${p.template ? ', or the season / player picture' : ''})</span>
          <input type="text" name="${lang}.ogImage" maxlength="500" value="${escapeHtml(v.ogImage)}" placeholder="/img/blta-logo.png" style="${field}">
        </label>
        ${snippet(p, lang, v, slug)}
      </div>`;
  }

  function cardHtml(p) {
    const lang = tabOf.get(p.key) || 'sk';
    return `
      <details class="card seo-card" data-key="${p.key}" style="margin-bottom:12px">
        <summary style="cursor:pointer;display:flex;gap:6px 12px;align-items:baseline;flex-wrap:wrap;list-style:none">
          <strong>${escapeHtml(p.label)}</strong>
          <span style="color:var(--gray);font-size:13px">${escapeHtml(addressOf(p, 'sk', p.slugs.sk))}</span>
          <span style="color:var(--gray);font-size:13px">${escapeHtml(addressOf(p, 'en', p.slugs.en))}</span>
          ${p.noindex ? '<span style="font-size:11px;font-weight:800;color:var(--orange)">NOINDEX</span>' : ''}
          ${p.blta ? `<a href="${escapeHtml(p.blta)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="margin-left:auto;font-size:12px;color:var(--orange);text-decoration:underline">blta.sk page ↗</a>` : ''}
        </summary>
        <form class="seo-form">
          <div class="seo-tabs" style="display:flex;gap:8px;margin-top:14px">
            ${LANGS.map(([code, name]) => `<button type="button" class="btn ${code === lang ? 'btn-primary' : 'btn-outline'}" data-tab="${code}">${name}</button>`).join('')}
          </div>
          ${LANGS.map(([code]) => panelHtml(p, code, code === lang)).join('')}
          <label style="display:flex;gap:8px;align-items:center;font-size:14px;font-weight:600;margin-top:16px">
            <input type="checkbox" name="noindex"${p.noindex ? ' checked' : ''}> Hide this page from search engines (noindex) — both languages
          </label>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:16px">
            <button type="submit" class="btn btn-primary">Save</button>
            <button type="button" class="btn btn-outline" data-reset="${p.key}">Reset to the first values</button>
            <span class="seo-msg" style="font-weight:600"></span>
          </div>
        </form>
      </details>`;
  }

  function render() {
    const open = new Set([...host.querySelectorAll('details[open]')].map((d) => d.dataset.key));
    const fixed = pages.filter((p) => !p.template);
    const templates = pages.filter((p) => p.template);
    host.innerHTML = `
      <h3 style="margin:22px 0 10px;color:var(--white)">Pages</h3>
      ${fixed.map(cardHtml).join('')}
      <h3 style="margin:26px 0 4px;color:var(--white)">Pages with a name <span style="font-weight:600;font-size:13px;color:var(--gray)">— one text for all seasons / players / courts / brackets, <code>{name}</code> becomes the name; the slug is the first part of the address (<code>/season/summer-2026</code>)</span></h3>
      <div style="height:6px"></div>
      ${templates.map(cardHtml).join('')}`;
    host.querySelectorAll('details').forEach((d) => { if (open.has(d.dataset.key)) d.open = true; });
  }

  // the texts of one language of a form
  function valuesOf(form, lang) {
    const get = (n) => form.elements[`${lang}.${n}`].value;
    return {
      title: get('title'), description: get('description'), keywords: get('keywords'),
      ogTitle: get('ogTitle'), ogDescription: get('ogDescription'), ogImage: get('ogImage'),
    };
  }
  function slugsOf(form) {
    const out = {};
    LANGS.forEach(([code]) => { const el = form.elements[`${code}.slug`]; if (el) out[code] = el.value; });
    return out;
  }
  function bodyOf(form) {
    return { noindex: form.elements.noindex.checked, slugs: slugsOf(form), sk: valuesOf(form, 'sk'), en: valuesOf(form, 'en') };
  }

  function say(form, text, bad) {
    const el = form.querySelector('.seo-msg');
    el.textContent = text;
    el.style.color = bad ? 'var(--danger)' : 'var(--green, #2e9e4f)';
  }

  // the counters and the preview follow the typing
  host.addEventListener('input', (e) => {
    const panel = e.target.closest('.seo-panel');
    if (!panel) return;
    const form = panel.closest('.seo-form');
    const p = pages.find((x) => x.key === form.closest('.seo-card').dataset.key);
    const lang = panel.dataset.lang;
    const v = valuesOf(form, lang);
    const counts = panel.querySelectorAll('.seo-count');
    counts[0].textContent = `${[...v.title].length} / ${TITLE_GOOD}`;
    counts[0].style.color = [...v.title].length > TITLE_GOOD ? 'var(--danger)' : 'var(--gray)';
    counts[1].textContent = `${[...v.description].length} / ${DESC_GOOD}`;
    counts[1].style.color = [...v.description].length > DESC_GOOD ? 'var(--danger)' : 'var(--gray)';
    const slugEl = form.elements[`${lang}.slug`];
    panel.querySelector('.seo-snippet').outerHTML = snippet(p, lang, v, slugEl ? slugEl.value : '');
  });

  // The addresses that change with this save — the old ones stop working, there is no redirect.
  function changedAddresses(p, body) {
    if (p.home) return [];
    return LANGS.filter(([code]) => body.slugs[code] !== undefined && body.slugs[code].trim() !== p.slugs[code])
      .map(([code]) => `${addressOf(p, code, p.slugs[code])}  →  ${addressOf(p, code, body.slugs[code].trim())}`);
  }

  host.addEventListener('submit', async (e) => {
    const form = e.target.closest('.seo-form');
    if (!form) return;
    e.preventDefault();
    const key = form.closest('.seo-card').dataset.key;
    const p = pages.find((x) => x.key === key);
    const body = bodyOf(form);
    const changed = changedAddresses(p, body);
    if (changed.length && !window.confirm(`These addresses change:\n\n${changed.join('\n')}\n\nThe old address stops working at once (no redirect): links, bookmarks and search results that use it will show "not found". Save?`)) return;
    try {
      const saved = await api(`/seo/${key}`, { method: 'PUT', body });
      pages = pages.map((x) => (x.key === key ? saved : x));
      render();
      const card = host.querySelector(`.seo-card[data-key="${key}"]`);
      card.open = true;
      say(card.querySelector('.seo-form'), 'Saved ✓');
    } catch (err) {
      say(form, err.message, true);
    }
  });

  host.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      const form = tab.closest('.seo-form');
      tabOf.set(form.closest('.seo-card').dataset.key, tab.dataset.tab);
      form.querySelectorAll('[data-tab]').forEach((b) => {
        b.classList.toggle('btn-primary', b === tab);
        b.classList.toggle('btn-outline', b !== tab);
      });
      form.querySelectorAll('.seo-panel').forEach((panel) => { panel.style.display = panel.dataset.lang === tab.dataset.tab ? '' : 'none'; });
      return;
    }
    const reset = e.target.closest('[data-reset]');
    if (!reset) return;
    const p = pages.find((x) => x.key === reset.dataset.reset);
    const body = { noindex: p.defaultNoindex, slugs: p.defaultSlugs, sk: p.defaults.sk, en: p.defaults.en };
    const changed = changedAddresses(p, body);
    const warning = changed.length ? `\n\nThe addresses go back too:\n${changed.join('\n')}\n(the current ones stop working, no redirect)` : '';
    if (!window.confirm(`Put the first values back for "${p.label}" (both languages)?${warning}`)) return;
    try {
      const saved = await api(`/seo/${p.key}`, { method: 'PUT', body });
      pages = pages.map((x) => (x.key === p.key ? saved : x));
      render();
      const card = host.querySelector(`.seo-card[data-key="${p.key}"]`);
      card.open = true;
      say(card.querySelector('.seo-form'), 'Reset ✓');
    } catch (err) {
      window.alert(err.message);
    }
  });

  async function load() {
    pages = await api('/seo');
    render();
  }

  checkAdmin().then((isAdmin) => {
    if (isAdmin) { load().catch((err) => { host.innerHTML = `<div class="card" style="color:var(--danger)">${escapeHtml(err.message)}</div>`; }); return; }
    host.innerHTML = '<div class="card"><p style="margin:0;color:var(--gray)">Managing the SEO requires an admin login. <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.</p></div>';
  });
})();

// Backend > SEO (/seo-admin): the title, description, keywords, link-preview texts and picture, and the robots setting of every
// public page. The values are baked into the page's HTML on the server (src/seo.js).
(function seoAdmin() {
  const host = document.getElementById('seo-admin-root');
  if (!host) return;

  const field = 'display:block;width:100%;margin-top:4px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  const label = 'display:block;font-size:12px;font-weight:700;margin-top:12px';
  // what Google roughly shows before it cuts the text off
  const TITLE_GOOD = 60;
  const DESC_GOOD = 160;
  let pages = [];

  const SAMPLE = '{name}';

  function counter(text, good) {
    const n = [...text].length;
    return `<span class="seo-count" style="font-weight:600;color:${n > good ? 'var(--danger)' : 'var(--gray)'}">${n} / ${good}</span>`;
  }

  function snippet(p, v) {
    const sample = (t) => String(t || '').split(SAMPLE).join(p.template ? 'Example' : '');
    const url = `${location.origin}${p.path}`.replace(':slug', 'example').replace(':id', '1');
    return `
      <div class="seo-snippet" style="margin-top:14px;padding:12px 14px;border-radius:10px;background:#fff;color:#202124;font-family:Arial,sans-serif">
        <div style="font-size:12px;color:#4d5156;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(url)}</div>
        <div class="seo-snip-title" style="font-size:18px;line-height:1.3;color:#1a0dab;margin:2px 0">${escapeHtml(sample(v.title) || '(no title)')}</div>
        <div class="seo-snip-desc" style="font-size:13px;line-height:1.5;color:#4d5156">${escapeHtml(sample(v.description) || '(no description)')}</div>
      </div>`;
  }

  function cardHtml(p) {
    const v = p.values;
    const open = false;
    return `
      <details class="card seo-card" data-key="${p.key}" style="margin-bottom:12px"${open ? ' open' : ''}>
        <summary style="cursor:pointer;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;list-style:none">
          <strong>${escapeHtml(p.label)}</strong>
          <span style="color:var(--gray);font-size:13px">${escapeHtml(p.path)}</span>
          ${v.noindex ? '<span style="font-size:11px;font-weight:800;color:var(--orange)">NOINDEX</span>' : ''}
          ${p.blta ? `<a href="${escapeHtml(p.blta)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="margin-left:auto;font-size:12px;color:var(--orange);text-decoration:underline">blta.sk page ↗</a>` : ''}
        </summary>
        <form class="seo-form">
          <label style="${label}">Title ${counter(v.title, TITLE_GOOD)}
            <input type="text" name="title" maxlength="120" value="${escapeHtml(v.title)}" style="${field}">
          </label>
          <label style="${label}">Description ${counter(v.description, DESC_GOOD)}
            <textarea name="description" rows="3" maxlength="320" style="${field}">${escapeHtml(v.description)}</textarea>
          </label>
          <label style="${label}">Keywords <span style="font-weight:600;color:var(--gray)">(optional, separated by commas — Google ignores them, some other engines read them)</span>
            <input type="text" name="keywords" maxlength="300" value="${escapeHtml(v.keywords)}" placeholder="tenisová liga, Bratislava, amatérsky tenis" style="${field}">
          </label>
          <div style="font-size:13px;font-weight:800;margin-top:18px">Link preview <span style="font-weight:600;color:var(--gray)">(WhatsApp, Facebook, Messenger… — empty = the title and description above)</span></div>
          <label style="${label}">Preview title
            <input type="text" name="ogTitle" maxlength="120" value="${escapeHtml(v.ogTitle)}" style="${field}">
          </label>
          <label style="${label}">Preview description
            <textarea name="ogDescription" rows="2" maxlength="320" style="${field}">${escapeHtml(v.ogDescription)}</textarea>
          </label>
          <label style="${label}">Preview picture <span style="font-weight:600;color:var(--gray)">(address, https://… or /img/…; empty = the BLTA logo${p.template ? ', or the season / player picture' : ''})</span>
            <input type="text" name="ogImage" maxlength="500" value="${escapeHtml(v.ogImage)}" placeholder="/img/blta-logo.png" style="${field}">
          </label>
          <label style="display:flex;gap:8px;align-items:center;font-size:14px;font-weight:600;margin-top:16px">
            <input type="checkbox" name="noindex"${v.noindex ? ' checked' : ''}> Hide this page from search engines (noindex)
          </label>
          ${snippet(p, v)}
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
      <h3 style="margin:26px 0 4px;color:var(--white)">Pages with a name <span style="font-weight:600;font-size:13px;color:var(--gray)">— one text for all seasons / players / courts / brackets, <code>{name}</code> becomes the name</span></h3>
      <div style="height:6px"></div>
      ${templates.map(cardHtml).join('')}`;
    host.querySelectorAll('details').forEach((d) => { if (open.has(d.dataset.key)) d.open = true; });
  }

  function valuesOf(form) {
    const get = (n) => form.elements[n].value;
    return {
      title: get('title'), description: get('description'), keywords: get('keywords'),
      ogTitle: get('ogTitle'), ogDescription: get('ogDescription'), ogImage: get('ogImage'),
      noindex: form.elements.noindex.checked,
    };
  }

  function say(form, text, bad) {
    const el = form.querySelector('.seo-msg');
    el.textContent = text;
    el.style.color = bad ? 'var(--danger)' : 'var(--green, #2e9e4f)';
  }

  // the counters and the preview follow the typing
  host.addEventListener('input', (e) => {
    const form = e.target.closest('.seo-form');
    if (!form) return;
    const card = form.closest('.seo-card');
    const p = pages.find((x) => x.key === card.dataset.key);
    const v = valuesOf(form);
    const counts = form.querySelectorAll('.seo-count');
    counts[0].textContent = `${[...v.title].length} / ${TITLE_GOOD}`;
    counts[0].style.color = [...v.title].length > TITLE_GOOD ? 'var(--danger)' : 'var(--gray)';
    counts[1].textContent = `${[...v.description].length} / ${DESC_GOOD}`;
    counts[1].style.color = [...v.description].length > DESC_GOOD ? 'var(--danger)' : 'var(--gray)';
    const snip = form.querySelector('.seo-snippet');
    snip.outerHTML = snippet(p, v);
  });

  host.addEventListener('submit', async (e) => {
    const form = e.target.closest('.seo-form');
    if (!form) return;
    e.preventDefault();
    const key = form.closest('.seo-card').dataset.key;
    try {
      const saved = await api(`/seo/${key}`, { method: 'PUT', body: valuesOf(form) });
      pages = pages.map((p) => (p.key === key ? saved : p));
      render();
      const card = host.querySelector(`.seo-card[data-key="${key}"]`);
      card.open = true;
      say(card.querySelector('.seo-form'), 'Saved ✓');
    } catch (err) {
      say(form, err.message, true);
    }
  });

  host.addEventListener('click', async (e) => {
    const reset = e.target.closest('[data-reset]');
    if (!reset) return;
    const p = pages.find((x) => x.key === reset.dataset.reset);
    if (!window.confirm(`Put the first values back for "${p.label}"?`)) return;
    try {
      const saved = await api(`/seo/${p.key}`, { method: 'PUT', body: p.defaults });
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

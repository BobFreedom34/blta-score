// Backend > Footer (/footer-admin): the footer of the public pages of the city that is worked on (the super admin can also pick the national site, slta.sk): the
// description and the contact of the card on the left, the groups of links (a page of the site or an address of your own), the row of the other cities and a line
// of small print. What is left empty is the built-in text. Data: GET / PUT / DELETE /api/footer (?scope=national).
(function footerAdmin() {
  const host = document.getElementById('footer-admin-root');
  if (!host) return;

  const field = 'display:block;width:100%;margin-top:4px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  const small = 'padding:6px 8px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:13px';
  const esc = (s) => escapeHtml(String(s == null ? '' : s));
  let me = null;
  let scope = ''; // '' = the city that is worked on, 'national'
  let data = null; // what GET /api/footer gave
  let model = null; // the editor's copy
  let touched = false; // the groups were changed (else the built-in ones stay built-in)

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const query = () => (scope ? '?scope=national' : '');

  function load() {
    return api(`/footer${query()}`).then((d) => {
      data = d;
      model = {
        desc: { ...d.settings.desc },
        contact: { ...d.settings.contact },
        groups: clone(d.settings.groups || d.builtIn.groups),
        showCities: d.settings.showCities !== false,
        hiddenCities: [...(d.settings.hiddenCities || [])],
        contactHidden: [...(d.settings.contactHidden || [])],
        legal: { ...d.settings.legal },
      };
      touched = false;
      render();
    });
  }

  const pageOptions = (selected) => data.pages.map((p) => `<option value="${esc(p.code)}"${p.code === selected ? ' selected' : ''}>${esc(p.label)}</option>`).join('');

  function linkRow(l, gi, li, last) {
    const isPage = !!l.page;
    return `
      <div class="fa-link" data-g="${gi}" data-l="${li}" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px">
        <input type="text" class="fa-lsk" maxlength="60" placeholder="Text (Slovak)" value="${esc(l.sk)}" style="${small};flex:1 1 130px;min-width:110px">
        <input type="text" class="fa-len" maxlength="60" placeholder="Text (English)" value="${esc(l.en)}" style="${small};flex:1 1 130px;min-width:110px">
        <select class="fa-type" aria-label="Goes to" style="${small}"><option value="page"${isPage ? ' selected' : ''}>A page of the site</option><option value="url"${isPage ? '' : ' selected'}>An address</option></select>
        ${isPage
    ? `<select class="fa-page" aria-label="Page" style="${small};flex:1 1 160px;min-width:140px">${pageOptions(l.page)}</select>`
    : `<input type="text" class="fa-url" maxlength="300" placeholder="https://…, /path or #part" value="${esc(l.url)}" style="${small};flex:1 1 160px;min-width:140px">`}
        <button type="button" class="btn btn-sm btn-outline" data-act="link-up" aria-label="Move up"${li === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="btn btn-sm btn-outline" data-act="link-down" aria-label="Move down"${last ? ' disabled' : ''}>↓</button>
        <button type="button" class="btn btn-sm btn-outline" data-act="link-del" aria-label="Remove the link">✕</button>
      </div>`;
  }

  function groupCard(g, gi, count) {
    return `
      <div class="fa-group" data-g="${gi}" style="border:1px solid #e3e3e3;border-radius:12px;padding:12px;margin-top:12px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <strong style="min-width:56px">Group ${gi + 1}</strong>
          <input type="text" class="fa-gsk" maxlength="40" placeholder="Title (Slovak)" value="${esc(g.sk)}" style="${small};flex:1 1 150px">
          <input type="text" class="fa-gen" maxlength="40" placeholder="Title (English)" value="${esc(g.en)}" style="${small};flex:1 1 150px">
          <button type="button" class="btn btn-sm btn-outline" data-act="group-up" aria-label="Move the group up"${gi === 0 ? ' disabled' : ''}>↑</button>
          <button type="button" class="btn btn-sm btn-outline" data-act="group-down" aria-label="Move the group down"${gi === count - 1 ? ' disabled' : ''}>↓</button>
          <button type="button" class="btn btn-sm btn-danger" data-act="group-del">Remove group</button>
        </div>
        ${g.links.map((l, li) => linkRow(l, gi, li, li === g.links.length - 1)).join('')}
        <div style="margin-top:10px"><button type="button" class="btn btn-sm btn-outline" data-act="link-add"${g.links.length >= 12 ? ' disabled' : ''}>+ Add a link</button></div>
      </div>`;
  }

  function render() {
    const b = data.builtIn;
    const nat = data.scope === 'national';
    const cityName = me && me.acting ? me.acting.name : 'this city';
    const sw = me && me.role === 'SUPER'
      ? `<div class="card" style="display:flex;gap:8px;margin:0 0 14px;flex-wrap:wrap;align-items:center"><span style="font-size:12px;font-weight:700;color:var(--gray)">Footer of</span><button type="button" class="btn ${scope ? 'btn-outline' : 'btn-primary'}" data-scope="">${esc(cityName)}</button><button type="button" class="btn ${scope ? 'btn-primary' : 'btn-outline'}" data-scope="national">National site (slta.sk)</button></div>`
      : '';
    const c = model.contact;
    const ph = (k) => (b.contact && b.contact[k]) || '';
    // "Don't show": the part is left out of the footer altogether (an empty field would show the built-in one)
    const hid = (k) => model.contactHidden.includes(k);
    const hideBox = (k) => `<label style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--gray);margin-top:4px"><input type="checkbox" data-hide="${k}"${hid(k) ? ' checked' : ''}> Don't show this</label>`;
    host.innerHTML = `
      ${sw}
      <div class="card" style="margin-bottom:14px">
        <strong>The card on the left</strong>
        <div style="color:var(--gray);font-size:13px;margin:4px 0 4px">The logo and the name are the ones of the ${nat ? 'national site' : 'city'}. Leave a field empty to use the built-in text${b.contact ? ' (for Bratislava the contact window of Backend → Menu)' : ''}.</div>
        <label style="display:block;font-size:12px;font-weight:700;margin-top:10px">Description (Slovak)
          <textarea id="fa-desc-sk" rows="3" maxlength="400" placeholder="${esc(b.desc.sk)}" style="${field};resize:vertical">${esc(model.desc.sk)}</textarea></label>
        <label style="display:block;font-size:12px;font-weight:700;margin-top:10px">Description (English)
          <textarea id="fa-desc-en" rows="3" maxlength="400" placeholder="${esc(b.desc.en)}" style="${field};resize:vertical">${esc(model.desc.en)}</textarea></label>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
          <div style="flex:1 1 240px"><label style="display:block;font-size:12px;font-weight:700;margin-top:6px">Address (one line per row)
            <textarea id="fa-address" rows="2" maxlength="300" placeholder="${esc(ph('address'))}" style="${field};resize:vertical"${hid('address') ? ' disabled' : ''}>${esc(c.address)}</textarea></label>${hideBox('address')}</div>
          <div style="flex:1 1 240px"><label style="display:block;font-size:12px;font-weight:700;margin-top:6px">E-mail
            <input type="text" id="fa-email" maxlength="120" placeholder="${esc(ph('email'))}" value="${esc(c.email)}" style="${field}"${hid('email') ? ' disabled' : ''}></label>${hideBox('email')}</div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${[['instagramUrl', 'Instagram'], ['facebookUrl', 'Facebook'], ['youtubeUrl', 'YouTube'], ['whatsappUrl', 'WhatsApp']].map(([k, label]) => `
          <div style="flex:1 1 220px"><label style="display:block;font-size:12px;font-weight:700;margin-top:6px">${label} link
            <input type="text" data-social="${k}" maxlength="300" placeholder="${esc(ph(k) || 'https://…')}" value="${esc(c[k])}" style="${field}"${hid(k) ? ' disabled' : ''}></label>${hideBox(k)}</div>`).join('')}
        </div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <strong>Groups of links</strong>
        <div style="color:var(--gray);font-size:13px;margin:4px 0 0">${data.settings.groups === null && !touched ? 'These are the built-in groups. Change anything and save to use your own.' : 'Your own groups. A link to a page follows the address of that page in Backend → SEO and goes to the right language and city by itself.'}</div>
        <div id="fa-groups">${model.groups.map((g, gi) => groupCard(g, gi, model.groups.length)).join('')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button type="button" class="btn btn-sm btn-outline" data-act="group-add"${model.groups.length >= 6 ? ' disabled' : ''}>+ Add a group</button>
          ${data.settings.groups !== null || touched ? '<button type="button" class="btn btn-sm btn-outline" data-act="groups-builtin">Back to the built-in links</button>' : ''}
        </div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <strong>Cities and small print</strong>
        <label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin-top:10px"><input type="checkbox" id="fa-cities"${model.showCities ? ' checked' : ''} style="margin-top:3px"><span>Show the row with the other cities (links between the cities help visitors and search engines)</span></label>
        ${data.cities.length ? `<div id="fa-city-list" style="margin:8px 0 0 26px${model.showCities ? '' : ';opacity:.5'}">
          <div style="font-size:12px;font-weight:700;color:var(--gray);margin-bottom:4px">Which cities are shown in the row</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px 18px">${data.cities.map((c) => `<label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" data-city="${esc(c.slug)}"${model.hiddenCities.includes(c.slug) ? '' : ' checked'}${model.showCities ? '' : ' disabled'}>${esc(c.name)}</label>`).join('')}</div>
        </div>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <label style="flex:1 1 260px;font-size:12px;font-weight:700;margin-top:10px">Small print after the © line (Slovak)
            <input type="text" id="fa-legal-sk" maxlength="200" value="${esc(model.legal.sk)}" placeholder="${esc(b.contact ? `${b.contact.orgName} · IČO ${b.contact.ico}` : 'e.g. the name of the organiser')}" style="${field}"></label>
          <label style="flex:1 1 260px;font-size:12px;font-weight:700;margin-top:10px">Small print after the © line (English)
            <input type="text" id="fa-legal-en" maxlength="200" value="${esc(model.legal.en)}" placeholder="${esc(b.contact ? `${b.contact.orgName} · IČO ${b.contact.ico}` : '')}" style="${field}"></label>
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn btn-primary" data-act="save">Save</button>
        <button type="button" class="btn btn-outline" data-act="reset" style="color:#fff;border-color:rgba(255,255,255,.45)">Reset the whole footer to the built-in one</button>
        <a href="/" target="_blank" rel="noopener" style="color:var(--orange);text-decoration:underline;font-size:13px">Open the site ↗</a>
        <span id="fa-msg" style="font-weight:600"></span>
      </div>`;
  }

  // the editor's fields into the model (before any change of the structure and before saving)
  function read() {
    const val = (id) => document.getElementById(id).value;
    model.desc = { sk: val('fa-desc-sk'), en: val('fa-desc-en') };
    model.contact.address = val('fa-address');
    model.contact.email = val('fa-email');
    host.querySelectorAll('[data-social]').forEach((i) => { model.contact[i.dataset.social] = i.value; });
    model.contactHidden = [...host.querySelectorAll('[data-hide]')].filter((i) => i.checked).map((i) => i.dataset.hide);
    model.showCities = document.getElementById('fa-cities').checked;
    // a city that is not ticked is left out of the row (a city that is not in the list, e.g. one that is hidden now, keeps what it had)
    const listed = new Set([...host.querySelectorAll('[data-city]')].map((i) => i.dataset.city));
    model.hiddenCities = model.hiddenCities.filter((s) => !listed.has(s)).concat([...host.querySelectorAll('[data-city]')].filter((i) => !i.checked).map((i) => i.dataset.city));
    model.legal = { sk: val('fa-legal-sk'), en: val('fa-legal-en') };
    model.groups = [...host.querySelectorAll('.fa-group')].map((gEl) => ({
      sk: gEl.querySelector('.fa-gsk').value,
      en: gEl.querySelector('.fa-gen').value,
      links: [...gEl.querySelectorAll('.fa-link')].map((lEl) => {
        const l = { sk: lEl.querySelector('.fa-lsk').value, en: lEl.querySelector('.fa-len').value };
        const type = lEl.querySelector('.fa-type').value;
        if (type === 'page') l.page = (lEl.querySelector('.fa-page') || {}).value || data.pages[0].code;
        else l.url = (lEl.querySelector('.fa-url') || {}).value || '';
        return l;
      }),
    }));
  }

  const move = (arr, i, d) => { const j = i + d; if (j >= 0 && j < arr.length) [arr[i], arr[j]] = [arr[j], arr[i]]; };
  const say = (text, bad) => { const m = document.getElementById('fa-msg'); m.textContent = text; m.style.color = bad ? 'var(--danger)' : 'var(--green, #2e9e4f)'; };

  host.addEventListener('input', (e) => { if (e.target.closest('#fa-groups')) touched = true; });
  // the list of cities follows the switch of the whole row; a part of the contact that is not shown is greyed out
  host.addEventListener('change', (e) => {
    if (e.target.dataset && e.target.dataset.hide) {
      const k = e.target.dataset.hide;
      const input = k === 'address' ? document.getElementById('fa-address') : k === 'email' ? document.getElementById('fa-email') : host.querySelector(`[data-social="${k}"]`);
      if (input) input.disabled = e.target.checked;
      return;
    }
    if (e.target.id !== 'fa-cities') return;
    const list = document.getElementById('fa-city-list');
    if (list) { list.style.opacity = e.target.checked ? '' : '0.5'; list.querySelectorAll('input').forEach((i) => { i.disabled = !e.target.checked; }); }
  });
  host.addEventListener('change', (e) => {
    // a link switched between "a page" and "an address" gets the other field
    if (e.target.classList.contains('fa-type')) { read(); touched = true; render(); }
  });

  host.addEventListener('click', async (e) => {
    const sc = e.target.closest('[data-scope]');
    if (sc) { scope = sc.dataset.scope; await load(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const gEl = btn.closest('.fa-group');
    const lEl = btn.closest('.fa-link');
    const gi = gEl ? Number(gEl.dataset.g) : -1;
    try {
      if (act === 'save') {
        read();
        // the groups are sent only when they were changed (else they stay the built-in ones, which can then still improve with the site)
        const groups = data.settings.groups === null && !touched ? null : model.groups.filter((g) => g.sk.trim() || g.links.length);
        data = await api(`/footer${query()}`, { method: 'PUT', body: { desc: model.desc, contact: model.contact, groups, showCities: model.showCities, hiddenCities: model.hiddenCities, contactHidden: model.contactHidden, legal: model.legal } });
        await load();
        say('Saved ✓ — the footer is changed on the site');
        return;
      }
      if (act === 'reset') {
        if (!window.confirm('Put the whole footer back to the built-in one? Your texts and links are lost.')) return;
        await api(`/footer${query()}`, { method: 'DELETE' });
        await load();
        say('Back to the built-in footer ✓');
        return;
      }
      read();
      if (act === 'groups-builtin') { model.groups = clone(data.builtIn.groups); data.settings.groups = null; touched = false; }
      else { touched = true; }
      if (act === 'group-add') model.groups.push({ sk: '', en: '', links: [{ sk: '', en: '', page: data.pages[0].code }] });
      else if (act === 'group-del') model.groups.splice(gi, 1);
      else if (act === 'group-up') move(model.groups, gi, -1);
      else if (act === 'group-down') move(model.groups, gi, 1);
      else if (act === 'link-add') model.groups[gi].links.push({ sk: '', en: '', page: data.pages[0].code });
      else if (act === 'link-del') model.groups[gi].links.splice(Number(lEl.dataset.l), 1);
      else if (act === 'link-up') move(model.groups[gi].links, Number(lEl.dataset.l), -1);
      else if (act === 'link-down') move(model.groups[gi].links, Number(lEl.dataset.l), 1);
      render();
    } catch (err) {
      say(err.message, true);
    }
  });

  checkAdmin().then(async (isAdmin) => {
    if (!isAdmin) { host.innerHTML = '<div class="card"><p style="margin:0;color:var(--gray)">Editing the footer requires an admin login. <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.</p></div>'; return; }
    try {
      me = await api('/admin/session');
      await load();
    } catch (err) { host.innerHTML = `<div class="card" style="color:var(--danger)">${esc(err.message)}</div>`; }
  });
})();

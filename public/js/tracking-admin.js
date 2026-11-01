// Backend > Tracking (/tracking-admin): the Google Tag Manager container of blta.sk and of slta.sk (with all its cities), and whether visitors are asked for
// consent first. Data: GET /api/tracking, PUT /api/tracking/:site (super admin).
(function trackingAdmin() {
  const host = document.getElementById('tracking-admin-root');
  if (!host) return;

  const field = 'display:block;width:100%;max-width:320px;margin-top:4px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  const SITES = [
    ['blta', 'blta.sk', 'The Bratislava league website (and everything on blta.sk).'],
    ['slta', 'slta.sk', 'The national website: the picker of the cities, the rankings of the cities and every city page under slta.sk/<city>.'],
  ];
  const esc = (s) => escapeHtml(String(s == null ? '' : s));

  function card([site, name, hint], values) {
    return `
      <form class="card" data-site="${site}" style="margin-bottom:14px">
        <strong style="font-size:16px">${name}</strong>
        <div style="color:var(--gray);font-size:13px;margin-top:2px">${hint}</div>
        <label style="display:block;font-size:12px;font-weight:700;margin-top:12px">Tag Manager container ID
          <input type="text" name="gtmId" maxlength="16" placeholder="GTM-ABC1234" autocomplete="off" spellcheck="false" value="${esc(values.gtmId)}" style="${field};text-transform:uppercase">
        </label>
        <label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin-top:12px;max-width:560px">
          <input type="checkbox" name="consent"${values.consent ? ' checked' : ''} style="margin-top:3px">
          <span><strong>Ask visitors for cookie consent first</strong><br><span style="color:var(--gray)">The container starts with analytics and advertising storage switched off (Google Consent Mode v2) and a small banner asks the visitor. What they choose is passed to Tag Manager, so tags that respect consent wait for it. Recommended in the EU.</span></span>
        </label>
        <div style="display:flex;gap:10px;align-items:center;margin-top:14px">
          <button type="submit" class="btn btn-primary">Save</button>
          <span class="tr-msg" style="font-weight:600"></span>
        </div>
        <div style="color:var(--gray);font-size:12px;margin-top:10px">${values.gtmId ? `Live: the tag <strong>${esc(values.gtmId)}</strong> is on every public page of ${name}.` : `Off: no tag on ${name} while the ID is empty.`}</div>
      </form>`;
  }

  function render(data) {
    host.innerHTML = SITES.map((s) => card(s, data[s[0]] || { gtmId: '', consent: true })).join('');
    host.querySelectorAll('form').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = form.querySelector('.tr-msg');
        msg.style.color = '';
        msg.textContent = 'Saving…';
        try {
          const saved = await api(`/tracking/${form.dataset.site}`, { method: 'PUT', body: { gtmId: form.elements.gtmId.value, consent: form.elements.consent.checked } });
          data[form.dataset.site] = saved;
          render(data);
          const fresh = host.querySelector(`form[data-site="${form.dataset.site}"] .tr-msg`);
          fresh.style.color = 'var(--green-dark, #2d7a1f)';
          fresh.textContent = 'Saved';
        } catch (err) {
          msg.style.color = 'var(--danger)';
          msg.textContent = err.message;
        }
      });
    });
  }

  api('/tracking').then(render).catch((err) => { host.innerHTML = `<div class="card" style="color:var(--danger)">${esc(err.message)}</div>`; });
})();

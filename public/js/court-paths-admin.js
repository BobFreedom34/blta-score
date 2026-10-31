// Backend > Venues: "Court addresses" — a whole address of its own for a court, per language (kept from the old website, so Google finds the court where
// it always was): /kurty-tennis-one instead of /tenisove-kurty/tennis-one. The pattern address of that court is then retired (404, no redirect).
// The addresses are shared by every city, so only the super admin sees this (GET/PUT /api/seo/court-paths). It used to sit at the bottom of Backend > SEO.
(function courtPathsAdmin() {
  const venuesRoot = document.getElementById('venues-admin-root');
  if (!venuesRoot) return;
  const host = document.createElement('div');
  host.id = 'court-paths-root';
  venuesRoot.insertAdjacentElement('afterend', host);

  const field = 'display:block;width:100%;margin-top:4px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  const label = 'display:block;font-size:12px;font-weight:700;margin-top:12px';
  let courtPaths = [];

  function courtRowHtml(c) {
    const input = (lang, value, prefix) => `<label style="${label};flex:1;min-width:230px">${lang === 'sk' ? 'Slovak' : 'English'} address
        <span style="display:flex;align-items:center;gap:4px"><span style="font-weight:700;color:var(--gray)">${prefix}/</span><input type="text" data-lang="${lang}" value="${escapeHtml(value)}" maxlength="80" placeholder="${escapeHtml(c.pattern[lang])}" style="${field};margin-top:4px"></span>
      </label>`;
    return `
      <div class="seo-court" data-slug="${escapeHtml(c.slug)}" style="padding:12px 0;border-top:1px solid #eee">
        <div style="font-weight:800">${escapeHtml(c.name)} <span style="font-weight:600;color:var(--gray);font-size:12px">· code <code>${escapeHtml(c.code)}</code></span></div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
          ${input('sk', c.own.sk, '')}
          ${input('en', c.own.en, '/en')}
          <button type="button" class="btn btn-sm btn-primary" data-act="save-court">Save</button>
          ${c.old ? '<button type="button" class="btn btn-sm btn-outline" data-act="old-court">Old website address</button>' : ''}
        </div>
        <div class="seo-court-msg" style="font-size:12px;margin-top:4px;min-height:16px"></div>
      </div>`;
  }

  function render() {
    host.innerHTML = `
      <div class="card" data-sec-title="Court addresses" style="margin-top:10px">
        <div style="font-size:13px;color:var(--gray);margin-bottom:6px">A whole address of its own for a court (like on the old website: <code>/kurty-tennis-one</code>); empty = the pattern <code>/tenisove-kurty/&lt;court&gt;</code>.</div>
        ${courtPaths.length ? courtPaths.map(courtRowHtml).join('') : '<div class="empty-state" style="padding:8px 0">No courts yet.</div>'}
        <div style="font-size:12px;color:var(--gray);margin-top:10px">When a court has an address of its own, the pattern address of that court stops working (404, no redirect). Changing an address later makes the old one stop working too — search engines would lose it. The title, description and preview picture of a court's page are set in the court's own editor above (SEO).</div>
      </div>`;
  }

  host.addEventListener('click', async (e) => {
    const row = e.target.closest('.seo-court');
    const btn = e.target.closest('[data-act]');
    if (!row || !btn) return;
    const court = courtPaths.find((c) => c.slug === row.dataset.slug);
    const msg = row.querySelector('.seo-court-msg');
    if (btn.dataset.act === 'old-court') {
      row.querySelector('[data-lang="sk"]').value = court.old.sk;
      row.querySelector('[data-lang="en"]').value = court.old.en;
      msg.style.color = 'var(--gray)';
      msg.textContent = 'The old website addresses are filled in — press Save.';
      return;
    }
    const body = { sk: row.querySelector('[data-lang="sk"]').value, en: row.querySelector('[data-lang="en"]').value };
    try {
      const saved = await api(`/seo/court-paths/${encodeURIComponent(court.slug)}`, { method: 'PUT', body });
      courtPaths = courtPaths.map((c) => (c.slug === court.slug ? saved : c));
      render();
      const fresh = host.querySelector(`.seo-court[data-slug="${CSS.escape(court.slug)}"] .seo-court-msg`);
      if (fresh) { fresh.style.color = 'var(--success, #1b8a3a)'; fresh.textContent = 'Saved ✓'; }
    } catch (err) {
      msg.style.color = 'var(--danger)';
      msg.textContent = err.message;
    }
  });

  // only the super admin has the addresses (the request is refused for anybody else: nothing is shown then)
  checkAdmin().then(async (isAdmin) => {
    if (!isAdmin) return;
    try { courtPaths = await api('/seo/court-paths'); } catch { return; }
    render();
  });
})();

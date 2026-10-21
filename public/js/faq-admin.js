// Backend > Q&A (/faq-admin): the questions and answers of the national page (slta.sk) — a question and an answer in Slovak and in English, in
// the order of the page. Data: GET /api/faq, POST /api/faq, PUT /api/faq/:id, PUT /api/faq/order, DELETE /api/faq/:id (super admin).
(function faqAdmin() {
  const host = document.getElementById('faq-admin-root');
  if (!host) return;

  const field = 'display:block;width:100%;margin-top:4px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  const LANGS = [['sk', 'Slovenčina'], ['en', 'English']];
  let items = [];
  const open = new Set();
  const esc = (s) => escapeHtml(String(s == null ? '' : s));

  function card(it, i) {
    const isNew = it.id === 'new';
    return `
      <details class="card faq-card" data-id="${it.id}" style="margin-bottom:10px"${open.has(String(it.id)) || isNew ? ' open' : ''}>
        <summary style="cursor:pointer;display:flex;gap:10px;align-items:center;list-style:none">
          <span style="color:var(--gray);font-size:13px;font-weight:700;min-width:22px">${isNew ? '+' : String(i + 1).padStart(2, '0')}</span>
          <strong style="flex:1">${esc(it.q_sk) || 'New question'}</strong>
          ${isNew ? '' : `<span style="display:flex;gap:6px">
            <button type="button" class="btn btn-sm btn-outline" data-act="up" title="Move up"${i === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" class="btn btn-sm btn-outline" data-act="down" title="Move down"${i === items.length - 1 ? ' disabled' : ''}>↓</button>
          </span>`}
        </summary>
        <div style="margin-top:6px">
          ${LANGS.map(([code, label]) => `
            <div style="margin-top:14px">
              <div style="font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--gray)">${label}</div>
              <label style="display:block;font-size:12px;font-weight:700;margin-top:8px">Question
                <input type="text" data-f="q_${code}" maxlength="200" value="${esc(it['q_' + code])}" style="${field}">
              </label>
              <label style="display:block;font-size:12px;font-weight:700;margin-top:8px">Answer
                <textarea data-f="a_${code}" rows="4" maxlength="3000" style="${field};resize:vertical">${esc(it['a_' + code])}</textarea>
              </label>
            </div>`).join('')}
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px">
            <button type="button" class="btn btn-primary" data-act="save">${isNew ? 'Add' : 'Save'}</button>
            ${isNew ? '<button type="button" class="btn btn-sm btn-outline" data-act="cancel">Cancel</button>' : '<button type="button" class="btn btn-sm btn-outline" data-act="remove">Remove</button>'}
            <span class="faq-msg" style="font-weight:600"></span>
          </div>
        </div>
      </details>`;
  }

  let adding = false;
  function render() {
    host.innerHTML = `
      <div style="margin-bottom:14px"><button type="button" class="btn btn-primary" data-act="new"${adding ? ' disabled' : ''}>+ Add a question</button></div>
      ${adding ? card({ id: 'new', q_sk: '', a_sk: '', q_en: '', a_en: '' }, -1) : ''}
      ${items.map(card).join('') || (adding ? '' : '<div class="card" style="color:var(--gray)">No questions yet. The block is not shown on the page.</div>')}`;
  }

  const say = (c, text, bad) => { const m = c.querySelector('.faq-msg'); m.textContent = text; m.style.color = bad ? 'var(--danger)' : 'var(--green, #2e9e4f)'; };
  const bodyOf = (c) => { const b = {}; c.querySelectorAll('[data-f]').forEach((el) => { b[el.dataset.f] = el.value; }); return b; };

  host.addEventListener('toggle', (e) => {
    const c = e.target;
    if (c.classList && c.classList.contains('faq-card') && c.dataset.id !== 'new') { if (c.open) open.add(c.dataset.id); else open.delete(c.dataset.id); }
  }, true);

  host.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const act = btn.dataset.act;
    if (act === 'new') { adding = true; render(); return; }
    if (act === 'cancel') { adding = false; render(); return; }
    const c = btn.closest('.faq-card');
    const id = c && c.dataset.id;
    try {
      if (act === 'save' && id === 'new') {
        const r = await api('/faq', { method: 'POST', body: bodyOf(c) });
        items = r.items; adding = false; open.add(String(r.id)); render();
      } else if (act === 'save') {
        items = (await api(`/faq/${id}`, { method: 'PUT', body: bodyOf(c) })).items;
        render();
        say(host.querySelector(`.faq-card[data-id="${id}"]`), 'Saved ✓');
      } else if (act === 'remove') {
        if (!window.confirm('Remove this question? It is lost.')) return;
        items = (await api(`/faq/${id}`, { method: 'DELETE' })).items;
        render();
      } else if (act === 'up' || act === 'down') {
        const ids = items.map((it) => String(it.id));
        const at = ids.indexOf(id);
        const to = act === 'up' ? at - 1 : at + 1;
        if (to < 0 || to >= ids.length) return;
        [ids[at], ids[to]] = [ids[to], ids[at]];
        items = (await api('/faq/order', { method: 'PUT', body: { ids: ids.map(Number) } })).items;
        render();
      }
    } catch (err) {
      if (c) say(c, err.message, true); else toast(err.message);
    }
  });

  checkAdmin().then(async (isAdmin) => {
    if (!isAdmin) { host.innerHTML = '<div class="card"><p style="margin:0;color:var(--gray)">Editing the questions requires an admin login. <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.</p></div>'; return; }
    try { items = (await api('/faq')).items; render(); } catch (err) { host.innerHTML = `<div class="card" style="color:var(--danger)">${esc(err.message)}</div>`; }
  });
})();

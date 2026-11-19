// Backend > E-mails (/emails-admin): the e-mails the site sends. Now only the "Welcome e-mail": the e-mail a player gets after the first registration (super admin; the texts live in site_settings, see src/welcomeEmail.js)
async function loadWelcomeCard(card) {
  let w;
  try { w = await api('/welcome-email'); } catch (err) { card.textContent = err.message; return; }
  const lang = (code, label) => `
    <div style="flex:1 1 320px;min-width:0">
      <h4 style="margin:12px 0 6px">${label}</h4>
      <div class="field"><label>Subject</label><input type="text" id="we-${code}-subject" maxlength="150" value="${escapeHtml(w[code].subject)}"></div>
      <div class="field"><label>Text</label><textarea id="we-${code}-body" rows="22" maxlength="6000" style="font-family:inherit;line-height:1.5">${escapeHtml(w[code].body)}</textarea></div>
    </div>`;
  card.innerHTML = `
    <h3 style="margin-top:0">Welcome e-mail <span style="font-weight:400;color:var(--gray-dim);font-size:13px">— sent to a player right after the first registration (in the language the player registered in)</span></h3>
    <p style="font-size:13px;color:var(--gray-dim);margin:0 0 10px">Write <code>{name}</code> where the player’s name should stand and <code>{link}</code> for the link to the player’s profile. Line breaks are kept. Emptying a text and saving brings the built-in text back.</p>
    <form id="welcome-form">
      <label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="we-enabled" ${w.enabled ? 'checked' : ''}> Send the welcome e-mail</label>
      <div style="display:flex;gap:20px;flex-wrap:wrap">${lang('sk', 'Slovak')}${lang('en', 'English')}</div>
      <div id="welcome-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="submit" class="btn btn-primary">Save welcome e-mail</button>
        <input type="email" id="we-test-to" placeholder="send a test to…" style="min-width:220px">
        <button type="button" class="btn btn-outline" id="we-test-sk">Test (SK)</button>
        <button type="button" class="btn btn-outline" id="we-test-en">Test (EN)</button>
      </div>
    </form>`;
  const read = () => ({ enabled: document.getElementById('we-enabled').checked, ...Object.fromEntries(['sk', 'en'].map((c) => [c, { subject: document.getElementById(`we-${c}-subject`).value, body: document.getElementById(`we-${c}-body`).value }])) });
  const errorEl = document.getElementById('welcome-error');
  const save = async () => {
    const out = await api('/welcome-email', { method: 'PUT', body: read() });
    for (const c of ['sk', 'en']) { document.getElementById(`we-${c}-subject`).value = out[c].subject; document.getElementById(`we-${c}-body`).value = out[c].body; }
  };
  document.getElementById('welcome-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    try { await save(); toast('Welcome e-mail saved'); } catch (err) { errorEl.textContent = err.message; }
  });
  for (const c of ['sk', 'en']) {
    document.getElementById(`we-test-${c}`).addEventListener('click', async () => {
      errorEl.textContent = '';
      try {
        await save(); // the test shows what is typed above
        await api('/welcome-email/test', { method: 'POST', body: { to: document.getElementById('we-test-to').value, lang: c } });
        toast('Test e-mail sent');
      } catch (err) { errorEl.textContent = err.message; }
    });
  }
}


(function emailsAdmin() {
  const host = document.getElementById('emails-admin-root');
  if (!host) return;
  host.innerHTML = '<div class="card" id="welcome-card" style="margin-top:0">Loading…</div>';
  loadWelcomeCard(document.getElementById('welcome-card'));
})();

// Backend > E-mails (/emails-admin): the e-mails the site sends. Now only the "Welcome e-mail": the e-mail a player gets after the first registration (super admin; the texts live in site_settings, see src/welcomeEmail.js)
async function loadWelcomeCard(card) {
  let w;
  try { w = await api('/welcome-email'); } catch (err) { card.textContent = err.message; return; }
  // the elements of the e-mail: a button puts its line at the cursor (the look is made from the line, see dress() in src/welcomeEmail.js)
  const ELEMENTS = [['Heading', '# Heading'], ['Step', '1. Step title – what to do'], ['Bullet', '- Point'], ['Box', '> Highlighted text'], ['Button', '[Button text](https://)'], ['Divider', '---']];
  const lang = (code, label) => `
    <div class="we-lang" data-code="${code}" style="display:flex;gap:20px;flex-wrap:wrap;margin-top:6px">
      <div style="flex:1 1 380px;min-width:0">
        <h4 style="margin:12px 0 6px">${label}</h4>
        <div class="field"><label>Subject</label><input type="text" id="we-${code}-subject" maxlength="150" value="${escapeHtml(w[code].subject)}"></div>
        <div class="field"><label>Text</label>
          <div class="rte-toolbar" data-for="${code}">${ELEMENTS.map(([name, snippet]) => `<button type="button" data-snippet="${escapeHtml(snippet)}" title="Inserts the line: ${escapeHtml(snippet)}">${name}</button>`).join('')}</div>
          <textarea id="we-${code}-body" rows="22" maxlength="6000" style="font-family:inherit;line-height:1.5">${escapeHtml(w[code].body)}</textarea>
        </div>
      </div>
      <div style="flex:1 1 380px;min-width:0">
        <h4 style="margin:12px 0 6px">Preview <span style="font-weight:400;color:var(--gray-dim);font-size:12px">— what the e-mail looks like (${label})</span></h4>
        <iframe id="we-${code}-preview" title="E-mail preview" sandbox="" style="width:100%;height:640px;border:1px solid #333;border-radius:10px;background:#0d0c0a"></iframe>
      </div>
    </div>`;
  card.innerHTML = `
    <h3 style="margin-top:0">Welcome e-mail <span style="font-weight:400;color:var(--gray-dim);font-size:13px">— sent to a player right after the first registration (in the language the player registered in)</span></h3>
    <p style="font-size:13px;color:var(--gray-dim);margin:0 0 10px">Write <code>{name}</code> where the player’s name should stand and <code>{link}</code> for the link to the player’s profile. Line breaks are kept. Emptying a text and saving brings the built-in text back.</p>
    <form id="welcome-form">
      <label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="we-enabled" ${w.enabled ? 'checked' : ''}> Send the welcome e-mail</label>
      ${lang('sk', 'Slovak')}${lang('en', 'English')}
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
  // the live preview: the server draws the same HTML that is sent (nothing is saved), a moment after the last key
  const timers = {};
  const refresh = (c) => {
    clearTimeout(timers[c]);
    timers[c] = setTimeout(async () => {
      try {
        const out = await api('/welcome-email/preview', { method: 'POST', body: { lang: c, body: document.getElementById(`we-${c}-body`).value } });
        document.getElementById(`we-${c}-preview`).srcdoc = out.html;
      } catch (err) { document.getElementById(`we-${c}-preview`).srcdoc = `<p style="font-family:sans-serif;color:#c00">${escapeHtml(err.message)}</p>`; }
    }, 350);
  };
  for (const c of ['sk', 'en']) {
    const ta = document.getElementById(`we-${c}-body`);
    ta.addEventListener('input', () => refresh(c));
    refresh(c);
  }
  card.addEventListener('click', (e) => {
    const b = e.target.closest('.rte-toolbar[data-for] [data-snippet]');
    if (!b) return;
    const c = b.closest('.rte-toolbar').dataset.for;
    const ta = document.getElementById(`we-${c}-body`);
    const at = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    const before = ta.value.slice(0, at);
    const lead = before && !before.endsWith('\n') ? '\n' : '';
    ta.value = `${before}${lead}${b.dataset.snippet}\n${ta.value.slice(at)}`;
    ta.focus();
    refresh(c);
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

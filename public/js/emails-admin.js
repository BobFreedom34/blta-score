// Backend > E-mails (/emails-admin): the e-mails the site sends (super admin). The "Welcome e-mail" has its own look (src/welcomeEmail.js); every other e-mail is a plain-text template with {variables} (src/emailTemplates.js, GET/PUT /api/email-templates). Texts live in site_settings.
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
    <summary style="cursor:pointer;padding:14px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <b>Welcome e-mail</b>
      <span style="font-size:12px;color:var(--gray-dim)">→ The player, right after the first registration (in the language the player registered in)</span>
    </summary>
    <div style="padding:0 18px 18px">
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
    </form>
    </div>`;
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


// The other e-mails: plain text with {variables}, grouped. Each one opens to its subject and text, the variables to click in, a live preview with example values, Save,
// "Built-in text" (back to the text the site shipped with) and a test e-mail.
async function loadTemplates(root) {
  let data;
  try { data = await api('/email-templates'); } catch (err) { root.textContent = err.message; return; }
  const field = (id, label, inner) => `<div class="field"><label for="${id}">${label}</label>${inner}</div>`;
  const card = (t) => `
    <details class="card et-card" data-key="${t.key}" style="margin:0 0 10px;padding:0">
      <summary style="cursor:pointer;padding:14px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <b>${escapeHtml(t.title)}</b>
        <span style="font-size:12px;color:var(--gray-dim)">→ ${escapeHtml(t.audience)}</span>
        <span class="et-edited" style="${t.edited ? '' : 'display:none;'}font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--green)">edited</span>
      </summary>
      <div style="padding:0 18px 18px">
        <p style="margin:0 0 10px;font-size:13px;color:var(--gray-dim)"><b>Sent when:</b> ${escapeHtml(t.when)}</p>
        <div style="display:flex;gap:20px;flex-wrap:wrap">
          <div style="flex:1 1 380px;min-width:0">
            ${field(`et-${t.key}-subject`, 'Subject', `<input type="text" id="et-${t.key}-subject" maxlength="200" value="${escapeHtml(t.subject)}">`)}
            ${field(`et-${t.key}-body`, 'Text', `<textarea id="et-${t.key}-body" rows="12" maxlength="4000" style="font-family:inherit;line-height:1.5">${escapeHtml(t.body)}</textarea>`)}
            <div style="font-size:12px;color:var(--gray-dim);margin:-4px 0 6px">Click a variable to put it in the text (or in the subject, if that was the last place you typed):</div>
            <div class="et-vars" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
              ${t.vars.map((v) => `<button type="button" class="btn btn-sm btn-outline" data-var="${v.name}" title="${escapeHtml(v.desc)} — e.g. ${escapeHtml(v.sample || '(empty)')}" style="padding:3px 9px;font-size:12px">{${v.name}}</button>`).join('')}
            </div>
            <details style="font-size:12px;color:var(--gray-dim);margin-bottom:12px"><summary style="cursor:pointer">What the variables mean</summary>
              <ul style="margin:6px 0 0 18px;padding:0">${t.vars.map((v) => `<li><code>{${v.name}}</code> — ${escapeHtml(v.desc)}</li>`).join('')}</ul>
            </details>
            <div class="et-error" style="color:var(--danger);font-weight:600;margin:6px 0"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <button type="button" class="btn btn-primary" data-et="save">Save</button>
              <button type="button" class="btn btn-outline" data-et="reset" ${t.edited ? '' : 'style="display:none"'}>Built-in text</button>
              <button type="button" class="btn btn-outline" data-et="test">Send a test</button>
            </div>
          </div>
          <div style="flex:1 1 340px;min-width:0">
            <h4 style="margin:0 0 6px">Preview <span style="font-weight:400;color:var(--gray-dim);font-size:12px">— with example values</span></h4>
            <div class="et-preview" style="border:1px solid #333;border-radius:10px;background:#0d0c0a;padding:14px 16px">
              <div class="et-p-subject" style="font-weight:800;margin-bottom:10px"></div>
              <pre class="et-p-text" style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:14px;line-height:1.55;color:#c9ccd3"></pre>
            </div>
          </div>
        </div>
      </div>
    </details>`;
  root.innerHTML = `
    <h3 style="margin:0 0 4px;color:var(--white)">Other e-mails</h3>
    <p style="font-size:13px;color:var(--gray-dim);margin:0 0 10px">Every other e-mail the site sends, as plain text. Open one to change its subject and text. Words in curly brackets, like <code>{name}</code>, are filled in when it is sent.
      A line whose variables are all empty is left out (so “Phone: {phone}” disappears when there is no phone). Start a line with <code>{?variable}</code> to keep it only when that variable has a value, or <code>{!variable}</code> only when it has none.
      “Built-in text” brings the original wording back.</p>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
      <label for="et-test-to" style="font-weight:600;color:var(--white)">Send tests to</label>
      <input type="email" id="et-test-to" placeholder="your e-mail" style="min-width:240px">
    </div>
    ${data.groups.map((g) => `
      <h4 style="margin:22px 0 8px;text-transform:uppercase;letter-spacing:.06em;font-size:12px;color:var(--gray-dim)">${escapeHtml(g)}</h4>
      ${data.templates.filter((t) => t.group === g).map(card).join('')}`).join('')}`;

  const timers = {};
  const read = (key) => ({ subject: document.getElementById(`et-${key}-subject`).value, body: document.getElementById(`et-${key}-body`).value });
  const refresh = (key) => {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(async () => {
      const box = root.querySelector(`.et-card[data-key="${key}"]`);
      try {
        const out = await api(`/email-templates/${key}/preview`, { method: 'POST', body: read(key) });
        box.querySelector('.et-p-subject').textContent = out.subject;
        box.querySelector('.et-p-text').textContent = out.text;
      } catch (err) { box.querySelector('.et-p-text').textContent = err.message; }
    }, 300);
  };
  // the preview is drawn when a card is opened and after every key
  root.querySelectorAll('.et-card').forEach((box) => {
    const key = box.dataset.key;
    box.addEventListener('toggle', () => { if (box.open) refresh(key); });
    box.addEventListener('input', () => refresh(key));
    let last = `et-${key}-body`;
    box.addEventListener('focusin', (e) => { if (e.target.id === `et-${key}-subject` || e.target.id === `et-${key}-body`) last = e.target.id; });
    box.addEventListener('click', async (e) => {
      const chip = e.target.closest('[data-var]');
      if (chip) {
        const el = document.getElementById(last);
        const at = el.selectionStart == null ? el.value.length : el.selectionStart;
        const end = el.selectionEnd == null ? at : el.selectionEnd;
        const token = `{${chip.dataset.var}}`;
        el.value = el.value.slice(0, at) + token + el.value.slice(end);
        el.focus();
        el.setSelectionRange(at + token.length, at + token.length);
        refresh(key);
        return;
      }
      const act = e.target.closest('[data-et]');
      if (!act) return;
      const errorEl = box.querySelector('.et-error');
      errorEl.textContent = '';
      const showState = (t) => {
        box.querySelector('.et-edited').style.display = t.edited ? '' : 'none';
        box.querySelector('[data-et="reset"]').style.display = t.edited ? '' : 'none';
      };
      try {
        if (act.dataset.et === 'save') {
          const t = await api(`/email-templates/${key}`, { method: 'PUT', body: read(key) });
          document.getElementById(`et-${key}-subject`).value = t.subject;
          document.getElementById(`et-${key}-body`).value = t.body;
          showState(t);
          refresh(key);
          toast('Saved');
        } else if (act.dataset.et === 'reset') {
          if (!confirm('Go back to the built-in text of this e-mail? Your text is lost.')) return;
          const t = await api(`/email-templates/${key}`, { method: 'DELETE' });
          document.getElementById(`et-${key}-subject`).value = t.subject;
          document.getElementById(`et-${key}-body`).value = t.body;
          showState(t);
          refresh(key);
          toast('Built-in text restored');
        } else if (act.dataset.et === 'test') {
          await api(`/email-templates/${key}/test`, { method: 'POST', body: { to: document.getElementById('et-test-to').value, ...read(key) } });
          toast('Test e-mail sent');
        }
      } catch (err) { errorEl.textContent = err.message; }
    });
  });
}

(function emailsAdmin() {
  const host = document.getElementById('emails-admin-root');
  if (!host) return;
  host.innerHTML = '<details class="card et-card" id="welcome-card" style="margin:0;padding:0"><summary style="cursor:pointer;padding:14px 18px">Loading…</summary></details><div id="templates-root" style="margin-top:24px"></div>';
  loadWelcomeCard(document.getElementById('welcome-card'));
  loadTemplates(document.getElementById('templates-root'));
})();

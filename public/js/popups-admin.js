// Backend > Popups (/popups-admin): the pop-ups that ask the logged-in players to register for the next season or tournament. A list with the state and the
// numbers of each (shown, registered, said no, still deciding), an editor (the event, the texts in both languages, from / to, how often it comes back, who
// gets it), a preview of what the player sees, a copy, a switch, "ask everybody again" and a delete. Data: /api/popups (see src/routes/popups.js).
(function popupsAdmin() {
  const host = document.getElementById('popups-admin-root');
  if (!host) return;

  const field = 'display:block;width:100%;margin-top:4px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  const esc = (s) => escapeHtml(String(s == null ? '' : s));
  let data = null; // { popups, events, today }
  let editing = null; // null = the list; { id|null, ...values } = the editor
  const clone = (v) => JSON.parse(JSON.stringify(v));

  const STATUS = {
    ACTIVE: ['Active', '#2e9e4f', 'It is being shown to the players who are not registered yet.'],
    SCHEDULED: ['Scheduled', '#3b82f6', 'It starts on the date "from".'],
    ENDED: ['Ended', '#8b8f98', 'The date "to" has passed.'],
    OFF: ['Off', '#8b8f98', 'Switched off.'],
    CLOSED: ['Registration closed', '#d97706', 'The event takes no registration (any more), so there is nothing to ask. Open the registration of the event.'],
  };
  const fmt = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${Number(d)}.${Number(m)}.${y}`; };
  const say = (text, bad) => { const m = document.getElementById('pa-msg'); if (m) { m.textContent = text; m.style.color = bad ? 'var(--danger)' : 'var(--green, #2e9e4f)'; } };

  function load() {
    return api('/popups').then((d) => { data = d; render(); });
  }

  const REASON = { NO_TIME: 'no time', NOT_THIS_TIME: 'not this time', OTHER: 'other reason' };
  // who said "I don't want to register" (the latest first), with the reason when he gave one
  function declinedList(s) {
    if (!s.declinedPlayers || !s.declinedPlayers.length) return '';
    return `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:13px;font-weight:700">Who said no (${s.declinedPlayers.length})</summary>
      <ul style="margin:6px 0 0;padding-left:18px;font-size:13px">${s.declinedPlayers.map((d) => `<li><b>${esc(d.name)}</b> <span style="color:var(--gray)">· ${esc(REASON[d.reason] || 'no reason given')} · ${esc(fmt(d.at.slice(0, 10)))}</span></li>`).join('')}</ul></details>`;
  }

  function card(p) {
    const [label, color, hint] = STATUS[p.status] || STATUS.OFF;
    const s = p.stats;
    const when = p.startsAt || p.endsAt ? `${p.startsAt ? `from ${fmt(p.startsAt)}` : ''}${p.startsAt && p.endsAt ? ' ' : ''}${p.endsAt ? `to ${fmt(p.endsAt)}` : ''}` : 'no dates (as long as the registration is open)';
    const rate = s.shown ? Math.round((s.registered / s.shown) * 100) : 0;
    const reasons = s.declined ? `<div style="font-size:12px;color:var(--gray);margin-top:2px">Why they said no: no time ${s.reasons.NO_TIME} · not this time ${s.reasons.NOT_THIS_TIME} · other ${s.reasons.OTHER} · not said ${s.declined - s.reasons.NO_TIME - s.reasons.NOT_THIS_TIME - s.reasons.OTHER}</div>` : '';
    return `
      <div class="card pa-card" data-id="${p.id}" style="margin-bottom:12px">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between">
          <div style="min-width:220px;flex:1 1 260px">
            <strong style="font-size:16px">${esc(p.headline.sk || 'Nezabudni sa zaregistrovať')}</strong>
            <div style="font-size:13px;color:var(--gray);margin-top:2px">${p.seasonKind === 'TOURNAMENT' ? 'Tournament' : 'Season'}: <b>${esc(p.seasonName)}</b> · ${esc(when)} · again after ${p.repeatDays} day${p.repeatDays === 1 ? '' : 's'} · ${p.audience === 'PAST' ? 'players of earlier seasons' : 'all players'}</div>
          </div>
          <span title="${esc(hint)}" style="padding:4px 10px;border-radius:999px;font-size:12px;font-weight:800;background:${color}22;color:${color};border:1px solid ${color}66">${label}</span>
        </div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin:12px 0 2px;font-size:13px">
          <span><b style="font-size:18px">${s.shown}</b><br>players saw it</span>
          <span><b style="font-size:18px;color:var(--green,#2e9e4f)">${s.registered}</b><br>registered${s.shown ? ` (${rate} %)` : ''}</span>
          <span><b style="font-size:18px">${s.declined}</b><br>said no</span>
          <span><b style="font-size:18px">${s.waiting}</b><br>still deciding</span>
        </div>
        ${reasons}
        ${declinedList(s)}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button type="button" class="btn btn-sm btn-outline" data-act="edit">Edit</button>
          <button type="button" class="btn btn-sm btn-outline" data-act="preview">Preview</button>
          <button type="button" class="btn btn-sm btn-outline" data-act="copy">Duplicate</button>
          <button type="button" class="btn btn-sm btn-outline" data-act="toggle">${p.enabled ? 'Switch off' : 'Switch on'}</button>
          <button type="button" class="btn btn-sm btn-outline" data-act="reset" title="Players who closed it or said no are asked again">Ask everybody again</button>
          <button type="button" class="btn btn-sm btn-danger" data-act="delete">Delete</button>
        </div>
      </div>`;
  }

  function list() {
    return `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
        <button type="button" class="btn btn-primary" data-act="new">+ New popup</button>
        <span id="pa-msg" style="font-weight:600"></span>
      </div>
      ${data.popups.length ? data.popups.map(card).join('') : '<div class="card"><p style="margin:0;color:var(--gray)">No popups yet. Make the first one: choose the next season or tournament, the days it should run, and the players who are not registered yet will be asked.</p></div>'}
      <div class="card" style="margin-top:14px;font-size:13px;color:var(--gray)">
        <b style="color:inherit">How it works.</b> A logged-in player gets the pop-up on the first page he opens while it is active and he is not registered for that event.
        <b>I want to register</b> registers him at once (his name, phone and e-mail are filled in from his profile; no category is asked, you sort the players yourself).
        <b>I don't want to register</b> ends it for him for good. The cross, the area around the window and Esc close it for now: it comes back after the number of days you set, until he decides.
        It never shows on the page of the event itself, nor to a player who is registered already, nor when the registration of the event is closed.
      </div>`;
  }

  const eventOptions = (selected) => data.events.map((e) => `<option value="${e.id}"${e.id === selected ? ' selected' : ''}>${esc(e.name)} — ${e.kind === 'TOURNAMENT' ? 'tournament' : 'season'}${e.startDate ? `, ${fmt(e.startDate)}` : ''}${e.registrationOpen ? '' : ' (registration closed)'}</option>`).join('');

  function editor() {
    const e = editing;
    const ev = data.events.find((x) => x.id === e.seasonId);
    const dflt = ev && ev.kind === 'TOURNAMENT' ? 'tournament' : 'season';
    return `
      <div class="card" style="margin-bottom:14px">
        <strong>${e.id ? 'Edit the popup' : 'New popup'}</strong>
        ${data.events.length ? '' : '<p style="color:var(--danger);font-size:13px">This city has no season or tournament yet. Make one first (Backend → Seasons / Tournaments).</p>'}
        <label style="display:block;font-size:12px;font-weight:700;margin-top:12px">The event the popup is about
          <select id="pa-season" style="${field}">${eventOptions(e.seasonId)}</select></label>
        <div style="font-size:12px;color:var(--gray);margin-top:4px">The photo, the name, the dates and the place of the event are taken from the event itself, so they are always right.</div>

        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <label style="flex:1 1 260px;font-size:12px;font-weight:700;margin-top:12px">Headline (Slovak)
            <input type="text" id="pa-hsk" maxlength="90" value="${esc(e.headline.sk)}" placeholder="Nezabudni sa zaregistrovať" style="${field}"></label>
          <label style="flex:1 1 260px;font-size:12px;font-weight:700;margin-top:12px">Headline (English)
            <input type="text" id="pa-hen" maxlength="90" value="${esc(e.headline.en)}" placeholder="Don't forget to register" style="${field}"></label>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <label style="flex:1 1 260px;font-size:12px;font-weight:700;margin-top:12px">Message (Slovak, optional)
            <textarea id="pa-msk" rows="3" maxlength="400" placeholder="e.g. Nová sezóna začína už v septembri. Registrácia trvá minútu." style="${field};resize:vertical">${esc(e.message.sk)}</textarea></label>
          <label style="flex:1 1 260px;font-size:12px;font-weight:700;margin-top:12px">Message (English, optional)
            <textarea id="pa-men" rows="3" maxlength="400" placeholder="e.g. The new ${dflt} starts in September. It takes a minute." style="${field};resize:vertical">${esc(e.message.en)}</textarea></label>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <label style="flex:1 1 150px;font-size:12px;font-weight:700;margin-top:12px">Shown from
            <input type="date" id="pa-from" value="${esc(e.startsAt)}" style="${field}"></label>
          <label style="flex:1 1 150px;font-size:12px;font-weight:700;margin-top:12px">Shown until (included)
            <input type="date" id="pa-to" value="${esc(e.endsAt)}" style="${field}"></label>
          <label style="flex:1 1 150px;font-size:12px;font-weight:700;margin-top:12px">Comes back after (days)
            <input type="number" id="pa-repeat" min="1" max="60" value="${esc(e.repeatDays)}" style="${field}"></label>
          <label style="flex:1 1 220px;font-size:12px;font-weight:700;margin-top:12px">Who gets it
            <select id="pa-audience" style="${field}"><option value="ALL"${e.audience === 'ALL' ? ' selected' : ''}>All logged-in players of this city</option><option value="PAST"${e.audience === 'PAST' ? ' selected' : ''}>Only players who played here before (a registration or a match in another season)</option></select></label>
        </div>
        <div style="font-size:12px;color:var(--gray);margin-top:6px">Leave the dates empty to show it as long as the registration of the event is open. After the player closes it with the cross it comes back after the days above, until he registers or says he does not want to.</div>
        <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:12px"><input type="checkbox" id="pa-enabled"${e.enabled ? ' checked' : ''}> Switched on</label>

        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px">
          <button type="button" class="btn btn-primary" data-act="save">Save</button>
          <button type="button" class="btn btn-outline" data-act="save-preview">Save and preview</button>
          <button type="button" class="btn btn-outline" data-act="cancel" style="color:#fff;border-color:rgba(255,255,255,.45)">Cancel</button>
          <span id="pa-msg" style="font-weight:600"></span>
        </div>
      </div>`;
  }

  function render() { host.innerHTML = editing ? editor() : list(); }

  function readEditor() {
    const v = (id) => document.getElementById(id).value;
    return {
      seasonId: Number(v('pa-season')), headline: { sk: v('pa-hsk'), en: v('pa-hen') }, message: { sk: v('pa-msk'), en: v('pa-men') },
      startsAt: v('pa-from'), endsAt: v('pa-to'), repeatDays: v('pa-repeat'), audience: v('pa-audience'), enabled: document.getElementById('pa-enabled').checked,
    };
  }

  const blank = () => {
    const open = data.events.find((e) => e.registrationOpen) || data.events[0];
    return { id: null, seasonId: open ? open.id : 0, headline: { sk: '', en: '' }, message: { sk: '', en: '' }, startsAt: data.today, endsAt: '', repeatDays: 3, audience: 'ALL', enabled: true };
  };
  const fromPopup = (p) => ({ id: p.id, seasonId: p.seasonId, headline: { ...p.headline }, message: { ...p.message }, startsAt: p.startsAt, endsAt: p.endsAt, repeatDays: p.repeatDays, audience: p.audience, enabled: p.enabled });

  async function preview(id) {
    const r = await api(`/popups/${id}/preview`);
    window.BLTA_EVENT_POPUP.show(r.popup, { preview: true });
  }

  host.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const cardEl = btn.closest('.pa-card');
    const p = cardEl ? data.popups.find((x) => x.id === Number(cardEl.dataset.id)) : null;
    try {
      if (act === 'new') { editing = blank(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      if (act === 'edit') { editing = fromPopup(p); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      if (act === 'copy') { editing = { ...fromPopup(p), id: null, startsAt: data.today, enabled: false }; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); say('A copy: change what you need and save (it starts switched off).'); return; }
      if (act === 'cancel') { editing = null; render(); return; }
      if (act === 'preview') { await preview(p.id); return; }
      if (act === 'toggle') { data = await api(`/popups/${p.id}`, { method: 'PUT', body: { ...fromPopup(p), enabled: !p.enabled } }); render(); say(p.enabled ? 'Switched off ✓' : 'Switched on ✓'); return; }
      if (act === 'reset') {
        if (!window.confirm('Ask everybody again? Players who closed this popup or said they do not want to register will see it again.')) return;
        data = await api(`/popups/${p.id}/reset`, { method: 'POST', body: {} }); render(); say('Done ✓ — everybody who has not registered will be asked again');
        return;
      }
      if (act === 'delete') {
        if (!window.confirm(`Delete the popup about "${p.seasonName}"? Its numbers are lost.`)) return;
        data = await api(`/popups/${p.id}`, { method: 'DELETE' }); render(); say('Deleted ✓');
        return;
      }
      if (act === 'save' || act === 'save-preview') {
        const body = readEditor();
        const res = editing.id ? await api(`/popups/${editing.id}`, { method: 'PUT', body }) : await api('/popups', { method: 'POST', body });
        const id = editing.id || res.id;
        data = res;
        editing = null;
        render();
        say('Saved ✓');
        if (act === 'save-preview') await preview(id);
      }
    } catch (err) { say(err.message, true); }
  });

  checkAdmin().then(async (isAdmin) => {
    if (!isAdmin) { host.innerHTML = '<div class="card"><p style="margin:0;color:var(--gray)">Managing popups requires an admin login. <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.</p></div>'; return; }
    try { await load(); } catch (err) { host.innerHTML = `<div class="card" style="color:var(--danger)">${esc(err.message)}</div>`; }
  });
})();

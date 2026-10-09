// Backend > Reservations (/reservations-admin): the courts, the times players can reserve, the rules (how many reservations a player may
// hold, how late one can be cancelled). The spots themselves are managed on the public page: the admin clicks one to put a player in it,
// cancel a reservation or delete the spot. API: /api/reservations (src/routes/reservations.js).
(function reservationsAdmin() {
  const host = document.getElementById('rv-admin-root');
  if (!host) return;

  const field = 'padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  const label = 'display:block;font-size:12px;font-weight:700';
  const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
  const TIMES = [];
  for (let m = 0; m <= 24 * 60; m += 30) TIMES.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  const BLOCKS = [[0, 'One spot for the whole time'], [30, '30 minutes each'], [60, '1 hour each'], [90, '1½ hours each'], [120, '2 hours each']];
  const DEFAULT_COLOR = '#b2fa06';
  let courts = [];
  let settings = { maxActive: 2, cancelHours: 2, afternoonFrom: '16:00' };
  let today = '';

  const timeOptions = (list, selected) => list.map((t) => `<option value="${t}"${t === selected ? ' selected' : ''}>${t}</option>`).join('');
  const say = (el, text, bad) => { el.textContent = text; el.style.color = bad ? 'var(--danger)' : 'var(--green, #2e9e4f)'; el.style.fontWeight = '600'; };

  async function load() {
    const [data, s] = await Promise.all([api('/reservations'), api('/reservations/settings')]);
    courts = data.courts;
    today = data.today;
    settings = s;
    render();
  }

  // ---------------------------------------------------------------- courts

  function courtsHtml() {
    const rows = courts.map((c, i) => `
      <div class="rva-court" data-id="${c.id}" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 0;border-top:1px solid #eee">
        <span class="hi-move">
          <button type="button" class="hi-arrow" data-move="up" aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button>
          <button type="button" class="hi-arrow" data-move="down" aria-label="Move down"${i === courts.length - 1 ? ' disabled' : ''}>↓</button>
        </span>
        <input type="text" data-f="name" value="${escapeHtml(c.name)}" maxlength="60" style="flex:1;min-width:140px;${field}">
        <span class="rva-color" data-color="${escapeHtml(c.color || '')}" style="display:inline-flex;align-items:center;gap:6px" title="Colour of the free spots on this court">
          <input type="color" data-f="color" value="${c.color || DEFAULT_COLOR}" aria-label="Colour of free spots" style="width:42px;height:34px;padding:2px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer">
          <button type="button" class="btn btn-sm btn-outline" data-act="color-reset"${c.color ? '' : ' disabled'}>Default</button>
        </span>
        <label style="display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:700" title="Price of one hour; a spot costs this times its length (empty = no price shown)"><input type="number" data-f="rate" value="${c.hourRate || ''}" min="0" max="1000" step="0.5" placeholder="0" style="width:80px;${field}"> €/h</label>
        <input type="text" data-f="note" value="${escapeHtml(c.note || '')}" maxlength="200" placeholder="Note (surface, address…)" style="flex:2;min-width:160px;${field}">
        <button type="button" class="btn btn-sm btn-outline" data-act="save">Save</button>
        <button type="button" class="btn btn-sm btn-danger" data-act="delete">Delete</button>
        <div style="flex-basis:100%;display:flex;gap:8px 14px;flex-wrap:wrap;align-items:center;font-size:12px;font-weight:700;color:var(--gray);padding-left:4px">
          <span>Other prices (€/h, empty = the €/h above):</span>
          ${[['weekdayMorning', 'Weekday morning'], ['weekdayAfternoon', 'Weekday afternoon'], ['weekend', 'Weekend']].map(([key, text]) => `<label style="display:inline-flex;align-items:center;gap:5px">${text} <input type="number" data-f="rate-${key}" value="${c.rates && c.rates[key] !== null && c.rates[key] !== undefined ? c.rates[key] : ''}" min="0" max="1000" step="0.5" placeholder="${c.hourRate || ''}" style="width:72px;${field}"></label>`).join('')}
        </div>
      </div>`).join('');
    return `
      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">Courts</h3>
        ${rows || '<div class="empty-state" style="padding:8px 0">No courts yet — add the first one below.</div>'}
        <form id="rva-add-court" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:12px">
          <label style="${label};flex:1;min-width:140px">New court
            <input type="text" id="rva-court-name" maxlength="60" placeholder="e.g. Court 1" required style="display:block;width:100%;margin-top:4px;${field}">
          </label>
          <label style="${label};flex:2;min-width:160px">Note <span style="font-weight:600;color:var(--gray)">(optional)</span>
            <input type="text" id="rva-court-note" maxlength="200" placeholder="e.g. clay, Beethovenova 11" style="display:block;width:100%;margin-top:4px;${field}">
          </label>
          <label style="${label}">Price per hour (€)
            <input type="number" id="rva-court-rate" min="0" max="1000" step="0.5" placeholder="e.g. 18" style="display:block;margin-top:4px;width:110px;${field}">
          </label>
          <label style="${label}">Free-spot colour
            <input type="color" id="rva-court-color" value="${DEFAULT_COLOR}" style="display:block;margin-top:4px;width:56px;height:38px;padding:2px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer">
          </label>
          <button type="submit" class="btn btn-primary">Add court</button>
        </form>
        <div style="font-size:12px;color:var(--gray);margin-top:8px">The colour free spots of a court have on the booking page. Avoid orange — that is the colour of reserved spots. “Default” uses the green of the site. The hour rate shows as a price under the time of free spots (1.5 h at 18 € = 27 €); leave it empty for no price. Below each court you can set other prices for weekday mornings, weekday afternoons and the weekend (where the afternoon starts is set under Rules); a spot over the change is priced half and half.</div>
        <div id="rva-courts-msg" style="margin-top:8px"></div>
      </div>`;
  }

  // ---------------------------------------------------------------- add times

  function addTimesHtml() {
    const courtBoxes = courts.map((c) => `<label style="font-weight:600;font-size:14px"><input type="checkbox" class="rva-c" value="${c.id}" checked> ${escapeHtml(c.name)}</label>`).join('');
    return `
      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">Add times</h3>
        <form id="rva-add-times">
          <div style="${label}">Courts<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px">${courtBoxes || '<span style="color:var(--gray)">Add a court first.</span>'}</div></div>
          <div style="display:flex;gap:16px;margin:14px 0 6px;font-size:14px;font-weight:700">
            <label><input type="radio" name="rva-mode" value="day" checked> One day</label>
            <label><input type="radio" name="rva-mode" value="repeat"> Repeat every week</label>
          </div>
          <div id="rva-mode-day" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
            <label style="${label}">Date <input type="date" id="rva-date" min="${today}" value="${today}" style="display:block;margin-top:4px;${field}"></label>
          </div>
          <div id="rva-mode-repeat" style="display:none">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
              <label style="${label}">From <input type="date" id="rva-from" min="${today}" value="${today}" style="display:block;margin-top:4px;${field}"></label>
              <label style="${label}">Until <input type="date" id="rva-to" min="${today}" style="display:block;margin-top:4px;${field}"></label>
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;font-weight:600;font-size:14px">${DAYS.map(([n, name]) => `<label><input type="checkbox" class="rva-w" value="${n}"> ${name}</label>`).join('')}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:14px">
            <label style="${label}">From <select id="rva-start" style="display:block;margin-top:4px;${field}">${timeOptions(TIMES.slice(0, -1), '10:00')}</select></label>
            <label style="${label}">To <select id="rva-end" style="display:block;margin-top:4px;${field}">${timeOptions(TIMES.slice(1), '12:00')}</select></label>
            <label style="${label}">Split into <select id="rva-block" style="display:block;margin-top:4px;${field}">${BLOCKS.map(([m, name]) => `<option value="${m}">${name}</option>`).join('')}</select></label>
            <button type="submit" class="btn btn-primary"${courts.length ? '' : ' disabled'}>Add times</button>
          </div>
          <div style="font-size:12px;color:var(--gray);margin-top:8px">“One spot for the whole time” makes a single block, for example Thursday 10:00–12:00 that one player reserves. A time that overlaps an existing spot on the same court is skipped.</div>
        </form>
        <div id="rva-times-msg" style="margin-top:8px"></div>
      </div>`;
  }

  // "Change many times": e.g. all Thursday evenings one hour later
  function shiftOptions() {
    let out = '<option value="0" selected>No change in time</option>';
    for (let m = -240; m <= 240; m += 30) {
      if (m === 0) continue;
      const abs = Math.abs(m);
      const text = `${abs >= 60 ? `${Math.floor(abs / 60)} h` : ''}${abs % 60 ? `${abs >= 60 ? ' ' : ''}${abs % 60} min` : ''}`;
      out += `<option value="${m}">${text} ${m > 0 ? 'later' : 'earlier'}</option>`;
    }
    return out;
  }

  // the length of the spots: set to a value, or made longer / shorter (the start stays, the end moves)
  function lengthOptions() {
    const label = (m) => `${m >= 60 ? `${Math.floor(m / 60)} h` : ''}${m % 60 ? `${m >= 60 ? ' ' : ''}${m % 60} min` : ''}`;
    let out = '<option value="" selected>No change in length</option><optgroup label="Set the length to">';
    [30, 60, 90, 120, 150, 180, 240].forEach((m) => { out += `<option value="set:${m}">${label(m)}</option>`; });
    out += '</optgroup><optgroup label="Make every spot">';
    [30, 60, 90, 120].forEach((m) => { out += `<option value="delta:${m}">${label(m)} longer</option>`; });
    [30, 60, 90, 120].forEach((m) => { out += `<option value="delta:-${m}">${label(m)} shorter</option>`; });
    return `${out}</optgroup>`;
  }

  function bulkHtml() {
    const courtBoxes = courts.map((c) => `<label style="font-weight:600;font-size:14px"><input type="checkbox" class="rva-bc" value="${c.id}" checked> ${escapeHtml(c.name)}</label>`).join('');
    const horizon = (() => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 60); return d.toISOString().slice(0, 10); })();
    return `
      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">Change many times at once</h3>
        <form id="rva-bulk">
          <div style="font-size:13px;font-weight:800;margin-bottom:6px">Which spots</div>
          <div style="${label}">Courts<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px">${courtBoxes}</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px">
            <label style="${label}">From <input type="date" id="rva-bfrom" min="${today}" value="${today}" style="display:block;margin-top:4px;${field}"></label>
            <label style="${label}">Until <input type="date" id="rva-bto" min="${today}" value="${horizon}" style="display:block;margin-top:4px;${field}"></label>
            <label style="${label}">Starting from <select id="rva-bstartfrom" style="display:block;margin-top:4px;${field}"><option value="">any time</option>${timeOptions(TIMES.slice(0, -1), '')}</select></label>
            <label style="${label}">Starting until <select id="rva-bstartuntil" style="display:block;margin-top:4px;${field}"><option value="">any time</option>${timeOptions(TIMES.slice(0, -1), '')}</select></label>
          </div>
          <div style="${label};margin-top:10px">Weekdays <span style="font-weight:600;color:var(--gray)">(none ticked = every day)</span>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px;font-weight:600;font-size:14px">${DAYS.map(([n, name]) => `<label><input type="checkbox" class="rva-bw" value="${n}"> ${name}</label>`).join('')}</div>
          </div>
          <div style="font-size:13px;font-weight:800;margin:16px 0 6px">What to change</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
            <label style="${label}">Time <select id="rva-bshift" style="display:block;margin-top:4px;${field}">${shiftOptions()}</select></label>
            <label style="${label}">Length <select id="rva-blength" style="display:block;margin-top:4px;${field}">${lengthOptions()}</select></label>
            <label style="${label}">Move to court <select id="rva-bcourt" style="display:block;margin-top:4px;${field}"><option value="">keep the court</option>${courts.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select></label>
          </div>
          <label style="display:flex;gap:8px;align-items:center;font-size:14px;font-weight:600;margin-top:12px"><input type="checkbox" id="rva-binc"> Also move spots that players have already reserved <span style="font-weight:600;color:var(--gray)">(they keep their reservation at the new time)</span></label>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
            <button type="button" class="btn btn-outline" id="rva-bpreview"${courts.length ? '' : ' disabled'}>Preview</button>
            <button type="submit" class="btn btn-primary"${courts.length ? '' : ' disabled'}>Apply changes</button>
          </div>
          <div style="font-size:12px;color:var(--gray);margin-top:8px">A spot that would overlap another one, cross midnight, become shorter than 30 minutes or land in the past is left where it is. “Preview” shows what would happen without changing anything.</div>
        </form>
        <div id="rva-bulk-msg" style="margin-top:8px"></div>
      </div>`;
  }

  function clearHtml() {
    const courtBoxes = courts.map((c) => `<label style="font-weight:600;font-size:14px"><input type="checkbox" class="rva-cc" value="${c.id}" checked> ${escapeHtml(c.name)}</label>`).join('');
    return `
      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">Remove free times</h3>
        <form id="rva-clear" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          <div style="${label}">Courts<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px">${courtBoxes}</div></div>
          <label style="${label}">From <input type="date" id="rva-cfrom" min="${today}" value="${today}" style="display:block;margin-top:4px;${field}"></label>
          <label style="${label}">Until <input type="date" id="rva-cto" min="${today}" value="${today}" style="display:block;margin-top:4px;${field}"></label>
          <button type="submit" class="btn btn-outline"${courts.length ? '' : ' disabled'}>Remove free times</button>
        </form>
        <div style="font-size:12px;color:var(--gray);margin-top:8px">Only spots nobody has reserved are removed; reserved ones stay.</div>
        <div id="rva-clear-msg" style="margin-top:8px"></div>
      </div>`;
  }

  function settingsHtml() {
    return `
      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">Rules</h3>
        <form id="rva-settings" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
          <label style="${label}">Reservations a player can hold at once <span style="font-weight:600;color:var(--gray)">(0 = no limit)</span>
            <input type="number" id="rva-max" min="0" max="50" value="${settings.maxActive}" style="display:block;margin-top:4px;width:110px;${field}">
          </label>
          <label style="${label}">A player can cancel until … hours before the start <span style="font-weight:600;color:var(--gray)">(0 = until it starts)</span>
            <input type="number" id="rva-cancel" min="0" max="168" value="${settings.cancelHours}" style="display:block;margin-top:4px;width:110px;${field}">
          </label>
          <label style="${label}">Afternoon prices start at
            <select id="rva-afternoon" style="display:block;margin-top:4px;${field}">${Array.from({ length: 33 }, (_, i) => { const m = 360 + i * 30; const v = `${String(Math.floor(m / 60)).padStart(2, '0')}:${m % 60 ? '30' : '00'}`; return `<option value="${v}"${v === settings.afternoonFrom ? ' selected' : ''}>${v}</option>`; }).join('')}</select>
          </label>
          <button type="submit" class="btn btn-outline">Save rules</button>
        </form>
        <div id="rva-settings-msg" style="margin-top:8px"></div>
      </div>`;
  }

  function render() {
    host.innerHTML = `${courtsHtml()}${addTimesHtml()}${bulkHtml()}${clearHtml()}${settingsHtml()}`;
    wire();
  }

  // ---------------------------------------------------------------- events

  function wire() {
    const msg = (id) => host.querySelector(id);

    host.querySelectorAll('input[name="rva-mode"]').forEach((r) => r.addEventListener('change', () => {
      const repeat = host.querySelector('input[name="rva-mode"]:checked').value === 'repeat';
      host.querySelector('#rva-mode-day').style.display = repeat ? 'none' : 'flex';
      host.querySelector('#rva-mode-repeat').style.display = repeat ? 'block' : 'none';
    }));

    host.querySelector('#rva-add-court').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/reservations/courts', { method: 'POST', body: { name: host.querySelector('#rva-court-name').value, note: host.querySelector('#rva-court-note').value, hourRate: host.querySelector('#rva-court-rate').value, color: host.querySelector('#rva-court-color').value.toLowerCase() === DEFAULT_COLOR ? '' : host.querySelector('#rva-court-color').value } });
        toast('Court added');
        await load();
      } catch (err) { say(msg('#rva-courts-msg'), err.message, true); }
    });

    host.querySelectorAll('.rva-court').forEach((row) => {
      const id = Number(row.dataset.id);
      const colorBox = row.querySelector('.rva-color');
      const colorInput = colorBox.querySelector('input');
      const resetBtn = colorBox.querySelector('[data-act="color-reset"]');
      colorInput.addEventListener('input', () => { colorBox.dataset.color = colorInput.value.toLowerCase(); resetBtn.disabled = false; });
      resetBtn.addEventListener('click', () => { colorBox.dataset.color = ''; colorInput.value = DEFAULT_COLOR; resetBtn.disabled = true; });
      row.querySelector('[data-act="save"]').addEventListener('click', async () => {
        try {
          await api(`/reservations/courts/${id}`, { method: 'PATCH', body: { name: row.querySelector('[data-f="name"]').value, note: row.querySelector('[data-f="note"]').value, hourRate: row.querySelector('[data-f="rate"]').value, rates: Object.fromEntries(['weekdayMorning', 'weekdayAfternoon', 'weekend'].map((key) => [key, row.querySelector(`[data-f="rate-${key}"]`).value])), color: row.querySelector('.rva-color').dataset.color } });
          toast('Court saved');
          await load();
        } catch (err) { say(msg('#rva-courts-msg'), err.message, true); }
      });
      row.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        const court = courts.find((c) => c.id === id);
        if (!window.confirm(`Delete "${court.name}" and all its times?`)) return;
        try {
          await api(`/reservations/courts/${id}`, { method: 'DELETE' });
        } catch (err) {
          if (err.data && err.data.code === 'HAS_RESERVATIONS') {
            if (!window.confirm(`${err.message}. Delete the court anyway?`)) return;
            try { await api(`/reservations/courts/${id}?force=1`, { method: 'DELETE' }); } catch (err2) { say(msg('#rva-courts-msg'), err2.message, true); return; }
          } else { say(msg('#rva-courts-msg'), err.message, true); return; }
        }
        toast('Court deleted');
        await load();
      });
      row.querySelectorAll('[data-move]').forEach((btn) => btn.addEventListener('click', async () => {
        const ids = courts.map((c) => c.id);
        const at = ids.indexOf(id);
        const to = btn.dataset.move === 'up' ? at - 1 : at + 1;
        if (to < 0 || to >= ids.length) return;
        [ids[at], ids[to]] = [ids[to], ids[at]];
        try { await api('/reservations/courts/reorder', { method: 'POST', body: { ids } }); await load(); } catch (err) { say(msg('#rva-courts-msg'), err.message, true); }
      }));
    });

    host.querySelector('#rva-add-times').addEventListener('submit', async (e) => {
      e.preventDefault();
      const repeat = host.querySelector('input[name="rva-mode"]:checked').value === 'repeat';
      const body = {
        courtIds: [...host.querySelectorAll('.rva-c:checked')].map((b) => Number(b.value)),
        start: host.querySelector('#rva-start').value,
        end: host.querySelector('#rva-end').value,
        blockMinutes: Number(host.querySelector('#rva-block').value),
      };
      if (repeat) {
        body.fromDate = host.querySelector('#rva-from').value;
        body.toDate = host.querySelector('#rva-to').value;
        body.weekdays = [...host.querySelectorAll('.rva-w:checked')].map((b) => Number(b.value));
      } else {
        body.date = host.querySelector('#rva-date').value;
      }
      try {
        const r = await api('/reservations/slots', { method: 'POST', body });
        say(msg('#rva-times-msg'), `${r.created} spot${r.created === 1 ? '' : 's'} added${r.skipped ? `, ${r.skipped} skipped (already a spot at that time, or the time is over)` : ''}.`);
      } catch (err) { say(msg('#rva-times-msg'), err.message, true); }
    });

    // change many: Preview shows the result without changing anything; Apply asks once more with the numbers
    const bulkBody = (dryRun) => {
      const [mode, amount] = host.querySelector('#rva-blength').value.split(':');
      return {
      lengthMinutes: mode === 'set' ? Number(amount) : undefined,
      lengthDelta: mode === 'delta' ? Number(amount) : undefined,
      courtIds: [...host.querySelectorAll('.rva-bc:checked')].map((b) => Number(b.value)),
      fromDate: host.querySelector('#rva-bfrom').value,
      toDate: host.querySelector('#rva-bto').value,
      weekdays: [...host.querySelectorAll('.rva-bw:checked')].map((b) => Number(b.value)),
      startFrom: host.querySelector('#rva-bstartfrom').value,
      startUntil: host.querySelector('#rva-bstartuntil').value,
      shiftMinutes: Number(host.querySelector('#rva-bshift').value),
      toCourtId: host.querySelector('#rva-bcourt').value,
      includeReserved: host.querySelector('#rva-binc').checked,
      dryRun,
      };
    };
    const bulkSummary = (r) => {
      const parts = [`${r.matched} spot${r.matched === 1 ? '' : 's'} match`, `${r.moved} ${r.dryRun ? 'would be moved' : 'moved'}`];
      if (r.skippedReserved) parts.push(`${r.skippedReserved} reserved left alone`);
      if (r.skippedConflict) parts.push(`${r.skippedConflict} left alone (would overlap another spot)`);
      if (r.skippedInvalid) parts.push(`${r.skippedInvalid} left alone (midnight, too short or already over)`);
      return `${parts.join(', ')}.${r.examples && r.examples.length ? ` e.g. ${r.examples.slice(0, 3).join('; ')}` : ''}`;
    };
    host.querySelector('#rva-bpreview').addEventListener('click', async () => {
      try { say(msg('#rva-bulk-msg'), `Preview: ${bulkSummary(await api('/reservations/slots/bulk-edit', { method: 'POST', body: bulkBody(true) }))}`); } catch (err) { say(msg('#rva-bulk-msg'), err.message, true); }
    });
    host.querySelector('#rva-bulk').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const preview = await api('/reservations/slots/bulk-edit', { method: 'POST', body: bulkBody(true) });
        if (!preview.moved) { say(msg('#rva-bulk-msg'), `Nothing to change. ${bulkSummary(preview)}`, true); return; }
        if (!window.confirm(`${preview.moved} spot${preview.moved === 1 ? '' : 's'} will be moved. Continue?`)) return;
        const done = await api('/reservations/slots/bulk-edit', { method: 'POST', body: bulkBody(false) });
        say(msg('#rva-bulk-msg'), `Done: ${bulkSummary(done)}`);
      } catch (err) { say(msg('#rva-bulk-msg'), err.message, true); }
    });

    host.querySelector('#rva-clear').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { courtIds: [...host.querySelectorAll('.rva-cc:checked')].map((b) => Number(b.value)), fromDate: host.querySelector('#rva-cfrom').value, toDate: host.querySelector('#rva-cto').value };
      if (!body.courtIds.length) { say(msg('#rva-clear-msg'), 'Choose at least one court', true); return; }
      if (!window.confirm(`Remove all free times from ${body.fromDate} to ${body.toDate}?`)) return;
      try {
        const r = await api('/reservations/slots/clear', { method: 'POST', body });
        say(msg('#rva-clear-msg'), `${r.removed} free spot${r.removed === 1 ? '' : 's'} removed.`);
      } catch (err) { say(msg('#rva-clear-msg'), err.message, true); }
    });

    host.querySelector('#rva-settings').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        settings = await api('/reservations/settings', { method: 'PUT', body: { maxActive: Number(host.querySelector('#rva-max').value), cancelHours: Number(host.querySelector('#rva-cancel').value), afternoonFrom: host.querySelector('#rva-afternoon').value } });
        say(msg('#rva-settings-msg'), 'Saved ✓');
      } catch (err) { say(msg('#rva-settings-msg'), err.message, true); }
    });
  }

  checkAdmin().then((isAdmin) => {
    if (isAdmin) { load().catch((err) => { host.innerHTML = `<div class="card" style="color:var(--danger)">${escapeHtml(err.message)}</div>`; }); return; }
    host.innerHTML = '<div class="card"><p style="margin:0;color:var(--gray)">Managing reservations requires an admin login. <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.</p></div>';
  });
})();

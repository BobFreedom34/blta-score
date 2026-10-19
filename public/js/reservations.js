// Court reservations (/rezervacie-kurtov, code address /reservations): a grid of the next 7 days — the days across the top, the time down
// the left in 30-minute rows, a column per court (or one court when a court is picked). A green block is a free spot the admin has
// opened (e.g. Thursday 10:00-12:00 is one block); a player takes it with one click and it turns orange with their name in it.
// Data: GET /api/reservations?from=YYYY-MM-DD, POST /api/reservations/slots/:id/reserve | cancel (src/routes/reservations.js).
(function reservationsPage() {
  const root = document.getElementById('rv-root');
  if (!root) return;

  let data = null;
  // ?from=YYYY-MM-DD (the links of the home page's free courts) opens the 7 days from that day; the server moves a day in the past to today
  let from = (/^\d{4}-\d{2}-\d{2}$/.exec(new URLSearchParams(window.location.search).get('from') || '') || [''])[0];
  let court = 'ALL';
  let isAdmin = false;
  let mine = null;
  let loadCount = 0;

  const locale = () => (currentLang === 'en' ? 'en-GB' : 'sk-SK');
  const dayDate = (iso) => new Date(`${iso}T12:00:00`);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const weekday = (iso, style) => cap(dayDate(iso).toLocaleDateString(locale(), { weekday: style }).replace('.', ''));
  const shortDay = (iso) => { const d = dayDate(iso); return `${d.getDate()}.${d.getMonth() + 1}.`; };
  const longDay = (iso) => `${weekday(iso, 'long')} ${shortDay(iso)}`;
  const mins = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const courtName = (id) => (data.courts.find((c) => c.id === id) || { name: '' }).name;
  // the colour of a court's free spots: the admin's choice or the green of the site; the text on it is dark or white, whichever reads better
  const textOn = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.6 ? '#0a0a0a' : '#ffffff';
  };
  // the price of a spot: every half hour of it costs half of the hour rate of its time (weekday morning, weekday afternoon — it starts at
  // the rule `afternoonFrom` — or the weekend, all day), so a spot over the change is priced half and half; no price = nothing shown
  const priceOf = (s) => {
    const court = data.courts.find((c) => c.id === s.courtId);
    if (!court) return '';
    const weekend = [0, 6].includes(dayDate(s.day).getDay());
    const from = (data.settings && data.settings.afternoonFrom) || '16:00';
    let eur = 0;
    for (let m = mins(s.start); m < mins(s.end); m += 30) {
      const key = weekend ? 'weekend' : hhmm(m) >= from ? 'weekdayAfternoon' : 'weekdayMorning';
      const own = court.rates ? court.rates[key] : null;
      eur += (own === null || own === undefined ? court.hourRate : own) / 2;
    }
    eur = Math.round(eur * 100) / 100;
    if (!eur) return '';
    const text = Number.isInteger(eur) ? String(eur) : eur.toFixed(2);
    return `${currentLang === 'en' ? text : text.replace('.', ',')} €`;
  };
  const colorVars = (id) => {
    const c = (data.courts.find((x) => x.id === id) || {}).color;
    return c ? `--rv-c:${c};--rv-t:${textOn(c)};` : '';
  };

  // ---------------------------------------------------------------- data

  async function load() {
    const run = ++loadCount;
    const res = await api(`/reservations${from ? `?from=${from}` : ''}`);
    if (run !== loadCount) return; // a newer request replaced this one
    data = res;
    from = res.from;
    if (court !== 'ALL' && !data.courts.some((c) => String(c.id) === String(court))) court = 'ALL';
    mine = null;
    if (data.me) {
      try { mine = await api('/reservations/mine'); } catch { mine = null; }
    }
    render();
  }

  async function reload() {
    try { await load(); } catch (err) { root.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`; }
  }

  // ---------------------------------------------------------------- the grid

  function gridHtml() {
    const courts = court === 'ALL' ? data.courts : data.courts.filter((c) => String(c.id) === String(court));
    if (!data.courts.length) return `<div class="empty-state">${escapeHtml(t('rv.noCourts'))}</div>`;
    const slots = data.slots.filter((s) => courts.some((c) => c.id === s.courtId));
    // the timeline is always 8:00-21:00; a spot outside it (an early or late one) stretches it so it is never cut off
    let startMin = 8 * 60;
    let endMin = 21 * 60;
    if (slots.length) {
      startMin = Math.min(startMin, Math.floor(Math.min(...slots.map((s) => mins(s.start))) / 60) * 60);
      endMin = Math.max(endMin, Math.ceil(Math.max(...slots.map((s) => mins(s.end))) / 60) * 60);
    }
    const colsN = (endMin - startMin) / 30;
    // every day is a card of its own (orange border, a gap to the next): a header row (the day, then the hours) and a row per court
    const days = data.days.map((day) => {
      const cls = ['rv-dayh'];
      if (day === data.today) cls.push('today');
      if ([0, 6].includes(dayDate(day).getDay())) cls.push('weekend');
      const out = [`<div class="rv-grid" style="--n:${colsN};grid-template-columns:var(--rv-courtw) repeat(${colsN}, minmax(var(--rv-col), 1fr));grid-template-rows:var(--rv-head) repeat(${courts.length}, var(--rv-row))">`];
      out.push(`<div class="${cls.join(' ')}" style="grid-column:1;grid-row:1"><b>${escapeHtml(weekday(day, 'short'))}</b> ${escapeHtml(shortDay(day))}</div>`);
      for (let m = startMin; m < endMin; m += 60) {
        out.push(`<div class="rv-time" style="grid-column:${2 + (m - startMin) / 30} / span 2;grid-row:1">${hhmm(m)}</div>`);
      }
      courts.forEach((c, j) => {
        out.push(`<div class="rv-courth${j === 0 ? ' first' : ''}" title="${escapeHtml(c.note || c.name)}" style="grid-column:1;grid-row:${2 + j};${colorVars(c.id)}">${escapeHtml(c.name)}</div>`);
        out.push(`<div class="rv-row${j === 0 ? ' first' : ''}${day === data.today ? ' today' : ''}" data-day="${day}" data-court="${c.id}" data-start="${startMin}" data-cols="${colsN}" style="grid-column:2 / span ${colsN};grid-row:${2 + j}"></div>`);
      });
      slots.filter((s) => s.day === day).forEach((s) => {
        const j = courts.findIndex((c) => c.id === s.courtId);
        const c1 = 2 + (mins(s.start) - startMin) / 30;
        const span = (mins(s.end) - mins(s.start)) / 30;
        const state = s.mine ? 'mine' : s.status === 'RESERVED' ? 'taken' : 'free';
        const scls = ['rv-slot', state];
        if (s.past) scls.push('past');
        if (span === 1) scls.push('one');
        const who = isAdmin && s.name ? s.name : s.label;
        const text = s.status === 'RESERVED' ? `<span class="rv-n">${escapeHtml(who)}</span>` : `<span class="rv-n">${s.past ? '' : escapeHtml(t('rv.free'))}</span>`;
        const price = s.status === 'FREE' && !s.past && priceOf(s) ? `<span class="rv-p">${escapeHtml(priceOf(s))}</span>` : '';
        const time = `<span class="rv-t">${s.start}–${s.end}</span>${price}`;
        const title = `${courtName(s.courtId)} · ${longDay(s.day)} · ${s.start}–${s.end}${s.status === 'FREE' && priceOf(s) ? ` · ${priceOf(s)}` : ''}${s.status === 'RESERVED' ? ` · ${who}` : ''}`;
        const clickable = isAdmin || (!s.past && (s.status === 'FREE' || s.mine));
        out.push(`<button type="button" class="${scls.join(' ')}" data-id="${s.id}" title="${escapeHtml(title)}" style="grid-row:${2 + j};grid-column:${c1} / span ${span};${colorVars(s.courtId)}"${clickable ? '' : ' tabindex="-1"'}>${text}${time}</button>`);
      });
      out.push('</div>');
      return `<div class="rv-day">${out.join('')}</div>`;
    });
    const empty = slots.length ? '' : `<div class="rv-empty">${escapeHtml(t('rv.noSlots'))}</div>`;
    return `<div class="rv-scroll" id="rv-scroll"><div class="rv-days">${days.join('')}</div></div>${empty}`;
  }

  function chipsHtml() {
    if (data.courts.length < 2) return '';
    const chip = (key, label) => `<button type="button" class="tab${String(court) === String(key) ? ' active' : ''}" data-court="${key}" style="${key === 'ALL' ? '' : colorVars(key)}">${key === 'ALL' ? '' : '<i class="rv-dot"></i>'}${escapeHtml(label)}</button>`;
    return `<div class="tabs rv-courts" role="tablist">${chip('ALL', t('rv.allCourts'))}${data.courts.map((c) => chip(c.id, c.name)).join('')}</div>`;
  }

  function barHtml() {
    const range = `${shortDay(data.from)} – ${shortDay(data.to)}`;
    return `
      <div class="rv-bar">
        <div class="rv-nav">
          <button type="button" class="rv-arrow" data-shift="-1" aria-label="${escapeHtml(t('rv.prev'))}" title="${escapeHtml(t('rv.prev'))}"${data.canShiftBack ? '' : ' disabled'}>‹</button>
          <span class="rv-range">${escapeHtml(range)}</span>
          <button type="button" class="rv-arrow" data-shift="1" aria-label="${escapeHtml(t('rv.next'))}" title="${escapeHtml(t('rv.next'))}">›</button>
          <button type="button" class="btn btn-sm btn-outline" data-today>${escapeHtml(t('rv.today'))}</button>
        </div>
        <div class="rv-legend">
          <span><i class="taken"></i>${escapeHtml(t('rv.taken'))}</span>
          <span><i class="mine"></i>${escapeHtml(t('rv.mine'))}</span>
          <span><i class="past"></i>${escapeHtml(t('rv.past'))}</span>
        </div>
      </div>`;
  }

  function mineHtml() {
    if (!data.me) return `<p class="rv-hint">${escapeHtml(t('rv.loginHint'))} <button type="button" class="rv-link" data-login>${escapeHtml(t('login.submit'))}</button></p>`;
    if (!data.me.canReserve && !data.admin) return `<p class="rv-hint">${escapeHtml(t('rv.notBltaHint'))}</p>`;
    const list = (mine && mine.reservations) || [];
    const limit = data.settings.maxActive > 0 ? `<span>${escapeHtml(t('rv.limitInfo', { n: data.settings.maxActive }))}</span>` : '';
    const rows = list.length ? list.map((r) => `
      <div class="rv-my">
        <div><b>${escapeHtml(r.court)}</b> · ${escapeHtml(longDay(r.day))} · ${r.start}–${r.end}</div>
        ${r.canCancel ? `<button type="button" class="btn btn-sm btn-outline" data-cancel="${r.id}">${escapeHtml(t('rv.cancelBtn'))}</button>`
          : `<span class="rv-locked">${escapeHtml(r.started ? t('rv.started') : t('rv.cancelLocked', { h: data.settings.cancelHours }))}</span>`}
      </div>`).join('') : `<div class="rv-hint">${escapeHtml(t('rv.myNone'))}</div>`;
    return `<section class="rv-mine"><div class="sv-sec-h"><h2>${escapeHtml(t('rv.myTitle'))}</h2>${limit}</div>${rows}</section>`;
  }

  function render() {
    const keepLeft = (document.getElementById('rv-scroll') || {}).scrollLeft || 0;
    const keepTop = (document.getElementById('rv-scroll') || {}).scrollTop || 0;
    root.innerHTML = `${chipsHtml()}${barHtml()}${gridHtml()}${isAdmin ? `<p class="rv-hint"><b>Admin:</b> click an empty time to add a spot (one day or repeating), drag a spot to move it, click a spot to change or delete it. ${escapeHtml(t('rv.adminHint'))} <a href="/reservations-admin" class="rv-link">${escapeHtml(t('rv.adminLink'))}</a></p>` : ''}${mineHtml()}`;
    root.classList.toggle('rv-admin', isAdmin);
    const scroller = document.getElementById('rv-scroll');
    if (scroller) { scroller.scrollLeft = keepLeft; scroller.scrollTop = keepTop; }
  }

  // ---------------------------------------------------------------- windows

  function openModal(html) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal rv-modal" role="dialog" aria-modal="true"><button type="button" class="close" data-close aria-label="${escapeHtml(t('rv.back'))}">&times;</button>${html}</div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
    wrap.close = close;
    return wrap;
  }

  const factsHtml = (s) => `
    <div class="rv-facts">
      <div><span>${escapeHtml(t('rv.court'))}</span><b>${escapeHtml(courtName(s.courtId))}</b></div>
      <div><span>${escapeHtml(t('rv.date'))}</span><b>${escapeHtml(longDay(s.day))}</b></div>
      <div><span>${escapeHtml(t('rv.time'))}</span><b>${s.start}–${s.end}</b></div>
      ${priceOf(s) ? `<div><span>${escapeHtml(t('rv.price'))}</span><b>${escapeHtml(priceOf(s))}</b></div>` : ''}
    </div>`;

  const errorText = (err) => {
    const code = err && err.data && err.data.code;
    const known = { LIMIT: 'rv.err.limit', OVERLAP: 'rv.err.overlap', TAKEN: 'rv.err.taken', PAST: 'rv.err.past', TOO_LATE: 'rv.err.tooLate', LOGIN: 'rv.err.login', NOT_BLTA: 'rv.err.notBlta' }[code];
    if (known === 'rv.err.limit') return t(known, { n: err.data.maxActive });
    if (known === 'rv.err.tooLate') return t(known, { h: err.data.cancelHours });
    return known ? t(known) : (err && err.message) || t('rv.err.generic');
  };

  function confirmReserve(slot) {
    const wrap = openModal(`
      <h3>${escapeHtml(t('rv.reserveTitle'))}</h3>
      ${factsHtml(slot)}
      <p class="rv-note">${escapeHtml(t('rv.cancelInfo', { h: data.settings.cancelHours }))}${data.settings.maxActive > 0 ? ` ${escapeHtml(t('rv.limitInfo', { n: data.settings.maxActive }))}.` : ''}</p>
      <div class="rv-error" id="rv-error"></div>
      <button type="button" class="btn btn-primary btn-block" id="rv-go">${escapeHtml(t('rv.reserve'))}</button>
      <button type="button" class="btn btn-outline btn-block" data-close style="margin-top:10px">${escapeHtml(t('rv.back'))}</button>`);
    wrap.querySelector('#rv-go').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await api(`/reservations/slots/${slot.id}/reserve`, { method: 'POST' });
        wrap.close();
        toast(t('rv.reserved'));
        await reload();
      } catch (err) {
        wrap.querySelector('#rv-error').textContent = errorText(err);
        e.target.disabled = false;
        if (err.data && ['TAKEN', 'PAST'].includes(err.data.code)) reload();
      }
    });
  }

  function cancelModal(slot) {
    const wrap = openModal(`
      <h3>${escapeHtml(t('rv.mineTitle'))}</h3>
      ${factsHtml(slot)}
      ${slot.canCancel ? '' : `<p class="rv-note">${escapeHtml(t('rv.cancelLocked', { h: data.settings.cancelHours }))}</p>`}
      <div class="rv-error" id="rv-error"></div>
      ${slot.canCancel ? `<button type="button" class="btn btn-primary btn-block" id="rv-go">${escapeHtml(t('rv.cancelBtn'))}</button>` : ''}
      <button type="button" class="btn btn-outline btn-block" data-close style="margin-top:10px">${escapeHtml(t('rv.keep'))}</button>`);
    const go = wrap.querySelector('#rv-go');
    if (go) go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        await api(`/reservations/slots/${slot.id}/cancel`, { method: 'POST' });
        wrap.close();
        toast(t('rv.cancelled'));
        await reload();
      } catch (err) {
        wrap.querySelector('#rv-error').textContent = errorText(err);
        go.disabled = false;
      }
    });
  }

  // 30-minute choices for the admin's edit form: option i is i * 30 minutes after midnight
  const timeOptions = (from, to, selected) => {
    let out = '';
    for (let i = from; i <= to; i += 1) { const v = hhmm(i * 30); out += `<option value="${v}"${v === selected ? ' selected' : ''}>${v}</option>`; }
    return out;
  };

  // the admin's window (English like the rest of the backend): put a player in, take a reservation away, delete the spot
  async function adminModal(slot) {
    const taken = slot.status === 'RESERVED';
    await loadPlayers();
    const wrap = openModal(`
      <h3>${taken ? 'Reserved spot' : 'Free spot'}</h3>
      ${factsHtml(slot)}
      ${taken ? `<p class="rv-note"><b>${escapeHtml(slot.name || slot.label)}</b>${slot.guest ? ' (a guest, not a player)' : ''}</p>` : `
        <label class="rv-label" for="rv-a-name">Put a player in this spot</label>
        <div class="autocomplete"><input type="text" id="rv-a-name" autocomplete="off" maxlength="60" placeholder="Start typing a name…"><div class="autocomplete-list" id="rv-a-list"></div></div>
        <small class="rv-note">A name that is not a player is saved as a guest.</small>
        <button type="button" class="btn btn-primary btn-block" id="rv-assign" style="margin-top:10px">Reserve it for them</button>`}
      <div class="rv-error" id="rv-error"></div>
      ${taken ? '<button type="button" class="btn btn-primary btn-block" id="rv-uncancel">Cancel the reservation</button>' : ''}
      <details class="rv-edit" style="margin-top:10px">
        <summary>Edit this spot (time, day, court)</summary>
        <div class="rv-edit-grid">
          <label class="rv-label">Court<select id="rv-e-court">${data.courts.map((c) => `<option value="${c.id}"${c.id === slot.courtId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></label>
          <label class="rv-label">Date<input type="date" id="rv-e-day" min="${data.today}" value="${slot.day}"></label>
          <label class="rv-label">From<select id="rv-e-start">${timeOptions(0, 47, slot.start)}</select></label>
          <label class="rv-label">To<select id="rv-e-end">${timeOptions(1, 48, slot.end)}</select></label>
        </div>
        <button type="button" class="btn btn-primary btn-block" id="rv-save-edit" style="margin-top:8px">Save changes</button>
      </details>
      <button type="button" class="btn btn-outline btn-block" id="rv-delete" style="margin-top:10px">Delete this spot</button>
      <button type="button" class="btn btn-outline btn-block" data-close style="margin-top:10px">Close</button>`);
    const fail = (err) => { wrap.querySelector('#rv-error').textContent = err.message; };
    const done = async (message) => { wrap.close(); toast(message); await reload(); };
    if (!taken) {
      setupAutocomplete('rv-a-name', 'rv-a-list');
      wrap.querySelector('#rv-assign').addEventListener('click', async () => {
        const typed = wrap.querySelector('#rv-a-name').value.trim();
        if (!typed) { fail(new Error('Choose a player or type a name')); return; }
        const player = findPlayerByTypedName(typed);
        try {
          await api(`/reservations/slots/${slot.id}/assign`, { method: 'POST', body: player ? { playerId: player.id } : { guestName: typed } });
          await done(player ? `Reserved for ${player.name}` : `Reserved for ${typed}`);
        } catch (err) { fail(err); }
      });
    } else {
      wrap.querySelector('#rv-uncancel').addEventListener('click', async () => {
        try { await api(`/reservations/slots/${slot.id}/cancel`, { method: 'POST' }); await done('Reservation cancelled'); } catch (err) { fail(err); }
      });
    }
    wrap.querySelector('#rv-save-edit').addEventListener('click', async () => {
      const body = { courtId: Number(wrap.querySelector('#rv-e-court').value), day: wrap.querySelector('#rv-e-day').value, start: wrap.querySelector('#rv-e-start').value, end: wrap.querySelector('#rv-e-end').value };
      if (body.courtId === slot.courtId && body.day === slot.day && body.start === slot.start && body.end === slot.end) { fail(new Error('Nothing is changed')); return; }
      try {
        const scope = await askScope('Change', slot);
        if (!scope) return;
        const r = await moveSpot(slot, body, scope);
        if (r) await done(outcomeText('Changed', r));
      } catch (err) { fail(err); }
    });
    wrap.querySelector('#rv-delete').addEventListener('click', async () => {
      if (taken && !window.confirm(`${slot.name || slot.label} has reserved this spot. Delete it anyway?`)) return;
      try {
        const scope = await askScope('Delete', slot);
        if (!scope) return;
        const query = [taken ? 'force=1' : '', scope !== 'one' ? `scope=${scope}` : ''].filter(Boolean).join('&');
        const r = await api(`/reservations/slots/${slot.id}${query ? `?${query}` : ''}`, { method: 'DELETE' });
        await done(outcomeText('Deleted', r));
      } catch (err) { fail(err); }
    });
  }

  function onSlot(id) {
    const slot = data.slots.find((s) => s.id === id);
    if (!slot) return;
    if (isAdmin) { adminModal(slot); return; }
    if (slot.past) return;
    if (slot.status === 'FREE') {
      // the server says who is logged in (the page's own login state can still be loading)
      if (data.me) {
        if (!data.me.canReserve) { toast(t('rv.err.notBlta')); return; }
        confirmReserve(slot);
        return;
      }
      requirePlayerAuth(async () => {
        await reload(); // the login changed who "me" is
        const fresh = data.slots.find((s) => s.id === id);
        if (data.me && !data.me.canReserve) toast(t('rv.err.notBlta'));
        else if (fresh && fresh.status === 'FREE' && !fresh.past) confirmReserve(fresh);
        else if (fresh && fresh.mine) toast(t('rv.alreadyYours'));
        else toast(t('rv.err.taken'));
      });
    } else if (slot.mine) {
      cancelModal(slot);
    }
  }

  // ---------------------------------------------------------------- the admin edits the calendar itself
  // Click an empty time: add a spot (one day or a weekly pattern). Drag a spot: move it to another time, court or day. A spot that belongs to
  // a recurring series asks whether the change is for this spot only, this one and the following, or the whole series.

  const WEEKDAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
  const isoWeekday = (iso) => { const w = dayDate(iso).getDay(); return w === 0 ? 7 : w; };
  const addDaysTo = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  // "Moved 4 spots (1 stayed where it was: reserved)"
  function outcomeText(verb, r) {
    const n = r.moved !== undefined ? r.moved : r.deleted;
    const kept = [];
    if (r.skippedReserved) kept.push(`${r.skippedReserved} reserved`);
    if (r.skippedConflict) kept.push(`${r.skippedConflict} would overlap another spot`);
    if (r.skippedInvalid) kept.push(`${r.skippedInvalid} could not go there`);
    return `${verb} ${n} spot${n === 1 ? '' : 's'}${kept.length ? ` (not changed: ${kept.join(', ')})` : ''}`;
  }

  // For a spot of a series: what should the change be made to? -> 'one' | 'following' | 'all' | null (cancelled). Any other spot: 'one'.
  function askScope(verb, slot) {
    if (!slot.series || slot.seriesAhead < 2) return Promise.resolve('one');
    return new Promise((resolve) => {
      const wrap = openModal(`
        <h3>${escapeHtml(verb)} a recurring spot</h3>
        <p class="rv-note">This spot is part of a series (${slot.seriesAhead} spots from today on).</p>
        <div class="rv-scope">
          <label><input type="radio" name="rv-scope" value="one" checked> <span><b>Only this spot</b></span></label>
          <label><input type="radio" name="rv-scope" value="following"> <span><b>This and all following</b></span></label>
          <label><input type="radio" name="rv-scope" value="all"> <span><b>The whole series</b> — all ${slot.seriesAhead} spots that are still ahead</span></label>
        </div>
        <button type="button" class="btn btn-primary btn-block" id="rv-scope-go" style="margin-top:12px">${escapeHtml(verb)}</button>
        <button type="button" class="btn btn-outline btn-block" data-close style="margin-top:10px">Cancel</button>`);
      let answered = false;
      const answer = (v) => { if (answered) return; answered = true; resolve(v); };
      wrap.querySelector('#rv-scope-go').addEventListener('click', () => { answer(wrap.querySelector('input[name="rv-scope"]:checked').value); wrap.close(); });
      wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) answer(null); });
    });
  }

  // moves a spot (the drag, or the Save of the edit form) and tells what happened
  async function moveSpot(slot, to, scope) {
    const body = { courtId: to.courtId, day: to.day, start: to.start, end: to.end, scope };
    const send = (extra) => api(`/reservations/slots/${slot.id}`, { method: 'PATCH', body: { ...body, ...extra } });
    try {
      return await send({});
    } catch (err) {
      if (err.data && err.data.code === 'RESERVED') {
        if (!window.confirm(`${err.message}. Move it anyway? They keep the reservation at the new time.`)) return null;
        return send({ force: true });
      }
      throw err;
    }
  }

  function addSpotModal({ day, courtId, start }) {
    const defaultEnd = Math.min(start + 60, 24 * 60);
    const maxDay = addDaysTo(data.today, 365);
    const until0 = addDaysTo(day, 56) > maxDay ? maxDay : addDaysTo(day, 56);
    const wrap = openModal(`
      <h3>Add free spots</h3>
      <div class="rv-edit-grid">
        <label class="rv-label">Date<input type="date" id="rv-n-day" min="${data.today}" max="${maxDay}" value="${day}"></label>
        <label class="rv-label">From<select id="rv-n-start">${timeOptions(0, 47, hhmm(start))}</select></label>
        <label class="rv-label">To<select id="rv-n-end">${timeOptions(1, 48, hhmm(defaultEnd))}</select></label>
        <label class="rv-label">Spots<select id="rv-n-block">
          <option value="0">One spot for the whole time</option>
          <option value="30">Spots of 30 minutes</option><option value="60">Spots of 1 hour</option><option value="90">Spots of 1.5 hours</option><option value="120">Spots of 2 hours</option>
        </select></label>
      </div>
      <div class="rv-label" style="margin-top:10px">Court${data.courts.length > 1 ? 's' : ''}</div>
      <div class="rv-checks">${data.courts.map((c) => `<label><input type="checkbox" name="rv-n-court" value="${c.id}"${c.id === courtId ? ' checked' : ''}> ${escapeHtml(c.name)}</label>`).join('')}</div>
      <div class="rv-label" style="margin-top:10px">How often</div>
      <div class="rv-scope">
        <label><input type="radio" name="rv-n-rep" value="once" checked> <span><b>Just this day</b></span></label>
        <label><input type="radio" name="rv-n-rep" value="weekly"> <span><b>Repeat every week</b> on the chosen days</span></label>
      </div>
      <div id="rv-n-repeat" style="display:none">
        <div class="rv-checks rv-days">${WEEKDAYS.map(([n, name]) => `<label><input type="checkbox" name="rv-n-wd" value="${n}"${n === isoWeekday(day) ? ' checked' : ''}> ${name}</label>`).join('')}</div>
        <label class="rv-label">Until (the last day)<input type="date" id="rv-n-until" min="${day}" max="${maxDay}" value="${until0}"></label>
      </div>
      <p class="rv-note" id="rv-n-sum"></p>
      <div class="rv-error" id="rv-error"></div>
      <button type="button" class="btn btn-primary btn-block" id="rv-n-go">Add</button>
      <button type="button" class="btn btn-outline btn-block" data-close style="margin-top:10px">Cancel</button>`);
    const q = (sel) => wrap.querySelector(sel);
    const courtIds = () => [...wrap.querySelectorAll('input[name="rv-n-court"]:checked')].map((x) => Number(x.value));
    const weekly = () => q('input[name="rv-n-rep"]:checked').value === 'weekly';
    const plan = () => {
      const from = q('#rv-n-day').value;
      const days = [];
      if (!weekly()) { if (from) days.push(from); } else {
        const until = q('#rv-n-until').value;
        const wd = [...wrap.querySelectorAll('input[name="rv-n-wd"]:checked')].map((x) => Number(x.value));
        for (let d = from; d && until && d <= until; d = addDaysTo(d, 1)) if (wd.includes(isoWeekday(d))) days.push(d);
      }
      const s = mins(q('#rv-n-start').value);
      const e = mins(q('#rv-n-end').value);
      const block = Number(q('#rv-n-block').value);
      const pieces = block ? (e > s && (e - s) % block === 0 ? (e - s) / block : 0) : (e > s ? 1 : 0);
      return { days, pieces, total: days.length * pieces * courtIds().length };
    };
    const refresh = () => {
      q('#rv-n-repeat').style.display = weekly() ? '' : 'none';
      const p = plan();
      const sum = q('#rv-n-sum');
      if (!courtIds().length) sum.textContent = 'Choose at least one court.';
      else if (!p.pieces) sum.textContent = 'The time does not divide into spots of that length.';
      else if (!p.days.length) sum.textContent = 'No day matches — choose a weekday and the last day.';
      else sum.textContent = `This adds ${p.total} spot${p.total === 1 ? '' : 's'}${p.days.length > 1 ? ` on ${p.days.length} days` : ''}.`;
    };
    wrap.addEventListener('input', refresh);
    wrap.addEventListener('change', refresh);
    q('#rv-n-day').addEventListener('change', () => {
      const d = q('#rv-n-day').value;
      q('#rv-n-until').min = d;
      if (q('#rv-n-until').value < d) q('#rv-n-until').value = d;
      wrap.querySelectorAll('input[name="rv-n-wd"]').forEach((x) => { x.checked = Number(x.value) === isoWeekday(d) && !weekly() ? true : x.checked; });
    });
    refresh();
    q('#rv-n-go').addEventListener('click', async (e) => {
      const p = plan();
      if (!courtIds().length || !p.total) { q('#rv-error').textContent = q('#rv-n-sum').textContent; return; }
      const body = { courtIds: courtIds(), start: q('#rv-n-start').value, end: q('#rv-n-end').value, blockMinutes: Number(q('#rv-n-block').value) };
      if (weekly()) Object.assign(body, { fromDate: q('#rv-n-day').value, toDate: q('#rv-n-until').value, weekdays: [...wrap.querySelectorAll('input[name="rv-n-wd"]:checked')].map((x) => Number(x.value)) });
      else body.date = q('#rv-n-day').value;
      e.target.disabled = true;
      try {
        const r = await api('/reservations/slots', { method: 'POST', body });
        wrap.close();
        toast(`Added ${r.created} spot${r.created === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} skipped: overlap or already over)` : ''}`);
        await reload();
      } catch (err) {
        q('#rv-error').textContent = err.message;
        e.target.disabled = false;
      }
    });
  }

  // ---- drag and drop
  let drag = null;
  let suppressClick = false;
  const ROW_SEL = '.rv-row[data-day]';

  // where a pointer at (x, y) would put the spot being dragged: the row (day and court) under it, the start from the left edge of the spot
  function dropTarget(x, y) {
    const row = document.elementsFromPoint(x, y).find((el) => el.matches && el.matches(ROW_SEL));
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    const cols = Number(row.dataset.cols);
    const colW = rect.width / cols;
    const len = (mins(drag.slot.end) - mins(drag.slot.start)) / 30;
    if (len > cols) return null;
    const col = Math.max(0, Math.min(cols - len, Math.round((x - drag.grabX - rect.left) / colW)));
    const start = Number(row.dataset.start) + col * 30;
    return { row, rect, col, colW, len, to: { courtId: Number(row.dataset.court), day: row.dataset.day, start: hhmm(start), end: hhmm(start + len * 30) } };
  }

  function showDrop(t) {
    let el = document.getElementById('rv-drop');
    if (!t) { if (el) el.style.display = 'none'; return; }
    if (!el) { el = document.createElement('div'); el.id = 'rv-drop'; el.className = 'rv-drop'; document.body.appendChild(el); }
    const same = t.to.courtId === drag.slot.courtId && t.to.day === drag.slot.day && t.to.start === drag.slot.start;
    el.style.display = '';
    el.classList.toggle('same', same);
    el.style.left = `${t.rect.left + t.col * t.colW}px`;
    el.style.top = `${t.rect.top}px`;
    el.style.width = `${t.len * t.colW}px`;
    el.style.height = `${t.rect.height}px`;
    el.textContent = `${t.to.start}–${t.to.end}`;
  }

  function startDrag() {
    drag.active = true;
    const rect = drag.btn.getBoundingClientRect();
    drag.grabX = drag.x0 - rect.left;
    drag.grabY = drag.y0 - rect.top;
    const ghost = drag.btn.cloneNode(true);
    ghost.classList.add('rv-ghost');
    ghost.style.cssText = `${drag.btn.getAttribute('style') || ''};position:fixed;left:0;top:0;width:${rect.width}px;height:${rect.height}px;margin:0;pointer-events:none;z-index:9999;grid-row:auto;grid-column:auto`;
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.btn.classList.add('dragging');
    document.body.classList.add('rv-dragging');
    drag.edge = setInterval(() => autoScroll(), 30);
  }

  // a spot dragged near the edge of the calendar scrolls it
  function autoScroll() {
    const sc = document.getElementById('rv-scroll');
    if (!drag || !drag.active || !sc) return;
    const r = sc.getBoundingClientRect();
    const dy = drag.y < r.top + 50 ? -14 : drag.y > r.bottom - 50 ? 14 : 0;
    const dx = drag.x < r.left + 50 ? -14 : drag.x > r.right - 50 ? 14 : 0;
    if (dx || dy) { sc.scrollBy(dx, dy); if (drag.last) { const t = dropTarget(drag.x, drag.y); drag.last = t; showDrop(t); } }
    const wy = drag.y < 60 ? -14 : drag.y > window.innerHeight - 60 ? 14 : 0;
    if (wy) window.scrollBy(0, wy);
  }

  function endDrag(e, cancelled) {
    if (!drag) return;
    clearInterval(drag.edge);
    const d = drag;
    drag = null;
    if (!d.active) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (d.ghost) d.ghost.remove();
    d.btn.classList.remove('dragging');
    document.body.classList.remove('rv-dragging');
    const drop = document.getElementById('rv-drop');
    if (drop) drop.remove();
    const t = cancelled ? null : d.last;
    if (!t) return;
    const same = t.to.courtId === d.slot.courtId && t.to.day === d.slot.day && t.to.start === d.slot.start;
    if (same) return;
    (async () => {
      try {
        const scope = await askScope('Move', d.slot);
        if (!scope) return;
        const r = await moveSpot(d.slot, t.to, scope);
        if (r) toast(outcomeText('Moved', r));
      } catch (err) { toast(err.message); }
      await reload();
    })();
  }

  root.addEventListener('pointerdown', (e) => {
    if (!isAdmin || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const btn = e.target.closest('.rv-slot');
    if (!btn) return;
    const slot = data.slots.find((s) => s.id === Number(btn.dataset.id));
    if (!slot || slot.past) return;
    drag = { slot, btn, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, pointerId: e.pointerId, active: false, last: null };
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
      startDrag();
    }
    e.preventDefault();
    drag.ghost.style.transform = `translate(${e.clientX - drag.grabX}px, ${e.clientY - drag.grabY}px)`;
    drag.last = dropTarget(e.clientX, e.clientY);
    showDrop(drag.last);
  });
  document.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.pointerId) endDrag(e, false); });
  document.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.pointerId) endDrag(e, true); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag && drag.active) endDrag(e, true); });

  // ---- a mark under the mouse on the empty time of the calendar: here a click adds a spot
  root.addEventListener('mousemove', (e) => {
    if (!isAdmin || drag) return;
    const row = e.target.closest && e.target.closest(ROW_SEL);
    let mark = root.querySelector('.rv-hover');
    if (!row) { if (mark) mark.style.display = 'none'; return; }
    const rect = row.getBoundingClientRect();
    const cols = Number(row.dataset.cols);
    const col = Math.max(0, Math.min(cols - 1, Math.floor((e.clientX - rect.left) / (rect.width / cols))));
    if (!mark) { mark = document.createElement('div'); mark.className = 'rv-hover'; mark.innerHTML = '+'; }
    if (mark.parentElement !== row) row.appendChild(mark);
    mark.style.display = '';
    mark.style.left = `${(col / cols) * 100}%`;
    mark.style.width = `${100 / cols}%`;
    mark.title = `Add a spot at ${hhmm(Number(row.dataset.start) + col * 30)}`;
  });
  root.addEventListener('mouseleave', () => { const m = root.querySelector('.rv-hover'); if (m) m.style.display = 'none'; });

  // ---------------------------------------------------------------- events

  root.addEventListener('click', async (e) => {
    if (suppressClick) return; // the end of a drag is no click
    const slotBtn = e.target.closest('.rv-slot');
    if (slotBtn) { onSlot(Number(slotBtn.dataset.id)); return; }
    const cell = isAdmin && e.target.closest(ROW_SEL);
    if (cell) {
      const rect = cell.getBoundingClientRect();
      const cols = Number(cell.dataset.cols);
      const col = Math.max(0, Math.min(cols - 1, Math.floor((e.clientX - rect.left) / (rect.width / cols))));
      addSpotModal({ day: cell.dataset.day, courtId: Number(cell.dataset.court), start: Number(cell.dataset.start) + col * 30 });
      return;
    }
    const chip = e.target.closest('[data-court]');
    if (chip) { court = chip.dataset.court; render(); return; }
    const shift = e.target.closest('[data-shift]');
    if (shift && !shift.disabled) {
      const dir = Number(shift.dataset.shift);
      const base = new Date(`${data.from}T12:00:00Z`);
      base.setUTCDate(base.getUTCDate() + dir * data.days.length);
      from = base.toISOString().slice(0, 10);
      await reload();
      return;
    }
    if (e.target.closest('[data-today]')) {
      from = '';
      await reload();
      const scroller = document.getElementById('rv-scroll'); // today is the first row
      if (scroller) scroller.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (e.target.closest('[data-login]')) { openPlayerLoginModal(); return; }
    const cancel = e.target.closest('[data-cancel]');
    if (cancel) {
      cancel.disabled = true;
      try {
        await api(`/reservations/slots/${cancel.dataset.cancel}/cancel`, { method: 'POST' });
        toast(t('rv.cancelled'));
      } catch (err) { toast(errorText(err)); }
      await reload();
    }
  });

  window.addEventListener('blta:auth-changed', () => { if (data) reload(); });
  if (typeof io === 'function') {
    let timer = null;
    io().on('reservations:changed', () => { clearTimeout(timer); timer = setTimeout(reload, 400); });
  }

  (async () => {
    isAdmin = await checkAdmin();
    await reload();
  })();
})();

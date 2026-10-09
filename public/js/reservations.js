// Court reservations (/rezervacie-kurtov, code address /reservations): a grid of the next 7 days — the days across the top, the time down
// the left in 30-minute rows, a column per court (or one court when a court is picked). A green block is a free spot the admin has
// opened (e.g. Thursday 10:00-12:00 is one block); a player takes it with one click and it turns orange with their name in it.
// Data: GET /api/reservations?from=YYYY-MM-DD, POST /api/reservations/slots/:id/reserve | cancel (src/routes/reservations.js).
(function reservationsPage() {
  const root = document.getElementById('rv-root');
  if (!root) return;

  let data = null;
  let from = '';
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
  // the price of a spot: the court's hour rate times the length (no rate = no price); '27 €' or '13,50 €'
  const priceOf = (s) => {
    const rate = (data.courts.find((c) => c.id === s.courtId) || {}).hourRate;
    if (!rate) return '';
    const hours = (mins(s.end) - mins(s.start)) / 60;
    const eur = Math.round(rate * hours * 100) / 100;
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
        out.push(`<div class="rv-row${j === 0 ? ' first' : ''}${day === data.today ? ' today' : ''}" style="grid-column:2 / span ${colsN};grid-row:${2 + j}"></div>`);
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
    root.innerHTML = `${chipsHtml()}${barHtml()}${gridHtml()}${isAdmin ? `<p class="rv-hint">${escapeHtml(t('rv.adminHint'))} <a href="/reservations-admin" class="rv-link">${escapeHtml(t('rv.adminLink'))}</a></p>` : ''}${mineHtml()}`;
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
    const known = { LIMIT: 'rv.err.limit', OVERLAP: 'rv.err.overlap', TAKEN: 'rv.err.taken', PAST: 'rv.err.past', TOO_LATE: 'rv.err.tooLate', LOGIN: 'rv.err.login' }[code];
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
        await api(`/reservations/slots/${slot.id}`, { method: 'PATCH', body });
        await done('Spot changed');
      } catch (err) {
        if (err.data && err.data.code === 'RESERVED') {
          if (!window.confirm(`${err.message}. Change it anyway? They keep the reservation at the new time.`)) return;
          try { await api(`/reservations/slots/${slot.id}`, { method: 'PATCH', body: { ...body, force: true } }); await done('Spot changed'); } catch (err2) { fail(err2); }
        } else { fail(err); }
      }
    });
    wrap.querySelector('#rv-delete').addEventListener('click', async () => {
      if (taken && !window.confirm(`${slot.name || slot.label} has reserved this spot. Delete it anyway?`)) return;
      try { await api(`/reservations/slots/${slot.id}${taken ? '?force=1' : ''}`, { method: 'DELETE' }); await done('Spot deleted'); } catch (err) { fail(err); }
    });
  }

  function onSlot(id) {
    const slot = data.slots.find((s) => s.id === id);
    if (!slot) return;
    if (isAdmin) { adminModal(slot); return; }
    if (slot.past) return;
    if (slot.status === 'FREE') {
      // the server says who is logged in (the page's own login state can still be loading)
      if (data.me) { confirmReserve(slot); return; }
      requirePlayerAuth(async () => {
        await reload(); // the login changed who "me" is
        const fresh = data.slots.find((s) => s.id === id);
        if (fresh && fresh.status === 'FREE' && !fresh.past) confirmReserve(fresh);
        else if (fresh && fresh.mine) toast(t('rv.alreadyYours'));
        else toast(t('rv.err.taken'));
      });
    } else if (slot.mine) {
      cancelModal(slot);
    }
  }

  // ---------------------------------------------------------------- events

  root.addEventListener('click', async (e) => {
    const slotBtn = e.target.closest('.rv-slot');
    if (slotBtn) { onSlot(Number(slotBtn.dataset.id)); return; }
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

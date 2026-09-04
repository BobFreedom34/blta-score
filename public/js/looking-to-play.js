// "Looking to play" board — a player marks the exact times they're free
// for a friendly match on a two-week When2Meet-style calendar in the same
// spirit as the "Propose times for opponent" flow's own createAvailabilityPicker
// (common.js), other players can pick one of those times to request a
// match, and the post's owner gets notified (email, if they have one on
// file — see POST /:id/join server-side). This page's own calendar is its
// own fork of that widget, not a direct reuse of it — it starts today
// (not tomorrow) and steps by half hours instead of whole ones, both
// deliberately different from how a match proposal's own calendar works,
// so sharing the one function would mean bolting page-specific options
// onto something otherwise fine as it is. See the LTP_*/buildLtpDays/
// renderLtpGrid helpers below. currentPlayerId/playerAuthed/api/t/toast/
// escapeHtml/openPlayerLoginModal/categoryBadge/BLTA_CATEGORIES all come
// from common.js, loaded before this file.

const myPostCard = document.getElementById('my-post-card');
const loginRequiredCard = document.getElementById('login-required-card');
const listEl = document.getElementById('availability-list');

let posts = [];
let myPostPicker = null;

// ---------- Shared calendar plumbing ----------
const LTP_START_HOUR = 7;
const LTP_END_HOUR = 22; // exclusive — last slot starts at 21:30
const LTP_STEP_MIN = 30;
const LTP_DAYS_AHEAD = 14;
// Badge text for this feature never carries the "BLTA " prefix
// categoryBadge/categoryLabel (common.js) always add — this is a
// player's general skill level, not a specific BLTA-run division, even
// though it reuses that same badge-ELITE/NEXT_GEN/NOVICE color coding.
const LEVEL_LABELS = { ELITE: 'ELITE', NEXT_GEN: 'NEXT GEN', NOVICE: 'NOVICE' };
function levelBadge(category) {
  return `<span class="badge badge-${category}">${LEVEL_LABELS[category] || category}</span>`;
}

// Today plus the next LTP_DAYS_AHEAD - 1 days — unlike createAvailabilityPicker's
// own buildDays (which starts tomorrow, since proposing a match "starting
// earlier today" makes little sense), this board is about ongoing general
// availability, so today's remaining hours are worth showing too.
function buildLtpDays() {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < LTP_DAYS_AHEAD; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

// Every half-hour mark between LTP_START_HOUR and LTP_END_HOUR, as
// {hour, minute} pairs — shared by both grids this page draws (marking
// your own times, and picking one of someone else's).
function ltpTimeSteps() {
  const steps = [];
  for (let mins = LTP_START_HOUR * 60; mins < LTP_END_HOUR * 60; mins += LTP_STEP_MIN) {
    steps.push({ hour: Math.floor(mins / 60), minute: mins % 60 });
  }
  return steps;
}

function ltpSlotIso(day, step) {
  const d = new Date(day);
  d.setHours(step.hour, step.minute, 0, 0);
  return d.toISOString();
}

// Draws the day-head row plus one row per half-hour step into `wrapId` —
// the skeleton both this page's grids share, differing only in what
// `cellHtml(day, step, onHour)` returns for each cell. Rows land on the
// hour get a slightly heavier top border and the only time labels (see
// .hour-start in style.css) — labeling every half-hour row at this
// compact a height would be unreadable clutter, and the hour is really
// all a glance needs.
function renderLtpGrid(wrapId, days, cellHtml) {
  const dayHead = (d) => `${d.toLocaleDateString(undefined, { weekday: 'short' })}<br>${d.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' })}`;
  let html = '<div class="availability-grid avail-grid-compact"><div class="avail-corner"></div>';
  for (const d of days) html += `<div class="avail-day-head">${dayHead(d)}</div>`;
  ltpTimeSteps().forEach((step) => {
    const onHour = step.minute === 0;
    html += `<div class="avail-time-label${onHour ? ' hour-start' : ''}">${onHour ? `${String(step.hour).padStart(2, '0')}:00` : ''}</div>`;
    for (const d of days) html += cellHtml(d, step, onHour);
  });
  html += '</div>';
  document.getElementById(wrapId).innerHTML = html;
}

// This page's own fork of createAvailabilityPicker (common.js) — same
// public shape (selectedSlots/clear/setSlots) so renderMyPostArea barely
// differs from using the shared one, but built on buildLtpDays/
// renderLtpGrid above instead. `blockedByIso` (Map<iso, {opponentName}>,
// optional) marks cells that are actually a real, already-accepted match
// — those render as inert/blocked rather than selectable, regardless of
// whether that same time is also in selectedSlots (accepting doesn't
// remove it from the underlying marked-free set, it just takes priority
// over it visually and functionally).
function createLtpAvailabilityPicker({
  weekTabsId, gridWrapId, slotCountId, blockedByIso = new Map(),
}) {
  let days = [];
  const selectedSlots = new Set();
  let activeWeek = 0;

  function updateSlotCount() {
    const el = document.getElementById(slotCountId);
    if (el) el.textContent = selectedSlots.size ? t('match.slotsSelected', { count: selectedSlots.size }) : '';
  }

  function renderWeekTabs() {
    const fmt = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const weeks = [days.slice(0, 7), days.slice(7, 14)];
    document.getElementById(weekTabsId).innerHTML = weeks.map((wdays, i) => `
      <button type="button" class="tab${i === activeWeek ? ' active' : ''}" data-week="${i}">${t('match.weekLabel', { n: i + 1 })}<span>${fmt(wdays[0])} – ${fmt(wdays[wdays.length - 1])}</span></button>
    `).join('');
    document.querySelectorAll(`#${weekTabsId} .tab`).forEach((btn) => {
      btn.addEventListener('click', () => {
        activeWeek = Number(btn.dataset.week);
        renderWeekTabs();
        renderGrid();
      });
    });
  }

  function renderGrid() {
    const weekDays = [days.slice(0, 7), days.slice(7, 14)][activeWeek];
    renderLtpGrid(gridWrapId, weekDays, (d, step, onHour) => {
      const iso = ltpSlotIso(d, step);
      const blocked = blockedByIso.get(iso);
      if (blocked) {
        return `<div class="avail-cell blocked${onHour ? ' hour-start' : ''}" data-iso="${iso}" title="${escapeHtml(blocked.opponentName || '')}"></div>`;
      }
      return `<div class="avail-cell${selectedSlots.has(iso) ? ' selected' : ''}${onHour ? ' hour-start' : ''}" data-iso="${iso}"></div>`;
    });
  }

  // Bound once to the wrap element itself (not its cells, which get torn
  // down and rebuilt on every renderGrid) via delegation — same pattern
  // as createAvailabilityPicker's own setupDragSelect.
  function setupDragSelect() {
    const wrap = document.getElementById(gridWrapId);
    let dragging = false;
    let paintValue = true;
    let lastCell = null;

    function paint(cell) {
      if (!cell || cell === lastCell || cell.classList.contains('blocked')) return;
      lastCell = cell;
      if (paintValue) { selectedSlots.add(cell.dataset.iso); cell.classList.add('selected'); }
      else { selectedSlots.delete(cell.dataset.iso); cell.classList.remove('selected'); }
      updateSlotCount();
    }

    wrap.addEventListener('mousedown', (e) => {
      const cell = e.target.closest('.avail-cell');
      if (!cell || cell.classList.contains('blocked')) return;
      e.preventDefault();
      dragging = true;
      lastCell = null;
      paintValue = !cell.classList.contains('selected');
      paint(cell);
    });
    wrap.addEventListener('mouseover', (e) => {
      if (!dragging) return;
      paint(e.target.closest('.avail-cell'));
    });
    document.addEventListener('mouseup', () => { dragging = false; lastCell = null; });

    wrap.addEventListener('touchstart', (e) => {
      const cell = e.target.closest('.avail-cell');
      if (!cell || cell.classList.contains('blocked')) return;
      dragging = true;
      lastCell = null;
      paintValue = !cell.classList.contains('selected');
      paint(cell);
    }, { passive: true });
    wrap.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      const touch = e.touches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const cell = el && el.classList.contains('avail-cell') ? el : null;
      if (cell) { e.preventDefault(); paint(cell); }
    }, { passive: false });
    document.addEventListener('touchend', () => { dragging = false; lastCell = null; });
  }

  days = buildLtpDays();
  renderWeekTabs();
  renderGrid();
  setupDragSelect();
  updateSlotCount();

  return {
    selectedSlots,
    clear() { selectedSlots.clear(); renderGrid(); updateSlotCount(); },
    setSlots(isoArray) {
      isoArray.forEach((iso) => selectedSlots.add(iso));
      renderGrid();
      updateSlotCount();
    },
  };
}

// ---------- My post card (create / edit / manage) ----------

function myPostFormHtml(existing) {
  return `
    <h2 style="margin-top:0">${t('lookingToPlay.myPostHeading')}</h2>
    <form id="my-post-form">
      <div class="field">
        <label><span>${t('proposeTimes.markTimes')}</span> <span id="my-post-slot-count" style="font-weight:400;color:var(--gray-dim)"></span></label>
        <div class="tabs week-picker-tabs" id="my-post-week-tabs"></div>
        <div class="availability-grid-wrap" id="my-post-grid-wrap"></div>
        <button type="button" class="btn btn-sm btn-outline" id="my-post-clear-slots-btn" style="margin-top:10px">${t('common.clearAll')}</button>
      </div>
      ${existing ? blockedListHtml(existing) : ''}
      <div class="field">
        <label>${t('lookingToPlay.levelLabel')} <span style="font-weight:400;color:var(--gray-dim);font-size:12px">(${t('common.optional')})</span></label>
        <div class="category-picker" id="my-post-categories">
          ${BLTA_CATEGORIES.map((c) => `<button type="button" class="badge badge-${c} category-toggle${existing && existing.categories && existing.categories.includes(c) ? ' active' : ''}" data-category="${c}">${LEVEL_LABELS[c]}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label for="my-post-location">${t('lookingToPlay.locationLabel')}</label>
        <input type="text" id="my-post-location" maxlength="120" placeholder="${escapeHtml(t('lookingToPlay.locationPlaceholder'))}" value="${existing ? escapeHtml(existing.location || '') : ''}">
      </div>
      <div class="field">
        <label for="my-post-note">${t('lookingToPlay.noteLabel')}</label>
        <textarea id="my-post-note" rows="2" maxlength="300" placeholder="${escapeHtml(t('lookingToPlay.notePlaceholder'))}">${existing ? escapeHtml(existing.note || '') : ''}</textarea>
      </div>
      <div id="my-post-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="submit" class="btn btn-primary">${existing ? t('lookingToPlay.updateBtn') : t('lookingToPlay.postBtn')}</button>
        ${existing ? `<button type="button" class="btn btn-outline" id="my-post-close-btn">${t('lookingToPlay.closeBtn')}</button>` : ''}
      </div>
    </form>
    ${existing ? interestedListHtml(existing) : ''}
  `;
}

function interestedListHtml(post) {
  const joins = post.joins || [];
  const rows = joins.length
    ? joins.map((j) => {
      let statusLine = '';
      if (j.status === 'ACCEPTED') {
        statusLine = `<span class="badge" style="background:var(--green);color:var(--white)">${t('lookingToPlay.accepted')}</span>${j.matchToken ? ` <a href="/match/${j.matchToken}" class="edit-link">${t('lookingToPlay.viewMatch')}</a>` : ''}`;
      } else if (j.status === 'DENIED') {
        statusLine = `<span class="badge" style="background:var(--gray-light);color:var(--gray)">${t('lookingToPlay.deniedLabel')}</span> <span class="availability-join-message">“${escapeHtml(j.denyReason)}”</span>`;
      }
      const actions = j.status === 'PENDING' ? `
        <div class="availability-join-actions">
          <button type="button" class="btn btn-sm btn-primary" data-accept-join="${j.player.id}">${t('lookingToPlay.acceptBtn')}</button>
          <button type="button" class="btn btn-sm btn-outline" data-deny-join-toggle="${j.player.id}">${t('lookingToPlay.denyBtn')}</button>
        </div>
        <div class="availability-join-compose" id="deny-compose-${j.player.id}" style="display:none">
          <textarea rows="2" maxlength="300" placeholder="${escapeHtml(t('lookingToPlay.denyReasonPlaceholder'))}"></textarea>
          <button type="button" class="btn btn-sm btn-danger" data-deny-join="${j.player.id}">${t('lookingToPlay.confirmDenyBtn')}</button>
        </div>
      ` : '';
      return `
        <div class="availability-join-row">
          <a class="player-name-link" href="/player/${j.player.slug || j.player.id}">${escapeHtml(j.player.name)}</a>
          <span class="availability-join-contact">${escapeHtml(fmtSlot(j.slot))}</span>
          ${j.player.phone ? `<span class="availability-join-contact">${escapeHtml(j.player.phone)}</span>` : ''}
          ${j.message ? `<span class="availability-join-message">“${escapeHtml(j.message)}”</span>` : ''}
          ${statusLine}
          ${actions}
        </div>
      `;
    }).join('')
    : `<p style="color:var(--gray-dim);margin:6px 0 0">${t('lookingToPlay.noInterestYet')}</p>`;
  return `
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--gray-light)">
      <strong style="font-size:13px;text-transform:uppercase;letter-spacing:0.03em;color:var(--gray)">${t('lookingToPlay.interestedHeading')}${joins.length ? ` (${joins.length})` : ''}</strong>
      ${rows}
    </div>
  `;
}

// Groups blockedSlots (one entry per half-hour cell, see getBlockedSlots
// server-side) back into one row per actual match by matchToken, with
// the real start–end range that match occupies.
function groupBlockedRanges(blockedSlots) {
  const byToken = new Map();
  (blockedSlots || []).forEach((b) => {
    if (!byToken.has(b.matchToken)) byToken.set(b.matchToken, { ...b, isos: [] });
    byToken.get(b.matchToken).isos.push(b.iso);
  });
  return [...byToken.values()].map((g) => {
    const sorted = g.isos.slice().sort();
    const end = new Date(sorted[sorted.length - 1]);
    end.setMinutes(end.getMinutes() + 30);
    return { ...g, start: sorted[0], end: end.toISOString() };
  });
}

function fmtSlotRange(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const datePart = start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const startTime = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const endTime = end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${datePart}, ${startTime}–${endTime}`;
}

// The text list backing up the calendar's own greyed-out blocked cells —
// a 13px cell has no room to show who a block is with, so this is where
// that name actually lives (also reachable via each blocked cell's own
// title tooltip, but that's not something a touch device has at all).
function blockedListHtml(post) {
  const groups = groupBlockedRanges(post.blockedSlots);
  if (groups.length === 0) return '';
  return `
    <div class="field">
      <label>${t('lookingToPlay.blockedListHeading')}</label>
      <div class="availability-blocked-list">
        ${groups.map((g) => `
          <div class="availability-blocked-row">
            <span>🎾 ${escapeHtml(fmtSlotRange(g.start, g.end))} — ${g.opponentSlug ? `<a href="/player/${g.opponentSlug}">${escapeHtml(g.opponentName)}</a>` : escapeHtml(g.opponentName || '')}</span>
            ${g.matchToken ? `<a href="/match/${g.matchToken}" class="edit-link">${t('lookingToPlay.viewMatch')}</a>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderMyPostArea() {
  if (!currentPlayerId) {
    myPostCard.style.display = 'none';
    loginRequiredCard.style.display = '';
    return;
  }
  loginRequiredCard.style.display = 'none';
  myPostCard.style.display = '';

  const mine = posts.find((p) => p.mine) || null;
  myPostCard.innerHTML = myPostFormHtml(mine);
  // A fresh instance every render — this card's own DOM gets torn down and
  // rebuilt on every loadPosts() (unlike the propose-times modal elsewhere,
  // which stays in the DOM and just calls .reset()), so there's no reason
  // to keep the old instance around.
  const blockedByIso = new Map((mine ? mine.blockedSlots : []).map((b) => [b.iso, b]));
  myPostPicker = createLtpAvailabilityPicker({
    weekTabsId: 'my-post-week-tabs', gridWrapId: 'my-post-grid-wrap', slotCountId: 'my-post-slot-count', blockedByIso,
  });
  if (mine) myPostPicker.setSlots(mine.slots);

  document.getElementById('my-post-clear-slots-btn').addEventListener('click', () => myPostPicker.clear());

  // Accept: one confirm click away, since there's nothing further to fill
  // in — the slot, the two players, and the location (if any) are already
  // settled. Deny: reveals its own inline compose (same pattern as the
  // board's own join compose) since a reason is mandatory server-side.
  document.querySelectorAll('[data-accept-join]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = btn.dataset.acceptJoin;
      const join = (mine.joins || []).find((j) => String(j.player.id) === playerId);
      if (!confirm(t('lookingToPlay.acceptConfirm', { name: join ? join.player.name : '' }))) return;
      try {
        await api(`/availability/${mine.id}/joins/${playerId}/accept`, { method: 'POST' });
        toast(t('lookingToPlay.acceptedToast'));
        await loadPosts();
      } catch (err) {
        toast(err.message);
      }
    });
  });
  document.querySelectorAll('[data-deny-join-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const compose = document.getElementById(`deny-compose-${btn.dataset.denyJoinToggle}`);
      if (!compose) return;
      const opening = compose.style.display === 'none';
      compose.style.display = opening ? '' : 'none';
      if (opening) compose.querySelector('textarea').focus();
    });
  });
  document.querySelectorAll('[data-deny-join]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = btn.dataset.denyJoin;
      const compose = document.getElementById(`deny-compose-${playerId}`);
      const reason = compose ? compose.querySelector('textarea').value.trim() : '';
      if (!reason) { toast(t('lookingToPlay.denyReasonRequired')); return; }
      try {
        await api(`/availability/${mine.id}/joins/${playerId}/deny`, { method: 'POST', body: { reason } });
        toast(t('lookingToPlay.deniedToast'));
        await loadPosts();
      } catch (err) {
        toast(err.message);
      }
    });
  });

  // Category is a plain toggle, same idea as the day-toggle pickers
  // elsewhere in this app — clicking just flips its own .active class,
  // read straight off the DOM at submit time (see selectedCategories
  // below), no separate state to keep in sync.
  document.querySelectorAll('#my-post-categories .category-toggle').forEach((btn) => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });

  document.getElementById('my-post-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('my-post-error');
    errorEl.textContent = '';
    if (myPostPicker.selectedSlots.size === 0) { errorEl.textContent = t('lookingToPlay.selectSlotError'); return; }
    const categories = [...document.querySelectorAll('#my-post-categories .category-toggle.active')].map((b) => b.dataset.category);
    const body = {
      slots: Array.from(myPostPicker.selectedSlots),
      categories,
      location: document.getElementById('my-post-location').value,
      note: document.getElementById('my-post-note').value,
    };
    try {
      await api('/availability', { method: 'POST', body });
      toast(mine ? t('lookingToPlay.updated') : t('lookingToPlay.posted'));
      await loadPosts();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  const closeBtn = document.getElementById('my-post-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', async () => {
      if (!confirm(t('lookingToPlay.closeConfirm'))) return;
      try {
        await api(`/availability/${mine.id}`, { method: 'DELETE' });
        toast(t('lookingToPlay.closed'));
        await loadPosts();
      } catch (err) {
        toast(err.message);
      }
    });
  }
}

// ---------- Public board ----------

// "Tue, 8 Sep, 18:00" — a single point in time, unlike formatDateShort
// elsewhere in this app (which is built for a match's one scheduled_at and
// includes a leading weekday-only style); this is its own small formatter
// since nothing existing quite matches "one of several hourly slots on a
// two-week grid".
function fmtSlot(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const datePart = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}

function boardPostHtml(post) {
  const photo = post.player.photoUrl
    ? `<img src="${escapeHtml(post.player.photoUrl)}" alt="" class="availability-post-photo">`
    : '';
  // A slot that's now part of an accepted match is booked, not free —
  // doesn't count toward "how many free times" even though it's still
  // technically in the post's own marked-free set (see the block comment
  // on createLtpAvailabilityPicker above for why that set is left as-is).
  const blockedIsos = new Set((post.blockedSlots || []).map((b) => b.iso));
  const freeSlotCount = post.slots.filter((s) => !blockedIsos.has(s)).length;

  // The calendar icon next to the name is the actual join trigger (opens
  // openPickSlotModal below) — not shown at all once there's nothing left
  // to do here (it's your own post, or you've already picked a time).
  let calendarBtn = '';
  let statusBadge = '';
  if (post.mine) {
    statusBadge = `<span class="badge" style="background:var(--orange);color:var(--white);margin-left:auto">${t('lookingToPlay.ownPostBadge')}</span>`;
  } else if (post.joinedByMe) {
    statusBadge = `<span class="badge" style="background:var(--gray-light);color:var(--gray);margin-left:auto">${t('lookingToPlay.joined')}</span>`;
  } else if (currentPlayerId) {
    calendarBtn = `<button type="button" class="availability-calendar-btn" data-pick="${post.id}" title="${escapeHtml(t('match.pickATime'))}">📅</button>`;
  } else {
    calendarBtn = `<button type="button" class="availability-calendar-btn" data-pick-login="1" title="${escapeHtml(t('match.pickATime'))}">📅</button>`;
  }

  // Same card chrome as a match card (see .match-card.availability-post in
  // style.css): a top row of "badges" (here, just how many free times are
  // on offer) plus location on the right, then the same dark .scoreboard
  // box a finished match card shows its result in — here it's the player,
  // the calendar icon that opens their times, and their join state.
  return `
    <div class="match-card availability-post" data-id="${post.id}">
      <div class="match-card-top">
        <div class="availability-post-days">${post.categories.map(levelBadge).join('')}<span class="availability-day-pill">${escapeHtml(t('lookingToPlay.slotsCount', { count: freeSlotCount }))}</span></div>
        ${post.location ? `<div class="match-card-meta" style="margin-left:auto"><span>📍 ${escapeHtml(post.location)}</span></div>` : ''}
      </div>
      <div class="scoreboard">
        <div class="availability-player-row">
          <a href="/player/${post.player.slug || post.player.id}" class="availability-player-name">${photo}${escapeHtml(post.player.name)}</a>
          ${calendarBtn}
          ${statusBadge}
        </div>
      </div>
      ${post.note ? `<div class="match-card-notes">${escapeHtml(post.note)}</div>` : ''}
      ${post.joinCount > 0 ? `<div class="availability-join-count">${post.joinCount} 👋</div>` : ''}
    </div>
  `;
}

function renderBoard() {
  if (posts.length === 0) {
    listEl.innerHTML = `<div class="empty-state">${t('lookingToPlay.none')}</div>`;
    return;
  }
  listEl.innerHTML = posts.map(boardPostHtml).join('');

  listEl.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => openPickSlotModal(Number(btn.dataset.pick)));
  });
  listEl.querySelectorAll('[data-pick-login]').forEach((btn) => {
    btn.addEventListener('click', () => openPlayerLoginModal(() => loadPosts()));
  });
}

async function loadPosts() {
  try {
    posts = await api('/availability');
    renderMyPostArea();
    renderBoard();
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">${escapeHtml(t('lookingToPlay.couldNotLoad', { error: err.message }))}</div>`;
  }
}

// ---------- "Pick a time" modal ----------
// Same two-week grid as createAvailabilityPicker, but single-pick and
// read-only outside the post owner's own marked times — mirrors
// attachProposalCardHandlers' respondent-side grid in match.js exactly
// (only cells matching one of the offered slots are clickable, everything
// else is inert filler that keeps the calendar shape recognizable), just
// built once here and reset on each open instead of living in match.html's
// static markup, since this page has no per-post modal of its own to reuse.
const pickSlotModal = document.createElement('div');
pickSlotModal.className = 'modal-backdrop';
pickSlotModal.id = 'pick-slot-modal';
pickSlotModal.style.display = 'none';
pickSlotModal.innerHTML = `
  <div class="modal" style="max-width:640px">
    <button type="button" class="close" data-close="pick-slot-modal" aria-label="Close">&times;</button>
    <h3 style="margin-top:0">${t('match.pickATime')}</h3>
    <div class="field">
      <label>${t('match.whenLabel')}</label>
      <div class="tabs week-picker-tabs" id="pick-slot-week-tabs"></div>
      <div class="availability-grid-wrap" id="pick-slot-grid-wrap"></div>
    </div>
    <div class="field">
      <label>${t('lookingToPlay.messageLabel')} <span style="font-weight:400;color:var(--gray-dim);font-size:12px">(${t('common.optional')})</span></label>
      <textarea id="pick-slot-message" rows="2" maxlength="300" placeholder="${escapeHtml(t('lookingToPlay.messagePlaceholder'))}"></textarea>
    </div>
    <button type="button" class="btn btn-primary btn-block" id="pick-slot-confirm-btn" disabled style="margin-top:6px">${t('match.confirmBtn')}</button>
    <div id="pick-slot-error" style="color:var(--danger);font-weight:600;margin-top:8px"></div>
  </div>
`;
document.body.appendChild(pickSlotModal);
// Built after the page's own generic [data-close]/.modal-backdrop
// listeners already ran, so — same as common.js's install-ios-modal — it
// needs its own close wiring rather than relying on theirs.
pickSlotModal.querySelector('[data-close]').addEventListener('click', () => { pickSlotModal.style.display = 'none'; });
pickSlotModal.addEventListener('click', (e) => { if (e.target === pickSlotModal) pickSlotModal.style.display = 'none'; });

let pickSlotPostId = null;
let pickSlotSelected = null;
let pickSlotActiveWeek = 0;
let pickSlotDays = [];

function buildPickSlotDays() {
  pickSlotDays = buildLtpDays();
}

function renderPickSlotWeekTabs() {
  const weeks = [pickSlotDays.slice(0, 7), pickSlotDays.slice(7, 14)];
  const fmt = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  document.getElementById('pick-slot-week-tabs').innerHTML = weeks.map((days, i) => `
    <button type="button" class="tab${i === pickSlotActiveWeek ? ' active' : ''}" data-week="${i}">${t('match.weekLabel', { n: i + 1 })}<span>${fmt(days[0])} – ${fmt(days[days.length - 1])}</span></button>
  `).join('');
  document.querySelectorAll('#pick-slot-week-tabs .tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      pickSlotActiveWeek = Number(btn.dataset.week);
      renderPickSlotWeekTabs();
      renderPickSlotGrid();
    });
  });
}

function renderPickSlotGrid() {
  const post = posts.find((p) => p.id === pickSlotPostId);
  const blockedIsos = new Set(post ? (post.blockedSlots || []).map((b) => b.iso) : []);
  const offered = new Set(post ? post.slots.filter((s) => !blockedIsos.has(s)) : []);
  const weekDays = [pickSlotDays.slice(0, 7), pickSlotDays.slice(7, 14)][pickSlotActiveWeek];
  renderLtpGrid('pick-slot-grid-wrap', weekDays, (d, step, onHour) => {
    const iso = ltpSlotIso(d, step);
    const isOffered = offered.has(iso);
    const isSelected = iso === pickSlotSelected;
    return `<div class="avail-cell${isOffered ? ' proposed' : ''}${isSelected ? ' selected' : ''}${onHour ? ' hour-start' : ''}" data-iso="${iso}" data-offered="${isOffered ? '1' : '0'}"></div>`;
  });

  document.querySelectorAll('#pick-slot-grid-wrap .avail-cell[data-offered="1"]').forEach((cell) => {
    cell.addEventListener('click', () => {
      pickSlotSelected = cell.dataset.iso;
      renderPickSlotGrid();
      document.getElementById('pick-slot-confirm-btn').disabled = false;
    });
  });
}

function openPickSlotModal(postId) {
  pickSlotPostId = postId;
  pickSlotSelected = null;
  pickSlotActiveWeek = 0;
  buildPickSlotDays();
  document.getElementById('pick-slot-message').value = '';
  document.getElementById('pick-slot-error').textContent = '';
  document.getElementById('pick-slot-confirm-btn').disabled = true;
  renderPickSlotWeekTabs();
  renderPickSlotGrid();
  pickSlotModal.style.display = 'flex';
}

document.getElementById('pick-slot-confirm-btn').addEventListener('click', async () => {
  if (!pickSlotSelected) return;
  const errorEl = document.getElementById('pick-slot-error');
  errorEl.textContent = '';
  const btn = document.getElementById('pick-slot-confirm-btn');
  btn.disabled = true;
  const post = posts.find((p) => p.id === pickSlotPostId);
  try {
    await api(`/availability/${pickSlotPostId}/join`, {
      method: 'POST',
      body: { slot: pickSlotSelected, message: document.getElementById('pick-slot-message').value },
    });
    pickSlotModal.style.display = 'none';
    toast(post ? t('lookingToPlay.joinSent', { name: post.player.name }) : t('lookingToPlay.joined'));
    await loadPosts();
  } catch (err) {
    errorEl.textContent = err.message;
    btn.disabled = false;
  }
});

document.getElementById('looking-to-play-login-link').addEventListener('click', (e) => {
  e.preventDefault();
  openPlayerLoginModal(() => loadPosts());
});

// currentPlayerId is only known once refreshPlayerAuth() (common.js)
// resolves, independently of this file's own initial load — and it's also
// what changes right after a login/logout elsewhere on the page (see
// common.js dispatching this same event there). Re-rendering on it keeps
// the My post area and every calendar button in sync either way.
window.addEventListener('blta:auth-changed', () => { renderMyPostArea(); renderBoard(); });

loadPosts();

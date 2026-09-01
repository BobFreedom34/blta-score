const CATEGORY_LABELS = { ELITE: 'BLTA ELITE', NEXT_GEN: 'BLTA NEXT GEN', NOVICE: 'BLTA NOVICE', FRIENDLY: 'FRIENDLY', VIP_CUP: 'VIP CUP', ATA_TENNIS: 'ATA TENNIS' };
// The three official league categories — everything else (FRIENDLY, VIP_CUP) is a non-league match.
const BLTA_CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const STATUS_LABELS = { PLANNED: 'Planned', LIVE: 'Live', FINISHED: 'Finished', UNFINISHED: 'Unfinished' };
const END_REASON_LABELS = { WALKOVER: 'Walkover', RETIREMENT: 'Retirement', UNFINISHED: 'Left unfinished' };
function endReasonLabel(reason) {
  return END_REASON_LABELS[reason] ? t(`common.endReason.${reason}`) : null;
}

// Shared by match.js (per-match date/time edit fields) and any page that
// opens a match-editing modal of its own (see openQuickEditMatchModal
// below) — <input type="date">/<input type="time"> want the local
// wall-clock date/time, not the ISO string's UTC one.
function pad(n) { return String(n).padStart(2, '0'); }
function toDateValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toTimeValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- Shared match-creation form pieces ----------
// Used by new-match.js (pick one fixed date) and by match.js's
// edit-proposal/counter-propose modals (propose several times/venues
// instead, once the match already exists as a Planned card) — the
// availability grid and venue picker widgets live here once instead of
// being duplicated per caller.

const MATCH_FORMATS = [
  { key: 'BO3' },
  { key: 'BO3_STB' },
  { key: 'BO5' },
  { key: 'BO5_STB' },
  { key: 'BO1' },
  { key: 'FREE_PLAY' },
];

function setupFormatOptions(containerId) {
  document.getElementById(containerId).innerHTML = MATCH_FORMATS.map((f, i) => {
    const label = t(`format.${f.key}.label`);
    const sublabelKey = `format.${f.key}.sublabel`;
    const hasSublabel = (TRANSLATIONS[currentLang] && sublabelKey in TRANSLATIONS[currentLang]) || sublabelKey in TRANSLATIONS.en;
    const sublabel = hasSublabel ? t(sublabelKey) : '';
    const hint = t(`format.${f.key}.hint`);
    return `
    <label class="format-option">
      <input type="radio" name="format" value="${f.key}" ${i === 0 ? 'checked' : ''}>
      <span>
        <div style="font-weight:700">${label}${sublabel ? ` <span style="font-weight:400;color:var(--gray);font-size:12px">${sublabel}</span>` : ''}</div>
        <div style="font-size:12px;color:var(--gray)">${hint}</div>
      </span>
    </label>
  `;
  }).join('');
}

// ---------- Edit match modal (shared) ----------
// The same "edit initial settings" modal match.js's own "Upraviť zápas"
// button opens, shared here so a match CARD's pencil icon (app.js/
// player.js) can open the exact same modal in place, without navigating to
// the match's own page. Covers category/date-time/location/who-brings-
// balls/notes/format — see #edit-match-modal in index.html/player.html/
// match.html (identical markup on all three; only one is ever in the DOM
// at once, so the shared ids don't collide). The two players themselves
// are never shown as editable — reassigning them isn't supported, their
// stats/history are tied to this match.

// Prompts login if needed, re-fetches the match fresh (never trusts
// whatever's baked into the card's own dataset — it could be stale, or the
// viewer's eligibility could have changed since this card last rendered),
// re-checks canManageMatch against that fresh data, then opens the modal.
// isAdminUser is passed in rather than read off a shared global since each
// page tracks its own admin status independently (see canManageMatch).
function handleQuickEditMatchClick(token, isAdminUser, onSaved) {
  requirePlayerAuth(() => {
    (async () => {
      let m;
      try {
        m = await api(`/matches/${token}`);
      } catch (err) {
        toast(err.message);
        return;
      }
      if (!canManageMatch(m, isAdminUser) || (m.status === 'FINISHED' && !isAdminUser)) {
        showAccessDeniedModal(t('accessDenied.message'));
        return;
      }
      openEditMatchModal(m, isAdminUser, onSaved);
    })();
  });
}

// onSaved (optional) is called with the updated match once saved — match.js
// passes its own render() so the page updates in place; a card page passes
// its list-reload function instead since there's no single match to re-
// render there. isAdminUser gates the players field below — passed in like
// everywhere else that checks it, rather than a shared global (see
// canManageMatch).
async function openEditMatchModal(m, isAdminUser, onSaved) {
  const modal = document.getElementById('edit-match-modal');
  if (!modal) return;
  const errorEl = document.getElementById('edit-match-error');
  errorEl.textContent = '';

  // Reassigning who's actually in the match is admin-only (see the doc
  // comment on the modal's markup) — everyone else never sees the field,
  // same as the format field hides for a status where it can't apply.
  const playersField = document.getElementById('edit-match-players-field');
  if (playersField) {
    playersField.style.display = isAdminUser ? '' : 'none';
    if (isAdminUser) {
      if (!allPlayers.length) await loadPlayers();
      document.getElementById('edit-match-player1').value = m.player1.name;
      document.getElementById('edit-match-player2').value = m.player2.name;
    }
  }

  document.getElementById('edit-match-category').value = m.category;
  document.getElementById('edit-match-date').value = toDateValue(m.scheduledAt);
  document.getElementById('edit-match-time').value = toTimeValue(m.scheduledAt);
  document.getElementById('edit-match-location').value = m.location || '';
  document.getElementById('edit-match-notes').value = m.notes || '';

  // Format can only actually be changed server-side while LIVE or
  // PLANNED (see PATCH /:token/format) — hidden here rather than shown
  // and then erroring on save for a Finished/Unfinished match.
  const formatField = document.getElementById('edit-match-format-field');
  const canChangeFormat = m.status === 'LIVE' || m.status === 'PLANNED';
  formatField.style.display = canChangeFormat ? '' : 'none';
  if (canChangeFormat) {
    setupFormatOptions('edit-match-format-options');
    document.querySelectorAll('#edit-match-format-options input[name="format"]').forEach((input) => {
      input.checked = input.value === m.format;
    });
  }

  // Balls/court pickers — labeled with the real player names directly
  // (unlike the create form's version, which has to track live-typed names
  // instead since the players don't exist yet at that point).
  const ballsBtns = Array.from(document.querySelectorAll('#edit-match-balls-row button'));
  ballsBtns[0].textContent = m.player1.name;
  ballsBtns[1].textContent = m.player2.name;
  let ballsPlayer = m.ballsPlayer || null;
  const updateBallsButtons = () => {
    ballsBtns.forEach((b) => b.classList.toggle('active', Number(b.dataset.value) === ballsPlayer));
  };
  updateBallsButtons();
  ballsBtns.forEach((btn) => {
    btn.onclick = () => {
      const val = Number(btn.dataset.value);
      ballsPlayer = ballsPlayer === val ? null : val;
      updateBallsButtons();
    };
  });

  const courtBtns = Array.from(document.querySelectorAll('#edit-match-court-row button'));
  courtBtns[0].textContent = m.player1.name;
  courtBtns[1].textContent = m.player2.name;
  let courtPlayer = m.courtPlayer || null;
  const updateCourtButtons = () => {
    courtBtns.forEach((b) => b.classList.toggle('active', Number(b.dataset.value) === courtPlayer));
  };
  updateCourtButtons();
  courtBtns.forEach((btn) => {
    btn.onclick = () => {
      const val = Number(btn.dataset.value);
      courtPlayer = courtPlayer === val ? null : val;
      updateCourtButtons();
    };
  });

  document.getElementById('edit-match-form').onsubmit = async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const category = document.getElementById('edit-match-category').value;
    const dateVal = document.getElementById('edit-match-date').value;
    const timeVal = document.getElementById('edit-match-time').value;
    const location = document.getElementById('edit-match-location').value.trim();
    const notes = document.getElementById('edit-match-notes').value.trim();
    const scheduledAt = dateVal ? new Date(`${dateVal}T${timeVal || '00:00'}`).toISOString() : null;
    const selectedFormatInput = canChangeFormat
      ? document.querySelector('#edit-match-format-options input[name="format"]:checked')
      : null;
    const selectedFormat = selectedFormatInput ? selectedFormatInput.value : m.format;

    // Only ever sent when the players field is actually showing (admin) —
    // matched against allPlayers by exact name, same as picking a
    // suggestion from the autocomplete list is meant to leave behind,
    // rather than trusting arbitrary typed text as a player id lookup.
    let player1Id;
    let player2Id;
    if (isAdminUser && playersField) {
      const name1 = document.getElementById('edit-match-player1').value.trim();
      const name2 = document.getElementById('edit-match-player2').value.trim();
      const p1 = allPlayers.find((p) => p.name.toLowerCase() === name1.toLowerCase());
      const p2 = allPlayers.find((p) => p.name.toLowerCase() === name2.toLowerCase());
      if (!p1 || !p2) {
        errorEl.textContent = t('match.editPickFromSuggestions');
        submitBtn.disabled = false;
        return;
      }
      if (p1.id === p2.id) {
        errorEl.textContent = t('match.editPlayersMustDiffer');
        submitBtn.disabled = false;
        return;
      }
      player1Id = p1.id;
      player2Id = p2.id;
    }

    try {
      let updated = await api(`/matches/${m.token}`, {
        method: 'PATCH',
        body: { category, location, scheduledAt, notes, ballsPlayer, courtPlayer, player1Id, player2Id },
      });
      if (canChangeFormat && selectedFormat !== m.format) {
        updated = await api(`/matches/${m.token}/format`, { method: 'PATCH', body: { format: selectedFormat } });
      }
      modal.style.display = 'none';
      toast(t('match.editMatchSaved'));
      if (onSaved) onSaved(updated);
    } catch (err) {
      errorEl.textContent = err.message;
      submitBtn.disabled = false;
    }
  };

  modal.style.display = 'flex';
}

let allPlayers = [];
async function loadPlayers() {
  try { allPlayers = await api('/players'); } catch { allPlayers = []; }
}

// Custom autocomplete instead of a native <datalist>, which mobile Safari in
// particular renders inconsistently (often not showing suggestions at all).
function setupAutocomplete(inputId, listId) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  // Guards the case where this page doesn't actually have these fields
  // (e.g. the admin-only edit-match-players-field, present on
  // index.html/player.html/match.html but not, say, rankings.html — common.js
  // loads on every page) — an unguarded null access here would throw and,
  // since that halts the rest of this script's top-level execution, silently
  // break everything declared later in the file too.
  if (!input || !list) return;
  let activeIndex = -1;

  function currentMatches() {
    const q = input.value.trim().toLowerCase();
    if (!q) return [];
    return allPlayers.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
  }

  function render() {
    const matches = currentMatches();
    list.innerHTML = matches.map((p, i) => `
      <div class="autocomplete-item${i === activeIndex ? ' active' : ''}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
    `).join('');
    list.classList.toggle('open', matches.length > 0);
  }

  input.addEventListener('input', () => { activeIndex = -1; render(); });
  input.addEventListener('focus', render);
  input.addEventListener('keydown', (e) => {
    const items = list.querySelectorAll('.autocomplete-item');
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      render();
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      input.value = items[activeIndex].dataset.name;
      // Setting .value directly doesn't fire a native 'input' event, so
      // anything listening for the player name to change (the balls-picker
      // button labels below) would otherwise never see this pick — dispatch
      // one explicitly, same as the mousedown handler just below.
      input.dispatchEvent(new Event('input'));
      list.classList.remove('open');
      activeIndex = -1;
    } else if (e.key === 'Escape') {
      list.classList.remove('open');
      activeIndex = -1;
    }
  });
  list.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.autocomplete-item');
    if (!item) return;
    e.preventDefault(); // keep focus on input so blur doesn't close the list first
    input.value = item.dataset.name;
    input.dispatchEvent(new Event('input'));
    list.classList.remove('open');
    activeIndex = -1;
  });
  input.addEventListener('blur', () => {
    setTimeout(() => list.classList.remove('open'), 100);
  });
}

// Wired once here (not inside openEditMatchModal, which runs every time the
// modal opens) — same one-shot-at-load pattern new-match.js uses for its own
// player1/player2 fields. setupAutocomplete's own guard above makes this a
// no-op on any page without the admin-only players field in its modal
// markup.
setupAutocomplete('edit-match-player1', 'edit-match-player1-suggestions');
setupAutocomplete('edit-match-player2', 'edit-match-player2-suggestions');

// Two-button "pick one of the two players" widget for a match still being
// created — optional, defaults to nobody picked. Button labels track
// whatever's currently typed into the #player1/#player2 name fields
// (falling back to "Player 1"/"Player 2" while empty) so it's clear who's
// who even before either name resolves to a real player. Clicking the
// already-active button clears the pick instead of just switching sides.
// Used for "who brings the balls" and "who's proposing these times".
// Returns a getter for the current pick (1, 2, or null) to read at submit.
function setupLivePlayerChoicePicker(rowId) {
  let picked = null;
  const btns = Array.from(document.querySelectorAll(`#${rowId} button`));
  function updateLabels() {
    const p1 = document.getElementById('player1').value.trim();
    const p2 = document.getElementById('player2').value.trim();
    btns[0].textContent = p1 || t('common.player1');
    btns[1].textContent = p2 || t('common.player2');
  }
  document.getElementById('player1').addEventListener('input', updateLabels);
  document.getElementById('player2').addEventListener('input', updateLabels);
  updateLabels();
  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = Number(btn.dataset.value);
      picked = picked === val ? null : val;
      btns.forEach((b) => b.classList.toggle('active', Number(b.dataset.value) === picked));
    });
  });
  return () => picked;
}
function setupBallsPicker() { return setupLivePlayerChoicePicker('balls-choice-row'); }
function setupCourtPicker() { return setupLivePlayerChoicePicker('court-choice-row'); }
function setupProposerPicker() { return setupLivePlayerChoicePicker('proposer-choice-row'); }

// Same two-button widget, but for a match whose two players are already
// fixed (a homepage/match-page modal, opened for one existing match at a
// time) instead of still being typed into #player1/#player2. Call
// setNames() each time the modal opens, possibly for a different match —
// reset() re-labels nothing, just sets/clears the pick.
function createStaticPlayerChoicePicker(rowId) {
  let picked = null;
  let locked = false;
  const btns = Array.from(document.querySelectorAll(`#${rowId} button`));
  function applyActive() {
    btns.forEach((b) => b.classList.toggle('active', Number(b.dataset.value) === picked));
  }
  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (locked) return;
      const val = Number(btn.dataset.value);
      picked = picked === val ? null : val;
      applyActive();
    });
  });
  return {
    getPicked: () => picked,
    setNames(n1, n2) { btns[0].textContent = n1; btns[1].textContent = n2; },
    // `lock: true` is for when we already know who's proposing (the
    // logged-in player opening this modal is one of the two match
    // players) — the answer is forced to them and neither button responds
    // to a click, instead of just starting pre-picked but still editable.
    reset(initial, { lock = false } = {}) {
      picked = initial != null ? initial : null;
      locked = lock;
      btns.forEach((b) => { b.disabled = locked; b.classList.toggle('locked', locked); });
      applyActive();
    },
  };
}

// When2Meet-style availability grid — used by the "Schedule a match" page
// and the homepage's "Propose times" modal. Paged one week at a time over
// the next two weeks so it always fills the container width without
// horizontal scroll (drag-select and page-scroll would otherwise fight over
// the same gesture on touch). `selectedSlots` is the live Set to read at
// submit time; call reset() right before showing a modal that was built at
// page load, so "the next two weeks" is relative to when it's opened, not
// to whenever the page happened to load.
function createAvailabilityPicker({ weekTabsId, gridWrapId, slotCountId }) {
  const START_HOUR = 7;
  const END_HOUR = 22; // exclusive — last slot starts at 21:00
  let proposalDays = [];
  const selectedSlots = new Set();
  let activeWeek = 0;

  function buildDays() {
    proposalDays = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = 1; i <= 14; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      proposalDays.push(d);
    }
  }

  function slotIso(day, hour) {
    const d = new Date(day);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  }

  function updateSlotCount() {
    const el = document.getElementById(slotCountId);
    if (el) el.textContent = selectedSlots.size ? t('match.slotsSelected', { count: selectedSlots.size }) : '';
  }

  function renderWeekTabs() {
    const fmt = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const label = (days) => `${fmt(days[0])} – ${fmt(days[days.length - 1])}`;
    const weeks = [proposalDays.slice(0, 7), proposalDays.slice(7, 14)];
    document.getElementById(weekTabsId).innerHTML = weeks.map((days, i) => `
      <button type="button" class="tab${i === activeWeek ? ' active' : ''}" data-week="${i}">${t('match.weekLabel', { n: i + 1 })}<span>${label(days)}</span></button>
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
    const days = proposalDays.slice(activeWeek * 7, activeWeek * 7 + 7);
    const dayHead = (d) => `${d.toLocaleDateString(undefined, { weekday: 'short' })}<br>${d.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' })}`;
    let html = '<div class="availability-grid"><div class="avail-corner"></div>';
    for (const d of days) html += `<div class="avail-day-head">${dayHead(d)}</div>`;
    for (let h = START_HOUR; h < END_HOUR; h++) {
      html += `<div class="avail-time-label">${String(h).padStart(2, '0')}:00</div>`;
      for (const d of days) {
        const iso = slotIso(d, h);
        html += `<div class="avail-cell${selectedSlots.has(iso) ? ' selected' : ''}" data-iso="${iso}"></div>`;
      }
    }
    html += '</div>';
    document.getElementById(gridWrapId).innerHTML = html;
  }

  function setupDragSelect() {
    const wrap = document.getElementById(gridWrapId);
    let dragging = false;
    let paintValue = true;
    let lastCell = null;

    function paint(cell) {
      if (!cell || cell === lastCell) return;
      lastCell = cell;
      if (paintValue) { selectedSlots.add(cell.dataset.iso); cell.classList.add('selected'); }
      else { selectedSlots.delete(cell.dataset.iso); cell.classList.remove('selected'); }
      updateSlotCount();
    }

    wrap.addEventListener('mousedown', (e) => {
      const cell = e.target.closest('.avail-cell');
      if (!cell) return;
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
      if (!cell) return;
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

  buildDays();
  renderWeekTabs();
  renderGrid();
  setupDragSelect();
  updateSlotCount();

  return {
    selectedSlots,
    clear() { selectedSlots.clear(); renderGrid(); updateSlotCount(); },
    reset() { buildDays(); activeWeek = 0; selectedSlots.clear(); renderWeekTabs(); renderGrid(); updateSlotCount(); },
    // Pre-checks an already-proposed match's existing slots when editing —
    // call right after reset(). A slot older than "today" (proposed a
    // while ago, now stale) won't have a cell to check in the freshly
    // built window, but still counts toward "N selected" and still gets
    // resubmitted, so nothing already offered silently disappears.
    setSlots(isoArray) {
      isoArray.forEach((iso) => selectedSlots.add(iso));
      renderGrid();
      updateSlotCount();
    },
  };
}

// Shared "add/remove venue chips" widget, same pages as
// createAvailabilityPicker above.
function createVenueChipPicker({ listId, inputId, addBtnId }) {
  const venues = [];

  function render() {
    const list = document.getElementById(listId);
    list.innerHTML = venues.map((v, i) => `
      <span class="venue-chip">${escapeHtml(v)}<button type="button" class="venue-chip-remove" data-i="${i}" aria-label="Remove venue">&times;</button></span>
    `).join('');
    list.querySelectorAll('.venue-chip-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        venues.splice(Number(btn.dataset.i), 1);
        render();
      });
    });
  }

  function add() {
    const input = document.getElementById(inputId);
    const val = input.value.trim();
    if (!val || venues.length >= 10) return;
    if (venues.some((v) => v.toLowerCase() === val.toLowerCase())) { input.value = ''; return; }
    venues.push(val);
    input.value = '';
    render();
  }

  document.getElementById(addBtnId).addEventListener('click', add);
  document.getElementById(inputId).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });

  return {
    venues,
    clear() { venues.length = 0; render(); },
    // Pre-fills an already-proposed match's existing venues when editing —
    // call right after clear().
    setVenues(arr) {
      arr.forEach((v) => { if (v && !venues.includes(v)) venues.push(v); });
      render();
    },
  };
}

// ---------- "Propose times for opponent" modal (shared) ----------
// Turns an existing undated Planned match into one awaiting a scheduling
// response, same widgets as the "Schedule a match" page, just built once
// here and reset() on each open instead of reloading a whole page. Shared
// by app.js (homepage) and player.js (a player's own match list) — both
// pages carry identical #propose-times-modal/#share-modal markup (see
// index.html/player.html) so this one instance drives either.
let proposeTimesToken = null;
let proposeTimesOnSuccess = null;
let proposeAvailabilityPicker = null;
let proposeVenuePicker = null;
let proposeProposerPicker = null;
// Only index.html and player.html carry the #propose-times-modal markup —
// every other page (rankings.html, match.html, players.html) loads this
// same common.js, so this whole block must stay guarded. It used to run
// unconditionally and throw on those pages, which — because a thrown error
// aborts the rest of this script's top-level execution — also silently
// skipped everything declared further down in this file (NATIONALITY_CODES
// among others), breaking unrelated features like rankings' nationality
// flags on every page except these two.
if (document.getElementById('propose-times-modal')) {
  proposeAvailabilityPicker = createAvailabilityPicker({ weekTabsId: 'modal-week-tabs', gridWrapId: 'modal-availability-grid-wrap', slotCountId: 'modal-slot-count' });
  proposeVenuePicker = createVenueChipPicker({ listId: 'modal-venue-chip-list', inputId: 'modal-venue-input', addBtnId: 'modal-venue-add-btn' });
  proposeProposerPicker = createStaticPlayerChoicePicker('modal-proposer-choice-row');
  document.getElementById('modal-clear-slots-btn').addEventListener('click', () => proposeAvailabilityPicker.clear());
}

// onSuccess (optional) is called once the proposal is sent — app.js passes
// its own loadMatches(), player.js passes load(), so whichever page's list
// is showing this match refreshes to reflect the new "awaiting response"
// state.
function openProposeTimesModal(token, p1Name, p2Name, p1Id, p2Id, onSuccess) {
  proposeTimesToken = token;
  proposeTimesOnSuccess = onSuccess || null;
  proposeAvailabilityPicker.reset();
  proposeVenuePicker.clear();
  proposeProposerPicker.setNames(p1Name, p2Name);
  // If the logged-in player opening this modal is one of the two match
  // players, we already know who's proposing — lock the answer to them
  // instead of asking (see canManageMatch's ownership check, which is what
  // let them get here in the first place).
  const forcedProposer = (playerAuthed && currentPlayerId)
    ? (currentPlayerId === Number(p1Id) ? 1 : currentPlayerId === Number(p2Id) ? 2 : null)
    : null;
  proposeProposerPicker.reset(forcedProposer, { lock: forcedProposer != null });
  document.getElementById('modal-proposer-optional-hint').style.display = forcedProposer != null ? 'none' : '';
  document.getElementById('modal-notify-email').value = '';
  document.getElementById('propose-times-error').textContent = '';
  document.getElementById('propose-times-modal').style.display = 'flex';
}

if (document.getElementById('propose-times-form')) {
  document.getElementById('propose-times-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('propose-times-error');
    errorEl.textContent = '';
    if (proposeAvailabilityPicker.selectedSlots.size === 0) {
      errorEl.textContent = t('proposeTimes.markAtLeastOne');
      return;
    }
    if (proposeVenuePicker.venues.length === 0) {
      errorEl.textContent = t('proposeTimes.addAtLeastOneVenue');
      return;
    }
    const notifyEmail = document.getElementById('modal-notify-email').value.trim();
    if (notifyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail)) {
      errorEl.textContent = t('proposeTimes.invalidEmail');
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      // POST .../counter-propose rather than PATCH here deliberately — the
      // server writes this as the match's first proposal if it doesn't have
      // one yet, or as an independent second calendar alongside an existing
      // one otherwise (see routes/matches.js), so this same button keeps
      // working correctly for a match the opponent already proposed times
      // for instead of silently overwriting their offer.
      const updated = await api(`/matches/${proposeTimesToken}/counter-propose`, {
        method: 'POST',
        body: {
          proposalSlots: Array.from(proposeAvailabilityPicker.selectedSlots),
          proposalVenues: proposeVenuePicker.venues,
          proposedBy: proposeProposerPicker.getPicked(),
          proposalNotifyEmail: notifyEmail || undefined,
        },
      });
      document.getElementById('propose-times-modal').style.display = 'none';
      // The share-with-opponent popup (link + Copy link) is the actual
      // confirmation here — no separate toast needed on top of it.
      openShareModal(
        updated,
        t('proposeTimes.whatsappText', { p1: updated.player1.name, p2: updated.player2.name }),
        t('proposeTimes.shareDesc')
      );
      if (proposeTimesOnSuccess) proposeTimesOnSuccess();
    } catch (err) {
      errorEl.textContent = err.message;
    }
    submitBtn.disabled = false;
  });
}

// "6-4, 3-2" / "Retirement" / "6-4, 3-2 — Retirement" / "Best of 3 sets" (planned)
function matchResultText(m) {
  if (m.status === 'PLANNED') return m.formatLabel;
  const parts = [];
  if (m.scoreSummary) parts.push(m.scoreSummary);
  if (m.endReason && endReasonLabel(m.endReason)) parts.push(endReasonLabel(m.endReason));
  return parts.join(' — ') || '—';
}

// Same text as matchResultText, but for a Planned match whose format label
// has a parenthetical qualifier (e.g. "Best of 3 sets (Super Tie-break)"),
// breaks it onto its own line so it doesn't crowd the format's main name.
function matchScoreHtml(m) {
  const text = matchResultText(m);
  if (m.status === 'PLANNED') {
    const idx = text.indexOf(' (');
    if (idx !== -1) return `${escapeHtml(text.slice(0, idx))}<br>${escapeHtml(text.slice(idx + 1))}`;
  }
  return escapeHtml(text);
}

// Mirrors match.js's own render of a single set's score for one player,
// including the small tiebreak-loser superscript — shared here so a match
// card's compact scoreboard (below) and the full match-page scoreboard
// stay visually identical.
// highlightWinner colors the winning player's number green for a decided
// set (set.winner from matchEngine.js) — off by default so the full
// match-page scoreboard and the regular (non-compact) match-card
// scoreboard keep their existing plain-white look; only the compact
// match-list grid (see cardScoreboardHtml's compact mode) turns it on.
function setCell(set, playerNum, { highlightWinner = false } = {}) {
  const gKey = playerNum === 1 ? 'p1' : 'p2';
  const won = highlightWinner && set.winner === playerNum;
  if (set.isSuperTiebreak) {
    const val = set.tiebreak[gKey];
    return won ? `<span class="set-win">${val}</span>` : `${val}`;
  }
  const main = set[gKey];
  const sub = set.tiebreak ? `<sup class="sub-tb">${set.tiebreak[gKey]}</sup>` : '';
  return `${won ? `<span class="set-win">${main}</span>` : main}${sub}`;
}

// Static (non-ticking — updates whenever the card list itself re-renders,
// e.g. on any matches:changed broadcast) duration for a card's scoreboard
// header: elapsed time so far for a LIVE match, or total playtime once
// FINISHED. Mirrors match.js's own timer math minus the per-second tick.
function cardDurationHtml(m) {
  if (m.status === 'LIVE' && m.startTime) {
    const start = new Date(m.startTime).getTime();
    const pausedSeconds = m.pausedSeconds || 0;
    const nowMs = m.pausedAt ? new Date(m.pausedAt).getTime() : Date.now();
    const secs = Math.max(0, Math.floor((nowMs - start) / 1000) - pausedSeconds);
    const h = Math.floor(secs / 3600);
    const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    const text = h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    return `<div class="timer${m.pausedAt ? ' timer-paused' : ''}">${text}</div>${m.pausedAt ? '<div class="paused-label">⏸ PAUSED</div>' : ''}`;
  }
  if (m.status === 'FINISHED' && m.startTime && m.endTime) {
    const mins = Math.max(1, Math.round((new Date(m.endTime) - new Date(m.startTime)) / 60000));
    return `<div class="timer">${mins} min</div>`;
  }
  return '';
}

// Small "i" next to a player's name that opens their profile page — a plain
// <a> would be invalid (and misbehave) nested inside a match card's own
// <a>, so this is a button that stops the click from also navigating the
// card, then opens the profile in a new tab itself (also matters for the
// embed widget, whose cards live inside an iframe on someone else's site —
// same-tab navigation there would replace the whole widget).
function playerInfoBtn(player) {
  // Same-window navigation everywhere, except when this card is rendered
  // inside the embed widget's iframe on an external site — there, navigating
  // the iframe itself would replace the whole embedded widget with the
  // profile page, so that context still opens a new tab.
  const playerPath = player.slug || player.id;
  const nav = window.top === window.self
    ? `window.location.href='/player/${playerPath}'`
    : `window.open('/player/${playerPath}','_blank')`;
  return `<button type="button" class="player-info-btn" title="${escapeHtml(t('common.viewProfileTitle', { name: player.name }))}" onclick="event.preventDefault();event.stopPropagation();${nav}">i</button>`;
}

// Name -> current overall BLTA rank (the "blta" rankings table only, not
// the per-category Race tables), so a match card can show "#N" next to a
// ranked player. Fetched once per page load; a page that renders cards
// should `await RANKS_READY` before its first render so the badges are
// there from the start rather than popping in on a later re-render. Best
// -effort — a scraper hiccup just means no badges, not a broken page.
const RANK_BY_NAME = new Map();
const RANKS_READY = (async () => {
  try {
    const data = await api('/rankings');
    const blta = data.tables.find((t) => t.key === 'blta');
    if (blta) blta.rows.forEach((r) => RANK_BY_NAME.set(r.name, r.rank));
  } catch { /* no badges this load — not worth failing the page over */ }
})();

function rankBadgeHtml(name) {
  const rank = RANK_BY_NAME.get(name);
  return rank ? `<span class="player-rank">#${rank}</span> ` : '';
}

// A player's name inside a match card — clickable to their profile page,
// same not-a-real-<a> nav trick as playerInfoBtn above (and for the same
// reason: it sits inside the card's own <a>).
function playerNameLink(player) {
  const playerPath = player.slug || player.id;
  const nav = window.top === window.self
    ? `window.location.href='/player/${playerPath}'`
    : `window.open('/player/${playerPath}','_blank')`;
  return `<span class="player-name-link" onclick="event.preventDefault();event.stopPropagation();${nav}">${rankBadgeHtml(player.name)}${escapeHtml(player.name)}</span>`;
}

// A small tennis-ball marker next to whichever player is bringing the
// balls (set at creation time, see new-match.js) — only while the match
// is still PLANNED, since once it's live/finished that's no longer
// useful information to surface on the card. Drawn as inline SVG rather
// than the 🎾 emoji — an emoji glyph's actual artwork is up to the
// viewer's own OS/font, and 🎾 renders as a racket-and-ball combo on
// several common platforms instead of a plain ball. Drawing it ourselves
// (a lime circle with two curved seam lines, the classic tennis-ball
// icon shape) guarantees the same ball-only look everywhere.
function ballsIconHtml(m, playerNum) {
  if (m.status !== 'PLANNED' || m.ballsPlayer !== playerNum) return '';
  // The title has to be a <title> *child element*, not a title attribute on
  // <svg> itself — unlike a plain HTML element, a bare attribute there
  // isn't picked up as a hover tooltip by browsers.
  return `<svg class="balls-icon" viewBox="0 0 24 24"><title>${escapeHtml(t('common.bringsBallsTitle'))}</title>
    <circle cx="12" cy="12" r="11" fill="#d4ee4e" stroke="#a8c93a" stroke-width="1"/>
    <path d="M3 6c3.2 2.6 3.2 8.8 0 12" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M21 6c-3.2 2.6-3.2 8.8 0 12" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </svg>`;
}

// Same idea as ballsIconHtml, for whichever player is reserving the court —
// a plain 📞 emoji rather than a drawn icon (unlike the ball, there's no
// cross-platform rendering risk worth avoiding for a phone glyph). A plain
// HTML element's title attribute *does* work as a native tooltip, unlike
// the SVG case above, so no <title> child needed here.
function courtIconHtml(m, playerNum) {
  if (m.status !== 'PLANNED' || m.courtPlayer !== playerNum) return '';
  return `<span class="court-icon" title="${escapeHtml(t('common.reservesCourtTitle'))}">📞</span>`;
}

// Same idea again, for whichever player made a "propose times" offer
// that's still awaiting the other player's response — checks both the
// primary proposal and any independent counter-proposal (see
// proposeTimesModal/counter-propose in match.js), since either one can
// name its own proposer. Both proposal_slots/counter_proposal_slots are
// always cleared the moment a slot gets confirmed (see respond-proposal
// server-side), so there's no separate "still awaiting" check needed here
// beyond proposedBy/counterProposedBy actually being this player.
function proposalIconHtml(m, playerNum) {
  if (m.status !== 'PLANNED' || (m.proposedBy !== playerNum && m.counterProposedBy !== playerNum)) return '';
  return `<span class="proposal-icon" title="${escapeHtml(t('common.proposalTitle'))}">🕓</span>`;
}

// Compact per-set scoreboard for a match card (LIVE/FINISHED) — same dark
// table as the full match page, just condensed, with the same timer chip in
// its header cell. For a LIVE match this always shows (even at a fresh
// 0-0, matching the match page itself) since the clock is already running;
// for FINISHED it only shows once there's real per-set score data, so a
// walkover/retirement result still falls back to the plain text line.
// compact:true drops the name column (and the LIVE timer header cell) —
// used by compactMatchCardHtml, whose match list already shows player
// names in their own separate column right next to this one, so repeating
// them inside the table too would be redundant.
function cardScoreboardHtml(m, { compact = false } = {}) {
  if (!m.state || !m.state.sets) return '';
  const sets = m.status === 'LIVE'
    ? m.state.sets
    : m.state.sets.filter((s) => s.winner || s.p1 > 0 || s.p2 > 0 || (s.tiebreak && (s.tiebreak.p1 > 0 || s.tiebreak.p2 > 0)));
  const winnerP1 = m.status === 'FINISHED' && m.winnerId === m.player1.id;
  const winnerP2 = m.status === 'FINISHED' && m.winnerId === m.player2.id;
  // A finished match with no games played at all (walkover/retirement before
  // a point was scored) — keep the same dark scoreboard box as every other
  // finished card instead of falling back to the plain light layout, just
  // without a score table.
  if (!sets.length) {
    if (m.status !== 'FINISHED') return '';
    const reasonLabel = m.endReason ? endReasonLabel(m.endReason) : null;
    return `
      <div class="scoreboard scoreboard-compact">
        ${compact ? '' : `
          <table>
            <tbody>
              <tr class="${winnerP1 ? 'winner-row' : ''}"><td class="name-cell">${playerNameLink(m.player1)}${playerInfoBtn(m.player1)}</td></tr>
              <tr class="${winnerP2 ? 'winner-row' : ''}"><td class="name-cell">${playerNameLink(m.player2)}${playerInfoBtn(m.player2)}</td></tr>
            </tbody>
          </table>
        `}
        ${reasonLabel ? `<div class="scoreboard-reason">${escapeHtml(reasonLabel)}</div>` : ''}
      </div>
    `;
  }
  const headerCells = sets.map((s, i) => `<th>${s.isSuperTiebreak ? 'MTB' : `S${i + 1}`}</th>`).join('');
  const row = (playerNum, player, isWinner) => {
    const cells = sets.map((s) => `<td class="set-score">${setCell(s, playerNum, { highlightWinner: compact })}</td>`).join('');
    const nameCell = compact ? '' : `<td class="name-cell">${playerNameLink(player)}${playerInfoBtn(player)}</td>`;
    return `<tr class="${isWinner ? 'winner-row' : ''}">${nameCell}${cells}</tr>`;
  };
  return `
    <div class="scoreboard scoreboard-compact">
      <table>
        ${compact ? '' : `<thead><tr><th class="timer-cell">${cardDurationHtml(m)}</th>${headerCells}</tr></thead>`}
        <tbody>
          ${row(1, m.player1, winnerP1)}
          ${row(2, m.player2, winnerP2)}
        </tbody>
      </table>
    </div>
  `;
}

// A match was scheduled for a day (or more) in the past but never got
// started or finished — flags it as needing attention on its card.
function isOverdueUnresolved(m) {
  if (m.status !== 'PLANNED' || !m.scheduledAt) return false;
  return Date.now() - new Date(m.scheduledAt).getTime() > 24 * 60 * 60 * 1000;
}

(function initMobileNav() {
  const toggle = document.getElementById('nav-toggle');
  const links = document.getElementById('nav-links');
  if (!toggle || !links) return;
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    links.classList.toggle('open');
  });
  links.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') links.classList.remove('open');
  });
  document.addEventListener('click', (e) => {
    if (links.classList.contains('open') && !links.contains(e.target) && e.target !== toggle) {
      links.classList.remove('open');
    }
  });
})();

// Desktop-only scroll-to-top button — skipped on pages with no topbar
// (the embed views), which are short widgets that don't need it.
(function initScrollTop() {
  if (!document.querySelector('.topbar')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'scroll-top-btn';
  btn.className = 'scroll-top-btn';
  btn.setAttribute('aria-label', 'Scroll to top');
  btn.textContent = '↑';
  document.body.appendChild(btn);
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 400);
  });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
})();

document.querySelectorAll('[data-close]').forEach((el) => {
  el.addEventListener('click', () => {
    document.getElementById(el.dataset.close).style.display = 'none';
  });
});
document.querySelectorAll('.modal-backdrop').forEach((el) => {
  el.addEventListener('click', (e) => { if (e.target === el) el.style.display = 'none'; });
});

// OTP-style 5-digit code entry — a row of 5 single-digit boxes (see
// .otp-group/.otp-box in style.css) in front of a plain hidden <input>
// (id is the group's own id minus the "-otp" suffix, e.g.
// "player-login-pin-input-otp" pairs with "player-login-pin-input") that
// stays in sync with them. That hidden input is the one every existing
// bit of login/registration/reset JS actually reads/writes — via
// `.value`, or (since setting .value directly wouldn't touch the boxes)
// the otpClear/otpFocus/otpDisable helpers below wherever that code used
// to just call .value='' / .focus() / .disabled=x on the input directly —
// so this only changes how the digits get typed in, never how the rest
// of the app reads the result.
const otpBoxesByInputId = new Map();

function initOtpGroups() {
  document.querySelectorAll('.otp-group').forEach((group) => {
    const hiddenId = group.id.replace(/-otp$/, '');
    const hidden = document.getElementById(hiddenId);
    if (!hidden) return;
    const boxes = Array.from(group.querySelectorAll('.otp-box'));
    otpBoxesByInputId.set(hiddenId, boxes);
    const sync = () => { hidden.value = boxes.map((b) => b.value).join(''); };

    boxes.forEach((box, i) => {
      box.addEventListener('input', () => {
        box.value = box.value.replace(/\D/g, '').slice(-1);
        sync();
        if (box.value && boxes[i + 1]) boxes[i + 1].focus();
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && boxes[i - 1]) boxes[i - 1].focus();
        else if (e.key === 'ArrowLeft' && boxes[i - 1]) boxes[i - 1].focus();
        else if (e.key === 'ArrowRight' && boxes[i + 1]) boxes[i + 1].focus();
      });
      // Pasting a full code (e.g. copied from a password manager) fills
      // every box at once instead of just dumping it all into whichever
      // one happened to be focused.
      box.addEventListener('paste', (e) => {
        const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        if (!text) return;
        e.preventDefault();
        boxes.forEach((b, j) => { b.value = text[j] || ''; });
        sync();
        const nextEmpty = boxes.findIndex((b) => !b.value);
        (nextEmpty === -1 ? boxes[boxes.length - 1] : boxes[nextEmpty]).focus();
      });
    });
  });
}
initOtpGroups();

function otpClear(hiddenInputId) {
  const hidden = document.getElementById(hiddenInputId);
  if (hidden) hidden.value = '';
  const boxes = otpBoxesByInputId.get(hiddenInputId);
  if (boxes) boxes.forEach((b) => { b.value = ''; });
}
function otpFocus(hiddenInputId) {
  const boxes = otpBoxesByInputId.get(hiddenInputId);
  if (boxes && boxes[0]) boxes[0].focus();
}
function otpSetDisabled(hiddenInputId, disabled) {
  const boxes = otpBoxesByInputId.get(hiddenInputId);
  if (boxes) boxes.forEach((b) => { b.disabled = disabled; });
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    // The parsed body, if any — lets a caller branch on a custom field the
    // server sent alongside the error (e.g. pinRequired in the player
    // login flow) rather than only ever having the message text.
    err.data = data;
    throw err;
  }
  return data;
}

// Plain-text version of the same lookup categoryBadge uses below — for
// spots that need just the label (an info-item value, a <select> option),
// not the badge markup.
function categoryLabel(category) {
  const key = `category.${category}`;
  const hasTranslation = TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key];
  return hasTranslation ? t(key) : (CATEGORY_LABELS[category] || category);
}

function categoryBadge(category) {
  return `<span class="badge badge-${category}">${categoryLabel(category)}</span>`;
}

// One-line card shared by the /compact page and the /embed/compact widget:
// date, category, opponents, result, place, nothing else — built for
// embedding a lot of matches into a tight WordPress widget instead of the
// full card's scoreboard/notify buttons.

// Calendar date only — no weekday name, no clock time (unlike fmtDateShort).
function compactDateOnly(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

function compactDateHtml(m) {
  if (m.status === 'LIVE') return '<span class="compact-live">🔴 LIVE</span>';
  return escapeHtml(compactDateOnly(m.scheduledAt) || 'Date TBD');
}

function compactMatchCardHtml(m) {
  const winnerP1 = m.status === 'FINISHED' && m.winnerId === m.player1.id;
  const winnerP2 = m.status === 'FINISHED' && m.winnerId === m.player2.id;
  // Same dark S1/S2/MTB score grid as the regular match cards' scoreboard
  // (cardScoreboardHtml), just without its own name column — falls back to
  // the plain result pill (format label for a Planned match, or a
  // walkover/retirement's reason text) when there's no real score grid to
  // show, same cases cardScoreboardHtml itself returns '' for.
  const scoreboard = cardScoreboardHtml(m, { compact: true });
  return `
    <a class="compact-card status-${m.status}" href="${window.location.origin}/match/${m.token}"${window.top !== window.self ? ' target="_blank" rel="noopener"' : ''}>
      <span class="compact-date-category">
        ${categoryBadge(m.category)}
        <span class="compact-date">${compactDateHtml(m)}</span>
      </span>
      <span class="compact-players">
        <span class="${winnerP1 ? 'winner' : ''}">${escapeHtml(m.player1.name)}${ballsIconHtml(m, 1)}${courtIconHtml(m, 1)}${proposalIconHtml(m, 1)}</span>
        <span class="${winnerP2 ? 'winner' : ''}">${escapeHtml(m.player2.name)}${ballsIconHtml(m, 2)}${courtIconHtml(m, 2)}${proposalIconHtml(m, 2)}</span>
      </span>
      ${scoreboard || `<span class="compact-result">${matchScoreHtml(m)}</span>`}
      <span class="compact-place">${m.location ? `📍 ${escapeHtml(m.location)}` : ''}</span>
    </a>
  `;
}

// Accepts either a match object (preferred, so a scheduled Planned match can
// show its date/time instead of just "Planned") or a plain status string.
function statusBadge(m) {
  const status = typeof m === 'string' ? m : m.status;
  const scheduledAt = typeof m === 'string' ? null : m.scheduledAt;
  if (status === 'PLANNED' && scheduledAt) {
    return `<span class="badge badge-status status-PLANNED-dated">${fmtDateShort(scheduledAt)}</span>`;
  }
  const key = `status.${status}`;
  const hasTranslation = TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key];
  const label = hasTranslation ? t(key) : (STATUS_LABELS[status] || status);
  return `<span class="badge badge-status status-${status}">${label}</span>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Nationality is free text (admin-typed), not a country code, so flags are
// matched by name — covers every value currently in use plus a handful of
// common variants/languages. Falls back to no flag for anything unmapped
// rather than guessing. Rendered as an actual flag image (flagcdn.com SVGs)
// rather than a Unicode flag emoji — Windows browsers commonly fall back to
// showing the raw two-letter region code ("SK") instead of a flag glyph, so
// emoji aren't reliable here.
const NATIONALITY_CODES = {
  'slovenska republika': 'sk',
  slovensko: 'sk',
  slovakia: 'sk',
  ukrajina: 'ua',
  ukraine: 'ua',
  nemecko: 'de',
  germany: 'de',
  francuzsko: 'fr',
  france: 'fr',
  'korejska republika': 'kr',
  'south korea': 'kr',
  korea: 'kr',
  czechia: 'cz',
  'ceska republika': 'cz',
  'czech republic': 'cz',
  cesko: 'cz',
  vietnam: 'vn',
  bulharsko: 'bg',
  bulgaria: 'bg',
  polsko: 'pl',
  poland: 'pl',
  madarsko: 'hu',
  hungary: 'hu',
  rakusko: 'at',
  austria: 'at',
  rusko: 'ru',
  russia: 'ru',
  srbsko: 'rs',
  serbia: 'rs',
  chorvatsko: 'hr',
  croatia: 'hr',
  taliansko: 'it',
  italy: 'it',
  spanielsko: 'es',
  spain: 'es',
  'velka britania': 'gb',
  'united kingdom': 'gb',
  anglicko: 'gb',
  usa: 'us',
  'united states': 'us',
};

function flagCodeFor(nationality) {
  if (!nationality) return '';
  const key = nationality.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return NATIONALITY_CODES[key] || '';
}

function flagImgHtml(nationality, cssClass) {
  const code = flagCodeFor(nationality);
  if (!code) return '';
  return `<img class="${cssClass}" src="https://flagcdn.com/${code}.svg" alt="${code.toUpperCase()}">`;
}

// Fixed Ddd d.m.yyyy, HH:MM format (not locale-dependent) so it reads the
// same for every visitor regardless of their browser's locale settings.
function fmtDateShort(iso) {
  if (!iso) return t('common.dateTbd');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const weekday = t('common.weekdaysShort').split(',')[d.getDay()];
  return `${weekday} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}, ${hh}:${mm}`;
}

function fmtDateLong(iso) {
  if (!iso) return t('common.dateTbd');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2200);
}

function describeSet(set) {
  if (set.isSuperTiebreak) return `${set.tiebreak.p1}-${set.tiebreak.p2}`;
  if (set.tiebreak && set.winner) {
    const loserPoints = set.winner === 1 ? set.tiebreak.p2 : set.tiebreak.p1;
    return `${set.p1}-${set.p2}(${loserPoints})`;
  }
  return `${set.p1}-${set.p2}`;
}

function describeMatch(state) {
  return state.sets
    .filter((s) => s.winner || s.p1 > 0 || s.p2 > 0 || (s.tiebreak && (s.tiebreak.p1 > 0 || s.tiebreak.p2 > 0)))
    .map(describeSet)
    .join(', ');
}

function whatsappShareUrl(text, url) {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
}

// Shared "share this match" popup — the match's link plus WhatsApp/Copy
// link actions. Used by match.js's plain "🔗 Share" button (default
// WhatsApp text, no description) and, with their own text/description, by
// the propose-times/counter-propose success flows on both the homepage
// (app.js) and the match page (match.js) — that's the moment the proposer
// actually needs the link to hand to their opponent. Every page that
// calls this needs the same #share-modal/#share-modal-desc/
// #share-whatsapp-preview-field/#share-whatsapp-preview/#share-link/
// #whatsapp-btn/#copy-link-btn markup.
function openShareModal(m, whatsappText, description) {
  const url = `${window.location.origin}/match/${m.token}`;
  document.getElementById('share-link').textContent = url;
  const descEl = document.getElementById('share-modal-desc');
  descEl.textContent = description || '';
  descEl.style.display = description ? '' : 'none';
  const text = whatsappText || t('share.defaultWhatsappText', { p1: m.player1.name, p2: m.player2.name });
  // The WhatsApp button's own pre-filled text isn't visible anywhere until
  // WhatsApp actually opens — show it here too so what's about to be sent
  // isn't a surprise. Only for a real custom message (the propose-times
  // flows) — the plain Share button's generic default text doesn't need
  // its own preview line, the link below already covers that case.
  const previewField = document.getElementById('share-whatsapp-preview-field');
  if (previewField) {
    document.getElementById('share-whatsapp-preview').textContent = whatsappText || '';
    previewField.style.display = whatsappText ? '' : 'none';
  }
  document.getElementById('whatsapp-btn').onclick = () => {
    window.open(whatsappShareUrl(text, url), '_blank');
  };
  document.getElementById('copy-link-btn').onclick = () => {
    copyToClipboard(url).then(() => toast(t('share.linkCopied')));
  };
  document.getElementById('share-modal').style.display = 'flex';
}

// Shown instead of a toast wherever a click is blocked by checkMatchAccess/
// canManageMatch — the rejection message stays on screen until dismissed
// instead of a toast that can be missed. Used by app.js's
// handlePlannedActionClick and match.js's Start live match/Enter result
// manually handlers; every page that calls this needs the same
// #access-denied-modal/#access-denied-text markup.
function showAccessDeniedModal(message) {
  document.getElementById('access-denied-text').textContent = message;
  document.getElementById('access-denied-modal').style.display = 'flex';
}

async function checkAdmin() {
  try {
    const res = await api('/admin/session');
    return !!res.isAdmin;
  } catch {
    return false;
  }
}

// Shared "log in as player" gate: each player logs in with their own phone
// number (set per-player by an admin — see routes/players.js) which both
// authenticates them and identifies WHICH player they are, so match-editing
// rights can be scoped to their own matches instead of every match in the
// league (see checkMatchAccess in routes/matches.js). Lives in common.js
// since the popup and nav toggle are identical across every page.
//
// There used to be a second, more limited "anonymous" login here too (its
// own shared code) — it's been removed entirely; phone number is now the
// only way in besides admin.
let playerAuthed = false;
let currentPlayerName = null;
// Null for a pure admin session (no player cookie) or no session at all —
// only set once a *specific* player is logged in via their phone number.
// Pages that need to scope a button/action to "this player's own stuff"
// (see checkMatchAccess in routes/matches.js) compare against this.
let currentPlayerId = null;

function updatePlayerNavLinks() {
  document.querySelectorAll('.player-login-link').forEach((el) => {
    if (playerAuthed && currentPlayerName) el.textContent = t('nav.logoutWithName', { name: currentPlayerName });
    else if (playerAuthed) el.textContent = t('nav.logout');
    else el.textContent = t('nav.loginPlayer');
  });
}

async function refreshPlayerAuth() {
  let needsPinSetup = false;
  try {
    const res = await api('/player/session');
    playerAuthed = !!res.isPlayer;
    currentPlayerName = res.playerName || null;
    currentPlayerId = res.playerId || null;
    needsPinSetup = !!res.needsPinSetup;
  } catch {
    playerAuthed = false;
    currentPlayerName = null;
    currentPlayerId = null;
  }
  updatePlayerNavLinks();
  // Lets any page's own script react to a login/logout finishing (e.g. the
  // homepage re-showing/hiding "Set date & location" once it knows who's
  // logged in) without common.js needing to know what each page does.
  window.dispatchEvent(new Event('blta:auth-changed'));
  // A player who's logged in but never finished creating a code (see
  // needsPinSetup in routes/player.js) gets sent straight back to that
  // step on every page load — this is what actually stops "close the
  // modal and never set one" from working: closing it (see the
  // pinSetupMandatory close-handlers below) logs them back out, and the
  // very next page they land on runs this same check again regardless.
  if (needsPinSetup) openPlayerLoginModal(null, { startAtSetPin: true });
  return playerAuthed;
}

// Mirrors checkMatchAccess in routes/matches.js — whether the current
// session could actually manage this match (start it, set its date/
// location, propose times for the opponent, edit an existing proposal,
// etc.), so those controls only show up where they'd work instead of
// showing everywhere and 403ing on click. isAdminUser is passed in rather
// than read off a shared global since each page tracks its own admin
// status (via checkAdmin()) independently. A visitor with no session at
// all still sees these controls — requirePlayerAuth prompts login, then
// the action proceeds normally — this only hides them once we actually
// know who's logged in and they're not eligible for THIS match.
function canManageMatch(m, isAdminUser) {
  if (isAdminUser) return true;
  if (playerAuthed && currentPlayerId) {
    const playsInMatch = currentPlayerId === m.player1.id || currentPlayerId === m.player2.id;
    if (m.createdByAdmin && playsInMatch) return true;
    if (m.createdByPlayerId === currentPlayerId) return true;
    // Grandfather clause — mirrors checkMatchAccess in routes/matches.js:
    // a match with no creator attribution at all predates per-player
    // tracking (created under the old shared PLAYER_CODE login), so treat
    // it like an admin-created match instead of leaving it permanently
    // unmanageable by either player still in it.
    return !m.createdByAdmin && !m.createdByAnonymous && !m.createdByPlayerId && playsInMatch;
  }
  return true;
}

// "N attempt(s) left" needs real plural forms in Slovak (1/2-4/5+), not
// just an English-style singular/plural switch — used only by
// loginErrorText's incorrectCode case below.
function attemptsWord(n) {
  if (currentLang === 'sk') {
    if (n === 1) return 'pokus';
    if (n >= 2 && n <= 4) return 'pokusy';
    return 'pokusov';
  }
  return n === 1 ? 'attempt' : 'attempts';
}

// Every /player/* auth error (login, register, set-pin, forgot-pin,
// reset-pin, request-admin-reset) carries a plain-English "error" string
// (this app's long-standing convention for server error text generally)
// alongside a short machine "errorCode" — this maps that code to a
// translated string via t(`login.error.${code}`), falling back to the raw
// English message for any code that isn't mapped (a future/forgotten one)
// rather than showing nothing.
function loginErrorText(err) {
  const code = err.data && err.data.errorCode;
  if (!code) return err.message;
  const key = `login.error.${code}`;
  const vars = code === 'incorrectCode' ? { count: err.data.attemptsLeft, word: attemptsWord(err.data.attemptsLeft) } : undefined;
  const translated = t(key, vars);
  return translated === key ? err.message : translated;
}

// Six steps, only three of which any one login ever visits — see the
// #player-login-step-* panels in the modal markup:
//   1. player-login-step-form     — phone number; also where the "not
//                                    registered yet?" prompt into step 6
//                                    lives (server 401s with notFound)
//   2. player-login-step-pin      — only if that phone already has a code
//                                    set up (server 401s with pinRequired);
//                                    also where "Forgot your code?" lives
//   3. player-login-step-set-pin  — only the first time (server 200s with
//                                    pinSetupRequired), or any later page
//                                    load that still finds no code set
//                                    (see refreshPlayerAuth's needsPinSetup
//                                    check) — creating a code is mandatory
//                                    going forward: closing the modal here
//                                    (the X button or the backdrop) logs
//                                    the player back out instead of just
//                                    hiding it, via pinSetupMandatory below
//   4. player-login-step-forgot   — reached from step 2's "Forgot your
//                                    code?" link, not from a server response
//   5. player-login-step-register — reached from step 1's "not registered
//                                    yet?" prompt, not from switching a
//                                    login-vs-register mode upfront —
//                                    self-service registration (see POST
//                                    /player/register) for a phone number
//                                    with no player behind it at all;
//                                    success lands on step 3 exactly like
//                                    an admin-added player's first login
//   6. player-login-step-success  — always the last step, whichever way it
//                                    got there
//
// True only while step 3 is showing because a code genuinely still has to
// be created (not just "the modal happens to be sitting on that panel"
// mid-flow) — gates the close-handlers below so closing the modal any
// OTHER time (e.g. a not-yet-logged-in visitor backing out of the phone
// step) behaves exactly as it always has, no logout involved.
let pinSetupMandatory = false;

function openPlayerLoginModal(onSuccess, opts) {
  const modal = document.getElementById('player-login-modal');
  if (!modal) return;
  const steps = ['form', 'pin', 'set-pin', 'forgot', 'register', 'success'].map((name) => document.getElementById(`player-login-step-${name}`));
  const [formStep, pinStep, setPinStep, forgotStep, registerStep, successStep] = steps;

  const form = document.getElementById('player-login-form');
  const input = document.getElementById('player-login-input');
  const errorEl = document.getElementById('player-login-error');
  const submitBtn = form.querySelector('button[type="submit"]');
  const registerPromptEl = document.getElementById('player-login-register-prompt');
  const registerLink = document.getElementById('player-login-register-link');

  const pinForm = document.getElementById('player-login-pin-form');
  const pinInput = document.getElementById('player-login-pin-input');
  const pinErrorEl = document.getElementById('player-login-pin-error');
  const pinSubmitBtn = pinForm.querySelector('button[type="submit"]');
  const pinBackBtn = document.getElementById('player-login-pin-back-btn');
  const forgotLink = document.getElementById('player-login-forgot-link');

  const setPinForm = document.getElementById('player-login-set-pin-form');
  const setPinInput = document.getElementById('player-login-set-pin-input');
  const setPinConfirmInput = document.getElementById('player-login-set-pin-confirm-input');
  const setPinErrorEl = document.getElementById('player-login-set-pin-error');
  const setPinSubmitBtn = setPinForm.querySelector('button[type="submit"]');

  const forgotLoading = document.getElementById('player-login-forgot-loading');
  const forgotEmailSent = document.getElementById('player-login-forgot-email-sent');
  const forgotNoEmail = document.getElementById('player-login-forgot-no-email');
  const forgotErrorEl = document.getElementById('player-login-forgot-error');
  const forgotBackBtn = document.getElementById('player-login-forgot-back-btn');
  const requestAdminBtn = document.getElementById('player-login-request-admin-btn');
  const requestAdminSentEl = document.getElementById('player-login-request-admin-sent');

  const registerForm = document.getElementById('player-login-register-form');
  const registerNameInput = document.getElementById('player-login-register-name-input');
  const registerEmailInput = document.getElementById('player-login-register-email-input');
  const registerErrorEl = document.getElementById('player-login-register-error');
  const registerSubmitBtn = registerForm.querySelector('button[type="submit"]');
  const registerBackBtn = document.getElementById('player-login-register-back-btn');

  function showStep(step) {
    steps.forEach((el) => { el.style.display = 'none'; });
    step.style.display = '';
  }

  // The phone number just entered — carried from the form step to the pin
  // and forgot steps so their own submits can resend it (see the login/
  // forgot-pin/request-admin-reset routes' contract in routes/player.js)
  // without asking for the phone number twice.
  let enteredPhone = '';

  function showSuccess() {
    document.getElementById('player-login-success-text').textContent = currentPlayerName
      ? t('login.successNamed', { name: currentPlayerName })
      : t('login.successGeneric');
    showStep(successStep);
  }

  function applySession(res) {
    playerAuthed = !!res.isPlayer;
    currentPlayerName = res.playerName || null;
    currentPlayerId = res.playerId || null;
    updatePlayerNavLinks();
    window.dispatchEvent(new Event('blta:auth-changed'));
  }

  errorEl.textContent = '';
  registerPromptEl.style.display = 'none';
  input.value = '';
  input.disabled = false;

  if (opts && opts.startAtSetPin) {
    // Not a fresh login — refreshPlayerAuth found an already-logged-in
    // player with no code yet (see needsPinSetup in routes/player.js) and
    // is sending them straight back here, skipping the phone/pin steps
    // entirely since they're not relevant right now.
    pinSetupMandatory = true;
    otpClear('player-login-set-pin-input');
    otpClear('player-login-set-pin-confirm-input');
    setPinErrorEl.textContent = '';
    showStep(setPinStep);
    setTimeout(() => otpFocus('player-login-set-pin-input'), 50);
  } else {
    showStep(formStep);
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (!code) return;
    errorEl.textContent = '';
    registerPromptEl.style.display = 'none';
    input.disabled = true;
    submitBtn.disabled = true;
    try {
      const res = await api('/player/login', { method: 'POST', body: { code } });
      applySession(res);
      if (res.pinSetupRequired) {
        enteredPhone = code;
        pinSetupMandatory = true;
        otpClear('player-login-set-pin-input');
        otpClear('player-login-set-pin-confirm-input');
        setPinErrorEl.textContent = '';
        showStep(setPinStep);
        setTimeout(() => otpFocus('player-login-set-pin-input'), 50);
      } else {
        // Confirm who just logged in instead of closing silently — see
        // showSuccess; the modal only actually closes (and hands off to
        // onSuccess, continuing whatever action prompted this login) once
        // the player acknowledges it via the OK button below.
        showSuccess();
      }
    } catch (err) {
      // pinRequired and locked both land here (a locked account still 401s
      // with pinRequired unset, but showing the pin step either way is
      // right — the "Forgot your code?" link on it is exactly what a
      // locked-out player needs, and the error text itself explains why).
      if (err.data && (err.data.pinRequired || err.data.locked)) {
        enteredPhone = code;
        otpClear('player-login-pin-input');
        pinErrorEl.textContent = err.data.locked ? loginErrorText(err) : '';
        showStep(pinStep);
        setTimeout(() => otpFocus('player-login-pin-input'), 50);
      } else {
        errorEl.textContent = loginErrorText(err);
        // notFound means this genuinely looks like a phone number, just
        // not a registered one — offer self-registration instead of a
        // dead end (see the login route's contract in routes/player.js).
        if (err.data && err.data.notFound) {
          enteredPhone = code;
          registerPromptEl.style.display = '';
        }
        input.focus();
      }
    }
    input.disabled = false;
    submitBtn.disabled = false;
  };

  registerLink.onclick = (e) => {
    e.preventDefault();
    registerNameInput.value = '';
    registerEmailInput.value = '';
    registerErrorEl.textContent = '';
    showStep(registerStep);
    setTimeout(() => registerNameInput.focus(), 50);
  };

  registerForm.onsubmit = async (e) => {
    e.preventDefault();
    const name = registerNameInput.value.trim();
    const email = registerEmailInput.value.trim();
    if (!name || !email) return;
    registerErrorEl.textContent = '';
    registerSubmitBtn.disabled = true;
    try {
      const res = await api('/player/register', { method: 'POST', body: { name, email, phone: enteredPhone } });
      applySession(res);
      // Same landing spot a pinSetupRequired login uses — registering and
      // a first login both end with "now create your code".
      otpClear('player-login-set-pin-input');
      otpClear('player-login-set-pin-confirm-input');
      setPinErrorEl.textContent = '';
      showStep(setPinStep);
      setTimeout(() => otpFocus('player-login-set-pin-input'), 50);
    } catch (err) {
      registerErrorEl.textContent = loginErrorText(err);
    }
    registerSubmitBtn.disabled = false;
  };

  registerBackBtn.onclick = () => {
    showStep(formStep);
    setTimeout(() => input.focus(), 50);
  };

  pinForm.onsubmit = async (e) => {
    e.preventDefault();
    const pin = pinInput.value.trim();
    if (!pin) return;
    pinErrorEl.textContent = '';
    otpSetDisabled('player-login-pin-input', true);
    pinSubmitBtn.disabled = true;
    try {
      const res = await api('/player/login', { method: 'POST', body: { code: enteredPhone, pin } });
      applySession(res);
      showSuccess();
    } catch (err) {
      pinErrorEl.textContent = loginErrorText(err);
      otpClear('player-login-pin-input');
      otpFocus('player-login-pin-input');
    }
    otpSetDisabled('player-login-pin-input', false);
    pinSubmitBtn.disabled = false;
  };

  // Back to the phone step — e.g. the phone number itself was mistyped and
  // this isn't actually their code to enter.
  pinBackBtn.onclick = () => {
    errorEl.textContent = '';
    input.value = '';
    showStep(formStep);
    setTimeout(() => input.focus(), 50);
  };

  setPinForm.onsubmit = async (e) => {
    e.preventDefault();
    const pin = setPinInput.value.trim();
    const confirmPin = setPinConfirmInput.value.trim();
    if (!pin || !confirmPin) return;
    setPinErrorEl.textContent = '';
    setPinSubmitBtn.disabled = true;
    try {
      await api('/player/set-pin', { method: 'POST', body: { pin, confirmPin } });
      pinSetupMandatory = false;
      showSuccess();
    } catch (err) {
      setPinErrorEl.textContent = loginErrorText(err);
    }
    setPinSubmitBtn.disabled = false;
  };

  // "Forgot your code?" — reuses the phone number already entered on the
  // form step (see enteredPhone above), so there's nothing new to type
  // before this fires. The server tells us which of the two outcomes
  // applies (an email on file to send a reset link to, or not); either
  // way this never logs the player in by itself — that only happens once
  // they actually follow the emailed link (POST /player/reset-pin, on the
  // dedicated public/reset-code.html page) or an admin resets it.
  forgotLink.onclick = async (e) => {
    e.preventDefault();
    forgotErrorEl.textContent = '';
    forgotLoading.style.display = '';
    forgotEmailSent.style.display = 'none';
    forgotNoEmail.style.display = 'none';
    requestAdminBtn.style.display = '';
    requestAdminBtn.disabled = false;
    requestAdminSentEl.style.display = 'none';
    showStep(forgotStep);
    try {
      const res = await api('/player/forgot-pin', { method: 'POST', body: { code: enteredPhone } });
      forgotLoading.style.display = 'none';
      if (res.noEmail) forgotNoEmail.style.display = '';
      else forgotEmailSent.style.display = '';
    } catch (err) {
      forgotLoading.style.display = 'none';
      forgotErrorEl.textContent = loginErrorText(err);
    }
  };

  requestAdminBtn.onclick = async () => {
    requestAdminBtn.disabled = true;
    try {
      await api('/player/request-admin-reset', { method: 'POST', body: { code: enteredPhone } });
      requestAdminBtn.style.display = 'none';
      requestAdminSentEl.style.display = '';
    } catch (err) {
      requestAdminBtn.disabled = false;
      forgotErrorEl.textContent = loginErrorText(err);
    }
  };

  forgotBackBtn.onclick = () => {
    showStep(pinStep);
    setTimeout(() => otpFocus('player-login-pin-input'), 50);
  };

  document.getElementById('player-login-ok-btn').onclick = () => {
    modal.style.display = 'none';
    if (onSuccess) onSuccess();
  };

  modal.style.display = 'flex';
  // The startAtSetPin branch above already showed its own step and
  // focused its own field — focusing the (now-hidden) phone input here
  // too would just steal it back.
  if (!(opts && opts.startAtSetPin)) setTimeout(() => input.focus(), 50);
}

// Closing the modal while pinSetupMandatory is true (the X button or
// clicking the backdrop — both already close the modal via the generic
// [data-close]/.modal-backdrop handlers up top; this just runs alongside
// them) means walking away without creating a code, which would otherwise
// leave the player sitting fully logged in with no code, indefinitely —
// exactly the stuck state needsPinSetup/refreshPlayerAuth above exists to
// prevent. Logging them out here closes that loophole for the current
// page; the recheck on every other page load closes it for good.
async function forceLogoutFromPinSetup() {
  if (!pinSetupMandatory) return;
  pinSetupMandatory = false;
  try { await api('/player/logout', { method: 'POST' }); } catch { /* ignore */ }
  playerAuthed = false;
  currentPlayerName = null;
  currentPlayerId = null;
  updatePlayerNavLinks();
  window.dispatchEvent(new Event('blta:auth-changed'));
}
document.querySelectorAll('#player-login-modal [data-close]').forEach((el) => {
  el.addEventListener('click', forceLogoutFromPinSetup);
});
const playerLoginModalEl = document.getElementById('player-login-modal');
if (playerLoginModalEl) {
  playerLoginModalEl.addEventListener('click', (e) => {
    if (e.target.id === 'player-login-modal') forceLogoutFromPinSetup();
  });
}

// Runs onReady immediately if already logged in (as a real player or
// admin), otherwise shows the login popup first and runs onReady only
// after a successful login. Getting past this gate doesn't guarantee the
// server will actually allow the action — the real per-match ownership
// check happens server-side, with the error surfaced back through the
// normal toast(err.message) path.
function requirePlayerAuth(onReady) {
  if (playerAuthed) { onReady(); return; }
  openPlayerLoginModal(onReady);
}

document.querySelectorAll('.player-login-link').forEach((el) => {
  el.addEventListener('click', async (e) => {
    e.preventDefault();
    if (playerAuthed) {
      try { await api('/player/logout', { method: 'POST' }); } catch { /* ignore */ }
      playerAuthed = false;
      currentPlayerName = null;
      currentPlayerId = null;
      updatePlayerNavLinks();
      window.dispatchEvent(new Event('blta:auth-changed'));
      toast('Logged out');
    } else {
      openPlayerLoginModal();
    }
  });
});

refreshPlayerAuth();

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  return Promise.resolve();
}

// Registered on every real page but not inside the embed widget — an iframe
// embedded on someone else's site has no business becoming its own
// installable app.
if ('serviceWorker' in navigator && !document.body.classList.contains('embed')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* not fatal — installability just won't work */ });
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// Subscribes this browser to push notifications for one match/type —
// mirrors the email-based /notify-me flow. Throws a user-facing message on
// any failure (unsupported browser, permission denied, no VAPID key
// configured server-side, etc).
async function subscribeToPush(matchToken, type) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error("This browser doesn't support push notifications.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }
  const { publicKey } = await api('/push/vapid-public-key');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api(`/matches/${matchToken}/push-subscribe`, { method: 'POST', body: { subscription: subscription.toJSON(), type } });
}

// Reveals the "Manage badges" footer link only for a logged-in admin —
// hidden by default in the HTML so it never flashes visible for everyone
// else while this check is in flight.
if (!document.body.classList.contains('embed')) {
  checkAdmin().then((isAdminUser) => {
    if (!isAdminUser) return;
    document.querySelectorAll('.footer-badges-link').forEach((el) => { el.style.display = ''; });
  });
}

// "Install app" — a single button that does two different things
// depending on the platform, because there's no single API that covers
// both: Android/Chrome supports a real one-tap install via
// beforeinstallprompt; iOS Safari has no install API at all (Apple
// doesn't expose one), so the only thing a website can do there is show
// the manual Share -> Add to Home Screen steps.
(function initInstallPrompt() {
  if (document.body.classList.contains('embed')) return;
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone) return; // already installed — nothing to offer

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'install-app-btn';
  btn.textContent = '📲 Install app';
  btn.style.display = 'none';
  navLinks.appendChild(btn);

  if (isIOS) {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'install-ios-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="modal" style="max-width:340px;text-align:center">
        <button type="button" class="close" data-close="install-ios-modal" aria-label="Close">&times;</button>
        <h3 style="margin-top:0">Install BLTA Score</h3>
        <p style="color:var(--gray);font-size:14px;text-align:left">
          1. Tap the <strong>Share</strong> button in Safari's toolbar<br><br>
          2. Scroll down and tap <strong>Add to Home Screen</strong><br><br>
          3. Tap <strong>Add</strong>
        </p>
      </div>
    `;
    document.body.appendChild(modal);
    // The generic [data-close]/.modal-backdrop listeners above already ran
    // by the time this modal exists, so it needs its own close wiring.
    modal.querySelector('[data-close]').addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    btn.style.display = '';
    btn.addEventListener('click', () => { modal.style.display = 'flex'; });
  } else {
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      btn.style.display = '';
    });
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      btn.disabled = true;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      btn.style.display = 'none';
      btn.disabled = false;
    });
    window.addEventListener('appinstalled', () => { btn.style.display = 'none'; });
  }
})();

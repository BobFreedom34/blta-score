// Part of common.js (loaded after it): date and time inputs, the match edit modal, player and venue autocomplete, courts, the pickers and the propose-times fields.

const CATEGORY_LABELS = { ELITE: 'BLTA ELITE', NEXT_GEN: 'BLTA NEXT GEN', NOVICE: 'BLTA NOVICE', FRIENDLY: 'FRIENDLY', VIP_CUP: 'VIP CUP', ATA_TENNIS: 'ATA TENNIS', OTHER: 'OTHER' };
// The three official league categories — everything else (FRIENDLY, VIP_CUP) is a non-league match.
const BLTA_CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const STATUS_LABELS = { PLANNED: 'Planned', LIVE: 'Live', FINISHED: 'Finished', UNFINISHED: 'Unfinished' };
const END_REASON_LABELS = { WALKOVER: 'Walkover', RETIREMENT: 'Retirement', UNFINISHED: 'Left unfinished' };
function endReasonLabel(reason) {
  return END_REASON_LABELS[reason] ? t(`common.endReason.${reason}`) : null;
}

// Shared by player.js (profile avatar fallback) and players.js (list row
// mini avatar) — first + last initial, uppercased.
function initials(name) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ? parts[0][0] : '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Shared by match.js (per-match date/time edit fields) and any page that
// opens a match-editing modal of its own (see openQuickEditMatchModal
// below) — <input type="date">/.time-input want the local wall-clock
// date/time, not the ISO string's UTC one.
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

// .time-input fields (every match date/time form) used to be a plain
// <input type="time">, but on Android Chrome tapping into one only opens
// the clock-face picker dialog — there's no way to type the hour/minute
// digits with the keyboard like you can on desktop. This reproduces the
// same "HH:MM" value contract with a plain text field so typing works
// identically on every platform, but also wraps it with a small clock
// button that opens a real (hidden) <input type="time">'s native picker —
// so the picker is still there for whoever wants to tap-and-scroll
// instead of typing, same as before.
function setupTimeInputs() {
  document.querySelectorAll('input.time-input').forEach((input) => {
    if (input.dataset.timeInputReady) return;
    input.dataset.timeInputReady = '1';

    const wrap = document.createElement('div');
    wrap.className = 'time-input-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const nativeInput = document.createElement('input');
    nativeInput.type = 'time';
    nativeInput.className = 'time-input-native';
    nativeInput.tabIndex = -1;
    nativeInput.setAttribute('aria-hidden', 'true');
    wrap.appendChild(nativeInput);

    const pickerBtn = document.createElement('button');
    pickerBtn.type = 'button';
    pickerBtn.className = 'time-input-picker-btn';
    pickerBtn.setAttribute('aria-label', t('common.pickTime'));
    pickerBtn.textContent = '🕐';
    wrap.appendChild(pickerBtn);

    pickerBtn.addEventListener('click', () => {
      nativeInput.value = /^\d{2}:\d{2}$/.test(input.value) ? input.value : '';
      if (typeof nativeInput.showPicker === 'function') {
        try { nativeInput.showPicker(); return; } catch (e) { /* fall through */ }
      }
      nativeInput.focus();
      nativeInput.click();
    });
    nativeInput.addEventListener('change', () => {
      input.value = nativeInput.value;
    });

    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '').slice(0, 4);
      input.value = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
    });
    input.addEventListener('blur', () => {
      const digits = input.value.replace(/\D/g, '');
      if (!digits) { input.value = ''; return; }
      const hh = Math.min(23, parseInt(digits.slice(0, 2), 10) || 0);
      const mm = Math.min(59, parseInt(digits.slice(2, 4), 10) || 0);
      input.value = `${pad(hh)}:${pad(mm)}`;
    });
  });
}
setupTimeInputs();

// Shared by bracket.js (public draw display) and bracket-admin.js (slot
// management) — the last three rounds of any bracket have fixed names
// regardless of draw size; anything earlier than that just counts up.
// The name of a round of a bracket. With a preliminary round (prelim) round 1 is "Predkolo" and the round after it is "1. kolo".
function bracketRoundLabel(round, totalRounds, prelim) {
  if (prelim && round === 1) return t('bracket.prelim');
  if (round === totalRounds) return t('bracket.final');
  if (round === totalRounds - 1) return t('bracket.semi');
  if (round === totalRounds - 2) return t('bracket.quarter');
  return t('bracket.roundN', { n: prelim ? round - 1 : round });
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
  { key: 'BO1_G6_TB5' },
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
  // A save disables the button while it runs and only a failed save enables it again, while this one modal (one piece of markup on the page) opens again and again:
  // without this, after one successful save every next opening showed "Uložiť zmeny" greyed out.
  const saveBtn = document.querySelector('#edit-match-form button[type="submit"]');
  if (saveBtn) saveBtn.disabled = false;

  // Reassigning who's actually in the match is admin-only (see the doc
  // comment on the modal's markup) — everyone else never sees the field,
  // same as the format field hides for a status where it can't apply.
  const playersField = document.getElementById('edit-match-players-field');
  if (playersField) {
    // a doubles match keeps its four players (the server refuses a change), so nobody edits them here
    playersField.style.display = isAdminUser && !m.isDoubles ? '' : 'none';
    if (isAdminUser && !m.isDoubles) {
      if (!allPlayers.length) await loadPlayers();
      document.getElementById('edit-match-player1').value = m.player1.name;
      document.getElementById('edit-match-player2').value = m.player2.name;
    }
  }

  document.getElementById('edit-match-category').value = m.category;
  const dateInput = document.getElementById('edit-match-date');
  const timeInput = document.getElementById('edit-match-time');
  dateInput.value = toDateValue(m.scheduledAt);
  timeInput.value = toTimeValue(m.scheduledAt);
  document.getElementById('edit-match-location').value = m.location || '';
  document.getElementById('edit-match-notes').value = m.notes || '';

  // Unscheduling isn't just "clear the date field and save" without any
  // prompt for it — an empty date input has no visible affordance for
  // that (no obvious way to blank a native date picker, especially on
  // mobile), so this button does it explicitly instead. Only shown once
  // there's actually a date to clear, and kept in sync as the field
  // itself changes rather than fixed to whatever it was when the modal
  // opened — save (below) already treats an empty date the same way
  // (scheduledAt: null), this is just what makes that reachable at all.
  const clearDateBtn = document.getElementById('edit-match-clear-date');
  if (clearDateBtn) {
    const syncClearDateBtn = () => { clearDateBtn.style.display = dateInput.value ? '' : 'none'; };
    syncClearDateBtn();
    dateInput.oninput = syncClearDateBtn;
    clearDateBtn.onclick = () => {
      dateInput.value = '';
      timeInput.value = '';
      syncClearDateBtn();
    };
  }

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
    if (isAdminUser && playersField && playersField.style.display !== 'none') {
      const name1 = document.getElementById('edit-match-player1').value.trim();
      const name2 = document.getElementById('edit-match-player2').value.trim();
      const p1 = findPlayerByTypedName(name1);
      const p2 = findPlayerByTypedName(name2);
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
// getNames defaults to the player-name list; pass another function to
// suggest something else (see setupVenueAutocomplete).
function setupAutocomplete(inputId, listId, getNames = () => allPlayers.map((p) => p.name)) {
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
    const q = input.value.trim();
    if (!q) return [];
    const first = searchTokens(q)[0] || '';
    const rank = (name) => {
      const words = searchTokens(name);
      if (words.join(' ').startsWith(searchTokens(q).join(' '))) return 0;
      return words.some((w) => w.startsWith(first)) ? 1 : 2;
    };
    return getNames()
      .filter((name) => matchesQuery(name, q))
      .map((name, i) => ({ name, i, r: rank(name) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .slice(0, 8)
      .map((x) => x.name);
  }

  function render() {
    const matches = currentMatches();
    list.innerHTML = matches.map((p, i) => `
      <div class="autocomplete-item${i === activeIndex ? ' active' : ''}" data-name="${escapeHtml(p)}">${highlightMatch(p, input.value)}</div>
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

// A name as HTML with the typed words in bold ("podh" in "Tomáš Podhorný"): accents, capitals and apostrophes are ignored when
// looking for them, the text itself is shown as it is.
function highlightMatch(name, query) {
  const text = String(name || '');
  const tokens = searchTokens(query);
  if (!tokens.length) return escapeHtml(text);
  let folded = '';
  const origin = []; // folded index -> index in the text
  [...text].forEach((ch, i) => {
    const f = foldText(ch).replace(/['’`´]/g, '');
    for (let k = 0; k < f.length; k += 1) origin.push(i);
    folded += f;
  });
  const marked = new Set();
  tokens.forEach((tok) => {
    let at = folded.indexOf(tok);
    while (at !== -1) {
      for (let k = at; k < at + tok.length; k += 1) marked.add(origin[k]);
      at = folded.indexOf(tok, at + tok.length);
    }
  });
  const chars = [...text];
  let html = '';
  let open = false;
  chars.forEach((ch, i) => {
    const on = marked.has(i);
    if (on && !open) { html += '<b>'; open = true; }
    if (!on && open) { html += '</b>'; open = false; }
    html += escapeHtml(ch);
  });
  return open ? `${html}</b>` : html;
}

// Wired once here (not inside openEditMatchModal, which runs every time the
// modal opens) — same one-shot-at-load pattern new-match.js uses for its own
// player1/player2 fields. setupAutocomplete's own guard above makes this a
// no-op on any page without the admin-only players field in its modal
// markup.
setupAutocomplete('edit-match-player1', 'edit-match-player1-suggestions');
setupAutocomplete('edit-match-player2', 'edit-match-player2-suggestions');

// Admin-managed tennis venues (/venues-admin) suggested while typing a
// match's location. The location itself stays free text — these are only
// suggestions, so a place that isn't in the list can still be typed in.
let venueNames = [];
let venuesRequested = false;
function loadVenues() {
  if (venuesRequested) return;
  venuesRequested = true;
  api('/venues').then((rows) => { venueNames = rows.map((v) => v.name); }).catch(() => { venuesRequested = false; });
}

// Wraps an existing plain text input in an autocomplete container on the
// fly, so each page's markup doesn't need its own suggestion-list div.
function setupVenueAutocomplete(inputId) {
  const input = document.getElementById(inputId);
  if (!input || input.dataset.venueAutocomplete) return;
  input.dataset.venueAutocomplete = '1';
  const wrap = document.createElement('div');
  wrap.className = 'autocomplete';
  if (input.style.flex) wrap.style.flex = input.style.flex;
  const list = document.createElement('div');
  list.className = 'autocomplete-list';
  list.id = `${inputId}-venue-suggestions`;
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  wrap.appendChild(list);
  loadVenues();
  setupAutocomplete(inputId, list.id, () => venueNames);
}

['location', 'start-schedule-location', 'manual-result-location', 'edit-match-location', 'modal-venue-input']
  .forEach(setupVenueAutocomplete);

// ---------- Venue display helpers (/courts and /courts/<slug>) ----------

// Slovak has three plural forms (1 kurt / 2–4 kurty / 5+ kurtov).
function courtsCountLabel(n) {
  const key = currentLang === 'sk'
    ? (n === 1 ? 'one' : (n >= 2 && n <= 4 ? 'few' : 'many'))
    : (n === 1 ? 'one' : 'few');
  return t(`courts.count.${key}`, { count: n });
}

// Outline icons (Feather-style paths) for the Courts pages.
const COURT_ICON_PATHS = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  group: '<path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="m22 6-10 7L2 6"/>',
  arrow: '<path d="M7 17 17 7"/><path d="M7 7h10v10"/>',
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><path d="M17.5 6.5h.01"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  price: '<path d="M18 7c-1.2-1.6-3-2.5-5-2.5a6.5 6.5 0 0 0 0 13c2 0 3.8-.9 5-2.5"/><path d="M4 10h9"/><path d="M4 14h9"/>',
  ball: '<circle cx="12" cy="12" r="10"/><path d="M5 5c3.5 3.5 3.5 10.5 0 14"/><path d="M19 5c-3.5 3.5-3.5 10.5 0 14"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  calendarPlus: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4"/>',
  live: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  pauseCircle: '<circle cx="12" cy="12" r="10"/><path d="M10 15V9M14 15V9"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  directions: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  userCheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
  playCircle: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4z"/>',
  restart: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  stopCircle: '<circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 14h6M9 18h4"/>',
  message: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  barChart: '<path d="M12 20V10M18 20V4M6 20v-4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  logIn: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  logOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  video: '<path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  trendUp: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/>',
  surface: '<path d="M3 17h18"/><path d="M5 17 9 7h6l4 10"/><path d="M12 7v10"/>',
  trendDown: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
};

function courtIcon(name) {
  return `<svg class="venue-icon" data-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${COURT_ICON_PATHS[name]}</svg>`;
}

// Section headings of the match lists (Live / Scheduled / Planned / Finished / Unfinished).
const MATCH_HEADING_ICONS = { liveHeading: 'live', scheduledHeading: 'calendar', plannedHeading: 'clock', finishedHeading: 'checkCircle', unfinishedHeading: 'pauseCircle' };
function matchHeadingHtml(key) {
  return `<span class="match-heading-label">${courtIcon(MATCH_HEADING_ICONS[key])}${t(`matches.${key}`)}</span>`;
}

function venueHasIndoor(v) { return v.courtType === 'INDOOR' || v.courtType === 'BOTH'; }
function venueHasOutdoor(v) { return v.courtType === 'OUTDOOR' || v.courtType === 'BOTH'; }

// A phone field can hold several numbers ("a / b"); the tel: link dials the first.
function venueTelHref(phone) {
  const first = String(phone).split(/\s\/\s|,|;/)[0];
  return `tel:${first.replace(/[^\d+]/g, '')}`;
}

function venueMapsUrl(v) {
  const query = v.lat != null && v.lng != null ? `${v.lat},${v.lng}` : (v.address || v.name);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function venueHostLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// Diacritic- and case-insensitive, so "ruzinov" finds "Ružinov".
function foldText(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Search and name matching that forgives how people type: capitals, accents, punctuation, extra spaces and word order
// ("szalay jan" finds "Jan Szalay", "tomas" finds "Tomáš"). Mirrors src/nameMatch.js on the server.
const SEARCH_SPECIAL = { 'ł': 'l', 'đ': 'd', 'ø': 'o', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ð': 'd', 'þ': 'th' };
function searchTokens(text) {
  return foldText(text)
    .replace(/[łđøßæœðþ]/g, (c) => SEARCH_SPECIAL[c])
    .replace(/['’`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}
// every word typed appears somewhere in the text, in any order
function matchesQuery(text, query) {
  const q = searchTokens(query);
  if (!q.length) return true;
  const hay = searchTokens(text).join(' ');
  return q.every((tok) => hay.includes(tok));
}
function nameKey(text) {
  return searchTokens(text).sort().join(' ');
}
// The existing player a typed name means: the same name, or the same once accents/capitals/word order are ignored
// (the oldest one when an old duplicate exists). null when it matches nobody.
function findPlayerByTypedName(name) {
  const lower = String(name || '').trim().toLowerCase();
  if (!lower) return null;
  const exact = allPlayers.find((p) => p.name.toLowerCase() === lower);
  if (exact) return exact;
  const key = nameKey(name);
  if (!key) return null;
  return allPlayers.filter((p) => nameKey(p.name) === key).sort((a, b) => a.id - b.id)[0] || null;
}

function venueChipsHtml(v) {
  const chips = [];
  if (v.courtType) chips.push(`<span class="court-chip court-chip-type">${escapeHtml(t(`courtType.${v.courtType}`))}</span>`);
  if (v.courtsCount) chips.push(`<span class="court-chip">${escapeHtml(courtsCountLabel(v.courtsCount))}</span>`);
  if (v.surfaces && v.surfaces.length) chips.push(`<span class="court-chip">${escapeHtml(v.surfaces.map((s) => t(`surface.${s}`)).join(', '))}</span>`);
  return chips.join('');
}

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
  const END_HOUR = 22; // exclusive — last slot starts at 21:30
  const STEP_MIN = 30;
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

  // Every half-hour mark between START_HOUR and END_HOUR, as {hour, minute}
  // pairs — same shape and step as looking-to-play.js's own ltpTimeSteps,
  // kept as a separate copy rather than a shared import for the same
  // reason this whole picker stays its own fork of that page's (see the
  // comment above): this one starts the day window tomorrow, not today.
  function timeSteps() {
    const steps = [];
    for (let mins = START_HOUR * 60; mins < END_HOUR * 60; mins += STEP_MIN) {
      steps.push({ hour: Math.floor(mins / 60), minute: mins % 60 });
    }
    return steps;
  }

  function slotIso(day, step) {
    const d = new Date(day);
    d.setHours(step.hour, step.minute, 0, 0);
    return d.toISOString();
  }

  function updateSlotCount() {
    const el = document.getElementById(slotCountId);
    if (el) el.textContent = selectedSlots.size ? t('match.slotsSelected', { count: selectedSlots.size }) : '';
  }

  function renderWeekTabs() {
    const fmt = (d) => `${d.getDate()} ${monthShort(d)}`;
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
    const dayHead = (d) => `${weekdayShort(d)}<br>${d.getDate()}.${d.getMonth() + 1}`;
    // avail-grid-compact: same treatment as looking-to-play.js's own
    // half-hour grid (style.css) — double the rows of the old whole-hour
    // version needs the shorter row height to keep the grid from doubling
    // in height; only the on-the-hour row gets a label and heavier top
    // edge (.hour-start), the half-hour row in between stays unlabeled
    // (an hour mark is enough to scan by) but is just as selectable, and
    // shows its own exact time once picked (see .avail-cell-time).
    let html = '<div class="availability-grid avail-grid-compact"><div class="avail-corner"></div>';
    for (const d of days) html += `<div class="avail-day-head">${dayHead(d)}</div>`;
    timeSteps().forEach((step) => {
      const onHour = step.minute === 0;
      html += `<div class="avail-time-label${onHour ? ' hour-start' : ''}">${onHour ? `${String(step.hour).padStart(2, '0')}:00` : ''}</div>`;
      for (const d of days) {
        const iso = slotIso(d, step);
        const isSelected = selectedSlots.has(iso);
        html += `<div class="avail-cell${isSelected ? ' selected' : ''}${onHour ? ' hour-start' : ''}" data-iso="${iso}">${isSelected ? `<span class="avail-cell-time">${hhmm(new Date(iso))}</span>` : ''}</div>`;
      }
    });
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
      // innerHTML (not just the class) so the cell's own avail-cell-time
      // label (see renderGrid above) stays in sync during a drag, without
      // a full renderGrid() re-render on every cell painted over.
      if (paintValue) {
        selectedSlots.add(cell.dataset.iso);
        cell.classList.add('selected');
        cell.innerHTML = `<span class="avail-cell-time">${hhmm(new Date(cell.dataset.iso))}</span>`;
      } else {
        selectedSlots.delete(cell.dataset.iso);
        cell.classList.remove('selected');
        cell.innerHTML = '';
      }
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

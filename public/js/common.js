const CATEGORY_LABELS = { ELITE: 'BLTA ELITE', NEXT_GEN: 'BLTA NEXT GEN', NOVICE: 'BLTA NOVICE', FRIENDLY: 'FRIENDLY', VIP_CUP: 'VIP CUP', ATA_TENNIS: 'ATA TENNIS' };
// The three official league categories — everything else (FRIENDLY, VIP_CUP) is a non-league match.
const BLTA_CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const STATUS_LABELS = { PLANNED: 'Planned', LIVE: 'Live', FINISHED: 'Finished', UNFINISHED: 'Unfinished' };
const END_REASON_LABELS = { WALKOVER: 'Walkover', RETIREMENT: 'Retirement', UNFINISHED: 'Left unfinished' };
function endReasonLabel(reason) {
  return END_REASON_LABELS[reason] ? t(`common.endReason.${reason}`) : null;
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

let allPlayers = [];
async function loadPlayers() {
  try { allPlayers = await api('/players'); } catch { allPlayers = []; }
}

// Custom autocomplete instead of a native <datalist>, which mobile Safari in
// particular renders inconsistently (often not showing suggestions at all).
function setupAutocomplete(inputId, listId) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
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
function setCell(set, playerNum) {
  const gKey = playerNum === 1 ? 'p1' : 'p2';
  if (set.isSuperTiebreak) return `${set.tiebreak[gKey]}`;
  const main = set[gKey];
  const sub = set.tiebreak ? `<sup class="sub-tb">${set.tiebreak[gKey]}</sup>` : '';
  return `${main}${sub}`;
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

// A player's name inside a match card — clickable to their profile page,
// same not-a-real-<a> nav trick as playerInfoBtn above (and for the same
// reason: it sits inside the card's own <a>).
function playerNameLink(player) {
  const playerPath = player.slug || player.id;
  const nav = window.top === window.self
    ? `window.location.href='/player/${playerPath}'`
    : `window.open('/player/${playerPath}','_blank')`;
  return `<span class="player-name-link" onclick="event.preventDefault();event.stopPropagation();${nav}">${escapeHtml(player.name)}</span>`;
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
  return `<svg class="balls-icon" viewBox="0 0 24 24" title="${escapeHtml(t('common.bringsBallsTitle'))}">
    <circle cx="12" cy="12" r="11" fill="#d4ee4e" stroke="#a8c93a" stroke-width="1"/>
    <path d="M3 6c3.2 2.6 3.2 8.8 0 12" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M21 6c-3.2 2.6-3.2 8.8 0 12" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </svg>`;
}

// Compact per-set scoreboard for a match card (LIVE/FINISHED) — same dark
// table as the full match page, just condensed, with the same timer chip in
// its header cell. For a LIVE match this always shows (even at a fresh
// 0-0, matching the match page itself) since the clock is already running;
// for FINISHED it only shows once there's real per-set score data, so a
// walkover/retirement result still falls back to the plain text line.
function cardScoreboardHtml(m) {
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
        <table>
          <tbody>
            <tr class="${winnerP1 ? 'winner-row' : ''}"><td class="name-cell">${playerNameLink(m.player1)}${playerInfoBtn(m.player1)}</td></tr>
            <tr class="${winnerP2 ? 'winner-row' : ''}"><td class="name-cell">${playerNameLink(m.player2)}${playerInfoBtn(m.player2)}</td></tr>
          </tbody>
        </table>
        ${reasonLabel ? `<div class="scoreboard-reason">${escapeHtml(reasonLabel)}</div>` : ''}
      </div>
    `;
  }
  const headerCells = sets.map((s, i) => `<th>${s.isSuperTiebreak ? 'MTB' : `S${i + 1}`}</th>`).join('');
  const row = (playerNum, player, isWinner) => {
    const cells = sets.map((s) => `<td class="set-score">${setCell(s, playerNum)}</td>`).join('');
    return `<tr class="${isWinner ? 'winner-row' : ''}"><td class="name-cell">${playerNameLink(player)}${playerInfoBtn(player)}</td>${cells}</tr>`;
  };
  return `
    <div class="scoreboard scoreboard-compact">
      <table>
        <thead><tr><th class="timer-cell">${cardDurationHtml(m)}</th>${headerCells}</tr></thead>
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

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
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
  return `
    <a class="compact-card status-${m.status}" href="${window.location.origin}/match/${m.token}"${window.top !== window.self ? ' target="_blank" rel="noopener"' : ''}>
      <span class="compact-date">${compactDateHtml(m)}</span>
      ${categoryBadge(m.category)}
      <span class="compact-players">
        <span class="${winnerP1 ? 'winner' : ''}">${escapeHtml(m.player1.name)}${ballsIconHtml(m, 1)}</span>
        <span class="${winnerP2 ? 'winner' : ''}">${escapeHtml(m.player2.name)}${ballsIconHtml(m, 2)}</span>
      </span>
      <span class="compact-result">${matchScoreHtml(m)}</span>
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
// calls this needs the same #share-modal/#share-modal-desc/#share-link/
// #whatsapp-btn/#copy-link-btn markup.
function openShareModal(m, whatsappText, description) {
  const url = `${window.location.origin}/match/${m.token}`;
  document.getElementById('share-link').textContent = url;
  const descEl = document.getElementById('share-modal-desc');
  descEl.textContent = description || '';
  descEl.style.display = description ? '' : 'none';
  const text = whatsappText || t('share.defaultWhatsappText', { p1: m.player1.name, p2: m.player2.name });
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
// The same input also accepts ANON_CODE, a second, more limited login (see
// requireLoggedIn/checkMatchAccess in routes/matches.js) — anonAuthed
// tracks that separately since it changes what a "logged in" session can
// actually do, even though both count as "some session active" for the
// nav link and for requirePlayerAuth just letting an action through to the
// server (the server enforces the actual per-match restriction).
let playerAuthed = false;
let anonAuthed = false;
let currentPlayerName = null;
// Null for a pure admin session (no player cookie) or no session at all —
// only set once a *specific* player is logged in via their phone number.
// Pages that need to scope a button/action to "this player's own stuff"
// (see checkMatchAccess in routes/matches.js) compare against this.
let currentPlayerId = null;

function updatePlayerNavLinks() {
  document.querySelectorAll('.player-login-link').forEach((el) => {
    if (playerAuthed && currentPlayerName) el.textContent = t('nav.logoutWithName', { name: currentPlayerName });
    else if (playerAuthed || anonAuthed) el.textContent = t('nav.logout');
    else el.textContent = t('nav.loginPlayer');
  });
}

async function refreshPlayerAuth() {
  try {
    const res = await api('/player/session');
    playerAuthed = !!res.isPlayer;
    anonAuthed = !!res.isAnon;
    currentPlayerName = res.playerName || null;
    currentPlayerId = res.playerId || null;
  } catch {
    playerAuthed = false;
    anonAuthed = false;
    currentPlayerName = null;
    currentPlayerId = null;
  }
  updatePlayerNavLinks();
  // Lets any page's own script react to a login/logout finishing (e.g. the
  // homepage re-showing/hiding "Set date & location" once it knows who's
  // logged in) without common.js needing to know what each page does.
  window.dispatchEvent(new Event('blta:auth-changed'));
  return playerAuthed || anonAuthed;
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
  if (anonAuthed) return m.createdByAnonymous;
  return true;
}

function openPlayerLoginModal(onSuccess) {
  const modal = document.getElementById('player-login-modal');
  if (!modal) return;
  const formStep = document.getElementById('player-login-step-form');
  const successStep = document.getElementById('player-login-step-success');
  const form = document.getElementById('player-login-form');
  const input = document.getElementById('player-login-input');
  const errorEl = document.getElementById('player-login-error');
  const submitBtn = form.querySelector('button[type="submit"]');
  errorEl.textContent = '';
  input.value = '';
  input.disabled = false;
  formStep.style.display = '';
  successStep.style.display = 'none';

  form.onsubmit = async (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (!code) return;
    errorEl.textContent = '';
    input.disabled = true;
    submitBtn.disabled = true;
    try {
      const res = await api('/player/login', { method: 'POST', body: { code } });
      playerAuthed = !!res.isPlayer;
      anonAuthed = !!res.isAnon;
      currentPlayerName = res.playerName || null;
      currentPlayerId = res.playerId || null;
      updatePlayerNavLinks();
      window.dispatchEvent(new Event('blta:auth-changed'));
      // Confirm who just logged in instead of closing silently — the modal
      // switches to a short success step (see the two #player-login-step-*
      // panels in the modal markup) and only actually closes (and hands
      // off to onSuccess, continuing whatever action prompted this login)
      // once the player acknowledges it via the OK button below.
      document.getElementById('player-login-success-text').textContent = currentPlayerName
        ? t('login.successNamed', { name: currentPlayerName })
        : t('login.successGeneric');
      formStep.style.display = 'none';
      successStep.style.display = '';
    } catch (err) {
      errorEl.textContent = err.message;
      input.disabled = false;
      submitBtn.disabled = false;
      input.value = '';
      input.focus();
    }
  };

  document.getElementById('player-login-ok-btn').onclick = () => {
    modal.style.display = 'none';
    if (onSuccess) onSuccess();
  };

  modal.style.display = 'flex';
  setTimeout(() => input.focus(), 50);
}

// Runs onReady immediately if already logged in — as a real player, admin,
// or the limited anon tier — otherwise shows the code popup first and runs
// onReady only after a successful login. Getting past this gate doesn't
// guarantee the server will actually allow the action (an anon session
// still only owns matches it created) — that's enforced server-side, with
// the error surfaced back through the normal toast(err.message) path.
function requirePlayerAuth(onReady) {
  if (playerAuthed || anonAuthed) { onReady(); return; }
  openPlayerLoginModal(onReady);
}

document.querySelectorAll('.player-login-link').forEach((el) => {
  el.addEventListener('click', async (e) => {
    e.preventDefault();
    if (playerAuthed || anonAuthed) {
      try { await api('/player/logout', { method: 'POST' }); } catch { /* ignore */ }
      playerAuthed = false;
      anonAuthed = false;
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

const CATEGORY_LABELS = { ELITE: 'BLTA ELITE', NEXT_GEN: 'BLTA NEXT GEN', NOVICE: 'BLTA NOVICE', FRIENDLY: 'FRIENDLY', VIP_CUP: 'VIP CUP' };
const STATUS_LABELS = { PLANNED: 'Planned', LIVE: 'Live', FINISHED: 'Finished' };
const END_REASON_LABELS = { WALKOVER: 'Walkover', RETIREMENT: 'Retirement' };

// "6-4, 3-2" / "Retirement" / "6-4, 3-2 — Retirement" / "Best of 3 sets" (planned)
function matchResultText(m) {
  if (m.status === 'PLANNED') return m.formatLabel;
  const parts = [];
  if (m.scoreSummary) parts.push(m.scoreSummary);
  if (m.endReason && END_REASON_LABELS[m.endReason]) parts.push(END_REASON_LABELS[m.endReason]);
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
  const nav = window.top === window.self
    ? `window.location.href='/player/${player.id}'`
    : `window.open('/player/${player.id}','_blank')`;
  return `<button type="button" class="player-info-btn" title="View ${escapeHtml(player.name)}'s profile" onclick="event.preventDefault();event.stopPropagation();${nav}">i</button>`;
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
    const reasonLabel = m.endReason && END_REASON_LABELS[m.endReason] ? END_REASON_LABELS[m.endReason] : null;
    return `
      <div class="scoreboard scoreboard-compact">
        <table>
          <tbody>
            <tr class="${winnerP1 ? 'winner-row' : ''}"><td class="name-cell">${escapeHtml(m.player1.name)}${playerInfoBtn(m.player1)}</td></tr>
            <tr class="${winnerP2 ? 'winner-row' : ''}"><td class="name-cell">${escapeHtml(m.player2.name)}${playerInfoBtn(m.player2)}</td></tr>
          </tbody>
        </table>
        ${reasonLabel ? `<div class="scoreboard-reason">${escapeHtml(reasonLabel)}</div>` : ''}
      </div>
    `;
  }
  const headerCells = sets.map((s, i) => `<th>${s.isSuperTiebreak ? 'MTB' : `S${i + 1}`}</th>`).join('');
  const row = (playerNum, player, isWinner) => {
    const cells = sets.map((s) => `<td class="set-score">${setCell(s, playerNum)}</td>`).join('');
    return `<tr class="${isWinner ? 'winner-row' : ''}"><td class="name-cell">${escapeHtml(player.name)}${playerInfoBtn(player)}</td>${cells}</tr>`;
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

function categoryBadge(category) {
  return `<span class="badge badge-${category}">${CATEGORY_LABELS[category] || category}</span>`;
}

// Accepts either a match object (preferred, so a scheduled Planned match can
// show its date/time instead of just "Planned") or a plain status string.
function statusBadge(m) {
  const status = typeof m === 'string' ? m : m.status;
  const scheduledAt = typeof m === 'string' ? null : m.scheduledAt;
  if (status === 'PLANNED' && scheduledAt) {
    return `<span class="badge badge-status status-PLANNED-dated">${fmtDateShort(scheduledAt)}</span>`;
  }
  return `<span class="badge badge-status status-${status}">${STATUS_LABELS[status] || status}</span>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Fixed Ddd d.m.yyyy, HH:MM format (not locale-dependent) so it reads the
// same for every visitor regardless of their browser's locale settings.
function fmtDateShort(iso) {
  if (!iso) return 'Date TBD';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}, ${hh}:${mm}`;
}

function fmtDateLong(iso) {
  if (!iso) return 'Date TBD';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
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

async function checkAdmin() {
  try {
    const res = await api('/admin/session');
    return !!res.isAdmin;
  } catch {
    return false;
  }
}

// Shared "log in as player" gate: a single 4-digit code (given to every
// league player) unlocks match-creating/starting/scheduling actions without
// needing individual accounts. Lives in common.js since the popup and nav
// toggle are identical across every page.
let playerAuthed = false;

function updatePlayerNavLinks() {
  document.querySelectorAll('.player-login-link').forEach((el) => {
    el.textContent = playerAuthed ? 'LOG OUT' : 'LOG IN AS PLAYER';
  });
}

async function refreshPlayerAuth() {
  try {
    const res = await api('/player/session');
    playerAuthed = !!res.isPlayer;
  } catch {
    playerAuthed = false;
  }
  updatePlayerNavLinks();
  return playerAuthed;
}

// 4 separate one-digit boxes (like a phone-app 2FA code): typing a digit
// auto-advances to the next box, and filling the last box submits
// immediately — no separate "Log in" button to press.
function openPlayerLoginModal(onSuccess) {
  const modal = document.getElementById('player-login-modal');
  if (!modal) return;
  const form = document.getElementById('player-login-form');
  const errorEl = document.getElementById('player-login-error');
  const digits = Array.from(modal.querySelectorAll('.otp-digit'));
  errorEl.textContent = '';
  form.onsubmit = (e) => e.preventDefault();

  const submitCode = async () => {
    errorEl.textContent = '';
    digits.forEach((d) => { d.disabled = true; });
    try {
      await api('/player/login', { method: 'POST', body: { code: digits.map((d) => d.value).join('') } });
      playerAuthed = true;
      updatePlayerNavLinks();
      modal.style.display = 'none';
      if (onSuccess) onSuccess();
    } catch (err) {
      errorEl.textContent = err.message;
      digits.forEach((d) => { d.value = ''; d.disabled = false; });
      digits[0].focus();
    }
  };

  // Boxes intentionally aren't maxlength=1 — a fast typist, an OS-level
  // autofill suggestion, or this same automated test can land more than one
  // digit in a box in a single input event, and the browser would silently
  // drop the extra characters before we ever saw them if maxlength trimmed
  // it first. Instead every digit that shows up gets distributed forward
  // from whichever box received it.
  digits.forEach((input, i) => {
    input.value = '';
    input.disabled = false;
    input.oninput = () => {
      const raw = input.value.replace(/\D/g, '');
      let idx = i;
      for (const ch of raw) {
        if (idx >= digits.length) break;
        digits[idx].value = ch;
        idx += 1;
      }
      if (!raw) input.value = '';
      digits[Math.min(idx, digits.length - 1)].focus();
      if (digits.every((d) => d.value)) submitCode();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Backspace' && !input.value && i > 0) digits[i - 1].focus();
    };
    input.onpaste = (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      if (!text) return;
      digits.forEach((d, idx) => { d.value = text[idx] || ''; });
      (digits.find((d) => !d.value) || digits[digits.length - 1]).focus();
      if (digits.every((d) => d.value)) submitCode();
    };
  });

  modal.style.display = 'flex';
  setTimeout(() => digits[0].focus(), 50);
}

// Runs onReady immediately if already logged in as a player (or admin,
// which counts as a player everywhere) — otherwise shows the code popup
// first and runs onReady only after a successful login.
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
      updatePlayerNavLinks();
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

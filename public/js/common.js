const CATEGORY_LABELS = { ELITE: 'ELITE', NEXT_GEN: 'NEXT GEN', NOVICE: 'NOVICE', FRIENDLY: 'FRIENDLY' };
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

// Fixed d.m.yyyy, HH:MM format (not locale-dependent) so it reads the same
// for every visitor regardless of their browser's locale settings.
function fmtDateShort(iso) {
  if (!iso) return 'Date TBD';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}, ${hh}:${mm}`;
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

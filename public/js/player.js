// The URL segment can be either the player's slug (surname-based, the
// normal case) or their old numeric id (still supported for links shared
// before slugs existed) — reassigned to the real numeric id once the
// player record loads below, since every Number(playerId) comparison in
// this file downstream needs the actual id either way.
let playerId = window.location.pathname.split('/').filter(Boolean).pop();
let currentPlayer = null;
const nameEl = document.getElementById('player-name');
const listEl = document.getElementById('player-match-list');
const resultFilterEl = document.getElementById('result-filter');
const categoryFilterEl = document.getElementById('category-filter');
const yearFilterEl = document.getElementById('year-filter');

let currentResult = '';
let currentCategory = '';
let currentYear = '';
let rawGroups = []; // last-fetched matches per GROUPS entry, unfiltered
let h2hExpanded = false;
const H2H_COLLAPSED_LIMIT = 5;

// Same card markup as the home page's match list, minus the notify actions
// (this page is a read-only history view for one player) — but the
// quick-schedule button is included, since a planned match without a date
// still needs a way to be scheduled from here.
function matchCardHtml(m) {
  const winnerP1 = m.status === 'FINISHED' && m.winnerId === m.player1.id;
  const winnerP2 = m.status === 'FINISHED' && m.winnerId === m.player2.id;
  const scoreboard = cardScoreboardHtml(m);
  return `
    <a class="match-card status-${m.status}${m.status === 'PLANNED' && m.scheduledAt ? ' has-date' : ''}" href="/match/${m.token}">
      <div class="match-card-top">
        ${categoryBadge(m.category)}
        ${statusBadge(m)}
        <div class="match-card-meta" style="margin-left:auto">
          ${m.location ? `<span>📍 ${escapeHtml(m.location)}</span>` : ''}
          ${m.status === 'PLANNED' && m.scheduledAt ? '' : `<span>🗓 ${fmtDateShort(m.scheduledAt)}</span>`}
        </div>
      </div>
      ${m.notes ? `<div class="match-card-notes">${escapeHtml(m.notes)}</div>` : ''}
      ${scoreboard || `
        <div class="match-players-box">
          <div class="match-players">
            <div>
              <div class="name ${winnerP1 ? 'winner' : ''}">${playerNameLink(m.player1)}${playerInfoBtn(m.player1)}</div>
              <div class="vs">vs</div>
              <div class="name ${winnerP2 ? 'winner' : ''}">${playerNameLink(m.player2)}${playerInfoBtn(m.player2)}</div>
            </div>
            <div class="match-score">${matchScoreHtml(m)}</div>
          </div>
        </div>
      `}
      ${isOverdueUnresolved(m) ? '<div class="overdue-warning">⚠️ Overdue — no result recorded yet</div>' : ''}
      ${m.status === 'PLANNED' && !m.scheduledAt ? `<button type="button" class="btn btn-sm btn-outline quick-schedule-btn" data-token="${m.token}" style="margin-top:6px">📅 Set date &amp; location</button>` : ''}
    </a>
  `;
}

const GROUPS = [
  { heading: '🔴 Live', params: { status: 'LIVE' } },
  { heading: '📅 Scheduled', params: { status: 'PLANNED', hasDate: '1' } },
  { heading: '🕓 Planned', params: { status: 'PLANNED', noDate: '1' } },
  { heading: '✅ Finished', params: { status: 'FINISHED' } },
  // Appended at the end, not inserted — rawGroups[3] is relied on elsewhere
  // as "the Finished group" and must keep that index.
  { heading: '⏸ Unfinished', params: { status: 'UNFINISHED' } },
];

function matchYear(m) {
  return m.scheduledAt ? new Date(m.scheduledAt).getFullYear() : null;
}

// Won/Lost only ever matches a finished match with a decided winner, so
// picking either one naturally empties (and hides) the Live/Scheduled/Not
// yet scheduled groups without any special-casing here.
function passesFilters(m) {
  if (currentResult === 'won' && m.winnerId !== Number(playerId)) return false;
  if (currentResult === 'lost' && (!m.winnerId || m.winnerId === Number(playerId))) return false;
  if (currentCategory && m.category !== currentCategory) return false;
  if (currentYear && String(matchYear(m)) !== currentYear) return false;
  return true;
}

function populateYearOptions() {
  const years = [...new Set(rawGroups.flat().filter((m) => m.scheduledAt).map(matchYear))].sort((a, b) => b - a);
  const keep = yearFilterEl.value;
  yearFilterEl.innerHTML = '<option value="">All years</option>' + years.map((y) => `<option value="${y}">${y}</option>`).join('');
  yearFilterEl.value = years.some((y) => String(y) === keep) ? keep : '';
  currentYear = yearFilterEl.value;
}

function computeRecord(matches) {
  let wins = 0;
  let losses = 0;
  matches.forEach((m) => {
    if (m.winnerId === Number(playerId)) wins += 1;
    else if (m.winnerId) losses += 1;
  });
  const played = wins + losses;
  return { played, wins, losses, pct: played ? `${Math.round((wins / played) * 100)}%` : '—' };
}

function fillStats(prefix, record) {
  document.getElementById(`stat-${prefix}-played`).textContent = record.played;
  document.getElementById(`stat-${prefix}-wl`).textContent = `${record.wins} — ${record.losses}`;
  document.getElementById(`stat-${prefix}-pct`).textContent = record.pct;
}

// Small W/L square guide for the last 20 decided matches, oldest to
// newest (most recent square on the right) — same chronological ordering
// used for the badges' win-streak calculation. Each square is a link to
// that match, with the opponent's name as a hover tooltip.
function formGuideHtml(matches) {
  const chronological = matches
    .filter((m) => m.winnerId)
    .sort((a, b) => new Date(a.scheduledAt || a.startTime || a.createdAt) - new Date(b.scheduledAt || b.startTime || b.createdAt));
  const last20 = chronological.slice(-20);
  if (!last20.length) return '';
  const squares = last20.map((m) => {
    const won = m.winnerId === Number(playerId);
    const opponent = m.player1.id === Number(playerId) ? m.player2 : m.player1;
    return `<a class="form-square ${won ? 'win' : 'loss'}" href="/match/${m.token}" title="${escapeHtml(opponent.name)}">${won ? 'W' : 'L'}</a>`;
  }).join('');
  return `<div class="form-guide-label">Last ${last20.length} game${last20.length === 1 ? '' : 's'}</div><div class="form-guide">${squares}</div>`;
}

// Sparkline of the running win rate after each decided match, oldest to
// newest — same chronological ordering as formGuideHtml(). Skipped for
// fewer than 2 decided matches, since a single point isn't a trend.
// Drawn as a wide, fixed-height chart (stretched via CSS width:100% —
// preserveAspectRatio="none" lets it fill however wide its flex container
// ends up, without letterboxing) with a quintile grid and a gradient-filled
// area under the line for a more analytical, dashboard-style look.
// idSuffix keeps the gradient's id unique since both the BLTA and All
// matches versions of this chart exist in the DOM at once (one just hidden).
function winRateTrendHtml(matches, idSuffix) {
  const chronological = matches
    .filter((m) => m.winnerId)
    .sort((a, b) => new Date(a.scheduledAt || a.startTime || a.createdAt) - new Date(b.scheduledAt || b.startTime || b.createdAt));
  if (chronological.length < 2) return '';
  let wins = 0;
  const points = chronological.map((m, i) => {
    if (m.winnerId === Number(playerId)) wins += 1;
    return Math.round((wins / (i + 1)) * 100);
  });
  const w = 280;
  const h = 64;
  const padX = 8;
  const padY = 8;
  const yFor = (pct) => padY + ((100 - pct) / 100) * (h - padY * 2);
  const stepX = (w - padX * 2) / (points.length - 1);
  const coords = points.map((pct, i) => [padX + i * stepX, yFor(pct)]);
  const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const baseline = h - padY;
  const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${baseline.toFixed(1)} `
    + `L${coords[0][0].toFixed(1)},${baseline.toFixed(1)} Z`;
  const gridLines = [25, 50, 75].map((pct) => {
    const y = yFor(pct).toFixed(1);
    return `<line x1="${padX}" y1="${y}" x2="${w - padX}" y2="${y}" stroke="rgba(255,255,255,0.12)" stroke-width="1" stroke-dasharray="3,3"/>`;
  }).join('');
  const gradId = `trend-gradient-${idSuffix}`;
  const [lastX, lastY] = coords[coords.length - 1];
  return `
    <div class="trend-sparkline">
      <div class="form-guide-label">Win rate trend</div>
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--orange)" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="var(--orange)" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${gridLines}
        <line x1="${padX}" y1="${baseline.toFixed(1)}" x2="${w - padX}" y2="${baseline.toFixed(1)}" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
        <path d="${areaPath}" fill="url(#${gradId})" stroke="none"/>
        <path d="${linePath}" fill="none" stroke="var(--orange)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3" fill="var(--orange)"/>
      </svg>
      <div class="trend-value">${points[points.length - 1]}%</div>
    </div>
  `;
}

// Career record, always computed from the full finished-match history —
// independent of the result/year filters below, which only narrow the list.
// Shown two ways: BLTA league matches only (ELITE/NEXT_GEN/NOVICE), and
// overall across every category including FRIENDLY/VIP_CUP.
function renderStats() {
  // A walkover means no tennis was actually played, so it's excluded from
  // every stat below (games played, W-L, win rate, form guide, trend) —
  // it still shows up in the plain match list further down, just not here.
  const finished = (rawGroups[3] || []).filter((m) => m.endReason !== 'WALKOVER' && m.endReason !== 'UNFINISHED');
  const bltaFinished = finished.filter((m) => BLTA_CATEGORIES.includes(m.category));
  fillStats('blta', computeRecord(bltaFinished));
  fillStats('overall', computeRecord(finished));
  document.getElementById('form-blta').innerHTML = formGuideHtml(bltaFinished);
  document.getElementById('form-overall').innerHTML = formGuideHtml(finished);
  document.getElementById('trend-blta').innerHTML = winRateTrendHtml(bltaFinished, 'blta');
  document.getElementById('trend-overall').innerHTML = winRateTrendHtml(finished, 'overall');
}

// Badge definitions are admin-managed (see /badges-admin) — fetched once
// and cached, since they don't change mid-session.
let badgeDefsCache = null;
let earnedBadgesCache = null;

// Clips the profile-page badges grid to exactly 2 visual rows by measuring
// where row 3 would start — grid columns are responsive (auto-fill), so a
// fixed badge count can't reliably mean "2 rows" at every viewport width
// the way a measured pixel height can. The "Show all badges" button always
// stays visible and opens the full-list modal instead of expanding this
// grid in place.
function applyBadgesClip() {
  const grid = document.getElementById('badges-grid');
  const items = [...grid.children];
  if (!items.length) return;
  // offsetTop is relative to the nearest *positioned* ancestor, which isn't
  // this grid — getBoundingClientRect gives positions relative to the
  // viewport instead, so diffing against the grid's own rect is reliable
  // regardless of what (if anything) up the tree is positioned.
  const gridTop = grid.getBoundingClientRect().top;
  const relTops = items.map((el) => Math.round(el.getBoundingClientRect().top - gridTop));
  const rowTops = [...new Set(relTops)].sort((a, b) => a - b);
  if (rowTops.length <= 2) {
    grid.style.maxHeight = '';
    grid.style.overflow = '';
    return;
  }
  const secondRowBottom = Math.max(...items
    .filter((el, i) => relTops[i] === rowTops[1])
    .map((el) => Math.round(el.getBoundingClientRect().bottom - gridTop)));
  grid.style.maxHeight = `${secondRowBottom}px`;
  grid.style.overflow = 'hidden';
}

// Same full finished-match history as renderStats() — badges are always
// computed from a player's whole career, not the filtered match list.
async function renderBadges() {
  if (!badgeDefsCache) badgeDefsCache = await api('/badges');
  const finished = rawGroups[3] || [];
  earnedBadgesCache = computeEarnedBadges(playerId, finished, badgeDefsCache);
  document.getElementById('badges-grid').innerHTML = badgesGridHtml(badgeDefsCache, earnedBadgesCache);
  document.getElementById('badges-ratio').textContent = badgeDefsCache.length
    ? `${earnedBadgesCache.size}/${badgeDefsCache.length}`
    : '';
  applyBadgesClip();
}

function openBadgesModal() {
  document.getElementById('badges-modal-grid').innerHTML = badgesModalGridHtml(badgeDefsCache, earnedBadgesCache);
  document.getElementById('badges-modal').style.display = 'flex';
}

// Delegated so it works for a badge clicked in either the compact profile
// grid or inside the "show all badges" modal — both use the same
// data-badge-id markup from badgeItemHtml().
document.addEventListener('click', (e) => {
  const item = e.target.closest('.badge-item');
  if (!item || !badgeDefsCache) return;
  const badge = badgeDefsCache.find((b) => b.id === Number(item.dataset.badgeId));
  if (!badge) return;
  const earned = item.dataset.earned === '1';
  document.getElementById('badge-zoom-content').innerHTML = badgeItemHtml(badge, earned, true);
  document.getElementById('badge-zoom-modal').style.display = 'flex';
});

// Per-opponent win/loss record, built from the same full finished-match
// history as renderStats() — also independent of the result/year filters.
function opponentRecords() {
  const finished = rawGroups[3] || [];
  const byOpponent = new Map();
  finished.forEach((m) => {
    if (!m.winnerId || m.endReason === 'WALKOVER' || m.endReason === 'UNFINISHED') return;
    const opponent = m.player1.id === Number(playerId) ? m.player2 : m.player1;
    const rec = byOpponent.get(opponent.id) || { opponent, wins: 0, losses: 0 };
    if (m.winnerId === Number(playerId)) rec.wins += 1;
    else rec.losses += 1;
    byOpponent.set(opponent.id, rec);
  });
  return [...byOpponent.values()].sort((a, b) => {
    const byTotal = (b.wins + b.losses) - (a.wins + a.losses);
    return byTotal !== 0 ? byTotal : a.opponent.name.localeCompare(b.opponent.name);
  });
}

function h2hRowHtml(rec) {
  const total = rec.wins + rec.losses;
  const winPct = Math.round((rec.wins / total) * 100);
  const scoreColor = rec.wins > rec.losses ? 'var(--green)' : rec.wins < rec.losses ? 'var(--danger)' : 'var(--gray)';
  return `
    <div class="h2h-row">
      <a class="h2h-name" href="/player/${rec.opponent.slug || rec.opponent.id}">${escapeHtml(rec.opponent.name)}</a>
      <div class="h2h-record">
        <div class="h2h-bar">
          <div style="width:${winPct}%;background:var(--green)"></div><div style="width:${100 - winPct}%;background:var(--danger)"></div>
        </div>
        <span class="h2h-score" style="color:${scoreColor}">${rec.wins} — ${rec.losses}</span>
      </div>
    </div>
  `;
}

function renderH2H() {
  const el = document.getElementById('h2h-section');
  const records = opponentRecords();
  if (!records.length) {
    el.innerHTML = '';
    return;
  }
  const remaining = records.length - H2H_COLLAPSED_LIMIT;
  const visible = h2hExpanded || remaining <= 0 ? records : records.slice(0, H2H_COLLAPSED_LIMIT);
  const toggleHtml = remaining > 0
    ? `<button type="button" class="h2h-toggle" id="h2h-toggle">${h2hExpanded ? 'Show less' : `Show all (${remaining} more)`}</button>`
    : '';
  el.innerHTML = `
    <div class="section-label">Head-to-head</div>
    <div class="h2h-card">${visible.map(h2hRowHtml).join('')}${toggleHtml}</div>
  `;
  if (remaining > 0) {
    document.getElementById('h2h-toggle').addEventListener('click', () => {
      h2hExpanded = !h2hExpanded;
      renderH2H();
    });
  }
}

let quickScheduleToken = null;

function openQuickScheduleModal(token) {
  quickScheduleToken = token;
  document.getElementById('quick-schedule-location').value = '';
  document.getElementById('quick-schedule-date').value = '';
  document.getElementById('quick-schedule-time').value = '';
  document.getElementById('quick-schedule-error').textContent = '';
  document.getElementById('quick-schedule-modal').style.display = 'flex';
}

listEl.addEventListener('click', (e) => {
  const scheduleBtn = e.target.closest('.quick-schedule-btn');
  if (!scheduleBtn) return;
  e.preventDefault();
  e.stopPropagation();
  requirePlayerAuth(() => openQuickScheduleModal(scheduleBtn.dataset.token));
});

document.getElementById('quick-schedule-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('quick-schedule-error');
  errorEl.textContent = '';
  const location = document.getElementById('quick-schedule-location').value.trim();
  const dateVal = document.getElementById('quick-schedule-date').value;
  const timeVal = document.getElementById('quick-schedule-time').value;
  const scheduledAt = dateVal ? new Date(`${dateVal}T${timeVal || '00:00'}`).toISOString() : null;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    await api(`/matches/${quickScheduleToken}`, { method: 'PATCH', body: { location, scheduledAt } });
    document.getElementById('quick-schedule-modal').style.display = 'none';
    load();
  } catch (err) {
    errorEl.textContent = err.message;
  }
  submitBtn.disabled = false;
});

function render() {
  const parts = [];
  rawGroups.forEach((matches, i) => {
    const filtered = matches.filter(passesFilters);
    if (!filtered.length) return;
    parts.push(`<div class="match-list-heading">${GROUPS[i].heading}</div>`);
    parts.push(...filtered.map(matchCardHtml));
  });
  listEl.innerHTML = parts.length ? parts.join('') : '<div class="empty-state">No matches match your filters.</div>';
}

async function load() {
  try {
    rawGroups = await Promise.all(GROUPS.map((g) => {
      const qs = new URLSearchParams({ playerId, ...g.params });
      return api(`/matches?${qs.toString()}`);
    }));
    populateYearOptions();
    document.getElementById('player-upcoming-count').textContent = rawGroups[1].length + rawGroups[2].length;
    renderStats();
    await renderBadges();
    renderH2H();
    render();
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Could not load matches: ${escapeHtml(err.message)}</div>`;
  }
}

document.getElementById('stats-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('#stats-tabs .tab').forEach((b) => b.classList.toggle('active', b === btn));
  document.getElementById('stats-panel-blta').style.display = btn.dataset.statsTab === 'blta' ? '' : 'none';
  document.getElementById('stats-panel-overall').style.display = btn.dataset.statsTab === 'overall' ? '' : 'none';
});

document.getElementById('badges-toggle').addEventListener('click', openBadgesModal);
window.addEventListener('resize', applyBadgesClip);

resultFilterEl.addEventListener('change', (e) => {
  currentResult = e.target.value;
  render();
});
categoryFilterEl.addEventListener('change', (e) => {
  currentCategory = e.target.value;
  render();
});
yearFilterEl.addEventListener('change', (e) => {
  currentYear = e.target.value;
  render();
});
document.getElementById('reset-filters-btn').addEventListener('click', () => {
  currentResult = '';
  currentCategory = '';
  currentYear = '';
  resultFilterEl.value = '';
  categoryFilterEl.value = '';
  yearFilterEl.value = '';
  render();
});

function initials(name) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ? parts[0][0] : '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// First name on its own (lighter) line, surname on the line below (bold) —
// falls back to a single line if the name is only one word.
function nameLinesHtml(name) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] || '';
  const rest = parts.slice(1).join(' ');
  return rest
    ? `<span class="player-first-name">${escapeHtml(first)}</span><span class="player-surname">${escapeHtml(rest)}</span>`
    : `<span class="player-surname">${escapeHtml(first)}</span>`;
}

// Age as of today, from a YYYY-MM-DD birthday — not stored directly, since a
// stored age would silently go stale.
function computeAge(birthday) {
  if (!birthday) return null;
  const b = new Date(birthday);
  if (Number.isNaN(b.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const hadBirthdayThisYear = today.getMonth() > b.getMonth()
    || (today.getMonth() === b.getMonth() && today.getDate() >= b.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

function fmtBirthday(birthday) {
  if (!birthday) return null;
  const d = new Date(birthday);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// flagCodeFor / flagImgHtml / NATIONALITY_CODES live in common.js — shared
// with the rankings page, which also shows a flag next to each name.

// Three columns, each independently skipping its own empty fields — the
// whole card stays hidden only when every field across all three is empty.
function bioCardHtml(player) {
  const age = computeAge(player.birthday);
  const columns = [
    [
      ['Category', player.category ? (CATEGORY_LABELS[player.category] || player.category) : null],
      ['Nationality', player.nationality],
      ['Birthday', fmtBirthday(player.birthday)],
      ['Age', age !== null ? String(age) : null],
    ],
    [
      ['Racket', player.racket],
      ['String brand', player.string_brand],
      ['String tension', player.string_tension],
      ['Forehand', player.forehand],
    ],
    [
      ['Backhand', player.backhand],
      ['Seasons', player.seasons],
      ['Favourite player', player.favorite_player],
    ],
    // Phone/email are never sent to the API for an anonymous visitor (see
    // stripPrivateFields in routes/players.js), so this column disappears
    // on its own for anyone not logged in as a player or admin.
    [
      ['Phone', player.phone],
      ['Email', player.email],
    ],
  ].map((rows) => rows.filter(([, value]) => value)).filter((rows) => rows.length);

  if (!columns.length) return '';
  return columns.map((rows) => `
    <div class="bio-col">
      ${rows.map(([label, value]) => {
        const flagHtml = label === 'Nationality' ? flagImgHtml(player.nationality, 'bio-flag-icon') : '';
        return `<div class="bio-row"><span class="bio-label">${escapeHtml(label)}</span><span class="bio-value">${flagHtml}${escapeHtml(value)}</span></div>`;
      }).join('')}
    </div>
  `).join('');
}

function renderBio() {
  const card = document.getElementById('player-bio-card');
  const html = bioCardHtml(currentPlayer);
  card.innerHTML = html;
  card.style.display = html ? '' : 'none';
}

function openBioModal() {
  const p = currentPlayer;
  document.getElementById('bio-category').value = p.category || '';
  document.getElementById('bio-nationality').value = p.nationality || '';
  document.getElementById('bio-forehand').value = p.forehand || '';
  document.getElementById('bio-backhand').value = p.backhand || '';
  document.getElementById('bio-racket').value = p.racket || '';
  document.getElementById('bio-string-brand').value = p.string_brand || '';
  document.getElementById('bio-string-tension').value = p.string_tension || '';
  document.getElementById('bio-seasons').value = p.seasons || '';
  document.getElementById('bio-favorite-player').value = p.favorite_player || '';
  document.getElementById('bio-birthday').value = p.birthday || '';
  document.getElementById('bio-phone').value = p.phone || '';
  document.getElementById('bio-email').value = p.email || '';
  document.getElementById('bio-error').textContent = '';
  document.getElementById('player-bio-modal').style.display = 'flex';
}

// Editing profile info uses its own code (PROFILE_CODE), separate from the
// shared match-scoring player code — a self-contained login flow (not
// common.js's requirePlayerAuth/openPlayerLoginModal, which are wired to
// the other code) since this is the only page that needs it.
let profileEditorAuthed = false;

async function refreshProfileAuth() {
  try {
    const res = await api('/player/profile-session');
    profileEditorAuthed = !!res.isProfileEditor;
  } catch {
    profileEditorAuthed = false;
  }
  return profileEditorAuthed;
}

function openProfileLoginModal(onSuccess) {
  const modal = document.getElementById('profile-login-modal');
  if (!modal) return;
  const form = document.getElementById('profile-login-form');
  const errorEl = document.getElementById('profile-login-error');
  const digits = Array.from(modal.querySelectorAll('.otp-digit'));
  errorEl.textContent = '';
  form.onsubmit = (e) => e.preventDefault();

  const submitCode = async () => {
    errorEl.textContent = '';
    digits.forEach((d) => { d.disabled = true; });
    try {
      await api('/player/profile-login', { method: 'POST', body: { code: digits.map((d) => d.value).join('') } });
      profileEditorAuthed = true;
      modal.style.display = 'none';
      if (onSuccess) onSuccess();
    } catch (err) {
      errorEl.textContent = err.message;
      digits.forEach((d) => { d.value = ''; d.disabled = false; });
      digits[0].focus();
    }
  };

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

// anonAuthed comes from common.js's shared session state (the anon tier
// logs in through the same code box as a real player, not this page's own
// profile-code modal) — letting it through here just reaches the server,
// which enforces that an anon session can only actually save changes to a
// player it created itself (see checkPlayerAccess in routes/players.js).
function requireProfileAuth(onReady) {
  if (profileEditorAuthed || anonAuthed) { onReady(); return; }
  openProfileLoginModal(onReady);
}

document.getElementById('edit-bio-btn').addEventListener('click', () => requireProfileAuth(openBioModal));

document.getElementById('player-bio-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    category: document.getElementById('bio-category').value || null,
    nationality: document.getElementById('bio-nationality').value.trim() || null,
    forehand: document.getElementById('bio-forehand').value.trim() || null,
    backhand: document.getElementById('bio-backhand').value.trim() || null,
    racket: document.getElementById('bio-racket').value.trim() || null,
    stringBrand: document.getElementById('bio-string-brand').value.trim() || null,
    stringTension: document.getElementById('bio-string-tension').value.trim() || null,
    seasons: document.getElementById('bio-seasons').value.trim() || null,
    favoritePlayer: document.getElementById('bio-favorite-player').value.trim() || null,
    birthday: document.getElementById('bio-birthday').value || null,
    phone: document.getElementById('bio-phone').value.trim() || null,
    email: document.getElementById('bio-email').value.trim() || null,
  };
  try {
    currentPlayer = await api(`/players/${playerId}/bio`, { method: 'PATCH', body });
    renderBio();
    document.getElementById('player-bio-modal').style.display = 'none';
    toast('Profile updated');
  } catch (err) {
    document.getElementById('bio-error').textContent = err.message;
  }
});

refreshProfileAuth();

(async () => {
  try {
    const player = await api(`/players/${playerId}`);
    playerId = player.id;
    currentPlayer = player;
    nameEl.innerHTML = nameLinesHtml(player.name);
    document.getElementById('player-flag').innerHTML = flagImgHtml(player.nationality, 'player-flag-img');
    document.title = `${player.name} — BLTA Score`;
    const avatarEl = document.getElementById('player-avatar');
    if (player.photo_url) {
      avatarEl.outerHTML = `<img class="player-avatar" id="player-avatar" src="${escapeHtml(player.photo_url)}" alt="${escapeHtml(player.name)}">`;
    } else {
      avatarEl.textContent = initials(player.name);
    }
    renderBio();
  } catch {
    nameEl.textContent = 'Player not found';
    listEl.innerHTML = '';
    return;
  }
  load();
  const socket = io();
  socket.on('matches:changed', load);
})();

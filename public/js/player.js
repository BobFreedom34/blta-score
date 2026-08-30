// The URL segment can be either the player's slug (surname-based, the
// normal case) or their old numeric id (still supported for links shared
// before slugs existed) — reassigned to the real numeric id once the
// player record loads below, since every Number(playerId) comparison in
// this file downstream needs the actual id either way.
let playerId = window.location.pathname.split('/').filter(Boolean).pop();
let currentPlayer = null;
let isAdminUser = false;
const nameEl = document.getElementById('player-name');
const listEl = document.getElementById('player-match-list');
const opponentFilterEl = document.getElementById('opponent-filter');
const resultFilterEl = document.getElementById('result-filter');
const categoryFilterEl = document.getElementById('category-filter');
const yearFilterEl = document.getElementById('year-filter');

let currentOpponent = '';
let currentResult = '';
let currentCategory = '';
let currentYear = '';
let rawGroups = []; // last-fetched matches per GROUPS entry, unfiltered
let lastBltaFinished = []; // set by renderStats(), reused when the "All matches" tab
let lastAllFinished = []; // is switched to, since its trend chart can't be measured
// accurately (see renderTrendChart) while its panel is still display:none.
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
  // Green/red left border by outcome from THIS profile's point of view,
  // overriding the plain "finished = green" status color everywhere else
  // uses — only for a decided result (a walkover/retirement counts, but a
  // no-winner Unfinished-as-is finish doesn't, so it keeps the neutral
  // status color instead of falsely reading as a loss).
  const resultClass = m.status === 'FINISHED' && m.winnerId
    ? (m.winnerId === Number(playerId) ? ' result-won' : ' result-lost')
    : '';
  return `
    <a class="match-card status-${m.status}${m.status === 'PLANNED' && m.scheduledAt ? ' has-date' : ''}${resultClass}" href="/match/${m.token}">
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
              <div class="name ${winnerP1 ? 'winner' : ''}">${playerNameLink(m.player1)}${ballsIconHtml(m, 1)}${playerInfoBtn(m.player1)}</div>
              <div class="vs">vs</div>
              <div class="name ${winnerP2 ? 'winner' : ''}">${playerNameLink(m.player2)}${ballsIconHtml(m, 2)}${playerInfoBtn(m.player2)}</div>
            </div>
            <div class="match-score">${matchScoreHtml(m)}</div>
          </div>
        </div>
      `}
      ${isOverdueUnresolved(m) ? `<div class="overdue-warning">${t('matches.overdueWarning')}</div>` : ''}
      ${m.status === 'PLANNED' && !m.scheduledAt ? `<button type="button" class="btn btn-sm btn-outline quick-schedule-btn" data-token="${m.token}" style="margin-top:6px">${t('matches.setDateLocation')}</button>` : ''}
    </a>
  `;
}

// Headings are read live via a getter (not plain strings) so a language
// switch picks them up without this array needing to be rebuilt.
const GROUPS = [
  { get heading() { return t('matches.liveHeading'); }, params: { status: 'LIVE' } },
  { get heading() { return t('matches.scheduledHeading'); }, params: { status: 'PLANNED', hasDate: '1' } },
  { get heading() { return t('matches.plannedHeading'); }, params: { status: 'PLANNED', noDate: '1' } },
  { get heading() { return t('matches.finishedHeading'); }, params: { status: 'FINISHED' } },
  // Appended at the end, not inserted — rawGroups[3] is relied on elsewhere
  // as "the Finished group" and must keep that index.
  { get heading() { return t('matches.unfinishedHeading'); }, params: { status: 'UNFINISHED' } },
];

function matchYear(m) {
  return m.scheduledAt ? new Date(m.scheduledAt).getFullYear() : null;
}

// The other player in a match, from this profile's point of view.
function opponentOf(m) {
  return m.player1.id === Number(playerId) ? m.player2 : m.player1;
}

// Won/Lost only ever matches a finished match with a decided winner, so
// picking either one naturally empties (and hides) the Live/Scheduled/Not
// yet scheduled groups without any special-casing here.
function passesFilters(m) {
  if (currentOpponent && String(opponentOf(m).id) !== currentOpponent) return false;
  if (currentResult === 'won' && m.winnerId !== Number(playerId)) return false;
  if (currentResult === 'lost' && (!m.winnerId || m.winnerId === Number(playerId))) return false;
  if (currentCategory && m.category !== currentCategory) return false;
  if (currentYear && String(matchYear(m)) !== currentYear) return false;
  return true;
}

// Alphabetically-sorted, de-duplicated (by id) list of everyone this player
// has ever faced across every match group — not just the finished ones, so
// an upcoming/live opponent can be filtered to too.
function populateOpponentOptions() {
  const byId = new Map();
  rawGroups.flat().forEach((m) => {
    const opp = opponentOf(m);
    if (!byId.has(opp.id)) byId.set(opp.id, opp.name);
  });
  const opponents = [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const keep = opponentFilterEl.value;
  opponentFilterEl.innerHTML = `<option value="">${t('player.allOpponents')}</option>`
    + opponents.map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`).join('');
  opponentFilterEl.value = opponents.some(([id]) => String(id) === keep) ? keep : '';
  currentOpponent = opponentFilterEl.value;
}

function populateYearOptions() {
  const years = [...new Set(rawGroups.flat().filter((m) => m.scheduledAt).map(matchYear))].sort((a, b) => b - a);
  const keep = yearFilterEl.value;
  yearFilterEl.innerHTML = `<option value="">${t('player.allYears')}</option>` + years.map((y) => `<option value="${y}">${y}</option>`).join('');
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
  const label = last20.length === 1 ? t('player.lastGamesOne') : t('player.lastGames', { count: last20.length });
  return `<div class="form-guide-label">${label}</div><div class="form-guide">${squares}</div>`;
}

// Sparkline of the running win rate after each decided match, oldest to
// newest — same chronological ordering as formGuideHtml(). Skipped for
// fewer than 2 decided matches, since a single point isn't a trend.
// Drawn as a wide, fixed-height chart with a quintile grid and a
// gradient-filled area under the line for a more analytical,
// dashboard-style look. idSuffix keeps the gradient's id unique since both
// the BLTA and All matches versions of this chart exist in the DOM at
// once (one just hidden).
// containerWidth is the chart's own real measured pixel width (see
// renderTrendChart, which measures before calling this) — the viewBox is
// built to match it exactly, rather than stretched from a generic
// reference width via preserveAspectRatio="none" the way this used to
// work. That non-uniform stretch was harmless for the line's slope, but
// also flattened the end-of-line circle marker into a thin ellipse on a
// wide (desktop) container; matching viewBox width to the real pixel
// width makes the scale factor exactly 1:1 in both axes instead.
function winRateTrendHtml(matches, idSuffix, containerWidth) {
  const chronological = matches
    .filter((m) => m.winnerId)
    .sort((a, b) => new Date(a.scheduledAt || a.startTime || a.createdAt) - new Date(b.scheduledAt || b.startTime || b.createdAt));
  if (chronological.length < 2) return '';
  let wins = 0;
  const points = chronological.map((m, i) => {
    if (m.winnerId === Number(playerId)) wins += 1;
    return Math.round((wins / (i + 1)) * 100);
  });
  const w = Math.max(120, Math.round(containerWidth || 280));
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
      <div class="form-guide-label">${t('player.winRateTrend')}</div>
      <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px">
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

// Same sparkline treatment as winRateTrendHtml, for BLTA overall rank
// instead of win rate — one point per weekly snapshot (see
// src/rankingSnapshots.js), oldest to newest. Inverted on purpose: rank 1
// is the best possible position, so a lower number draws *higher* on the
// chart, the same way a climbing line reads as "doing better" everywhere
// else. Scaled to the player's own best/worst rank in the window rather
// than a fixed range (unlike the 0-100 win-rate scale) since rank pool
// size varies by table and isn't meaningful on an absolute scale here.
function rankTrendHtml(history, containerWidth) {
  if (!history || history.length < 2) return '';
  const ranks = history.map((h) => h.rank);
  const minRank = Math.min(...ranks);
  const maxRank = Math.max(...ranks);
  const range = Math.max(1, maxRank - minRank);
  // The viewBox width is set to the container's own real measured pixel
  // width (see renderRankTrend, which measures before calling this) rather
  // than a generic reference width like the win-rate chart uses — that
  // chart's preserveAspectRatio="none" non-uniform stretch is harmless for
  // a line's slope, but it also flattened this chart's circular point
  // markers into thin ellipses on a wide container. Matching viewBox width
  // to real pixel width makes the scale factor exactly 1:1 in both axes,
  // so nothing needs stretching in the first place.
  const w = Math.max(120, Math.round(containerWidth || 280));
  const chartH = 64;
  const labelSpace = 14; // headroom for each point's own "#N" label, above the line
  const h = chartH + labelSpace;
  const padX = 8;
  const padY = 8;
  const yFor = (rank) => labelSpace + padY + ((rank - minRank) / range) * (chartH - padY * 2);
  const stepX = (w - padX * 2) / (history.length - 1);
  const coords = history.map((pt, i) => [padX + i * stepX, yFor(pt.rank)]);
  const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const baseline = h - padY;
  const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${baseline.toFixed(1)} `
    + `L${coords[0][0].toFixed(1)},${baseline.toFixed(1)} Z`;
  const gradId = 'rank-trend-gradient';
  const currentRank = history[history.length - 1].rank;
  // The rank itself, right above every point — not just the latest one —
  // since the whole point of this chart is watching a specific number
  // move. Rendered as an HTML overlay (positioned by percentage, matching
  // each point's x/y within the viewBox) rather than SVG <text>: this SVG
  // uses preserveAspectRatio="none" so the line fills however wide its
  // container ends up without letterboxing, but that same non-uniform
  // scaling stretches SVG text sideways on a wide (desktop) container —
  // HTML text positioned by percentage isn't subject to that distortion.
  const pointLabels = coords.map(([x, y], i) => `
    <span style="left:${(x / w * 100).toFixed(2)}%;top:${((y - 5) / h * 100).toFixed(2)}%">#${history[i].rank}</span>
  `).join('');
  return `
    <div class="trend-sparkline">
      <div class="form-guide-label">${t('player.rankTrend')}</div>
      <div class="rank-trend-chart">
        <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px">
          <defs>
            <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--orange)" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="var(--orange)" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <line x1="${padX}" y1="${baseline.toFixed(1)}" x2="${w - padX}" y2="${baseline.toFixed(1)}" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
          <path d="${areaPath}" fill="url(#${gradId})" stroke="none"/>
          <path d="${linePath}" fill="none" stroke="var(--orange)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          ${coords.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="var(--orange)"/>`).join('')}
        </svg>
        <div class="rank-trend-labels">${pointLabels}</div>
      </div>
      <div class="trend-value">#${currentRank}</div>
    </div>
  `;
}

// Fetches this player's own weekly BLTA-rank history and renders it — a
// no-op if the placeholder isn't on the page, or if there's under 2 weeks
// of data yet (rankTrendHtml itself returns '' in that case, same
// threshold winRateTrendHtml uses for "not enough points for a trend").
// Renders an empty measuring shell first — rankTrendHtml needs the real
// container width up front (see its comment) — then the real chart. Sized
// once at load, not re-measured on window resize; a live resize would
// need to redraw this to stay pixel-accurate, same trade-off most static
// chart widgets make.
async function renderRankTrend() {
  const el = document.getElementById('rank-trend-blta');
  if (!el || !currentPlayer) return;
  try {
    const { history } = await api(`/rankings/history/blta/${encodeURIComponent(currentPlayer.name)}`);
    if (!history || history.length < 2) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="trend-sparkline"><div class="form-guide-label">${t('player.rankTrend')}</div><div class="rank-trend-chart"></div></div>`;
    const containerWidth = el.querySelector('.rank-trend-chart').clientWidth;
    el.innerHTML = rankTrendHtml(history, containerWidth);
  } catch {
    el.innerHTML = '';
  }
}

// winRateTrendHtml needs the chart's real container width up front (see
// its comment) — renders an empty measuring shell first, reads its
// clientWidth, then the real chart. Skipped entirely (left blank, like
// winRateTrendHtml itself would return) when there's nothing to plot.
function renderTrendChart(elId, matches, idSuffix) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (matches.filter((m) => m.winnerId).length < 2) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="trend-sparkline"></div>';
  const containerWidth = el.querySelector('.trend-sparkline').clientWidth;
  el.innerHTML = winRateTrendHtml(matches, idSuffix, containerWidth);
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
  lastBltaFinished = bltaFinished;
  lastAllFinished = finished;
  fillStats('blta', computeRecord(bltaFinished));
  fillStats('overall', computeRecord(finished));
  document.getElementById('form-blta').innerHTML = formGuideHtml(bltaFinished);
  document.getElementById('form-overall').innerHTML = formGuideHtml(finished);
  renderTrendChart('trend-blta', bltaFinished, 'blta');
  // The "All matches" panel starts display:none — its trend chart is
  // (re-)rendered when that tab is actually switched to instead (see the
  // #stats-tabs click handler below), once it can be measured accurately.
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
    ? `<button type="button" class="h2h-toggle" id="h2h-toggle">${h2hExpanded ? t('player.showLess') : t('player.showMoreH2H', { count: remaining })}</button>`
    : '';
  el.innerHTML = `
    <div class="section-label">${t('player.h2h')}</div>
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
  listEl.innerHTML = parts.length ? parts.join('') : `<div class="empty-state">${t('player.noMatchesFilter')}</div>`;
}

async function load() {
  try {
    rawGroups = await Promise.all(GROUPS.map((g) => {
      const qs = new URLSearchParams({ playerId, ...g.params });
      return api(`/matches?${qs.toString()}`);
    }));
    populateOpponentOptions();
    populateYearOptions();
    document.getElementById('player-upcoming-count').textContent = rawGroups[1].length + rawGroups[2].length;
    renderStats();
    await renderBadges();
    renderRankTrend();
    renderH2H();
    render();
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">${escapeHtml(t('player.couldNotLoadMatches', { error: err.message }))}</div>`;
  }
}

document.getElementById('stats-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('#stats-tabs .tab').forEach((b) => b.classList.toggle('active', b === btn));
  document.getElementById('stats-panel-blta').style.display = btn.dataset.statsTab === 'blta' ? '' : 'none';
  document.getElementById('stats-panel-overall').style.display = btn.dataset.statsTab === 'overall' ? '' : 'none';
  // Re-render whichever trend chart just became visible — it can only be
  // measured accurately (see renderTrendChart) once its panel is actually
  // showing, not while it was still display:none.
  if (btn.dataset.statsTab === 'overall') renderTrendChart('trend-overall', lastAllFinished, 'overall');
  else renderTrendChart('trend-blta', lastBltaFinished, 'blta');
});

document.getElementById('badges-toggle').addEventListener('click', openBadgesModal);
window.addEventListener('resize', applyBadgesClip);

opponentFilterEl.addEventListener('change', (e) => {
  currentOpponent = e.target.value;
  render();
});
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
  currentOpponent = '';
  currentResult = '';
  currentCategory = '';
  currentYear = '';
  opponentFilterEl.value = '';
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
      ['category', player.category ? (CATEGORY_LABELS[player.category] || player.category) : null, t('player.bio.category')],
      ['nationality', player.nationality, t('player.bio.nationality')],
      ['birthday', fmtBirthday(player.birthday), t('player.bio.birthday')],
      ['age', age !== null ? String(age) : null, t('player.bio.age')],
    ],
    [
      ['racket', player.racket, t('player.bio.racket')],
      ['stringBrand', player.string_brand, t('player.bio.stringBrand')],
      ['stringTension', player.string_tension, t('player.bio.stringTension')],
      ['forehand', player.forehand, t('player.bio.forehand')],
    ],
    [
      ['backhand', player.backhand, t('player.bio.backhand')],
      ['seasons', player.seasons, t('player.bio.seasons')],
      ['favoritePlayer', player.favorite_player, t('player.bio.favoritePlayer')],
    ],
    // Phone/email are never sent to the API for an anonymous visitor (see
    // stripPrivateFields in routes/players.js), so this column disappears
    // on its own for anyone not logged in as a player or admin.
    [
      ['phone', player.phone, t('player.bio.phone')],
      ['email', player.email, t('player.bio.email')],
    ],
  ].map((rows) => rows.filter(([, value]) => value)).filter((rows) => rows.length);

  if (!columns.length) return '';
  return columns.map((rows) => `
    <div class="bio-col">
      ${rows.map(([field, value, label]) => {
        const flagHtml = field === 'nationality' ? flagImgHtml(player.nationality, 'bio-flag-icon') : '';
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

// A profile can only be edited by the player it belongs to (logged in via
// their own phone number — common.js's requirePlayerAuth/currentPlayerId)
// or by an admin — mirrors checkPlayerAccess in routes/players.js. Prompts
// login if logged out, then — the moment login is confirmed — rejects
// immediately with a clear message if this isn't the visitor's own page,
// same pattern as handlePlannedActionClick in app.js.
function requireProfileAuth(onReady) {
  if (isAdminUser) { onReady(); return; }
  requirePlayerAuth(() => {
    if (playerAuthed && currentPlayerId && currentPlayerId === Number(playerId)) { onReady(); return; }
    toast(t('player.onlyEditOwnProfile'));
  });
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
    email: document.getElementById('bio-email').value.trim() || null,
  };
  // Phone is a player's login credential, so it goes through its own
  // route (PATCH /:id/phone — same one the admin-only Players page uses)
  // with its own format validation and uniqueness check, rather than the
  // general /bio route — only called if it actually changed, same pattern
  // as players.js's edit row.
  const phone = document.getElementById('bio-phone').value.trim();
  try {
    currentPlayer = await api(`/players/${playerId}/bio`, { method: 'PATCH', body });
    if (phone !== (currentPlayer.phone || '')) {
      currentPlayer = await api(`/players/${playerId}/phone`, { method: 'PATCH', body: { phone } });
    }
    renderBio();
    document.getElementById('player-bio-modal').style.display = 'none';
    toast(t('player.profileUpdated'));
  } catch (err) {
    document.getElementById('bio-error').textContent = err.message;
  }
});

(async () => {
  isAdminUser = await checkAdmin();
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
    nameEl.textContent = t('player.notFound');
    listEl.innerHTML = '';
    return;
  }
  load();
  const socket = io();
  socket.on('matches:changed', load);
})();

// Rankings page — mirrors the tabbed point standings from blta.sk/rebricky/
// (BLTA overall, per-category Race points, Tournaments). The numbers come
// from /api/rankings, which the server keeps in sync by re-reading that
// page (see src/rankingsScraper.js) — this file just renders whatever it
// gets back. Admins can override any row's points (see PUT/DELETE
// /rankings/override) when a number here needs to differ from what's
// published on blta.sk.

let rankingsData = null;
let activeTab = null;
let isAdminUser = false;

// The "Badges" tab isn't scraped from blta.sk like the others — it's built
// locally from this app's own badge system (see badges.js), same
// computeEarnedBadges() the player profile and Players pages use, just run
// once for every player from a single bulk match/badge fetch instead of
// one player at a time. badgeDefsForBadgesTab is kept around after that so
// each row can show a fixed preview of badge icons next to the name.
const BADGES_ICON_PREVIEW_COUNT = 5;
let badgeDefsForBadgesTab = null;

async function buildBadgesTable() {
  const [players, badgeDefs, finished] = await Promise.all([
    api('/players'),
    api('/badges'),
    api('/matches?status=FINISHED'),
  ]);
  badgeDefsForBadgesTab = badgeDefs;
  const matchesByPlayerId = new Map();
  finished.forEach((m) => {
    [m.player1.id, m.player2.id].forEach((pid) => {
      if (!matchesByPlayerId.has(pid)) matchesByPlayerId.set(pid, []);
      matchesByPlayerId.get(pid).push(m);
    });
  });
  const withCounts = players.map((p) => {
    const earned = computeEarnedBadges(p.id, matchesByPlayerId.get(p.id) || [], badgeDefs);
    return {
      name: p.name, slug: p.slug, nationality: p.nationality, points: earned.size, earned,
    };
  });
  // Same "shared rank on a tie" convention as the scraped tables (see
  // buildRaceTable in rankingsScraper.js) — a stable sort keeps players
  // with equal badge counts in their original (alphabetical) order rather
  // than shuffling them.
  const sorted = withCounts.slice().sort((a, b) => b.points - a.points);
  let rank = 0;
  let lastVal;
  const rows = sorted.map((r, i) => {
    if (r.points !== lastVal) { rank = i + 1; lastVal = r.points; }
    return {
      rank, name: r.name, slug: r.slug, nationality: r.nationality, points: r.points, earned: r.earned,
    };
  });
  return { key: 'badges', label: t('rankings.badgesTab'), pointsLabel: t('rankings.badgesCol'), rows };
}

function renderTabs() {
  const tabsEl = document.getElementById('rankings-tabs');
  tabsEl.innerHTML = rankingsData.tables.map((t) => `
    <button type="button" class="tab${t.key === activeTab ? ' active' : ''}" data-key="${t.key}">${escapeHtml(t.label)}</button>
  `).join('');
  tabsEl.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.key;
      renderTabs();
      renderTable();
    });
  });
}

function pointsDisplayHtml(r) {
  const value = r.points === null ? '<span style="color:var(--gray-dim)">–</span>' : escapeHtml(String(r.points));
  const overriddenMark = r.overridden ? `<span title="${escapeHtml(t('rankings.overriddenTooltip'))}" style="color:var(--orange);font-size:11px;margin-left:4px">✎</span>` : '';
  return `${value}${overriddenMark}`;
}

// Week-over-week movement, e.g. "▲2" in green or "▼1" in red — a plain
// dash once there's been at least one weekly snapshot to compare against
// (see src/rankingSnapshots.js) but the rank hasn't actually changed,
// same "nothing to show" convention as the age/nationality columns
// elsewhere on this page. Always renders *some* .rank-move element (never
// '') so its fixed width (see the CSS) keeps the rank number lined up in
// the same spot on every row, movement or not.
function moveHtml(move) {
  if (!move) return '<div class="rank-move rank-move-none">–</div>';
  const arrow = move.direction === 'up' ? '▲' : '▼';
  const cls = move.direction === 'up' ? 'rank-move-up' : 'rank-move-down';
  const title = t(move.direction === 'up' ? 'rankings.moveUpTitle' : 'rankings.moveDownTitle', { amount: move.amount });
  return `<div class="rank-move ${cls}" title="${title}">${arrow}${move.amount}</div>`;
}

function headerRowHtml(table) {
  return `
    <div class="rank-table-header rank-grid">
      <div class="rank-col-pos"></div>
      <div class="rank-col-player">${t('rankings.playerCol')}</div>
      <div class="rank-col-age">${t('rankings.ageCol')}</div>
      <div class="rank-col-matches">${t('rankings.matchesCol')}</div>
      <div class="rank-col-points">${escapeHtml(table.pointsLabel)}</div>
    </div>`;
}

// Badges tab has its own row/column shape (icon preview needs real room,
// unlike the age/matches numbers the scraped tables show) and no admin
// edit — there's no override endpoint for a locally-computed count — so
// it renders through its own function entirely rather than folding into
// the generic one below.
function renderBadgesTable(table) {
  const listEl = document.getElementById('rankings-list');
  const visibleRows = table.rows.filter((r) => r.points !== 0);
  if (!visibleRows.length) {
    listEl.innerHTML = `<p style="color:var(--gray)">${t('rankings.none')}</p>`;
    return;
  }
  const iconDefs = (badgeDefsForBadgesTab || []).slice(0, BADGES_ICON_PREVIEW_COUNT);
  const headerHtml = `
    <div class="rank-table-header rank-grid rank-grid-badges">
      <div class="rank-col-pos"></div>
      <div class="rank-col-player">${t('rankings.playerCol')}</div>
      <div class="rank-col-points">${escapeHtml(table.pointsLabel)}</div>
    </div>`;
  const rowsHtml = visibleRows.map((r) => {
    const flag = flagImgHtml(r.nationality, 'rank-flag-icon');
    const nameHtml = r.slug
      ? `<a href="/player/${escapeHtml(r.slug)}" class="rank-name">${flag}${escapeHtml(r.name)}</a>`
      : `<span class="rank-name">${flag}${escapeHtml(r.name)}</span>`;
    const iconsHtml = iconDefs.map((b) => {
      const earned = r.earned.has(b.id);
      return `<div class="badge-medal badge-medal-mini${earned ? '' : ' locked'}" title="${escapeHtml(b.name)} — ${escapeHtml(b.description)}">${badgeIconInner(b.icon)}</div>`;
    }).join('');
    return `
      <div class="rank-row rank-grid rank-grid-badges">
        <div class="rank-pos">${r.rank}</div>
        <div class="rank-badges-cell">
          ${nameHtml}
          <div class="rank-badges-icons">${iconsHtml}</div>
        </div>
        <div class="rank-points">${r.points}</div>
      </div>
    `;
  }).join('');
  listEl.innerHTML = `<div class="rank-table">${headerHtml}${rowsHtml}</div>`;
}

function renderTable() {
  const table = rankingsData.tables.find((t) => t.key === activeTab);
  if (table && table.key === 'badges') return renderBadgesTable(table);
  const listEl = document.getElementById('rankings-list');
  // Skip anyone with no points at all (null) or exactly 0 — keeping the
  // original index (not the filtered position) on each entry so the
  // admin edit flow below still looks up the right row in table.rows.
  const visibleRows = table
    ? table.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.points !== null && r.points !== 0)
    : [];
  if (!table || visibleRows.length === 0) {
    listEl.innerHTML = `<p style="color:var(--gray)">${t('rankings.none')}</p>`;
    return;
  }
  const rowsHtml = visibleRows.map(({ r, i }) => {
    const flag = flagImgHtml(r.nationality, 'rank-flag-icon');
    const nameHtml = r.slug
      ? `<a href="/player/${escapeHtml(r.slug)}" class="rank-name">${flag}${escapeHtml(r.name)}</a>`
      : `<span class="rank-name">${flag}${escapeHtml(r.name)}</span>`;
    const editLink = isAdminUser
      ? `<button type="button" class="rank-edit-link" data-action="edit-points">${t('common.edit')}</button>`
      : '';
    return `
      <div class="rank-row rank-grid" data-index="${i}">
        <div class="rank-pos">${moveHtml(r.move)}<span class="rank-pos-num">${r.rank}</span></div>
        ${nameHtml}
        <div class="rank-col-age">${r.age === null ? '–' : r.age}</div>
        <div class="rank-col-matches">${r.matches}</div>
        <div class="rank-points">
          ${pointsDisplayHtml(r)}
          ${editLink}
        </div>
      </div>
    `;
  }).join('');
  listEl.innerHTML = `<div class="rank-table">${headerRowHtml(table)}${rowsHtml}</div>`;

  if (isAdminUser) attachEditHandlers(table);
}

function attachEditHandlers(table) {
  document.querySelectorAll('#rankings-list .rank-row').forEach((rowEl) => {
    const btn = rowEl.querySelector('[data-action="edit-points"]');
    if (!btn) return;
    btn.addEventListener('click', () => startEdit(rowEl, table));
  });
}

function startEdit(rowEl, table) {
  const i = Number(rowEl.dataset.index);
  const row = table.rows[i];
  const pointsEl = rowEl.querySelector('.rank-points');
  const editBtn = rowEl.querySelector('[data-action="edit-points"]');
  editBtn.style.display = 'none';
  pointsEl.innerHTML = `
    <input type="number" class="edit-points-input" value="${row.points === null ? '' : row.points}" style="width:70px;padding:6px 8px;border-radius:8px;border:1.5px solid var(--orange);font-family:inherit;font-size:14px">
    <div style="display:flex;gap:6px;margin-top:6px;justify-content:flex-end">
      <button type="button" class="btn btn-sm btn-primary" data-action="save-points">${t('common.save')}</button>
      <button type="button" class="btn btn-sm btn-outline" data-action="cancel-points">${t('common.cancel')}</button>
      ${row.overridden ? `<button type="button" class="btn btn-sm btn-outline" data-action="clear-points" title="${escapeHtml(t('rankings.resetTitle'))}">${t('rankings.reset')}</button>` : ''}
    </div>
  `;
  const input = pointsEl.querySelector('.edit-points-input');
  input.focus();
  input.select();

  const cancel = () => renderTable();
  pointsEl.querySelector('[data-action="cancel-points"]').addEventListener('click', cancel);

  const save = async () => {
    const raw = input.value.trim();
    const points = raw === '' ? null : Number(raw);
    if (raw !== '' && !Number.isInteger(points)) {
      return toast(t('rankings.pointsMustBeWhole'));
    }
    try {
      await api(`/rankings/override/${table.key}/${encodeURIComponent(row.name)}`, { method: 'PUT', body: { points } });
      row.points = points;
      row.overridden = true;
      toast(t('rankings.pointsUpdated'));
      renderTable();
    } catch (err) {
      toast(err.message);
    }
  };
  pointsEl.querySelector('[data-action="save-points"]').addEventListener('click', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') cancel();
  });

  const clearBtn = pointsEl.querySelector('[data-action="clear-points"]');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      try {
        await api(`/rankings/override/${table.key}/${encodeURIComponent(row.name)}`, { method: 'DELETE' });
        toast(t('rankings.revertedToBlta'));
        load();
      } catch (err) {
        toast(err.message);
      }
    });
  }
}

async function load() {
  let badgesTableResult;
  try {
    [rankingsData, badgesTableResult] = await Promise.all([
      api('/rankings'),
      buildBadgesTable().catch((err) => {
        // Non-fatal — the scraped tables still work without it, just minus
        // the one locally-computed tab.
        console.error('[rankings] badges tab failed to build:', err.message);
        return null;
      }),
    ]);
  } catch (err) {
    document.getElementById('rankings-updated').textContent = '';
    document.getElementById('rankings-list').innerHTML = `<p style="color:var(--danger)">${escapeHtml(err.message)}</p>`;
    return;
  }
  if (badgesTableResult) rankingsData.tables.push(badgesTableResult);
  if (!activeTab || !rankingsData.tables.some((t) => t.key === activeTab)) {
    activeTab = rankingsData.tables[0] && rankingsData.tables[0].key;
  }
  document.getElementById('rankings-updated').textContent = '';
  renderTabs();
  renderTable();
}

checkAdmin().then((result) => {
  isAdminUser = result;
  if (rankingsData) renderTable();
});
load();

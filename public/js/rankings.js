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

// Week-over-week movement, e.g. "▲2" in green or "▼1" in red — blank until
// there's been at least one weekly snapshot to compare against (see
// src/rankingSnapshots.js), so a brand-new deploy or an unchanged rank
// shows nothing rather than a misleading "no movement" indicator.
function moveHtml(move) {
  if (!move) return '';
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

function renderTable() {
  const table = rankingsData.tables.find((t) => t.key === activeTab);
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
        <div class="rank-pos">${r.rank}${moveHtml(r.move)}</div>
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
  try {
    rankingsData = await api('/rankings');
  } catch (err) {
    document.getElementById('rankings-updated').textContent = '';
    document.getElementById('rankings-list').innerHTML = `<p style="color:var(--danger)">${escapeHtml(err.message)}</p>`;
    return;
  }
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

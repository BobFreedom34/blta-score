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
  const overriddenMark = r.overridden ? '<span title="Manually set by an admin" style="color:var(--orange);font-size:11px;margin-left:4px">✎</span>' : '';
  return `${value}${overriddenMark}`;
}

function renderTable() {
  const table = rankingsData.tables.find((t) => t.key === activeTab);
  const listEl = document.getElementById('rankings-list');
  if (!table || table.rows.length === 0) {
    listEl.innerHTML = '<p style="color:var(--gray)">No standings yet.</p>';
    return;
  }
  listEl.innerHTML = table.rows.map((r, i) => {
    const flag = flagImgHtml(r.nationality, 'rank-flag-icon');
    const nameHtml = r.slug
      ? `<a href="/player/${escapeHtml(r.slug)}" class="rank-name">${flag}${escapeHtml(r.name)}</a>`
      : `<span class="rank-name">${flag}${escapeHtml(r.name)}</span>`;
    const editLink = isAdminUser
      ? `<button type="button" class="rank-edit-link" data-action="edit-points">Edit</button>`
      : '';
    return `
      <div class="rank-row" data-index="${i}">
        <div class="rank-pos">${r.rank}</div>
        <div class="rank-main">
          ${nameHtml}
          <div class="rank-matches">${r.matches} match${r.matches === 1 ? '' : 'es'}</div>
        </div>
        <div class="rank-points">
          ${pointsDisplayHtml(r)}
          ${editLink}
        </div>
      </div>
    `;
  }).join('');

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
      <button type="button" class="btn btn-sm btn-primary" data-action="save-points">Save</button>
      <button type="button" class="btn btn-sm btn-outline" data-action="cancel-points">Cancel</button>
      ${row.overridden ? '<button type="button" class="btn btn-sm btn-outline" data-action="clear-points" title="Revert to the value published on blta.sk">Reset</button>' : ''}
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
      return toast('Points must be a whole number');
    }
    try {
      await api(`/rankings/override/${table.key}/${encodeURIComponent(row.name)}`, { method: 'PUT', body: { points } });
      row.points = points;
      row.overridden = true;
      toast('Points updated');
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
        toast('Reverted to blta.sk value');
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

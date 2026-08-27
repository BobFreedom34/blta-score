// Rankings page — mirrors the tabbed point standings from blta.sk/rebricky/
// (BLTA overall, per-category Race points, Tournaments). The numbers come
// from /api/rankings, which the server keeps in sync by re-reading that
// page (see src/rankingsScraper.js) — this file just renders whatever it
// gets back.

let rankingsData = null;
let activeTab = null;

function fmtUpdated(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}, ${hh}:${mm}`;
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

function renderTable() {
  const table = rankingsData.tables.find((t) => t.key === activeTab);
  const listEl = document.getElementById('rankings-list');
  if (!table || table.rows.length === 0) {
    listEl.innerHTML = '<p style="color:var(--gray)">No standings yet.</p>';
    return;
  }
  listEl.innerHTML = table.rows.map((r) => {
    const nameHtml = r.slug
      ? `<a href="/player/${escapeHtml(r.slug)}" class="rank-name">${escapeHtml(r.name)}</a>`
      : `<span class="rank-name">${escapeHtml(r.name)}</span>`;
    const pointsHtml = r.points === null ? '<span style="color:var(--gray-dim)">–</span>' : escapeHtml(String(r.points));
    return `
      <div class="rank-row">
        <div class="rank-pos">${r.rank}</div>
        <div class="rank-main">
          ${nameHtml}
          <div class="rank-matches">${r.matches} match${r.matches === 1 ? '' : 'es'}</div>
        </div>
        <div class="rank-points">${pointsHtml}</div>
      </div>
    `;
  }).join('');
}

async function load() {
  try {
    rankingsData = await api('/rankings');
  } catch (err) {
    document.getElementById('rankings-updated').textContent = '';
    document.getElementById('rankings-list').innerHTML = `<p style="color:var(--danger)">${escapeHtml(err.message)}</p>`;
    return;
  }
  activeTab = rankingsData.tables[0] && rankingsData.tables[0].key;
  document.getElementById('rankings-updated').innerHTML =
    `Updated ${fmtUpdated(rankingsData.fetchedAt)} — from <a href="${escapeHtml(rankingsData.sourceUrl)}" target="_blank" rel="noopener" style="text-decoration:underline">blta.sk/rebricky</a>`;
  renderTabs();
  renderTable();
}

load();

// CourtIQ leaderboard page — every rated player, highest rating first. The
// numbers come from GET /api/courtiq (src/routes/courtiq.js), which just
// reads whatever scripts/backfillCourtIQ.js / the live hook in
// routes/matches.js already computed — this file only renders it. No
// admin edit here (unlike rankings.js's point overrides): CourtIQ is
// always derived from match results, never a number an admin types in by
// hand — if a number here looks wrong, the fix is correcting the match's
// score, then re-running the backfill (admin panel), not editing this
// directly.
function courtiqRowHtml(r) {
  const flag = flagImgHtml(r.nationality, 'rank-flag-icon');
  const nameHtml = r.slug
    ? `<a href="/player/${escapeHtml(r.slug)}" class="rank-name">${flag}${escapeHtml(r.name)}</a>`
    : `<span class="rank-name">${flag}${escapeHtml(r.name)}</span>`;
  const provisionalTag = r.provisional
    ? `<span class="courtiq-provisional-tag" title="${escapeHtml(t('courtiq.provisional'))}">?</span>`
    : '';
  return `
    <div class="rank-row rank-grid rank-grid-courtiq">
      <div class="rank-pos"><span class="rank-pos-num">${r.rank}</span></div>
      ${nameHtml}
      <div class="rank-points">${r.band.toFixed(1)}${provisionalTag}</div>
      <div class="rank-col-matches">${r.rating}</div>
      <div class="rank-col-matches">${r.gamesPlayed}</div>
    </div>
  `;
}

async function load() {
  const listEl = document.getElementById('courtiq-list');
  let data;
  try {
    data = await api('/courtiq');
  } catch (err) {
    listEl.innerHTML = `<p style="color:var(--danger)">${escapeHtml(err.message)}</p>`;
    return;
  }
  if (!data.rows.length) {
    listEl.innerHTML = `<p style="color:var(--gray)">${t('courtiq.none')}</p>`;
    return;
  }
  const headerHtml = `
    <div class="rank-table-header rank-grid rank-grid-courtiq">
      <div class="rank-col-pos"></div>
      <div class="rank-col-player">${t('courtiq.playerCol')}</div>
      <div class="rank-col-points">${t('courtiq.cardLabel')}</div>
      <div class="rank-col-matches">${t('courtiq.ratingCol')}</div>
      <div class="rank-col-matches">${t('courtiq.gamesCol')}</div>
    </div>`;
  listEl.innerHTML = `<div class="rank-table">${headerHtml}${data.rows.map(courtiqRowHtml).join('')}</div>`;
}

load();

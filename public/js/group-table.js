// Shared by the Tables page and the season page: one group's standings table (the green group title and the card of rows).
// Needs common.js (t, escapeHtml).

function groupTableHtml(group) {
  return `
    <section class="grp-section">
      <h2 class="grp-title">${escapeHtml(group.name)}${group.matchesCounted === null ? '' : ` <span>${escapeHtml(t('tables.counted', { done: group.matchesCounted, total: group.matchesTotal }))}</span>`}</h2>
      <div class="card card-dark grp-card">
        <div class="grp-head">
          <span>#</span><span>${escapeHtml(t('tables.player'))}</span><span>${escapeHtml(t('tables.points'))}</span><span>${escapeHtml(t('tables.matches'))}</span><span>${escapeHtml(t('tables.wins'))}</span><span>${escapeHtml(t('tables.losses'))}</span><span>+/−</span>
        </div>
        ${group.rows.length ? group.rows.map((r) => {
          const d = r.setDiff;
          return `
          <div class="grp-row">
            <span class="grp-pos">${r.position}</span>
            ${r.player.id
              ? `<a class="grp-name" href="/player/${encodeURIComponent(r.player.slug || r.player.id)}"><b>${escapeHtml(r.player.name)}</b></a>`
              : `<span class="grp-name"><b>${escapeHtml(r.player.name)}</b></span>`}
            <span class="grp-pts">${r.points}</span>
            <span class="dim">${r.played}</span>
            <span class="dim">${r.wins}</span>
            <span class="dim">${r.losses}</span>
            <span class="${d > 0 ? 'pos' : d < 0 ? 'neg' : 'dim'}">${d > 0 ? `+${d}` : d}</span>
          </div>`;
        }).join('') : `<div class="empty-state" style="padding:18px 0">${escapeHtml(t('tables.noPlayers'))}</div>`}
      </div>
    </section>`;
}

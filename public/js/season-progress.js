// Shared by the home page and the season page: the season's progress as one bar, split into the group stage and the play-off.
// Needs common.js (t, escapeHtml, courtIcon).

// A series runs about four months: the group stage for the first three, the play-offs in the last calendar month.
function dayNum(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 864e5;
}

function isoFromDayNum(n) {
  return new Date(n * 864e5).toISOString().slice(0, 10);
}

function shortRange(from, to) {
  const f = (iso) => { const [, m, d] = iso.split('-'); return `${Number(d)}.${Number(m)}.`; };
  return `${f(from)}–${f(to)}`;
}

function seasonProgressHtml(season, standings) {
  const groups = standings ? standings.groups : [];
  const counted = groups.reduce((s, g) => s + (g.matchesCounted || 0), 0);
  const total = groups.reduce((s, g) => s + (g.matchesTotal || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const over = (standings && standings.frozen) || (season.endDate && season.endDate < today);
  const pct = total ? Math.min(100, Math.round((counted / total) * 100)) : 0;

  // Two phases when the dates allow it: group stage up to the last calendar month, play-offs in that month.
  const playoffStart = season.endDate ? season.endDate.slice(0, 8) + '01' : null;
  const phased = !!(season.startDate && season.endDate && playoffStart > season.startDate);
  const inPlayoff = phased && today >= playoffStart;

  const right = over ? t('home.seasonOver') : (inPlayoff ? t('home.playoffOn') : (total ? t('home.playedOf', { done: counted, total }) : ''));
  const showPct = !over && !inPlayoff && total;

  let bar = '';
  if (!over && phased) {
    const basicDays = dayNum(playoffStart) - dayNum(season.startDate);
    const poDays = dayNum(season.endDate) - dayNum(playoffStart) + 1;
    const basicW = (basicDays / (basicDays + poDays)) * 100;
    const basicFill = inPlayoff ? 100 : pct;
    const poFill = inPlayoff ? Math.max(0, Math.min(100, ((dayNum(today) - dayNum(playoffStart) + 1) / poDays) * 100)) : 0;
    bar = `
      <div class="home-phases" style="grid-template-columns:${basicW.toFixed(2)}fr ${(100 - basicW).toFixed(2)}fr" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <div class="home-phase basic">
          <div class="home-bar"><i style="width:${basicFill}%"></i></div>
          <div class="lbl"><b>${escapeHtml(t('home.phaseBasic'))}</b><span>${escapeHtml(shortRange(season.startDate, isoFromDayNum(dayNum(playoffStart) - 1)))}</span></div>
        </div>
        <div class="home-phase po${inPlayoff ? ' on' : ''}">
          <div class="home-bar"><i style="width:${poFill}%"></i></div>
          <div class="lbl"><b>${courtIcon('trophy')}${escapeHtml(t('home.phasePlayoff'))}</b><span>${escapeHtml(shortRange(playoffStart, season.endDate))}</span></div>
        </div>
      </div>`;
  } else if (!over) {
    bar = `<div class="home-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>`;
  }

  return `
    <div class="home-season">
      <div class="home-season-top"><b>${escapeHtml(t('home.seasonProgress'))}${showPct ? `<em class="pct">${pct} %</em>` : ''}</b><span>${escapeHtml(right)}</span></div>
      ${bar}
    </div>`;
}

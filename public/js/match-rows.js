// Shared by the home page and the season page: the rows of the "Výsledky" and "Najbližšie zápasy" cards (the winner in green
// with the set score; the upcoming match with its date chip) and the section title with its "all" link.
// Needs common.js (t, escapeHtml, categoryLabel, weekdayShort, hhmm).

function dayMonth(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}

// "So 10.10. 18:00" — the chip on an upcoming match.
function chipDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${weekdayShort(d)} ${d.getDate()}.${d.getMonth() + 1}. ${hhmm(d)}`;
}

function secTitle(label, note, linkHref, linkText) {
  return `<div class="home-sec-title"><span class="l">${escapeHtml(label)}${note ? `<span>${escapeHtml(note)}</span>` : ''}</span>${linkHref ? `<a href="${linkHref}">${escapeHtml(linkText)}</a>` : ''}</div>`;
}

// scoreSummary lists each set as player1-player2 ("1-6, 3-6"); a result reads better from the winner's side.
function winnerScore(m, winnerIsP1) {
  const text = m.scoreSummary || '';
  if (winnerIsP1) return text;
  return text.split(', ').map((set) => set.replace(/^(\d+)-(\d+)/, '$2-$1')).join(', ');
}

function resultRow(m) {
  const winnerIsP1 = m.winnerId === m.player1.id;
  const w = winnerIsP1 ? m.player1 : m.player2;
  const l = winnerIsP1 ? m.player2 : m.player1;
  const walkover = m.endReason === 'WALKOVER';
  const sets = m.state && m.state.setsWon ? m.state.setsWon : {};
  const ws = Number(sets[winnerIsP1 ? 1 : 2]) || 0;
  const ls = Number(sets[winnerIsP1 ? 2 : 1]) || 0;
  const where = m.group ? m.group.name : categoryLabel(m.category);
  const when = dayMonth(m.scheduledAt || m.endTime);
  return `
  <a class="home-m-row" href="/match/${m.token}">
    <div><div class="n"><span class="w">${escapeHtml(w.name)}</span> · ${escapeHtml(l.name)}</div><div class="s">${escapeHtml([where, when].filter(Boolean).join(' · '))}</div></div>
    <div class="r">${walkover ? 'w/o' : `${ws} : ${ls}`}<small>${escapeHtml(walkover ? t('home.walkover') : winnerScore(m, winnerIsP1))}</small></div>
  </a>`;
}

function upcomingRow(m) {
  const where = m.group ? m.group.name : categoryLabel(m.category);
  return `
  <a class="home-m-row" href="/match/${m.token}">
    <div><div class="n"><b>${escapeHtml(m.player1.name)}</b> · ${escapeHtml(m.player2.name)}</div><div class="s">${escapeHtml([where, m.location].filter(Boolean).join(' · '))}</div></div>
    ${m.scheduledAt ? `<span class="home-chip date">${escapeHtml(chipDate(m.scheduledAt))}</span>` : `<span class="home-mine-dim">${escapeHtml(t('home.mineNoDate'))}</span>`}
  </a>`;
}

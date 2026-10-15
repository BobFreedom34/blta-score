// Head-to-head helpers shared by the match page (the compact "Vzájomné" card) and the player profile (the "Rivali" card).
// Both work on a list of matches as the API sends them (GET /api/matches?playerId=…&status=FINISHED) — a match counts when it was finished
// with a winner and was not a walkover or an unfinished one. Needs common.js (t, escapeHtml, currentLang).

function h2hCountable(m) {
  return !!m && m.status === 'FINISHED' && !!m.winnerId && m.endReason !== 'WALKOVER' && m.endReason !== 'UNFINISHED';
}

function h2hDate(m) {
  return m.endTime || m.scheduledAt || m.startTime || m.createdAt || '';
}

// "4. 10." — the day of a meeting, without the year (the dots and the last-match line say which year by being recent).
function h2hDay(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getDate()}. ${d.getMonth() + 1}.`;
}

// scoreSummary lists each set as player1-player2 ("1-6, 3-6"): from the winner's side it reads "6-1, 6-3".
function h2hScoreFromWinner(m) {
  const text = m.scoreSummary || '';
  return m.winnerId === m.player1.id ? text : h2hSwapScore(text);
}

function h2hSwapScore(text) {
  return text.split(', ').map((set) => set.replace(/^(\d+)-(\d+)/, '$2-$1')).join(', ');
}

// The record of player a against player b (and the other way round), from a list of matches; `excludeToken` leaves one match out (the one
// being looked at). recent: up to five meetings, oldest first, each { aWon, date, score, winnerName }.
function h2hSummary(matches, a, b, excludeToken) {
  const meetings = matches
    .filter((m) => h2hCountable(m) && m.token !== excludeToken)
    .filter((m) => (m.player1.id === a.id && m.player2.id === b.id) || (m.player1.id === b.id && m.player2.id === a.id))
    .sort((x, y) => new Date(h2hDate(x)) - new Date(h2hDate(y)));
  const aWins = meetings.filter((m) => m.winnerId === a.id).length;
  const recent = meetings.slice(-5).map((m) => ({
    aWon: m.winnerId === a.id,
    date: h2hDate(m),
    score: h2hScoreFromWinner(m),
    winnerName: m.winnerId === a.id ? a.name : b.name,
  }));
  return { aWins, bWins: meetings.length - aWins, total: meetings.length, recent, last: recent[recent.length - 1] || null };
}

// "1 zápas", "3 zápasy", "5 zápasov" (Slovak plural forms) / "5 matches"
function h2hMeetingsText(n) {
  if (currentLang !== 'sk') return t('h2h.meetingsMany', { n });
  if (n === 1) return t('h2h.meetingsOne', { n });
  if (n >= 2 && n <= 4) return t('h2h.meetingsFew', { n });
  return t('h2h.meetingsMany', { n });
}

// The compact card on the match page: the record, the number of meetings, the last result, the last five as dots and the green/red bar.
// The record and the dots are from player 1's side (the first name in the match's title).
function h2hCompactHtml(p1, p2, sum) {
  const pct = Math.round((sum.aWins / sum.total) * 100);
  const color = sum.aWins > sum.bWins ? 'var(--status-green)' : sum.aWins < sum.bWins ? '#e5483a' : '#8b8f98';
  const last = sum.last ? t('h2h.last', { name: escapeHtml(sum.last.winnerName), score: escapeHtml(sum.last.score), date: escapeHtml(h2hDay(sum.last.date)) }) : '';
  const dots = sum.recent.map((r) => {
    const title = `${r.winnerName} ${r.score} (${h2hDay(r.date)})`;
    return `<span class="h2hc-dot ${r.aWon ? 'w' : 'l'}" title="${escapeHtml(title)}">${t(r.aWon ? 'h2h.win' : 'h2h.loss')}</span>`;
  }).join('');
  return `
    <div class="h2hc" title="${escapeHtml(t('h2h.fromSide', { name: p1.name }))}">
      <div class="h2hc-row">
        <div class="h2hc-text"><span class="h2hc-label">${t('h2h.label')}</span> <span class="h2hc-score" style="color:${color}">${sum.aWins} — ${sum.bWins}</span> <span class="h2hc-meta">· ${h2hMeetingsText(sum.total)}${last ? ` · ${last}` : ''}</span></div>
        <div class="h2hc-dots">${dots}</div>
      </div>
      <div class="h2hc-bar"><i style="width:${pct}%"></i><i class="l" style="width:${100 - pct}%"></i></div>
    </div>
  `;
}

// ---------- "Rivali" on the player profile ----------

function h2hRecords(matches, playerId) {
  const byOpponent = new Map();
  matches.filter(h2hCountable).sort((x, y) => new Date(h2hDate(x)) - new Date(h2hDate(y))).forEach((m) => {
    const mine = m.player1.id === playerId ? 1 : m.player2.id === playerId ? 2 : 0;
    if (!mine) return;
    const opponent = mine === 1 ? m.player2 : m.player1;
    const rec = byOpponent.get(opponent.id) || { opponent, wins: 0, losses: 0, setsFor: 0, setsAgainst: 0, last: null };
    const won = m.winnerId === playerId;
    if (won) rec.wins += 1; else rec.losses += 1;
    const sets = (m.state && m.state.setsWon) || {};
    rec.setsFor += Number(sets[mine]) || 0;
    rec.setsAgainst += Number(sets[mine === 1 ? 2 : 1]) || 0;
    rec.last = { won, date: h2hDate(m), score: won ? h2hScoreFromWinner(m) : h2hSwapScore(h2hScoreFromWinner(m)) };
    byOpponent.set(opponent.id, rec);
  });
  return [...byOpponent.values()].map((r) => ({ ...r, total: r.wins + r.losses }));
}

// Up to four tiles, each a different opponent: the biggest rival (loses most to), the favourite (wins most against), the closest rivalry
// and the opponent met most often. A tile that nobody qualifies for is left out.
function h2hRivalTiles(matches, playerId) {
  const records = h2hRecords(matches, playerId);
  const used = new Set();
  const take = (kind, filter, better) => {
    const found = records.filter((r) => !used.has(r.opponent.id) && filter(r)).sort(better)[0];
    if (!found) return null;
    used.add(found.opponent.id);
    return { kind, ...found };
  };
  const byTotal = (a, b) => b.total - a.total;
  return [
    take('nemesis', (r) => r.losses >= 2 && r.losses > r.wins, (a, b) => (b.losses - a.losses) || byTotal(a, b)),
    take('favourite', (r) => r.wins >= 2 && r.wins > r.losses, (a, b) => (b.wins - a.wins) || byTotal(a, b)),
    take('closest', (r) => r.total >= 3 && Math.abs(r.wins - r.losses) <= 1, (a, b) => (Math.abs(a.wins - a.losses) - Math.abs(b.wins - b.losses)) || byTotal(a, b)),
    take('mostPlayed', (r) => r.total >= 3, byTotal),
  ].filter(Boolean);
}

function h2hRivalTileHtml(tile) {
  const link = `/player/${tile.opponent.slug || tile.opponent.id}`;
  const record = tile.kind === 'mostPlayed' ? h2hMeetingsText(tile.total) : `${tile.wins} — ${tile.losses}`;
  let detail;
  if (tile.kind === 'closest') detail = t('rivals.sets', { a: tile.setsFor, b: tile.setsAgainst });
  else if (tile.kind === 'mostPlayed') detail = t('rivals.balance', { w: tile.wins, l: tile.losses });
  else detail = t(tile.last.won ? 'rivals.lastWin' : 'rivals.lastLoss', { score: escapeHtml(tile.last.score), date: escapeHtml(h2hDay(tile.last.date)) });
  return `
    <a class="rival-tile ${tile.kind}" href="${link}">
      <div class="rival-label">${t(`rivals.${tile.kind}`)}</div>
      <div class="rival-who">${escapeHtml(tile.opponent.name)}</div>
      <div class="rival-rec">${record}</div>
      <small>${detail}</small>
    </a>
  `;
}

function h2hRivalsCardHtml(tiles) {
  if (!tiles.length) return '';
  return `
    <div class="section-label">${t('rivals.title')}</div>
    <div class="rivals-card">${tiles.map(h2hRivalTileHtml).join('')}</div>
  `;
}

// Group standings, calculated from the matches tagged with a group (see seasons/season_groups in db.js).
//
// Points: a 2-0 win is 3 points (loser 0); a 2-1 win is 2 points for the winner and 1 for the loser.
// Table columns: points, matches played, wins, losses, set difference ("+/-").
// A walkover is booked as a 2-0 win for the player who got it.
// Order: points; then, when exactly two players are level on points, their head-to-head match; then set
// difference, wins and game difference. Players whose numbers are all equal share a position.
// (The league's "overall BLTA ranking" tiebreak sits between wins and game difference; it is not used yet.)
//
// Everything here is a pure function of the match list, so the tables can never drift from the matches:
// they are recalculated on every request.

function sideSets(record) {
  const won = record.setsWon || {};
  return { 1: Number(won[1]) || 0, 2: Number(won[2]) || 0 };
}

// Games for the tiebreaker: a set counts as its games; a super tie-break (a 10-point race) counts as one game.
function gameCounts(record) {
  let g1 = 0;
  let g2 = 0;
  for (const set of record.sets || []) {
    if (set.isSuperTiebreak) {
      if (set.winner === 1) g1 += 1;
      else if (set.winner === 2) g2 += 1;
    } else {
      g1 += Number(set.p1) || 0;
      g2 += Number(set.p2) || 0;
    }
  }
  return { 1: g1, 2: g2 };
}

// record: { player1Id, player2Id, winnerId, status, endReason, state: { setsWon, sets } }
// Returns { winnerSide, sets1, sets2, games1, games2, pts1, pts2 } or null when the match doesn't count
// (not finished, no winner, or marked unfinished).
function scoreRecord(record) {
  if (record.status !== 'FINISHED' || !record.winnerId || record.endReason === 'UNFINISHED') return null;
  const winnerSide = record.winnerId === record.player1Id ? 1 : record.winnerId === record.player2Id ? 2 : 0;
  if (!winnerSide) return null;
  const state = record.state || {};
  let { 1: sets1, 2: sets2 } = sideSets(state);
  // A walkover (or any result with no sets on the board) is booked as a 2-0 win.
  if (sets1 === 0 && sets2 === 0) {
    sets1 = winnerSide === 1 ? 2 : 0;
    sets2 = winnerSide === 2 ? 2 : 0;
  }
  const loserSets = winnerSide === 1 ? sets2 : sets1;
  const winnerPts = loserSets === 0 ? 3 : 2;
  const loserPts = loserSets === 0 ? 0 : 1;
  const games = gameCounts(state);
  return {
    winnerSide,
    sets1,
    sets2,
    games1: games[1],
    games2: games[2],
    pts1: winnerSide === 1 ? winnerPts : loserPts,
    pts2: winnerSide === 2 ? winnerPts : loserPts,
  };
}

// matches: every match tagged with ONE group (any status) — the scheduled ones put their players on the
// table with zeros. players: Map or object id -> { id, name, slug }.
function computeGroupStandings(matches, players) {
  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) {
      rows.set(id, { playerId: id, points: 0, played: 0, wins: 0, losses: 0, setsFor: 0, setsAgainst: 0, gamesFor: 0, gamesAgainst: 0 });
    }
    return rows.get(id);
  };
  const h2h = new Map(); // `${a}|${b}` -> points a took off b

  for (const m of matches) {
    row(m.player1Id);
    row(m.player2Id);
    const r = scoreRecord(m);
    if (!r) continue;
    const a = row(m.player1Id);
    const b = row(m.player2Id);
    a.played += 1;
    b.played += 1;
    a.points += r.pts1;
    b.points += r.pts2;
    a.setsFor += r.sets1; a.setsAgainst += r.sets2;
    b.setsFor += r.sets2; b.setsAgainst += r.sets1;
    a.gamesFor += r.games1; a.gamesAgainst += r.games2;
    b.gamesFor += r.games2; b.gamesAgainst += r.games1;
    if (r.winnerSide === 1) { a.wins += 1; b.losses += 1; } else { b.wins += 1; a.losses += 1; }
    h2h.set(`${m.player1Id}|${m.player2Id}`, (h2h.get(`${m.player1Id}|${m.player2Id}`) || 0) + r.pts1);
    h2h.set(`${m.player2Id}|${m.player1Id}`, (h2h.get(`${m.player2Id}|${m.player1Id}`) || 0) + r.pts2);
  }

  const list = [...rows.values()].map((x) => ({
    ...x,
    setDiff: x.setsFor - x.setsAgainst,
    gameDiff: x.gamesFor - x.gamesAgainst,
    player: (players instanceof Map ? players.get(x.playerId) : players[x.playerId]) || { id: x.playerId, name: `#${x.playerId}`, slug: null },
  }));

  // Head-to-head only decides a tie between exactly two players: the points they took off each other.
  const byPoints = new Map();
  list.forEach((x) => { if (!byPoints.has(x.points)) byPoints.set(x.points, []); byPoints.get(x.points).push(x); });
  byPoints.forEach((block) => {
    block.forEach((x) => {
      const other = block.length === 2 ? block.find((y) => y !== x) : null;
      x.h2hPoints = other ? (h2h.get(`${x.playerId}|${other.playerId}`) || 0) : 0;
    });
  });

  const compare = (x, y) =>
    (y.points - x.points)
    || (y.h2hPoints - x.h2hPoints)
    || (y.setDiff - x.setDiff)
    || (y.wins - x.wins)
    || (y.gameDiff - x.gameDiff)
    || String(x.player.name).localeCompare(String(y.player.name), 'sk');
  list.sort(compare);

  // Position: players with identical numbers on every compared column share a position.
  const same = (x, y) => x.points === y.points && x.h2hPoints === y.h2hPoints && x.setDiff === y.setDiff && x.wins === y.wins && x.gameDiff === y.gameDiff;
  list.forEach((x, i) => { x.position = i > 0 && same(list[i - 1], x) ? list[i - 1].position : i + 1; });
  return list;
}

module.exports = { computeGroupStandings, scoreRecord };

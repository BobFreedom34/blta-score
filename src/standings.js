// Group standings, calculated from the matches tagged with a group (see seasons/season_groups in db.js).
//
// Points: a 2-0 win is 3 points (loser 0); a 2-1 win is 2 points for the winner and 1 for the loser.
// Table columns: points, matches played, wins, losses, set difference ("+/-").
// A walkover is always 3 points for the player who got it (0 for the other), booked as a 2-0 win.
// Each pair of players counts once: the first finished match between them (by date). Later meetings — play-offs,
// and the same match entered twice — don't add to the table.
// Order (as on the blta.sk tables): points, then set difference, then wins. Players level on all three share a
// position; within such a block the list order falls back to the head-to-head match (when exactly two are level),
// game difference and name — that order is only cosmetic, the position number is the same.
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

// The rules a tournament can choose (the league's tables use the BLTA scoring and the order described at the top):
// scoring BLTA = 3 / 2 / 1 / 0 as described above, WIN2 = 2 points for a win and 0 for a loss, WIN1 = 1 point for a win and 0 for a loss.
// Tie-break conditions, tried in the chosen order for players level on points: H2H = the match between them (only when exactly two are
// level), SETS = set difference, WINS = number of wins, GAMES = game difference. Players level on every one share a position.
const SCORING = ['BLTA', 'WIN2', 'WIN1'];
const DEFAULT_TIEBREAKERS = ['H2H', 'SETS', 'WINS', 'GAMES'];

// {scoring, tiebreakers} from whatever is stored (a comma text or a list); a bad value falls back, a repeated condition counts once and
// a missing one goes to the end, so the list always holds all four.
function normalizeRules(rules) {
  const r = rules || {};
  const scoring = SCORING.includes(r.scoring) ? r.scoring : 'BLTA';
  const asked = (Array.isArray(r.tiebreakers) ? r.tiebreakers : String(r.tiebreakers || '').split(',')).map((s) => String(s).trim()).filter((s) => DEFAULT_TIEBREAKERS.includes(s));
  const tiebreakers = [...new Set(asked)];
  DEFAULT_TIEBREAKERS.forEach((k) => { if (!tiebreakers.includes(k)) tiebreakers.push(k); });
  return { scoring, tiebreakers };
}

// record: { player1Id, player2Id, winnerId, status, endReason, date, state: { setsWon, sets } }
// Returns { winnerSide, sets1, sets2, games1, games2, pts1, pts2 } or null when the match doesn't count
// (not finished, no winner, or marked unfinished).
function scoreRecord(record, scoring = 'BLTA') {
  if (record.status !== 'FINISHED' || !record.winnerId || record.endReason === 'UNFINISHED') return null;
  const winnerSide = record.winnerId === record.player1Id ? 1 : record.winnerId === record.player2Id ? 2 : 0;
  if (!winnerSide) return null;
  const state = record.state || {};
  let { 1: sets1, 2: sets2 } = sideSets(state);
  // A walkover (or any result with no sets on the board) is booked as a 2-0 win.
  const walkover = record.endReason === 'WALKOVER';
  if (walkover || (sets1 === 0 && sets2 === 0)) {
    sets1 = winnerSide === 1 ? 2 : 0;
    sets2 = winnerSide === 2 ? 2 : 0;
  }
  const loserSets = winnerSide === 1 ? sets2 : sets1;
  let winnerPts = loserSets === 0 ? 3 : 2;
  let loserPts = loserSets === 0 ? 0 : 1;
  if (scoring === 'WIN2') { winnerPts = 2; loserPts = 0; }
  if (scoring === 'WIN1') { winnerPts = 1; loserPts = 0; }
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
// table with zeros. players: Map or object id -> { id, name, slug }. rules: a tournament's { scoring, tiebreakers } (see normalizeRules);
// without it the table is calculated the league's way.
function computeGroupStandings(matches, players, rules) {
  const chosen = rules ? normalizeRules(rules) : null;
  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) {
      rows.set(id, { playerId: id, points: 0, played: 0, wins: 0, losses: 0, setsFor: 0, setsAgainst: 0, gamesFor: 0, gamesAgainst: 0 });
    }
    return rows.get(id);
  };
  const h2h = new Map(); // `${a}|${b}` -> points a took off b

  matches.forEach((m) => { row(m.player1Id); row(m.player2Id); });
  const byDate = [...matches].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const counted = new Set();
  for (const m of byDate) {
    const r = scoreRecord(m, chosen ? chosen.scoring : 'BLTA');
    if (!r) continue;
    const pair = m.player1Id < m.player2Id ? `${m.player1Id}-${m.player2Id}` : `${m.player2Id}-${m.player1Id}`;
    if (counted.has(pair)) continue;
    counted.add(pair);
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

  if (chosen) return rankByRules(list, chosen.tiebreakers, h2h);

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
    || (y.setDiff - x.setDiff)
    || (y.wins - x.wins)
    || (y.h2hPoints - x.h2hPoints)
    || (y.gameDiff - x.gameDiff)
    || String(x.player.name).localeCompare(String(y.player.name), 'sk');
  list.sort(compare);

  // Position: players with identical numbers on every compared column share a position.
  const same = (x, y) => x.points === y.points && x.setDiff === y.setDiff && x.wins === y.wins;
  list.forEach((x, i) => { x.position = i > 0 && same(list[i - 1], x) ? list[i - 1].position : i + 1; });
  return list;
}

// The table of a tournament: points first, then the conditions in the chosen order. Each condition splits the players still level into
// smaller blocks; what no condition separates stays one block and shares a position (listed by name, which is only for the eye).
function rankByRules(list, conditions, h2h) {
  const keyOf = { SETS: (x) => x.setDiff, WINS: (x) => x.wins, GAMES: (x) => x.gameDiff };
  const split = (block, remaining) => {
    if (block.length === 1 || !remaining.length) return [block];
    const [condition, ...rest] = remaining;
    if (condition === 'H2H') {
      if (block.length !== 2) return split(block, rest);
      const [a, b] = block;
      const pa = h2h.get(`${a.playerId}|${b.playerId}`) || 0;
      const pb = h2h.get(`${b.playerId}|${a.playerId}`) || 0;
      return pa === pb ? split(block, rest) : [[pa > pb ? a : b], [pa > pb ? b : a]];
    }
    const key = keyOf[condition];
    const sorted = [...block].sort((x, y) => key(y) - key(x));
    const groups = [];
    sorted.forEach((x) => {
      const last = groups[groups.length - 1];
      if (last && key(last[0]) === key(x)) last.push(x); else groups.push([x]);
    });
    return groups.flatMap((g) => split(g, rest));
  };
  const byPoints = [...list].sort((x, y) => y.points - x.points);
  const levels = [];
  byPoints.forEach((x) => {
    const last = levels[levels.length - 1];
    if (last && last[0].points === x.points) last.push(x); else levels.push([x]);
  });
  const out = [];
  levels.flatMap((level) => split(level, conditions)).forEach((block) => {
    const position = out.length + 1;
    [...block].sort((x, y) => String(x.player.name).localeCompare(String(y.player.name), 'sk')).forEach((x) => { x.position = position; out.push(x); });
  });
  return out;
}

// the rules a season row asks for: a season or tournament that has chosen them; null (the league's way) for a season that has not
function rulesOfSeason(season) {
  return season && season.scoring ? normalizeRules({ scoring: season.scoring, tiebreakers: season.tiebreakers }) : null;
}

module.exports = { computeGroupStandings, scoreRecord, normalizeRules, rulesOfSeason, SCORING, DEFAULT_TIEBREAKERS };

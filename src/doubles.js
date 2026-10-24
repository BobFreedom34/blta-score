// Doubles (štvorhra): the statistics and the ranking of the doubles matches. A doubles match is a normal match (src/routes/matches.js) with
// is_doubles = 1: player1_id / player2_id are the first player of each side and player1b_id / player2b_id their partners. Nothing here is
// stored: the numbers are worked out from the finished doubles matches each time, so a corrected score corrects the ranking at once.
//
// The ranking is per player (the best doubles players whoever they play with): a win is worth POINTS_WIN, a played loss POINTS_LOSS, for each
// of the two players of the side. Doubles never touch the singles ranking points, CourtIQ or badges.
const db = require('./db');
const engine = require('./matchEngine');

const POINTS_WIN = 3;
const POINTS_LOSS = 1;

// the finished doubles matches of one city that count (a match left unfinished never does), oldest first, with the side that won
function countedMatches(leagueId) {
  const rows = db.prepare(`
    SELECT * FROM matches
    WHERE is_doubles = 1 AND status = 'FINISHED' AND league_id = ? AND (end_reason IS NULL OR end_reason != 'UNFINISHED')
    ORDER BY COALESCE(scheduled_at, end_time, updated_at), id
  `).all(leagueId);
  const out = [];
  rows.forEach((row) => {
    let state;
    try { state = JSON.parse(row.state); } catch { return; }
    const winnerSide = state.winner === 1 || state.winner === 2 ? state.winner : (row.winner_id === row.player1_id ? 1 : row.winner_id === row.player2_id ? 2 : null);
    if (!winnerSide) return;
    out.push({ row, state, winnerSide });
  });
  return out;
}

const sidesOf = (row) => [[row.player1_id, row.player1b_id], [row.player2_id, row.player2b_id]];
const setsOf = (state, side) => (state.sets || []).filter((s) => s && s.winner === side).length;

function blank() {
  return { played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, points: 0, lastPlayedAt: null };
}

// every player's numbers: Map(playerId -> { played, wins, losses, setsWon, setsLost, points, lastPlayedAt })
function statsByPlayer(leagueId) {
  const stats = new Map();
  const get = (id) => { if (!stats.has(id)) stats.set(id, blank()); return stats.get(id); };
  countedMatches(leagueId).forEach(({ row, state, winnerSide }) => {
    const when = row.scheduled_at || row.end_time || row.updated_at || null;
    sidesOf(row).forEach((ids, i) => {
      const side = i + 1;
      const won = winnerSide === side;
      ids.filter(Boolean).forEach((id) => {
        const s = get(id);
        s.played += 1;
        if (won) { s.wins += 1; s.points += POINTS_WIN; } else { s.losses += 1; s.points += POINTS_LOSS; }
        s.setsWon += setsOf(state, side);
        s.setsLost += setsOf(state, side === 1 ? 2 : 1);
        if (when && (!s.lastPlayedAt || when > s.lastPlayedAt)) s.lastPlayedAt = when;
      });
    });
  });
  return stats;
}

// the doubles ranking of a city: points, then wins, then fewer matches played (the same points from fewer matches is better), then name
function ranking(leagueId) {
  const stats = statsByPlayer(leagueId);
  if (!stats.size) return [];
  const players = db.prepare('SELECT id, name, slug, nationality FROM players WHERE id IN (' + [...stats.keys()].map(() => '?').join(',') + ')').all(...stats.keys());
  const byId = new Map(players.map((p) => [p.id, p]));
  const rows = [...stats.entries()].filter(([id]) => byId.has(id)).map(([id, s]) => ({ playerId: id, name: byId.get(id).name, slug: byId.get(id).slug, nationality: byId.get(id).nationality || null, ...s }));
  rows.sort((a, b) => b.points - a.points || b.wins - a.wins || a.played - b.played || a.name.localeCompare(b.name, 'sk'));
  let rank = 0;
  let last = null;
  return rows.map((r, i) => {
    const key = `${r.points}:${r.wins}:${r.played}`;
    if (key !== last) { rank = i + 1; last = key; }
    return { rank, ...r };
  });
}

// one player's doubles: the totals, the partners (most played first) and the latest matches
function playerSummary(playerId, leagueId) {
  const mine = countedMatches(leagueId).filter(({ row }) => [row.player1_id, row.player2_id, row.player1b_id, row.player2b_id].includes(playerId));
  const names = new Map(db.prepare('SELECT id, name, slug FROM players').all().map((p) => [p.id, p]));
  const total = blank();
  const partners = new Map();
  const matches = [];
  mine.forEach(({ row, state, winnerSide }) => {
    const sides = sidesOf(row);
    const side = sides[0].includes(playerId) ? 1 : 2;
    const won = winnerSide === side;
    const partnerId = sides[side - 1].find((id) => id && id !== playerId) || null;
    total.played += 1;
    if (won) { total.wins += 1; total.points += POINTS_WIN; } else { total.losses += 1; total.points += POINTS_LOSS; }
    total.setsWon += setsOf(state, side);
    total.setsLost += setsOf(state, side === 1 ? 2 : 1);
    if (partnerId) {
      if (!partners.has(partnerId)) partners.set(partnerId, { playerId: partnerId, name: (names.get(partnerId) || {}).name || '', slug: (names.get(partnerId) || {}).slug || null, played: 0, wins: 0, losses: 0 });
      const p = partners.get(partnerId);
      p.played += 1;
      if (won) p.wins += 1; else p.losses += 1;
    }
    const nameOf = (id) => (names.get(id) || {}).name || '';
    matches.push({
      token: row.share_token, date: row.scheduled_at || row.end_time || row.updated_at, won,
      partner: nameOf(partnerId),
      opponents: sides[side === 1 ? 1 : 0].filter(Boolean).map(nameOf),
      score: engine.describeMatch(state),
    });
  });
  const list = [...partners.values()].sort((a, b) => b.played - a.played || b.wins - a.wins || a.name.localeCompare(b.name, 'sk'));
  const place = ranking(leagueId).find((r) => r.playerId === playerId);
  return { ...total, rank: place ? place.rank : null, partners: list, matches: matches.reverse().slice(0, 10) };
}

module.exports = { POINTS_WIN, POINTS_LOSS, ranking, playerSummary, statsByPlayer };

// Doubles (štvorhra): the statistics and the ranking of the doubles matches. A doubles match is a normal match (src/routes/matches.js) with
// is_doubles = 1: player1_id / player2_id are the first player of each side and player1b_id / player2b_id their partners. Nothing here is
// stored: the numbers are worked out from the finished doubles matches each time, so a corrected score corrects the ranking at once.
//
// The ranking is per player (the best doubles players whoever they play with): a win is worth POINTS_WIN, a played loss POINTS_LOSS, for each
// of the two players of the side. Doubles never touch the singles ranking points, CourtIQ or badges.
//
// Besides the points there is a doubles rating of its own (ratings()): the same Glicko-2 maths as CourtIQ (src/courtIQEngine.js), but every
// player is rated against the AVERAGE of the opposing pair, so a doubles result moves each of the four players on their own rating. It is a
// separate number from the singles CourtIQ, which doubles never touch. pairs() ranks the pairs themselves (who plays well TOGETHER).
const db = require('./db');
const clubTournaments = require('./clubTournaments');
const engine = require('./matchEngine');
const courtIQ = require('./courtIQEngine');

const POINTS_WIN = 3;
const POINTS_LOSS = 1;

// the finished doubles matches of one city that count (a match left unfinished never does), oldest first, with the side that won
function countedMatches(leagueId) {
  const rows = db.prepare(`
    SELECT * FROM matches
    WHERE is_doubles = 1 AND status = 'FINISHED' AND league_id = ? AND (end_reason IS NULL OR end_reason != 'UNFINISHED') AND ${clubTournaments.countingSql()}
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

// ---- the doubles rating ----------------------------------------------------------------------------------------------------------------
// Replays the finished doubles matches of a city in the order they were played. A walkover decided no tennis, so it does not move a rating
// (it still counts in the points above). Returns Map(playerId -> { rating, deviation, volatility, lastMatchAt, gamesPlayed }).
// `capture` (optional) is called after each match with the match row and what it did to its four players: [{ id, before, after }].
function ratingStates(leagueId, capture) {
  const states = new Map();
  const stateOf = (id) => {
    if (!states.has(id)) states.set(id, { ...courtIQ.defaultRatingState(), lastMatchAt: null, gamesPlayed: 0 });
    return states.get(id);
  };
  countedMatches(leagueId).forEach(({ row, state, winnerSide }) => {
    if (row.end_reason === 'WALKOVER') return;
    const matchDate = row.scheduled_at || row.end_time || row.updated_at || row.created_at;
    if (!matchDate) return;
    const sides = sidesOf(row).map((ids) => ids.filter(Boolean));
    const before = sides.map((ids) => ids.map((id) => ({ id, ...stateOf(id) })));
    // the opposing pair as one player: the average rating and deviation of its members
    const average = (members) => ({
      rating: members.reduce((a, m) => a + m.rating, 0) / members.length,
      deviation: members.reduce((a, m) => a + m.deviation, 0) / members.length,
      volatility: members.reduce((a, m) => a + m.volatility, 0) / members.length,
      lastMatchAt: null,
    });
    const updates = [];
    sides.forEach((ids, i) => {
      const opponent = average(before[i === 0 ? 1 : 0]);
      before[i].forEach((me) => {
        const mine = { rating: me.rating, deviation: me.deviation, volatility: me.volatility, lastMatchAt: me.lastMatchAt };
        const result = i === 0
          ? courtIQ.processMatch({ player1: mine, player2: opponent, winner: winnerSide, sets: state.sets || [], matchDate }).player1
          : courtIQ.processMatch({ player1: opponent, player2: mine, winner: winnerSide, sets: state.sets || [], matchDate }).player2;
        updates.push([me.id, result, me.gamesPlayed, me.rating]);
      });
    });
    // everybody is updated from the ratings BEFORE this match, then all four are written
    updates.forEach(([id, result, games]) => states.set(id, { ...result, lastMatchAt: matchDate, gamesPlayed: games + 1 }));
    if (capture) capture(row, updates.map(([id, result, , was]) => ({ id, before: was, after: result.rating })));
  });
  return states;
}

// What one finished doubles match did to the doubles rating of its four players: [{ id, before, after }] (raw ratings), or [] when it did
// not move any (a walkover, an unfinished match, a match that is not finished)
function matchRatingChanges(row) {
  let found = [];
  ratingStates(row.league_id, (r, changes) => { if (r.id === row.id) found = changes; });
  return found;
}

const publicRating = (st) => (st ? {
  rating: Math.round(st.rating),
  band: Number(courtIQ.ratingToBand(st.rating).toFixed(1)),
  provisional: courtIQ.isProvisional(st.deviation, st.gamesPlayed),
  gamesPlayed: st.gamesPlayed,
} : null);

// every rated player of a city, highest rating first (a tie shares the rank)
function ratings(leagueId) {
  const states = ratingStates(leagueId);
  if (!states.size) return [];
  const players = db.prepare('SELECT id, name, slug, nationality FROM players WHERE id IN (' + [...states.keys()].map(() => '?').join(',') + ')').all(...states.keys());
  const byId = new Map(players.map((p) => [p.id, p]));
  const rows = [...states.entries()].filter(([id]) => byId.has(id)).map(([id, st]) => ({
    playerId: id, name: byId.get(id).name, slug: byId.get(id).slug, nationality: byId.get(id).nationality || null, ...publicRating(st), raw: st.rating,
  }));
  rows.sort((a, b) => b.raw - a.raw || a.name.localeCompare(b.name, 'sk'));
  let rank = 0;
  let last = null;
  return rows.map((r, i) => {
    if (r.rating !== last) { rank = i + 1; last = r.rating; }
    const { raw, ...rest } = r;
    return { rank, ...rest };
  });
}

// ---- the pairs ----------------------------------------------------------------------------------------------------------------------------
// A pair is the two players who played one side together, whoever was first. Same points as the player ranking, for the pair as a whole
// (a win 3, a played loss 1): who plays well TOGETHER, not just who wins.
function pairs(leagueId) {
  const map = new Map();
  countedMatches(leagueId).forEach(({ row, state, winnerSide }) => {
    sidesOf(row).forEach((ids, i) => {
      const members = ids.filter(Boolean);
      if (members.length !== 2) return;
      const sorted = members.slice().sort((a, b) => a - b);
      const key = sorted.join('-');
      if (!map.has(key)) map.set(key, { ids: sorted, ...blank() });
      const p = map.get(key);
      const side = i + 1;
      const won = winnerSide === side;
      p.played += 1;
      if (won) { p.wins += 1; p.points += POINTS_WIN; } else { p.losses += 1; p.points += POINTS_LOSS; }
      p.setsWon += setsOf(state, side);
      p.setsLost += setsOf(state, side === 1 ? 2 : 1);
    });
  });
  if (!map.size) return [];
  const names = new Map(db.prepare('SELECT id, name, slug FROM players').all().map((p) => [p.id, p]));
  const rows = [...map.values()].map((p) => {
    const members = p.ids.map((id) => names.get(id) || { id, name: '', slug: null });
    members.sort((a, b) => a.name.localeCompare(b.name, 'sk'));
    return {
      players: members.map((m) => ({ playerId: m.id, name: m.name, slug: m.slug })),
      name: members.map((m) => m.name).join(' / '),
      played: p.played, wins: p.wins, losses: p.losses, setsWon: p.setsWon, setsLost: p.setsLost, points: p.points,
    };
  });
  rows.sort((a, b) => b.points - a.points || b.wins - a.wins || a.played - b.played || a.name.localeCompare(b.name, 'sk'));
  let rank = 0;
  let last = null;
  return rows.map((r, i) => {
    const key = `${r.points}:${r.wins}:${r.played}`;
    if (key !== last) { rank = i + 1; last = key; }
    return { rank, ...r };
  });
}

// the doubles ranking of a city: points, then wins, then fewer matches played (the same points from fewer matches is better), then name
function ranking(leagueId) {
  const stats = statsByPlayer(leagueId);
  if (!stats.size) return [];
  const players = db.prepare('SELECT id, name, slug, nationality FROM players WHERE id IN (' + [...stats.keys()].map(() => '?').join(',') + ')').all(...stats.keys());
  const byId = new Map(players.map((p) => [p.id, p]));
  const rated = ratingStates(leagueId);
  const rows = [...stats.entries()].filter(([id]) => byId.has(id)).map(([id, s]) => ({
    playerId: id, name: byId.get(id).name, slug: byId.get(id).slug, nationality: byId.get(id).nationality || null, ...s, doublesRating: publicRating(rated.get(id)),
  }));
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
      p.winRate = Math.round((p.wins / p.played) * 100);
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
  const rating = publicRating(ratingStates(leagueId).get(playerId));
  const ratingPlace = ratings(leagueId).find((r) => r.playerId === playerId);
  // the partner it works best with: at least two matches together, then the best share of wins
  const best = list.filter((p) => p.played >= 2).sort((a, b) => b.winRate - a.winRate || b.played - a.played)[0] || null;
  return {
    ...total, rank: place ? place.rank : null, rating, ratingRank: ratingPlace ? ratingPlace.rank : null,
    partners: list, bestPartner: best, matches: matches.reverse().slice(0, 10),
  };
}

module.exports = { POINTS_WIN, POINTS_LOSS, ranking, ratings, pairs, playerSummary, statsByPlayer, matchRatingChanges };

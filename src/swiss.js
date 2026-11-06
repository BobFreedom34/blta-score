// The Swiss system of a tournament category (format SWISS): everybody plays the same number of rounds against opponents who are about as good as they are, nobody meets
// the same opponent twice, and nobody is knocked out. The players are one group (a table, like the groups of a tournament, src/tournamentGroups.js); the matches of a
// round are the matches of that group tagged with the round, and the next round is made once every match of the round is played (src/tournamentDraw.js calls
// afterMatch, the organiser can also make it by hand).
//   - round 1: the players in the order of the seeding (the others by lot), the first half against the second (1 v 5, 2 v 6 ... of 8): the best meet the weakest;
//   - the next rounds: by the table (points, then Buchholz = the points of the opponents played, then the conditions of the tournament), the best player without an opponent
//     yet against the best one he has not played, and so on; where that cannot work out, the pairs shift (a small search that never makes a rematch);
//   - an odd number of players: one of them has no opponent in a round - a bye: the points of a win, never twice for the same player, the lowest of the table first;
//   - the number of rounds: the logarithm of the number of players rounded up (8 players 3 rounds, 16 players 4), at least 2, the organiser can change it;
//   - at the end the table is the final standing (players level on everything share a place).
const db = require('./db');
const groups = require('./tournamentGroups');

const MIN_PLAYERS = 4;

// the rounds suggested for a number of players: at least 2, at most one less than the players (nobody can play everybody more than once)
function roundsFor(playerCount) {
  return Math.max(1, Math.min(playerCount - 1, Math.max(2, Math.ceil(Math.log2(Math.max(2, playerCount))))));
}

// The first round: the order of the players, the first half against the second half; with an odd number the last one has the bye. -> { pairs: [[a, b]], bye }
function firstRound(order) {
  const bye = order.length % 2 ? order[order.length - 1] : null;
  const list = bye === null ? order : order.slice(0, -1);
  const half = list.length / 2;
  return { pairs: list.slice(0, half).map((p, i) => [p, list[i + half]]), bye };
}

// The pairs of a later round. order: the players, best first; played: a Set of "a-b" (the smaller id first) of the pairs that met already; hadBye: a Set of players who had a bye.
// -> { pairs: [[a, b]], bye } or null when no round without a rematch exists.
function pairRound(order, played, hadBye) {
  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  let steps = 0;
  function solve(list) {
    if (!list.length) return [];
    steps += 1;
    if (steps > 50000) return null; // (a search that has gone too far: give up on this branch)
    const [p, ...rest] = list;
    for (let i = 0; i < rest.length; i += 1) {
      const q = rest[i];
      if (played.has(key(p, q))) continue;
      const tail = solve(rest.filter((_, j) => j !== i));
      if (tail) return [[p, q], ...tail];
    }
    return null;
  }
  if (order.length % 2 === 0) {
    const pairs = solve(order);
    return pairs ? { pairs, bye: null } : null;
  }
  for (let i = order.length - 1; i >= 0; i -= 1) { // the bye goes to the lowest player of the table who has not had one
    if (hadBye.has(order[i])) continue;
    steps = 0;
    const pairs = solve(order.filter((_, j) => j !== i));
    if (pairs) return { pairs, bye: order[i] };
  }
  return null;
}

const settingsRow = (seasonId, category) => db.prepare('SELECT * FROM tournament_categories WHERE season_id = ? AND category = ?').get(seasonId, category);

// How far a Swiss draw is: { groupId, round, rounds, roundFinished, canMakeNext, finished, bye } or null when the category has no Swiss draw.
function state(seasonId, category) {
  const tc = settingsRow(seasonId, category);
  if (!tc || tc.format !== 'SWISS') return null;
  const group = groups.groupsOf(seasonId, category)[0];
  if (!group) return null;
  const round = db.prepare("SELECT COALESCE(MAX(round), 0) AS r FROM matches WHERE group_id = ? AND COALESCE(stage, 'GROUP') = 'GROUP'").get(group.id).r;
  const counts = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('FINISHED', 'UNFINISHED') THEN 1 ELSE 0 END) AS done FROM matches WHERE group_id = ? AND round = ? AND COALESCE(stage, 'GROUP') = 'GROUP'").get(group.id, round);
  const roundFinished = counts.total > 0 && counts.done === counts.total;
  const bye = db.prepare('SELECT p.id, p.name FROM season_group_byes b JOIN players p ON p.id = b.player_id WHERE b.group_id = ? AND b.round = ?').get(group.id, round);
  return {
    groupId: group.id, round, rounds: tc.rounds, roundFinished, bye: bye ? { id: bye.id, name: bye.name } : null,
    canMakeNext: roundFinished && round < tc.rounds, finished: roundFinished && round >= tc.rounds,
  };
}

// Makes the next round (the organiser's button, or by itself once the last match of a round is played). -> { status, error } | { round, matches, bye }
function nextRound(season, category) {
  const st = typeof category === 'string' && category ? state(season.id, category) : null;
  if (!st) return { status: 400, error: 'This category has no Swiss draw' };
  if (!st.roundFinished) return { status: 409, error: `The matches of round ${st.round} are not all played yet` };
  if (st.round >= st.rounds) return { status: 409, error: 'All the rounds are played' };
  const group = groups.groupsOf(season.id, category)[0];
  const format = settingsRow(season.id, category).group_format;
  const order = groups.groupRows(group).filter((r) => r.player).map((r) => r.player.id); // the table, best first
  const played = new Set();
  db.prepare("SELECT player1_id AS a, player2_id AS b FROM matches WHERE group_id = ? AND COALESCE(stage, 'GROUP') = 'GROUP'").all(group.id).forEach((m) => played.add(m.a < m.b ? `${m.a}-${m.b}` : `${m.b}-${m.a}`));
  const hadBye = new Set(db.prepare('SELECT player_id FROM season_group_byes WHERE group_id = ?').all(group.id).map((r) => r.player_id));
  const made = pairRound(order, played, hadBye);
  if (!made) return { status: 409, error: 'No next round without a rematch exists: the Swiss draw has no more rounds to give' };
  const round = st.round + 1;
  db.exec('BEGIN');
  try {
    made.pairs.forEach(([p1, p2]) => groups.insertGroupMatch(season, category, group.id, round, p1, p2, format));
    if (made.bye !== null) db.prepare('INSERT INTO season_group_byes (group_id, round, player_id) VALUES (?, ?, ?)').run(group.id, round, made.bye);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  require('./bracketEngine').planCourtsForSeason(season.id);
  return { round, matches: made.pairs.length, bye: made.bye };
}

// Called when a match of a group finished: the round is over and the draw is made to go on by itself -> the next round is made. Never throws.
function afterMatch(season, category) {
  try {
    const tc = settingsRow(season.id, category);
    if (!tc || tc.format !== 'SWISS' || !tc.auto_bracket || tc.mode !== 'AUTO') return;
    const st = state(season.id, category);
    if (st && st.canMakeNext) nextRound(season, category);
  } catch (err) {
    console.error('[swiss]', err.message);
  }
}

module.exports = { MIN_PLAYERS, roundsFor, firstRound, pairRound, state, nextRound, afterMatch };

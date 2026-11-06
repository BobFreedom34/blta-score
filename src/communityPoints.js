// The points the events of a community or club put into ITS OWN ranking (the tab Rebríček of the community, table organisation_ranking) — never into the league's
// tables (src/rankingPoints.js, which stays as it is). The organiser sets them in the card of the event (Základné info > Body do rebríčka):
//   - a season (kind LEAGUE): a coefficient for each category; a finished match is worth what it is worth in the TABLE of the season (src/standings.js scoreRecord, by the
//     scoring chosen under Bodovanie a podmienky: BLTA = 3 / 2 / 1 / 0 for a win 2:0, a win 2:1, a loss 1:2, a loss 0:2; WIN2 = 2 for a win, 0 for a loss; WIN1 = 1 for a win,
//     0 for a loss) times the coefficient, to both players
//       { "coefficient": { "ELITE": 10, "NEXT_GEN": 7, "NOVICE": 4 } }
//   - a tournament: how many points each PLACE of the final standings is worth (places 1 to 10), for each category; paid once the standings of the category are
//     complete (src/finalStandings.js); players who share a place get the points of the best one
//       { "places": { "ELITE": [100, 80, 60, ...], "OPEN": [...] } }
// Stored as JSON in seasons.community_points; nothing set = nothing added (an event without settings behaves as it always did). The points of a community can still be set
// by hand by its admin: the awards are added to what is there.
// Every award is written to the ledger organisation_ranking_awards, so a corrected, restarted or deleted result takes back exactly what it added before anything new is
// awarded: every function here is safe to call any number of times.
const db = require('./db');

const CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const PLACES = 10;
const MAX_POINTS = 100000;
const MAX_COEFFICIENT = 1000;

const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const seasonRow = (id) => db.prepare('SELECT * FROM seasons WHERE id = ?').get(id);
const isTournament = (season) => !!season && season.kind === 'TOURNAMENT';

// the settings of an event as an object ({} when none are saved or they cannot be read)
function settingsOf(season) {
  if (!season || !season.community_points) return {};
  try {
    const parsed = JSON.parse(season.community_points);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// the categories an event is played in (a tournament without categories: OPEN)
function categoriesOf(season) {
  if (season.categories === 'OPEN') return ['OPEN'];
  const list = String(season.categories || '').split(',').filter((c) => CATEGORIES.includes(c));
  return list.length ? list : CATEGORIES;
}

// a request's settings -> { error } | { value: the JSON to store, or null for "nothing set" }.
// A season takes `coefficient`, a tournament `places`; a number is a whole number (0 = pays nothing); a tournament has up to PLACES numbers per category.
function readSettings(raw, season) {
  if (raw === null) return { value: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'The ranking points must be an object' };
  const whole = (n, max) => (typeof n === 'number' || (typeof n === 'string' && n.trim() !== '')) && Number.isInteger(Number(n)) && Number(n) >= 0 && Number(n) <= max;
  const allowed = categoriesOf(season);
  const out = {};
  if (isTournament(season)) {
    const places = raw.places && typeof raw.places === 'object' ? raw.places : {};
    out.places = {};
    for (const [category, list] of Object.entries(places)) {
      if (!allowed.includes(category)) return { error: `The category ${category} is not played in this tournament` };
      if (!Array.isArray(list) || list.length > PLACES) return { error: `A category has up to ${PLACES} places` };
      if (!list.every((n) => whole(n, MAX_POINTS))) return { error: `The points are whole numbers from 0 to ${MAX_POINTS}` };
      const numbers = list.map(Number);
      while (numbers.length && !numbers[numbers.length - 1]) numbers.pop(); // (zeros at the end pay nothing, not stored)
      if (numbers.length) out.places[category] = numbers;
    }
    if (!Object.keys(out.places).length) return { value: null };
  } else {
    const coefficient = raw.coefficient && typeof raw.coefficient === 'object' ? raw.coefficient : {};
    out.coefficient = {};
    for (const [category, n] of Object.entries(coefficient)) {
      if (!allowed.includes(category)) return { error: `The category ${category} is not played in this season` };
      if (!whole(n, MAX_COEFFICIENT)) return { error: `The coefficient is a whole number from 0 to ${MAX_COEFFICIENT}` };
      if (Number(n) > 0) out.coefficient[category] = Number(n);
    }
    if (!Object.keys(out.coefficient).length) return { value: null };
  }
  return { value: JSON.stringify(out) };
}

// ---------------------------------------------------------------- the ledger

function inTransaction(fn) {
  if (db.isTransaction) return fn(); // (called from inside the transaction of a caller: its commit or rollback is ours too)
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// takes back the points of the ledger rows asked for (a where clause with its params) and removes the rows; a ranking never goes below 0
function takeBack(where, ...params) {
  const rows = db.prepare(`SELECT * FROM organisation_ranking_awards WHERE ${where}`).all(...params);
  const undo = db.prepare(`UPDATE organisation_ranking SET points = MAX(0, points - ?), updated_at = ${now} WHERE organisation_id = ? AND player_id = ?`);
  rows.forEach((r) => undo.run(r.points, r.organisation_id, r.player_id));
  if (rows.length) db.prepare(`DELETE FROM organisation_ranking_awards WHERE ${where}`).run(...params);
  return rows.length;
}

function give(season, matchId, playerId, points, kind) {
  if (!(points > 0)) return;
  db.prepare(`
    INSERT INTO organisation_ranking (organisation_id, player_id, points) VALUES (?, ?, ?)
    ON CONFLICT(organisation_id, player_id) DO UPDATE SET points = points + excluded.points, updated_at = ${now}
  `).run(season.organisation_id, playerId, points);
  db.prepare('INSERT INTO organisation_ranking_awards (organisation_id, season_id, match_id, player_id, points, kind) VALUES (?, ?, ?, ?, ?, ?)')
    .run(season.organisation_id, season.id, matchId, playerId, points, kind);
}

// ---------------------------------------------------------------- a match of a season

// What a finished match is worth: [{ playerId, points }, { playerId, points }] or null. The points of the match in the table of the season (by the scoring the season chose,
// the league's BLTA scoring when it chose none; a walkover counts as a clean 2:0, as in the table) times the coefficient. A doubles match earns nothing.
function matchWorth(row, season, coefficient) {
  const { scoreRecord, rulesOfSeason } = require('./standings');
  if (row.is_doubles) return null;
  let state;
  try { state = JSON.parse(row.state); } catch { return null; }
  const rules = rulesOfSeason(season);
  const r = scoreRecord({ player1Id: row.player1_id, player2Id: row.player2_id, winnerId: row.winner_id, status: row.status, endReason: row.end_reason, state }, rules ? rules.scoring : 'BLTA');
  if (!r) return null;
  return [{ playerId: row.player1_id, points: r.pts1 * coefficient }, { playerId: row.player2_id, points: r.pts2 * coefficient }];
}

// brings the points of one match in line with it as it is now (what it added before is taken back first)
function syncMatch(matchId) {
  inTransaction(() => {
    takeBack("match_id = ? AND kind = 'MATCH'", matchId);
    const row = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
    const season = row && row.season_id ? seasonRow(row.season_id) : null;
    if (!season || !season.organisation_id || isTournament(season)) return;
    // (the matches of a season without categories are of the category OTHER)
    const category = String(row.category || '').toUpperCase();
    const coefficient = (settingsOf(season).coefficient || {})[category === 'OTHER' ? 'OPEN' : category];
    if (!(coefficient > 0)) return;
    (matchWorth(row, season, coefficient) || []).forEach((w) => give(season, matchId, w.playerId, w.points, 'MATCH'));
  });
}

// ---------------------------------------------------------------- the places (a tournament)

// For every category whose final standings are complete the player on place n gets the n-th number (players who share a place get the points of the best one).
// What the tournament paid before is taken back first, so a corrected result moves the points to the right players.
function refreshTournament(seasonId) {
  const season = seasonRow(seasonId);
  if (!season || !season.organisation_id || !isTournament(season)) return;
  inTransaction(() => {
    takeBack("season_id = ? AND kind = 'PLACE'", season.id);
    const places = settingsOf(season).places;
    if (!places || season.play_type === 'DOUBLES') return;
    const { sections } = require('./finalStandings').compute(season);
    sections.forEach((section) => {
      const table = places[section.category];
      if (!table || !section.complete) return;
      if (sections.filter((s) => s.category === section.category).length !== 1) return; // (several tables of one category: the places are not clear)
      section.rows.forEach((r) => {
        if (!r.player || !r.player.id || r.stage === 'PLAYING') return;
        give(season, null, r.player.id, table[r.from - 1], 'PLACE');
      });
    });
  });
}

// ---------------------------------------------------------------- the hooks

// a match was written (see rankingPoints.reconcile): a season pays by its matches, a tournament by its standings
function afterMatch(matchId) {
  const row = db.prepare('SELECT season_id FROM matches WHERE id = ?').get(matchId);
  const season = row && row.season_id ? seasonRow(row.season_id) : null;
  if (!season || !season.organisation_id) { takeBack("match_id = ? AND kind = 'MATCH'", matchId); return; }
  if (isTournament(season)) refreshTournament(season.id);
  else syncMatch(matchId);
}

// a match is about to be deleted: what it added goes back at once; the standings of its tournament are worked out once the match is gone
function beforeMatchDeleted(matchId) {
  const row = db.prepare('SELECT season_id FROM matches WHERE id = ?').get(matchId);
  takeBack("match_id = ? AND kind = 'MATCH'", matchId);
  const season = row && row.season_id ? seasonRow(row.season_id) : null;
  if (season && season.organisation_id && isTournament(season)) setImmediate(() => { try { refreshTournament(season.id); } catch (err) { console.error('[community points]', err.message); } });
}

// the settings of an event were saved: everything it pays is worked out again (what it paid under the old settings goes back, the finished matches pay under the new)
function resync(seasonId) {
  const season = seasonRow(seasonId);
  if (!season || !season.organisation_id) return;
  if (isTournament(season)) { refreshTournament(season.id); return; }
  inTransaction(() => takeBack("season_id = ? AND kind = 'MATCH'", season.id));
  db.prepare("SELECT id FROM matches WHERE season_id = ? AND status = 'FINISHED'").all(season.id).forEach((m) => syncMatch(m.id));
}

// an event was deleted: what it paid goes back
function removeSeason(seasonId) {
  inTransaction(() => takeBack('season_id = ?', seasonId));
}

// Express middleware for the routers whose requests can change the standings of a tournament without a match (a result typed into a bracket, a draw made or deleted):
// the season is worked out from the request when it starts (a deleted bracket is gone afterwards), the places are paid again once the answer is out (only a tournament
// of a community; a season pays by its matches). find(req) -> a season id.
function afterChanges(find) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    let seasonId = null;
    try { seasonId = find(req); } catch { seasonId = null; }
    if (seasonId) {
      res.on('finish', () => {
        if (res.statusCode >= 400) return;
        try { refreshTournament(seasonId); } catch (err) { console.error('[community points]', err.message); }
      });
    }
    next();
  };
}

module.exports = { CATEGORIES, PLACES, MAX_POINTS, MAX_COEFFICIENT, settingsOf, readSettings, categoriesOf, syncMatch, refreshTournament, afterMatch, beforeMatchDeleted, resync, removeSeason, afterChanges };

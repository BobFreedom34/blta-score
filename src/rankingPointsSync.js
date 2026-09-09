// Pushes a finished match's BLTA league ranking points (BLTA Body + the
// category's own race points) into the "BLTA GENERAL" table on blta.sk,
// via the sportspress-sheets-importer plugin's own
// POST /wp-json/ssi/v1/push-ranking-points endpoint — see that plugin's
// README for exactly what it does and doesn't touch (short version: it
// ADDS points to two players' bltabody + category race columns on one
// already-existing sp_table post, on top of whatever's already there; it
// never creates anything, and does nothing rather than guess for an
// unranked category or an unresolved player/score).
//
// pushRankingPoints() returns the exact {tableId, raceKey, awards} it was
// given credit for (or null if nothing was awarded) — the caller
// (routes/matches.js) persists that as matches.ranking_points_snapshot, so
// a later correction, un-finish, or delete can call reverseRankingPoints()
// with that exact snapshot to undo precisely what was added, before
// awarding anything new. Without this round trip there would be no way to
// know how many points a given match previously contributed.
//
// Fire-and-forget, same pattern as pushResultToSportsPress's own call
// sites in routes/matches.js — most matches (FRIENDLY, VIP_CUP, a category
// this endpoint doesn't recognize) simply earn no points, and that's a
// completely normal, expected response, not an error. This never blocks
// or fails the actual match-finishing flow either way.
//
// Uses the SAME SPORTSPRESS_* env vars as sportspressSync.js — both hit
// the same WordPress plugin/site.
const SPORTSPRESS_URL = process.env.SPORTSPRESS_SITE_URL; // e.g. https://www.blta.sk
const SPORTSPRESS_USER = process.env.SPORTSPRESS_API_USER;
const SPORTSPRESS_APP_PASSWORD = process.env.SPORTSPRESS_API_APP_PASSWORD;

function isConfigured() {
  return !!(SPORTSPRESS_URL && SPORTSPRESS_USER && SPORTSPRESS_APP_PASSWORD);
}

function authHeader() {
  const auth = Buffer.from(`${SPORTSPRESS_USER}:${SPORTSPRESS_APP_PASSWORD}`).toString('base64');
  return { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` };
}

function endpoint(path) {
  return `${SPORTSPRESS_URL.replace(/\/+$/, '')}/wp-json/ssi/v1/${path}`;
}

// `match` is a raw matches table row (needs .state, .category), `player1`/
// `player2` the corresponding player rows. Returns the snapshot to persist
// on success, or null (not configured, nothing decided, or a normal no-op
// like an unranked category — logged either way, never an exception).
async function pushRankingPoints(match, player1, player2) {
  if (!isConfigured()) return null;

  let state;
  try {
    state = JSON.parse(match.state);
  } catch {
    return null;
  }
  const setsWon = state.setsWon || {};
  const player1Sets = Number(setsWon[1] || 0);
  const player2Sets = Number(setsWon[2] || 0);
  // 0-0 means nothing was actually decided by sets (e.g. a walkover before
  // a single game was played) — nothing meaningful to award.
  if (player1Sets === 0 && player2Sets === 0) return null;

  const body = {
    player1_name: player1.name,
    player2_name: player2.name,
    player1_sets: player1Sets,
    player2_sets: player2Sets,
    category: match.category,
  };

  try {
    const res = await fetch(endpoint('push-ranking-points'), {
      method: 'POST',
      headers: authHeader(),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[rankingPointsSync] push-ranking-points HTTP error:', res.status, data.message || data.error || '');
      return null;
    }
    if ('updated' === data.status) {
      console.log(`[rankingPointsSync] awarded ranking points on table #${data.table_id} (${match.category}: ${player1.name} ${player1Sets}-${player2Sets} ${player2.name})`);
      return { tableId: data.table_id, raceKey: data.race_key, awards: data.awards };
    }
    // category_not_ranked / unrecognized_score / player_not_found /
    // table_not_found / error — all expected, non-exceptional outcomes
    // for a match this endpoint doesn't award points for. Logged for
    // visibility, nothing more.
    console.warn(`[rankingPointsSync] push-ranking-points: ${data.status} — ${data.message || ''}`);
    return null;
  } catch (err) {
    console.error('[rankingPointsSync] push-ranking-points failed:', err.message);
    return null;
  }
}

// Undoes a previous pushRankingPoints() award, given the exact snapshot it
// returned (as persisted on the match row) — subtracts those same numbers
// back off, rather than recomputing anything. Returns true on success
// (including a normal no-op like the table having since been deleted),
// false on a real failure — the caller decides whether that's worth
// retrying or just logging.
async function reverseRankingPoints(snapshot) {
  if (!isConfigured() || !snapshot) return false;
  const { tableId, raceKey, awards } = snapshot;
  if (!tableId || !raceKey || !awards) return false;

  try {
    const res = await fetch(endpoint('reverse-ranking-points'), {
      method: 'POST',
      headers: authHeader(),
      body: JSON.stringify({ table_id: tableId, race_key: raceKey, awards }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[rankingPointsSync] reverse-ranking-points HTTP error:', res.status, data.message || data.error || '');
      return false;
    }
    if ('reversed' === data.status) {
      console.log(`[rankingPointsSync] reversed ranking points on table #${data.table_id}`);
    } else {
      console.warn(`[rankingPointsSync] reverse-ranking-points: ${data.status} — ${data.message || ''}`);
    }
    return true;
  } catch (err) {
    console.error('[rankingPointsSync] reverse-ranking-points failed:', err.message);
    return false;
  }
}

module.exports = { pushRankingPoints, reverseRankingPoints, isConfigured };

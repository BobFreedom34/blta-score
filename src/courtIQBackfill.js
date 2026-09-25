// The actual replay logic behind scripts/backfillCourtIQ.js — pulled into
// its own module (rather than living only in the script) so the exact same
// function can also be triggered from the admin panel (see
// routes/admin.js's POST /courtiq/backfill) without shelling out to a
// separate process. Always wipes and rebuilds courtiq_ratings/
// courtiq_rating_history from scratch — see courtIQEngine.js's own header
// comment for why a partial/incremental fix isn't a thing for Glicko-2.
//
// Scope, matching what was agreed before this was built: every category
// counts (BLTA and friendly/exhibition alike) toward one single global
// CourtIQ rating per player — a WALKOVER or an UNFINISHED match does not
// count at all (no tennis was actually decided), same convention
// src/badgeEngine.js already uses for badges/stats. A RETIREMENT DOES
// count, using whatever partial score was actually played.
const db = require('./db');
const courtIQ = require('./courtIQEngine');

function matchDateOf(row) {
  return row.scheduled_at || row.start_time || row.created_at;
}

function loadRatableMatches() {
  const rows = db.prepare(`
    SELECT * FROM matches
    WHERE status = 'FINISHED'
      AND winner_id IS NOT NULL
      AND (end_reason IS NULL OR end_reason NOT IN ('WALKOVER', 'UNFINISHED'))
  `).all();
  return rows.sort((a, b) => {
    const dateDiff = new Date(matchDateOf(a)) - new Date(matchDateOf(b));
    return dateDiff !== 0 ? dateDiff : a.id - b.id;
  });
}

// Returns a plain-object summary ({ratedPlayers, ratedMatches, skipped,
// seconds, top}) rather than printing — the CLI script prints it for a
// human, the admin route serializes it as the response's JSON.
function runBackfill() {
  const started = Date.now();
  const matches = loadRatableMatches();

  db.exec('DELETE FROM courtiq_rating_history');
  db.exec('DELETE FROM courtiq_ratings');

  // player_id -> { rating, deviation, volatility, lastMatchAt, gamesPlayed }
  const states = new Map();
  function stateFor(playerId) {
    if (!states.has(playerId)) {
      states.set(playerId, { ...courtIQ.defaultRatingState(), lastMatchAt: null, gamesPlayed: 0 });
    }
    return states.get(playerId);
  }

  const insertHistory = db.prepare(`
    INSERT INTO courtiq_rating_history (player_id, match_id, rating, deviation, volatility)
    VALUES (?, ?, ?, ?, ?)
  `);

  let skipped = 0;
  matches.forEach((row) => {
    let state;
    try {
      state = JSON.parse(row.state);
    } catch {
      skipped += 1;
      return;
    }
    const sets = state.sets || [];
    const winner = row.winner_id === row.player1_id ? 1 : row.winner_id === row.player2_id ? 2 : null;
    if (!winner) {
      skipped += 1;
      return;
    }
    const matchDate = matchDateOf(row);
    if (!matchDate) {
      skipped += 1;
      return;
    }

    const p1Before = stateFor(row.player1_id);
    const p2Before = stateFor(row.player2_id);
    const { player1, player2 } = courtIQ.processMatch({
      player1: p1Before, player2: p2Before, winner, sets, matchDate,
    });

    states.set(row.player1_id, {
      ...player1, lastMatchAt: matchDate, gamesPlayed: p1Before.gamesPlayed + 1,
    });
    states.set(row.player2_id, {
      ...player2, lastMatchAt: matchDate, gamesPlayed: p2Before.gamesPlayed + 1,
    });

    insertHistory.run(row.player1_id, row.id, player1.rating, player1.deviation, player1.volatility);
    insertHistory.run(row.player2_id, row.id, player2.rating, player2.deviation, player2.volatility);
  });

  const insertRating = db.prepare(`
    INSERT INTO courtiq_ratings (player_id, rating, deviation, volatility, games_played, last_match_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  states.forEach((state, playerId) => {
    insertRating.run(playerId, state.rating, state.deviation, state.volatility, state.gamesPlayed, state.lastMatchAt);
  });

  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));

  const top = [...states.entries()]
    .sort((a, b) => b[1].rating - a[1].rating)
    .slice(0, 5)
    .map(([playerId, state]) => ({
      playerId,
      name: db.prepare('SELECT name FROM players WHERE id = ?').get(playerId)?.name || `#${playerId}`,
      rating: Math.round(state.rating),
      band: Number(courtIQ.ratingToBand(state.rating).toFixed(1)),
      provisional: courtIQ.isProvisional(state.deviation, state.gamesPlayed),
    }));

  return {
    ratedPlayers: states.size,
    ratedMatches: matches.length - skipped,
    skipped,
    seconds,
    top,
  };
}

module.exports = { runBackfill };

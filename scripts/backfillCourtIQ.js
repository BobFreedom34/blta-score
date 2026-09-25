// Rebuilds CourtIQ (courtiq_ratings, courtiq_rating_history) from scratch
// by replaying every finished match through src/courtIQEngine.js in
// chronological order — the same functions the live hook in
// routes/matches.js uses for one match at a time, just run over the whole
// history here. Safe to re-run any time: it always starts by wiping both
// tables, never patches them incrementally, which is what makes it safe
// to re-run after tuning a constant in courtIQEngine.js or after
// correcting an old match's score (Glicko-2 is path-dependent — there is
// no cheap way to fix one match's rating without this).
//
// Run it yourself, from the project root:
//
//   node scripts/backfillCourtIQ.js
//
// Scope, matching what was agreed before this was built: every category
// counts (BLTA and friendly/exhibition alike) toward one single global
// CourtIQ rating per player — a WALKOVER or an UNFINISHED match does not
// count at all (no tennis was actually decided), same convention
// src/badgeEngine.js already uses for badges/stats. A RETIREMENT DOES
// count, using whatever partial score was actually played.
const db = require('../src/db');
const courtIQ = require('../src/courtIQEngine');

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

function main() {
  const started = Date.now();
  const matches = loadRatableMatches();
  console.log(`Replaying ${matches.length} finished match(es)...`);

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

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Rated ${states.size} player(s) from ${matches.length - skipped} match(es) in ${seconds}s${skipped ? ` (skipped ${skipped} unresolvable match(es))` : ''}.`);

  const top5 = [...states.entries()]
    .sort((a, b) => b[1].rating - a[1].rating)
    .slice(0, 5);
  if (top5.length) {
    console.log('\nTop 5 by rating:');
    top5.forEach(([playerId, state]) => {
      const name = db.prepare('SELECT name FROM players WHERE id = ?').get(playerId)?.name || `#${playerId}`;
      const band = courtIQ.ratingToBand(state.rating).toFixed(1);
      const provisional = courtIQ.isProvisional(state.deviation, state.gamesPlayed) ? ' (provisional)' : '';
      console.log(`  ${name}: ${state.rating.toFixed(0)} -> CourtIQ ${band}${provisional}`);
    });
  }
}

main();

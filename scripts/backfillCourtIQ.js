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
// The actual replay lives in src/courtIQBackfill.js — this is a thin CLI
// wrapper around it (see that file's own header for scope: which matches
// count, category, etc.) so the admin panel's "Run CourtIQ backfill"
// button (routes/admin.js) can trigger the exact same logic in-process,
// without needing shell access to wherever this is deployed.
const { runBackfill } = require('../src/courtIQBackfill');

const result = runBackfill();
console.log(`Rated ${result.ratedPlayers} player(s) from ${result.ratedMatches} match(es) in ${result.seconds}s${result.skipped ? ` (skipped ${result.skipped} unresolvable match(es))` : ''}.`);
if (result.top.length) {
  console.log('\nTop 5 by rating:');
  result.top.forEach((p) => {
    console.log(`  ${p.name}: ${p.rating} -> CourtIQ ${p.band}${p.provisional ? ' (provisional)' : ''}`);
  });
}

// Read-only display API for CourtIQ (see src/courtIQEngine.js for the
// rating math itself, src/courtIQBackfill.js for how courtiq_ratings/
// courtiq_rating_history get populated). Nothing here writes anything —
// that only ever happens via the live hook in routes/matches.js or the
// admin panel's "Run CourtIQ backfill" button (routes/admin.js).
const express = require('express');
const db = require('../db');
const courtIQ = require('../courtIQEngine');

const router = express.Router();

function toPublicRating(row) {
  if (!row) {
    return {
      rating: null, band: null, provisional: true, gamesPlayed: 0, lastMatchAt: null,
    };
  }
  return {
    rating: Math.round(row.rating),
    band: Number(courtIQ.ratingToBand(row.rating).toFixed(1)),
    provisional: courtIQ.isProvisional(row.deviation, row.games_played),
    gamesPlayed: row.games_played,
    lastMatchAt: row.last_match_at,
  };
}

// The full leaderboard — every BLTA player who's been rated at least
// once, highest rating first. The rating itself is still computed from a
// player's ENTIRE match history (BLTA and Friendly/VIP Cup/ATA Tennis
// alike — see src/courtIQBackfill.js), unchanged; this table just hides
// anyone who's never actually played a finished BLTA (Elite/Next Gen/
// Novice) match, so a player who's only ever played Friendly matches
// doesn't clutter what's meant to read as a BLTA standings table. A
// player who's never played a ratable match at all still simply has no
// courtiq_ratings row and doesn't appear here either way, same "no row
// yet = not shown" convention the rankings/badges tables already use.
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT cr.*, p.name, p.slug, p.nationality
    FROM courtiq_ratings cr
    JOIN players p ON p.id = cr.player_id
    WHERE EXISTS (
      SELECT 1 FROM matches m
      WHERE (m.player1_id = cr.player_id OR m.player2_id = cr.player_id)
        AND m.category IN ('ELITE', 'NEXT_GEN', 'NOVICE')
        AND m.status = 'FINISHED'
    )
    ORDER BY cr.rating DESC
  `).all();

  let rank = 0;
  let lastRating;
  const leaderboard = rows.map((row, i) => {
    const roundedRating = Math.round(row.rating);
    if (roundedRating !== lastRating) { rank = i + 1; lastRating = roundedRating; }
    return {
      rank,
      playerId: row.player_id,
      name: row.name,
      slug: row.slug,
      nationality: row.nationality,
      ...toPublicRating(row),
    };
  });

  res.json({ rows: leaderboard });
});

// One player's current rating plus their full rating-history trend (one
// point per match they were rated in, oldest to newest) — the data behind
// the profile page's CourtIQ trend chart. Never 404s for a player who
// simply hasn't been rated yet (a brand-new player, or one whose only
// matches were walkovers) — same "show the default/empty state, don't
// error" convention badge/stat endpoints already use elsewhere; the
// client tells "not rated yet" apart from "rated" via gamesPlayed === 0.
router.get('/player/:playerId', (req, res) => {
  const playerId = Number(req.params.playerId);
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return res.status(400).json({ error: 'Invalid player id' });
  }

  const current = db.prepare('SELECT * FROM courtiq_ratings WHERE player_id = ?').get(playerId);
  const historyRows = db.prepare(`
    SELECT rating, deviation, created_at, match_id
    FROM courtiq_rating_history
    WHERE player_id = ?
    ORDER BY id ASC
  `).all(playerId);

  res.json({
    ...toPublicRating(current),
    history: historyRows.map((h) => ({
      matchId: h.match_id,
      rating: Math.round(h.rating),
      band: Number(courtIQ.ratingToBand(h.rating).toFixed(1)),
      createdAt: h.created_at,
    })),
  });
});

module.exports = router;

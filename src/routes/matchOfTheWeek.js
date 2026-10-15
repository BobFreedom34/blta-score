// "Zápas týždňa": the most interesting league match of the next 7 days (or one that is live right now), shown highlighted in the
// "Najbližšie zápasy" list on the home page. Chosen by a score, never by hand:
//   a live match            +50
//   category                ELITE +30, NEXT_GEN +20, NOVICE +10
//   CourtIQ rating gap      up to +30, the closer the two players the more (nothing for a player who has no rating yet)
//   head-to-head history    +10 for having met before, up to +20 more the more even the record is
// Friendlies and other non-league categories are never chosen. A tie goes to the earlier match.
const express = require('express');
const db = require('../db');

const router = express.Router();

const LEAGUE_POINTS = { ELITE: 30, NEXT_GEN: 20, NOVICE: 10 };
const WINDOW_DAYS = 7;
const ALREADY_STARTED_MS = 2 * 60 * 60 * 1000; // a planned match that began up to two hours ago still counts
const RATING_GAP_FOR_ZERO = 250;

function h2hOf(player1Id, player2Id) {
  const rows = db.prepare(`
    SELECT winner_id FROM matches
    WHERE status = 'FINISHED' AND winner_id IS NOT NULL AND COALESCE(end_reason, '') NOT IN ('WALKOVER', 'UNFINISHED')
      AND ((player1_id = ? AND player2_id = ?) OR (player1_id = ? AND player2_id = ?))
  `).all(player1Id, player2Id, player2Id, player1Id);
  const p1Wins = rows.filter((r) => r.winner_id === player1Id).length;
  return { p1Wins, p2Wins: rows.length - p1Wins, total: rows.length };
}

function ratingOf(playerId) {
  const row = db.prepare('SELECT rating, games_played FROM courtiq_ratings WHERE player_id = ?').get(playerId);
  return row && row.games_played > 0 ? row.rating : null;
}

function scoreOf(row, h2h) {
  let score = LEAGUE_POINTS[row.category] || 0;
  if (row.status === 'LIVE') score += 50;
  const r1 = ratingOf(row.player1_id);
  const r2 = ratingOf(row.player2_id);
  if (r1 != null && r2 != null) score += 30 * Math.max(0, 1 - Math.abs(r1 - r2) / RATING_GAP_FOR_ZERO);
  if (h2h.total > 0) score += 10 + 20 * (1 - Math.abs(h2h.p1Wins - h2h.p2Wins) / h2h.total);
  return score;
}

// { token, h2h: { p1Wins, p2Wins, total } } for the best match, or null when there is none.
function pick(now = Date.now()) {
  const from = new Date(now - ALREADY_STARTED_MS).toISOString();
  const to = new Date(now + WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT id, share_token, category, player1_id, player2_id, status, scheduled_at FROM matches
    WHERE category IN ('ELITE', 'NEXT_GEN', 'NOVICE')
      AND (status = 'LIVE' OR (status = 'PLANNED' AND scheduled_at IS NOT NULL AND scheduled_at >= ? AND scheduled_at <= ?))
  `).all(from, to);
  let best = null;
  rows.forEach((row) => {
    const h2h = h2hOf(row.player1_id, row.player2_id);
    const score = scoreOf(row, h2h);
    const when = row.scheduled_at || '';
    if (!best || score > best.score || (score === best.score && when < best.when)) best = { row, h2h, score, when };
  });
  return best ? { token: best.row.share_token, h2h: best.h2h } : null;
}

router.get('/', (req, res) => {
  res.json(pick() || { token: null });
});

module.exports = { router, pick };

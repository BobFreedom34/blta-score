// Read-only API of the doubles (štvorhra): the ranking of the city and one player's doubles. Nothing is written here - a doubles match is made
// and scored like any match (src/routes/matches.js, `doubles: true`); the numbers are worked out from the finished ones (src/doubles.js).
const express = require('express');
const db = require('../db');
const leagues = require('../leagues');
const doubles = require('../doubles');

const router = express.Router();

// the ranking of the doubles players of the city (best first)
router.get('/ranking', (req, res) => {
  res.json({ pointsWin: doubles.POINTS_WIN, pointsLoss: doubles.POINTS_LOSS, rows: doubles.ranking(leagues.actingIdOf(req)) });
});

// the doubles rating of the city (highest first) and the pairs that play well together
router.get('/ratings', (req, res) => {
  res.json({ rows: doubles.ratings(leagues.actingIdOf(req)) });
});
router.get('/pairs', (req, res) => {
  res.json({ pointsWin: doubles.POINTS_WIN, pointsLoss: doubles.POINTS_LOSS, rows: doubles.pairs(leagues.actingIdOf(req)) });
});

// one player's doubles: totals, rank, partners and the latest matches (by id or slug; a player with no doubles gets zeros)
router.get('/player/:id', (req, res) => {
  const key = req.params.id;
  const player = /^\d+$/.test(key)
    ? db.prepare('SELECT id, name, slug FROM players WHERE id = ?').get(Number(key))
    : db.prepare('SELECT id, name, slug FROM players WHERE slug = ?').get(key);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  res.json({ player, ...doubles.playerSummary(player.id, leagues.actingIdOf(req)) });
});

module.exports = router;

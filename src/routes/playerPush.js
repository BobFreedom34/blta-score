// /api/player/push/*: a logged-in player turns the automatic push of the bell and of the messages on or off for one device.
// Needs a real player (an admin without a player cookie has no bell, so no push).
const express = require('express');
const auth = require('../auth');
const db = require('../db');
const playerPush = require('../playerPush');

const router = express.Router();

function needPlayer(req, res) {
  const playerId = auth.getPlayerId(req);
  if (!playerId || !db.prepare('SELECT 1 FROM players WHERE id = ?').get(playerId)) {
    res.status(401).json({ error: 'Please log in as a player to do this' });
    return null;
  }
  return playerId;
}

// whether push can work on this server at all, and whether the device that asks (by its endpoint) is subscribed
router.get('/status', (req, res) => {
  const playerId = needPlayer(req, res);
  if (!playerId) return;
  res.json({ available: playerPush.available(), subscribed: playerPush.isSubscribed(playerId, req.query.endpoint) });
});

router.post('/subscribe', (req, res) => {
  const playerId = needPlayer(req, res);
  if (!playerId) return;
  if (!playerPush.subscribe(playerId, req.body && req.body.subscription, req.body && req.body.lang)) {
    return res.status(400).json({ error: 'This device cannot receive notifications' });
  }
  res.status(201).json({ ok: true });
});

router.post('/unsubscribe', (req, res) => {
  const playerId = needPlayer(req, res);
  if (!playerId) return;
  playerPush.unsubscribe(playerId, req.body && req.body.endpoint);
  res.json({ ok: true });
});

module.exports = router;

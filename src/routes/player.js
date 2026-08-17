const express = require('express');
const auth = require('../auth');

const router = express.Router();

router.get('/session', (req, res) => {
  res.json({ isPlayer: auth.isPlayer(req) });
});

router.post('/login', (req, res) => {
  const code = String(req.body.code || '').trim();
  if (!process.env.PLAYER_CODE) {
    return res.status(500).json({ error: 'Player login is not configured on this server (PLAYER_CODE is unset)' });
  }
  if (code !== process.env.PLAYER_CODE) {
    return res.status(401).json({ error: 'Incorrect code' });
  }
  auth.logInPlayer(res);
  res.json({ isPlayer: true });
});

router.post('/logout', (req, res) => {
  auth.logOutPlayer(res);
  res.json({ isPlayer: false });
});

module.exports = router;

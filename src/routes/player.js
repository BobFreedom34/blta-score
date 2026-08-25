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

// Separate login for editing profile bio info — its own code (PROFILE_CODE
// env var), independent of PLAYER_CODE above.
router.get('/profile-session', (req, res) => {
  res.json({ isProfileEditor: auth.isProfileEditor(req) });
});

router.post('/profile-login', (req, res) => {
  const code = String(req.body.code || '').trim();
  if (!process.env.PROFILE_CODE) {
    return res.status(500).json({ error: 'Profile editing login is not configured on this server (PROFILE_CODE is unset)' });
  }
  if (code !== process.env.PROFILE_CODE) {
    return res.status(401).json({ error: 'Incorrect code' });
  }
  auth.logInProfileEditor(res);
  res.json({ isProfileEditor: true });
});

router.post('/profile-logout', (req, res) => {
  auth.logOutProfileEditor(res);
  res.json({ isProfileEditor: false });
});

module.exports = router;

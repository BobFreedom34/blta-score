const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();

// Builds the { isPlayer, isAnon, playerId, playerName, playerSlug } shape
// every session-reporting response shares. Takes the logged-in player's
// row directly rather than re-reading it off req's cookies, since a route
// that just called auth.logInPlayer() won't see that cookie reflected in
// req.signedCookies until the *next* request — cookies set on the response
// don't retroactively appear on the request that set them.
function sessionInfo({ isPlayerFlag, isAnon, player }) {
  return {
    isPlayer: isPlayerFlag,
    isAnon,
    playerId: player ? player.id : null,
    playerName: player ? player.name : null,
    playerSlug: player ? player.slug : null,
  };
}

router.get('/session', (req, res) => {
  const playerId = auth.getPlayerId(req);
  const player = playerId ? db.prepare('SELECT id, name, slug FROM players WHERE id = ?').get(playerId) : null;
  res.json(sessionInfo({ isPlayerFlag: auth.isPlayer(req), isAnon: auth.isAnon(req), player }));
});

// Digits only — everything else (spaces, dashes, a leading +, a country
// code) is irrelevant once samePhone below only looks at the last 6.
function normalizePhone(raw) {
  return String(raw || '').replace(/\D/g, '');
}

// True if the last 6 digits match. Deliberately loose (not a full-number
// or even a last-9-digit compare) so a player can log in regardless of how
// their number was entered on file — spaces, a missing leading 0, a
// country code, etc. Trade-off: two players who happen to share their last
// 6 digits would each be able to log in as either — accepted as unlikely
// enough given real Slovak mobile numbers.
function samePhone(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length >= 6 && nb.length >= 6 && na.slice(-6) === nb.slice(-6);
}

// One input, two possible outcomes: a real player's own phone number logs
// them in as that specific player (see checkMatchAccess in
// routes/matches.js for what that scopes them to — only matches they play
// in that an admin created, or matches they created themselves), while
// ANON_CODE (given to anyone without a real BLTA account) logs in as the
// limited anonymous tier — see requireLoggedIn in routes/matches.js.
router.post('/login', (req, res) => {
  const raw = String(req.body.code || '').trim();
  const digitCount = raw.replace(/\D/g, '').length;
  // A short numeric guess (like the 4-digit ANON_CODE) isn't worth a full
  // table scan/comparison — only attempt a phone match once it's long
  // enough to plausibly be one.
  if (digitCount >= 6) {
    const candidates = db.prepare('SELECT id, name, slug, phone FROM players WHERE phone IS NOT NULL').all();
    const player = candidates.find((p) => samePhone(p.phone, raw));
    if (player) {
      auth.logInPlayer(res, player.id);
      return res.json(sessionInfo({ isPlayerFlag: true, isAnon: false, player }));
    }
    return res.status(401).json({ error: "That phone number isn't on file — ask an admin to add it on your Players page entry" });
  }
  if (process.env.ANON_CODE && raw === process.env.ANON_CODE) {
    auth.logInAnon(res);
    return res.json(sessionInfo({ isPlayerFlag: false, isAnon: true, player: null }));
  }
  res.status(401).json({ error: 'Incorrect phone number or code' });
});

router.post('/logout', (req, res) => {
  auth.logOutPlayer(res);
  auth.logOutAnon(res);
  res.json({ isPlayer: false, isAnon: false, playerId: null, playerName: null, playerSlug: null });
});

module.exports = router;

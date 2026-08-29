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

// Digits (and a leading '+') only, then Slovakia's +421/00421 country code
// folded to the domestic 0-prefix form — "+421 903 111 222" and
// "0903111222" are the same number. Many players' numbers here were
// entered on blta.sk long before this login system existed, in whatever
// format they typed (spaces, missing leading 0, full international for
// non-Slovak players), so matching has to tolerate that instead of
// expecting one canonical stored format.
function normalizePhone(raw) {
  let s = String(raw || '').trim().replace(/[^\d+]/g, '');
  if (s.startsWith('00421')) s = `0${s.slice(5)}`;
  else if (s.startsWith('+421')) s = `0${s.slice(4)}`;
  return s;
}

// True if two phone strings are the same number once normalized — either
// an exact match (covers non-Slovak numbers, which normalizePhone can't
// re-map a country code for), or the same last 9 digits (a Slovak mobile
// number's significant digits, however its country-code/leading-0 prefix
// was written).
function samePhone(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.length >= 9 && nb.length >= 9 && na.slice(-9) === nb.slice(-9);
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

// Separate login for editing profile bio info — its own code (PROFILE_CODE
// env var), independent of a player's own phone-number login above.
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

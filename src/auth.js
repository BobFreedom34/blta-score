const crypto = require('crypto');

const COOKIE_NAME = 'blta_admin';
const PLAYER_COOKIE_NAME = 'blta_player';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const isSecure = (process.env.PUBLIC_URL || '').startsWith('https://');

// A player's login PIN (routes/player.js) is stored as "<salt>:<hash>",
// both hex — scrypt + a random per-player salt rather than a plain
// comparison, since unlike ADMIN_PASSWORD (one shared secret living only
// in an env var) this is a per-player secret that actually lives in the
// database.
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPin(pin, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(pin, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  // timingSafeEqual throws on a length mismatch rather than just returning
  // false, so guard it explicitly (only possible if login_pin was ever
  // written by anything other than hashPin above).
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function cookieOptions() {
  return {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    maxAge: MAX_AGE_MS,
  };
}

function isAdmin(req) {
  return req.signedCookies && req.signedCookies[COOKIE_NAME] === 'ok';
}

function logIn(res) {
  res.cookie(COOKIE_NAME, 'ok', cookieOptions());
}

function logOut(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(401).json({ error: 'Admin login required for this action' });
  }
  next();
}

// A specific player, identified by their phone number at login (see
// routes/player.js) — the cookie holds that player's id, not just a
// boolean, so match-editing rights can be scoped to "this player" instead
// of "any player" (see checkMatchAccess in routes/matches.js). Signed, so
// a client can't forge a different id into it without the server's secret.
function getPlayerId(req) {
  const raw = req.signedCookies && req.signedCookies[PLAYER_COOKIE_NAME];
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// True for an admin OR any specific logged-in player — admin implies
// player, so admins never need to separately log in as one. Used where a
// route just needs "some real identity", with the finer per-match/per-
// player scoping happening afterward once the specific row is loaded.
function isPlayer(req) {
  return isAdmin(req) || getPlayerId(req) !== null;
}

function logInPlayer(res, playerId) {
  res.cookie(PLAYER_COOKIE_NAME, String(playerId), cookieOptions());
}

function logOutPlayer(res) {
  res.clearCookie(PLAYER_COOKIE_NAME, cookieOptions());
}

function requirePlayer(req, res, next) {
  if (!isPlayer(req)) {
    return res.status(401).json({ error: 'Please log in as a player to do this' });
  }
  next();
}

// Gate for a route that's open to a real player or admin — the actual
// per-match ownership check happens afterward, once the specific row is
// loaded (see checkMatchAccess in routes/matches.js). There used to be a
// third, more limited "anonymous" login tier here (a shared code, for
// someone with no real BLTA player account) that this also accepted — it's
// been removed entirely: only a real player (a phone number on file) or an
// admin can log in at all now.
function requireLoggedIn(req, res, next) {
  if (!isPlayer(req)) {
    return res.status(401).json({ error: 'Please log in to do this' });
  }
  next();
}

module.exports = {
  COOKIE_NAME, PLAYER_COOKIE_NAME, isAdmin, logIn, logOut, requireAdmin,
  isPlayer, getPlayerId, logInPlayer, logOutPlayer, requirePlayer,
  requireLoggedIn, hashPin, verifyPin,
};

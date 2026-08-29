const COOKIE_NAME = 'blta_admin';
const PLAYER_COOKIE_NAME = 'blta_player';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const isSecure = (process.env.PUBLIC_URL || '').startsWith('https://');

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

// Third, more limited login tier — its own shared code (ANON_CODE), for
// someone with no real BLTA player code. Unlike isPlayer, this does NOT
// imply general match-management rights: an anon session can only manage
// matches it created itself (see created_by_anonymous / requireLoggedIn in
// routes/matches.js) — everything else stays off-limits.
const ANON_COOKIE_NAME = 'blta_anon';

function isAnon(req) {
  return req.signedCookies && req.signedCookies[ANON_COOKIE_NAME] === 'ok';
}

function logInAnon(res) {
  res.cookie(ANON_COOKIE_NAME, 'ok', cookieOptions());
}

function logOutAnon(res) {
  res.clearCookie(ANON_COOKIE_NAME, cookieOptions());
}

// Gate for a route that's open to a real player/admin OR a limited anon
// session — used where the actual ownership check happens afterward, once
// the specific match row is loaded (see routes/matches.js).
function requireLoggedIn(req, res, next) {
  if (!isPlayer(req) && !isAnon(req)) {
    return res.status(401).json({ error: 'Please log in to do this' });
  }
  next();
}

module.exports = {
  COOKIE_NAME, PLAYER_COOKIE_NAME, isAdmin, logIn, logOut, requireAdmin,
  isPlayer, getPlayerId, logInPlayer, logOutPlayer, requirePlayer,
  ANON_COOKIE_NAME, isAnon, logInAnon, logOutAnon, requireLoggedIn,
};

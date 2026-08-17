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

// A player (logged in with the shared 4-digit code) or an admin — admin
// implies player, so admins never need to separately log in as a player.
function isPlayer(req) {
  return isAdmin(req) || (req.signedCookies && req.signedCookies[PLAYER_COOKIE_NAME] === 'ok');
}

function logInPlayer(res) {
  res.cookie(PLAYER_COOKIE_NAME, 'ok', cookieOptions());
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

module.exports = {
  COOKIE_NAME, PLAYER_COOKIE_NAME, isAdmin, logIn, logOut, requireAdmin,
  isPlayer, logInPlayer, logOutPlayer, requirePlayer,
};

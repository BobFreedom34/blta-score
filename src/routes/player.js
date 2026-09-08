const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { sendPinResetEmail, sendAdminResetRequestEmail, sendNewRegistrationEmail } = require('../mailer');

const router = express.Router();

// After this many consecutive wrong codes, login is refused outright —
// even for the *correct* code — until either an emailed reset link
// (POST /reset-pin) or an admin (POST /players/:id/reset-login-pin) clears
// it. See failed_pin_attempts in src/db.js.
const MAX_PIN_ATTEMPTS = 5;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Builds the { isPlayer, playerId, playerName, playerSlug } shape every
// session-reporting response shares. Takes the logged-in player's row
// directly rather than re-reading it off req's cookies, since a route that
// just called auth.logInPlayer() won't see that cookie reflected in
// req.signedCookies until the *next* request — cookies set on the response
// don't retroactively appear on the request that set them.
function sessionInfo({ isPlayerFlag, player }) {
  return {
    isPlayer: isPlayerFlag,
    playerId: player ? player.id : null,
    playerName: player ? player.name : null,
    playerSlug: player ? player.slug : null,
  };
}

// Five independent sources feed the one notification bell (see
// GET /notifications below) — badges (player_badges), chat messages
// (chat_notifications), looking-to-play requests (play_request_notifications),
// match proposals (proposal_notifications), and ranking moves
// (ranking_notifications). Summed here so both the session payload and
// every mark-read response can report one combined count without
// duplicating these queries at each call site.
function countUnreadNotifications(playerId) {
  const badges = db.prepare('SELECT COUNT(*) AS c FROM player_badges WHERE player_id = ? AND seen = 0').get(playerId).c;
  // chat_notifications and proposal_notifications reference a match_id that
  // can go away outright (the match gets deleted) — GET /notifications
  // below already only counts as "real" whatever its own INNER JOIN to
  // matches actually finds, so a notification whose match is gone quietly
  // stops appearing there. This has to filter the exact same way, or a
  // deleted match's still-unseen notification inflates the bell forever
  // with nothing in the list to ever click and clear it.
  const chats = db.prepare(`
    SELECT COUNT(*) AS c FROM chat_notifications cn
    JOIN matches m ON m.id = cn.match_id
    JOIN messages msg ON msg.id = cn.message_id
    WHERE cn.player_id = ? AND cn.seen = 0
  `).get(playerId).c;
  const playRequests = db.prepare('SELECT COUNT(*) AS c FROM play_request_notifications WHERE player_id = ? AND seen = 0').get(playerId).c;
  const proposals = db.prepare(`
    SELECT COUNT(*) AS c FROM proposal_notifications pn
    JOIN matches m ON m.id = pn.match_id
    WHERE pn.player_id = ? AND pn.seen = 0
  `).get(playerId).c;
  // ranking_notifications is self-contained (direction/amount/new_rank
  // copied straight in, no match/post reference to go stale — see its own
  // comment in db.js), so no existence-check join needed here.
  const rankings = db.prepare('SELECT COUNT(*) AS c FROM ranking_notifications WHERE player_id = ? AND seen = 0').get(playerId).c;
  return badges + chats + playRequests + proposals + rankings;
}

router.get('/session', (req, res) => {
  const playerId = auth.getPlayerId(req);
  const player = playerId ? db.prepare('SELECT id, name, slug, login_pin, email FROM players WHERE id = ?').get(playerId) : null;
  // Cheap enough to compute on every page load (two indexed COUNTs) — lets
  // the nav bell's unread bubble (see common.js) stay in sync without its
  // own separate poll. 0 for a logged-out visitor or an admin with no
  // player identity of their own, same as every other player-only field
  // this route reports.
  const unreadNotificationCount = playerId ? countUnreadNotifications(playerId) : 0;
  res.json({
    ...sessionInfo({ isPlayerFlag: auth.isPlayer(req), player }),
    // True for a player who's logged in (their phone was confirmed) but
    // never actually finished creating a code — e.g. closed the
    // pinSetupRequired step of their first login instead of completing
    // it. Checked on every page load (see refreshPlayerAuth in
    // common.js), not just at that first login, so there's no way to just
    // sit logged in without a code by closing the modal or navigating
    // away from it — the very next page re-opens it, forced.
    needsPinSetup: !!(player && !player.login_pin),
    unreadNotificationCount,
    // The player's own email, for prefilling "email me when someone
    // confirms a time" on the propose-times modal (see common.js) — safe
    // to send back here since this is always the logged-in player reading
    // their own session, never someone else's.
    playerEmail: player ? player.email : null,
    // Unrelated to playerId/isPlayer above — a referee session (see the
    // "Referee" button/modal in match.js, src/routes/referee.js) carries
    // no player identity at all, just a yes/no. Reported here rather than
    // its own session route so the client picks it up in the same
    // once-per-page-load request it already makes for player status.
    isReferee: auth.isReferee(req),
  });
});

// A player's own notifications, newest first — the list behind the nav
// bell's dropdown (see common.js). Merges five unrelated sources into one
// feed: a badge newly earned (player_badges), someone posting in a match's
// chat that this player is in (chat_notifications), someone picking a time
// on this player's looking-to-play post (play_request_notifications),
// someone proposing/confirming a match time (proposal_notifications, see
// further down), and this player moving in the main BLTA ranking
// (ranking_notifications, see further down still) — each item carries a
// `type` the client branches on to render/handle it differently (a
// "Congratulations" modal for a badge; a jump to the match for a chat
// message or proposal; a jump to the looking-to-play board for a play
// request; a jump to the rankings page for a ranking move). Player-only:
// there's no meaningful "my notifications" for a bare admin session with
// no specific player identity, so this 401s the same way a missing player
// cookie always does elsewhere, rather than silently returning an empty
// list.
router.get('/notifications', (req, res) => {
  const playerId = auth.getPlayerId(req);
  if (!playerId) return res.status(401).json({ error: 'Please log in to see your notifications' });

  const badgeRows = db.prepare(`
    SELECT pb.id, pb.seen, pb.earned_at AS created_at,
           bd.id AS badge_id, bd.name, bd.description, bd.icon
    FROM player_badges pb
    JOIN badge_definitions bd ON bd.id = pb.badge_id
    WHERE pb.player_id = ?
  `).all(playerId).map((r) => ({
    type: 'BADGE',
    id: r.id,
    seen: !!r.seen,
    createdAt: r.created_at,
    badge: { id: r.badge_id, name: r.name, description: r.description, icon: r.icon },
  }));

  const chatRows = db.prepare(`
    SELECT cn.id, cn.seen, cn.created_at,
           m.share_token AS match_token, m.player1_id, m.player2_id,
           msg.author, msg.body,
           p1.name AS p1_name, p2.name AS p2_name
    FROM chat_notifications cn
    JOIN matches m ON m.id = cn.match_id
    JOIN messages msg ON msg.id = cn.message_id
    JOIN players p1 ON p1.id = m.player1_id
    JOIN players p2 ON p2.id = m.player2_id
    WHERE cn.player_id = ?
  `).all(playerId).map((r) => ({
    type: 'CHAT_MESSAGE',
    id: r.id,
    seen: !!r.seen,
    createdAt: r.created_at,
    chat: {
      matchToken: r.match_token,
      author: r.author,
      body: r.body,
      // "The other player" from this notification's own recipient's point
      // of view — shown so the dropdown reads "new message in your match
      // vs. X" rather than just a bare match token.
      opponentName: r.player1_id === playerId ? r.p2_name : r.p1_name,
    },
  }));

  const playRequestRows = db.prepare(`
    SELECT prn.id, prn.seen, prn.created_at, prn.slot, prn.message,
           j.name AS joiner_name, j.slug AS joiner_slug
    FROM play_request_notifications prn
    JOIN players j ON j.id = prn.joiner_player_id
    WHERE prn.player_id = ?
  `).all(playerId).map((r) => ({
    type: 'PLAY_REQUEST',
    id: r.id,
    seen: !!r.seen,
    createdAt: r.created_at,
    playRequest: {
      joinerName: r.joiner_name, joinerSlug: r.joiner_slug, slot: r.slot, message: r.message,
    },
  }));

  const proposalRows = db.prepare(`
    SELECT pn.id, pn.seen, pn.created_at, pn.kind,
           m.share_token AS match_token, m.category,
           op.name AS other_player_name, op.slug AS other_player_slug
    FROM proposal_notifications pn
    JOIN matches m ON m.id = pn.match_id
    LEFT JOIN players op ON op.id = pn.other_player_id
    WHERE pn.player_id = ?
  `).all(playerId).map((r) => ({
    type: 'PROPOSAL',
    id: r.id,
    seen: !!r.seen,
    createdAt: r.created_at,
    proposal: {
      kind: r.kind,
      matchToken: r.match_token,
      category: r.category,
      otherPlayerName: r.other_player_name,
      otherPlayerSlug: r.other_player_slug,
    },
  }));

  const rankingRows = db.prepare(`
    SELECT id, seen, created_at, table_key, direction, amount, new_rank
    FROM ranking_notifications
    WHERE player_id = ?
  `).all(playerId).map((r) => ({
    type: 'RANKING',
    id: r.id,
    seen: !!r.seen,
    createdAt: r.created_at,
    ranking: {
      tableKey: r.table_key, direction: r.direction, amount: r.amount, newRank: r.new_rank,
    },
  }));

  const merged = [...badgeRows, ...chatRows, ...playRequestRows, ...proposalRows, ...rankingRows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(merged);
});

// Marks one notification read — for a badge, called the moment its
// "Congratulations" modal is opened; for a chat message, the moment it's
// clicked (which also navigates to the match) — see common.js. Not on
// merely opening the dropdown list, so the unread count only drops for
// things actually looked at. :type picks which table owns :id (their id
// sequences are independent, so a bare numeric id alone can't tell them
// apart — see GET /notifications above for where each type comes from).
router.post('/notifications/:type/:id/read', (req, res) => {
  const playerId = auth.getPlayerId(req);
  if (!playerId) return res.status(401).json({ error: 'Please log in to do this' });
  const { type, id } = req.params;
  const table = type === 'badge' ? 'player_badges'
    : type === 'chat' ? 'chat_notifications'
    : type === 'play_request' ? 'play_request_notifications'
    : type === 'proposal' ? 'proposal_notifications'
    : type === 'ranking' ? 'ranking_notifications'
    : null;
  if (!table) return res.status(400).json({ error: 'Invalid notification type' });
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row || row.player_id !== playerId) return res.status(404).json({ error: 'Notification not found' });
  db.prepare(`UPDATE ${table} SET seen = 1 WHERE id = ?`).run(row.id);
  res.json({ ok: true, unreadNotificationCount: countUnreadNotifications(playerId) });
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

function findPlayerByPhone(raw) {
  const candidates = db.prepare('SELECT * FROM players WHERE phone IS NOT NULL').all();
  return candidates.find((p) => samePhone(p.phone, raw));
}

const PHONE_NOT_FOUND_ERROR = "That phone number isn't on file — ask an admin to add it on your Players page entry";

// error is always plain English (matches this app's existing convention —
// every server error string always has been, regardless of UI language).
// errorCode is a short machine key the client maps to a translated string
// via t(`login.error.${errorCode}`) — see loginErrorText in common.js —
// falling back to the raw English error above for any code that lookup
// misses, so an unmapped/future error still shows *something* instead of
// a blank message.

// A real player's own phone number logs them in as that specific player
// (see checkMatchAccess in routes/matches.js for what that scopes them
// to). There used to be a second, anonymous-code path here too — it's
// been removed entirely; phone number is now the only way in besides admin.
//
// Once a player has a login_pin set (see POST /set-pin below), phone alone
// isn't enough — req.body.pin also has to match, and MAX_PIN_ATTEMPTS
// wrong guesses locks the account until a reset (see /forgot-pin below or
// an admin's /players/:id/reset-login-pin) clears failed_pin_attempts. The
// client always submits phone-only first; a player with no PIN yet logs in
// immediately (same as before PINs existed) with pinSetupRequired:true
// telling the client to prompt for one right away, while a player who
// already has one gets a 401 with pinRequired:true instead of being logged
// in, so the client can show a second step asking for it and resubmit
// {code, pin} together — see openPlayerLoginModal in common.js for that
// whole flow.
router.post('/login', (req, res) => {
  const raw = String(req.body.code || '').trim();
  // Not worth a full table scan/comparison against something that's
  // clearly not a phone number.
  if (raw.replace(/\D/g, '').length < 6) {
    return res.status(401).json({ error: PHONE_NOT_FOUND_ERROR, errorCode: 'phoneNotFound' });
  }
  const player = findPlayerByPhone(raw);
  if (!player) {
    // notFound (unlike the too-short case above) means this genuinely
    // looks like a phone number that just isn't registered yet — the
    // client uses that to offer POST /register as the next step, instead
    // of a dead-end "ask an admin".
    return res.status(401).json({ error: PHONE_NOT_FOUND_ERROR, errorCode: 'phoneNotFound', notFound: true });
  }

  if (player.login_pin) {
    if (player.failed_pin_attempts >= MAX_PIN_ATTEMPTS) {
      return res.status(401).json({ locked: true, error: 'Too many incorrect attempts — reset your code below, or ask an admin to reset it', errorCode: 'locked' });
    }
    const pin = String(req.body.pin || '').trim();
    if (!pin) {
      return res.status(401).json({ pinRequired: true, error: 'Enter your 5-digit code', errorCode: 'enterCode' });
    }
    if (!auth.verifyPin(pin, player.login_pin)) {
      const attempts = player.failed_pin_attempts + 1;
      db.prepare('UPDATE players SET failed_pin_attempts = ? WHERE id = ?').run(attempts, player.id);
      if (attempts >= MAX_PIN_ATTEMPTS) {
        return res.status(401).json({ locked: true, error: 'Too many incorrect attempts — reset your code below, or ask an admin to reset it', errorCode: 'locked' });
      }
      const left = MAX_PIN_ATTEMPTS - attempts;
      return res.status(401).json({
        pinRequired: true,
        error: `Incorrect code (${left} attempt${left === 1 ? '' : 's'} left)`,
        errorCode: 'incorrectCode',
        attemptsLeft: left,
      });
    }
    if (player.failed_pin_attempts > 0) {
      db.prepare('UPDATE players SET failed_pin_attempts = 0 WHERE id = ?').run(player.id);
    }
    auth.logInPlayer(res, player.id);
    return res.json(sessionInfo({ isPlayerFlag: true, player }));
  }

  auth.logInPlayer(res, player.id);
  return res.json({ ...sessionInfo({ isPlayerFlag: true, player }), pinSetupRequired: true });
});

// Slug generation, duplicated from routes/players.js's own uniqueSlugFor
// rather than imported — same small-helper-per-file precedent as
// db.js's own separate slugifyForBackfill copy. Kept here (not there) so
// every /player/* auth route (login, set-pin, forgot-pin, reset-pin,
// register) lives in one file with one naming convention.
function slugifyPart(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function surnameOf(name) {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1];
}
function uniqueSlugFor(name) {
  const base = slugifyPart(surnameOf(name)) || slugifyPart(name) || 'player';
  let slug = base;
  let n = 2;
  while (db.prepare('SELECT id FROM players WHERE slug = ?').get(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

// Self-service registration — the only other way in is an admin adding a
// player's phone number from the Players page first (POST /players,
// admin-only). This is intentionally open to anyone, same trust model as
// a brand-new player name typed straight into "New match" (see
// resolvePlayer in routes/matches.js) — just with a phone number attached
// from the start. Reached from the login form's notFound response above
// (see openPlayerLoginModal in common.js): give a name and the phone
// number you just tried to log in with, and this logs you straight in
// with pinSetupRequired:true, exactly like an admin-added player's first
// login — you land on the same "create your code" step either way.
//
// Two outcomes depending on that name:
//  - No existing player has it: a brand-new row is created.
//  - An existing player has it AND has no phone on file yet (the league
//    roster commonly has these — an admin added the name from blta.sk
//    without a number to reach them): this *claims* that row instead of
//    creating a duplicate, attaching the phone/email to it. An existing
//    player whose name already has a phone is a genuine conflict, not a
//    claim — rejected the same as always.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required', errorCode: 'nameRequired' });
  if (name.length > 60) return res.status(400).json({ error: 'Name is too long', errorCode: 'nameTooLong' });

  const raw = String(req.body.phone || '').trim();
  const digits = raw.replace(/[^\d+]/g, '');
  const isSlovakLocal = /^0\d{9}$/.test(digits);
  const isInternational = /^\+\d{8,15}$/.test(digits);
  if (!isSlovakLocal && !isInternational) {
    return res.status(400).json({ error: 'Enter a 10-digit phone number starting with 0 (e.g. 0903111222), or a full international number starting with +', errorCode: 'invalidPhoneFormat' });
  }

  // Unlike the optional email on an existing profile's bio (PATCH
  // /players/:id/bio), this one's required — it's the only way the admin
  // gets notified a new player just registered themselves (see below), and
  // the only self-service password-reset path (POST /forgot-pin) if they
  // ever forget their code.
  const email = (req.body.email || '').trim();
  if (!email) return res.status(400).json({ error: 'Email is required', errorCode: 'emailRequired' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email', errorCode: 'invalidEmail' });

  const existingByName = db.prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE').get(name);
  if (existingByName && existingByName.phone) {
    return res.status(409).json({ error: 'A player with that name already exists — ask an admin, or log in instead if this is you', errorCode: 'nameAlreadyExists' });
  }
  // Same loose last-6-digits comparison findPlayerByPhone/login uses —
  // checked here too, not just the DB's exact-string unique index on
  // phone, so registration can't create a second row that a later login's
  // own loose lookup would then find ambiguous between the two. (Can never
  // match existingByName here — it's guaranteed phone-less at this point.)
  if (findPlayerByPhone(digits)) {
    return res.status(409).json({ error: 'This phone number is already registered to a player — try logging in instead', errorCode: 'phoneAlreadyRegistered' });
  }

  let player;
  if (existingByName) {
    db.prepare('UPDATE players SET phone = ?, email = ? WHERE id = ?').run(digits, email.slice(0, 100), existingByName.id);
    player = db.prepare('SELECT id, name, slug FROM players WHERE id = ?').get(existingByName.id);
  } else {
    const slug = uniqueSlugFor(name);
    const info = db.prepare('INSERT INTO players (name, slug, phone, email) VALUES (?, ?, ?, ?)').run(name, slug, digits, email.slice(0, 100));
    player = db.prepare('SELECT id, name, slug FROM players WHERE id = ?').get(info.lastInsertRowid);
  }

  auth.logInPlayer(res, player.id);
  res.status(201).json({ ...sessionInfo({ isPlayerFlag: true, player }), pinSetupRequired: true });

  // After responding — the registering player shouldn't wait on this (or
  // have it fail their own registration) if SMTP has a hiccup.
  try {
    await sendNewRegistrationEmail({ name, phone: digits, email, claimed: !!existingByName });
  } catch (err) {
    console.error('[player] Failed to send new-registration admin email:', err.message);
  }
});

// Creates this player's login code — only reachable once already logged in
// (right after a pinSetupRequired login; see openPlayerLoginModal), and
// only ever sets *this* player's own code, never anyone else's (there's no
// playerId in the body to spoof — auth.getPlayerId(req) is the only source
// of who it applies to).
router.post('/set-pin', (req, res) => {
  const playerId = auth.getPlayerId(req);
  if (!playerId) return res.status(401).json({ error: 'Please log in first', errorCode: 'pleaseLogInFirst' });
  const pin = String(req.body.pin || '').trim();
  const confirmPin = String(req.body.confirmPin || '').trim();
  if (!/^\d{5}$/.test(pin)) {
    return res.status(400).json({ error: 'Code must be exactly 5 digits', errorCode: 'codeMustBe5Digits' });
  }
  if (pin !== confirmPin) {
    return res.status(400).json({ error: "Codes don't match", errorCode: 'codesDontMatch' });
  }
  db.prepare('UPDATE players SET login_pin = ?, failed_pin_attempts = 0, reset_token = NULL, reset_token_expires = NULL WHERE id = ?')
    .run(auth.hashPin(pin), playerId);
  res.json({ ok: true });
});

// Self-service recovery, step 1: given just the phone number (no PIN
// needed — that's the whole point of this route existing), emails a
// one-time reset link if this player has an email on file. If they don't,
// the client falls back to POST /request-admin-reset instead (see
// openPlayerLoginModal in common.js) — there's no self-service path
// without an email to actually send the link to.
router.post('/forgot-pin', async (req, res) => {
  const raw = String(req.body.code || '').trim();
  const player = findPlayerByPhone(raw);
  if (!player) {
    return res.status(401).json({ error: PHONE_NOT_FOUND_ERROR, errorCode: 'phoneNotFound' });
  }
  if (!player.email) {
    return res.json({ noEmail: true });
  }
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  db.prepare('UPDATE players SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(token, expires, player.id);
  try {
    await sendPinResetEmail(player, token);
  } catch (err) {
    console.error('[player] Failed to send reset email:', err.message);
  }
  res.json({ emailSent: true });
});

// Self-service recovery, step 2 — what the link from that email lands on
// (a dedicated page, /reset-code?token=..., since this has to work from a
// freshly-opened email client with no existing session; see
// public/reset-code.html). Success clears the lockout counter too (not
// just login_pin), and logs the player straight in, same as a normal
// login would.
router.post('/reset-pin', (req, res) => {
  const token = String(req.body.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing reset token', errorCode: 'missingResetToken' });
  const player = db.prepare('SELECT id, name, slug, reset_token_expires FROM players WHERE reset_token = ?').get(token);
  if (!player || !player.reset_token_expires || new Date(player.reset_token_expires) < new Date()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired — request a new one', errorCode: 'resetLinkInvalid' });
  }
  const pin = String(req.body.pin || '').trim();
  const confirmPin = String(req.body.confirmPin || '').trim();
  if (!/^\d{5}$/.test(pin)) {
    return res.status(400).json({ error: 'Code must be exactly 5 digits', errorCode: 'codeMustBe5Digits' });
  }
  if (pin !== confirmPin) {
    return res.status(400).json({ error: "Codes don't match", errorCode: 'codesDontMatch' });
  }
  db.prepare('UPDATE players SET login_pin = ?, failed_pin_attempts = 0, reset_token = NULL, reset_token_expires = NULL WHERE id = ?')
    .run(auth.hashPin(pin), player.id);
  auth.logInPlayer(res, player.id);
  res.json(sessionInfo({ isPlayerFlag: true, player }));
});

// The fallback when a player has no email on file at all — pings the
// admin by email (NOTIFY_EMAIL, the same address the match-finished
// summary already goes to) instead of the player themselves, since
// there's nowhere else to send a self-service link. The admin resets it
// manually from the player's profile once they've confirmed it's really
// them (see POST /players/:id/reset-login-pin).
router.post('/request-admin-reset', async (req, res) => {
  const raw = String(req.body.code || '').trim();
  const player = findPlayerByPhone(raw);
  if (!player) {
    return res.status(401).json({ error: PHONE_NOT_FOUND_ERROR, errorCode: 'phoneNotFound' });
  }
  try {
    await sendAdminResetRequestEmail(player);
  } catch (err) {
    console.error('[player] Failed to send admin reset-request email:', err.message);
  }
  res.json({ sent: true });
});

router.post('/logout', (req, res) => {
  auth.logOutPlayer(res);
  res.json({ isPlayer: false, playerId: null, playerName: null, playerSlug: null });
});

module.exports = router;

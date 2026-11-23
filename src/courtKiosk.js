// The kiosk of a tournament: phones that lie on its courts. The organiser makes ONE link for the tournament (/kiosk/<token>); on every phone the link shows the courts, the phone
// picks the one it lies on, and from then on lists the matches of that court and lets whoever stands there score them. So the kiosk is its own, narrow kind of access (next to the
// admin, the player and the referee): its secret is the token in the address, the chosen court goes into a signed cookie, and the cookie lets that browser run the LIVE SCORE (start,
// point, undo, pause, finish) of the matches that stand on THAT court of THAT tournament - never a finished match, never another court, never any other part of the app.
// A new link (makeLink) replaces the token: the old address and every phone that holds its cookie stop working at once, because the cookie only holds the token and the token is
// checked against this table on every request. (Anyone who has the link can pick any court of the tournament: the link is the secret, keep it to the phones on the courts.)
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

// { token, seasonId } of a link that exists, else null
const byToken = (token) => (typeof token === 'string' && TOKEN_RE.test(token)
  ? db.prepare('SELECT token, season_id AS seasonId FROM season_kiosks WHERE token = ?').get(token) || null
  : null);

// the link of a tournament: { token, pin }, or null when it has none
const linkOf = (seasonId) => db.prepare('SELECT token, pin FROM season_kiosks WHERE season_id = ?').get(seasonId) || null;
const tokenOf = (seasonId) => { const row = linkOf(seasonId); return row ? row.token : null; };

// the first link of a tournament, or a new one that replaces the old
function makeLink(season) {
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('DELETE FROM season_kiosks WHERE season_id = ?').run(season.id);
  // the short code of the short address /turnaj<number> (5 digits: the number alone is public, so the code is what keeps a stranger out)
  const pin = String(crypto.randomInt(0, 100000)).padStart(5, '0');
  db.prepare('INSERT INTO season_kiosks (season_id, token, pin, created_at) VALUES (?, ?, ?, ?)').run(season.id, token, pin, new Date().toISOString());
  return token;
}

const removeLink = (seasonId) => db.prepare('DELETE FROM season_kiosks WHERE season_id = ?').run(seasonId).changes > 0;

// ---- the battery of the phone on a court ----
// The kiosk page reports { level 0..1, charging } every 20 minutes (Android Chrome knows it; a browser that does not sends nulls and only shows that the phone is alive). A battery at or
// under LOW_LEVEL that is not charging is one e-mail to the organiser; the next one only after it has been charged or has climbed to RECOVER_LEVEL (so it does not mail again and again).
const LOW_LEVEL = 0.2;
const RECOVER_LEVEL = 0.3;

// -> { level (0..1 or null), charging (true / false / null), sendAlert }
function reportBattery(kiosk, body, now = Date.now()) {
  const b = body || {};
  const level = typeof b.level === 'number' && b.level >= 0 && b.level <= 1 ? Math.round(b.level * 100) / 100 : null;
  const charging = typeof b.charging === 'boolean' ? b.charging : null;
  const prev = db.prepare('SELECT alerted FROM kiosk_batteries WHERE season_id = ? AND court_no = ?').get(kiosk.seasonId, kiosk.courtNo);
  let alerted = prev ? prev.alerted : 0;
  let sendAlert = false;
  if (level !== null) {
    if (level <= LOW_LEVEL && charging !== true) {
      if (!alerted) { alerted = 1; sendAlert = true; }
    } else if (charging === true || level >= RECOVER_LEVEL) alerted = 0;
  }
  db.prepare(`
    INSERT INTO kiosk_batteries (season_id, court_no, level, charging, alerted, seen_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (season_id, court_no) DO UPDATE SET level = excluded.level, charging = excluded.charging, alerted = excluded.alerted, seen_at = excluded.seen_at
  `).run(kiosk.seasonId, kiosk.courtNo, level, charging === null ? null : (charging ? 1 : 0), alerted, new Date(now).toISOString());
  return { level, charging, sendAlert };
}

// what the Backend shows: one entry per court that has reported
function batteriesOf(seasonId) {
  return db.prepare('SELECT court_no AS courtNo, level, charging, seen_at AS seenAt FROM kiosk_batteries WHERE season_id = ? ORDER BY court_no').all(seasonId)
    .map((r) => ({ courtNo: r.courtNo, level: r.level, charging: r.charging === null ? null : !!r.charging, seenAt: r.seenAt }));
}

// the court n (1 ... number of courts, whole number) of the tournament of this link -> { token, seasonId, courtNo } or null
function pick(token, courtNo) {
  const kiosk = byToken(token);
  const n = Number(courtNo);
  if (!kiosk || !Number.isInteger(n) || n < 1) return null;
  const season = db.prepare("SELECT court_count FROM seasons WHERE id = ? AND kind = 'TOURNAMENT'").get(kiosk.seasonId);
  return season && n <= (season.court_count || 0) ? { token: kiosk.token, seasonId: kiosk.seasonId, courtNo: n } : null;
}

// what the cookie of this request makes the browser: { seasonId, courtNo } while the link is valid and the court exists, else null
function fromRequest(req) {
  const c = auth.kioskOf(req);
  const hit = c && pick(c.token, c.courtNo);
  return hit ? { seasonId: hit.seasonId, courtNo: hit.courtNo } : null;
}

// may this kiosk run the live score of this match (a row of matches)? Same tournament, same court, and the match is not finished.
const mayScore = (kiosk, row) => !!kiosk && !!row && row.season_id === kiosk.seasonId && row.court_no === kiosk.courtNo && row.status !== 'FINISHED';

// The short address /turnaj<number> asks for the code and gives the token back. A stranger may try the code, so it is limited: after 5 wrong codes for a tournament it is closed for
// 10 minutes (the right code does not open it then either) - 5 tries per 10 minutes against 100 000 codes.
const MAX_WRONG = 5;
const LOCK_MS = 10 * 60 * 1000;
const wrong = new Map(); // season id -> { count, until }
function openByCode(seasonId, code, now = Date.now()) {
  const w = wrong.get(seasonId);
  if (w && w.until > now) return { locked: true };
  const link = linkOf(seasonId);
  const season = link && db.prepare("SELECT id FROM seasons WHERE id = ? AND kind = 'TOURNAMENT'").get(seasonId);
  if (!season) return { missing: true };
  const given = String(code || '').replace(/[ ]+/g, '');
  if (link.pin && /^[0-9]{5}$/.test(given) && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(link.pin))) { wrong.delete(seasonId); return { token: link.token }; }
  const count = (w && !w.until ? w.count : 0) + 1; // (a lock that has run out starts the count again)
  wrong.set(seasonId, count >= MAX_WRONG ? { count: 0, until: now + LOCK_MS } : { count, until: 0 });
  return { wrong: true, locked: count >= MAX_WRONG };
}

module.exports = { reportBattery, batteriesOf, LOW_LEVEL, byToken, linkOf, openByCode, tokenOf, makeLink, removeLink, pick, fromRequest, mayScore };

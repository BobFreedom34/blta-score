const express = require('express');
const db = require('../db');
const auth = require('../auth');
const backup = require('../backup');
const courtIQBackfill = require('../courtIQBackfill');
const leagues = require('../leagues');

const router = express.Router();

// Who is logged in as an admin: the super admin (all the cities; picks the one worked on) or the admin of one city
function sessionInfo(req, actingId) {
  const me = auth.adminSession(req);
  if (!me) return { isAdmin: false };
  const acting = leagues.byId(actingId || leagues.actingIdOf(req));
  const out = {
    isAdmin: true,
    role: me.role,
    acting: acting ? { id: acting.id, name: acting.name, slug: acting.slug, brandName: acting.brand_name || acting.name } : null,
  };
  if (me.role === 'CITY') { out.name = me.name; out.email = me.email; }
  else out.cities = db.prepare('SELECT id, name, slug FROM leagues ORDER BY sort_order, name').all();
  return out;
}

router.get('/session', (req, res) => {
  res.json(sessionInfo(req));
});

// The super admin picks the city the backend works on (its lists, and where new things go)
router.post('/acting-city', auth.requireSuperAdmin, (req, res) => {
  const city = leagues.byId(Number(req.body && req.body.leagueId));
  if (!city) return res.status(404).json({ error: 'City not found' });
  res.cookie(leagues.ACTING_COOKIE, String(city.id), { httpOnly: true, sameSite: 'lax', secure: (process.env.PUBLIC_URL || '').startsWith('https://'), maxAge: 365 * 24 * 60 * 60 * 1000, path: '/' });
  res.json(sessionInfo(req, city.id));
});

// at most 8 wrong passwords in 10 minutes from one address
const attempts = new Map();
const tooMany = (ip) => { const a = attempts.get(ip); return !!a && a.reset > Date.now() && a.count >= 8; };
const failed = (ip) => {
  const a = attempts.get(ip);
  if (!a || a.reset < Date.now()) attempts.set(ip, { count: 1, reset: Date.now() + 10 * 60 * 1000 });
  else a.count += 1;
};

router.post('/login', (req, res) => {
  const password = req.body.password || '';
  const email = String(req.body.email || '').trim().toLowerCase();
  // with an email it is the admin of a city, without one the super admin
  if (email) {
    const ip = req.ip || '';
    if (tooMany(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    const row = db.prepare('SELECT * FROM city_admins WHERE email = ?').get(email);
    if (!row || !auth.verifyPassword(password, row.password_hash)) {
      failed(ip);
      return res.status(401).json({ error: 'Incorrect email or password' });
    }
    db.prepare("UPDATE city_admins SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(row.id);
    auth.logInCityAdmin(res, row.id);
    return res.json({ isAdmin: true, role: 'CITY' });
  }
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin login is not configured on this server (ADMIN_PASSWORD is unset)' });
  }
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  auth.logIn(res);
  res.json({ isAdmin: true, role: 'SUPER' });
});

router.post('/logout', (req, res) => {
  auth.logOut(res);
  res.json({ isAdmin: false });
});

// Most-recent-first, capped rather than fully paginated — an amateur
// league's actual login volume makes a second page a "when we need it"
// problem, not a launch requirement. player_id has no FK to players (see
// db.js), so a login from a since-deleted player still shows up here —
// name/slug just fall back to a placeholder rather than the row vanishing
// or the whole query failing.
const LOGIN_EVENTS_LIMIT = 500;
router.get('/login-events', auth.requireSuperAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.player_id, e.created_at, p.name AS player_name, p.slug AS player_slug
    FROM login_events e
    LEFT JOIN players p ON p.id = e.player_id
    ORDER BY e.id DESC
    LIMIT ?
  `).all(LOGIN_EVENTS_LIMIT);
  res.json(rows.map((r) => ({
    id: r.id,
    playerId: r.player_id,
    playerName: r.player_name || '(deleted player)',
    playerSlug: r.player_slug || null,
    createdAt: r.created_at,
  })));
});

// Manual trigger for the daily Google Drive backup (see src/backup.js) —
// mainly so setup can be verified right away instead of waiting for the
// nightly run to prove the account/folder are wired up correctly.
router.post('/backup-now', auth.requireSuperAdmin, async (req, res) => {
  const result = await backup.runBackup({ force: true }); // the button always uploads, even when today has a backup already
  if (result.skipped) return res.status(400).json({ error: 'Backup is not configured — set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN and GOOGLE_DRIVE_BACKUP_FOLDER_ID.' });
  if (!result.ok) return res.status(500).json({ error: result.error });
  res.json(result);
});

// Manual trigger for scripts/backfillCourtIQ.js's own replay (see
// src/courtIQBackfill.js) — lets an admin rebuild CourtIQ ratings from the
// admin panel itself, on a deployed instance, without needing shell access
// to run the CLI script directly. Always wipes and rebuilds from scratch;
// safe to click again any time (e.g. after a score correction, or after a
// constant in courtIQEngine.js changes).
router.post('/courtiq/backfill', auth.requireSuperAdmin, (req, res) => {
  const result = courtIQBackfill.runBackfill();
  res.json(result);
});

module.exports = router;

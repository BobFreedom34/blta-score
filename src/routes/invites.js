// "Pozvi kamaráta": every player has a personal invite link (/pozvanka/<their slug>). Opening it is counted and remembers the inviter in a
// cookie; when the visitor then registers as a NEW player, the new player is credited to the inviter (players.invited_by).
//   GET /api/invites/mine   a logged-in player's counters: opened, registered, played
//   GET /api/invites/admin  the admin's overview: who invited whom (+ the best recruiters)
//   GET /pozvanka/:slug     the public link (mounted in server.js): count, set the cookie, go to the home page
const express = require('express');
const db = require('../db');
const { requireAdmin, getPlayerId } = require('../auth');

const router = express.Router();

const COOKIE = 'blta_ref';
const COOKIE_DAYS = 30;

if (!db.prepare('PRAGMA table_info(players)').all().some((c) => c.name === 'invited_by')) {
  db.exec('ALTER TABLE players ADD COLUMN invited_by INTEGER');
}
db.exec(`
  CREATE TABLE IF NOT EXISTS invite_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inviter_id INTEGER NOT NULL,
    visited_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_invite_visits_inviter ON invite_visits(inviter_id);
`);

// The public link: counted once per browser and inviter (a reload does not count again), then the visitor lands on the home page,
// where Register is.
function openLink(req, res) {
  const slug = String(req.params.slug || '').toLowerCase();
  const inviter = slug ? db.prepare('SELECT id FROM players WHERE slug = ? AND hidden = 0').get(slug) : null;
  if (inviter && req.cookies[COOKIE] !== slug) {
    db.prepare('INSERT INTO invite_visits (inviter_id) VALUES (?)').run(inviter.id);
    res.cookie(COOKIE, slug, { maxAge: COOKIE_DAYS * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: req.secure });
  }
  res.redirect(302, '/');
}

// Called when a NEW player has just registered: credits the inviter whose link brought them (never themselves). Never throws.
function creditInviter(req, res, newPlayerId) {
  try {
    const slug = req.cookies && req.cookies[COOKIE];
    if (!slug) return null;
    const inviter = db.prepare('SELECT id FROM players WHERE slug = ?').get(String(slug).toLowerCase());
    res.clearCookie(COOKIE);
    if (!inviter || inviter.id === newPlayerId) return null;
    db.prepare('UPDATE players SET invited_by = ? WHERE id = ? AND invited_by IS NULL').run(inviter.id, newPlayerId);
    return inviter.id;
  } catch (err) {
    console.error('[invites] could not credit the inviter:', err.message);
    return null;
  }
}

const playedOf = (id) => db.prepare(`
  SELECT COUNT(*) AS n FROM matches WHERE status = 'FINISHED' AND (player1_id = ? OR player2_id = ?)
`).get(id, id).n;

router.get('/mine', (req, res) => {
  const me = getPlayerId(req);
  if (me === null) return res.status(401).json({ error: 'Please log in as a player' });
  const player = db.prepare('SELECT slug FROM players WHERE id = ?').get(me);
  if (!player || !player.slug) return res.json({ slug: '', opened: 0, registered: 0, played: 0 });
  const invited = db.prepare('SELECT id FROM players WHERE invited_by = ?').all(me);
  res.json({
    slug: player.slug,
    opened: db.prepare('SELECT COUNT(*) AS n FROM invite_visits WHERE inviter_id = ?').get(me).n,
    registered: invited.length,
    played: invited.filter((p) => playedOf(p.id) > 0).length,
  });
});

router.get('/admin', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.slug, p.created_at AS createdAt, i.id AS inviterId, i.name AS inviterName
    FROM players p JOIN players i ON i.id = p.invited_by
    ORDER BY p.created_at DESC, p.id DESC
  `).all();
  const invited = rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, createdAt: r.createdAt, inviterId: r.inviterId, inviter: r.inviterName, played: playedOf(r.id) > 0 }));
  const top = new Map();
  invited.forEach((r) => top.set(r.inviterId, { name: r.inviter, count: (top.has(r.inviterId) ? top.get(r.inviterId).count : 0) + 1 }));
  res.json({
    invited,
    top: [...top.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5),
    opened: db.prepare('SELECT COUNT(*) AS n FROM invite_visits').get().n,
  });
});

module.exports = router;
module.exports.openLink = openLink;
module.exports.creditInviter = creditInviter;

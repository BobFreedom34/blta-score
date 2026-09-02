const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();

router.get('/session', (req, res) => {
  res.json({ isAdmin: auth.isAdmin(req) });
});

router.post('/login', (req, res) => {
  const password = req.body.password || '';
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin login is not configured on this server (ADMIN_PASSWORD is unset)' });
  }
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  auth.logIn(res);
  res.json({ isAdmin: true });
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
router.get('/login-events', auth.requireAdmin, (req, res) => {
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

module.exports = router;

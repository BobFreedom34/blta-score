// The "Referee" button on every match page (see match.js) — a single
// shared 5-digit code, set by admin below, that lets anyone who knows it
// control live scoring on ANY match without being a specific player or
// admin (see auth.js's isReferee for exactly what that then unlocks, and
// its own comment on why this is a deliberately narrower re-introduction
// of a pattern this app used to have and removed). Public login/logout —
// same trust model as the player login modal itself, just a shared secret
// instead of a per-player one. Reads back as part of
// GET /api/player/session (routes/player.js) rather than its own session
// route here, so the client gets referee status in the same request it
// already makes for player status on every page load.
const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();

const CODE_RE = /^\d{5}$/;

function getStoredHash() {
  const row = db.prepare('SELECT code_hash FROM referee_code WHERE id = 1').get();
  return row ? row.code_hash : null;
}

router.post('/login', (req, res) => {
  const code = String(req.body.code || '').trim();
  const stored = getStoredHash();
  // errorCode (not just error) so the client can show a translated
  // message instead of this raw English one — same pattern as the player
  // login's own errorCode/loginErrorText in common.js.
  if (!stored) {
    return res.status(400).json({ error: 'Referee login is not set up yet — ask an admin to set a referee code.', errorCode: 'notConfigured' });
  }
  if (!CODE_RE.test(code) || !auth.verifyPin(code, stored)) {
    return res.status(401).json({ error: 'Incorrect code', errorCode: 'wrongCode' });
  }
  auth.logInReferee(res);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  auth.logOutReferee(res);
  res.json({ ok: true });
});

// Admin-only management of the shared code itself — set (or replace) it,
// or clear it outright to turn the whole feature off. Never readable in
// plain text once set (same as a player's own login_pin) — rotating it
// means setting a new one, not looking up the old one.
router.get('/admin/status', auth.requireAdmin, (req, res) => {
  res.json({ isSet: !!getStoredHash() });
});

router.put('/admin/code', auth.requireAdmin, (req, res) => {
  const code = String(req.body.code || '').trim();
  if (!CODE_RE.test(code)) {
    return res.status(400).json({ error: 'Code must be exactly 5 digits' });
  }
  const hash = auth.hashPin(code);
  const ts = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM referee_code WHERE id = 1').get();
  if (existing) {
    db.prepare('UPDATE referee_code SET code_hash = ?, updated_at = ? WHERE id = 1').run(hash, ts);
  } else {
    db.prepare('INSERT INTO referee_code (id, code_hash, updated_at) VALUES (1, ?, ?)').run(hash, ts);
  }
  res.json({ ok: true });
});

router.delete('/admin/code', auth.requireAdmin, (req, res) => {
  db.prepare('DELETE FROM referee_code WHERE id = 1').run();
  res.json({ ok: true });
});

module.exports = router;

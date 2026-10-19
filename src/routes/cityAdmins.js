// The admins of a single city (Backend > Admins) — only the super admin makes, changes or removes them. A city admin logs in on the backend
// page with the email and the password given here and then runs ONE city (see src/cityScope.js for exactly what that means). The password is
// chosen by the super admin, kept as a hash and never given back.
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const leagues = require('../leagues');

const router = express.Router();
router.use(auth.requireSuperAdmin);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function serialize(row) {
  const city = leagues.byId(row.league_id);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    leagueId: row.league_id,
    cityName: city ? city.name : '(deleted city)',
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  };
}

// -> { fields } | { error }
function parse(body, existing) {
  const fields = {};
  if (body.name !== undefined || !existing) {
    const name = String(body.name || '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 60) return { error: 'The name is required (2-60 characters)' };
    fields.name = name;
  }
  if (body.email !== undefined || !existing) {
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 100) return { error: 'The email is not valid' };
    const other = db.prepare('SELECT id FROM city_admins WHERE email = ?').get(email);
    if (other && (!existing || other.id !== existing.id)) return { error: 'This email already has an account' };
    fields.email = email;
  }
  if (body.leagueId !== undefined || !existing) {
    const league = leagues.byId(Number(body.leagueId));
    if (!league) return { error: 'Pick the city this admin runs' };
    fields.league_id = league.id;
  }
  if (body.password !== undefined && body.password !== '') {
    const password = String(body.password);
    if (password.length < 8) return { error: 'The password needs at least 8 characters' };
    if (password.length > 100) return { error: 'The password is too long' };
    fields.password_hash = auth.hashPassword(password);
  } else if (!existing) {
    return { error: 'Set a password for the new admin (8 characters or more)' };
  }
  return { fields };
}

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM city_admins ORDER BY league_id, name COLLATE NOCASE').all().map(serialize));
});

router.post('/', (req, res) => {
  const parsed = parse(req.body || {}, null);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const f = parsed.fields;
  const info = db.prepare('INSERT INTO city_admins (league_id, name, email, password_hash) VALUES (?, ?, ?, ?)').run(f.league_id, f.name, f.email, f.password_hash);
  res.status(201).json(serialize(db.prepare('SELECT * FROM city_admins WHERE id = ?').get(Number(info.lastInsertRowid))));
});

router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM city_admins WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Admin not found' });
  const parsed = parse(req.body || {}, row);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const keys = Object.keys(parsed.fields);
  if (!keys.length) return res.status(400).json({ error: 'Nothing to update' });
  db.prepare(`UPDATE city_admins SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...parsed.fields, id: row.id });
  res.json(serialize(db.prepare('SELECT * FROM city_admins WHERE id = ?').get(row.id)));
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM city_admins WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Admin not found' });
  db.prepare('DELETE FROM city_admins WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;

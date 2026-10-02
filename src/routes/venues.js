const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();

function serialize(row) {
  return { id: row.id, name: row.name };
}

function parseName(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: 'Name is required' };
  if (name.length > 120) return { error: 'Name is too long (max 120 characters)' };
  return { name };
}

// Public — every match form's location autocomplete needs it, logged in or not.
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM venues ORDER BY name COLLATE NOCASE').all();
  res.json(rows.map(serialize));
});

router.post('/', requireAdmin, (req, res) => {
  const parsed = parseName(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (db.prepare('SELECT 1 FROM venues WHERE name = ?').get(parsed.name)) {
    return res.status(400).json({ error: 'That venue already exists' });
  }
  const info = db.prepare('INSERT INTO venues (name) VALUES (?)').run(parsed.name);
  res.status(201).json(serialize(db.prepare('SELECT * FROM venues WHERE id = ?').get(info.lastInsertRowid)));
});

router.patch('/:id', requireAdmin, (req, res) => {
  const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(req.params.id);
  if (!venue) return res.status(404).json({ error: 'Venue not found' });
  const parsed = parseName(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const clash = db.prepare('SELECT id FROM venues WHERE name = ? AND id != ?').get(parsed.name, venue.id);
  if (clash) return res.status(400).json({ error: 'That venue already exists' });
  db.prepare('UPDATE venues SET name = ? WHERE id = ?').run(parsed.name, venue.id);
  res.json(serialize(db.prepare('SELECT * FROM venues WHERE id = ?').get(venue.id)));
});

router.delete('/:id', requireAdmin, (req, res) => {
  const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(req.params.id);
  if (!venue) return res.status(404).json({ error: 'Venue not found' });
  db.prepare('DELETE FROM venues WHERE id = ?').run(venue.id);
  res.json({ ok: true });
});

module.exports = router;

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    rows = db.prepare('SELECT * FROM players WHERE name LIKE ? ORDER BY name COLLATE NOCASE')
      .all(`%${q}%`);
  } else {
    rows = db.prepare('SELECT * FROM players ORDER BY name COLLATE NOCASE').all();
  }
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  res.json(player);
});

// Note: players can still be auto-created when someone plans a new match with
// a new name (see resolvePlayer in routes/matches.js) — that stays open to
// everyone. Only the dedicated Players page (add/rename/delete) is admin-only.
router.post('/', requireAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length > 60) return res.status(400).json({ error: 'Name is too long' });

  const existing = db.prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE').get(name);
  if (existing) return res.status(200).json(existing);

  const info = db.prepare('INSERT INTO players (name) VALUES (?)').run(name);
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(player);
});

router.patch('/:id', requireAdmin, (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length > 60) return res.status(400).json({ error: 'Name is too long' });

  const existing = db.prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE AND id != ?')
    .get(name, player.id);
  if (existing) return res.status(400).json({ error: 'Another player already has that name' });

  db.prepare('UPDATE players SET name = ? WHERE id = ?').run(name, player.id);
  res.json(db.prepare('SELECT * FROM players WHERE id = ?').get(player.id));
});

router.delete('/:id', requireAdmin, (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const { count } = db.prepare(
    'SELECT COUNT(*) AS count FROM matches WHERE player1_id = ? OR player2_id = ?'
  ).get(player.id, player.id);
  if (count > 0) {
    return res.status(400).json({
      error: `Can't delete ${player.name} — they're in ${count} match${count === 1 ? '' : 'es'}. Remove those matches first.`,
    });
  }

  db.prepare('DELETE FROM players WHERE id = ?').run(player.id);
  res.status(204).end();
});

module.exports = router;

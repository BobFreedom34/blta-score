const express = require('express');
const db = require('../db');

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

router.post('/', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length > 60) return res.status(400).json({ error: 'Name is too long' });

  const existing = db.prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE').get(name);
  if (existing) return res.status(200).json(existing);

  const info = db.prepare('INSERT INTO players (name) VALUES (?)').run(name);
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(player);
});

module.exports = router;

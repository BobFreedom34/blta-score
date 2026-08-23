const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();

const LOGIC_TYPES = ['GAMES_PLAYED', 'WINS', 'WIN_STREAK', 'CATEGORY_SWEEP', 'BAGEL', 'COMEBACK', 'STRAIGHT_SETS'];
// These logic types are count-based (need a threshold); the rest are
// pass/fail conditions computed straight from a player's match history.
const THRESHOLD_TYPES = ['GAMES_PLAYED', 'WINS', 'WIN_STREAK', 'STRAIGHT_SETS'];

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    logicType: row.logic_type,
    threshold: row.threshold,
    sortOrder: row.sort_order,
  };
}

function validateBody(body) {
  const name = (body.name || '').trim();
  const description = (body.description || '').trim();
  const icon = (body.icon || '').trim();
  const logicType = body.logicType;
  if (!name) return { error: 'Name is required' };
  if (name.length > 60) return { error: 'Name is too long' };
  if (!description) return { error: 'Description is required' };
  if (description.length > 140) return { error: 'Description is too long' };
  if (!icon) return { error: 'Icon is required' };
  if (icon.length > 8) return { error: 'Icon should just be a single emoji' };
  if (!LOGIC_TYPES.includes(logicType)) return { error: 'Invalid logic type' };
  const needsThreshold = THRESHOLD_TYPES.includes(logicType);
  let threshold = null;
  if (needsThreshold) {
    threshold = Number(body.threshold);
    if (!Number.isInteger(threshold) || threshold < 1) {
      return { error: 'Threshold must be a positive whole number for this logic type' };
    }
  }
  const sortOrder = Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;
  return { name, description, icon, logicType, threshold, sortOrder };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM badge_definitions ORDER BY sort_order, id').all();
  res.json(rows.map(serialize));
});

router.post('/', requireAdmin, (req, res) => {
  const parsed = validateBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const info = db.prepare(
    'INSERT INTO badge_definitions (name, description, icon, logic_type, threshold, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(parsed.name, parsed.description, parsed.icon, parsed.logicType, parsed.threshold, parsed.sortOrder);
  res.status(201).json(serialize(db.prepare('SELECT * FROM badge_definitions WHERE id = ?').get(info.lastInsertRowid)));
});

router.patch('/:id', requireAdmin, (req, res) => {
  const badge = db.prepare('SELECT * FROM badge_definitions WHERE id = ?').get(req.params.id);
  if (!badge) return res.status(404).json({ error: 'Badge not found' });
  const parsed = validateBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  db.prepare(
    `UPDATE badge_definitions
     SET name = ?, description = ?, icon = ?, logic_type = ?, threshold = ?, sort_order = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(parsed.name, parsed.description, parsed.icon, parsed.logicType, parsed.threshold, parsed.sortOrder, badge.id);
  res.json(serialize(db.prepare('SELECT * FROM badge_definitions WHERE id = ?').get(badge.id)));
});

router.delete('/:id', requireAdmin, (req, res) => {
  const badge = db.prepare('SELECT * FROM badge_definitions WHERE id = ?').get(req.params.id);
  if (!badge) return res.status(404).json({ error: 'Badge not found' });
  db.prepare('DELETE FROM badge_definitions WHERE id = ?').run(badge.id);
  res.status(204).end();
});

module.exports = router;
